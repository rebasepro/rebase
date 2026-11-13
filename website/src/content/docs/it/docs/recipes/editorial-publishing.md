---
sourceHash: c858a7a8e7622cee
title: "Ricetta: Pubblicazione editoriale"
sidebar_label: Pubblicazione editoriale
description: "Gestisci un blog o una redazione su Rebase: autori ed editori, revisione, pubblicazione programmata, bozze di post online, anteprime, traduzioni, libreria multimediale, blocchi di contenuto, feed, note editoriali e importazione da WordPress."
---

## Panoramica

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Questa ricetta crea la parte editoriale di una pubblicazione su Rebase. Ogni parte è un punto di estensione documentato, così puoi prendere solo i componenti di cui hai bisogno:

| Cosa ottieni | Creato con |
|---|---|
| Gli autori creano bozze, gli editori pianificano e pubblicano, con applicazione forzata da Postgres | [Sicurezza a livello di riga (RLS)](/docs/collections/security-rules/) |
| Una bacheca per stato, con pulsanti Invia e Pubblica | [Vista Kanban](/docs/frontend/view-modes/), [azioni di entità](/docs/frontend/entity-actions/) |
| Pubblicazione e rimozione dalla pubblicazione programmate | Un [cron job](/docs/backend/cron-jobs/) |
| Modifica di un post online senza alterarlo fino alla pubblicazione | Una tabella di bozze e due azioni di entità |
| Un'anteprima delle modifiche non salvate | Una [vista di entità](/docs/frontend/entity-views/) |
| Traduzioni, campi SEO, blocchi di contenuto | Colonne JSON con una struttura ([documenti JSON](/docs/schema/json/)) |
| Una libreria multimediale con testo alternativo e crediti | Una tabella `media` e una relazione |
| RSS, una sitemap e un'API pubblica di lettura | Una [funzione personalizzata](/docs/backend/custom-functions/) |
| Note tra autore ed editore | Una tabella di note e una vista di entità |
| Revisioni con rollback | [Cronologia](/docs/backend/history/) |
| Un'importazione da WordPress | Uno [script](/docs/recipes/import-from-wordpress/) |
| Due pubblicazioni in una sola installazione | [Multi-tenancy](/docs/collections/tenancy/) |

Estende il modello dei ruoli della [ricetta Blog CMS](/docs/recipes/blog-cms/): `writer` ed `editor` sono elementi nell'array `roles` dell'utente. Se sei partito dallo scaffolding iniziale, aggiungi `writer` alle opzioni dei ruoli in `backend/schema/users.ts`.

Ogni tabella corrisponde a un file in `backend/schema/`, esportato dal relativo `index.ts`; il modo in cui il pannello di amministrazione la presenta — la bacheca, i pulsanti, le anteprime — è configurato tramite `customizeTable` in `frontend/src/cms/`, passato a `<RebaseCMS tableCustomizations>`.

## Media

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Una riga per immagine, in modo che una figura venga caricata una sola volta e riutilizzata, con il rispettivo testo alternativo e i crediti associati:

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

Un post punta a una riga della tabella media tramite una relazione, e il selettore della relazione elenca le immagini già presenti nella libreria. Chi sia autorizzato a caricare i file effettivi viene definito dalle impostazioni di [autorizzazione dello storage](/docs/backend/storage-authorization/).

## Post

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

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

Ed ecco come il pannello li visualizza — una bacheca per stato, due pulsanti e due schede:

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

A cosa serve ogni parte:

- **Il flusso di lavoro.** Gli autori possono spostare i propri post solo tra `draft` e `review`. Gli editori pianificano, pubblicano e archiviano. Questa logica è applicata a livello di Postgres, quindi le regole valgono allo stesso modo per il pannello di amministrazione, l'API REST e l'SDK. Un autore che tenta di salvare un post come `published` viene bloccato dal database, indipendentemente da cosa mostrano i pulsanti nell'interfaccia.
- **La bacheca.** I post vengono aperti come una bacheca Kanban con una colonna per stato; trascinare una scheda tra le colonne equivale a un salvataggio standard, soggetto alle medesime regole.
- **Le revisioni.** L'opzione `history: true` conserva uno snapshot di ogni salvataggio, mettendo a disposizione un pulsante di ripristino nella scheda Cronologia del record.
- **Le traduzioni.** Una colonna JSON dotata di schema genera automaticamente nel modulo un gruppo di campi per ciascuna lingua. Per visualizzare le lingue come schede separate anziché raggruppate, assegna a `translations` un [campo personalizzato](/docs/frontend/custom-fields/).
- **I blocchi.** Utilizzare `json.oneOf` come elementi di un `json.array` consente di gestire blocchi tipizzati e riordinabili archiviati in formato JSON. Se preferisci un editor inline come BlockNote o TipTap, implementalo tramite un campo personalizzato su un `col.jsonb()` senza schema definito; il JSON dell'editor verrà salvato così com'è.

