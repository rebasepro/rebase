---
title: "Recipe: Blog CMS"
sidebar_label: Blog CMS
description: Build a complete blog CMS with articles, authors, categories, rich text editing, and image uploads.
---

## Overview

Build a blog backend with:
- **Articles** with markdown content and cover images
- **Authors** with profiles
- **Categories** with a many-to-many relation

## Collections

### Authors

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

### Categories

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

### Articles

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

### Who can publish

The workflow is the `status` field plus the rules above, and Postgres enforces
it, so it holds for the admin panel, the REST API and the SDK alike:

- A **writer** creates articles and moves their own between `draft` and
  `review`. Saving one as `published` is refused, and so is editing an article
  once it is published.
- An **editor** reads every article, including drafts, and publishes.
- **Readers**, signed in or not, see only published articles. Anonymous reads
  need `AUTH_REQUIRE=false` on the backend; see
  [Public Access](/docs/collections/security-rules/#public-access).

`writer` and `editor` are entries in a user's `roles`. If you started from the
scaffold, add `writer` to the role options in `config/collections/users.ts`.

## Setup

1. Save the three files in `config/collections/` — `authors.ts`, `categories.ts`
   and `articles.ts`; each one must default-export its collection, or boot
   refuses the directory. Add them to the `collections`
   array in `config/collections/index.ts` to choose where they appear in the
   navigation — every file in the directory is loaded either way.
2. With `rebase dev` running, that is all: saving regenerates the schema,
   restarts the backend, and boot creates the tables, the junction table and
   their row-level security policies. Outside `rebase dev`, against your own
   PostgreSQL, run `rebase schema generate` and then `rebase db push`.

You now have a fully functional blog CMS with:
- Author management with avatar uploads
- Category tagging via many-to-many relations
- Markdown content editing
- A Draft → Review → Published workflow in which only an editor publishes,
  enforced by Postgres
- Auto-generated URL slugs
- Writers limited to their own articles, and drafts kept out of public reads
- Full audit trail through entity history

## Querying from the SDK

Use the typed SDK to fetch articles with their relations:

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


## Related

- [Defining Collections](/docs/collections/) — the collection API this recipe uses
- [Relations](/docs/collections/relations/) — the author and tag links, in full
- [Security Rules (RLS)](/docs/collections/security-rules/) — publishing without exposing drafts
