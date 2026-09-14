---
sourceHash: 2c6e24a9d83f64ab
title: Historique des entités
sidebar_label: Historique des entités
description: Suivez chaque modification apportée à vos entités avec une piste d'audit complète — qui a modifié quoi, quand, et l'entité complète avant/après.
---

## Vue d'ensemble

L'historique des entités enregistre un instantané des valeurs de l'entité à chaque création, mise à jour et suppression. Cela vous offre une piste d'audit complète avec les différences (diffs).

## Activer l'historique

:::note[Où cela se configure]
**Runtime managé** — activé par défaut. `REBASE_HISTORY=false` dans le fichier `.env` le désactive.

**Éjecté** — `history: true` dans `initializeRebaseBackend({ … })`. La forme objet ci-dessous — `{ retention }` — est réservée au mode éjecté ; la variable d'environnement est un booléen.

La cartographie complète se trouve dans [Vue d'ensemble du backend](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Où cela se configure]
**Runtime managé :** `REBASE_HISTORY` (`true` par défaut ; définir sur `false` pour le désactiver). Les paramètres de rétention n'ont pas de variable d'environnement — éjectez pour les modifier.
**Éjecté :** `initializeRebaseBackend({ history })` dans `backend/src/index.ts`.
:::

Activez l'historique dans `initializeRebaseBackend` :

```typescript no-verify
await initializeRebaseBackend({
    // ...
    history: true
});
```

Ou avec une période de rétention personnalisée :

```typescript
history: {
    retention: 30        // Days. Entries older than this are pruned (default: 90)
}
```

### Par collection

Indiquez les collections qui doivent suivre l'historique :

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const ordersCollection = defineCollection({
    slug: "orders",
    name: "Orders",
    table: "orders",
    history: true,       // Enable for this collection
    properties: { /* ... */ }
});
```

## Fonctionnement

1. Le backend crée automatiquement une table `rebase.entity_history`.
2. À chaque création, mise à jour ou suppression, un instantané est enregistré avec :
   - L'identifiant de l'entité (Entity ID) et le slug de la collection (dans `table_name`)
   - Les valeurs complètes de l'entité (avant et après)
   - L'horodatage et l'identifiant de l'utilisateur
   - L'action (`create`, `update`, `delete`)
   - Un tableau de `changed_fields` indiquant les colonnes qui ont été modifiées

### Suivi des différences et égalité structurelle en profondeur

Pour éviter d'enregistrer des journaux redondants lorsque des champs sont enregistrés sans changement de valeur, le `HistoryService` effectue une comparaison d'égalité structurelle en profondeur (deep equality) sur les clés de premier niveau des anciennes et nouvelles valeurs :
- Il ignore les propriétés de métadonnées système commençant par `__`.
- Si des différences sont constatées, les noms des propriétés modifiées sont enregistrés dans la colonne `changed_fields` (`text[]`).
- Si la vérification d'égalité en profondeur ne détecte aucun changement, l'insertion dans l'historique est complètement ignorée.

### Purge non bloquante après sauvegarde

Contrairement aux systèmes traditionnels qui s'appuient entièrement sur des scripts batch périodiques lents, Rebase applique vos politiques de rétention en continu :
- Juste après l'enregistrement ou la suppression d'une entité, le serveur planifie un **balayage asynchrone en ligne** via une promesse non bloquante sans attente de retour (*fire-and-forget*).
- Ce balayage vérifie immédiatement les limites de rétention pour cet identifiant d'entité spécifique et purge les entrées au-delà des 200 plus récentes ou antérieures à la période de rétention.

## Point de terminaison REST

```
GET /api/data/:slug/:entityId/history
```

Renvoie une liste d'entrées d'historique pour une entité spécifique, triées de la plus récente à la plus ancienne :

```json
{
    "data": [
        {
            "id": "5b0e7c2e-…",
            "table_name": "orders",
            "entity_id": "123",
            "action": "update",
            "changed_fields": ["status"],
            "values": { "status": "shipped", "total": 99.99 },
            "previous_values": { "status": "pending", "total": 99.99 },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z"
        }
    ],
    "meta": { "total": 1, "limit": 20, "offset": 0, "hasMore": false }
}
```

## Configuration de la rétention

| Paramètre | Par défaut | Description |
|-----------|------------|-------------|
| `retention` | 90 | Les entrées plus anciennes que ce nombre de jours sont supprimées. |

Chaque entité conserve également au maximum ses **200** entrées les plus récentes. Ce plafond est fixe ; il n'y a pas de paramètre pour le modifier.

### Mécanismes du cycle de vie de la purge

La purge s'effectue uniquement en ligne. Elle s'exécute de manière asynchrone immédiatement après chaque modification enregistrée, pour l'entité concernée : les entrées plus anciennes que la période de rétention sont supprimées, puis tout ce qui dépasse les 200 plus récentes. Il n'y a pas de balayage périodique, l'historique d'une entité qui n'est plus jamais modifiée n'est donc pas purgé — ses anciennes entrées restent jusqu'à la prochaine modification de cette entité, ou jusqu'à ce que vous les supprimiez vous-même de `rebase.entity_history`.

## Prochaines étapes

- **[Callbacks d'entité](/docs/collections/callbacks)** — Hooks de cycle de vie
- **[Vue d'ensemble du backend](/docs/backend)** — Configuration complète du backend
