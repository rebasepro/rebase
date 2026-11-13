---
sourceHash: 5bed35f4f1ab1f14
title: "Receta: Importar desde WordPress"
sidebar_label: Importar desde WordPress
description: "Mueve publicaciones de WordPress a Rebase con un script que lee la API REST de WordPress y realiza un upsert de cada publicación por slug, de modo que pueda ejecutarse nuevamente de forma segura."
---

## Información general

Esto realiza la importación en la tabla `posts` de la
[Receta de publicación editorial](/docs/recipes/editorial-publishing/); cambia los
nombres de las columnas por los de tu propia tabla.

Un [script](/docs/backend/scripts/) lee la API REST de WordPress y realiza un upsert
de cada publicación mediante su slug, por lo que ejecutarlo de nuevo actualiza en lugar
de duplicar. Abre el proyecto con las `tables` compiladas que la página de
[Scripts](/docs/backend/scripts/#openrebase) genera en `backend/scripts/tables.ts`:

```typescript
// backend/scripts/import-wordpress.ts
import { openRebase } from "@rebasepro/server-postgres";
import { tables } from "./tables";

type WpPost = {
    slug: string;
    status: string;
    date_gmt: string;
    title: { rendered: string };
    excerpt: { rendered: string };
    content: { rendered: string };
};

const WP = "https://blog.example.com/wp-json/wp/v2/posts";
const STATUS: Record<string, string> = { publish: "published", future: "scheduled", draft: "draft", pending: "review" };

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, tables });
const posts = rebase.dataAsAdmin.table<Record<string, unknown>>("posts");

for (let page = 1; ; page++) {
    const response = await fetch(`${WP}?per_page=100&page=${page}&status=publish,future,draft,pending`, {
        headers: { Authorization: `Basic ${process.env.WP_APP_PASSWORD}` }
    });
    if (!response.ok) break; // past the last page
    const batch: WpPost[] = await response.json();
    if (batch.length === 0) break;
    for (const wp of batch) {
        await posts.upsert({
            slug: wp.slug,
            title: wp.title.rendered,
            summary: wp.excerpt.rendered,
            status: STATUS[wp.status] ?? "draft",
            publishAt: new Date(`${wp.date_gmt}Z`).toISOString(),
            // WordPress stores rendered HTML, so it lands in one HTML block.
            body: [{ type: "html", value: { html: wp.content.rendered } }]
        }, { onConflict: ["slug"] });
    }
}

await rebase.close();
```

Ejecútalo desde `backend/` con
`DATABASE_URL="$(pnpm exec rebase db url)" WP_APP_PASSWORD=… pnpm exec tsx scripts/import-wordpress.ts`.
`WP_APP_PASSWORD` es el valor en base64 de `usuario:contraseña-de-aplicación`, el cual WordPress
necesita para devolver borradores. Las imágenes pueden seguir el mismo proceso: descarga cada una, súbela
con el [almacenamiento](/docs/sdk/storage/) del SDK y crea su fila en `media`.

## Relacionado

- [Receta de publicación editorial](/docs/recipes/editorial-publishing/): las tablas que este proceso completa
- [Scripts](/docs/backend/scripts/): ejecución de código en tu base de datos
- [Escribir con el SDK](/docs/sdk/writing/): `upsert` y sus objetivos de conflicto (conflict targets)
