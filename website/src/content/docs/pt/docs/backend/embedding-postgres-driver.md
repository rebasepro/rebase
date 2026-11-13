---
sourceHash: 82f7615bf6bd44b4
title: Embutindo o Driver Postgres
sidebar_label: Embutindo o Driver Postgres
description: Abra o driver de dados e o socket em tempo real do @rebasepro/server-postgres dentro do Express, Fastify ou Node puro, sem o servidor Rebase — réplicas de leitura, Drizzle e draining incluídos.
---

Um nível abaixo de um [servidor customizado](/docs/backend/custom-server/), o `@rebasepro/server-postgres` funciona completamente sem o servidor Rebase. Ele depende do Drizzle e do `http.Server` do Node, para que você possa abrir o driver de dados e o socket em tempo real dentro do Express, Fastify ou Node puro. Neste nível, você mesmo monta o backend: não há rotas de autenticação, nem armazenamento e nem API de administração, a menos que você as construa.

## Instalação

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

## Abrindo o driver e o socket

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`openPostgresDriver` e `postgresDriverConfigFromEnv` são exportados.

```typescript
import express from "express";
import { createServer } from "node:http";
import { sql } from "drizzle-orm";
import {
    createPostgresDatabaseConnection,
    createPostgresWebSocket,
    openPostgresDriver,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { tables } from "./tables";

async function startServer() {
    const app = express();

    // The socket needs the raw http.Server, so listen on it, not on app.listen.
    // 64 KB of headers, as the Rebase runtime takes: a vector search in the URL
    // outgrows Node's 16 KB.
    const server = createServer({ maxHeaderSize: 64 * 1024 }, app);

    const { db, pool, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

    // The environment, read the way the Rebase server's boot reads it:
    // DATABASE_READ_URL, DATABASE_DIRECT_URL and the REALTIME_* variables.
    // Leave this call out and the driver reads no environment variable at all.
    const pgConfig = postgresDriverConfigFromEnv({ connection: db, connectionString });

    // The tables must already exist: the driver serves them and never creates them.
    // `provision` (default true) is the rest of its DDL: the role requests run as, branch metadata,
    // channel history and change capture. `provision: false` when none of that may run here.
    const { driver, internals } = await openPostgresDriver(pgConfig, { tables });

    // The realtime socket. It answers upgrades on `path` only, so a WebSocket
    // server of your own can share the same http.Server.
    createPostgresWebSocket(
        server,
        internals.realtimeService,
        internals.driver,
        { requireAuth: true, jwtSecret: process.env.JWT_SECRET },
        undefined,
        { path: "/" }
    );

    app.use(express.json());

    app.get("/api/health", (req, res) => {
        res.json({ status: "healthy" });
    });

    // A write through the driver
    app.post("/api/products", async (req, res) => {
        try {
            const result = await driver.save({
                path: "products",
                values: req.body,
                status: "new"   // required: "new" | "existing" | "copy"
            });
            res.status(201).json({ success: true, data: result });
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
        }
    });

    // Drizzle directly, typed: `internals.db`, and `internals.readDb` when a
    // read replica is configured.
    app.get("/api/stats", async (req, res) => {
        const result = await internals.db.execute(sql`select count(*) from products`);
        res.json(result.rows);
    });

    const port = process.env.PORT || 3000;
    server.listen(port);

    // Graceful shutdown: stop listening, stop the LISTEN client, evict branch
    // pools, then end the main pool.
    const handleShutdown = (signal: string) => {
        console.log(`Shutdown triggered via ${signal}.`);
        server.close(async () => {
            try {
                await internals.realtimeService.stopListening();
                await internals.poolManager?.shutdown();
                await pool.end();
                process.exit(0);
            } catch (err) {
                console.error("Error during graceful shutdown:", err);
                process.exit(1);
            }
        });
    };

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
}

startServer();
```

`./tables` é um módulo seu que compila suas `defineTable`s com `compileSchema` de `@rebasepro/common`: o descritor de cada tabela com seus hooks, a partir do qual o driver constrói seu modelo de tempo de execução ([Scripts](/docs/backend/scripts/#openrebase) aceita a mesma lista):

```typescript
import { compileSchema } from "@rebasepro/common";
import { products, orders } from "./schema";

export const tables = compileSchema([products, orders]);
```

`openPostgresDriver` é o que `createPostgresAdapter` executa quando o servidor Rebase inicializa, após `postgresDriverConfigFromEnv` ter lido o ambiente para a configuração. Seu segundo argumento define o que abrir: as `tables`, se a abertura pode executar seu próprio DDL (`provision`, padrão `true`), e que papel este processo desempenha no realtime (`realtime: false` para nenhum).

Ele não cria nenhuma tabela da aplicação, portanto, contra um banco de dados sem elas, `POST /api/products` responde com `500` "Table not found for 'products' (table: products)". Crie as tabelas primeiro. `rebase db push` faz isso a partir de um projeto Rebase cujo `backend/schema` as declara. Neste servidor, `await createPostgresAdapter(pgConfig).ensureTableSchema?.(tables)` antes de `openPostgresDriver` adiciona as tabelas e colunas que faltam no banco de dados, assim como a inicialização do servidor Rebase faz, e não altera nada do que já existe.

## Conexões com Réplicas de Leitura
Defina `readConnectionString` na configuração do driver, ou a variável de ambiente `DATABASE_READ_URL`, que a inicialização do servidor e `postgresDriverConfigFromEnv` leem para ele, e o driver abre um segundo pool de conexões contra sua réplica de leitura, sob `internals.readDb`. As leituras vão para a réplica; as escritas permanecem no primário.

## Integração com Drizzle
Você não precisa escolher entre Rebase e Drizzle. O driver compila seus esquemas dinamicamente, e `internals.db` é o cliente Drizzle `NodePgDatabase`, tipado, para SQL puro ou builders tipados do Drizzle juntamente com os serviços REST do Rebase.

## Drenagem Graciosa de Conexões
Em ambientes serverless ou orquestradores (como o Kubernetes), o encerramento de pods pode resultar em conexões interrompidas. Sempre implemente manipuladores de sinais (signal handlers) que chamem `internals.realtimeService.stopListening()` (que encerra o cliente pg LISTEN dedicado) e `pool.end()`, para não vazar slots de conexão no seu servidor de banco de dados.

## Relacionado

- [Integração de Servidor Customizado](/docs/backend/custom-server/) — todo o backend do Rebase, construído a partir de partes públicas em seu próprio servidor
- [Scripts e o Console](/docs/backend/scripts/) — os dados do projeto a partir de um script, um teste ou um REPL, sem servidor
