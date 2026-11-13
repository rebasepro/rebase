---
sourceHash: 5bed35f4f1ab1f14
title: "Ricetta: Importazione da WordPress"
sidebar_label: Importazione da WordPress
description: "Sposta i post da WordPress a Rebase con uno script che legge l'API REST di WordPress ed esegue l'upsert di ciascun post in base allo slug, così da poter essere eseguito di nuovo in tutta sicurezza."
---

## Panoramica

Questo importa i dati nella tabella `posts` della
[Ricetta per la pubblicazione editoriale](/docs/recipes/editorial-publishing/); modifica i
nomi delle colonne in base a quelli della tua tabella.

Uno [script](/docs/backend/scripts/) legge l'API REST di WordPress ed esegue l'upsert di ciascun
post in base al suo slug, in modo che eseguendolo di nuovo aggiorni i dati invece di duplicarli. Apre
il progetto con le `tables` compilate generate dalla pagina degli [Script](/docs/backend/scripts/#openrebase)
in `backend/scripts/tables.ts`:

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

Eseguilo da `backend/` con
`DATABASE_URL="$(pnpm exec rebase db url)" WP_APP_PASSWORD=… pnpm exec tsx scripts/import-wordpress.ts`.
`WP_APP_PASSWORD` è la stringa in base64 di `user:application-password`, richiesta da
WordPress per restituire le bozze. Le immagini possono seguire la stessa logica: scarica ciascuna di esse,
caricala con lo [storage](/docs/sdk/storage/) dell'SDK e crea la relativa riga in `media`.

## Correlati

- [Ricetta per la pubblicazione editoriale](/docs/recipes/editorial-publishing/): le tabelle popolate da questo script
- [Script](/docs/backend/scripts/): eseguire codice sul tuo database
- [Scrittura con l'SDK](/docs/sdk/writing/): `upsert` e i relativi target di conflitto
