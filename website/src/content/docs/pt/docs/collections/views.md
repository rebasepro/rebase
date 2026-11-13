---
sourceHash: 8a72cff37e30800b
title: Views
sidebar_label: Views
description: "Disponibilize uma view SQL ou uma view materializada somente leitura com defineView: views security_invoker governadas pelas tabelas que leem, views materializadas restritas por papéis, atualizadas sob demanda, criadas por db push."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `defineView` disponibiliza uma consulta SQL como uma tabela somente leitura. Declare a consulta, as colunas que ela retorna e a coluna ou colunas que identificam uma linha:

```ts
// backend/schema/artist-stats.ts
import { defineView, col } from "@rebasepro/server/schema";

export const artistStats = defineView("artist_stats", {
    query: `SELECT lower(artist) AS artist, count(*)::int AS songs, max(fame) AS fame
            FROM songs GROUP BY 1`,
    columns: {
        artist: col.text().primaryKey(),
        songs:  col.integer().notNull(),
        fame:   col.integer(),
    },
});
```

Exporte-o de `backend/schema/index.ts` como uma tabela. Ele é lido como qualquer tabela — `find`, `findById`, `count`, [`aggregate`](/docs/sdk/aggregates-and-search/), `listen`, as rotas REST, MCP e o CMS — e nunca é escrito: cada escrita resulta em um `405 TABLE_READ_ONLY`. Escreva nas tabelas que a view lê.

O `rebase db push` cria a view após as tabelas, o `rebase db generate` a anexa à migração e uma inicialização gerenciada a cria em sua etapa de esquema. Uma view cuja consulta não foi alterada permanece inalterada; aquela cuja consulta foi alterada é descartada e criada novamente, juntamente com quaisquer de suas views que a leiam. O Rebase recusa-se a substituir uma tabela, ou uma view que ele não tenha criado, que já possua o nome.

## Opções

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Chave | O que faz |
|---|---|
| `query` | **Obrigatório.** O `SELECT` definidor. |
| `columns` | **Obrigatório.** As colunas que a consulta retorna, como builders `col.*`. `.primaryKey()` marca as que identificam uma linha. |
| `materialized` | `true` armazena as linhas. Consulte [Views materializadas](#views-materializadas). |
| `roles` | Quem pode ler uma view materializada. `["admin"]` quando omitido. Recusado em uma view simples. |
| `table` | O nome da view SQL, quando difere do nome. |
| `slug` | O nome na API. O nome da view quando omitido. |
| `schema` | O esquema do Postgres. `public` quando omitido. |
| `database` | Um banco de dados Postgres não padrão. |
| `description` | O que a view contém, para OpenAPI e MCP. |
| `relations` | Relações para leitura, como em uma tabela. Nenhuma restrição é criada para uma view. |
| `indexes` | Índices nas linhas armazenadas de uma view materializada. |
| `hooks` | Apenas `beforeQuery` e `afterRead`. Consulte [Table hooks](/docs/collections/callbacks/). |
| `metadata` | Quaisquer dados que você deseja disponibilizar com o descritor da view. |

Uma view possui pelo menos uma coluna `.primaryKey()`: uma view não possui chave própria, e uma linha precisa de um endereço.

## Quem vê quais linhas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma view simples é criada `WITH (security_invoker = true)`, portanto ela é executada **como o chamador**: a segurança a nível de linha das tabelas que ela lê decide o que cada chamador vê. Um usuário cujas políticas exibem apenas suas próprias músicas verá a view de suas próprias músicas. É por isso que uma view não tem `rls`: não há nada ao que anexar políticas e nada que elas possam adicionar. Consulte [Segurança a nível de linha](/docs/collections/security-rules/) para as políticas nas tabelas subjacentes.

## Views materializadas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`materialized: true` armazena as linhas, de modo que uma leitura não executa a consulta:

```ts
import { defineView, col } from "@rebasepro/server/schema";

export const langs = defineView("langs", {
    query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang",
    materialized: true,
    roles: ["admin", "analyst"],
    columns: {
        lang:  col.text().primaryKey(),
        songs: col.integer().notNull(),
    },
    indexes: [{ columns: ["songs"], reason: "the most-used languages first" }],
});
```

O Postgres não aplica segurança a nível de linha em uma view materializada: quem tiver permissão para lê-la lê tudo. Portanto, o Rebase a disponibiliza apenas para chamadores que possuam uma das `roles` (`["admin"]` quando omitido, que o `dataAsAdmin` detém) e recusa todos os outros com `403 VIEW_NOT_READABLE`. Não coloque nada em uma view materializada que seus leitores não devam ver.

A regra também é mantida no banco de dados, de modo que o [SQL executado como chamador](/docs/backend/custom-functions/#3-getsqlc--sql-as-the-caller) também a cumpre. As linhas são armazenadas sob `<view>_rebase_rows`, que apenas o proprietário do banco de dados pode ler, e o próprio nome da view é uma view sobre elas que retorna linhas apenas para um chamador que possua uma das `roles`, e para o próprio servidor (`rebase.sql()`, crons). Consulte o nome da view, nunca as linhas armazenadas.

As linhas refletem o estado da última atualização. Atualize com `refresh()` — no servidor como `rebase.dataAsAdmin.langs.refresh()`, ou a partir de um cliente autenticado com uma das roles — ou via HTTP:

```typescript
await client.data.langs.refresh();
await client.data.langs.refresh({ concurrently: true });
```

```bash
POST /api/data/langs/refresh
{ "concurrently": true }
```

`concurrently` continua servindo as linhas antigas enquanto as novas são computadas. Ele requer o índice exclusivo que o Rebase cria nas colunas `.primaryKey()`, portanto elas devem ser exclusivas no resultado da consulta. Para atualizar de forma agendada, chame `refresh()` a partir de um [cron job](/docs/backend/cron-jobs/). Uma view materializada pode ter seus próprios `indexes` (consulte [Índices](/docs/backend/indexes/)), construídos sobre suas linhas armazenadas; uma view simples lê os índices de suas tabelas.

## O que uma view não pode ter

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`rls`, `history`, `softDelete`, `tenant` e `search` são recusados quando o esquema é compilado: cada um precisa de uma tabela para gravar ou para anexar políticas. `roles` em uma view simples é recusado quando o módulo é carregado, assim como uma `query` vazia. `indexes` em uma view simples é recusado quando o esquema é compilado.

Um `listen` em uma view recebe notificações de um `refresh()`. Uma escrita nas tabelas subjacentes a uma view não alcança os assinantes da view: inscreva-se nas tabelas ou leia a view novamente.
