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
| Writers draft, editors schedule and publish, enforced by Postgres | [Security rules](/docs/collections/security-rules/) |
| A board by status, with Submit and Publish buttons | [Kanban view](/docs/frontend/view-modes/), [entity actions](/docs/frontend/entity-actions/) |
| Scheduled publish and unpublish | A [cron job](/docs/backend/cron-jobs/) |
| Edit a live post without changing it until you publish | A drafts collection and two entity actions |
| A preview of unsaved changes | An [entity view](/docs/frontend/entity-views/) |
| Translations, SEO fields, content blocks | `map` and `oneOf` properties ([arrays and maps](/docs/collections/arrays-and-maps/)) |
| A media library with alt text and credit | A `media` collection and a relation |
| RSS, a sitemap and a public read API | A [custom function](/docs/backend/custom-functions/) |
| Notes between writer and editor | A notes collection and an entity view |
| Revisions with rollback | [History](/docs/backend/history/) |
| A WordPress import | A [script](/docs/recipes/import-from-wordpress/) |
| Two publications in one install | [Tenancy](/docs/collections/tenancy/) |

It extends the role model of the [Blog CMS recipe](/docs/recipes/blog-cms/):
`writer` and `editor` are entries in a user's `roles`. If you started from the
scaffold, add `writer` to the role options in `config/collections/users.ts`.

## Media

One row per image, so a picture is uploaded once and reused, with its alt text
and credit beside it:

```typescript
// config/collections/media.ts
import { defineCollection } from "@rebasepro/cms-types";

const mediaCollection = defineCollection({
    slug: "media",
    name: "Media",
    singularName: "Image",
    table: "media",
    properties: {
        file: {
            type: "string",
            name: "File",
            storage: { storagePath: "media", acceptedFiles: ["image/*"] },
            validation: { required: true }
        },
        alt: { type: "string", name: "Alt text", validation: { required: true } },
        credit: { type: "string", name: "Credit" },
        caption: { type: "string", name: "Caption", admin: { multiline: true } }
    },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update"], roles: ["writer", "editor"] }
    ],
    admin: { icon: "Image" }
});

export default mediaCollection;
```

A post points at a media row with a relation, and the relation picker lists the
images already in the library. Who may upload the files themselves is set by
your [storage authorization](/docs/backend/storage-authorization/).

## Posts

```typescript
// config/collections/posts.ts
import { defineCollection } from "@rebasepro/cms-types";
import { policy } from "@rebasepro/types";
import mediaCollection from "./media";

const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    singularName: "Post",
    table: "posts",
    history: true,
    properties: {
        title: { type: "string", name: "Title", validation: { required: true } },
        slug: { type: "string", name: "Slug", validation: { required: true, unique: true } },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "draft", label: "Draft", color: "gray" },
                { id: "review", label: "In review", color: "orange" },
                { id: "scheduled", label: "Scheduled", color: "blue" },
                { id: "published", label: "Published", color: "green" },
                { id: "archived", label: "Archived", color: "gray" }
            ],
            defaultValue: "draft"
        },
        publishAt: { type: "date", name: "Publish at" },
        unpublishAt: { type: "date", name: "Unpublish at" },
        summary: { type: "string", name: "Summary", admin: { multiline: true } },
        hero: {
            type: "relation",
            name: "Hero image",
            relation: { kind: "belongsTo", target: () => mediaCollection }
        },
        // Content blocks: each entry picks a type and shows that type's form.
        body: {
            type: "array",
            name: "Body",
            oneOf: {
                properties: {
                    text: {
                        type: "map",
                        name: "Text",
                        properties: { markdown: { type: "string", name: "Text", admin: { markdown: true } } }
                    },
                    image: {
                        type: "map",
                        name: "Image",
                        properties: {
                            media: { type: "reference", name: "Image", path: "media" },
                            caption: { type: "string", name: "Caption" }
                        }
                    },
                    quote: {
                        type: "map",
                        name: "Quote",
                        properties: {
                            text: { type: "string", name: "Quote", admin: { multiline: true } },
                            cite: { type: "string", name: "Source" }
                        }
                    },
                    video: {
                        type: "map",
                        name: "Video",
                        properties: { url: { type: "string", name: "URL", url: true, admin: { urlPreview: "video" } } }
                    },
                    html: {
                        type: "map",
                        name: "HTML",
                        properties: { html: { type: "string", name: "HTML", admin: { multiline: true } } }
                    }
                }
            }
        },
        // One entry per language besides the default.
        translations: {
            type: "map",
            name: "Translations",
            properties: {
                es: {
                    type: "map",
                    name: "Español",
                    properties: {
                        title: { type: "string", name: "Title" },
                        summary: { type: "string", name: "Summary", admin: { multiline: true } },
                        body: { type: "string", name: "Body", admin: { markdown: true } }
                    }
                },
                fr: {
                    type: "map",
                    name: "Français",
                    properties: {
                        title: { type: "string", name: "Title" },
                        summary: { type: "string", name: "Summary", admin: { multiline: true } },
                        body: { type: "string", name: "Body", admin: { markdown: true } }
                    }
                }
            }
        },
        seo: {
            type: "map",
            name: "SEO",
            properties: {
                title: { type: "string", name: "SEO title" },
                description: { type: "string", name: "Meta description", validation: { max: 160 } },
                canonical: { type: "string", name: "Canonical URL", url: true }
            }
        },
        createdBy: {
            type: "string",
            name: "Created by",
            autoValue: "user_on_create",
            admin: { readOnly: true }
        },
        __order: {
            type: "string",
            name: "Order",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    securityRules: [
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
            )
        },
        { operation: "delete", roles: ["admin"] }
    ],
    admin: {
        icon: "Newspaper",
        defaultViewMode: "kanban",
        orderProperty: "__order",
        kanban: { columnProperty: "status" },
        entityActions: [
            {
                key: "submit",
                name: "Submit for review",
                icon: "Send",
                collapsed: false,
                isEnabled: ({ row }) => row?.status === "draft",
                onClick: async ({ id, context }) => {
                    if (id === undefined || !context) return;
                    await context.data.collection<Record<string, unknown>>("posts").update(id, { status: "review" });
                }
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
                    await context.data.collection<Record<string, unknown>>("posts")
                        .update(id, { status: later ? "scheduled" : "published" });
                }
            }
        ],
        entityViews: [
            { key: "preview", name: "Preview", Builder: "../../frontend/src/editorial/PostPreview" },
            { key: "notes", name: "Notes", Builder: "../../frontend/src/editorial/EditorialNotes" }
        ]
    }
});

export default postsCollection;
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
- **Translations.** The built-in map field lays out one group of fields per
  language. To show the languages as tabs instead, give `translations` a
  [custom field](/docs/frontend/custom-fields/).
- **Blocks.** `oneOf` gives typed, reorderable blocks stored as JSON. For an
  inline editor such as BlockNote or TipTap, put it behind a custom field on an
  `array` with no `of`; the editor's JSON is stored as it is.

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
        const posts = ctx.rebase.dataAsAdmin.collection<Post>("posts");
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
through, and the collection's callbacks and history still run on these saves.

## Editing a live post

Editing a published post changes it live, and the rules above stop a writer
from editing it at all. To prepare changes and publish them in one step, keep
them in a second collection with the same fields:

```typescript
// config/collections/post_drafts.ts
import { defineCollection } from "@rebasepro/cms-types";
import postsCollection from "./posts";

