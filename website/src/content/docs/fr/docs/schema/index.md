---
sourceHash: ef21a3aa33310095
title: Tables
sidebar_label: Tables
description: "Déclarez des tables Postgres dans backend/schema avec defineTable : colonnes, relations et posture de sécurité au niveau des lignes obligatoire. Chaque table devient du SQL, des politiques, des routes REST, temps réel et MCP, ainsi que des types SDK."
---

Une table est déclarée une seule fois, en TypeScript, dans le répertoire `backend/schema/`.
Cette déclaration est la seule chose que le backend sait de vos données. À partir d'elle,
Rebase génère la table et ses politiques de sécurité au niveau des lignes (RLS) dans Postgres,
expose la table via REST, temps réel et MCP, et type le SDK.

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

- **Les colonnes acceptent les valeurs nulles par défaut**, comme en SQL. `.notNull()`
  rend une colonne `NOT NULL` et obligatoire lors de la création. Voir [Colonnes](/docs/schema/columns/).
- **La clé étrangère est déclarée par la relation.** `author` génère une
  colonne `author_id`, sa contrainte et son index. Voir
  [Relations](/docs/collections/relations/).
- **`rls` est obligatoire.** Une table sans posture de sécurité au niveau des lignes provoque une
  erreur de type et est rejetée lors de la compilation du schéma. Voir
  [Sécurité au niveau des lignes](/docs/collections/security-rules/).

:::note[Vous venez des collections ?]
Les tables remplacent les fichiers `config/collections` des versions précédentes. Le CMS
lit ses valeurs par défaut à partir des tables ; ses propres personnalisations résident dans le
frontend. Le guide de mise à niveau de cette version couvre cette migration.
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

Avoir un fichier par table est une convention, pas une règle. Ce qui compte, c'est
`backend/schema/index.ts` : le backend lit les tables et les vues qu'il exporte,
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

`defaultRls` est optionnel. Il n'est lu que par les tables qui indiquent
`rls: "inherit"` ; un projet qui n'écrit jamais `"inherit"` n'en a pas besoin.

Le répertoire est `backend/schema`, sauf si `rebase.json` en désigne un autre via
la clé `tables`. La clé `schema` conserve son ancienne signification : le module
Drizzle généré.

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
lit alors les tables depuis la base de données active au démarrage et ne sert que
celles dont la sécurité au niveau des lignes est activée. Voir [Backend uniquement](/docs/getting-started/headless/).

Les fichiers de schéma sont du TypeScript pur sans dépendances serveur :
`@rebasepro/server/schema` ne charge rien du serveur. Un frontend peut faire
`import type { posts } from "../../backend/schema/posts"` pour typer son propre code
par rapport à une table, sans intégrer de code backend dans le bundle du navigateur.

## Ce que devient une table

| À partir de la déclaration | Rebase génère |
|---|---|
| `columns`, `relations`, `indexes` | le `CREATE TABLE`, les clés étrangères, les tables de jonction et les index, écrits dans `schema.sql` par `rebase db push` et `rebase db generate` |
| `rls`, `tenant`, la table d'authentification | `ENABLE ROW LEVEL SECURITY` et un `CREATE POLICY` par règle et opération, dans `policies.sql` |
| `search`, colonnes vectorielles | la colonne générée `tsvector` ainsi que les index GIN et ANN |
| le slug | les routes REST sous `/api/data/<slug>`, les abonnements en temps réel, les outils MCP et le document OpenAPI |
| les types et modificateurs des colonnes | les types `Row`, `Insert` et `Update` du SDK, ainsi que les [types inférés](/docs/schema/types/) que vous pouvez utiliser dans votre propre code |

Chaque surface lit la même forme compilée de la table, appelée son
descripteur : les colonnes avec leurs types Postgres, la nullabilité, les règles de validation
et de stockage, les relations résolues en slugs, et la posture de sécurité au niveau des lignes.
Le code des hooks ne quitte jamais le serveur ; le descripteur indique uniquement quels
hooks existent. Le backend sert les descripteurs à l'adresse `GET /api/schema/tables`,
qui est ce à partir de quoi le CMS, le Studio et les applications MCP effectuent leur rendu.

Le pipeline allant de la déclaration à la base de données est décrit dans
[Schéma en tant que code](/docs/architecture/schema-as-code/).

