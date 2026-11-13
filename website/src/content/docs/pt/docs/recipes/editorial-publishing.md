---
sourceHash: c858a7a8e7622cee
title: "Receita: Publicação editorial"
sidebar_label: Publicação editorial
description: "Execute um blog ou redação no Rebase: redatores e editores, revisão, publicação agendada, rascunhos de posts ativos, pré-visualizações, traduções, biblioteca de mídia, blocos de conteúdo, feeds, notas editoriais e importação do WordPress."
---

## Visão geral

<span class="since-badge" data-since="0.31">Since 0.31</span>

Esta receita desenvolve o lado editorial de uma publicação no Rebase. Cada parte é
um ponto de extensão documentado, permitindo que você aproveite apenas as partes necessárias:

| Você obtém | Construído com |
|---|---|
| Redatores criam rascunhos, editores agendam e publicam, aplicado pelo Postgres | [Segurança a nível de linha](/docs/collections/security-rules/) |
| Um quadro por status, com botões Enviar e Publicar | [Visualização Kanban](/docs/frontend/view-modes/), [ações de entidade](/docs/frontend/entity-actions/) |
| Publicação e despublicação agendadas | Um [cron job](/docs/backend/cron-jobs/) |
| Edite um post ativo sem alterá-lo até publicar | Uma tabela de rascunhos e duas ações de entidade |
| Uma pré-visualização de alterações não salvas | Uma [visualização de entidade](/docs/frontend/entity-views/) |
| Traduções, campos de SEO, blocos de conteúdo | Colunas JSON com um formato ([Documentos JSON](/docs/schema/json/)) |
| Uma biblioteca de mídia com texto alternativo e créditos | Uma tabela `media` e uma relação |
| RSS, um sitemap e uma API pública de leitura | Uma [função customizada](/docs/backend/custom-functions/) |
| Notas entre redator e editor | Uma tabela de notas e uma visualização de entidade |
| Revisões com reversão | [Histórico](/docs/backend/history/) |
| Uma importação do WordPress | Um [script](/docs/recipes/import-from-wordpress/) |
| Duas publicações em uma única instalação | [Tenancy](/docs/collections/tenancy/) |

Ela estende o modelo de funções (roles) da [receita de CMS de Blog](/docs/recipes/blog-cms/):
`writer` e `editor` são entradas nas `roles` de um usuário. Se você começou a partir do
scaffold, adicione `writer` às opções de role em `backend/schema/users.ts`.

Cada tabela é um arquivo em `backend/schema/`, exportado de seu `index.ts`; a forma
como o painel administrativo a apresenta — o quadro, os botões, as pré-visualizações — é um
`customizeTable` em `frontend/src/cms/`, passado para
`<RebaseCMS tableCustomizations>`.

## Mídia

<span class="since-badge" data-since="0.31">Since 0.31</span>

Uma linha por imagem, para que uma imagem seja carregada uma única vez e reutilizada, com seu texto alternativo
e crédito ao lado dela:

```ts
// backend/schema/media.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const media = defineTable("media", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        file:    col.storage({ path: "media/", accept: ["image/*"] }).notNull(),
        alt:     col.text().notNull(),
        credit:  col.text(),
        caption: col.text(),
    },
    rls: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update"], roles: ["writer", "editor"] },
    ],
});
```

Um post aponta para uma linha de mídia com uma relação, e o seletor de relações lista as
imagens que já estão na biblioteca. Quem pode fazer upload dos arquivos em si é definido
pela sua [autorização de armazenamento](/docs/backend/storage-authorization/).

## Posts

<span class="since-badge" data-since="0.31">Since 0.31</span>

