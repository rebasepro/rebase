---
sourceHash: 1090d0be0be163a6
title: Tables
sidebar_label: Tables
description: "Déclarez des tables Postgres dans backend/schema avec defineTable : colonnes, relations et posture obligatoire de sécurité au niveau des lignes (row-level security). Chaque table génère du SQL, des politiques, des routes REST, temps réel et MCP, ainsi que des types SDK."
---

Une table est déclarée une seule fois, en TypeScript, dans le répertoire `backend/schema/`.
Cette déclaration est la seule chose que le backend sait à propos de vos données.
À partir d'elle, Rebase génère la table et ses politiques de sécurité au niveau des lignes dans Postgres,
sert la table via REST, temps réel et MCP, et type le SDK.

```ts
// backend/schema/posts.ts
import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull().validate({ min: 3, max: 200 }),
        status:      col.enum(["draft", "published", "archived"]).notNull().default("draft"),
        publishDate: col.timestamp({ withTimezone: true }),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true }),
    },
    rls: [
        { operation: "select", access: "public", condition: { status: "published" } },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        { operation: "delete", roles: ["admin"] },
    ],
});
```

Trois points méritent d'être soulignés à partir de cet exemple avant toute chose :

- **Les colonnes acceptent les valeurs nulles (nullable) par défaut, sauf indication contraire**, comme en SQL. `.notNull()`
  rend une colonne `NOT NULL` et obligatoire lors de la création. Voir [Colonnes](/docs/schema/columns/).
- **La clé étrangère est déclarée par la relation.** `author` dérive une
  colonne `author_id`, sa contrainte et son index. Voir
  [Relations](/docs/collections/relations/).
- **`rls` est obligatoire.** Une table sans posture de sécurité au niveau des lignes constitue
  une erreur de type et est refusée lors de la compilation du schéma. Voir
  [Sécurité au niveau des lignes](/docs/collections/security-rules/).

:::note[Vous venez des collections ?]
Les tables remplacent les fichiers `config/collections` des versions précédentes. Le CMS
lit ses valeurs par défaut à partir des tables ; ses propres personnalisations résident dans le
frontend. Le guide de mise à niveau de cette version détaille cette migration.
:::

## Le répertoire `backend/schema`

```text
backend/
├── schema/
│   ├── index.ts      # exports every table and view, and optionally defaultRls
│   ├── users.ts      # defineAuthTable("users", …)
│   ├── posts.ts      # defineTable("posts", …)
│   └── tags.ts       # defineTable("tags", …)
├── functions/
└── crons/
```

Un fichier par table est une convention, pas une règle. Ce qui
compte, c'est `backend/schema/index.ts` : le backend lit les tables et les vues qu'il exporte,
et rien d'autre.

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { users } from "./users";
export { posts } from "./posts";
export { tags } from "./tags";