## Options de `defineTable`

`defineTable(name, config)` prend le nom de la table et ces clés :

| Clé | Description |
|---|---|
| `columns` | **Obligatoire.** Les builders `col.*` par clé, dans l'ordre physique. Au moins un doit être `.primaryKey()`. Voir [Colonnes](/docs/schema/columns/). |
| `rls` | **Obligatoire.** `"admin-only"`, `"external"` (Postgres applique la RLS avec des politiques gérées en dehors de Rebase), `"unmanaged"` (pas de RLS Postgres ; l'application gère elle-même l'accès), `"inherit"`, ou une liste non vide de règles. Voir [Sécurité au niveau des lignes](/docs/collections/security-rules/). |
| `relations` | Les builders `rel.*` par nom de relation. Voir [Relations](/docs/collections/relations/). |
| `slug` | Le nom dans l'API, le SDK et dans les scopes. Le nom de la table lorsqu'il est omis. |
| `table` | Le nom de la table SQL, lorsqu'il diffère du nom par défaut. |
| `schema` | Le schéma Postgres. `public` lorsqu'il est omis. |
| `database` | Une base de données Postgres non définie par défaut, déclarée dans `backend/resources.ts`. Voir [Sources multiples](/docs/backend/multiple-sources/). |
| `description` | Ce que la table contient. Affiché dans OpenAPI et dans les descriptions des outils MCP. |
| `defaultPolicies` | `false` génère uniquement vos règles, sans les politiques d'administration de référence. Refusé avec `rls: "admin-only"`. `true` conserve la référence lorsque la base de données de la table la désactive pour toutes les tables (`database({ rls: { defaultPolicies: false } })`). Si omis, le paramètre de la base de données s'applique. |
| `rlsRequired` | `false` sert la table même lorsque la base de données n'applique pas sa `rls` (sécurité au niveau des lignes désactivée, politiques déclarées manquantes), pour un schéma appartenant à un autre outil et une application qui gère elle-même l'accès. `true` l'exige sous une base de données qui spécifie `database({ rls: { required: false } })`. Si omis, le paramètre de la base de données s'applique, et une table que la base de données ne protège pas n'est pas servie par un démarrage qui ne provisionne rien. Voir [Un autre outil possède le schéma](/docs/deployment/existing-database/#another-tool-owns-the-schema-and-the-app-enforces-access). |
| `tenant` | Associe chaque ligne à un tenant. Voir [Multi-tenant](/docs/collections/tenancy/). |
| `softDelete` | `true` ou `{ field }` : une suppression applique un horodatage au lieu de supprimer la ligne. Voir [Suppression réversible](/docs/collections/soft-delete/). |
| `history` | `true` enregistre chaque écriture dans la table d'historique. Voir [Historique des entités](/docs/backend/history/). |
| `search` | Recherche textuelle intégrale pondérée sur les colonnes désignées. Voir [Recherche](/docs/backend/search/). |
| `indexes` | Index, chacun avec la requête qu'il optimise. Voir [Index](/docs/backend/indexes/). |
| `hooks` | Hooks de cycle de vie côté serveur. Voir [Hooks de table](/docs/collections/callbacks/). |
| `strictWrites` | Une écriture nommant une colonne que la table ne déclare pas renvoie une 400. `false` l'accepte, pour une colonne qui existe dans la base de données sans être déclarée (remplie par un trigger, par exemple). La colonne doit néanmoins exister. |
| `metadata` | Toutes les données que vous souhaitez servir avec le descripteur de la table. Rebase ne les lit pas. |

Deux autres définitions partagent la plupart de ces clés :
[`defineAuthTable`](/docs/schema/auth-table/) pour la table dans laquelle les utilisateurs sont stockés,
et [`defineView`](/docs/collections/views/) pour les vues SQL.

## Noms

Le premier argument de `defineTable` est le nom de la table, et il s'agit de la valeur par défaut
pour tout le reste :

| Nom | Valeur par défaut | Remplacement |
|---|---|---|
| Table SQL | le nom | `table: "blog_posts"` |
| Slug API, accesseur SDK, cible de scope | le nom | `slug: "articles"` |
| Schéma Postgres | `public` | `schema: "content"` |
| Colonne SQL d'une colonne | le snake_case de sa clé | le premier argument du builder : `col.text("legacy_name")` |

