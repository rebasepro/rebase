---
sourceHash: 26a29be19ddbdcb0
title: Incorporando o Driver do Postgres
sidebar_label: Incorporando o Driver do Postgres
description: Abra o driver de dados e o socket de tempo real do @rebasepro/server-postgres dentro do Express, do Fastify ou do Node puro, sem o servidor do Rebase — réplicas de leitura, Drizzle e drenagem incluídos.
---

Um passo abaixo de um [servidor customizado](/docs/backend/custom-server/), o `@rebasepro/server-postgres` funciona sem o servidor do Rebase. Ele depende do Drizzle e do `http.Server` do Node, então você pode abrir o driver de dados e o socket de tempo real dentro do Express, do Fastify ou do Node puro. Nesse nível, você mesmo monta o backend: não há rotas de autenticação, storage nem API de administração, a menos que você as construa.

## Instalação

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg drizzle-orm
```

## Abrindo o driver e o socket

`openPostgresDriver`
e `postgresDriverConfigFromEnv` são exportados. Na 0.24, abra o driver com
`createPostgresBootstrapper(pgConfig).initializeDriver(…)`, cujo `internals` não
é tipado.

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
import { collections } from "./collections";

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

    // The collections' tables must already exist: the driver serves them and never creates them.
    // `provision` (default true) is the rest of its DDL: the role requests run as, branch metadata,
    // channel history and change capture. `provision: false` when none of that may run here.
    const { driver, internals } = await openPostgresDriver(pgConfig, { collections });

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

`openPostgresDriver` é o que o `createPostgresAdapter` executa quando o servidor do Rebase inicializa, depois que o `postgresDriverConfigFromEnv` leu o ambiente para dentro da configuração. Seu segundo argumento diz o que abrir: as `collections`, se a abertura pode executar o seu próprio DDL (`provision`, `true` por padrão) e qual papel este processo assume no tempo real (`realtime: false` para nenhum).

Ele não cria nenhuma tabela de coleção, então, contra um banco de dados sem elas, `POST /api/products` responde `500` "Table not found for collection 'products'". Crie as tabelas primeiro. O `rebase db push` faz isso a partir de um projeto Rebase cujo `config/collections` as declara. Neste servidor, `await createPostgresAdapter(pgConfig).ensureCollectionSchema?.(collections)` antes do `openPostgresDriver` adiciona as tabelas e colunas que o banco de dados não tem, como faz a inicialização do servidor do Rebase, e não altera nada do que já existe.

## Conexões de Réplica de Leitura
Defina `readConnectionString` na configuração do driver, ou a variável de ambiente `DATABASE_READ_URL`, que a inicialização do servidor e o `postgresDriverConfigFromEnv` leem para dentro dela, e o driver abre um segundo pool de conexões contra a sua réplica de leitura, em `internals.readDb`. As leituras vão para a réplica; as gravações ficam na primária.

A opção `readConnectionString` é respeitada. Na 0.24 ela era declarada e ignorada, e só `DATABASE_READ_URL` funcionava.

## Integração com o Drizzle
Você não precisa escolher entre o Rebase e o Drizzle. O driver compila os seus esquemas dinamicamente, e `internals.db` é o cliente `NodePgDatabase` do Drizzle, tipado, para SQL puro ou para os builders do Drizzle com segurança de tipos, ao lado dos serviços REST do Rebase.

## Drenagem Graciosa de Conexões
Em ambientes serverless ou orquestradores (como o Kubernetes), encerrar pods pode resultar em conexões interrompidas. Implemente sempre handlers de sinal que chamem `internals.realtimeService.stopListening()` (que encerra o cliente pg LISTEN dedicado) e `pool.end()`, para não vazar slots de conexão no seu servidor de banco de dados.

## Relacionado

- [Integração com Servidor Customizado](/docs/backend/custom-server/) — o backend inteiro do Rebase, construído a partir de peças públicas no seu próprio servidor
- [Scripts e o Console](/docs/backend/scripts/) — os dados do projeto a partir de um script, de um teste ou de um REPL, sem servidor
