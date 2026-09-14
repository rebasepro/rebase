---
sourceHash: 239a291d53ade1fd
title: MongoDB
sidebar_label: MongoDB
description:"\"@rebasepro/server-mongo executa o Rebase no MongoDB: um driver de dados completo, tempo real via change streams e histórico por snapshots — e sem segurança em nível de linha.\""
---

O `@rebasepro/server-mongo` implementa o `BackendBootstrapper` do Rebase no
MongoDB. A API REST, o SDK gerado, o painel de administração e a superfície de autenticação
funcionam perfeitamente sobre ele.

:::caution[Experimental, e não possui segurança em nível de linha]
Leia esta seção antes de escolhê-lo. O MongoDB não possui um equivalente à
segurança em nível de linha (row-level security) do PostgreSQL, portanto **o modelo de isolamento no qual o restante do Rebase se apoia não se
aplica aqui**. As `securityRules` em uma coleção não são impostas pelo banco de dados;
a autorização é aquilo que o seu próprio código verificar.

Isso não é uma lacuna esperando para ser preenchida — é uma característica do mecanismo. Se
a autorização por linha aplicada abaixo da aplicação é o motivo de você estar considerando o
Rebase, use o driver do PostgreSQL — a [Configuração do Backend](/docs/backend/) é onde ele
é configurado, e as [Regras de Segurança](/docs/collections/security-rules/) são o que ele
oferece a você.
:::

## Instalação

```bash
pnpm add @rebasepro/server-mongo
```

```ts title="backend/src/index.ts" no-verify
import { rebase } from "@rebasepro/server";
import { createMongoBootstrapper } from "@rebasepro/server-mongo";

rebase({
    backend: createMongoBootstrapper({ url: process.env.DATABASE_URL! })
});
```

Defina `DATABASE_URL` com uma string de conexão do MongoDB
(`mongodb://…` ou `mongodb+srv://…`).

## O que funciona

| | |
|---|---|
| **API de Dados** | Toda a superfície REST: list, get, create, update, delete, filtros, ordenação, paginação |
| **SDK Gerado** | O mesmo cliente tipado do Postgres |
| **Realtime** | Change streams. Requer um replica set — uma instância standalone do `mongod` não possui oplog para monitorar, portanto o realtime fica silenciosamente indisponível nesse caso |
| **Histórico** | Baseado em snapshots, no mesmo formato do Postgres |
| **Autenticação** | Toda a superfície de autenticação, com seus repositórios armazenados no MongoDB |
| **Painel de administração** | Coleções, formulários, relações na UI, campos de armazenamento |

## O que é diferente

- **Sem segurança em nível de linha.** Veja o aviso acima. Este é o ponto mais importante.
- **Sem superfície SQL.** O editor SQL do Studio, o editor de políticas RLS e
  o `pnpm rls:check` são recursos do Postgres e não estão disponíveis.
- **Sem integridade relacional.** Uma relação é uma referência armazenada que a aplicação
  resolve; não há chave estrangeira, portanto nada a nível de banco de dados impede
  uma referência órfã (dangling).
- **Sem `rebase db push` / `generate` / `migrate`.** O MongoDB não possui schema para
  migrar. As coleções são criadas à medida que os documentos são gravados.

## Escolhendo entre os dois

Escolha o MongoDB quando os dados tiverem genuinamente a estrutura de documentos e o modelo
de autorização residir de qualquer forma na sua aplicação. Escolha o PostgreSQL quando quiser
que o próprio banco de dados seja o responsável por impor quem vê qual linha — que
é o argumento que o Rebase defende em todos os outros lugares deste site.
