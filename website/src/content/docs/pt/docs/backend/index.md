---
sourceHash: c4f8030fadf21ecf
title: Visão Geral do Backend
sidebar_label: Backend
description: O backend Rebase oferece um servidor completo com API REST, autenticação, armazenamento, WebSocket em tempo real e histórico de entidades — tudo inicializado com uma única chamada de função.
---

## Visão Geral

O backend Rebase é um **servidor Node.js** construído sobre [Hono](https://hono.dev/) que oferece:

-   **API REST** — Endpoints CRUD auto-gerados para cada coleção
-   **Autenticação** — Tokens JWT, início de sessão OAuth e OIDC, magic links, códigos de uso único, MFA, chaves de API, gestão de utilizadores/funções
-   **Armazenamento** — Upload/download de ficheiros com sistema de ficheiros local ou S3
-   **WebSocket** — Sincronização de dados em tempo real via PostgreSQL LISTEN/NOTIFY
-   **Histórico de Entidades** — Trilha de auditoria para cada alteração de dados
-   **Ramificação de Base de Dados** — Cópias de base de dados instantâneas e isoladas para dev/staging/testes
-   **Tarefas Cron** — Tarefas em segundo plano agendadas com painel de monitorização

Tudo é inicializado com uma única função:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    collectionsDir: "./config/collections",
    database: createPostgresAdapter({
            connection: db,
            schema: { tables, enums, relations }
        }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true,
    enableSwagger: env.NODE_ENV !== "production"
});
```

## O Que É Criado

Após a inicialização, estas rotas são montadas:

| Caminho | Propósito |
|---|---|
| `/api/auth/*` | Autenticação (registo, login, refresh, OAuth, magic links, códigos de uso único, MFA) |
| `/api/admin/*` | Gestão de utilizadores e funções (apenas para administradores) |
| `/api/storage/*` | Upload, download e eliminação de ficheiros |
| `/api/data/:slug` | Operações CRUD por coleção (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Histórico de alterações de entidade (quando ativado) |
| `/api/docs` | Especificação OpenAPI (quando `enableSwagger: true`) |
| `/api/swagger` | Swagger UI (modo de desenvolvimento, quando `enableSwagger: true`) |
| `/api/meta/contract` | O esquema de coleções do projeto (apenas admin) |
| `/api/meta/schema-version` | Uma string de versão para esse esquema (não autenticada) |
| `/api/functions/*` | Rotas de funções personalizadas (quando `functionsDir` está definido) |
| `/api/cron/*` | Gestão de tarefas cron (apenas para administradores, quando `cronsDir` está definido) |
| WebSocket on upgrade | Subscrições em tempo real |

## Referência de Configuração

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Collections
    collections?: CollectionConfig[];  // Your collection definitions
    collectionsDir?: string;  // Auto-load collections from a directory

    // Bootstrappers (Databases, Auth, Realtime, etc.)
    bootstrappers: BackendBootstrapper[];

    // Authentication
    auth?: AuthConfig;

    // File storage
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Entity history
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Custom API endpoints
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks
    cronsDir?: string;        // Auto-load cron jobs from a directory

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

## A Instância do Backend

`initializeRebaseBackend` retorna uma `RebaseBackendInstance` com acesso a serviços internos:

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.auth?.roleService       // Role management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.collectionRegistry  // Collection metadata
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when cronsDir is set)
```

> **Nota:** Embora a instância exponha estes serviços internos, o código da aplicação (como funções personalizadas e tarefas cron) deve usar o singleton global `rebase` de `@rebasepro/server` para interagir com a API do backend.

## API REST

A API REST é auto-gerada a partir das suas coleções. Cada coleção obtém estes endpoints:

| Método | Caminho | Descrição |
|---|---|---|
| `GET` | `/api/data/:slug` | Listar entidades — filtrar, ordenar, paginar e pesquisar são parâmetros de consulta |
| `GET` | `/api/data/:slug/count` | Quantas linhas essa mesma consulta corresponde |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obter uma única entidade |
| `POST` | `/api/data/:slug` | Criar uma nova entidade |
| `PATCH` | `/api/data/:slug/:id` | Atualizar os campos que envia |
| `DELETE` | `/api/data/:slug/:id` | Eliminar uma entidade |
| `POST` | `/api/data/:slug/bulk` | Criar muitas linhas numa única transação |
| `PATCH` | `/api/data/:slug/bulk` | Atualizar muitas linhas numa única transação |
| `POST` | `/api/data/:slug/bulk/delete` | Eliminar muitas linhas numa única transação |

### Parâmetros de consulta

Existe uma referência para eles e não é esta página. [API REST](/docs/backend/api/) documenta
os dois dialetos de consulta que o servidor aceita — a forma `?column=op.value` ao estilo
PostgREST e a forma JSON `?where=` — juntamente com `orderBy`, `limit`/`offset`, `include`,
`fields`, `searchString` e a pesquisa vetorial.
[Endpoints](/docs/backend/endpoints/) é o índice de todas as rotas que o servidor monta,
incluindo as geradas.

Um parâmetro que o servidor não reserva é lido como um filtro sobre a coluna com esse nome,
por isso um parâmetro inventado não falha: apenas não corresponde a nada, em silêncio.

## WebSocket

O servidor WebSocket anexa-se ao mesmo servidor HTTP e fornece subscrições em tempo real:

-   Subscrever **alterações de coleção** — ser notificado quando qualquer entidade numa coleção é criada, atualizada ou eliminada
-   Subscrever **alterações de entidade** — ser notificado quando uma entidade específica muda
-   Tratamento automático de **reconexão** no SDK do cliente

O backend usa internamente PostgreSQL `LISTEN/NOTIFY`. Para implementações de múltiplas instâncias, forneça uma `connectionString` no seu `PostgresBootstrapper` para ativar a difusão entre instâncias.

## Tratamento de Erros

O backend inclui um manipulador de erros que captura todas as exceções e retorna respostas de erro estruturadas:

```json
{
    "error": {
        "message": "Entity not found",
        "code": "NOT_FOUND",
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

| Campo | Sempre presente | O que é |
|-------|:---------------:|---------|
| `message` | sim | Escrito para a pessoa que o lê numa consola. Nomeia o obstáculo, não a regra. |
| `code` | sim | `SCREAMING_SNAKE_CASE` e estável. É o campo sobre o qual ramificar. |
| `details` | não | Carga estruturada quando a recusa é *sobre* alguma coisa — uma lista de caminhos falhados, um conjunto de campos desconhecidos. |
| `requestId` | não | Presente quando o pedido trazia um ou lhe foi atribuído; reflete `X-Request-ID`. Cite-o num relatório de erro. |

O estado HTTP está na resposta, não no corpo. Ramifique sobre `code`, não sobre
`message` — as mensagens são escritas para pessoas e podem mudar.

## Próximos Passos

-   **[Autenticação](/docs/backend/authentication)** — JWT, fornecedores OAuth e OIDC, MFA, chaves de API, gestão de utilizadores
-   **[Armazenamento](/docs/backend/storage)** — Armazenamento de ficheiros local e S3
-   **[Callbacks de Entidade](/docs/collections/callbacks)** — Hooks de ciclo de vida e API `context.data`
-   **[Histórico de Entidade](/docs/backend/history)** — Trilha de auditoria
-   **[Funções Personalizadas](/docs/backend/custom-functions)** — Adicionar endpoints de API personalizados
-   **[Tarefas Cron](/docs/backend/cron-jobs)** — Tarefas em segundo plano agendadas
-   **[Ramificação de Base de Dados](/docs/backend/branching)** — Cópias de base de dados instantâneas para dev/staging
- **[Implantação](/docs/getting-started/deployment)** — Levar o backend para produção
