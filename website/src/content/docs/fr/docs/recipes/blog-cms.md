---
sourceHash: 0c385399c3a984b7
title: "Recette : CMS de Blog"
sidebar_label: CMS de Blog
description: Créez un CMS de blog complet avec articles, auteurs, catégories, édition en texte enrichi et téléversement d'images — tables dans backend/schema, présentation dans frontend/src/cms.
---

## Vue d'ensemble

Créez un backend de blog avec :
- Des **articles** avec contenu markdown et images de couverture
- Des **auteurs** avec profils
- Des **catégories** avec une relation plusieurs-à-plusieurs (many-to-many)

## Tables

<span class="since-badge" data-since="0.31">Since 0.31</span>

Trois fichiers dans `backend/schema/`. Ils définissent ce que la base de données
et l'API appliquent ; la façon dont le panneau d'administration les présente vient après, dans le frontend.

### Auteurs

<span class="since-badge" data-since="0.31">Since 0.31</span>

```ts
// backend/schema/authors.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const authors = defineTable("authors", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        name:   col.text().notNull(),
        email:  col.text().notNull().unique().validate({ email: true }),
        avatar: col.storage({ path: "avatars/", accept: ["image/*"], maxBytes: "2MB" }),
        bio:    col.text(),
    },
    rls: "inherit",
});
```

### Catégories

<span class="since-badge" data-since="0.31">Since 0.31</span>

```ts
// backend/schema/categories.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const categories = defineTable("categories", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        name:  col.text().notNull(),
        slug:  col.text().notNull().unique(),
        color: col.enum(["blue", "green", "red", "orange"]),
    },
    rls: "inherit",
});
```

### Articles

<span class="since-badge" data-since="0.31">Since 0.31</span>

```ts
// backend/schema/articles.ts
import { defineTable, col, rel, policy } from "@rebasepro/server/schema";
import { authors } from "./authors";
import { categories } from "./categories";

export const articles = defineTable("articles", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull(),
        slug:        col.text().notNull().unique(),
        status:      col.enum(["draft", "review", "published"]).default("draft"),
        coverImage:  col.storage({ path: "articles/covers/", accept: ["image/*"] }),
        content:     col.text(),
        excerpt:     col.text().validate({ max: 300 }),
        publishedAt: col.timestamp({ withTimezone: true }),
        createdAt:   col.timestamp({ withTimezone: true }).onCreateNow(),
        // The signed-in user who created the article, stamped by the server.
        // `author` is the byline; this is who may keep editing the draft.
        createdBy:   col.text().onCreateUser(),
    },
    relations: {
        author:     rel.belongsTo(() => authors),
        categories: rel.manyToMany(() => categories, { through: "article_categories" }),
    },
    history: true,
    hooks: {
        beforeSave: ({ values }) => {
            const next = { ...values };
            // Auto-generate the slug
            if (typeof next.title === "string" && !next.slug) {
                next.slug = next.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            }
            // Stamp publishedAt when publishing
            if (next.status === "published" && !next.publishedAt) {
                next.publishedAt = new Date().toISOString();
            }
            return next;
        },
    },
    rls: [
        // Anyone can read published articles
        { operation: "select", using: "{status} = 'published'" },
        // Writers read, create and edit their own articles
        { operations: ["select", "insert", "update"], ownerField: "createdBy", roles: ["writer"] },
        // Editors read and edit every article
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        // Only an editor publishes. Restrictive, so it holds over every rule
        // above: a writer can neither save an article as published nor edit
        // one that already is.
        {
            operations: ["insert", "update"],
            mode: "restrictive",
            condition: policy.or(
                policy.rolesOverlap(["editor", "admin"]),
                policy.compare(policy.field("status"), "neq", policy.literal("published"))
            ),
        },
        { operation: "delete", roles: ["admin"] },
    ],
});
```

`rls: "inherit"` sur authors et categories reprend le `defaultRls` exporté par votre
`backend/schema/index.ts` — dans le scaffold, tout le monde lit et les admins
écrivent.

### Qui peut publier

Le workflow repose sur la colonne `status` combinée aux règles ci-dessus, et Postgres l'applique
directement, de sorte qu'il s'impose aussi bien au panneau d'administration, à l'API REST qu'au SDK :

- Un **rédacteur** (writer) crée des articles et fait passer les siens de `draft` à
  `review`. L'enregistrement sous le statut `published` lui est refusé, tout comme la modification d'un article
  une fois qu'il est publié.
