---
sourceHash: 0c385399c3a984b7
title: "Receita: CMS de Blog"
sidebar_label: CMS de Blog
description: Construa um CMS de blog completo com artigos, autores, categorias, edição de rich text e upload de imagens — tabelas em backend/schema, apresentação em frontend/src/cms.
---

## Visão Geral

Construa um backend de blog com:
- **Artigos** com conteúdo em markdown e imagens de capa
- **Autores** com perfis
- **Categorias** com uma relação muitos-para-muitos (many-to-many)

## Tabelas

<span class="since-badge" data-since="0.31">Since 0.31</span>

Três arquivos em `backend/schema/`. Eles definem o que o banco de dados e a API
impõem; a forma como o painel de administração os apresenta vem depois, no frontend.

### Autores

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

### Categorias

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

### Artigos

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

`rls: "inherit"` em autores e categorias assume o `defaultRls` que o seu
`backend/schema/index.ts` exporta — no scaffold, todos leem e administradores
escrevem.

### Quem pode publicar

O fluxo de trabalho é definido pela coluna `status` somada às regras acima, e o Postgres o
impõe, aplicando-se igualmente ao painel de administração, à API REST e ao SDK:

- Um **writer** cria artigos e move os seus próprios entre `draft` e
  `review`. Salvar um como `published` é recusado, assim como editar um artigo
  depois de publicado.
- Um **editor** lê todos os artigos, incluindo rascunhos, e publica.
- **Leitores**, autenticados ou não, veem apenas artigos publicados. Leituras anônimas
  precisam de `AUTH_REQUIRE=false` no backend; consulte
  [Acesso Público](/docs/collections/security-rules/#public-access).

`writer` e `editor` são entradas nas `roles` de um usuário. Se você começou a partir do
scaffold, adicione `writer` às opções de papéis da coluna `roles` em
`backend/schema/users.ts`.

## Como o painel os exibe

<span class="since-badge" data-since="0.31">Since 0.31</span>

O painel de administração renderiza todos os três sem a necessidade de código adicional. Estes arquivos em
`frontend/src/cms/` adicionam os ícones, as cores dos enums e os editores:

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

## Configuração

<span class="since-badge" data-since="0.31">Since 0.31</span>

1. Salve os três arquivos de tabela em `backend/schema/` e exporte-os a partir de
   `backend/schema/index.ts` — um `defineTable` que o index não exporta
   recusa a inicialização.
2. Salve os arquivos de customização em `frontend/src/cms/` e adicione-os a
   `<RebaseCMS tableCustomizations={[articlesCms, authorsCms]}>` no `App.tsx`.
3. Com o `rebase dev` em execução, isso é tudo: salvar regenera o schema,
   reinicia o backend, e a inicialização cria as tabelas, a tabela de junção e
   suas políticas de segurança em nível de linha (RLS). Fora do `rebase dev`, apontando para o seu próprio
   PostgreSQL, execute `rebase schema generate` e depois `rebase db push`.

Agora você tem um CMS de blog totalmente funcional com:
- Gerenciamento de autores com upload de avatar
- Marcação de categorias através de relações muitos-para-muitos
- Edição de conteúdo em Markdown
- Um fluxo de trabalho Rascunho → Revisão → Publicado no qual apenas um editor publica,
  imposto pelo Postgres
- Slugs de URL gerados automaticamente
- Escritores limitados aos seus próprios artigos, e rascunhos mantidos fora do alcance de leituras públicas
- Trilha de auditoria completa através do histórico da entidade

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


## Relacionados

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Tabelas](/docs/schema/) — a API `defineTable` que esta receita utiliza
- [Personalizando uma tabela](/docs/frontend/customize-table/) — a parte do painel
- [Relações](/docs/collections/relations/) — os vínculos de autor e tags, em detalhes
- [Segurança em nível de linha](/docs/collections/security-rules/) — publicando sem expor rascunhos
