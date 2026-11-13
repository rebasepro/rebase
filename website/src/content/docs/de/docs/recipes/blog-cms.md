---
sourceHash: 0c385399c3a984b7
title: "Rezept: Blog-CMS"
sidebar_label: Blog-CMS
description: Erstellen Sie ein vollständiges Blog-CMS mit Artikeln, Autoren, Kategorien, Rich-Text-Bearbeitung und Bild-Uploads – Tabellen in backend/schema, Darstellung in frontend/src/cms.
---

## Übersicht

Erstellen Sie ein Blog-Backend mit:
- **Artikeln** mit Markdown-Inhalten und Titelbildern
- **Autoren** mit Profilen
- **Kategorien** mit einer Many-to-Many-Relation

## Tabellen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Drei Dateien in `backend/schema/`. Sie definieren, was die Datenbank und die API
durchsetzen; wie das Admin-Panel sie darstellt, folgt danach im Frontend.

### Autoren

<span class="since-badge" data-since="0.31">Seit 0.31</span>

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

### Kategorien

<span class="since-badge" data-since="0.31">Seit 0.31</span>

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

### Artikel

<span class="since-badge" data-since="0.31">Seit 0.31</span>

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

`rls: "inherit"` bei Autoren und Kategorien übernimmt das `defaultRls`, das Ihre
`backend/schema/index.ts` exportiert – im Scaffold darf jeder lesen und Admins
dürfen schreiben.

### Wer veröffentlichen kann

Der Workflow besteht aus der `status`-Spalte plus den obigen Regeln, und Postgres
setzt ihn durch, sodass er für das Admin-Panel, die REST-API und das SDK gleichermaßen gilt:

- Ein **Writer** erstellt Artikel und verschiebt die eigenen zwischen `draft` und
  `review`. Das Speichern als `published` wird verweigert, ebenso wie das Bearbeiten eines
  Artikels, sobald er veröffentlicht ist.
- Ein **Editor** liest jeden Artikel, einschließlich Entwürfen, und veröffentlicht.
- **Leser**, ob angemeldet oder nicht, sehen nur veröffentlichte Artikel. Anonyme Lesezugriffe
  erfordern `AUTH_REQUIRE=false` im Backend; siehe
  [Öffentlicher Zugriff](/docs/collections/security-rules/#public-access).

`writer` und `editor` sind Einträge in den `roles` eines Benutzers. Wenn Sie mit dem
Scaffold begonnen haben, fügen Sie `writer` zu den Rollenoptionen der `roles`-Spalte in
`backend/schema/users.ts` hinzu.

## Wie das Panel sie anzeigt

<span class="since-badge" data-since="0.31">Seit 0.31</span>

Das Admin-Panel rendert alle drei ohne weiteren Code. Diese Dateien in
`frontend/src/cms/` fügen die Icons, die Enum-Farben und die Editoren hinzu:

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

## Einrichtung

<span class="since-badge" data-since="0.31">Seit 0.31</span>

1. Speichern Sie die drei Tabellendateien in `backend/schema/` und exportieren Sie sie aus
   `backend/schema/index.ts` – ein `defineTable`, das der Index nicht exportiert,
   verhindert den Systemstart.
2. Speichern Sie die Anpassungsdateien in `frontend/src/cms/` und fügen Sie sie zu
   `<RebaseCMS tableCustomizations={[articlesCms, authorsCms]}>` in `App.tsx` hinzu.
3. Wenn `rebase dev` läuft, ist das schon alles: Das Speichern generiert das Schema neu,
   startet das Backend neu, und beim Hochfahren werden die Tabellen, die Verknüpfungstabelle und
   ihre Row-Level-Security-Policies erstellt. Führen Sie außerhalb von `rebase dev` mit Ihrer eigenen
   PostgreSQL-Instanz `rebase schema generate` und anschließend `rebase db push` aus.

Sie haben nun ein voll funktionsfähiges Blog-CMS mit:
- Autorenverwaltung mit Avatar-Uploads
- Kategorie-Tagging über Many-to-Many-Relationen
- Markdown-Inhaltsbearbeitung
- Einem Draft → Review → Published-Workflow, bei dem nur ein Editor veröffentlicht,
  durchgesetzt von Postgres
- Automatisch generierten URL-Slugs
- Writern, die auf ihre eigenen Artikel beschränkt sind, und Entwürfen, die vor öffentlichen Lesezugriffen geschützt sind
- Vollständigem Prüfpfad (Audit-Trail) durch die Entitätshistorie

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

## Verwandte Themen

<span class="since-badge" data-since="0.31">Seit 0.31</span>

- [Tabellen](/docs/schema/) – die `defineTable`-API, die dieses Rezept verwendet
- [Anpassen einer Tabelle](/docs/frontend/customize-table/) – die Panel-Seite
- [Relationen](/docs/collections/relations/) – die Autoren- und Tag-Verknüpfungen im Detail
- [Row-Level-Security](/docs/collections/security-rules/) – Veröffentlichen, ohne Entwürfe offenzulegen