## Pubblicazione programmata

Un cron job si occupa di pubblicare i post pianificati quando giunge la data stabilita e archivia quelli la cui data `unpublishAt` è già trascorsa:

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

`dataAsAdmin` viene eseguito con il ruolo `admin`, per cui la regola restrittiva ne consente l'operazione; gli hook della tabella e la cronologia continuano a essere eseguiti regolarmente su questi salvataggi.

## Modificare un post online

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Modificare direttamente un post pubblicato lo aggiorna all'istante in produzione, e le regole descritte sopra impediscono totalmente all'autore di modificarlo. Per preparare le modifiche e pubblicarle in un unico passaggio, memorizzale in una seconda tabella con le medesime colonne:

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

Successivamente, aggiungi a `posts` un'azione per creare una bozza a partire da un post pubblicato e includi `draftChanges` nelle `entityActions` di `postsCms`:

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

Qualsiasi membro del team editoriale può preparare una bozza. Solo un editore può pubblicarla, poiché la pubblicazione comporta l'aggiornamento di un post già pubblicato, operazione che la regola restrittiva su `posts` nega a tutti gli altri ruoli.

## Anteprime

La scheda di una vista di entità riceve direttamente i valori del modulo (comprese le modifiche non ancora salvate), mostrando il post esattamente come apparirà prima che chiunque lo salvi:

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

Per visualizzare l'anteprima con il design reale del sito, puoi renderizzare il componente articolo del sito all'interno di questa scheda, oppure inserire in un iframe la pagina di anteprima del sito trasmettendole i `modifiedValues` tramite `postMessage`. Nota che un sito statico servito direttamente da Rebase può essere inserito in un iframe solo dalla sua stessa origine.

## Note editoriali

<span class="since-badge" data-since="0.31">Dalla versione 0.31</span>

Le note scambiate tra autore ed editore sono righe a sé stanti, mostrate all'interno della schermata del post:

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

Nascondila dal menu laterale impostando `hideFromNavigation: true` nel suo file `customizeTable`.

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

Per inviare una notifica all'altra persona, puoi spedire un'email dall'[hook](/docs/collections/callbacks/) `afterSave` della tabella delle note usando `rebase.email`.

## Feed, sitemap e API pubblica di lettura

Una funzione personalizzata può restituire qualsiasi tipo di contenuto (Content-Type) necessario. Questa funzione è pubblica (non ha `requireAuth`), per cui legge i dati tramite `dataAsAdmin` e filtra autonomamente i post pubblicati:

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

Dichiara la sitemap nel file `robots.txt` del tuo sito (`Sitemap: https://example.com/api/functions/site/sitemap.xml`), metodo standard che consente ai motori di ricerca di individuare una sitemap non posizionata nella radice del dominio. Le pagine che leggono direttamente i post possono invece fare uso dell'SDK, lasciando che sia una regola di lettura a filtrare i record: vedi [Accesso pubblico](/docs/collections/security-rules/#public-access).

## Importare da WordPress

Uno script effettua la lettura dell'API REST di WordPress ed esegue l'upsert di ciascun post basandosi sul relativo slug, permettendo così riesecuzioni successive senza creare duplicati: vedi [Importazione da WordPress](/docs/recipes/import-from-wordpress/).

## Due pubblicazioni in una sola installazione

Se un blog e un sito di notizie condividono la stessa istanza di Rebase, aggiungi una colonna `site` a `posts`, `post_drafts`, `post_notes` e `media`, e definisci il parametro [`tenant`](/docs/collections/tenancy/) su ciascuna tabella collegandolo a una tabella di appartenenza (membership). In questo modo, un editore che collabora a entrambi i siti potrà visualizzarli entrambi, mentre un autore assegnato a uno solo vedrà esclusivamente i contenuti di sua competenza, con garanzia di isolamento gestita direttamente da Postgres.

## Risorse correlate

- [Ricetta Blog CMS](/docs/recipes/blog-cms/): la versione ridotta del flusso di lavoro
- [Sicurezza a livello di riga](/docs/collections/security-rules/): la modalità in cui vengono compilate le regole
- [Azioni di entità](/docs/frontend/entity-actions/) e [viste di entità](/docs/frontend/entity-views/)
- [Cron job](/docs/backend/cron-jobs/) e [funzioni personalizzate](/docs/backend/custom-functions/)
