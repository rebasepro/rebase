---
sourceHash: 0c385399c3a984b7
title: "Ricetta: Blog CMS"
sidebar_label: Blog CMS
description: Crea un CMS completo per blog con articoli, autori, categorie, rich text editing e caricamento immagini — tabelle in backend/schema, presentazione in frontend/src/cms.
---

## Panoramica

Crea un backend per un blog con:
- **Articoli** con contenuti markdown e immagini di copertina
- **Autori** con profili
- **Categorie** con una relazione molti-a-molti

## Tabelle

<span class="since-badge" data-since="0.31">Da 0.31</span>

Tre file in `backend/schema/`. Definiscono ciò che il database e l'API impongono; il modo in cui il pannello di amministrazione li presenta viene dopo, nel frontend.

### Autori

<span class="since-badge" data-since="0.31">Da 0.31</span>

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

### Categorie

<span class="since-badge" data-since="0.31">Da 0.31</span>

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

### Articoli

<span class="since-badge" data-since="0.31">Da 0.31</span>

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

`rls: "inherit"` su autori e categorie adotta il `defaultRls` esportato da `backend/schema/index.ts` — nello scaffold, tutti possono leggere e gli admin possono scrivere.

### Chi può pubblicare

Il workflow è definito dalla colonna `status` e dalle regole sopra indicate, ed è applicato direttamente da Postgres, per cui ha valore allo stesso modo per il pannello di amministrazione, l'API REST e l'SDK:

- Un **writer** crea articoli e sposta i propri tra `draft` e `review`. Il salvataggio di un articolo come `published` viene rifiutato, così come la modifica di un articolo una volta pubblicato.
- Un **editor** legge qualsiasi articolo, comprese le bozze, e pubblica.
- I **lettori**, autenticati o meno, vedono solo gli articoli pubblicati. Le letture anonime richiedono `AUTH_REQUIRE=false` sul backend; consulta [Accesso pubblico](/docs/collections/security-rules/#public-access).

`writer` ed `editor` sono valori nei `roles` di un utente. Se sei partito dallo scaffold, aggiungi `writer` alle opzioni di ruolo della colonna `roles` in `backend/schema/users.ts`.

## Come vengono mostrati nel pannello

<span class="since-badge" data-since="0.31">Da 0.31</span>

Il pannello di amministrazione esegue il rendering di tutti e tre senza ulteriore codice. Questi file in `frontend/src/cms/` aggiungono le icone, i colori degli enum e gli editor:

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

## Configurazione

<span class="since-badge" data-since="0.31">Da 0.31</span>

1. Salva i tre file delle tabelle in `backend/schema/` ed esportali da `backend/schema/index.ts` — una `defineTable` non esportata dall'index bloccherà l'avvio.
2. Salva i file di personalizzazione in `frontend/src/cms/` e aggiungili a `<RebaseCMS tableCustomizations={[articlesCms, authorsCms]}>` in `App.tsx`.
3. Con `rebase dev` in esecuzione, questo è tutto: il salvataggio rigenera lo schema, riavvia il backend e all'avvio vengono create le tabelle, la tabella di giunzione e le relative policy di row-level security. Al di fuori di `rebase dev`, sul tuo database PostgreSQL, esegui `rebase schema generate` e poi `rebase db push`.

Ora hai a disposizione un CMS per blog completamente funzionale con:
- Gestione degli autori con caricamento degli avatar
- Assegnazione di categorie tramite relazioni molti-a-molti
- Modifica dei contenuti in Markdown
- Un workflow Draft → Review → Published in cui solo un editor può pubblicare, applicato a livello di Postgres
- Slug degli URL generati automaticamente
- Autori limitati ai propri articoli e bozze escluse dalle letture pubbliche
- Tracciamento completo delle modifiche (audit trail) tramite la cronologia delle entità

## Eseguire query tramite l'SDK

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


## Correlati

<span class="since-badge" data-since="0.31">Da 0.31</span>

- [Tabelle](/docs/schema/) — l'API `defineTable` utilizzata in questa ricetta
- [Personalizzare una tabella](/docs/frontend/customize-table/) — la parte relativa al pannello
- [Relazioni](/docs/collections/relations/) — i collegamenti tra autori e tag, in dettaglio
- [Row-level security](/docs/collections/security-rules/) — pubblicare senza esporre le bozze
