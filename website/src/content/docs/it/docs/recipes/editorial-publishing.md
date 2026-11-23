---
sourceHash: ce7831be934cb96a
title: "Ricetta: Pubblicazione editoriale"
sidebar_label: Pubblicazione editoriale
description: "Gestisci un blog o una redazione su Rebase: autori ed editor, revisione, pubblicazione programmata, bozze di post pubblicati, anteprime, traduzioni, libreria multimediale, blocchi di contenuto, feed, note editoriali e importazione da WordPress."
---

## Panoramica

Questa ricetta crea la parte editoriale di una pubblicazione su Rebase. Ciascuna parte è
un punto di estensione documentato, consentendoti di utilizzare solo le parti di cui hai bisogno:

| Cosa ottieni | Creato con |
|---|---|
| Gli autori creano bozze, gli editor programmano e pubblicano, con vincoli imposti da Postgres | [Row-level security](/docs/collections/security-rules/) |
| Una bacheca per stato, con pulsanti Invia e Pubblica | [Vista Kanban](/docs/frontend/view-modes/), [azioni sulle entità](/docs/frontend/entity-actions/) |
| Pubblicazione e rimozione programmate | Un [cron job](/docs/backend/cron-jobs/) |
| Modifica di un post pubblicato senza alterarlo fino alla pubblicazione | Una tabella delle bozze e due azioni sulle entità |
| Un'anteprima delle modifiche non salvate | Una [vista entità](/docs/frontend/entity-views/) |
| Traduzioni, campi SEO, blocchi di contenuto | Colonne JSON con schema ([Documenti JSON](/docs/schema/json/)) |
| Una libreria multimediale con testo alternativo e crediti | Una tabella `media` e una relazione |
| RSS, una sitemap e un'API pubblica di lettura | Una [funzione personalizzata](/docs/backend/custom-functions/) |
| Note tra autore ed editor | Una tabella per le note e una vista entità |
| Revisioni con rollback | [Cronologia](/docs/backend/history/) |
| Importazione da WordPress | Uno [script](/docs/recipes/import-from-wordpress/) |
| Due pubblicazioni in una singola installazione | [Tenancy](/docs/collections/tenancy/) |

Estende il modello di ruoli della [ricetta Blog CMS](/docs/recipes/blog-cms/):
`writer` ed `editor` sono voci nei `roles` di un utente. Se sei partito
dallo scaffold, aggiungi `writer` alle opzioni dei ruoli in `backend/schema/users.ts`.

Ogni tabella è un file in `backend/schema/`, esportato dal relativo `index.ts`; il
modo in cui il pannello di amministrazione la presenta — la bacheca, i pulsanti, le anteprime — è un
`customizeTable` in `frontend/src/cms/`, passato a
`<RebaseCMS tableCustomizations>`.

## Media

Una riga per immagine, in modo che un'immagine venga caricata una volta sola e riutilizzata, con
il testo alternativo e i crediti associati:

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

Un post punta a una riga di media tramite una relazione, e il selettore di relazioni elenca le
immagini già presenti nella libreria. Chi può caricare direttamente i file è definito
dalla tua [autorizzazione di archiviazione](/docs/backend/storage-authorization/).

## Post

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

E come il pannello li mostra — una bacheca per stato, due pulsanti e due schede:

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

Cosa fa ciascuna parte:

- **Il flusso di lavoro.** Gli autori spostano i propri post tra `draft` e
  `review`. Gli editor programmano, pubblicano e archiviano. Postgres applica queste regole,
  che restano valide indistintamente per il pannello di amministrazione, l'API REST e l'SDK. Se un autore tenta
  di salvare `published`, l'operazione viene rifiutata dal database, a prescindere da ciò che
  mostrano i pulsanti.
- **La bacheca.** I post si aprono come una bacheca Kanban con una colonna per stato, e
  il trascinamento di una scheda tra le colonne equivale allo stesso salvataggio, regolato dalle stesse regole.
- **Revisioni.** `history: true` conserva un'istantanea di ogni salvataggio, con un pulsante
  di ripristino nella scheda Cronologia del record.
- **Traduzioni.** Una colonna JSON strutturata (con uno shape) ottiene un gruppo di campi per
  lingua nel form. Per mostrare invece le lingue sotto forma di schede, assegna a
  `translations` un [campo personalizzato](/docs/frontend/custom-fields/).
