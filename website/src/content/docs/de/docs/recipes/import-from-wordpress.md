---
sourceHash: 5bed35f4f1ab1f14
title: "Rezept: Importieren aus WordPress"
sidebar_label: Importieren aus WordPress
description: "Übertragen Sie Beiträge aus WordPress nach Rebase mit einem Skript, das die WordPress-REST-API ausliest und jeden Beitrag anhand des Slugs per Upsert einfügt, sodass es sicher erneut ausgeführt werden kann."
---

## Übersicht

Dies importiert in die Tabelle `posts` des
[Editorial-Publishing-Rezepts](/docs/recipes/editorial-publishing/); passen Sie die
Spaltennamen an die Ihrer eigenen Tabelle an.

Ein [Skript](/docs/backend/scripts/) liest die WordPress-REST-API aus und fügt jeden
Beitrag anhand seines Slugs per Upsert ein, sodass ein erneutes Ausführen aktualisiert
statt dupliziert. Es öffnet das Projekt mit den kompilierten `tables`, die auf der
Seite [Skripte](/docs/backend/scripts/#openrebase) in `backend/scripts/tables.ts`
erstellt werden:

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

Führen Sie es aus `backend/` mit
`DATABASE_URL="$(pnpm exec rebase db url)" WP_APP_PASSWORD=… pnpm exec tsx scripts/import-wordpress.ts` aus.
`WP_APP_PASSWORD` ist der Base64-Wert von `user:application-password`, den WordPress
benötigt, um Entwürfe zurückzugeben. Bilder können auf dieselbe Weise übernommen werden: Laden Sie jedes Bild herunter,
laden Sie es über den [Storage](/docs/sdk/storage/) des SDKs hoch und erstellen Sie die zugehörige `media`-Zeile.

## Verwandte Themen

- [Editorial-Publishing-Rezept](/docs/recipes/editorial-publishing/): die Tabellen, die hierbei befüllt werden
- [Skripte](/docs/backend/scripts/): Ausführen von Code für Ihre Datenbank
- [Schreiben mit dem SDK](/docs/sdk/writing/): `upsert` und dessen Konfliktziele
