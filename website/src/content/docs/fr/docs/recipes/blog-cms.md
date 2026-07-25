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
            multiline: true
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
                { id: "blue", label: "Blue", color: "blueDark" },
                { id: "green", label: "Green", color: "greenDark" },
                { id: "red", label: "Red", color: "pinkDark" },
                { id: "orange", label: "Orange", color: "orangeDark" }
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
export const articlesCollection: CollectionConfig = {
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
                { id: "draft", label: "Draft", color: "grayDark" },
                { id: "review", label: "In Review", color: "orangeDark" },
                { id: "published", label: "Published", color: "greenDark" }
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
            markdown: true
        },
        excerpt: {
            type: "string",
            name: "Excerpt",
            multiline: true,
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
                values.published_at = new Date();
            }
            return values;
        }
    },
    securityRules: [
        { operation: "select", access: "public", using: "{status} = 'published'" },
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
// Fetch published articles with author and categories included
const { data: articles } = await client.data.articles
    .where("status", "==", "published")
    .include("author", "categories")
    .orderBy("published_at", "desc")
    .limit(10)
    .find();

for (const article of articles) {
    console.log(article.values.title);
    console.log(article.values.author?.name);    // Hydrated relation
    console.log(article.values.author_id);       // Scalar FK
    console.log(article.values.categories);      // Array of related entities
}
```
