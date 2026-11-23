---
sourceHash: ce7831be934cb96a
title: "Rezept: Redaktionelles Publizieren"
sidebar_label: Redaktionelles Publizieren
description: "Betreiben Sie einen Blog oder Newsroom auf Rebase: Autoren und Redakteure, Review-Prozesse, geplante Veröffentlichungen, Entwürfe von Live-Beiträgen, Vorschauen, Übersetzungen, eine Medienbibliothek, Inhaltsblöcke, Feeds, redaktionelle Notizen und ein WordPress-Import."
---

## Übersicht

Dieses Rezept baut den redaktionellen Teil einer Publikation auf Rebase auf. Jeder Teil ist
ein dokumentierter Erweiterungspunkt, sodass Sie nur die Komponenten verwenden können, die Sie tatsächlich benötigen:

| Sie erhalten | Erstellt mit |
|---|---|
| Autoren entwerfen, Redakteure planen und veröffentlichen, erzwungen durch Postgres | [Row-Level Security](/docs/collections/security-rules/) |
| Ein Board nach Status mit Submit- und Publish-Buttons | [Kanban-Ansicht](/docs/frontend/view-modes/), [Entity Actions](/docs/frontend/entity-actions/) |
| Geplante Veröffentlichung und Depublikation | Einem [Cron-Job](/docs/backend/cron-jobs/) |
| Bearbeiten eines Live-Beitrags, ohne ihn vor der Veröffentlichung zu verändern | Einer Entwurfstabelle und zwei Entity Actions |
| Eine Vorschau ungespeicherter Änderungen | Einer [Entity View](/docs/frontend/entity-views/) |
| Übersetzungen, SEO-Felder, Inhaltsblöcke | JSON-Spalten mit definierter Struktur ([JSON-Dokumente](/docs/schema/json/)) |
| Eine Medienbibliothek mit Alt-Text und Quellenangabe | Einer `media`-Tabelle und einer Relation |
| RSS, eine Sitemap und eine öffentliche Lese-API | Einer [Custom Function](/docs/backend/custom-functions/) |
| Notizen zwischen Autor und Redakteur | Einer Notiztabelle und einer Entity View |
| Revisionen mit Rollback | [History](/docs/backend/history/) |
| Ein WordPress-Import | Einem [Skript](/docs/recipes/import-from-wordpress/) |
| Zwei Publikationen in einer Installation | [Tenancy](/docs/collections/tenancy/) |

Es erweitert das Rollenmodell aus dem [Blog-CMS-Rezept](/docs/recipes/blog-cms/):
`writer` und `editor` sind Einträge in den `roles` eines Benutzers. Wenn Sie vom
Scaffold-Projekt ausgegangen sind, fügen Sie `writer` zu den Rollenoptionen in `backend/schema/users.ts` hinzu.

Jede Tabelle ist eine Datei in `backend/schema/`, die aus ihrer `index.ts` exportiert wird; wie
das Admin-Panel sie darstellt – das Board, die Buttons, die Vorschauen – ist ein
`customizeTable` in `frontend/src/cms/`, das an
`<RebaseCMS tableCustomizations>` übergeben wird.

## Medien

Eine Zeile pro Bild, sodass eine Datei einmal hochgeladen und wiederverwendet werden kann, mit
ihrem Alt-Text und der Quellenangabe direkt daneben:

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

Ein Beitrag verweist über eine Relation auf eine Medienzeile, und die Relationsauswahl listet
die Bilder auf, die sich bereits in der Bibliothek befinden. Wer die Dateien selbst hochladen darf,
wird über Ihre [Speicherautorisierung](/docs/backend/storage-authorization/) geregelt.

## Beiträge

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

Und wie das Panel sie anzeigt – ein Board nach Status, zwei Buttons und zwei Tabs:

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

Was die einzelnen Komponenten bewirken:

- **Der Workflow.** Autoren verschieben ihre eigenen Beiträge zwischen `draft` und
  `review`. Redakteure planen, veröffentlichen und archivieren. Postgres erzwingt dies, sodass
  die Regeln für das Admin-Panel, die REST-API und das SDK gleichermaßen gelten. Ein Autor,
  der versucht, `published` zu speichern, wird von der Datenbank abgewiesen – unabhängig davon,
  was die Buttons anzeigen.
- **Das Board.** Die Beiträge öffnen sich als Kanban-Board mit einer Spalte pro Status, und
  das Ziehen einer Karte zwischen den Spalten entspricht demselben Speichervorgang unter denselben Regeln.
- **Revisionen.** `history: true` behält einen Snapshot jedes Speichervorgangs bei, inklusive
  eines Wiederherstellen-Buttons im History-Tab des Datensatzes.
- **Übersetzungen.** Eine JSON-Spalte mit Schema erhält im Formular eine Feldgruppe pro
  Sprache. Um die Sprachen stattdessen als Tabs anzuzeigen, weisen Sie
  `translations` ein [Custom Field](/docs/frontend/custom-fields/) zu.
