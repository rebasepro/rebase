---
title: "Recipe: Importing from WordPress"
sidebar_label: Importing from WordPress
description: "Move posts from WordPress into Rebase with a script that reads the WordPress REST API and upserts each post by slug, so it can run again safely."
---

## Overview

This imports into the `posts` collection of the
[Editorial publishing recipe](/docs/recipes/editorial-publishing/); change the
field names to your own collection's.

A [script](/docs/backend/scripts/) reads the WordPress REST API and upserts each
post by its slug, so running it again updates rather than duplicates:

```typescript
// backend/scripts/import-wordpress.ts
import { openRebase } from "@rebasepro/server-postgres";
import { collections } from "../../config/collections";

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

const rebase = await openRebase({ databaseUrl: process.env.DATABASE_URL!, collections });
const posts = rebase.dataAsAdmin.collection<Record<string, unknown>>("posts");

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

Run it from `backend/` with
`DATABASE_URL="$(pnpm exec rebase db url)" WP_APP_PASSWORD=… pnpm exec tsx scripts/import-wordpress.ts`.
`WP_APP_PASSWORD` is the base64 of `user:application-password`, which WordPress
needs to return drafts. Images can follow the same way: download each one, upload
it with the SDK's [storage](/docs/sdk/storage/) and create its `media` row.

## Related

- [Editorial publishing recipe](/docs/recipes/editorial-publishing/): the collections this fills
- [Scripts](/docs/backend/scripts/): running code against your database
- [Writing with the SDK](/docs/sdk/writing/): `upsert` and its conflict targets