- **Blocchi.** L'uso di `json.oneOf` per gli elementi di un `json.array` fornisce blocchi tipizzati
  e riordinabili memorizzati come JSON. Per un editor inline come BlockNote o
  TipTap, inseriscilo all'interno di un campo personalizzato su un `col.jsonb()` privo di schema; il
  JSON dell'editor verrà salvato così com'è.

## Pubblicazione programmata

Un cron job pubblica i post programmati quando giunge il momento, e archivia
quelli per cui `unpublishAt` è già trascorso:

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

`dataAsAdmin` viene eseguito con il ruolo `admin`, quindi la regola restrittiva ne consente
l'esecuzione, e gli hook e la cronologia della tabella continuano a essere applicati a questi salvataggi.

## Modificare un post già pubblicato

Modificare un post pubblicato lo altera direttamente in produzione, e le regole precedenti impediscono
completamente a un autore di modificarlo. Per preparare le modifiche e pubblicarle in un unico passaggio,
memorizzale in una seconda tabella con le stesse colonne:

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

Quindi, assegna a `posts` un'azione che crei una bozza a partire da un post pubblicato, e aggiungi
`draftChanges` agli `entityActions` di `postsCms`:

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

Chiunque faccia parte dello staff può preparare una bozza. Solo un editor può pubblicarla, poiché
la pubblicazione consiste in un aggiornamento di un post pubblicato, operazione che la regola restrittiva
su `posts` nega a tutti gli altri.

## Anteprime

La scheda di una vista entità riceve i valori del form, comprese le modifiche non salvate,
mostrando così il post come apparirà prima che venga salvato:

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

Per visualizzare l'anteprima con il design del sito, esegui il rendering del componente articolo
del sito in questa scheda, oppure incorpora in un iframe la pagina di anteprima del sito inviandole
`modifiedValues` tramite `postMessage`. Un sito statico servito da Rebase può essere incorporato
in un iframe solo dalla sua stessa origine.

## Note editoriali

Le note tra autore ed editor sono righe a sé stanti, mostrate all'interno del post:

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

Escludila dal menu laterale (drawer) con `hideFromNavigation: true` nel relativo
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

Per notificare l'altra persona, invia un'email dall'[hook](/docs/collections/callbacks/) `afterSave`
della tabella delle note usando `rebase.email`.

## Feed, sitemap e un'API pubblica di lettura

Una funzione personalizzata risponde con qualsiasi content type fornito. Questa è
pubblica (non ha `requireAuth`), quindi legge con `dataAsAdmin` e filtra autonomamente
i post pubblicati:

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

Dichiara la sitemap nel file `robots.txt` del tuo sito
(`Sitemap: https://example.com/api/functions/site/sitemap.xml`), che è il modo in cui
viene individuata una sitemap al di fuori della root del sito. Le pagine che leggono direttamente
i post possono invece usare l'SDK, con una regola di lettura che si occupa del filtraggio: consulta
[Accesso pubblico](/docs/collections/security-rules/#public-access).

## Importazione da WordPress

Uno script legge l'API REST di WordPress ed esegue l'upsert di ciascun post in base al relativo slug,
consentendone la riesecuzione senza duplicare nulla: consulta
[Importazione da WordPress](/docs/recipes/import-from-wordpress/).

## Due pubblicazioni in una sola installazione

Per un blog e un sito di notizie che condividono la stessa istanza di Rebase, aggiungi una colonna `site` a
`posts`, `post_drafts`, `post_notes` e `media`, e dichiara
[`tenant`](/docs/collections/tenancy/) su ciascuna tramite una tabella di appartenenza (membership). Un
editor che lavora su entrambi i siti vedrà entrambi, mentre un autore assegnato a uno solo vedrà esclusivamente
quello, con la garanzia delle regole applicate da Postgres.

## Contenuti correlati

- [Ricetta Blog CMS](/docs/recipes/blog-cms/): la versione ridotta del flusso di lavoro
- [Sicurezza a livello di riga (Row-level security)](/docs/collections/security-rules/): come vengono compilate le regole
- [Azioni sulle entità](/docs/frontend/entity-actions/) e [viste entità](/docs/frontend/entity-views/)
- [Cron job](/docs/backend/cron-jobs/) e [funzioni personalizzate](/docs/backend/custom-functions/)
