---
title: Schéma comme Code
sidebar_label: Schéma comme Code
slug: fr/docs/architecture/schema-as-code
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

```
TypeScript Collections
        │
        ▼
  rebase schema generate
        │
        ▼
  Drizzle Schema (schema.generated.ts)
        │
        ▼
  rebase db generate
        │
        ▼
  SQL Migration Files
        │
        ▼
  rebase db migrate
        │
        ▼
  PostgreSQL Tables
```

### Exemple

Étant donnée cette collection :

```typescript
const productsCollection: EntityCollection = {
    slug: "products",
    table: "products",
    properties: {
        name: { type: "string", name: "Name", validation: { required: true } },
        price: { type: "number", name: "Price", columnType: "numeric" },
        active: { type: "boolean", name: "Active", defaultValue: true },
        created_at: { type: "date", name: "Created", autoValue: "on_create" }
    }
};
```

Rebase génère ce schéma Drizzle :

```typescript
// schema.generated.ts
import { pgTable, varchar, numeric, boolean, timestamp } from "drizzle-orm/pg-core";

export const products = pgTable("products", {
    id: serial("id").primaryKey(),
    name: varchar("name").notNull(),
    price: numeric("price"),
    active: boolean("active").default(true),
    created_at: timestamp("created_at").defaultNow()
});
```

Ce qui produit ce SQL :

```sql
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR NOT NULL,
    price NUMERIC,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
```

## Prochaines Étapes

- **[Collections](/docs/collections)** — Référence complète de la configuration des collections
- **[Propriétés](/docs/collections/properties)** — Mappages détaillés des types de colonnes
---