// What every table declared with `rls: "inherit"` takes.
export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
];
```

`defaultRls` est facultatif. Il n'est lu que par les tables qui indiquent
`rls: "inherit"` ; un projet qui n'utilise jamais `"inherit"` n'en a pas besoin.

Le répertoire est `backend/schema`, sauf si `rebase.json` en désigne un autre via
la clé `tables`. La clé `schema` conserve son ancienne signification : le module Drizzle
généré.

```json
{
    "apps": {
        "backend": {
            "type": "backend",
            "runtime": "managed",
            "tables": "backend/schema"
        }
    }
}
```

Un projet sans `backend/schema/index.ts` ne déclare aucune table. Le backend
lit alors les tables directement depuis la base de données active au démarrage, et ne sert que celles
pour lesquelles la sécurité au niveau des lignes est activée. Voir [Backend uniquement](/docs/getting-started/headless/).

Les fichiers de schéma sont du TypeScript pur sans dépendances serveur :
`@rebasepro/server/schema` ne charge rien du serveur. Un frontend peut exécuter
`import type { posts } from "../../backend/schema/posts"` pour typer son propre code
par rapport à une table, sans injecter de code backend dans le bundle du navigateur.

## Ce que devient une table

| De la déclaration | Rebase génère |
|---|---|
| `columns`, `relations`, `indexes` | le `CREATE TABLE`, les clés étrangères, les tables de jonction et les index, écrits dans `schema.sql` par `rebase db push` et `rebase db generate` |
| `rls`, `tenant`, la table d'authentification | `ENABLE ROW LEVEL SECURITY` et un `CREATE POLICY` par règle et opération, dans `policies.sql` |
| `search`, colonnes vectorielles | la colonne `tsvector` générée et les index GIN et ANN |
| le slug | les routes REST sous `/api/data/<slug>`, les abonnements en temps réel, les outils MCP et le document OpenAPI |
| les types et modificateurs des colonnes | les types `Row`, `Insert` et `Update` du SDK, ainsi que les [types inférés](/docs/schema/types/) utilisables dans votre propre code |

Chaque surface lit la même forme compilée de la table, appelée son
descripteur : les colonnes avec leurs types Postgres, la nullabilité, les règles de validation et
de stockage, les relations résolues en slugs, et la posture de sécurité
au niveau des lignes. Le code des hooks ne quitte jamais le serveur ; le descripteur indique uniquement
quels hooks existent. Le backend sert les descripteurs sur `GET /api/schema/tables`,
ce à partir de quoi le CMS, le Studio et les applications MCP effectuent le rendu.

Le pipeline allant de la déclaration à la base de données est décrit dans
[Schema as code](/docs/architecture/schema-as-code/).

## Options de `defineTable`

`defineTable(name, config)` prend le nom de la table et ces clés :

| Clé | Description |
|---|---|
| `columns` | **Obligatoire.** Constructeurs `col.*` par clé, dans l'ordre physique. Au moins un doit être `.primaryKey()`. Voir [Colonnes](/docs/schema/columns/). |
| `rls` | **Obligatoire.** `"admin-only"`, `"inherit"` ou une liste non vide de règles. Voir [Sécurité au niveau des lignes](/docs/collections/security-rules/). |
| `relations` | Constructeurs `rel.*` par nom de relation. Voir [Relations](/docs/collections/relations/). |
| `slug` | Le nom dans l'API, le SDK et les portées (scopes). Le nom de la table s'il est omis. |
| `table` | Le nom de la table SQL, lorsqu'il diffère du nom. |
| `schema` | Le schéma Postgres. `public` s'il est omis. |
| `database` | Une base de données Postgres non définie par défaut, déclarée dans `backend/resources.ts`. Voir [Sources multiples](/docs/backend/multiple-sources/). |
| `description` | Ce que contient la table. Affiché dans OpenAPI et dans les descriptions des outils MCP. |
| `defaultPolicies` | `false` génère uniquement vos règles, sans les politiques d'administration de référence. Refusé avec `rls: "admin-only"`. `true` conserve la référence lorsque la base de données de la table la désactive pour toutes les tables (`database({ rls: { defaultPolicies: false } })`). En son absence, le paramètre de la base de données s'applique. |
| `rlsRequired` | `false` sert la table même lorsque la base de données n'applique pas son `rls` (sécurité au niveau des lignes désactivée, politiques déclarées manquantes), pour un schéma géré par un autre outil et une application qui applique elle-même le contrôle d'accès. `true` l'exige avec une base de données configurée avec `database({ rls: { required: false } })`. En son absence, le paramètre de la base de données s'applique, et une table non protégée par la base de données n'est pas servie par un démarrage qui ne provisionne rien. Voir [Un autre outil gère le schéma](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access). |
| `tenant` | Limite chaque ligne à un tenant. Voir [Multi-tenant](/docs/collections/tenancy/). |
| `softDelete` | `true` ou `{ field }` : une suppression appose un horodatage au lieu de supprimer la ligne. Voir [Suppression réversible (Soft delete)](/docs/collections/soft-delete/). |
| `history` | `true` enregistre chaque écriture dans la table d'historique. Voir [Historique des entités](/docs/backend/history/). |
| `search` | Recherche plein texte pondérée sur les colonnes indiquées. Voir [Recherche](/docs/backend/search/). |
| `indexes` | Index, chacun avec la requête qu'il dessert. Voir [Index](/docs/backend/indexes/). |
| `hooks` | Hooks de cycle de vie côté serveur. Voir [Hooks de table](/docs/collections/callbacks/). |
| `strictWrites` | Une écriture nommant une colonne non déclarée par la table renvoie une erreur 400. `false` l'accepte, pour une colonne existant dans la base de données sans être déclarée (remplie par un déclencheur, par exemple). La colonne doit néanmoins exister. |
| `metadata` | Toutes données que vous souhaitez servir avec le descripteur de la table. Rebase ne les lit pas. |

Deux autres définitions partagent la plupart de ces clés :
[`defineAuthTable`](/docs/schema/auth-table/) pour la table dans laquelle les utilisateurs sont stockés,
et [`defineView`](/docs/collections/views/) pour les vues SQL.

## Noms

Le premier argument de `defineTable` est le nom de la table, et il sert de valeur par défaut
pour tout le reste :

| Nom | Valeur par défaut | Surcharge |
|---|---|---|
| Table SQL | le nom | `table: "blog_posts"` |
| Slug d'API, accesseur SDK, cible de portée | le nom | `slug: "articles"` |
| Schéma Postgres | `public` | `schema: "content"` |
| Colonne SQL d'une colonne | le snake_case de sa clé | le premier argument du constructeur : `col.text("legacy_name")` |

La clé d'une colonne est son nom sur la ligne JSON, dans le SDK ainsi que dans les filtres
et les tris. Son nom SQL correspond au snake_case de la clé : `publishDate` devient la colonne
`publish_date`, et `photoURL` devient `photo_url`. Le premier argument d'un constructeur mappe
une clé à n'importe quel autre nom SQL, comme dans Drizzle (`col.text("legacy_name")`), ce qui
permet à une table d'adopter les noms d'une base de données existante sans modifier ce que
voient les clients.

`table` et `schema` doivent être de simples identifiants SQL. Deux définitions ne peuvent
pas partager un même nom, un même slug ou une même table SQL. Le slug a un impact au-delà de l'URL : les noms
des clés étrangères et des colonnes de jonction en sont dérivés, donc modifier le slug d'une
table déjà déployée peut renommer des colonnes. Définissez explicitement `slug` lorsqu'il
doit différer du nom de la table, puis ne le modifiez plus par la suite.

## Clés primaires

Il n'y a pas de colonne `id` implicite. Chaque table marque au moins une colonne
`.primaryKey()` :

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        number: col.integer().notNull().unique(),
    },
    rls: "admin-only",
});

// Several key columns form a composite key, in declaration order.
export const dailyStats = defineTable("daily_stats", {
    columns: {
        siteId: col.uuid().primaryKey(),
        day:    col.date().primaryKey(),
        views:  col.integer().notNull().default(0),
    },
    rls: "admin-only",
});
```

