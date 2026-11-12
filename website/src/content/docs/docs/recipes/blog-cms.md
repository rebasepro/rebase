---
title: "Recipe: Blog CMS"
sidebar_label: Blog CMS
description: Build a complete blog CMS with articles, authors, categories, rich text editing, and image uploads — tables in backend/schema, presentation in frontend/src/cms.
---

## Overview

Build a blog backend with:
- **Articles** with markdown content and cover images
- **Authors** with profiles
- **Categories** with a many-to-many relation

## Tables

<span class="since-badge" data-since="0.31">Since 0.31</span>

Three files in `backend/schema/`. They hold what the database and the API
enforce; how the admin panel presents them comes after, in the frontend.

### Authors

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

### Categories

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
        publishedAt: col.timestamptz(),
        createdAt:   col.timestamptz().onCreateNow(),
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

`rls: "inherit"` on authors and categories takes the `defaultRls` your
`backend/schema/index.ts` exports — in the scaffold, everyone reads and admins
write.

### Who can publish

The workflow is the `status` column plus the rules above, and Postgres enforces
it, so it holds for the admin panel, the REST API and the SDK alike:

- A **writer** creates articles and moves their own between `draft` and
  `review`. Saving one as `published` is refused, and so is editing an article
  once it is published.
- An **editor** reads every article, including drafts, and publishes.
- **Readers**, signed in or not, see only published articles. Anonymous reads
  need `AUTH_REQUIRE=false` on the backend; see
  [Public Access](/docs/collections/security-rules/#public-access).

`writer` and `editor` are entries in a user's `roles`. If you started from the
scaffold, add `writer` to the role options of the `roles` column in
`backend/schema/users.ts`.

## How the panel shows them

<span class="since-badge" data-since="0.31">Since 0.31</span>

The admin panel renders all three with no further code. These files in
`frontend/src/cms/` add the icons, the enum colours and the editors:

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

## Setup

<span class="since-badge" data-since="0.31">Since 0.31</span>

1. Save the three table files in `backend/schema/` and export them from
   `backend/schema/index.ts` — a `defineTable` the index does not export
   refuses the boot.
2. Save the customization files in `frontend/src/cms/` and add them to
   `<RebaseCMS tableCustomizations={[articlesCms, authorsCms]}>` in `App.tsx`.
3. With `rebase dev` running, that is all: saving regenerates the schema,
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


## Related

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Tables](/docs/schema/) — the `defineTable` API this recipe uses
- [Customizing a table](/docs/frontend/customize-table/) — the panel side
- [Relations](/docs/collections/relations/) — the author and tag links, in full
- [Row-level security](/docs/collections/security-rules/) — publishing without exposing drafts
