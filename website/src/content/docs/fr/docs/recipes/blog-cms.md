---
title: "Recette : CMS de blog"
sidebar_label: CMS de blog
description: Créez un CMS de blog complet avec des articles, des auteurs, des catégories, une édition de texte enrichi et des téléchargements d'images.
---

## Vue d'ensemble

Créez un backend de blog avec :
- Des **articles** avec du contenu Markdown et des images de couverture
- Des **auteurs** avec des profils
- Des **catégories** avec une relation plusieurs-à-plusieurs

## Collections

### Auteurs

```typescript
import { CollectionConfig } from "@rebasepro/types";

export const authorsCollection: CollectionConfig = {
    slug: "authors",
    name: "Authors",
    singularName: "Author",
    table: "authors",
    properties: {
        name: {
            type: "string",
            name: "Name",
            validation: { required: true }
        },
        email: {
            type: "string",
            name: "Email",
            email: true,
            validation: { required: true, unique: true }
        },
        avatar: {
            type: "string",
            name: "Avatar",
            storage: {
                storagePath: "avatars",
                acceptedFiles: ["image/*"],
                maxSize: 2 * 1024 * 1024
            }
        },
        bio: {
            type: "string",
            name: "Bio",
            admin: { multiline: true }
        }
    },
    admin: {
        icon: "person"
    }
};

```

### Catégories

```typescript
export const categoriesCollection: CollectionConfig = {
    slug: "categories",
    name: "Categories",
    singularName: "Category",
    table: "categories",
    properties: {
        name: {
            type: "string",
            name: "Name",
            validation: { required: true }
        },
        slug: {
            type: "string",
            name: "Slug",
            validation: { required: true, unique: true }
        },
        color: {
            type: "string",
            name: "Color",
            enum: [
                { id: "blue", label: "Blue", color: "blue" },
                { id: "green", label: "Green", color: "green" },
                { id: "red", label: "Red", color: "pink" },
                { id: "orange", label: "Orange", color: "orange" }
            ]
        }
    },
    admin: {
        icon: "label"
    }
};

```

### Articles

```typescript
// The row shape, so callbacks below see typed `values` instead of `unknown`.
type Article = {
    title: string;
    slug: string;
    status: string;
    published_at?: string | null;
};

export const articlesCollection: CollectionConfig<Article> = {
    slug: "articles",
    name: "Articles",
    singularName: "Article",
    table: "articles",
    history: true,
    properties: {
        title: {
            type: "string",
            name: "Title",
            validation: { required: true }
        },
        slug: {
            type: "string",
            name: "URL Slug",
            validation: { required: true, unique: true }
        },
        author: {
            type: "relation",
            name: "Author",
            relationName: "author"
        },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "draft", label: "Draft", color: "gray" },
                { id: "review", label: "In Review", color: "orange" },
                { id: "published", label: "Published", color: "green" }
            ],
            defaultValue: "draft"
        },
        cover_image: {
            type: "string",
            name: "Cover Image",
            storage: {
                storagePath: "articles/covers",
                acceptedFiles: ["image/*"]
            }
        },
        content: {
            type: "string",
            name: "Content",
            admin: { markdown: true }
        },
        excerpt: {
            type: "string",
            name: "Excerpt",
            admin: { multiline: true },
            validation: { max: 300 }
        },
        published_at: {
            type: "date",
            name: "Published At"
        },
        created_at: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            readOnly: true
        }
    },
    relations: [
        {
            relationName: "author",
            target: () => authorsCollection,
            cardinality: "one",
            localKey: "author_id"
        },
        {
            relationName: "categories",
            target: () => categoriesCollection,
            cardinality: "many",
            through: {
                table: "article_categories",
                sourceColumn: "article_id",
                targetColumn: "category_id"
            }
        }
    ],
    callbacks: {
        beforeSave: async ({ values, status }) => {
            // Auto-generate slug
            if (values.title && !values.slug) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-");
            }
            // Set published_at when publishing
            if (values.status === "published" && !values.published_at) {
                values.published_at = new Date().toISOString();
            }
            return values;
        }
    },
    securityRules: [
        { operation: "select", using: "{status} = 'published'" },
        { operation: "select", ownerField: "author_id" },
        { operations: ["insert", "update"], ownerField: "author_id" },
        { operation: "delete", roles: ["admin"] }
    ],
    admin: {
        icon: "article",
        defaultViewMode: "table"
    }
};

```

## Configuration

1. Ajoutez les trois collections à votre fichier `config/collections/index.ts`
2. Exécutez `rebase schema generate`
3. Exécutez `rebase db push`
4. Redémarrez le serveur de développement

Vous disposez maintenant d'un CMS de blog entièrement fonctionnel avec :
- Gestion des auteurs avec téléchargement d'avatars
- Tagging de catégories via des relations plusieurs-à-plusieurs
- Édition de contenu Markdown
- Flux de travail Brouillon → Révision → Publié
- Slugs d'URL auto-générés
- Politiques RLS limitant les auteurs à leurs propres publications
- Journal d'audit complet via l'historique des entités

## Interrogation depuis le SDK

Utilisez le SDK client pour récupérer des articles avec leurs relations :

```typescript
// The row shape you expect back — without it every field arrives as `unknown`.
type Article = {
    title: string;
    status: string;
    published_at?: string | null;
    author_id: string;
    author?: { name: string };
    categories?: { name: string }[];
};

// Fetch published articles with author and categories included
const { data: articles } = await client.data
    .collection<Article>("articles")
    .where("status", "==", "published")
    .include("author", "categories")
    .orderBy("published_at", "desc")
    .limit(10)
    .find();

// Rows come back flat — there is no `values` wrapper on the SDK.
for (const article of articles) {
    console.log(article.title);
    console.log(article.author?.name);    // Hydrated relation
    console.log(article.author_id);       // Scalar FK
    console.log(article.categories);      // Array of related entities
}
```