```ts
// backend/schema/posts.ts
import { defineTable, col, rel, json, policy } from "@rebasepro/server/schema";
import { media } from "./media";

export const posts = defineTable("posts", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        title:       col.text().notNull(),
        slug:        col.text().notNull().unique(),
        status:      col.enum(["draft", "review", "scheduled", "published", "archived"]).default("draft"),
        publishAt:   col.timestamp({ withTimezone: true }),
        unpublishAt: col.timestamp({ withTimezone: true }),
        summary:     col.text(),
        // Content blocks: each entry names its type and holds that type's content.
        body: col.jsonb(json.array(json.oneOf({
            text:  json.object({ markdown: json.string() }),
            image: json.object({ media: json.string(), caption: json.string() }),
            quote: json.object({ text: json.string(), cite: json.string() }),
            video: json.object({ url: json.string().validate({ url: true }) }),
            html:  json.object({ html: json.string() }),
        }))),
        // One entry per language besides the default.
        translations: col.jsonb(json.object({
            es: json.object({ title: json.string(), summary: json.string(), body: json.string() }),
            fr: json.object({ title: json.string(), summary: json.string(), body: json.string() }),
        })),
        seo: col.jsonb(json.object({
            title:       json.string(),
            description: json.string().validate({ max: 160 }),
            canonical:   json.string().validate({ url: true }),
        })),
        createdBy: col.text().onCreateUser(),
        __order:   col.text(),
    },
    relations: {
        hero: rel.belongsTo(() => media),
    },
    history: true,
    rls: [
        // Readers see published posts only
        { operation: "select", using: "{status} = 'published'" },
        // Writers read and edit their own posts; editors read and edit every post
        { operations: ["select", "insert", "update"], ownerField: "createdBy", roles: ["writer"] },
        { operations: ["select", "insert", "update"], roles: ["editor"] },
        // Only an editor schedules, publishes or archives. Restrictive, so it
        // holds over every rule above: a writer saves drafts and posts in
        // review, and cannot edit a post once an editor has moved it on.
        {
            operations: ["insert", "update"],
            mode: "restrictive",
            condition: policy.or(
                policy.rolesOverlap(["editor", "admin"]),
                policy.compare(policy.field("status"), "eq", policy.literal("draft")),
                policy.compare(policy.field("status"), "eq", policy.literal("review"))
            ),
        },
        { operation: "delete", roles: ["admin"] },
    ],
});
```

E como o painel os apresenta — um quadro por status, dois botões e duas abas:

```tsx
// frontend/src/cms/posts.tsx
import { customizeTable } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";
import PostPreview from "../editorial/PostPreview";
import EditorialNotes from "../editorial/EditorialNotes";

export const postsCms = customizeTable<typeof posts>("posts", {
    icon: "Newspaper",
    defaultViewMode: "kanban",
    kanban: { columnField: "status", orderField: "__order" },
    fields: {
        summary: { multiline: true },
        createdBy: { readOnly: true },
        __order: { hidden: true, disabled: true },
        status: {
            enumLabels: {
                draft:     { label: "Draft", color: "gray" },
                review:    { label: "In review", color: "orange" },
                scheduled: { label: "Scheduled", color: "blue" },
                published: { label: "Published", color: "green" },
                archived:  { label: "Archived", color: "gray" },
            },
        },
    },
    entityActions: [
        {
            key: "submit",
            name: "Submit for review",
            icon: "Send",
            collapsed: false,
            isEnabled: ({ row }) => row?.status === "draft",
            onClick: async ({ id, context }) => {
                if (id === undefined || !context) return;
                await context.data.table("posts").update(id, { status: "review" });
            },
        },
        {
            key: "publish",
            name: "Publish",
            icon: "Upload",
            collapsed: false,
            // A convenience: the restrictive rule is what stops a writer.
            isEnabled: ({ row, context }) => row?.status === "review"
                && (context?.authController.user?.roles ?? []).some(role => role === "editor" || role === "admin"),
            onClick: async ({ id, row, context }) => {
                if (id === undefined || !context) return;
                // A post with a future publishAt waits for the cron below.
                const later = typeof row?.publishAt === "string" && new Date(row.publishAt) > new Date();
                await context.data.table("posts").update(id, { status: later ? "scheduled" : "published" });
            },
        },
    ],
    entityViews: [
        { key: "preview", name: "Preview", Builder: PostPreview },
        { key: "notes", name: "Notes", Builder: EditorialNotes },
    ],
});
```

O que cada parte faz:

- **O fluxo de trabalho.** Redatores movem seus próprios posts entre `draft` e
  `review`. Editores agendam, publicam e arquivam. O Postgres aplica isso, de modo
  que as regras se mantêm válidas tanto para o painel administrativo quanto para a API REST e o SDK. Um redator que
  tentar salvar como `published` é recusado pelo banco de dados, independentemente do que os botões
  exibam.
- **O quadro.** Os posts abrem como um quadro Kanban com uma coluna por status, e
  arrastar um card entre colunas é o mesmo salvamento, sob as mesmas regras.
