---
sourceHash: 0c385399c3a984b7
title: "Receta: Blog CMS"
sidebar_label: Blog CMS
description: Crea un CMS de blog completo con artículos, autores, categorías, edición de texto enriquecido y subida de imágenes — tablas en backend/schema, presentación en frontend/src/cms.
---

## Visión general

Crea un backend de blog con:
- **Artículos** con contenido en markdown e imágenes de portada
- **Autores** con perfiles
- **Categorías** con una relación de muchos a muchos

## Tablas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Tres archivos en `backend/schema/`. Contienen lo que la base de datos y la API
hacen cumplir; cómo los presenta el panel de administración viene después, en el frontend.

### Autores

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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

### Categorías

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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

### Artículos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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

`rls: "inherit"` en autores y categorías toma el `defaultRls` que exporta tu
`backend/schema/index.ts`; en el scaffold, todos leen y los administradores
escriben.

### Quién puede publicar

El flujo de trabajo consiste en la columna `status` más las reglas anteriores, y Postgres
lo hace cumplir, por lo que aplica por igual al panel de administración, la API REST y el SDK:

- Un **writer** crea artículos y mueve los suyos entre `draft` y
  `review`. Se rechaza guardar uno como `published`, así como editar un artículo
  una vez publicado.
- Un **editor** lee todos los artículos, incluidos los borradores, y publica.
- Los **lectores**, hayan iniciado sesión o no, solo ven artículos publicados. Las lecturas
  anónimas requieren `AUTH_REQUIRE=false` en el backend; consulta
  [Acceso público](/docs/collections/security-rules/#public-access).

`writer` y `editor` son entradas en los `roles` de un usuario. Si empezaste desde el
scaffold, añade `writer` a las opciones de rol de la columna `roles` en
`backend/schema/users.ts`.

## Cómo los muestra el panel

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El panel de administración renderiza los tres sin necesidad de código adicional. Estos archivos en
`frontend/src/cms/` añaden los iconos, los colores de los enums y los editores:

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

## Configuración

<span class="since-badge" data-since="0.31">Desde 0.31</span>

1. Guarda los tres archivos de tabla en `backend/schema/` y expórtalos desde
   `backend/schema/index.ts`: un `defineTable` que el index no exporte
   impedirá el arranque.
2. Guarda los archivos de personalización en `frontend/src/cms/` y añádelos a
   `<RebaseCMS tableCustomizations={[articlesCms, authorsCms]}>` en `App.tsx`.
3. Con `rebase dev` en ejecución, eso es todo: al guardar se regenera el esquema,
   se reinicia el backend y el arranque crea las tablas, la tabla de unión y
   sus políticas de seguridad a nivel de fila. Fuera de `rebase dev`, contra tu
   propio PostgreSQL, ejecuta `rebase schema generate` y luego `rebase db push`.

Ahora tienes un CMS de blog completamente funcional con:
- Gestión de autores con subida de avatares
- Etiquetado de categorías mediante relaciones de muchos a muchos
- Edición de contenido en markdown
- Un flujo de trabajo Borrador → Revisión → Publicado en el que solo un editor publica,
  garantizado por Postgres
- Slugs de URL generados automáticamente
- Escritores limitados a sus propios artículos y borradores protegidos de lecturas públicas
- Registro de auditoría completo a través del historial de entidades

## Consultas desde el SDK

Usa el SDK tipado para obtener artículos con sus relaciones:

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


## Relacionado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Tablas](/docs/schema/) — la API `defineTable` que utiliza esta receta
- [Personalizar una tabla](/docs/frontend/customize-table/) — la parte del panel
- [Relaciones](/docs/collections/relations/) — los enlaces de autor y etiquetas, al detalle
- [Seguridad a nivel de fila](/docs/collections/security-rules/) — publicar sin exponer borradores
