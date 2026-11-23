---
sourceHash: ce7831be934cb96a
title: "Receta: Publicación editorial"
sidebar_label: Publicación editorial
description: "Gestione un blog o una sala de redacción en Rebase: redactores y editores, revisión, publicación programada, borradores de publicaciones activas, vistas previas, traducciones, una biblioteca de medios, bloques de contenido, feeds, notas editoriales y una importación de WordPress."
---

## Descripción general

Esta receta construye la parte editorial de una publicación en Rebase. Cada parte es
un punto de extensión documentado, por lo que puede tomar solo las partes que necesite:

| Obtiene | Construido con |
|---|---|
| Los redactores redactan borradores, los editores programan y publican, aplicado por Postgres | [Seguridad a nivel de fila](/docs/collections/security-rules/) |
| Un tablero por estado, con botones de Enviar y Publicar | [Vista Kanban](/docs/frontend/view-modes/), [acciones de entidad](/docs/frontend/entity-actions/) |
| Publicación y despublicación programadas | Un [cron job](/docs/backend/cron-jobs/) |
| Edite una publicación activa sin cambiarla hasta que la publique | Una tabla de borradores y dos acciones de entidad |
| Una vista previa de cambios no guardados | Una [vista de entidad](/docs/frontend/entity-views/) |
| Traducciones, campos de SEO, bloques de contenido | Columnas JSON con una estructura ([documentos JSON](/docs/schema/json/)) |
| Una biblioteca de medios con texto alternativo y créditos | Una tabla `media` y una relación |
| RSS, un mapa del sitio y una API pública de lectura | Una [función personalizada](/docs/backend/custom-functions/) |
| Notas entre redactor y editor | Una tabla de notas y una vista de entidad |
| Revisiones con reversión | [Historial](/docs/backend/history/) |
| Una importación de WordPress | Un [script](/docs/recipes/import-from-wordpress/) |
| Dos publicaciones en una sola instalación | [Tenencia](/docs/collections/tenancy/) |

Extiende el modelo de roles de la [receta Blog CMS](/docs/recipes/blog-cms/):
`writer` y `editor` son entradas en los `roles` de un usuario. Si comenzó desde la
estructura inicial (scaffold), agregue `writer` a las opciones de roles en `backend/schema/users.ts`.

Cada tabla es un archivo en `backend/schema/`, exportado desde su `index.ts`; la
forma en que el panel de administración la presenta (el tablero, los botones, las vistas previas) es un
`customizeTable` en `frontend/src/cms/`, pasado a
`<RebaseCMS tableCustomizations>`.

## Medios

Una fila por imagen, de modo que una imagen se sube una sola vez y se reutiliza, con su texto alternativo
y crédito junto a ella:

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

Una publicación apunta a una fila de medios mediante una relación, y el selector de relaciones lista las
imágenes que ya están en la biblioteca. Quién puede subir los archivos en sí se define en
su [autorización de almacenamiento](/docs/backend/storage-authorization/).

## Publicaciones

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

Y cómo las muestra el panel: un tablero por estado, dos botones y dos pestañas:

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

Qué hace cada parte:

- **El flujo de trabajo.** Los redactores mueven sus propias publicaciones entre `draft` y
  `review`. Los editores programan, publican y archivan. Postgres lo hace cumplir, por lo que las
  reglas se aplican por igual al panel de administración, la API REST y el SDK. A un redactor que
  intente guardar como `published`, la base de datos se lo denegará, sin importar lo que muestren los
  botones.
- **El tablero.** Las publicaciones se abren como un tablero Kanban con una columna por estado, y
  arrastrar una tarjeta entre columnas es el mismo guardado, bajo las mismas reglas.
- **Revisiones.** `history: true` guarda una instantánea de cada guardado, con un botón para
  revertir en la pestaña Historial del registro.
- **Traducciones.** Una columna JSON con una estructura definida obtiene un grupo de campos por
  idioma en el formulario. Para mostrar los idiomas como pestañas en su lugar, asigne a
  `translations` un [campo personalizado](/docs/frontend/custom-fields/).