- **Blöcke.** `json.oneOf` als Elemente eines `json.array` ermöglicht typisierte,
  umsortierbare Blöcke, die als JSON gespeichert werden. Für einen Inline-Editor wie BlockNote oder
  TipTap binden Sie diesen über ein Custom Field an ein `col.jsonb()` ohne Schema an; das
  JSON des Editors wird exakt so gespeichert, wie es ist.

## Geplantes Veröffentlichen

Ein Cron-Job veröffentlicht geplante Beiträge, sobald deren Zeit gekommen ist, und archiviert
jene, deren `unpublishAt`-Zeitpunkt überschritten wurde:

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

`dataAsAdmin` wird mit der Rolle `admin` ausgeführt, sodass die restriktive Regel den Zugriff
erlaubt. Die Hooks und der Änderungsverlauf der Tabelle greifen bei diesen Speichervorgängen weiterhin.

## Bearbeiten eines Live-Beitrags

Das Bearbeiten eines veröffentlichten Beitrags ändert diesen direkt live, und die oben definierten Regeln
hindern Autoren daran, ihn überhaupt zu bearbeiten. Um Änderungen vorzubereiten und in einem Schritt zu
veröffentlichen, speichern Sie diese in einer zweiten Tabelle mit denselben Spalten:

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

Fügen Sie `posts` dann eine Aktion hinzu, die einen Entwurf aus einem veröffentlichten Beitrag erstellt,
und ergänzen Sie `draftChanges` in den `entityActions` von `postsCms`:

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

Jedes Redaktionsmitglied kann einen Entwurf vorbereiten. Nur ein Redakteur kann ihn veröffentlichen,
da die Veröffentlichung einer Aktualisierung eines bereits publizierten Beitrags entspricht – was die
restriktive Regel auf `posts` für alle anderen Personen verweigert.

## Vorschauen

Ein Tab für eine Entity View empfängt die Werte des Formulars, einschließlich ungespeicherter Änderungen,
sodass der Beitrag so angezeigt werden kann, wie er nach dem Speichern aussehen wird:

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

Um die Vorschau im tatsächlichen Design der Website darzustellen, können Sie die Artikelkomponente der
Website in diesem Tab rendern oder die Vorschauseite der Website in einem Frame einbinden und ihr
`modifiedValues` über `postMessage` übermitteln. Eine statische Website, die über Rebase bereitgestellt
wird, kann nur von ihrem eigenen Origin aus in einem Frame geladen werden.

## Redaktionelle Notizen

Notizen zwischen Autor und Redakteur sind eigenständige Datensätze, die am Beitrag angezeigt werden:

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

Mit `hideFromNavigation: true` in der `customizeTable`-Konfiguration verhindern Sie,
dass die Tabelle in der Seitenleiste angezeigt wird.

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

Um die andere Person zu benachrichtigen, können Sie aus dem `afterSave`-[Hook](/docs/collections/callbacks/)
der Notiztabelle heraus eine E-Mail mit `rebase.email` versenden.

## Feeds, Sitemap und eine öffentliche Lese-API

Eine Custom Function antwortet mit jedem beliebigen Content-Type, den Sie angeben. Diese Funktion ist
öffentlich (sie hat kein `requireAuth`), liest Daten daher mit `dataAsAdmin` und filtert
selbstständig auf veröffentlichte Beiträge:

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

Geben Sie die Sitemap in der `robots.txt` Ihrer Website an
(`Sitemap: https://example.com/api/functions/site/sitemap.xml`), damit eine Sitemap
außerhalb des Site-Roots gefunden werden kann. Seiten, die Beiträge direkt abfragen, können
stattdessen das SDK nutzen, wobei eine Leseregel die Filterung übernimmt: siehe
[Public Access](/docs/collections/security-rules/#public-access).

## Importieren aus WordPress

Ein Skript liest die WordPress-REST-API aus und führt ein Upsert für jeden Beitrag anhand seines Slugs durch,
sodass es erneut ausgeführt werden kann, ohne Duplikate zu erzeugen: siehe
[Importieren aus WordPress](/docs/recipes/import-from-wordpress/).

## Zwei Publikationen in einer Installation

Für einen Blog und eine Nachrichtenseite, die sich dieselbe Rebase-Instanz teilen, fügen Sie eine `site`-Spalte zu
`posts`, `post_drafts`, `post_notes` und `media` hinzu und deklarieren
[`tenant`](/docs/collections/tenancy/) auf jeder dieser Tabellen über eine Membership-Tabelle. Ein
Redakteur, der an beiden Seiten arbeitet, sieht dann beide; ein Autor auf einer Seite sieht nur diese
eine – durchgesetzt von Postgres.

## Siehe auch

- [Blog-CMS-Rezept](/docs/recipes/blog-cms/): Die kompaktere Version des Workflows
- [Row-Level Security](/docs/collections/security-rules/): Worin die Regeln kompiliert werden
- [Entity Actions](/docs/frontend/entity-actions/) und [Entity Views](/docs/frontend/entity-views/)
- [Cron-Jobs](/docs/backend/cron-jobs/) und [Custom Functions](/docs/backend/custom-functions/)
