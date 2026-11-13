---
sourceHash: 5bed35f4f1ab1f14
title: "Receita: Importando do WordPress"
sidebar_label: Importando do WordPress
description: "Mova posts do WordPress para o Rebase com um script que lê a REST API do WordPress e faz upsert de cada post por slug, para que ele possa ser executado novamente com segurança."
---

## Visão geral

Isso importa para a tabela `posts` da [Receita de publicação editorial](/docs/recipes/editorial-publishing/); altere os nomes das colunas para os da sua própria tabela.

Um [script](/docs/backend/scripts/) lê a REST API do WordPress e faz o upsert de cada post pelo seu slug, de modo que executá-lo novamente atualiza em vez de duplicar. Ele abre o projeto com as `tables` compiladas que a página de [Scripts](/docs/backend/scripts/#openrebase) cria em `backend/scripts/tables.ts`:

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

Execute-o a partir de `backend/` com
`DATABASE_URL="$(pnpm exec rebase db url)" WP_APP_PASSWORD=… pnpm exec tsx scripts/import-wordpress.ts`.
`WP_APP_PASSWORD` é o base64 de `user:application-password`, que o WordPress
precisa para retornar rascunhos. Imagens podem seguir o mesmo processo: baixe cada uma, faça upload
com o [storage](/docs/sdk/storage/) do SDK e crie sua linha em `media`.

## Relacionado

- [Receita de publicação editorial](/docs/recipes/editorial-publishing/): as tabelas que isso preenche
- [Scripts](/docs/backend/scripts/): executando código no seu banco de dados
- [Escrevendo com o SDK](/docs/sdk/writing/): `upsert` e seus alvos de conflito
