---
sourceHash: 74016480ba989bec
title: Schema as Code
sidebar_label: Schema as Code
description: Comment Rebase utilise les tables TypeScript dans backend/schema comme source unique de vérité pour votre schéma de base de données, votre API, votre SDK et votre panneau d'administration.
---

## Le principe fondamental

Dans Rebase, les **tables que vous déclarez avec `defineTable` dans `backend/schema/` constituent la source unique de vérité**. À partir de celles-ci, Rebase génère :

- **Des tables PostgreSQL** via la génération de schéma Drizzle ORM
- **Des politiques RLS** — la sécurité au niveau des lignes (Row Level Security) dans Postgres, à partir du champ `rls` requis de chaque table
- **Des points de terminaison d'API REST** avec filtrage, tri et pagination, ainsi que le temps réel et MCP
- **Un SDK typé** — des opérations sur les données sécurisées au niveau des types (type-safe)
- **Les valeurs par défaut du panneau d'administration** — formulaires, listes, validation et types de champs, générés à partir des descripteurs de table servis par le backend à `GET /api/schema/tables` ; ce que le panneau affiche au-delà réside dans `frontend/src/cms/`

Cela signifie que votre schéma est :
- **Versionné** — chaque modification est un commit git
- **Type-safe** — TypeScript détecte les erreurs au moment de la compilation
- **Révisable** — les modifications de schéma passent par des pull requests
- **Portable** — la même définition est lue par le backend, la CLI, le générateur de SDK et, sous forme de types, par le frontend

## Édition visuelle avec manipulation d'AST

Rebase fournit également un **éditeur de schéma visuel** dans Studio. Lorsque quelqu'un l'utilise pour ajouter une colonne :

1. Le Studio ne modifie **pas** directement la base de données
2. Au lieu de cela, il envoie la modification sous la forme d'un `TablePatch`, et le serveur utilise [ts-morph](https://ts-morph.com/) pour analyser le fichier de la table dans `backend/schema/` en tant qu'AST
3. Il insère le nouveau constructeur `col.*` précisément dans le bloc `columns`
4. **Tout le code existant, les hooks et la logique personnalisée sont préservés intacts** ; une modification qui toucherait à du code qu'elle ne réécrit pas est refusée
5. Le fichier est enregistré, déclenchant le rechargement à chaud (hot reload)

L'*apparence* d'une table dans le panneau n'en fait pas partie : les libellés, icônes et vues
sont enregistrés dans les préférences du panneau ou écrits dans `frontend/src/cms/`. Consultez
[Live schema editing](/docs/backend/live-schema-editing/) pour en savoir plus sur les modifications et
ce que l'éditeur refuse.

Cette approche « UI as Code Generator » permet aux modifications visuelles de produire le même code TypeScript propre qu'un développeur écrirait à la main.

## Pipeline de génération de schéma

Les tables sont lues une fois et émises sous deux formes : un schéma Drizzle pour le
serveur et du SQL décrivant la base de données souhaitée. Ptah Compat planifie les
changements à partir de ce SQL. `db push` le compare à la base réelle ; `db generate` le
compare à l’historique des migrations :

```
                      Tables (backend/schema)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   rebase schema generate                   (db push and db generate write
            │                               the SQL below on every run, into
            ▼                               .rebase/sql/, which is not committed)
  backend/src/schema.generated.ts                       │
  the Drizzle schema the runtime                        ▼
  reads and writes rows through             schema.sql              ← full desired state
                                            ptah-managed.json       ← owned objects
                                            policies.sql, search.sql,
                                            vector.sql, triggers.sql,
                                            views.sql               ← boot and recovery
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Ptah plans the diff         Ptah writes the diff
                                   and applies it now          to drizzle/migrations/
                                          │                           │
                                          │                           ▼
                                          │                    rebase db migrate
                                          │                    applies them in order
                                          └─────────────┬─────────────┘
                                                        ▼
                                                  PostgreSQL
```

`db push` constitue la boucle de développement ; `db generate` + `db migrate` constitue la
boucle révisable, et celle à utiliser en production. Les deux passent par le même
SQL généré, de sorte qu'ils ne peuvent pas être en désaccord sur la signification de vos tables, et
tous deux le réécrivent à neuf à partir des tables avant de le lire, afin qu'aucune copie
dans votre dépôt ne devienne obsolète. Les migrations sont ce que vous commitez. Consultez
[Schema Generation](/docs/cli/schema) pour découvrir toutes les options.

