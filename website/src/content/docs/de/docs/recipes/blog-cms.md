---
title: "Rezept: Blog-CMS"
sidebar_label: Blog-CMS
slug: de/docs/recipes/blog-cms
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
import { EntityCollection } from "@rebasepro/types";

export const authorsCollection: EntityCollection = {
    slug: "authors",
    name: "Authors",
    singularName: "Author",
    table: "authors",
    icon: "person",
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
            multiline: true
        }
    }
};
```

### Kategorien

```typescript
export const categoriesCollection: EntityCollection = {
    slug: "categories",
    name: "Categories",
    singularName: "Category",
    table: "categories",
    icon: "label",
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
                { id: "blue", label: "Blau", color: "blueDark" },
                { id: "green", label: "Grün", color: "greenDark" },
                { id: "red", label: "Rot", color: "pinkDark" },
                { id: "orange", label: "Orange", color: "orangeDark" }
            ]
        }
    }
};
```

### Artikel

```typescript
export const articlesCollection: EntityCollection = {
    slug: "articles",
    name: "Articles",
    singularName: "Article",
    table: "articles",
    icon: "article",
    defaultViewMode: "table",
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
                { id: "draft", label: "Entwurf", color: "grayDark" },
                { id: "review", label: "In Überprüfung", color: "orangeDark" },
                { id: "published", label: "Veröffentlicht", color: "greenDark" }
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
            markdown: true
        },
        excerpt: {
            type: "string",
            name: "Auszug",
            multiline: true,
            validation: { max: 300 }
        },
        published_at: {
            type: "date",
            name: "Veröffentlicht am"
        },
        created_at: {
            type: "date",
            name: "Erstellt am",
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
    ]
};
```

## Einrichtung

1. Fügen Sie alle drei Sammlungen zu Ihrer `shared/collections/index.ts` hinzu
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
