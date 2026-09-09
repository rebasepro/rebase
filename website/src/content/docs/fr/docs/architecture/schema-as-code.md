---
sourceHash: 69d89e250dd512d5
title: Schéma comme Code
sidebar_label: Schéma comme Code
description: Comment Rebase utilise les collections TypeScript comme source unique de vérité pour votre schéma de base de données, votre interface utilisateur et votre API.
---

## L'Idée Principale

Dans Rebase, vos **définitions de collections TypeScript sont la source unique de vérité**. À partir d'un ensemble d'objets TypeScript, Rebase génère :

- **Tables PostgreSQL** via la génération de schéma Drizzle ORM
- **Interface utilisateur CRUD** — formulaires, tables, validation, types de champs
- **Points de terminaison d'API REST** avec filtrage, tri et pagination
- **SDK client** — opérations de données sécurisées par le type
- **Politiques RLS** — Sécurité au niveau des lignes dans Postgres

Cela signifie que votre schéma est :
- **Géré par version** — chaque modification est un commit git
- **Type-safe** — TypeScript intercepte les erreurs à la compilation
- **Révisable** — les modifications de schéma passent par des pull requests
- **Portable** — la même définition fonctionne sur le frontend, le backend et la CLI

## Édition Visuelle avec Manipulation d'AST

Rebase fournit également un **éditeur visuel de collections** en mode Studio. Lorsqu'un non-développeur utilise l'éditeur visuel pour ajouter un champ :

1. Le Studio ne modifie **pas** directement la base de données
2. Au lieu de cela, il utilise [ts-morph](https://ts-morph.com/) pour analyser votre fichier source TypeScript en tant qu'AST
3. Il insère la nouvelle définition de propriété précisément dans le bloc `properties`
4. **Tout le code existant, les rappels et la logique personnalisée sont préservés intacts**
5. Le fichier est enregistré, déclenchant le rechargement à chaud

Cette approche "UI en tant que Générateur de Code" signifie que les modifications visuelles produisent le même code TypeScript propre qu'un développeur écrirait à la main.

## Pipeline de Génération de Schéma

Your collections are read once and emitted twice — as a Drizzle schema the
running server queries through, and as SQL that describes the database you meant
to have. It is the SQL that the database is brought into line with, by
[Atlas](https://atlasgo.io), which diffs your desired schema against the live one
and plans the change:

```
                        Collections (TypeScript)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   rebase schema generate                       (the same command also
            │                                    writes the SQL below)
            ▼                                           │
  backend/src/schema.generated.ts                        ▼
  the Drizzle schema the runtime            drizzle/schema.sql      ← Atlas's desired state
  reads and writes rows through             policies.sql            ← RLS, applied separately
                                            search.sql, vector.sql  ← Atlas cannot manage these
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Atlas plans the diff        Atlas writes the diff
                                   and applies it now          to drizzle/migrations/
                                          │                           │
                                          │                           ▼
                                          │                    rebase db migrate
                                          │                    applies them in order
                                          └─────────────┬─────────────┘
                                                        ▼
                                                  PostgreSQL
```

`db push` is the development loop; `db generate` + `db migrate` is the
reviewable one, and the one to use in production. Both go through the same
generated SQL, so they cannot disagree about what your collections mean. See
[Schema Generation](/docs/cli/schema) for every flag.

### Exemple

Étant donnée cette collection :

<!-- schema-sample: collection -->
```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name", validation: { required: true } },
        price: { type: "number", name: "Price", columnType: "numeric" },
        active: { type: "boolean", name: "Active", defaultValue: true },
        createdAt: { type: "date", name: "Created", autoValue: "on_create" }
    }
});
```

Rebase génère ce schéma Drizzle :

<!-- schema-sample: drizzle -->
```typescript
// schema.generated.ts
// This file is auto-generated by the Rebase Drizzle generator. Do not edit manually.

import { boolean, numeric, pgPolicy, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { relations as drizzleRelations, sql } from 'drizzle-orm';


export const products = pgTable("products", {
    name: text("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(sql`TRUE`),
    createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).default(sql`now()`),
    id: text("id").primaryKey()
}, (table) => ([
    pgPolicy("products_default_admin_read", { as: "permissive", for: "select", to: ["public"], using: sql`(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])` }),
    pgPolicy("products_default_admin_write_insert", { as: "permissive", for: "insert", to: ["public"], withCheck: sql`(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])` }),
    pgPolicy("products_default_admin_write_update", { as: "permissive", for: "update", to: ["public"], using: sql`(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])`, withCheck: sql`(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])` }),
    pgPolicy("products_default_admin_write_delete", { as: "permissive", for: "delete", to: ["public"], using: sql`(rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])` }),
])).enableRLS();

export const tables = { products };
export const enums = {  };
export const relations = {  };
```