- **Revisões.** `history: true` mantém um snapshot de cada salvamento, com um
  botão de reversão na aba Histórico do registro.
- **Traduções.** Uma coluna JSON com um formato recebe um grupo de campos por
  idioma no formulário. Para exibir os idiomas como abas, configure
  `translations` com um [campo customizado](/docs/frontend/custom-fields/).
- **Blocos.** `json.oneOf` como itens de um `json.array` fornece blocos tipados e
  reordenáveis armazenados como JSON. Para um editor inline como BlockNote ou
  TipTap, coloque-o atrás de um campo customizado em uma `col.jsonb()` sem formato definido; o
  JSON do editor é armazenado como está.

## Publicação agendada

Um cron job publica posts agendados quando chega a hora e arquiva
aqueles cujo `unpublishAt` já passou:

```typescript
// backend/crons/publish-scheduled.ts
import { defineCron } from "@rebasepro/server";

type Post = { id: string; status: string; publishAt: string | null; unpublishAt: string | null };

export default defineCron({
    schedule: "* * * * *", // every minute
    name: "Publish scheduled posts",

    async handler(ctx) {
        const posts = ctx.rebase.dataAsAdmin.table<Post>("posts");
        const now = new Date().toISOString();

        const { data: due } = await posts.find({
            where: { status: ["==", "scheduled"], publishAt: ["<=", now] }
        });
        for (const post of due) await posts.update(post.id, { status: "published" });

        const { data: expired } = await posts.find({
            where: { status: ["==", "published"], unpublishAt: ["<=", now] }
        });
        for (const post of expired) await posts.update(post.id, { status: "archived" });

        return { published: due.length, archived: expired.length };
    }
});
```

`dataAsAdmin` executa com a role `admin`, portanto a regra restritiva permite
a operação, e os hooks e o histórico da tabela ainda continuam sendo executados nesses salvamentos.

## Editando um post ativo

<span class="since-badge" data-since="0.31">Since 0.31</span>

Editar um post publicado altera-o ao vivo, e as regras acima impedem que um redator
o edite. Para preparar alterações e publicá-las em uma única etapa, mantenha-as
em uma segunda tabela com as mesmas colunas:

```ts
// backend/schema/post_drafts.ts
import { defineTable, col } from "@rebasepro/server/schema";
import { posts } from "./posts";

export const postDrafts = defineTable("post_drafts", {
    columns: {
        ...posts.config.columns,
        postId: col.text().readOnly(),
    },
    rls: [
        { operations: ["select", "insert", "update"], ownerField: "createdBy", roles: ["writer"] },
        { operations: ["select", "insert", "update", "delete"], roles: ["editor"] },
    ],
});
```

```tsx
// frontend/src/cms/post_drafts.tsx
import { customizeTable } from "@rebasepro/cms";
import type { postDrafts } from "../../../backend/schema/post_drafts";

export const postDraftsCms = customizeTable<typeof postDrafts>("post_drafts", {
    icon: "FilePen",
    entityActions: [
        {
            key: "apply",
            name: "Publish changes",
            icon: "Upload",
            collapsed: false,
            onClick: async ({ id, row, context }) => {
                if (id === undefined || !row || !context) return;
                // Copy everything except the draft's own bookkeeping onto the live post.
                const { id: _draftId, postId, status: _status, createdBy: _createdBy, __order: _order, ...changes } = row;
                await context.data.table("posts").update(String(postId), changes);
                await context.data.table("post_drafts").delete(id);
                context.snackbarController?.open({ type: "success", message: "The live post is updated." });
            },
        },
    ],
});
```

Em seguida, adicione a `posts` uma ação que inicia um rascunho a partir de um post publicado e adicione
`draftChanges` aos `entityActions` de `postsCms`:

```typescript
import type { TableEntityAction } from "@rebasepro/cms-types";

export const draftChanges: TableEntityAction = {
    key: "draft-changes",
    name: "Draft changes",
    icon: "FilePen",
    isEnabled: ({ row }) => row?.status === "published",
    onClick: async ({ id, row, context }) => {
        if (id === undefined || !row || !context) return;
        const { id: _postId, __order: _order, ...fields } = row;
        await context.data.table("post_drafts").create({ ...fields, postId: String(id) });
        context.snackbarController?.open({ type: "success", message: "Draft created in Post drafts." });
    }
};
```

