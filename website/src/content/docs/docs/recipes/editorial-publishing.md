---
title: "Recipe: Editorial publishing"
sidebar_label: Editorial publishing
description: "Run a blog or newsroom on Rebase: writers and editors, review, scheduled publishing, drafts of live posts, previews, translations, a media library, content blocks, feeds, editorial notes and a WordPress import."
---

## Overview

This recipe builds the editorial side of a publication on Rebase. Each part is
a documented extension point, so you can take only the parts you need:

| You get | Built with |
|---|---|
| Writers draft, editors schedule and publish, enforced by Postgres | [Row-level security](/docs/collections/security-rules/) |
| A board by status, with Submit and Publish buttons | [Kanban view](/docs/frontend/view-modes/), [entity actions](/docs/frontend/entity-actions/) |
| Scheduled publish and unpublish | A [cron job](/docs/backend/cron-jobs/) |
| Edit a live post without changing it until you publish | A drafts table and two entity actions |
| A preview of unsaved changes | An [entity view](/docs/frontend/entity-views/) |
| Translations, SEO fields, content blocks | JSON columns with a shape ([JSON documents](/docs/schema/json/)) |
| A media library with alt text and credit | A `media` table and a relation |
| RSS, a sitemap and a public read API | A [custom function](/docs/backend/custom-functions/) |
| Notes between writer and editor | A notes table and an entity view |
| Revisions with rollback | [History](/docs/backend/history/) |
| A WordPress import | A [script](/docs/recipes/import-from-wordpress/) |
| Two publications in one install | [Tenancy](/docs/collections/tenancy/) |

It extends the role model of the [Blog CMS recipe](/docs/recipes/blog-cms/):
`writer` and `editor` are entries in a user's `roles`. If you started from the
scaffold, add `writer` to the role options in `backend/schema/users.ts`.

Each table is a file in `backend/schema/`, exported from its `index.ts`; how
the admin panel presents it — the board, the buttons, the previews — is a
`customizeTable` in `frontend/src/cms/`, passed to
`<RebaseCMS tableCustomizations>`.

## Media

<span class="since-badge" data-since="0.31">Since 0.31</span>

One row per image, so a picture is uploaded once and reused, with its alt text
and credit beside it:

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

A post points at a media row with a relation, and the relation picker lists the
images already in the library. Who may upload the files themselves is set by
your [storage authorization](/docs/backend/storage-authorization/).

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
        publishAt:   col.timestamptz(),
        unpublishAt: col.timestamptz(),
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

And how the panel shows them — a board by status, two buttons, and two tabs:

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

What each part does:

- **The workflow.** Writers move their own posts between `draft` and
  `review`. Editors schedule, publish and archive. Postgres enforces it, so the
  rules hold for the admin panel, the REST API and the SDK alike. A writer who
  tries to save `published` is refused by the database, whatever the buttons
  show.
- **The board.** The posts open as a Kanban board with a column per status, and
  dragging a card between columns is the same save, under the same rules.
- **Revisions.** `history: true` keeps a snapshot of every save, with a revert
  button in the record's History tab.
- **Translations.** A JSON column with a shape gets one group of fields per
  language in the form. To show the languages as tabs instead, give
  `translations` a [custom field](/docs/frontend/custom-fields/).
- **Blocks.** `json.oneOf` as the items of a `json.array` gives typed,
  reorderable blocks stored as JSON. For an inline editor such as BlockNote or
  TipTap, put it behind a custom field on a `col.jsonb()` with no shape; the
  editor's JSON is stored as it is.

## Scheduled publishing

A cron job publishes scheduled posts when their time comes, and archives the
ones whose `unpublishAt` has passed:

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

`dataAsAdmin` runs with the `admin` role, so the restrictive rule lets it
through, and the table's hooks and history still run on these saves.

## Editing a live post

Editing a published post changes it live, and the rules above stop a writer
from editing it at all. To prepare changes and publish them in one step, keep
them in a second table with the same columns:

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

Then give `posts` an action that starts a draft from a published post, and add
`draftChanges` to the `entityActions` of `postsCms`:

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

Anyone on staff can prepare a draft. Only an editor can publish it, because
publishing it is an update of a published post, which the restrictive rule on
`posts` refuses to everyone else.

## Previews

An entity view tab receives the form's values, unsaved edits included, so it
shows the post as it will read before anyone saves it:

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

To preview in the site's own design, render the site's article component in
this tab, or frame the site's preview page and send it `modifiedValues` with
`postMessage`. A static site served by Rebase can be framed only from its own
origin.

## Editorial notes

Notes between writer and editor are rows of their own, shown on the post:

```ts
// backend/schema/post_notes.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const postNotes = defineTable("post_notes", {
    columns: {
        id:        col.integer().primaryKey().identity(),
        postId:    col.text().notNull(),
        body:      col.text().notNull(),
        createdBy: col.text().onCreateUser(),
        createdAt: col.timestamptz().onCreateNow(),
    },
    rls: [
        { operations: ["select", "insert"], roles: ["writer", "editor"] },
    ],
});
```

Keep it out of the drawer with `hideFromNavigation: true` in its
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

To tell the other person, send an email from the notes table's `afterSave`
[hook](/docs/collections/callbacks/) with `rebase.email`.

## Feeds, sitemap and a public read API

A custom function answers with whatever content type you give it. This one is
public (it has no `requireAuth`), so it reads with `dataAsAdmin` and filters to
published posts itself:

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

Announce the sitemap from your site's `robots.txt`
(`Sitemap: https://example.com/api/functions/site/sitemap.xml`), which is how a
sitemap outside the site root is found. Pages that read the posts directly can
use the SDK instead, with a read rule doing the filtering: see
[Public Access](/docs/collections/security-rules/#public-access).

## Importing from WordPress

A script reads the WordPress REST API and upserts each post by its slug, so it
can run again without duplicating anything: see
[Importing from WordPress](/docs/recipes/import-from-wordpress/).

## Two publications in one install

For a blog and a news site sharing one Rebase, add a `site` column to
`posts`, `post_drafts`, `post_notes` and `media`, and declare
[`tenant`](/docs/collections/tenancy/) on each with a membership table. An
editor who works on both sites then sees both, a writer on one sees only that
one, and Postgres enforces it.

## Related

- [Blog CMS recipe](/docs/recipes/blog-cms/): the smaller version of the workflow
- [Row-level security](/docs/collections/security-rules/): what the rules compile to
- [Entity actions](/docs/frontend/entity-actions/) and [entity views](/docs/frontend/entity-views/)
- [Cron jobs](/docs/backend/cron-jobs/) and [custom functions](/docs/backend/custom-functions/)