Two things in there are worth reading twice. The `id` column you did not
declare: every collection gets a `text` primary key unless a property claims
`isId`. And the `pgPolicy` block: row level security is enabled on every table,
and those baseline policies are what keep the trusted server context and the
`admin` role able to read it at all — see
[Security Rules](/docs/collections/security-rules).

Ce qui produit ce SQL :

<!-- schema-sample: sql -->
```sql
-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.

CREATE SCHEMA IF NOT EXISTS "rebase";

CREATE TABLE "public"."products" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "price" NUMERIC,
  "active" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

Policies, search columns, vector indexes and `updated_at` triggers are written to
files of their own and applied by the CLI in their own right — Atlas manages
none of the four.

## Sécurité & Objets de Base de Données Non Mappés

Lorsque Rebase met à jour le schéma de base de données, il associe les définitions de collections TypeScript aux tables de la base de données. Pour garantir que **les objets de base de données non mappés (par exemple, tables, vues, énumérations) ne soient jamais supprimés ou modifiés**, Rebase implémente plusieurs couches de sécurité :

1. **Filtrage Strict des Tables (`tablesFilter`)** : La configuration Drizzle générée restreint dynamiquement la synchronisation aux seules tables exportées dans le schéma généré. Toute table non reconnue ou table de système hérité existant dans la base de données est ignorée par le moteur de synchronisation.
2. **Restrictions de Schéma (`schemaFilter`)** : La synchronisation de la base de données est limitée exclusivement au schéma `public`. Les tables de base de données internes, les schémas personnalisés et les tables spécifiques aux extensions ne sont pas touchés.
3. **Protection des Rôles et des Extensions** : Drizzle est configuré pour ne pas gérer les rôles de base de données (`entities.roles: false`) ni les tables d'aide des extensions comme PostGIS.
4. **Confirmation Interactive en Mode Dev** : Lors de l'exécution de `rebase db push` en développement, la CLI s'exécute avec les indicateurs `--strict` et `--verbose`, ce qui garantit que les développeurs doivent explicitement examiner et approuver toutes les actions SQL destructrices avant qu'elles ne soient exécutées.
5. **Propriété des Index par le Nom** : Les index sont le seul objet qui vit *sur* une table mappée, le filtrage de tables ne peut donc pas les protéger — et un push planifiait `DROP INDEX` pour tout index absent de l'état souhaité, c'est-à-dire tous ceux écrits à la main. Rebase nomme désormais les index qu'il génère `<table>_<columns>_ix_<7 hex>` (`_ux_` s'ils sont uniques), une forme qu'aucun autre nommage ici ne produit, et exclut tout le reste du diff par le nom. Un index que vous avez écrit à la main, ou arrivé par introspection, n'est jamais touché ; une déclaration que vous supprimez retire toujours son index, ce qui est l'intention. Voir **[Index](/docs/backend/indexes)**.

## Prochaines Étapes

- **[Collections](/docs/collections)** — Référence complète de la configuration des collections
- **[Propriétés](/docs/collections/properties)** — Mappages détaillés des types de colonnes
- **[Index](/docs/backend/indexes)** — Déclarer les index dont vos requêtes ont besoin