Qualquer membro da equipe pode preparar um rascunho. Apenas um editor pode publicá-lo,
pois publicá-lo é uma atualização de um post publicado, o que a regra restritiva em
`posts` recusa para qualquer outra pessoa.

## Pré-visualizações

Uma aba de visualização de entidade recebe os valores do formulário, incluindo edições não salvas,
mostrando assim o post como ele será lido antes de alguém salvá-lo:

```tsx
// frontend/src/editorial/PostPreview.tsx
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import { Container, Typography } from "@rebasepro/ui";

type Block = { type: string; value?: Record<string, unknown> };

function blocksOf(value: unknown): Block[] {
    if (!Array.isArray(value)) return [];
    return value.filter((block): block is Block =>
        typeof block === "object" && block !== null && "type" in block && typeof block.type === "string");
}

export default function PostPreview({ modifiedValues }: EntityCustomViewParams) {
    const title = typeof modifiedValues?.title === "string" ? modifiedValues.title : "Untitled";
    return (
        <Container maxWidth={"3xl"} className={"py-8 flex flex-col gap-4"}>
            <Typography variant={"h3"}>{title}</Typography>
            {blocksOf(modifiedValues?.body).map((block, index) => {
                const value = block.value ?? {};
                if (block.type === "text") return <Typography key={index} className={"whitespace-pre-wrap"}>{String(value.markdown ?? "")}</Typography>;
                if (block.type === "quote") return <Typography key={index} variant={"subtitle1"}>“{String(value.text ?? "")}” {String(value.cite ?? "")}</Typography>;
                return <Typography key={index} variant={"caption"} color={"secondary"}>[{block.type}]</Typography>;
            })}
        </Container>
    );
}
```

Para pré-visualizar no design do próprio site, renderize o componente de artigo do site
nesta aba ou incorpore em um iframe a página de pré-visualização do site e envie-lhe `modifiedValues`
com `postMessage`. Um site estático servido pelo Rebase só pode ser incorporado em iframes a partir de
sua própria origem.

## Notas editoriais

<span class="since-badge" data-since="0.31">Since 0.31</span>

Notas entre redator e editor são linhas próprias, exibidas no post:

```ts
// backend/schema/post_notes.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const postNotes = defineTable("post_notes", {
    columns: {
        id:        col.integer().primaryKey().generatedByDefaultAsIdentity(),
        postId:    col.text().notNull(),
        body:      col.text().notNull(),
        createdBy: col.text().onCreateUser(),
        createdAt: col.timestamp({ withTimezone: true }).onCreateNow(),
    },
    rls: [
        { operations: ["select", "insert"], roles: ["writer", "editor"] },
    ],
});
```

Mantenha-a fora do menu lateral com `hideFromNavigation: true` em seu
`customizeTable`.

```tsx
// frontend/src/editorial/EditorialNotes.tsx
import { useState } from "react";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import { useRowWrites, useRows } from "@rebasepro/app";
import { Button, Container, TextField, Typography } from "@rebasepro/ui";

type Note = { id: number; postId: string; body: string; createdBy: string; createdAt: string };

export default function EditorialNotes({ id }: EntityCustomViewParams) {
    const postId = id ?? "";
    const [text, setText] = useState("");
    const { rows } = useRows<Note>("post_notes", { where: { postId: ["==", postId] }, orderBy: ["createdAt", "asc"] });
    const { create, saving } = useRowWrites();

    if (id === undefined) return <Typography variant={"body2"}>Save the post to add notes.</Typography>;
    return (
        <Container maxWidth={"3xl"} className={"py-8 flex flex-col gap-3"}>
            {rows.map(note => (
                <div key={note.id}>
                    <Typography variant={"caption"} color={"secondary"}>{note.createdBy} · {note.createdAt}</Typography>
                    <Typography className={"whitespace-pre-wrap"}>{note.body}</Typography>
                </div>
            ))}
            <TextField label={"Add a note"} multiline value={text} onChange={event => setText(event.target.value)}/>
            <Button disabled={saving || !text.trim()} onClick={async () => {
                await create("post_notes", { postId, body: text });
                setText("");
            }}>Add note</Button>
        </Container>
    );
}
```

Para notificar a outra pessoa, envie um e-mail a partir do [hook](/docs/collections/callbacks/)
`afterSave` da tabela de notas com `rebase.email`.

