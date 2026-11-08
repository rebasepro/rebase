---
sourceHash: 040afb7b119d3d2a
title: Vues
sidebar_label: Vues
description: Servez une vue SQL ou une vue matérialisée comme collection en lecture seule, déclarée dans la configuration et créée par db push.
---

## Une collection au-dessus d'une requête

Une collection peut servir une vue SQL au lieu d'une table. Déclarez la requête sous
`view`, décrivez ses colonnes comme des propriétés, et marquez celle qui identifie une
ligne avec `isId` — une vue n'a pas de clé primaire propre :

```ts
import { defineCollection } from "@rebasepro/cms-types";

export default defineCollection({
    slug: "artists",
    name: "Artists",
    table: "artist_stats",
    view: {
        query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
                FROM songs GROUP BY 1`
    },
    properties: {
        artist: { name: "Artist", type: "string", isId: true },
        songs: { name: "Songs", type: "number" },
        fame: { name: "Fame", type: "number" }
    }
});
```

Elle se lit comme n'importe quelle autre collection — `find`, `findById`, `count`,
[`aggregate`](/docs/sdk/aggregates-and-search/),
`listen`, les routes REST, MCP et le panneau d'administration — et elle est en lecture seule : chaque
écriture renvoie une erreur `405 COLLECTION_READ_ONLY`, et l'administration n'offre ni création, ni modification, ni
suppression. Écrivez dans les tables que la vue lit.

`rebase db push` crée la vue après les tables (elle est appliquée par Rebase,
et non par Atlas), `rebase db generate` l'ajoute à la migration, et un démarrage
géré la crée lors de son étape de schéma. Une vue dont la requête n'a pas changé est laissée
telle quelle ; une vue dont la requête a changé est supprimée puis recréée, avec toutes
vos vues qui la lisent. Rebase refuse de remplacer une table, ou une vue qu'il n'a
pas créée, qui porte déjà ce nom.

## Qui voit quelles lignes

Une vue simple s'exécute **en tant qu'appelant** (`security_invoker`), de sorte que les politiques des
tables qu'elle lit déterminent ce que voit chaque appelant : un utilisateur dont les politiques lui
montrent ses propres chansons voit la vue de ses propres chansons. C'est pourquoi
`securityRules` ne peut pas être déclaré sur une vue — il n'y a rien à quoi les rattacher,
et rien qu'elles pourraient ajouter. Voir [Règles de sécurité](/docs/collections/security-rules/) pour
les politiques des tables sous-jacentes.

## Vues matérialisées

`materialized: true` stocke les lignes, de sorte qu'une lecture n'exécute pas la requête :

```ts
view: {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"]
}
```

Postgres n'applique aucune sécurité au niveau des lignes à une vue matérialisée : quiconque peut la lire
la lit en entier. Rebase ne la sert donc qu'aux appelants détenant l'un des `roles`
(`["admin"]` s'il est omis, rôle que détient `dataAsAdmin`) et refuse tous les autres
avec `403 VIEW_NOT_READABLE`. N'y mettez rien que ses lecteurs ne doivent pas voir.

Les lignes correspondent au dernier rafraîchissement. Rafraîchissez avec `refresh()` — côté serveur
via `rebase.dataAsAdmin.langs.refresh()`, ou depuis un client connecté avec l'un des
rôles — ou via HTTP :

```ts
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` continue de servir les anciennes lignes pendant que les nouvelles sont calculées ; il
requiert l'index unique que Rebase crée sur les colonnes `isId`, qui doivent donc être
uniques dans le résultat de la requête. Pour rafraîchir selon un calendrier, appelez `refresh()` depuis une
[tâche cron](/docs/backend/cron-jobs/). Une vue matérialisée peut porter ses propres `indexes`
(voir [Index](/docs/backend/indexes/)) ; une vue simple lit les
index de ses tables.

## Ce qu'une vue ne peut pas avoir

`securityRules`, `history`, `softDelete`, `tenant` et `search` sont refusés au
démarrage, car chacun a besoin d'une table dans laquelle écrire ou à laquelle se rattacher.

Un `listen` sur une vue est informé d'un `refresh()`. Une écriture dans les tables sous-jacentes
d'une vue n'atteint pas les abonnés de la vue : abonnez-vous aux tables, ou
relisez la vue.