const postDraftsCollection = defineCollection({
    slug: "post_drafts",
    name: "Post drafts",
    singularName: "Post draft",
    table: "post_drafts",
    properties: {
        ...postsCollection.properties,
        postId: { type: "string", name: "Live post", admin: { readOnly: true } }
    },
    securityRules: [
        { operations: ["select", "insert", "update"], ownerField: "createdBy", roles: ["writer"] },
        { operations: ["select", "insert", "update", "delete"], roles: ["editor"] }
    ],
    admin: {
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
                    await context.data.collection<Record<string, unknown>>("posts").update(String(postId), changes);
                    await context.data.collection<Record<string, unknown>>("post_drafts").delete(id);
                    context.snackbarController?.open({ type: "success", message: "The live post is updated." });
                }
            }
        ]
    }
});

export default postDraftsCollection;
```

Then give `posts` an action that starts a draft from a published post, and add
`draftChanges` to its `entityActions`:

```typescript
import type { EntityAction } from "@rebasepro/cms-types";

export const draftChanges: EntityAction = {
    key: "draft-changes",
    name: "Draft changes",
    icon: "FilePen",
    isEnabled: ({ row }) => row?.status === "published",
    onClick: async ({ id, row, context }) => {
        if (id === undefined || !row || !context) return;
        const { id: _postId, __order: _order, ...fields } = row;
        await context.data.collection<Record<string, unknown>>("post_drafts").create({ ...fields, postId: String(id) });
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

```typescript
// config/collections/post_notes.ts
import { defineCollection } from "@rebasepro/cms-types";

const postNotesCollection = defineCollection({
    slug: "post_notes",
    name: "Post notes",
    table: "post_notes",
    properties: {
        id: { type: "number", name: "ID", isId: "increment" },
        postId: { type: "string", name: "Post", validation: { required: true } },
        body: { type: "string", name: "Note", validation: { required: true } },
        createdBy: { type: "string", name: "By", autoValue: "user_on_create" },
        createdAt: { type: "date", name: "At", autoValue: "on_create" }
    },
    securityRules: [
        { operations: ["select", "insert"], roles: ["writer", "editor"] }
    ],
    admin: { hideFromNavigation: true }
});

export default postNotesCollection;
```

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

To tell the other person, send an email from the notes collection's `afterSave`
[callback](/docs/collections/callbacks/) with `rebase.email`.

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
    const published = () => rebase.dataAsAdmin.collection<Post>("posts").find({
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
        const { data } = await rebase.dataAsAdmin.collection<Post>("posts").find({
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

For a blog and a news site sharing one Rebase, add a `site` property to
`posts`, `post_drafts`, `post_notes` and `media`, and declare
[`tenant`](/docs/collections/tenancy/) on each with a membership collection. An
editor who works on both sites then sees both, a writer on one sees only that
one, and Postgres enforces it.

## Related

- [Blog CMS recipe](/docs/recipes/blog-cms/): the smaller version of the workflow
- [Security Rules (RLS)](/docs/collections/security-rules/): what the rules compile to
- [Entity actions](/docs/frontend/entity-actions/) and [entity views](/docs/frontend/entity-views/)
- [Cron jobs](/docs/backend/cron-jobs/) and [custom functions](/docs/backend/custom-functions/)