- **Bloques.** `json.oneOf` como los elementos de un `json.array` proporciona bloques tipados y
  reordenables almacenados como JSON. Para un editor en línea como BlockNote o
  TipTap, colóquelo detrás de un campo personalizado en un `col.jsonb()` sin estructura; el
  JSON del editor se almacena tal como está.

## Publicación programada

Un cron job publica las publicaciones programadas cuando llega su momento y archiva
aquellas cuyo `unpublishAt` ha pasado:

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

`dataAsAdmin` se ejecuta con el rol `admin`, por lo que la regla restrictiva lo deja
pasar, y los hooks y el historial de la tabla aún se ejecutan en estos guardados.

## Edición de una publicación activa

Editar una publicación publicada la modifica en vivo, y las reglas anteriores impiden que un redactor
la edite en absoluto. Para preparar cambios y publicarlos en un solo paso, manténgalos
en una segunda tabla con las mismas columnas:

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

Luego, asigne a `posts` una acción que inicie un borrador a partir de una publicación publicada, y agregue
`draftChanges` a los `entityActions` de `postsCms`:

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

Cualquier miembro del equipo puede preparar un borrador. Solo un editor puede publicarlo, porque
publicarlo es una actualización de una publicación ya publicada, lo cual la regla restrictiva en
`posts` deniega a todos los demás.

## Vistas previas

Una pestaña de vista de entidad recibe los valores del formulario, incluidas las ediciones no guardadas, por lo que
muestra la publicación tal como se leerá antes de que alguien la guarde:

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

Para previsualizar con el propio diseño del sitio, renderice el componente de artículo del sitio en
esta pestaña, o inserte en un iframe la página de vista previa del sitio y envíele `modifiedValues` con
`postMessage`. Un sitio estático servido por Rebase solo puede insertarse en marcos desde su propio
origen.

## Notas editoriales

Las notas entre el redactor y el editor son filas propias, mostradas en la publicación:

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

Manténgala fuera del menú lateral con `hideFromNavigation: true` en su
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

Para avisar a la otra persona, envíe un correo electrónico desde el [hook](/docs/collections/callbacks/) `afterSave`
de la tabla de notas usando `rebase.email`.

## Feeds, mapa del sitio y una API pública de lectura

Una función personalizada responde con el tipo de contenido que usted elija. Esta es
pública (no tiene `requireAuth`), por lo que lee con `dataAsAdmin` y filtra las
publicaciones publicadas por sí misma:

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

Anuncie el mapa del sitio desde el archivo `robots.txt` de su sitio
(`Sitemap: https://example.com/api/functions/site/sitemap.xml`), que es la forma en que se localiza
un mapa del sitio fuera de la raíz del sitio. Las páginas que leen las publicaciones directamente pueden
usar el SDK en su lugar, con una regla de lectura encargada del filtrado: consulte
[Acceso público](/docs/collections/security-rules/#public-access).

## Importar desde WordPress

Un script lee la API REST de WordPress y realiza un upsert de cada publicación por su slug, de modo que
puede ejecutarse nuevamente sin duplicar nada: consulte
[Importar desde WordPress](/docs/recipes/import-from-wordpress/).

## Dos publicaciones en una sola instalación

Para un blog y un sitio de noticias que comparten una sola instancia de Rebase, agregue una columna `site` a
`posts`, `post_drafts`, `post_notes` y `media`, y declare
[`tenant`](/docs/collections/tenancy/) en cada una con una tabla de membresía. Un
editor que trabaje en ambos sitios verá ambos, un redactor en uno verá solo ese
uno, y Postgres se encargará de hacerlo cumplir.

## Relacionado

- [Receta Blog CMS](/docs/recipes/blog-cms/): la versión reducida del flujo de trabajo
- [Seguridad a nivel de fila](/docs/collections/security-rules/): a lo que se compilan las reglas
- [Acciones de entidad](/docs/frontend/entity-actions/) y [vistas de entidad](/docs/frontend/entity-views/)
- [Cron jobs](/docs/backend/cron-jobs/) y [funciones personalizadas](/docs/backend/custom-functions/)
