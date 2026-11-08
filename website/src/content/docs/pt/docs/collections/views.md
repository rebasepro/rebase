---
sourceHash: 040afb7b119d3d2a
title: Views
sidebar_label: Views
description: Sirva uma view SQL ou uma view materializada como uma coleção somente leitura, declarada na configuração e criada pelo db push.
---

## Uma coleção sobre uma consulta

Uma coleção pode servir uma view SQL em vez de uma tabela. Declare a consulta em
`view`, descreva suas colunas como propriedades e marque com `isId` a que
identifica uma linha — uma view não tem chave primária própria:

```ts
import { defineCollection } from "@rebasepro/cms-types";

export default defineCollection({
    slug: "artists",
    name: "Artists",
    table: "artist_stats",
    view: {
        query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
                FROM songs GROUP BY 1`
    },
    properties: {
        artist: { name: "Artist", type: "string", isId: true },
        songs: { name: "Songs", type: "number" },
        fame: { name: "Fame", type: "number" }
    }
});
```

Ela é lida como qualquer outra coleção — `find`, `findById`, `count`,
[`aggregate`](/docs/sdk/aggregates-and-search/),
`listen`, as rotas REST, o MCP e o painel administrativo — e é somente leitura: toda
gravação resulta em um `405 COLLECTION_READ_ONLY`, e o painel não oferece criar, editar
nem excluir. Grave nas tabelas que a view lê.

O `rebase db push` cria a view depois das tabelas (ela é aplicada pelo Rebase, não
pelo Atlas), o `rebase db generate` a acrescenta à migração, e um boot gerenciado a
cria na sua etapa de schema. Uma view cuja consulta não mudou é deixada como está;
uma cuja consulta mudou é removida e criada de novo, junto com qualquer uma das suas
views que a leia. O Rebase se recusa a substituir uma tabela, ou uma view que ele não
criou, que já tenha esse nome.

## Quem vê quais linhas

Uma view simples roda **como o chamador** (`security_invoker`), então as políticas
das tabelas que ela lê decidem o que cada chamador vê: um usuário cujas políticas
mostram a ele as próprias músicas vê a view das próprias músicas. É por isso que
`securityRules` não pode ser declarado em uma view — não há onde anexá-las, e
nada que pudessem acrescentar. Veja [Regras de segurança](/docs/collections/security-rules/) para
as políticas das tabelas subjacentes.

## Views materializadas

`materialized: true` armazena as linhas, de modo que uma leitura não executa a consulta:

```ts
view: {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"]
}
```

O Postgres não aplica row-level security a uma view materializada: quem pode lê-la
lê tudo. Por isso o Rebase a serve apenas a chamadores que tenham uma das `roles`
(`["admin"]` quando omitidas, role que o `dataAsAdmin` possui) e recusa todos os
demais com `403 VIEW_NOT_READABLE`. Não coloque em uma view dessas nada que os
seus leitores não possam ver.

As linhas refletem a última atualização. Atualize com `refresh()` — no servidor como
`rebase.dataAsAdmin.langs.refresh()`, ou a partir de um cliente autenticado com uma
das roles — ou via HTTP:

```ts
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` continua servindo as linhas antigas enquanto as novas são calculadas;
exige o índice único que o Rebase cria nas colunas `isId`, portanto elas devem ser
únicas no resultado da consulta. Para atualizar em um agendamento, chame `refresh()`
de um [cron job](/docs/backend/cron-jobs/). Uma view materializada pode ter `indexes`
próprios (veja [Índices](/docs/backend/indexes/)); uma view simples lê os índices
das suas tabelas.

## O que uma view não pode ter

`securityRules`, `history`, `softDelete`, `tenant` e `search` são recusados no boot,
porque cada um precisa de uma tabela onde gravar ou à qual se anexar.

Um `listen` em uma view fica sabendo de um `refresh()`. Uma gravação nas tabelas sob
uma view não chega aos assinantes da view: assine as tabelas, ou leia a view de novo.
