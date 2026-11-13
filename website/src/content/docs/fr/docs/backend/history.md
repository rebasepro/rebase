---
sourceHash: 37c268f3d4b76c7f
title: Historique des entités
sidebar_label: Historique des entités
description: Suivez chaque modification apportée à vos entités avec une piste d'audit complète — qui a modifié quoi, quand, ainsi que l'entité complète avant/après.
---

## Vue d'ensemble

L'historique des entités enregistre un instantané des valeurs de l'entité à chaque création, mise à jour et suppression. Cela vous offre une piste d'audit complète avec les diffs.

## Activer l'historique

:::note[Où placer ceci]
**Runtime géré** — activé par défaut. `REBASE_HISTORY=false` dans `.env` le désactive.

**Éjecté** — `history: true` dans `initializeRebaseBackend({ … })`. La forme objet ci-dessous — `{ retention }` — est réservée au mode éjecté ; la variable d'environnement est un booléen.

La cartographie complète se trouve dans [Vue d'ensemble du backend](/docs/backend/#where-each-option-lives).
:::

### Backend

:::note[Où placer ceci]
**Runtime géré :** `REBASE_HISTORY` (`true` par défaut ; définissez sur `false` pour le désactiver). Les paramètres de rétention n'ont pas de forme d'environnement — éjectez pour les modifier.
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
    retention: 30        // Jours. Les entrées plus anciennes sont purgées (par défaut : 90)
}
```

### Par table

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Indiquez les tables qui suivent l'historique avec `history: true` :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["open", "paid", "shipped"]).notNull().default("open"),
        total:  col.numeric({ precision: 10, scale: 2 }).notNull(),
    },
    history: true,
    rls: "admin-only",
});
```

Une vue ne peut pas suivre l'historique : elle n'est jamais écrite.

## Fonctionnement

1. Le backend crée automatiquement une table `rebase.entity_history`.
2. À chaque création, mise à jour ou suppression, une entrée est enregistrée avec :
   - L'ID de l'entité et le slug de la table (dans `table_name`)
   - Les valeurs de l'entité après la modification (`values` ; pour une suppression, l'entité
     qui a été supprimée)
   - Lors d'une mise à jour, ce que contenaient les champs modifiés avant celle-ci (`previous_values`)
   - L'horodatage et l'ID de l'utilisateur
   - L'action (`create`, `update`, `delete`)
   - Un tableau `changed_fields` indiquant quelles colonnes ont été modifiées

Les valeurs correspondent à la ligne telle que l'API REST la renvoie : ses colonnes, les dates sous
forme d'horodatages, un `belongsTo` sous forme de sa clé étrangère. C'est ce qu'un rétablissement (revert) réécrit.

Une entrée ne contient jamais les valeurs d'une ligne liée. La lecture de l'historique d'une ligne nécessite uniquement
un accès en lecture à cette ligne, et non aux lignes vers lesquelles elle pointe ; ainsi, un `belongsTo` est conservé
sous forme de sa clé étrangère, rien de plus.

Les entrées que les versions antérieures enregistraient via la vue de la ligne dans le panneau d'administration
(une suppression le stockait ainsi) sont renvoyées, et rétablies, comme la ligne qu'elles représentent :
une enveloppe `{ "__type": "date", "value" }` comme valeur, une référence
`{ "__type": "relation" }` d'une relation propriétaire comme clé étrangère sous
le nom propre de la clé, toute autre référence de relation comme clé de la ligne liée, et une
ligne liée intégrée par la référence n'est jamais renvoyée. Le rétablissement d'une telle entrée écrit
ces valeurs simples ; une liste « to-many » qu'elle contient n'est pas écrite et est listée dans
`dropped_fields`.

Sur une table avec [suppression réversible (soft delete)](/docs/collections/soft-delete/), une suppression est
enregistrée en tant que `delete` et une restauration (la mise à jour qui réinitialise le champ de soft delete
à `null`) en tant qu'`update`. L'historique d'une ligne reste lisible tant que la ligne est dans
la corbeille, et la rétablir à une version antérieure à la suppression la restaure.

### Ce que contient `previous_values`

