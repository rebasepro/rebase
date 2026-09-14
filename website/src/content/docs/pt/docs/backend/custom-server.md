---
sourceHash: bec01a5d7942e188
title: Integração com Servidor Customizado
sidebar_label: Servidor Customizado (Express)
description: Como incorporar os serviços de Banco de Dados e Realtime do Rebase em seu próprio backend Node.js customizado sem usar o Hono ou o coordenador do Rebase.
---

# Integração com Servidor Customizado

O Rebase foi desenvolvido para ser totalmente modular. Embora o coordenador `initializeRebaseBackend` forneça um backend completo com tudo incluso usando Hono, você pode ignorá-lo completamente e incorporar o **Database Adapter** e os **Realtime WebSockets** principais diretamente na sua própria aplicação Node.js customizada (como Express, Fastify ou HTTP puro do Node.js).

O pacote `@rebasepro/server-postgres` é completamente agnóstico de framework. Ele depende apenas do Drizzle ORM e do `http.Server` padrão do Node.js.

## Configuração de Ambiente

O Rebase fornece um utilitário centralizado `loadEnv()` em `@rebasepro/server` que valida suas variáveis de ambiente contra um esquema Zod rigoroso. Chame-o **após** carregar seu arquivo `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

dotenv.config({ path: "../../.env" });

// Basic — just Rebase env vars:
export const env = loadEnv();

// Extended — add your own typed vars:
import { z } from "@rebasepro/server";
export const env = loadEnv({
    extend: z.object({
        SMTP_HOST: z.string().optional(),
        SMTP_PORT: z.string().default("587").transform(Number),
        STRIPE_SECRET_KEY: z.string(),
    })
});
// env.SMTP_HOST  → string | undefined  (fully typed)
// env.STRIPE_SECRET_KEY → string        (validated, required)
```

Importar `z` de `@rebasepro/server` é uma novidade. Na versão 0.17 e anteriores, o pacote não exportava o `z`: importe-o de `zod`, compatível com a versão major utilizada pelo runtime, e deixe seu bundler desduplicar as duas cópias.

:::caution[O `z` com o qual você estende deve ser o zod do runtime]
Ter duas cópias do zod carregadas ao mesmo tempo é a única maneira de essa chamada falhar, e costumava falhar silenciosamente. O `.merge()` aceita um esquema da outra cópia — os formatos são idênticos — e então o `.parse()` rejeita todos os campos que possuem um `.default()`, porque um padrão é reconhecido por identidade de classe. O servidor iniciava, informava sucesso e não executava nenhum dos seus crons; nada na falha mencionava o zod.

Não declare `zod` nas dependências do seu projeto — o runtime o fornece. Se for necessário, use a mesma versão major e deixe seu bundler desduplicar. O `loadEnv` agora recusa um esquema externo na inicialização com uma mensagem indicando a correção, em vez de aceitá-lo e validar apenas metade dele.
:::

**Comportamentos principais:**
- Gera automaticamente `JWT_SECRET` e `REBASE_SERVICE_KEY` efêmeros em desenvolvimento para que você possa começar sem configuração manual.
- Bloqueia segredos gerados automaticamente em produção — você deve defini-los explicitamente.
- Valida se `CORS_ORIGINS` ou `FRONTEND_URL` está definido em produção.
- Recusa um esquema `extend` construído por uma cópia diferente do zod.

Consulte `.env.example` na aplicação gerada para obter a lista completa de variáveis suportadas.

## Usando o Rebase com Express

Aqui está um exemplo completo de como inicializar o adaptador PostgreSQL do Rebase e os Realtime WebSockets dentro de uma aplicação Express padrão, gerenciar réplicas de leitura, acessar o Drizzle diretamente e implementar encerramentos de servidor limpos.

### 1. Instalação

Instale os pacotes principais necessários juntamente com o Express:

```bash
npm install @rebasepro/server-postgres @rebasepro/types express pg
```

### 2. Exemplo de Inicialização e Graceful Shutdown

