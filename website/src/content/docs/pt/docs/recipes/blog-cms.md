---
title: "Receita: CMS de Blog"
sidebar_label: CMS de Blog
slug: pt/docs/recipes/blog-cms
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
import { EntityCollection } from "@rebasepro/types";

export const authorsCollection: EntityCollection = {
    slug: "authors",
    name: "Autores",
    singularName: "Autor",
    table: "authors",
    icon: "person",
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
            multiline: true
        }
    }
};
```

### Categorias

```typescript
export const categoriesCollection: EntityCollection = {
    slug: "categories",
    name: "Categorias",
    singularName: "Categoria",
    table: "categories",
    icon: "label",
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
                { id: "blue", label: "Azul", color: "blueDark" },
                { id: "green", label: "Verde", color: "greenDark" },
                { id: "red", label: "Vermelho", color: "pinkDark" },
                { id: "orange", label: "Laranja", color: "orangeDark" }
            ]
        }
    }
};
```

### Artigos

```typescript
export const articlesCollection: EntityCollection = {
    slug: "articles",
    name: "Artigos",
    singularName: "Artigo",
    table: "articles",
    icon: "article",
    defaultViewMode: "table",
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
                { id: "draft", label: "Rascunho", color: "grayDark" },
                { id: "review", label: "Em Revisão", color: "orangeDark" },
                { id: "published", label: "Publicado", color: "greenDark" }
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
            markdown: true
        },
        excerpt: {
            type: "string",
            name: "Excerto",
            multiline: true,
            validation: { max: 300 }
        },
        published_at: {
            type: "date",
            name: "Publicado Em"
        },
        created_at: {
            type: "date",
            name: "Criado Em",
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
            // Gerar slug automaticamente
            if (values.title && !values.slug) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-");
            }
            // Definir published_at ao publicar
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
    ]
};
```

## Configuração

1. Adicione as três coleções ao seu `shared/collections/index.ts`
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
    .orderBy("published_at", "desc")
    .limit(10)
    .find();

for (const article of articles) {
    console.log(article.values.title);
    console.log(article.values.author?.name);    // Relação hidratada
    console.log(article.values.author_id);       // Chave Estrangeira Escalar
    console.log(article.values.categories);      // Array de entidades relacionadas
}
```
