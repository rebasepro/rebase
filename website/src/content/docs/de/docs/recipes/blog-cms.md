---
sourceHash: b2d69a15f60b73b7
title: "Rezept: Blog-CMS"
sidebar_label: Blog-CMS
description: Erstellen Sie ein vollständiges Blog-CMS mit Artikeln, Autoren, Kategorien, Rich-Text-Bearbeitung und Bild-Uploads.
---

## Übersicht

Erstellen Sie ein Blog-Backend mit:
- **Artikeln** mit Markdown-Inhalten und Titelbildern
- **Autoren** mit Profilen
- **Kategorien** mit einer Many-to-Many-Beziehung

## Sammlungen

### Autoren

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const authorsCollection = defineCollection({
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
            name: "E-Mail",
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
});

```

### Kategorien

```typescript
import { defineCollection } from "@rebasepro/cms-types";
export const categoriesCollection = defineCollection({
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
            name: "Farbe",
            enum: [
                { id: "blue", label: "Blau", color: "blue" },
                { id: "green", label: "Grün", color: "green" },
                { id: "red", label: "Rot", color: "pink" },
                { id: "orange", label: "Orange", color: "orange" }
            ]
        }
    },
    admin: {
        icon: "label"
    }
});

```

### Artikel

```typescript
import { defineCollection } from "@rebasepro/cms-types";
// The row shape, so callbacks below see typed `values` instead of `unknown`.
type Article = {
    title: string;
    slug: string;
    status: string;
    publishedAt?: string | null;
};

export const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    singularName: "Article",
    table: "articles",
    history: true,
    properties: {
        title: {
            type: "string",
            name: "Titel",
            validation: { required: true }
        },
        slug: {
            type: "string",
            name: "URL-Slug",
            validation: { required: true, unique: true }
        },
        author: {
            type: "relation",
            name: "Autor",
            relationName: "author"
        },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "draft", label: "Entwurf", color: "gray" },
                { id: "review", label: "In Überprüfung", color: "orange" },
                { id: "published", label: "Veröffentlicht", color: "green" }
            ],
            defaultValue: "draft"
        },
        cover_image: {
            type: "string",
            name: "Titelbild",
            storage: {
                storagePath: "articles/covers",
                acceptedFiles: ["image/*"]
            }
        },
        content: {
            type: "string",
            name: "Inhalt",
            admin: { markdown: true }
        },
        excerpt: {
            type: "string",
            name: "Auszug",
            admin: { multiline: true },
            validation: { max: 300 }
        },
        publishedAt: {
            type: "date",
            name: "Veröffentlicht am"
        },
        createdAt: {
            type: "date",
            name: "Erstellt am",
            autoValue: "on_create",
            readOnly: true
        }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => authorsCollection,
            localKey: "author_id"
        },
        {
            kind: "manyToMany",
            relationName: "categories",
            target: () => categoriesCollection,
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
            // Set publishedAt when publishing
            if (values.status === "published" && !values.publishedAt) {
                values.publishedAt = new Date().toISOString();
            }
            return values;
        }
    },
    securityRules: [
        { operation: "select", using: "{status} = 'published'" },
        { operation: "select", ownerField: "authorId" },
        { operations: ["insert", "update"], ownerField: "authorId" },
        { operation: "delete", roles: ["admin"] }
    ],
    admin: {
        icon: "article",
        defaultViewMode: "table"
    }
});

```

## Einrichtung

1. Fügen Sie alle drei Sammlungen zu Ihrer `config/collections/index.ts` hinzu
2. Run `rebase schema generate`
3. Run `rebase db push`
4. Starten Sie den Entwicklungs-Server neu

Sie verfügen nun über ein voll funktionsfähiges Blog-CMS mit:
- Autorenverwaltung mit Avatar-Uploads
- Kategorisierung über Many-to-Many-Beziehungen
- Markdown-Inhaltsbearbeitung
- Workflow: Entwurf → Überprüfung → Veröffentlicht
- Automatisch generierte URL-Slugs
- RLS-Richtlinien, die Autoren auf ihre eigenen Beiträge beschränken
- Vollständiger Prüfpfad über die Entitätshistorie

## Abfragen aus dem SDK

Verwenden Sie das Client-SDK, um Artikel mit ihren Beziehungen abzurufen:

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
    .collection<Article>("articles")
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
