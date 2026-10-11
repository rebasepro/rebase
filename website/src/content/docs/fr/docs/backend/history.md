---
sourceHash: a62053f25d91d42c
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
2. À chaque création, mise à jour ou suppression, une entrée est enregistrée avec :
   - L'identifiant de l'entité (Entity ID) et le slug de la collection (dans `table_name`)
   - Les valeurs de l'entité après la modification (`values` ; pour une suppression, l'entité
     supprimée)
   - Lors d'une mise à jour, ce que contenaient les champs modifiés avant elle (`previous_values`)
   - L'horodatage et l'identifiant de l'utilisateur
   - L'action (`create`, `update`, `delete`)
   - Un tableau de `changed_fields` indiquant les colonnes qui ont été modifiées

Les valeurs sont la ligne telle que l'API REST la fournit : ses colonnes, les
dates en timestamps, une relation `belongsTo` sous sa clé étrangère. C'est ce
qu'un retour en arrière (revert) réécrit.

Sur une collection avec le [soft delete](/docs/collections/soft-delete/), une
suppression est enregistrée comme `delete` et une restauration (la mise à jour
qui remet le champ de soft delete à `null`) comme `update`. L'historique d'une
ligne reste lisible pendant qu'elle est dans la corbeille, et revenir à une
version antérieure à la suppression la restaure.

### Ce que contient `previous_values`

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Une entrée de mise à jour ne conserve, dans `previous_values`, que les champs listés
dans `changed_fields`. Tous les autres champs avaient la même valeur avant et après la modification, ils
figurent donc déjà dans `values` ; stocker deux fois la ligne entière coûtait 1 269 octets pour une
modification d'un seul champ sur une ligne de 20 champs, contre 794 désormais.

Les entrées enregistrées avant la 0.25 conservent la ligne précédente entière. Le `format` de
l'entrée indique laquelle des deux c'est :

| `format` | `previous_values` lors d'une mise à jour |
|---|---|
| `1` (entrées antérieures à la 0.25) | La ligne entière avant la modification |
| `2` | Uniquement les `changed_fields`, chacun tel que la ligne entière le contenait |

La vue d'historique de l'admin et un retour en arrière lisent indifféremment les deux : la vue affiche la
valeur précédente de chaque champ modifié, et un retour en arrière écrit les `values` de l'entrée choisie,
qui sont entières dans les deux formats. Pour reconstruire la ligne telle qu'elle était avant une
modification en `format: 2`, prenez `values` et remettez chaque champ que contient `previous_values`.

### Suivi des différences et égalité structurelle en profondeur

Pour éviter d'enregistrer des journaux redondants lorsque des champs sont enregistrés sans changement de valeur, le `HistoryService` effectue une comparaison d'égalité structurelle en profondeur (deep equality) sur les clés de premier niveau des anciennes et nouvelles valeurs :
- Il ignore les propriétés de métadonnées système commençant par `__`.
- Si des différences sont constatées, les noms des propriétés modifiées sont enregistrés dans la colonne `changed_fields` (`text[]`).
- Si la vérification d'égalité en profondeur ne détecte aucun changement, l'insertion dans l'historique est complètement ignorée.

### Purge

La rétention est appliquée à deux endroits :
- **Après chaque écriture**, pour l'entité écrite : juste après son enregistrement ou sa suppression,
  le serveur purge les entrées de cette entité au-delà des 200 plus récentes, ou antérieures à la
  période de rétention. Cela ne retarde pas l'écriture.
- <span class="since-badge" data-since="0.25">Depuis 0.25</span> **Une fois par heure**, pour chaque entité : les entrées antérieures à la période de
  rétention sont supprimées, quelle que soit l'entité à laquelle elles appartiennent — y compris les
  entités qui ne sont jamais réécrites, comme les entités supprimées. Voir
  [Mécanismes du cycle de vie de la purge](#mécanismes-du-cycle-de-vie-de-la-purge).

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
            "previous_values": { "status": "pending" },
            "updated_by": "admin-user-id",
            "updated_at": "2025-01-15T10:30:00Z",
            "format": 2
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

Après chaque modification enregistrée, l'entité concernée est purgée : ses entrées plus anciennes que
la période de rétention sont supprimées, puis tout ce qui dépasse ses 200 plus récentes. Cela s'exécute
de manière asynchrone et ne retarde pas l'écriture.

<span class="since-badge" data-since="0.25">Depuis 0.25</span> Une fois par heure, le backend supprime aussi toute entrée plus ancienne que la période de
rétention, pour toutes les entités. Auparavant, l'historique d'une entité qui n'était plus jamais
réécrite — toute entité supprimée — n'était pas purgé du tout. Ce balayage :

- s'exécute sur une instance de la flotte par heure, parmi les processus qui exécutent les tâches
  planifiées (il réserve son heure dans `rebase.cron_claims`, comme le fait une exécution cron), une
  première fois au démarrage du backend ;
- supprime par lots de 5 000 entrées, une instruction chacun, jusqu'à ce qu'un lot revienne incomplet,
  en ignorant les entrées qu'un autre balayage retient — de sorte qu'un premier balayage sur un gros
  arriéré représente de nombreuses suppressions courtes, et non une seule longue ;
- lit un index sur `updated_at`, `idx_history_updated_at`. Sur une base de données créée avant la 0.25,
  il est construit en arrière-plan après le premier démarrage, avec `CREATE INDEX CONCURRENTLY`, sans
  bloquer les lectures ni les écritures — environ une seconde par 2 millions d'entrées.

Le même démarrage supprime `idx_history_entity` là où il existe : `idx_history_time` commence par les
mêmes colonnes et sert toutes les lectures qu'il servait, il ne faisait donc que ralentir chaque
modification enregistrée. La suppression attend au plus une seconde à la fois le verrou de la table, et
une table que quelque chose retient en permanence conserve l'index jusqu'au démarrage suivant.

Le plafond de 200 entrées par entité n'est appliqué qu'après une écriture sur cette entité.

## Prochaines étapes

- **[Callbacks d'entité](/docs/collections/callbacks)** — Hooks de cycle de vie
- **[Vue d'ensemble du backend](/docs/backend)** — Configuration complète du backend