La clé d'une colonne est son nom sur la ligne JSON, dans le SDK ainsi que dans les filtres et
les tris. Son nom SQL est le snake_case de la clé : `publishDate` correspond à la colonne
`publish_date`, et `photoURL` est `photo_url`. Le premier argument d'un builder fait correspondre
une clé à n'importe quel autre nom SQL, comme dans Drizzle (`col.text("legacy_name")`), ce qui
permet à une table d'adopter les noms d'une base de données existante sans modifier ce que
les clients voient.

`table` et `schema` doivent être de simples identifiants SQL. Deux définitions ne peuvent pas
partager un nom, un slug ou une table SQL. Le slug est important au-delà de l'URL : les noms
des clés étrangères et des colonnes de jonction en sont dérivés, donc modifier le slug d'une
table déjà déployée peut renommer des colonnes. Définissez `slug` explicitement lorsqu'il
doit différer du nom de la table, et n'y touchez plus ensuite.

## Clés primaires

Il n'y a pas de colonne `id` implicite. Chaque table marque au moins une colonne
avec `.primaryKey()` :

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

Une colonne de clé est `NOT NULL` par définition. Une clé `uuid` prend généralement
`.defaultRandom()` ; une clé entière prend `.generatedByDefaultAsIdentity()`. Une clé sans
valeur par défaut est fournie par l'appelant lors de la création. Une colonne de clé ne peut pas être
`.private()`, et ne peut pas être un `timestamptz` ou un `time`.

## Quand une définition est-elle refusée ?

Un schéma qui laisserait une table non protégée ou impossible à servir n'atteint jamais la
base de données. Il est refusé à trois niveaux :

1. **Dans l'éditeur.** `rls` et `columns` sont requis par les types, et
   `rls: []` n'est pas une posture valide. Un champ `tenant` ou `softDelete`, ou une
   colonne d'index renseignée comme une simple clé qui ne correspond à aucune colonne existante constitue une erreur de type.
2. **Au chargement du module.** `defineTable` lève une exception pour une table sans colonnes,
   une colonne qui n'est pas un builder `col.*`, une relation qui n'est pas le résultat d'un
   `rel.*`, une relation ayant la même clé qu'une colonne, ou une absence de `rls` utilisable. Cela
   intercepte également le code JavaScript et les transtypages (casts) invisibles pour les types.
3. **Lors de la compilation du schéma.** `rebase db generate`, `rebase db push`,
   `rebase doctor` et le démarrage du serveur compilent chaque table ensemble et s'arrêtent avec
   une erreur `SchemaDefinitionError` qui liste chaque problème, chacun avec la table, la
   colonne ou la relation concernée, et ce qu'il faut écrire à la place :

```text
The schema cannot be used (2 problems):
  - posts: the table has no primary key. Mark a column `.primaryKey()` — e.g. `id: col.uuid().primaryKey().defaultRandom()`; several make a composite key in declaration order.
  - comments: `rls: "inherit"` takes the project's `defaultRls`, and none was given. Export `defaultRls` from backend/schema/index.ts (`"admin-only"` or a list of rules), or write this table's own `rls`.
```

L'étape de compilation vérifie ce qui nécessite d'examiner toutes les tables simultanément : les cibles des relations et
leurs types de clés, les tables de jonction revendiquées par deux relations, les slugs et les noms SQL
en conflit (y compris les noms entrant en collision une fois que Postgres les tronque à 63
octets), les règles nommant une colonne que la table ne possède pas, et `"inherit"`
sans `defaultRls`. Une table exportée depuis un fichier situé à côté de `index.ts` mais non exportée
depuis `index.ts` lui-même est également refusée : l'index constitue la liste officielle des tables.

## Prochaines étapes

- [Colonnes](/docs/schema/columns/) : tous les builders et modificateurs `col.*`
- [Documents JSON](/docs/schema/json/) : `jsonb` typé et validé avec `json.*`
- [Relations](/docs/collections/relations/) : les cinq variantes `rel.*`
- [Sécurité au niveau des lignes](/docs/collections/security-rules/) : la posture `rls` et ses règles
- [Hooks de table](/docs/collections/callbacks/) : hooks de cycle de vie côté serveur
- [Inférence de types](/docs/schema/types/) : `InferRow`, `InferInsert` et `InferUpdate`