Une entrée de mise à jour ne conserve,
dans `previous_values`, que les champs listés dans `changed_fields`. Tous les
autres champs contenaient la même valeur avant et après la modification, ils sont donc
déjà présents dans `values` ; stocker la ligne entière deux fois coûtait 1 269 octets pour une
modification d'un seul champ sur une ligne de 20 champs, contre 794 aujourd'hui.

Les entrées enregistrées avant la version 0.25 conservent l'intégralité de la ligne précédente. Le champ `format`
de l'entrée indique de quel format il s'agit :

| `format` | `previous_values` lors d'une mise à jour |
|---|---|
| `1` (entrées antérieures à 0.25) | La ligne entière avant la modification |
| `2` | Les `changed_fields` uniquement, chacun tel qu'il figurait dans la ligne entière |

La vue d'historique de l'administration et un rétablissement lisent les deux de la même manière : la vue affiche la
valeur précédente de chaque champ modifié, et un rétablissement écrit les `values` de l'entrée choisie,
qui sont complètes dans les deux formats. Pour reconstruire la ligne telle qu'elle était avant une
modification en `format: 2`, prenez `values` et replacez-y chaque champ contenu dans `previous_values`.

### Suivi des diffs et égalité structurelle en profondeur

Pour éviter d'enregistrer des logs redondants lorsque des champs sont sauvegardés sans qu'aucune valeur ne change, le `HistoryService` effectue une comparaison d'égalité structurelle en profondeur sur les clés de premier niveau des anciennes et nouvelles valeurs :
- Il ignore les champs de métadonnées système commençant par `__`.
- Si des différences sont trouvées, les noms des champs modifiés sont enregistrés dans la colonne `changed_fields` (`text[]`).
- Si la vérification d'égalité en profondeur ne détecte aucun changement, l'insertion dans l'historique est entièrement ignorée.

### Purge

La rétention est appliquée à deux endroits :
- **Après chaque écriture**, pour l'entité écrite : juste après son enregistrement ou sa
  suppression, le serveur purge les entrées de cette entité au-delà des 200 plus récentes ou
  antérieures à la période de rétention. Cela ne bloque pas l'écriture.
