---
title: "Receta: CMS de Blog"
sidebar_label: CMS de Blog
description: Cree un CMS de blog completo con artículos, autores, categorías, edición de texto enriquecido y carga de imágenes.
---

## Resumen

Cree un backend de blog con:
- **Artículos** con contenido Markdown e imágenes de portada
- **Autores** con perfiles
- **Categorías** con una relación de muchos a muchos

## Colecciones

### Autores

```typescript
import { CollectionConfig } from "@rebasepro/types";

export const authorsCollection: CollectionConfig = {
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
            multiline: true
        }
    },
    admin: {
        icon: "person"
    }
};

```

### Categorías

```typescript
export const categoriesCollection: CollectionConfig = {
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
                { id: "blue", label: "Blue", color: "blueDark" },
                { id: "green", label: "Green", color: "greenDark" },
                { id: "red", label: "Red", color: "pinkDark" },
                { id: "orange", label: "Orange", color: "orangeDark" }
            ]
        }
    },
    admin: {
        icon: "label"
    }
};

```

### Artículos

```typescript
export const articlesCollection: CollectionConfig = {
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
            relationName: "author"
        },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "draft", label: "Draft", color: "grayDark" },
                { id: "review", label: "In Review", color: "orangeDark" },
                { id: "published", label: "Published", color: "greenDark" }
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
            markdown: true
        },
        excerpt: {
            type: "string",
            name: "Excerpt",
            multiline: true,
            validation: { max: 300 }
        },
        published_at: {
            type: "date",
            name: "Published At"
        },
        created_at: {
            type: "date",
            name: "Created At",
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
    ],
    admin: {
        icon: "article",
        defaultViewMode: "table"
    }
};

```

## Configuración

1. Agregue las tres colecciones a su `config/collections/index.ts`
2. Ejecute `rebase schema generate`
3. Ejecute `rebase db push`
4. Reinicie el servidor de desarrollo

Ahora tiene un CMS de blog completamente funcional con:
- Gestión de autores con carga de avatares
- Etiquetado de categorías a través de relaciones de muchos a muchos
- Edición de contenido Markdown
- Flujo de trabajo Borrador → Revisión → Publicado
- Slugs de URL generados automáticamente
- Políticas RLS que limitan a los autores a sus propias publicaciones
- Historial de auditoría completo a través del historial de entidades

## Consultando desde el SDK

Utilice el SDK del cliente para buscar artículos con sus relaciones:

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
