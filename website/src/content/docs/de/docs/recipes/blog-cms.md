---
sourceHash: 9b3f0b6b9519064a
title: "Rezept: Blog-CMS"
sidebar_label: Blog-CMS
description: Erstellen Sie ein vollständiges Blog-CMS mit Artikeln, Autoren, Kategorien, Rich-Text-Bearbeitung und Bild-Uploads.
---

## Übersicht

Erstellen Sie ein Blog-Backend mit:
- **Artikeln** mit Markdown-Inhalt und Titelbildern
- **Autoren** mit Profilen
- **Kategorien** mit einer Many-to-Many-Beziehung

## Collections

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
});

export default authorsCollection;
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
});

export default categoriesCollection;
```

### Artikel

```typescript
import { defineCollection } from "@rebasepro/cms-types";
import { policy } from "@rebasepro/types";
import authorsCollection from "./authors";
import categoriesCollection from "./categories";
// The row shape, so callbacks below see typed `values` instead of `unknown`.
type Article = {
    title: string;
    slug: string;
    status: string;
    publishedAt?: Date | null;
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
            relation: {
                kind: "belongsTo",
                target: () => authorsCollection,
                localKey: "author_id"
            }
        },
        categories: {
            type: "relation",
            name: "Categories",
            relation: {
                kind: "manyToMany",
                target: () => categoriesCollection,
                through: {
                    table: "article_categories",
                    sourceColumn: "article_id",
                    targetColumn: "category_id"
                }
            }
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
        publishedAt: {
            type: "date",
            name: "Published At"
        },
        createdAt: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            admin: { readOnly: true }
        },
        // The signed-in user who created the article, stamped by the server.
        // `author` is the byline; this is who may keep editing the draft.
        createdBy: {
            type: "string",
            name: "Created by",
            autoValue: "user_on_create",
            admin: { readOnly: true }
        }
    },
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
                // `publishedAt` is a `date` property, so its value is a Date.
                values.publishedAt = new Date();
            }
            return values;
        }
    },
    securityRules: [
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
            )
        },
        { operation: "delete", roles: ["admin"] }
    ],
    admin: {
        icon: "article",
        defaultViewMode: "table"
    }
});

export default articlesCollection;
```

### Wer veröffentlichen darf

Der Workflow besteht aus dem Feld `status` und den obigen Regeln, und Postgres
setzt ihn durch – er gilt also gleichermaßen für das Admin-Panel, die REST-API
und das SDK:

- Ein **Autor** (`writer`) legt Artikel an und verschiebt seine eigenen zwischen
  `draft` und `review`. Einen als `published` zu speichern wird abgelehnt, ebenso
  das Bearbeiten eines bereits veröffentlichten Artikels.
- Ein **Editor** liest jeden Artikel, auch Entwürfe, und veröffentlicht.
- **Leser**, ob angemeldet oder nicht, sehen nur veröffentlichte Artikel. Anonyme
  Lesezugriffe benötigen `AUTH_REQUIRE=false` im Backend; siehe
  [Öffentlicher Zugriff](/docs/collections/security-rules/#public-access).

`writer` und `editor` sind Einträge in den `roles` eines Benutzers. Wenn Sie mit
dem Scaffold begonnen haben, fügen Sie `writer` den Rollenoptionen in
`config/collections/users.ts` hinzu.

## Einrichtung

1. Speichern Sie die drei Dateien in `config/collections/` — `authors.ts`, `categories.ts`
   und `articles.ts`; jede muss ihre Collection per Default-Export exportieren, sonst
   verweigert der Bootvorgang das Verzeichnis. Fügen Sie sie dem
   `collections`-Array in `config/collections/index.ts` hinzu, um zu bestimmen,
   wo sie in der Navigation erscheinen — jede Datei im Verzeichnis wird in
   jedem Fall geladen.
2. Bei laufendem `rebase dev` ist das bereits alles: Speichern regeneriert das
   Schema, startet das Backend neu, und der Bootvorgang erstellt die Tabellen,
   die Verknüpfungstabelle und deren Row-Level-Security-Policies. Außerhalb von
   `rebase dev`, gegen Ihr eigenes PostgreSQL, führen Sie `rebase schema generate`
   und anschließend `rebase db push` aus.

Sie verfügen nun über ein voll funktionsfähiges Blog-CMS mit:
- Autorenverwaltung mit Avatar-Uploads
- Kategorie-Tagging über Many-to-Many-Beziehungen
- Markdown-Inhaltsbearbeitung
- Ein Draft → Review → Published-Workflow, in dem nur ein Editor veröffentlicht,
  durchgesetzt von Postgres
- Automatisch generierten URL-Slugs
- Autoren auf ihre eigenen Artikel beschränkt, und Entwürfe aus öffentlichen Lesezugriffen herausgehalten
- Vollständigem Audit-Trail durch Entity-Historie

## Abfragen über das SDK

Verwenden Sie das typisierte SDK, um Artikel mit ihren Relationen abzurufen:

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


## Verwandte Themen

- [Definieren von Collections](/docs/collections/) — die Collection-API, die dieses Rezept verwendet
- [Relationen](/docs/collections/relations/) — die Autoren- und Tag-Verknüpfungen im Detail
- [Sicherheitsregeln (RLS)](/docs/collections/security-rules/) — Veröffentlichen, ohne Entwürfe preiszugeben