- **Une fois par heure**,
  pour toutes les entités : les entrées antérieures à la période de rétention sont supprimées
  quelle que soit leur appartenance — y compris pour les entités qui ne sont plus jamais écrites,
  comme celles qui ont été supprimées. Voir [Mécanique du cycle de purge](#mécanique-du-cycle-de-purge-pruning-lifecycle-mechanics).

## Point de terminaison REST

```
GET /api/data/:slug/:entityId/history
```

Renvoie une liste d'entrées d'historique pour une entité spécifique, triées de la plus récente à la plus ancienne. <span class="since-badge" data-since="0.31">Depuis 0.31</span> Les entrées enregistrées par une même transaction — une création et la mise à jour consécutive dans un même `_batch`, un rétablissement et son propre rétablissement — sont retournées dans l'ordre où elles ont été écrites : le `updated_at` de chaque entrée est postérieur à celui de l'entrée précédente de la ligne. Une base de données existante bénéficie de ce comportement lors de son prochain démarrage de provisionnement, ou lors d'une exécution de `REBASE_PROVISION_ONLY=true`, qui remplace la fonction `rebase.record_history` ; un déploiement qui ne provisionne jamais conserve l'ancien ordre jusque-là. Les entrées enregistrées avant cela conservent leur ordre.

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

### Les entrées sont servies comme des lectures

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les entrées d'historique sont servies de la même manière que la ligne : contrôle d'accès aux champs d'abord,
puis `afterRead` (global, table, colonne), au sein de la transaction en lecture seule de l'appelant. Une colonne
masquée par un hook ou un `.transform({ afterRead })` est masquée dans `values` et `previous_values` ; une colonne
que les rôles de l'appelant ne peuvent pas lire est retenue et omise de `changed_fields` ; les clés des colonnes
que la table ne possède plus sont retenues. Quiconque peut lire la ligne actuellement peut voir son historique,
et `updated_by` est conservé. Un hook qui lève une exception sur un ancien instantané fait échouer la requête
plutôt que de la servir non masquée, et l'historique d'une ligne définitivement supprimée renvoie
une erreur 404 (« No row with id '…' in table '…' »).

Le pilote Postgres gère cela ; un pilote personnalisé dessert l'historique en implémentant
`DataDriver.serveStoredRows(path, rows)`, et sans cela les routes d'historique renvoient un code 501.
Avant la version 0.31, les entrées étaient servies telles qu'elles étaient stockées.

```
POST /api/data/:slug/:entityId/history/:historyId/revert
```

Réécrit les `values` de l'entrée dans la ligne via le chemin d'enregistrement normal, de sorte que le
rétablissement soit lui-même enregistré en tant qu'`update`. Il renvoie la ligne enregistrée sous `data`
et `meta.reverted_from`, l'id de l'entrée. Un rétablissement n'écrit jamais une colonne que l'appelant
ne peut pas lire : celles-ci conservent leur valeur actuelle.

Les entrées écrites par des versions antérieures peuvent contenir des clés pour lesquelles la ligne n'a aucune colonne :
un champ calculé par un `afterRead` (avant la version 0.24, un enregistrement stockait la ligne telle qu'`afterRead`
la présentait), ou une relation stockée selon sa vue dans le panneau d'administration.
Un rétablissement écrit les colonnes de la ligne et omet ces clés, une relation propriétaire étant réinjectée
sous forme de sa clé étrangère, et liste les éléments omis dans `meta.dropped_fields`. Une valeur masquée par
un ancien `afterRead` (`********`) possédant une colonne, elle est réécrite telle qu'elle avait été enregistrée.

## Configuration de la rétention

| Paramètre | Par défaut | Description |
|-----------|------------|-------------|
| `retention` | 90 | Les entrées plus anciennes que ce nombre de jours sont supprimées. |

Chaque entité conserve également au maximum ses **200** entrées les plus récentes. Ce plafond est fixe ; il
n'est associé à aucun paramètre.

### Mécanique du cycle de purge {#pruning-lifecycle-mechanics}

Après chaque modification enregistrée par le serveur, l'entité modifiée est purgée : ses
entrées antérieures à la période de rétention sont supprimées, puis tout ce qui dépasse ses 200
plus récentes. Ce processus s'exécute de manière asynchrone et ne bloque pas l'écriture.

Une écriture effectuée via [`openRebase` ou `rebase console`](/docs/backend/scripts/)
enregistre son entrée d'historique mais ne purge rien, car un script ne peut pas connaître
la rétention configurée sur votre serveur. Le serveur purgera cette entité lors de sa
prochaine écriture, ainsi que lors du balayage horaire ci-dessous.

Une fois par heure, le
backend supprime également toutes les entrées antérieures à la période de rétention, pour
chaque entité. Auparavant, l'historique d'une entité qui n'était plus jamais modifiée — notamment
toutes celles qui étaient supprimées — n'était pas purgé du tout. Ce balayage :

- s'exécute sur une seule instance de la flotte par heure, sur les processus qui exécutent
  les tâches planifiées (il revendique son créneau horaire dans `rebase.cron_claims`, comme le
  fait une exécution cron), d'abord au démarrage du backend ;
- supprime par lots de 5 000 entrées, une instruction chacune, jusqu'à ce qu'un lot renvoie
  moins d'éléments, en ignorant les entrées verrouillées par un autre balayage — ainsi, un premier balayage
  sur un important arriéré effectue de nombreuses suppressions courtes, plutôt qu'une seule longue ;
- lit un index sur `updated_at`, `idx_history_updated_at`. Sur une base de données
  créée avant la version 0.25, il est construit en arrière-plan après le premier démarrage,
  via `CREATE INDEX CONCURRENTLY`, sans bloquer les lectures ni les écritures — environ une
  seconde pour 2 millions d'entrées.

Ce même démarrage supprime `idx_history_entity` s'il existe : `idx_history_time`
commence par les mêmes colonnes et prend en charge toutes les lectures que l'autre effectuait,
il ne faisait donc que ralentir chaque modification enregistrée. La suppression attend au maximum une
seconde à la fois le verrou de la table, et une table verrouillée en continu conserve l'index jusqu'au prochain démarrage.

Le plafond de 200 entrées par entité n'est appliqué qu'après une écriture sur cette entité.

## Prochaines étapes

- **[Hooks de table](/docs/collections/callbacks/)** — Hooks de cycle de vie
- **[Vue d'ensemble du backend](/docs/backend)** — Configuration complète du backend
