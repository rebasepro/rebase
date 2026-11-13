---
sourceHash: c858a7a8e7622cee
title: "Recette : Publication éditoriale"
sidebar_label: Publication éditoriale
description: "Gérez un blog ou une salle de rédaction sur Rebase : rédacteurs et éditeurs, révision, publication planifiée, brouillons d'articles en ligne, prévisualisations, traductions, médiathèque, blocs de contenu, flux, notes éditoriales et import WordPress."
---

## Vue d'ensemble

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Cette recette met en place le volet éditorial d'une publication sur Rebase. Chaque partie est un point d'extension documenté, ce qui vous permet de ne conserver que les fonctionnalités dont vous avez besoin :

| Ce que vous obtenez | Conçu avec |
|---|---|
| Les rédacteurs rédigent, les éditeurs planifient et publient, imposé par Postgres | [Sécurité au niveau des lignes (RLS)](/docs/collections/security-rules/) |
| Un tableau par statut, avec des boutons Soumettre et Publier | [Vue Kanban](/docs/frontend/view-modes/), [actions d'entité](/docs/frontend/entity-actions/) |
| Publication et dépublication planifiées | Une [tâche cron](/docs/backend/cron-jobs/) |
| Modifier un article en ligne sans le changer jusqu'à sa publication | Une table de brouillons et deux actions d'entité |
| Un aperçu des modifications non enregistrées | Une [vue d'entité](/docs/frontend/entity-views/) |
| Traductions, champs SEO, blocs de contenu | Colonnes JSON avec un schéma ([Documents JSON](/docs/schema/json/)) |
| Une médiathèque avec texte alternatif et crédits | Une table `media` et une relation |
| RSS, un sitemap et une API de lecture publique | Une [fonction personnalisée](/docs/backend/custom-functions/) |
| Notes entre le rédacteur et l'éditeur | Une table de notes et une vue d'entité |
| Révisions avec retour arrière (rollback) | [Historique](/docs/backend/history/) |
| Un import WordPress | Un [script](/docs/recipes/import-from-wordpress/) |
| Deux publications dans une seule installation | [Multi-entité (Tenancy)](/docs/collections/tenancy/) |

Elle étend le modèle de rôles de la [recette CMS de blog](/docs/recipes/blog-cms/) : `writer` et `editor` sont des entrées dans les `roles` d'un utilisateur. Si vous avez commencé à partir du scaffold, ajoutez `writer` aux options de rôles dans `backend/schema/users.ts`.

Chaque table est un fichier dans `backend/schema/`, exporté depuis son `index.ts` ; la manière dont le panneau d'administration la présente — le tableau, les boutons, les aperçus — est une configuration `customizeTable` dans `frontend/src/cms/`, transmise à `<RebaseCMS tableCustomizations>`.

## Médias

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Une ligne par image, de sorte qu'une image est téléversée une seule fois et réutilisée, avec son texte alternatif et ses crédits à côté :

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

Un article pointe vers une ligne de média grâce à une relation, et le sélecteur de relation liste les images déjà présentes dans la bibliothèque. Les utilisateurs autorisés à téléverser les fichiers eux-mêmes sont définis par votre [autorisation de stockage](/docs/backend/storage-authorization/).

## Articles

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

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

Et la manière dont le panneau les affiche — un tableau par statut, deux boutons et deux onglets :

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

Rôle de chaque composant :

- **Le flux de travail (workflow).** Les rédacteurs déplacent leurs propres articles entre `draft` et `review`. Les éditeurs planifient, publient et archivent. Postgres applique ces restrictions, de sorte que les règles s'appliquent de manière identique au panneau d'administration, à l'API REST et au SDK. Un rédacteur qui tente d'enregistrer avec le statut `published` est rejeté par la base de données, quel que soit l'état affiché par les boutons.
- **Le tableau.** Les articles s'ouvrent sous la forme d'un tableau Kanban avec une colonne par statut, et glisser-déposer une carte entre deux colonnes correspond au même enregistrement, soumis aux mêmes règles.
- **Révisions.** `history: true` conserve un instantané de chaque enregistrement, avec un bouton de rétablissement dans l'onglet Historique de l'élément.
- **Traductions.** Une colonne JSON dotée d'un schéma génère un groupe de champs par langue dans le formulaire. Pour afficher plutôt les langues sous forme d'onglets, attribuez à `translations` un [champ personnalisé](/docs/frontend/custom-fields/).
- **Blocs.** `json.oneOf` au sein des éléments d'un `json.array` fournit des blocs typés et réorganisables stockés au format JSON. Pour un éditeur intégré tel que BlockNote ou TipTap, placez-le derrière un champ personnalisé sur un `col.jsonb()` sans schéma ; le JSON de l'éditeur est stocké tel quel.

## Publication planifiée

Une tâche cron publie les articles planifiés lorsque leur heure arrive, et archive ceux dont la date `unpublishAt` est dépassée :

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

`dataAsAdmin` s'exécute avec le rôle `admin`, la règle restrictive le laisse donc passer, et les hooks ainsi que l'historique de la table s'exécutent toujours lors de ces enregistrements.

## Modifier un article en ligne

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Modifier un article publié le modifie directement en production, et les règles ci-dessus empêchent un rédacteur de le modifier. Pour préparer des modifications et les publier en une seule étape, conservez-les dans une seconde table dotée des mêmes colonnes :

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

Donnez ensuite à `posts` une action qui crée un brouillon à partir d'un article publié, puis ajoutez `draftChanges` aux `entityActions` de `postsCms` :

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

N'importe quel membre de l'équipe peut préparer un brouillon. Seul un éditeur peut le publier, car sa publication constitue une mise à jour d'un article publié, ce que la règle restrictive sur `posts` interdit à tous les autres.

## Aperçus

Un onglet de vue d'entité reçoit les valeurs du formulaire, y compris les modifications non enregistrées, ce qui lui permet d'afficher l'article tel qu'il apparaîtra avant que quiconque ne l'enregistre :

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

Pour prévisualiser avec le design réel du site, effectuez le rendu du composant d'article du site dans cet onglet, ou intégrez la page d'aperçu du site dans un iframe et envoyez-lui `modifiedValues` à l'aide de `postMessage`. Un site statique hébergé par Rebase ne peut être intégré dans une frame que depuis sa propre origine.

## Notes éditoriales

<span class="since-badge" data-since="0.31">Depuis 0.31</span>

Les notes entre rédacteur et éditeur sont des lignes distinctes, affichées sur l'article :

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

Masquez cette table du panneau latéral grâce à `hideFromNavigation: true` dans sa configuration `customizeTable`.

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

Pour notifier l'autre intervenant, envoyez un e-mail à partir du [hook](/docs/collections/callbacks/) `afterSave` de la table des notes avec `rebase.email`.

## Flux, sitemap et API de lecture publique

Une fonction personnalisée répond avec le type de contenu de votre choix. Celle-ci est publique (elle ne comporte pas de `requireAuth`), elle lit donc les données avec `dataAsAdmin` et filtre elle-même les articles publiés :

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

Référencez le sitemap dans le fichier `robots.txt` de votre site (`Sitemap: https://example.com/api/functions/site/sitemap.xml`), ce qui permet aux moteurs de recherche de trouver un sitemap situé en dehors de la racine du site. Les pages qui lisent directement les articles peuvent utiliser le SDK à la place, avec une règle de lecture qui gère le filtrage : voir [Accès public](/docs/collections/security-rules/#public-access).

## Importer depuis WordPress

Un script lit l'API REST de WordPress et effectue un upsert de chaque article en fonction de son slug, ce qui permet de le relancer sans rien dupliquer : voir [Importer depuis WordPress](/docs/recipes/import-from-wordpress/).

## Deux publications dans une seule installation

Pour faire cohabiter un blog et un site d'actualités sur une même instance Rebase, ajoutez une colonne `site` aux tables `posts`, `post_drafts`, `post_notes` et `media`, puis déclarez [`tenant`](/docs/collections/tenancy/) sur chacune d'elles à l'aide d'une table d'adhésion. Un éditeur travaillant sur les deux sites verra alors les deux, tandis qu'un rédacteur affecté à un seul site n'aura accès qu'à celui-ci, le tout contrôlé directement par Postgres.

## Voir aussi

- [Recette CMS de blog](/docs/recipes/blog-cms/) : la version simplifiée du flux de travail
- [Sécurité au niveau des lignes (RLS)](/docs/collections/security-rules/) : ce en quoi ces règles sont compilées
- [Actions d'entité](/docs/frontend/entity-actions/) et [vues d'entité](/docs/frontend/entity-views/)
- [Tâches cron](/docs/backend/cron-jobs/) et [fonctions personnalisées](/docs/backend/custom-functions/)
