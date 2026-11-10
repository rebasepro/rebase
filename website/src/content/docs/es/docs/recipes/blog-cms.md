---
sourceHash: 9b3f0b6b9519064a
title: "Receta: CMS para blog"
sidebar_label: CMS para blog
description: Construye un CMS para blog completo con artículos, autores, categorías, edición de texto enriquecido y subida de imágenes.
---

## Descripción general

Construye un backend para blog con:
- **Artículos** con contenido en markdown e imágenes de portada
- **Autores** con perfiles
- **Categorías** con una relación de muchos a muchos

## Colecciones

### Autores

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

### Categorías

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

### Artículos

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

### Quién puede publicar

El flujo de trabajo es el campo `status` más las reglas anteriores, y Postgres
lo hace cumplir, así que vale igual para el panel de administración, la API REST
y el SDK:

- Un **redactor** (`writer`) crea artículos y mueve los suyos entre `draft` y
  `review`. Guardar uno como `published` se rechaza, y también editar un
  artículo una vez publicado.
- Un **editor** lee todos los artículos, borradores incluidos, y publica.
- Los **lectores**, con sesión iniciada o no, solo ven los artículos publicados.
  Las lecturas anónimas necesitan `AUTH_REQUIRE=false` en el backend; consulta
  [Acceso público](/docs/collections/security-rules/#public-access).

`writer` y `editor` son entradas en los `roles` de un usuario. Si partiste del
scaffold, añade `writer` a las opciones de rol en `config/collections/users.ts`.

## Configuración

1. Guarda los tres archivos en `config/collections/` — `authors.ts`, `categories.ts`
   y `articles.ts`; cada uno debe exportar su colección por defecto (default export),
   o el arranque rechaza el directorio. Añádelos al array
   `collections` de `config/collections/index.ts` para elegir dónde aparecen
   en la navegación — cada archivo del directorio se carga de todos modos.
2. Con `rebase dev` en ejecución, eso es todo: guardar regenera el esquema,
   reinicia el backend y el arranque crea las tablas, la tabla de unión y sus
   políticas de seguridad a nivel de fila. Fuera de `rebase dev`, contra tu
   propio PostgreSQL, ejecuta `rebase schema generate` y luego `rebase db push`.

Ahora tienes un CMS para blog completamente funcional con:
- Gestión de autores con subida de avatares
- Etiquetado de categorías mediante relaciones de muchos a muchos
- Edición de contenido en Markdown
- Un flujo de trabajo Borrador → En revisión → Publicado en el que solo un editor
  publica, impuesto por Postgres
- Slugs de URL generados automáticamente
- Redactores limitados a sus propios artículos, y borradores fuera de las lecturas públicas
- Registro de auditoría completo mediante el historial de entidades

## Consultar desde el SDK

Utiliza el SDK tipado para obtener artículos con sus relaciones:

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


## Relacionado

- [Definición de colecciones](/docs/collections/) — la API de colecciones que utiliza esta receta
- [Relaciones](/docs/collections/relations/) — los enlaces de autor y etiquetas, en detalle
- [Reglas de seguridad (RLS)](/docs/collections/security-rules/) — cómo publicar sin exponer borradores
