---
sourceHash: 9b3f0b6b9519064a
title: "Ricetta: Blog CMS"
sidebar_label: Blog CMS
description: Crea un CMS completo per blog con articoli, autori, categorie, editing rich text e caricamento di immagini.
---

## Panoramica

Crea un backend per blog con:
- **Articoli** con contenuti in markdown e immagini di copertina
- **Autori** con profili
- **Categorie** con una relazione molti-a-molti

## Collezioni

### Autori

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

### Categorie

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

### Articoli

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

### Chi può pubblicare

Il flusso di lavoro è il campo `status` più le regole qui sopra, e lo applica
Postgres, quindi vale allo stesso modo per il pannello di amministrazione, l'API
REST e l'SDK:

- Un **redattore** (`writer`) crea articoli e sposta i propri tra `draft` e
  `review`. Salvarne uno come `published` viene rifiutato, così come modificare
  un articolo già pubblicato.
- Un **editor** legge ogni articolo, bozze comprese, e pubblica.
- I **lettori**, autenticati o no, vedono solo gli articoli pubblicati. Le
  letture anonime richiedono `AUTH_REQUIRE=false` nel backend; vedi
  [Accesso pubblico](/docs/collections/security-rules/#public-access).

`writer` ed `editor` sono voci nei `roles` di un utente. Se sei partito dallo
scaffold, aggiungi `writer` alle opzioni di ruolo in `config/collections/users.ts`.

## Configurazione

1. Salva i tre file in `config/collections/` — `authors.ts`, `categories.ts` e `articles.ts`; ciascuno deve esportare la propria collezione come export predefinito (default export), altrimenti l'avvio rifiuta la cartella. Aggiungili all'array `collections`
   in `config/collections/index.ts` per scegliere dove compaiono nella
   navigazione — ogni file nella cartella viene comunque caricato.
2. Con `rebase dev` in esecuzione è tutto: salvare rigenera lo schema, riavvia
   il backend, e l'avvio crea le tabelle, la tabella di giunzione e le relative
   policy di row-level security. Fuori da `rebase dev`, contro il tuo stesso
   PostgreSQL, esegui `rebase schema generate` e poi `rebase db push`.

Ora disponi di un CMS per blog completamente funzionante con:
- Gestione degli autori con caricamento degli avatar
- Assegnazione dei tag tramite categorie con relazioni molti-a-molti
- Modifica dei contenuti in markdown
- Un flusso di lavoro Bozza → Revisione → Pubblicato in cui solo un editor
  pubblica, applicato da Postgres
- Slug URL generati automaticamente
- Redattori limitati ai propri articoli, e bozze escluse dalle letture pubbliche
- Audit trail completo tramite la cronologia delle entità

## Esecuzione di query dall'SDK

Usa l'SDK tipizzato per recuperare gli articoli con le relative relazioni:

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

## Risorse correlate

- [Definizione delle collezioni](/docs/collections/) — l'API delle collezioni utilizzata in questa guida
- [Relazioni](/docs/collections/relations/) — i collegamenti completi tra autori e tag
- [Regole di sicurezza (RLS)](/docs/collections/security-rules/) — pubblicare senza esporre le bozze