- Un **éditeur** (editor) lit tous les articles, y compris les brouillons, et publie.
- Les **lecteurs**, connectés ou non, ne voient que les articles publiés. Les lectures anonymes
  nécessitent `AUTH_REQUIRE=false` sur le backend ; consultez
  [Accès public](/docs/collections/security-rules/#public-access).

`writer` et `editor` sont des entrées dans les `roles` d'un utilisateur. Si vous êtes parti du
scaffold, ajoutez `writer` aux options de rôle de la colonne `roles` dans
`backend/schema/users.ts`.

## Comment le panneau les affiche

<span class="since-badge" data-since="0.31">Since 0.31</span>

Le panneau d'administration affiche ces trois tables sans aucun code supplémentaire. Ces fichiers dans
`frontend/src/cms/` ajoutent les icônes, les couleurs d'enum et les éditeurs :

```tsx
// frontend/src/cms/articles.tsx
import { customizeTable } from "@rebasepro/cms";
import type { articles } from "../../../backend/schema/articles";

export const articlesCms = customizeTable<typeof articles>("articles", {
    icon: "Article",
    defaultViewMode: "table",
    fields: {
        content: { markdown: true },
        excerpt: { multiline: true },
        status: {
            enumLabels: {
                draft:     { label: "Draft", color: "gray" },
                review:    { label: "In Review", color: "orange" },
                published: { label: "Published", color: "green" },
            },
        },
    },
});
```

```tsx
// frontend/src/cms/authors.tsx
import { customizeTable } from "@rebasepro/cms";
import type { authors } from "../../../backend/schema/authors";

export const authorsCms = customizeTable<typeof authors>("authors", {
    icon: "Person",
    fields: { bio: { multiline: true } },
});
```

## Configuration

<span class="since-badge" data-since="0.31">Since 0.31</span>

1. Enregistrez les trois fichiers de tables dans `backend/schema/` et exportez-les depuis
   `backend/schema/index.ts` — un `defineTable` non exporté par l'index
   empêchera le démarrage.
2. Enregistrez les fichiers de personnalisation dans `frontend/src/cms/` et ajoutez-les à
   `<RebaseCMS tableCustomizations={[articlesCms, authorsCms]}>` dans `App.tsx`.
3. Avec `rebase dev` en cours d'exécution, c'est tout : la sauvegarde regénère le schéma,
   redémarre le backend, et le démarrage crée les tables, la table de jonction et
   leurs politiques de sécurité au niveau des lignes (RLS). En dehors de `rebase dev`, sur votre propre
   instance PostgreSQL, exécutez `rebase schema generate` puis `rebase db push`.

Vous disposez désormais d'un CMS de blog entièrement fonctionnel avec :
- Gestion des auteurs avec téléversement d'avatars
- Tagging de catégories via des relations plusieurs-à-plusieurs
- Édition de contenu en Markdown
- Un workflow Brouillon → Relecture → Publié dans lequel seul un éditeur peut publier,
  appliqué par Postgres
- Génération automatique des slugs d'URL
- Rédacteurs limités à leurs propres articles, et brouillons masqués aux lectures publiques
- Piste d'audit complète grâce à l'historique des entités

## Requêter depuis le SDK

Utilisez le SDK typé pour récupérer les articles avec leurs relations :

```typescript
// The row shape you expect back — without it every field arrives as `unknown`.
type Article = {
    title: string;
    status: string;
    publishedAt?: string | null;
    authorId: string;
    author?: { name: string };
    categories?: { name: string }[];
};

// Fetch published articles with author and categories included
const { data: articles } = await client.data
    .table<Article>("articles")
    .where("status", "==", "published")
    .include("author", "categories")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();

// Rows come back flat — there is no `values` wrapper on the SDK.
for (const article of articles) {
    console.log(article.title);
    console.log(article.author?.name);    // Hydrated relation
    console.log(article.authorId);       // Scalar FK
    console.log(article.categories);      // Array of related entities
}
```


## En savoir plus

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Tables](/docs/schema/) — l'API `defineTable` utilisée dans cette recette
- [Personnaliser une table](/docs/frontend/customize-table/) — côté panneau d'administration
- [Relations](/docs/collections/relations/) — les liaisons auteur et tag, en détail
- [Sécurité au niveau des lignes](/docs/collections/security-rules/) — publier sans exposer les brouillons