```typescript
import express from "express";
import { createServer } from "http";
import pg from "pg";
import { createPostgresBootstrapper } from "@rebasepro/server-postgres";

async function startServer() {
    const app = express();
    
    // 1. WebSocket Upgrade Guard
    // WebSockets require hijacking the HTTP Upgrade header. You must bind
    // Rebase to a raw Node.js http.Server instance.
    const server = createServer(app);

    // 2. Configure the connection pool
    const pool = new pg.Pool({
        connectionString: process.env.DATABASE_URL,
        max: 20, // Max concurrent database connections
        idleTimeoutMillis: 30000
    });

    // 3. Initialize the Postgres Bootstrapper
    const bootstrapper = createPostgresBootstrapper({
        connection: pool,
        connectionString: process.env.DATABASE_URL,
        adminConnectionString: process.env.ADMIN_CONNECTION_STRING, // Required for branching
        schema: {
            tables: {},   // Place your custom Drizzle tables here
            relations: {} // Place your custom Drizzle relations here
        }
    });

    // 4. Initialize the Driver and Services
    // Connects to Postgres, verifies connection, starts cross-instance listeners
    const { driver, realtimeProvider, internals } = await bootstrapper.initializeDriver({
        collections: [] // Pass Rebase CollectionConfigs if using schema-as-code
    });

    // Access the underlying schema-aware Drizzle client if needed.
    // `internals` is an *opaque handle* on the DatabaseAdapter contract — the shape is
    // the driver's business, so narrow it to what the Postgres bootstrapper puts there.
    // (named `driverInternals` rather than `pg`, which is the node-postgres import)
    const driverInternals = internals as {
        db: any;                                    // Drizzle NodePgDatabase
        readDb?: any;                               // Read replica, when DATABASE_READ_URL is set
        poolManager?: { destroy(): Promise<void> };
    };
    const db = driverInternals.db;
    const readDb = driverInternals.readDb;

    // 5. Mount Realtime WebSockets
    // Both halves are optional on the contract: a driver need not create a
    // realtime provider, and a bootstrapper need not serve websockets at all.
    if (!realtimeProvider || !bootstrapper.initializeWebsockets) {
        throw new Error("This driver does not support realtime websockets.");
    }
    await bootstrapper.initializeWebsockets(server, realtimeProvider, driver, {
        requireAuth: true // Enforces authentication token checks
    });

    app.use(express.json());

    app.get("/api/health", (req, res) => {
        res.json({ status: "healthy" });
    });

    // Direct Driver CRUD Operation
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

    // Raw Drizzle SQL Execution (RLS bypass)
    app.get("/api/stats", async (req, res) => {
        try {
            const countResult = await db.select().from(...); // Perform standard Drizzle operations
            res.json(countResult);
        } catch (error) {
            res.status(500).json({ error: error instanceof Error ? error.message : "Internal Server Error" });
        }
    });

    // Start listening (Using the HTTP Server, NOT app.listen)
    const port = process.env.PORT || 3000;
    server.listen(port, () => {
        console.log(`🚀 Server and WebSocket engine running on port ${port}`);
    });

    // 6. Graceful Shutdown Handler
    // Terminate listeners and drain connection pools on process termination signals
    const handleShutdown = async (signal: string) => {
        console.log(`\nShutdown triggered via ${signal}. Cleaning up resources...`);
        
        server.close(async () => {
            console.log("✔ HTTP Server closed.");
            try {
                // Terminate cross-instance pg LISTEN/NOTIFY client
                if (realtimeProvider && typeof realtimeProvider.stopListening === "function") {
                    await realtimeProvider.stopListening();
                    console.log("✔ Realtime listeners stopped.");
                }

                // Disconnect dynamic branch connection pools
                if (driverInternals.poolManager) {
                    await driverInternals.poolManager.destroy();
                    console.log("✔ Branch connection pools evicted.");
                }

                // End the main database pool
                await pool.end();
                console.log("✔ Database connection pool drained.");

                process.exit(0);
            } catch (err) {
                console.error("❌ Error during graceful shutdown:", err);
                process.exit(1);
            }
        });
    };

    process.on("SIGTERM", () => handleShutdown("SIGTERM"));
    process.on("SIGINT", () => handleShutdown("SIGINT"));
}

startServer();
```

> **Caminho padrão:** se o seu servidor usa `initializeRebaseBackend` (como faz o template gerado), não implemente manualmente o manipulador de desligamento acima — use o helper embutido. Ele drena as conexões HTTP, para o agendador de crons, encerra os serviços de realtime, protege contra sinais repetidos e força o encerramento se o desligamento travar:
>
> ```ts
> import { installShutdownHandlers } from "@rebasepro/server";
>
> const backend = await initializeRebaseBackend({ ... });
> installShutdownHandlers(backend, { onCleanup: () => pool.end() });
> ```
>
> **Não** o combine com o seu próprio `server.close()` — `backend.shutdown()` já fecha o servidor, e um segundo fechamento causa deadlock. O manipulador manual mostrado no exemplo acima é apenas para configurações totalmente customizadas que ignoram o `initializeRebaseBackend`.

---

## Conceitos-Chave do Backend

### Conexões com Réplicas de Leitura
Se você definir a variável de ambiente `DATABASE_READ_URL`, o Rebase criará automaticamente um pool de conexões secundário apontando para sua réplica de leitura. O bootstrapper registra isso sob `internals.readDb`. O `EntityFetchService` principal encaminha todas as consultas SELECT para o pool de réplica a fim de otimizar a performance, enquanto as consultas de mutação permanecem no pool principal.

### Integração com o Drizzle
Você não precisa escolher entre Rebase e Drizzle. O bootstrapper compila seus esquemas dinamicamente. Você pode acessar o cliente Drizzle NodePgDatabase compilado via `internals.db`, permitindo que você execute migrações SQL puras ou invoque builders type-safe do Drizzle juntamente com os serviços REST do Rebase.

### Drenagem Graciosa de Conexões
Em ambientes serverless ou orquestradores (como Kubernetes), a finalização de pods pode resultar em conexões quebradas. Sempre implemente manipuladores de sinal que invoquem `realtimeProvider.stopListening()` (que encerra o cliente pg LISTEN dedicado) e `pool.end()` para evitar o vazamento de slots de conexão no seu servidor de banco de dados.


## Relacionados

- [Backend Overview](/docs/backend/) — onde cada opção fica quando o runtime inicializa
- [Split Processes](/docs/deployment/split-processes/) — as funções que um servidor customizado precisa reproduzir
- [Storage Configuration](/docs/backend/storage/) — as fontes que um servidor customizado deve resolver por conta própria