### Exemple

Étant donné cette table :

<!-- schema-sample: table -->
```ts
import { defineTable, col, sql } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id: col.text().primaryKey().default(sql`gen_random_uuid()::text`),
        name: col.text().notNull(),
        price: col.numeric(),
        active: col.boolean().default(true),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow()
    },
    rls: "admin-only"
});
```

Rebase génère ce schéma Drizzle — le fichier complet, politiques par défaut et
le reste :

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
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`)
}, (table) => ([
    pgPolicy("products_default_admin_read", { as: "permissive", for: "select", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_insert", { as: "permissive", for: "insert", to: ["rebase_admin"], withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_update", { as: "permissive", for: "update", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))`, withCheck: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
    pgPolicy("products_default_admin_write_delete", { as: "permissive", for: "delete", to: ["rebase_admin"], using: sql`(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))` }),
])).enableRLS();

export const tables = { products };
export const enums = {  };
export const relations = {  };
```

Trois éléments méritent ici une attention particulière. La colonne `id` : la base de données
la remplit avec un uuid (`gen_random_uuid()::text`), de sorte qu'une ligne créée à partir du
panneau d'administration, de l'API REST ou du SDK n'a pas besoin de clé propre, et toute clé que vous
envoyez est utilisée telle quelle. Le bloc `pgPolicy` : `rls: "admin-only"` active la sécurité
au niveau des lignes et ne génère que les politiques de base, permettant au contexte
de serveur de confiance et au rôle `admin` de la lire — et personne d'autre ; consultez
[Row-level security](/docs/collections/security-rules). Et `active`, qui
porte le `.default(true)` que vous avez écrit en tant que valeur par défaut de **colonne** : une valeur par défaut
littérale se compile en un vrai `DEFAULT`, ainsi une ligne insérée par l'API REST, un script
de seed ou `psql` en bénéficie également, et pas seulement une ligne saisie dans le panneau d'administration.

Un extrait du SQL que Ptah reçoit comme état souhaité :

<!-- schema-sample: sql -->
```sql
-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.

CREATE SCHEMA IF NOT EXISTS "rebase";

CREATE TABLE "public"."products" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL,
  "price" NUMERIC,
  "active" BOOLEAN DEFAULT TRUE,
  "created_at" TIMESTAMP WITH TIME ZONE DEFAULT now()
);
```

Le fichier complet de l’état souhaité contient aussi les politiques, fonctions, index de
recherche et vectoriels, déclencheurs `updated_at` et vues déclarés. Les fichiers SQL
séparés restent disponibles pour le démarrage et la restauration. `db push` et `db
generate` les planifient ensemble.

## Sécurité et objets de base de données non mappés

Rebase limite le plan de Ptah aux objets déclarés. Il conserve leurs noms dans
`drizzle/ptah-managed.json`, même après la suppression d’une déclaration. Une
suppression peut donc produire un `DROP`. Les tables, vues, fonctions et extensions
externes restent hors du plan.

Commitez `backend/drizzle/ptah-managed.json` avec les migrations. Rebase utilise
les noms enregistrés pour planifier la suppression des déclarations retirées.

Le provisionnement de l’authentification et les révisions de migrations sont exclus. Les
fonctions utilitaires que Rebase déclare dans le schéma `rebase` sont incluses. Pour les
tables sélectionnées, la CLI protège aussi par leur nom les politiques, déclencheurs,
index et contraintes CHECK et EXCLUDE personnalisés.

Rebase lit les contraintes CHECK et EXCLUDE dans le catalogue de la base active.
Pour les politiques, les déclencheurs et les index, il lit aussi les fichiers de
migration. Un échec de lecture du catalogue arrête la planification.

Avant d’appliquer une modification, `db push` affiche le plan et contrôle les
instructions destructrices, dont `DROP EXTENSION`. `--dry-run` permet de voir le plan
sans l’appliquer. Voir [Index](/docs/backend/indexes) pour la distinction entre index
déclarés et personnalisés.

## Prochaines étapes

- **[Tables](/docs/schema/)** — Toutes les options de `defineTable`
- **[Columns](/docs/schema/columns/)** — Mappings détaillés des types de colonnes
- **[Indexes](/docs/backend/indexes)** — Déclarer les index nécessaires à vos requêtes
