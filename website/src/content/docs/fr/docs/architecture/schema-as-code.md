---
sourceHash: 719f802a23cf78ec
title: Schéma comme Code
sidebar_label: Schéma comme Code
description: Comment Rebase utilise les collections TypeScript comme source unique de vérité pour votre schéma de base de données, votre interface utilisateur et votre API.
---

## L'Idée Principale

Dans Rebase, vos **définitions de collections TypeScript sont la source unique de vérité**. À partir d'un ensemble d'objets TypeScript, Rebase génère :

- **Tables PostgreSQL** via la génération de schéma Drizzle ORM
- **Interface utilisateur CRUD** — formulaires, tables, validation, types de champs
- **Points de terminaison d'API REST** avec filtrage, tri et pagination
- **SDK typé** — opérations de données sécurisées par le type
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

Vos collections sont lues une fois et émises deux fois — sous forme d'un schéma
Drizzle à travers lequel le serveur en cours d'exécution fait ses requêtes, et
sous forme de SQL qui décrit la base de données que vous vouliez avoir. C'est
sur ce SQL que la base de données est alignée, par [Atlas](https://atlasgo.io),
qui compare votre schéma souhaité au schéma réel et planifie la modification :

```
                        Collections (TypeScript)
                                  │
            ┌─────────────────────┴─────────────────────┐
            ▼                                           ▼
   rebase schema generate                   (db push et db generate écrivent
            │                               le SQL ci-dessous à chaque exécution,
            ▼                               dans .rebase/sql/, qui n'est pas commité)
  backend/src/schema.generated.ts                       │
  le schéma Drizzle par lequel le                       ▼
  runtime lit et écrit les lignes           schema.sql              ← état souhaité d'Atlas
                                            policies.sql            ← RLS, appliqué séparément
                                            search.sql, vector.sql, ← Atlas ne peut pas les gérer
                                            triggers.sql
                                                        │
                                          ┌─────────────┴─────────────┐
                                          ▼                           ▼
                                   rebase db push              rebase db generate
                                   Atlas planifie le diff      Atlas écrit le diff
                                   et l'applique aussitôt      dans drizzle/migrations/
                                          │                           │
                                          │                           ▼
                                          │                    rebase db migrate
                                          │                    les applique dans l'ordre
                                          └─────────────┬─────────────┘
                                                        ▼
                                                  PostgreSQL
```

`db push` est la boucle de développement ; `db generate` + `db migrate` est la
boucle révisable, celle à utiliser en production. Les deux passent par le même
SQL généré, ils ne peuvent donc pas diverger sur ce que signifient vos
collections, et les deux le réécrivent à partir des collections avant de le
lire, il n'y a donc dans votre dépôt aucune copie qui puisse devenir obsolète.
Ce que vous commitez, ce sont les migrations. Voir la
[Génération de schéma](/docs/cli/schema) pour tous les indicateurs.

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
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`)
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

Trois choses méritent d'être lues deux fois. La colonne `id` que vous n'avez pas
déclarée : chaque collection reçoit une clé primaire `text`, sauf si une propriété
revendique `isId`, et <span class="since-badge" data-since="0.24">Depuis 0.24</span> la base de données la remplit avec un uuid
(`gen_random_uuid()::text`), si bien qu'une ligne créée depuis le panneau
d'administration, l'API REST ou le SDK n'a besoin d'aucune clé propre. Une clé que vous
envoyez vous-même est utilisée telle quelle. Sur la 0.23 la colonne n'a aucune
valeur par défaut, et une création qui n'envoie aucune clé échoue. Le bloc `pgPolicy` : la sécurité au
niveau des lignes est activée sur chaque table, et ces politiques de base sont ce
qui permet au contexte serveur de confiance et au rôle `admin` de la lire malgré
tout — voir les [Règles de sécurité](/docs/collections/security-rules). Et
`active`, qui porte la `defaultValue` que vous avez écrite comme valeur par
défaut de **colonne** : une `defaultValue` littérale se compile en un vrai
`DEFAULT`, de sorte qu'une ligne insérée par l'API REST, un script de seed ou
`psql` la reçoit elle aussi, pas seulement celle saisie dans le panneau
d'administration. Une valeur par défaut de type `reference` ou `vector` n'est pas
un littéral de colonne et reste une valeur au niveau de l'application.

Ce qui produit ce SQL :

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
