---
sourceHash: 9b3f0b6b9519064a
title: "Receita: CMS de Blog"
sidebar_label: CMS de Blog
description: Crie um CMS de blog completo com artigos, autores, categorias, edição de rich text e upload de imagens.
---

## Visão Geral

Construa um backend de blog com:
- **Artigos** com conteúdo em markdown e imagens de capa
- **Autores** com perfis
- **Categorias** com uma relação muitos-para-muitos

## Coleções

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

### Categorias

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

### Artigos

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

### Quem pode publicar

O fluxo de trabalho é o campo `status` mais as regras acima, e o Postgres o
aplica, então ele vale igualmente para o painel de administração, a API REST e
o SDK:

- Um **redator** (`writer`) cria artigos e move os seus entre `draft` e
  `review`. Salvar um como `published` é recusado, assim como editar um artigo
  já publicado.
- Um **editor** lê todos os artigos, inclusive rascunhos, e publica.
- Os **leitores**, autenticados ou não, veem apenas artigos publicados. Leituras
  anônimas precisam de `AUTH_REQUIRE=false` no backend; veja
  [Acesso Público](/docs/collections/security-rules/#public-access).

`writer` e `editor` são entradas nos `roles` de um usuário. Se você começou pelo
scaffold, adicione `writer` às opções de papel em `config/collections/users.ts`.

## Configuração

1. Salve os três arquivos em `config/collections/` — `authors.ts`, `categories.ts` e `articles.ts`; cada um deve exportar sua coleção como export padrão, ou o boot recusa o diretório. Adicione-os ao array
   `collections` em `config/collections/index.ts` para escolher onde eles
   aparecem na navegação — cada arquivo do diretório é carregado de qualquer
   forma.
2. Com o `rebase dev` em execução, é só isso: salvar regenera o esquema,
   reinicia o backend, e o arranque cria as tabelas, a tabela de junção e suas
   políticas de row-level security. Fora do `rebase dev`, contra seu próprio
   PostgreSQL, execute `rebase schema generate` e depois `rebase db push`.

Agora você tem um CMS de blog totalmente funcional com:
- Gerenciamento de autores com upload de avatares
- Marcação de categorias através de relações muitos-para-muitos
- Edição de conteúdo em Markdown
- Um fluxo de trabalho Rascunho → Revisão → Publicado em que só um editor
  publica, aplicado pelo Postgres
- Slugs de URL gerados automaticamente
- Redatores limitados aos próprios artigos, e rascunhos fora das leituras públicas
- Trilha de auditoria completa através do histórico de entidades

## Consultando a partir do SDK

Use o SDK tipado para buscar artigos com suas relações:

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


## Relacionados

- [Definindo Coleções](/docs/collections/) — a API de coleções que esta receita utiliza
- [Relações](/docs/collections/relations/) — as vinculações completas de autores e tags
- [Regras de Segurança (RLS)](/docs/collections/security-rules/) — publicando sem expor rascunhos
