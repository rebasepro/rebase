---
sourceHash: 507990241e43f026
title: Schema as Code
sidebar_label: Schema as Code
description: Comment Rebase utilise les tables TypeScript dans backend/schema comme source unique de vérité pour votre schéma de base de données, votre API, votre SDK et votre panneau d'administration.
---

## Le principe fondamental

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

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

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

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

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Vos tables sont lues une fois et émises deux fois — sous la forme d'un schéma Drizzle à travers
lequel le serveur en cours d'exécution effectue ses requêtes, et sous la forme de SQL décrivant la base de données
que vous souhaitiez obtenir. C'est à ce SQL que la base de données est alignée par
[Atlas](https://atlasgo.io), qui compare votre schéma souhaité avec le schéma réel
et planifie la modification :

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
  reads and writes rows through             schema.sql              ← Atlas's desired state
                                            policies.sql            ← RLS, applied separately
                                            search.sql, vector.sql, ← Atlas cannot manage these
                                            triggers.sql
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

`db push` constitue la boucle de développement ; `db generate` + `db migrate` constitue la
boucle révisable, et celle à utiliser en production. Les deux passent par le même
SQL généré, de sorte qu'ils ne peuvent pas être en désaccord sur la signification de vos tables, et
tous deux le réécrivent à neuf à partir des tables avant de le lire, afin qu'aucune copie
dans votre dépôt ne devienne obsolète. Les migrations sont ce que vous commitez. Consultez
[Schema Generation](/docs/cli/schema) pour découvrir toutes les options.

### Exemple

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

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

Et ce SQL, qui est ce qui est transmis à Atlas en tant qu'état souhaité :

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

Les politiques, les colonnes de recherche, les index vectoriels et les déclencheurs `updated_at` sont écrits dans
leurs propres fichiers et appliqués directement par la CLI — Atlas ne gère
aucun des quatre.

## Sécurité et objets de base de données non mappés

Lorsque Rebase met à jour le schéma de base de données, il mappe les tables que vous déclarez avec les tables de la base de données. Pour garantir que **les objets de base de données non mappés (par ex. tables, vues, enums) ne soient jamais supprimés ou modifiés**, Rebase met en œuvre plusieurs couches de sécurité :

1. **Exclusion des tables non mappées** : Avant chaque push, la CLI liste chaque table et vue dans la base de données et transmet à Atlas un `--exclude` pour chacune de celles auxquelles aucune table déclarée (ou table de jonction d'une table déclarée) n'est mappée, afin qu'Atlas ne planifie jamais de modification à son sujet. Si la base de données ne peut pas être lue, le push est interrompu plutôt que d'être exécuté avec une liste partielle.
2. **Schémas gérés par Rebase** : Le schéma `rebase` (tables d'authentification, fonctions utilitaires RLS, table de révision d'Atlas) et tout schéma `auth` sont exclus dans leur intégralité, de sorte qu'un push ne puisse jamais planifier de `DROP SCHEMA … CASCADE`.
3. **Objets qu'Atlas ne peut pas modéliser** : Les colonnes de recherche, les index vectoriels et les déclencheurs sont également exclus d'Atlas et sont appliqués à partir de leurs propres fichiers générés.
4. **Garde-fou contre les modifications destructives** : `rebase db push` simule d'abord l'exécution du plan. Une instruction qui détruit des données — la suppression d'une colonne ou d'une table, un changement de type avec perte de données — interrompt le push : dans un terminal, il vous demande de taper `yes`, et en l'absence de terminal (CI, scripts, agents), il refuse de s'exécuter à moins de lui passer l'option `--allow-destructive`.
5. **Appartenance des index par le nom** : Les index sont le seul objet qui réside *sur* une table mappée, le filtrage des tables ne peut donc pas les protéger — et auparavant, un push planifiait un `DROP INDEX` pour tout index absent de l'état souhaité, ce qui incluait tous ceux écrits à la main. Rebase nomme désormais les index qu'il génère `<table>_<columns>_ix_<7 hex>` (`_ux_` lorsqu'il est unique), un format qu'aucun autre système de nommage ne produit ici, et exclut tout le reste du diff par son nom. Un index que vous avez écrit à la main, ou issu d'une introspection, n'est jamais touché ; une déclaration que vous supprimez est toujours supprimée, ce qui est le comportement voulu. Consultez **[Indexes](/docs/backend/indexes)**.

## Prochaines étapes

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

- **[Tables](/docs/schema/)** — Toutes les options de `defineTable`
- **[Columns](/docs/schema/columns/)** — Mappings détaillés des types de colonnes
- **[Indexes](/docs/backend/indexes)** — Déclarer les index nécessaires à vos requêtes
