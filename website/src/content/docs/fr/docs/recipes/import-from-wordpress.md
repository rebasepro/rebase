---
sourceHash: 5bed35f4f1ab1f14
title: "Recette : Importer depuis WordPress"
sidebar_label: Importer depuis WordPress
description: "Transférez des articles de WordPress vers Rebase avec un script qui lit l'API REST de WordPress et effectue un upsert de chaque article par slug, pour pouvoir être réexécuté en toute sécurité."
---

## Vue d'ensemble

Ce script importe des données dans la table `posts` de la
[Recette de publication éditoriale](/docs/recipes/editorial-publishing/) ; adaptez les
noms de colonnes à ceux de votre propre table.

Un [script](/docs/backend/scripts/) lit l'API REST de WordPress et effectue un upsert de chaque
article selon son slug, de sorte qu'une nouvelle exécution met à jour au lieu de dupliquer. Il ouvre
le projet avec les `tables` compilées générées par la page [Scripts](/docs/backend/scripts/#openrebase)
dans `backend/scripts/tables.ts` :

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

Exécutez-le depuis `backend/` avec
`DATABASE_URL="$(pnpm exec rebase db url)" WP_APP_PASSWORD=… pnpm exec tsx scripts/import-wordpress.ts`.
`WP_APP_PASSWORD` est la chaîne `user:application-password` encodée en base64, dont WordPress
a besoin pour renvoyer les brouillons. Les images peuvent suivre le même principe : téléchargez chacune d'elles, téléversez-la
avec le [stockage](/docs/sdk/storage/) du SDK et créez sa ligne correspondante dans `media`.

## Voir aussi

- [Recette de publication éditoriale](/docs/recipes/editorial-publishing/) : les tables que cela remplit
- [Scripts](/docs/backend/scripts/) : exécuter du code sur votre base de données
- [Écriture avec le SDK](/docs/sdk/writing/) : `upsert` et ses cibles de conflit