Une colonne clé est `NOT NULL` par définition. Une clé `uuid` prend généralement
`.defaultRandom()` ; une clé entière prend `.generatedByDefaultAsIdentity()`. Une clé sans
valeur par défaut doit être fournie par l'appelant lors de la création. Une colonne clé ne peut pas être
`.private()`, et ne peut pas être un `timestamptz` ou un `time`.

## Quand une définition est refusée

Un schéma qui laisserait une table non protégée ou impossible à servir n'atteint
jamais la base de données. Il est refusé à trois niveaux :

1. **Dans l'éditeur.** `rls` et `columns` sont exigés par les types, et
   `rls: []` n'est pas une posture valide. Un champ `tenant` ou `softDelete`, ou
   une colonne d'index écrite sous forme de clé brute, qui ne désigne aucune colonne existante génère une erreur de type.
2. **Au chargement du module.** `defineTable` lève une exception pour une table sans colonnes,
   une colonne qui n'est pas issue d'un constructeur `col.*`, une relation qui n'est pas le résultat
   d'un `rel.*`, une relation ayant la même clé qu'une colonne, ou l'absence d'une configuration `rls` utilisable. Cela
   intercepte également le code JavaScript et les casts que les types ne peuvent pas voir.
3. **À la compilation du schéma.** `rebase db generate`, `rebase db push`,
   `rebase doctor` et le démarrage du serveur compilent toutes les tables ensemble et s'arrêtent sur
   une erreur `SchemaDefinitionError` listant chaque problème, avec à chaque fois la table, la
   colonne ou la relation, ainsi que ce qu'il convient d'écrire à la place :

```text
The schema cannot be used (2 problems):
  - posts: the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order.
  - comments: `rls: "inherit"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts (`"admin-only"` or a list of rules), or write this table's own `rls`.
```

L'étape de compilation vérifie tout ce qui nécessite d'examiner l'ensemble des tables en même temps : les cibles des
relations et leurs types de clés, les tables de jonction revendiquées par deux relations, les conflits de slugs et de noms
SQL (y compris les noms entrant en conflit après troncature par Postgres à 63 octets), les règles désignant une colonne
inexistante dans la table, et `"inherit"` sans `defaultRls`. Une table exportée depuis un fichier situé à côté de
`index.ts` mais absente de `index.ts` lui-même est également refusée : l'index constitue la liste officielle des tables.

## Prochaines étapes

- [Colonnes](/docs/schema/columns/) : l'ensemble des constructeurs et modificateurs `col.*`
- [Documents JSON](/docs/schema/json/) : du `jsonb` typé et validé avec `json.*`
- [Relations](/docs/collections/relations/) : les cinq types de `rel.*`
- [Sécurité au niveau des lignes](/docs/collections/security-rules/) : la posture `rls` et ses règles
- [Hooks de table](/docs/collections/callbacks/) : hooks de cycle de vie côté serveur
- [Inférence de types](/docs/schema/types/) : `InferRow`, `InferInsert` et `InferUpdate`
