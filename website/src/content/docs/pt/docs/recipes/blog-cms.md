---
sourceHash: b2d69a15f60b73b7
title: "Receita: CMS de Blog"
sidebar_label: CMS de Blog
description: Crie um CMS de blog completo com artigos, autores, categorias, edição de texto rico e upload de imagens.
---

## Visão Geral

Crie um backend de blog com:
- **Artigos** com conteúdo markdown e imagens de capa
- **Autores** com perfis
- **Categorias** com uma relação muitos-para-muitos

## Coleções

### Autores

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const authorsCollection = defineCollection({
    slug: "authors",
    name: "Autores",
    singularName: "Autor",
    table: "authors",
    properties: {
        name: {
            type: "string",
            name: "Nome",
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
            name: "Biografia",
            admin: { multiline: true }
        }
    },
    admin: {
        icon: "person"
    }
});

```

### Categorias

```typescript
import { defineCollection } from "@rebasepro/cms-types";
export const categoriesCollection = defineCollection({
    slug: "categories",
    name: "Categorias",
    singularName: "Categoria",
    table: "categories",
    properties: {
        name: {
            type: "string",
            name: "Nome",
            validation: { required: true }
        },
        slug: {
            type: "string",
            name: "Slug",
            validation: { required: true, unique: true }
        },
        color: {
            type: "string",
            name: "Cor",
            enum: [
                { id: "blue", label: "Azul", color: "blue" },
                { id: "green", label: "Verde", color: "green" },
                { id: "red", label: "Vermelho", color: "pink" },
                { id: "orange", label: "Laranja", color: "orange" }
            ]
        }
    },
    admin: {
        icon: "label"
    }
});

```

### Artigos

```typescript
import { defineCollection } from "@rebasepro/cms-types";
// The row shape, so callbacks below see typed `values` instead of `unknown`.
type Article = {
    title: string;
    slug: string;
    status: string;
    publishedAt?: string | null;
};

export const articlesCollection = defineCollection({
    slug: "articles",
    name: "Artigos",
    singularName: "Artigo",
    table: "articles",
    history: true,
    properties: {
        title: {
            type: "string",
            name: "Título",
            validation: { required: true }
        },
        slug: {
            type: "string",
            name: "Slug de URL",
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
                { id: "draft", label: "Rascunho", color: "gray" },
                { id: "review", label: "Em Revisão", color: "orange" },
                { id: "published", label: "Publicado", color: "green" }
            ],
            defaultValue: "draft"
        },
        cover_image: {
            type: "string",
            name: "Imagem de Capa",
            storage: {
                storagePath: "articles/covers",
                acceptedFiles: ["image/*"]
            }
        },
        content: {
            type: "string",
            name: "Conteúdo",
            admin: { markdown: true }
        },
        excerpt: {
            type: "string",
            name: "Excerto",
            admin: { multiline: true },
            validation: { max: 300 }
        },
        publishedAt: {
            type: "date",
            name: "Publicado Em"
        },
        createdAt: {
            type: "date",
            name: "Criado Em",
            autoValue: "on_create",
            readOnly: true
        }
    },
    relations: [
        {
            kind: "belongsTo",
            relationName: "author",
            target: () => authorsCollection,
            localKey: "author_id"
        },
        {
            kind: "manyToMany",
            relationName: "categories",
            target: () => categoriesCollection,
            through: {
                table: "article_categories",
                sourceColumn: "article_id",
                targetColumn: "category_id"
            }
        }
    ],
    callbacks: {
        beforeSave: async ({ values, status }) => {
            // Gerar slug automaticamente
            if (values.title && !values.slug) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-");
            }
            // Definir publishedAt ao publicar
            if (values.status === "published" && !values.publishedAt) {
                values.publishedAt = new Date().toISOString();
            }
            return values;
        }
    },
    securityRules: [
        { operation: "select", using: "{status} = 'published'" },
        { operation: "select", ownerField: "authorId" },
        { operations: ["insert", "update"], ownerField: "authorId" },
        { operation: "delete", roles: ["admin"] }
    ],
    admin: {
        icon: "article",
        defaultViewMode: "table"
    }
});

```

## Configuração

1. Adicione as três coleções ao seu `config/collections/index.ts`
2. Execute `rebase schema generate`
3. Execute `rebase db push`
4. Reinicie o servidor de desenvolvimento

Você agora tem um CMS de blog totalmente funcional com:
- Gerenciamento de autores com upload de avatares
- Marcação de categorias via relações muitos-para-muitos
- Edição de conteúdo Markdown
- Fluxo de trabalho Rascunho → Revisão → Publicado
- Slugs de URL gerados automaticamente
- Políticas RLS limitando autores às suas próprias publicações
- Rastro de auditoria completo via histórico de entidade

## Consultando a partir do SDK

Use o SDK do cliente para buscar artigos com suas relações:

```typescript
// Buscar artigos publicados com autor e categorias incluídos
const { data: articles } = await client.data.articles
    .where("status", "==", "published")
    .include("author", "categories")
    .orderBy("publishedAt", "desc")
    .limit(10)
    .find();

for (const article of articles) {
    console.log(article.values.title);
    console.log(article.values.author?.name);    // Relação hidratada
    console.log(article.values.authorId);       // Chave Estrangeira Escalar
    console.log(article.values.categories);      // Array de entidades relacionadas
}
```
