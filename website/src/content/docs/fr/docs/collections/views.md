---
sourceHash: 8a72cff37e30800b
title: Vues
sidebar_label: Vues
description: "Servez une vue SQL ou une vue matérialisée en lecture seule avec defineView : des vues security_invoker régies par les tables qu'elles lisent, des vues matérialisées filtrées par rôles, rafraîchies à la demande, créées par db push."
---

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`defineView` sert une requête SQL sous la forme d'une table en lecture seule. Déclarez la requête, les colonnes qu'elle retourne, ainsi que la ou les colonnes qui identifient une ligne :

```ts
// backend/schema/artist-stats.ts
import { defineView, col } from "@rebasepro/server/schema";

export const artistStats = defineView("artist_stats", {
    query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
            FROM songs GROUP BY 1`,
    columns: {
        artist: col.text().primaryKey(),
        songs:  col.integer().notNull(),
        fame:   col.integer(),
    },
});
```

Exportez-la depuis `backend/schema/index.ts` comme une table. Elle se lit comme n'importe quelle table — `find`, `findById`, `count`, [`aggregate`](/docs/sdk/aggregates-and-search/), `listen`, les routes REST, MCP et le CMS — et elle n'est jamais modifiée : chaque écriture renvoie une erreur `405 TABLE_READ_ONLY`. Écrivez dans les tables que la vue lit.

`rebase db push` crée la vue après les tables, `rebase db generate` l'ajoute à la migration, et un démarrage géré (managed boot) la crée lors de son étape de schéma. Une vue dont la requête n'a pas changé est laissée intacte ; celle dont la requête a changé est supprimée puis recréée, en même temps que toutes vos vues qui la lisent. Rebase refuse de remplacer une table, ou une vue qu'il n'a pas créée, portant déjà ce nom.

## Options

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

| Clé | Ce qu'elle fait |
|---|---|
| `query` | **Requis.** Le `SELECT` de définition. |
| `columns` | **Requis.** Les colonnes retournées par la requête, sous forme de builders `col.*`. `.primaryKey()` marque celles qui identifient une ligne. |
| `materialized` | `true` stocke les lignes. Voir [Vues matérialisées](#vues-matérialisées). |
| `roles` | Qui peut lire une vue matérialisée. `["admin"]` si omis. Refusé sur une vue standard. |
| `table` | Le nom de la vue SQL, lorsqu'il diffère du nom par défaut. |
| `slug` | Le nom dans l'API. Le nom de la vue si omis. |
| `schema` | Le schéma Postgres. `public` si omis. |
| `database` | Une base de données Postgres non définie par défaut. |
| `description` | Ce que contient la vue, pour OpenAPI et MCP. |
| `relations` | Relations à travers lesquelles effectuer des lectures, comme sur une table. Aucune contrainte n'est créée pour une vue. |
| `indexes` | Index sur les lignes stockées d'une vue matérialisée. |
| `hooks` | `beforeQuery` et `afterRead` uniquement. Voir [Hooks de table](/docs/collections/callbacks/). |
| `metadata` | Toutes les données que vous souhaitez fournir avec le descripteur de la vue. |

Une vue possède au moins une colonne `.primaryKey()` : une vue n'a pas de clé propre, et une ligne a besoin d'une adresse.

## Qui voit quelles lignes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une vue standard est créée `WITH (security_invoker = true)`, elle s'exécute donc **avec les droits de l'appelant** : la sécurité au niveau des lignes (RLS) des tables qu'elle lit détermine ce que chaque appelant voit. Un utilisateur dont les politiques lui permettent de voir ses propres morceaux voit la vue correspondant à ses propres morceaux. C'est pourquoi une vue n'a pas de `rls` : il n'y a rien à quoi associer des politiques, et rien qu'elles ne pourraient ajouter. Voir [Sécurité au niveau des lignes](/docs/collections/security-rules/) pour les politiques sur les tables sous-jacentes.

## Vues matérialisées

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`materialized: true` stocke les lignes, ainsi une lecture n'exécute pas la requête :

```ts
import { defineView, col } from "@rebasepro/server/schema";

export const langs = defineView("langs", {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"],
    columns: {
        lang:  col.text().primaryKey(),
        songs: col.integer().notNull(),
    },
    indexes: [{ columns: ["songs"], reason: "the most-used languages first" }],
});
```

Postgres n'applique aucune sécurité au niveau des lignes sur une vue matérialisée : quiconque peut la lire lit l'intégralité de son contenu. Rebase ne la sert donc qu'aux appelants disposant de l'un des `roles` (`["admin"]` par défaut, détenu par `dataAsAdmin`) et refuse tous les autres avec une erreur `403 VIEW_NOT_READABLE`. N'y mettez rien que ses lecteurs ne soient pas autorisés à voir.

Cette règle est également appliquée dans la base de données, de sorte que le [SQL exécuté en tant qu'appelant](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller) s'y conforme aussi. Les lignes sont stockées sous `<view>_rebase_rows`, que seul le propriétaire de la base de données peut lire, et le propre nom de la vue est une vue par-dessus celles-ci qui ne renvoie des lignes qu'à un appelant disposant de l'un des `roles`, ainsi qu'au serveur lui-même (`rebase.sql()`, crons). Interrogez le nom de la vue, jamais les lignes stockées.

Les lignes reflètent l'état lors du dernier rafraîchissement. Rafraîchissez avec `refresh()` — sur le serveur via `rebase.dataAsAdmin.langs.refresh()`, ou depuis un client connecté avec l'un des rôles requis — ou par HTTP :

```typescript
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` continue de servir les anciennes lignes pendant que les nouvelles sont calculées. Cela nécessite l'index unique que Rebase crée sur les colonnes `.primaryKey()`, ces dernières doivent donc être uniques dans le résultat de la requête. Pour effectuer un rafraîchissement planifié, appelez `refresh()` depuis une [tâche cron](/docs/backend/cron-jobs/). Une vue matérialisée peut comporter ses propres `indexes` (voir [Index](/docs/backend/indexes/)), créés sur ses lignes stockées ; une vue standard lit les index de ses tables sous-jacentes.

## Ce qu'une vue ne peut pas avoir

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

`rls`, `history`, `softDelete`, `tenant` et `search` sont refusés lors de la compilation du schéma : chacun d'entre eux nécessite une table dans laquelle écrire ou à laquelle rattacher des politiques. `roles` sur une vue standard est refusé lors du chargement du module, tout comme une valeur `query` vide. `indexes` sur une vue standard est refusé lors de la compilation du schéma.

Un `listen` sur une vue est notifié lors d'un `refresh()`. Une écriture dans les tables sous-jacentes d'une vue ne parvient pas aux abonnés de la vue : abonnez-vous aux tables, ou relisez la vue.