## Feeds, sitemap e uma API pública de leitura

Uma função customizada responde com qualquer tipo de conteúdo que você fornecer a ela. Esta
é pública (não possui `requireAuth`), portanto ela faz a leitura com `dataAsAdmin` e filtra
os posts publicados por conta própria:

```typescript
// backend/functions/site.ts
import { defineFunction } from "@rebasepro/server/functions";

type Post = {
    id: string;
    title: string;
    slug: string;
    status: string;
    summary: string | null;
    publishAt: string | null;
    translations: Record<string, { title?: string; summary?: string; body?: string }> | null;
};

const SITE = "https://example.com";

const escapeXml = (text: string) => text.replace(/[<>&'"]/g, ch =>
    ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[ch] ?? ch);

export default defineFunction((app, { rebase }) => {
    const published = () => rebase.dataAsAdmin.table<Post>("posts").find({
        where: { status: ["==", "published"] },
        orderBy: ["publishAt", "desc"],
        limit: 100
    });

    // GET /api/functions/site/rss.xml
    app.get("/rss.xml", async (c) => {
        const { data: posts } = await published();
        const items = posts.map(post => `<item><title>${escapeXml(post.title)}</title>` +
            `<link>${SITE}/blog/${post.slug}</link><guid>${SITE}/blog/${post.slug}</guid>` +
            (post.publishAt ? `<pubDate>${new Date(post.publishAt).toUTCString()}</pubDate>` : "") +
            `<description>${escapeXml(post.summary ?? "")}</description></item>`).join("");
        return c.body(`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>` +
            `<title>Blog</title><link>${SITE}</link><description>Latest posts</description>${items}</channel></rss>`,
            200, { "Content-Type": "application/rss+xml; charset=utf-8" });
    });

    // GET /api/functions/site/sitemap.xml
    app.get("/sitemap.xml", async (c) => {
        const { data: posts } = await published();
        const urls = posts.map(post => `<url><loc>${SITE}/blog/${post.slug}</loc></url>`).join("");
        return c.body(`<?xml version="1.0" encoding="UTF-8"?>` +
            `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
            200, { "Content-Type": "application/xml; charset=utf-8" });
    });

    // GET /api/functions/site/posts/:slug?lang=es — one published post, translated.
    app.get("/posts/:slug", async (c) => {
        const { data } = await rebase.dataAsAdmin.table<Post>("posts").find({
            where: { slug: ["==", c.req.param("slug")], status: ["==", "published"] },
            limit: 1
        });
        const post = data[0];
        if (!post) return c.json({ error: "Not found" }, 404);
        const lang = c.req.query("lang");
        const translation = lang ? post.translations?.[lang] : undefined;
        return c.json({ ...post, ...translation });
    });
});
```

Anuncie o sitemap a partir do `robots.txt` do seu site
(`Sitemap: https://example.com/api/functions/site/sitemap.xml`), que é como um
sitemap fora da raiz do site é encontrado. Páginas que leem os posts diretamente podem
usar o SDK em vez disso, com uma regra de leitura fazendo a filtragem: consulte
[Acesso público](/docs/collections/security-rules/#public-access).

## Importando do WordPress

Um script lê a API REST do WordPress e faz upsert de cada post pelo seu slug,
permitindo ser executado novamente sem duplicar nada: consulte
[Importando do WordPress](/docs/recipes/import-from-wordpress/).

## Duas publicações em uma única instalação

Para um blog e um site de notícias compartilhando uma única instância do Rebase, adicione uma coluna `site` a
`posts`, `post_drafts`, `post_notes` e `media`, e declare
[`tenant`](/docs/collections/tenancy/) em cada um com uma tabela de associação. Um
editor que trabalha em ambos os sites verá ambos, um redator em um deles verá apenas
aquele, e o Postgres aplicará essa regra.

## Relacionados

- [Receita de CMS de Blog](/docs/recipes/blog-cms/): a versão mais enxuta do fluxo de trabalho
- [Segurança a nível de linha](/docs/collections/security-rules/): para o que as regras são compiladas
- [Ações de entidade](/docs/frontend/entity-actions/) e [visualizações de entidade](/docs/frontend/entity-views/)
- [Cron jobs](/docs/backend/cron-jobs/) e [funções customizadas](/docs/backend/custom-functions/)
