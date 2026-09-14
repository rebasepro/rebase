---
sourceHash: 21b1ae6712a17e38
title: Visão Geral do Backend
sidebar_label: Backend
description: O backend do Rebase fornece um servidor completo com API REST, autenticação, armazenamento, tempo real com WebSocket e histórico de entidades — tudo inicializado com uma única chamada de função.
---

## Visão Geral

O backend do Rebase é um **servidor Node.js** construído sobre o [Hono](https://hono.dev/) que fornece:

- **API REST** — Endpoints CRUD gerados automaticamente para cada coleção
- **Autenticação** — Tokens JWT, login via OAuth e OIDC, magic links, códigos de uso único, MFA, chaves de API, gerenciamento de usuários/papéis
- **Armazenamento** — Upload/download de arquivos com sistema de arquivos local ou S3
- **WebSocket** — Sincronização de dados em tempo real via LISTEN/NOTIFY do PostgreSQL
- **Histórico de Entidades** — Trilha de auditoria para cada alteração de dados
- **Branching de Banco de Dados** — Cópias instantâneas e isoladas do banco de dados para dev/staging/testes
- **Tarefas Cron** — Tarefas agendadas em segundo plano com painel de monitoramento

Tudo é inicializado com uma única função:

:::note[Onde isso fica]
A chamada abaixo é o que um backend **ejetado** possui, em `backend/src/index.ts`. No
**runtime gerenciado** não existe tal arquivo: o runtime faz a chamada, e
você o configura por meio de variáveis de ambiente, dos recursos declarados em
`config/resources.ts` (`database()`, `bucket()`) e dos dois exports que ele lê
de `config/index.ts` (`storageAuthorize`, `callbacks`). Cada página nesta
seção informa qual dos dois se aplica à opção que documenta, e nomeia aquelas
que não têm forma gerenciada. Exporte uma opção que o runtime não lê e
ele avisará na inicialização em vez de ignorá-la silenciosamente; exporte uma que uma
declaração de recurso substituiu e a inicialização a recusará nominalmente, com a
linha correspondente em `config/resources.ts` para escrever em seu lugar.
:::

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

## Onde fica cada opção

Essa chamada é a forma **ejetada** — aquela que você mesmo escreve após `rebase
eject` ou em um servidor personalizado. Um projeto criado via scaffolding não a possui: o
runtime publicado inicializa o projeto, e cada opção chega como uma variável de ambiente
no `.env`, uma exportação de `config/index.ts` ou um diretório declarado
pelo bundle no `rebase.json`.

Ambos os caminhos chegam à mesma `RebaseBackendConfig`. Este é o mapa completo.

| Opção | Runtime gerenciado |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (padrão `/api`) |
| `collections`, `collectionsDir` | o diretório `config/collections/`, declarado pelo `rebase.json` |
| `functionsDir` | `backend/functions/` |
| `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, além de uma declaração `database("<key>")` em `config/resources.ts` para cada banco de dados além do padrão |
| `auth` | `JWT_SECRET`, as variáveis `OAUTH_*` e `config/collections/users` |
| `storage` | as variáveis `STORAGE_*`, além de uma declaração `bucket("<key>")` em `config/resources.ts` para cada bucket além do padrão |
| `storageAuthorize` | `export const storageAuthorize` de `config/index.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `callbacks` | `export const callbacks` de `config/index.ts` |
| `history` | `REBASE_HISTORY` (ativado por padrão) — apenas a forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; se não definido, fica ativado fora de produção |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — veja [Processos Divididos](/docs/deployment/split-processes/) |
| `corsHandled` | O CORS é instalado pelo runtime a partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | a compilação (build) estampa ambos no bundle |
| `app`, `server`, `provisioningDriverResult` | o runtime os cria |

### Opções sem rota gerenciada

Estas não possuem variável de ambiente nem exportação de configuração. Elas são acessíveis
apenas a partir de uma chamada manual de `initializeRebaseBackend` — `rebase eject` ou um
[servidor personalizado](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` · `functionsTimeoutMs` ·
`storagePolicies` · `storageTriggers` · `baas` · `liveSchema` · `rlsAudit` ·
`history` em sua forma de objeto (`{ retention }`)

`schemaEditor` é desativado forçadamente em um bundle compilado: o editor reescreve os arquivos
*fonte* das coleções, e um bundle contém apenas a saída compilada.

## O que é Criado

Após a inicialização, estas rotas são montadas:

| Rota | Propósito |
|------|-----------|
| `/api/auth/*` | Autenticação (cadastro, login, refresh, OAuth, magic links, códigos de uso único, MFA) |
| `/api/admin/*` | Gerenciamento de usuários e papéis (apenas admin) |
| `/api/storage/*` | Upload, download e exclusão de arquivos |
| `/api/data/:slug` | Operações CRUD por coleção (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Histórico de alterações da entidade (quando ativado) |
| `/api/docs` | Especificação OpenAPI (quando `enableSwagger: true`) |
| `/api/swagger` | Swagger UI (modo dev, quando `enableSwagger: true`) |
| `/api/meta/contract` | O esquema de coleções do projeto (apenas admin) |
| `/api/meta/schema-version` | Uma string de versão para esse esquema (não autenticado) |
| `/api/functions/*` | Rotas de funções personalizadas (quando `functionsDir` está definido) |
| `/api/cron/*` | Gerenciamento de tarefas cron (apenas admin, quando `cronsDir` está definido) |
| WebSocket no upgrade | Inscrições em tempo real |

---

## O Ciclo de Vida de Inicialização

Quando você invoca `initializeRebaseBackend()`, o framework aciona uma sequência de inicialização sequencial de 5 estágios:

```
[Start Boot]
     │
     ▼
1. ENV validation (Zod parsing of jwt, databases, cors)
     │
     ▼
2. Dynamic Collection Loading (Chokidar watches .ts files, AST parsing)
     │
     ▼
3. Database Bootstrapping (Acquires advisory lock, creates schemas/auth/helper SQL functions)
     │
     ▼
4. Service Initialization (Auth, Storage S3/Local client instances, Cron store seeding)
     │
     ▼
5. Route Mounting & Edge Loading (Hono controllers, custom functions, WebSocket binding)
     │
     ▼
[Boot Complete]
```

---

## O que acontece quando a inicialização falha

**A inicialização falha de forma explícita.** Se o banco de dados estiver inacessível, as
credenciais estiverem incorretas ou o esquema da coleção não puder ser aplicado,
`initializeRebaseBackend` lança um erro, nada é servido e o processo é encerrado com código `1`.
Não há modo degradado nem servidor parcial: um contêiner que não consegue alcançar seu banco de
dados reinicia, e o erro que o encerrou é a última coisa em seus logs.

Isso é deliberado. Um servidor que inicia respondendo ao login enquanto todas as rotas
`/api/data/*` falham é muito mais difícil de diagnosticar do que um que nunca chega a
subir — e um orquestrador pode agir diante de um loop de falhas (crash loop).

Antes da primeira consulta, a inicialização testa a conexão e imprime o diagnóstico: o
host e a porta que não puderam ser alcançados, o motivo reportado pelo próprio driver (`ECONNREFUSED`,
`password authentication failed for user "app"`) e a solução. Consulte
[Solução de Problemas](/docs/troubleshooting/) para ver a lista falha por falha.

### Depois de estar em execução: `/livez` e `/health`

Duas sondas (probes), respondendo a duas perguntas diferentes.

| Rota | Acessa o banco de dados | Responde |
| --- | --- | --- |
| `/livez` | Não | `200 {"status":"ok"}` enquanto o processo estiver em execução. Use para uma liveness probe. |
| `/health` | Sim, todas as fontes de dados | `200 {"status":"ok"}` quando todas as fontes de dados configuradas responderem; `503 {"status":"degraded"}` quando uma não responder. Use para uma readiness probe. |

Usar uma liveness probe em `/health` é um erro que vale a pena ressaltar: uma instabilidade
passageira no banco de dados faria o orquestrador encerrar um processo que, fora isso, estaria
saudável, transformando uma breve indisponibilidade em um loop de reinicializações.

`/health` não é autenticado, portanto publica apenas o veredito e não o motivo —
fora de desenvolvimento, ele apenas indica qual fonte de dados está degradada e nada mais. O
texto de erro do driver cita o host, a porta, o nome do banco de dados e a role, e isso
vai para os logs. Ambos os caminhos também são servidos sob o `basePath` (`/api/health`).

---

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

    // Database adapter (PostgreSQL, SQLite, etc.)
    database?: DatabaseAdapter;

    // Authentication configuration or custom adapter
    auth?: RebaseAuthConfig | AuthAdapter;

    // File storage
    storage?: BackendStorageConfig | Record<string, BackendStorageConfig>;

    // Entity history
    history?: boolean | HistoryConfig;

    // OpenAPI/Swagger
    enableSwagger?: boolean;

    // Custom API endpoints
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks
    cronsDir?: string;         // Auto-load cron jobs from a directory
    cronPersistence?: boolean; // Write run logs to rebase.cron_logs (default: true)

    // HTTP behaviour
    compression?: boolean;     // gzip/deflate for API responses (default: true)
    maxBodySize?: number;      // Request-body ceiling in bytes (default: 10MB; 0 disables)
    csrf?: { origin: string | string[] | ((origin: string) => boolean) };

    // Schema editing
    schemaEditor?: boolean;   // Force the schema-editor routes on or off

    // Logging
    logging?: { level?: "error" | "warn" | "info" | "debug" };
}
```

Cinco dessas opções passam facilmente despercebidas e alteram comportamentos que,
de outra forma, você só conseguiria observar:

| Chave | Padrão | O que faz |
|---|---|---|
| `compression` | `true` | gzip/deflate em respostas da API, negociado a partir de `Accept-Encoding`. Corpos já comprimidos, transmitidos por streaming e com `no-transform` são mantidos inalterados, por isso é seguro mantê-lo ativado — uma listagem JSON grande normalmente é reduzida em cerca de 20x. Defina como `false` quando o nginx, Cloudflare ou outro proxy à frente já realizar a compactação, evitando processamento duplicado. Variável de ambiente: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Limite máximo para corpos de requisição nas rotas da API; `0` desativa. Uploads de armazenamento utilizam o `maxFileSize` próprio da configuração de armazenamento (50MB), que tem precedência nessas rotas. Variável de ambiente: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | desativado | **Opcional (Opt-in).** Uma API BaaS é consumida por aplicativos móveis, SPAs em outros domínios e ferramentas CLI, nenhum dos quais envia um `Origin` aceito por uma lista fixa — portanto, isso não vem ativado por padrão. Ative informando as origens utilizadas pelos clientes do seu navegador. Sem formato por variável de ambiente: execute eject para configurá-lo. |
| `cronPersistence` | `true` | Define se os logs de execução são gravados em `rebase.cron_logs`. `false` mantém as tarefas em execução e o histórico apenas na memória, o qual o painel do Studio perde após uma reinicialização. |
| `schemaEditor` | ativado fora de produção, quando `collectionsDir` está definido | Força a ativação ou desativação das rotas do editor de esquema. O editor reescreve os *arquivos-fonte* das coleções, necessitando de um diretório no qual gravar — e um bundle compilado não possui nenhum, razão pela qual um deploy de produção nunca o contém. |

O restante do `RebaseBackendConfig` está documentado em sua própria página (`auth`,
`storage`, `jobs`, `callbacks`, `liveSchema`, `rlsAudit`) ou marcado como `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` e `runtimeVersion` são preenchidos pelo
`bootFromBundle` a partir do ambiente, e passá-los manualmente é uma maneira de
divergir do runtime sobre a natureza deste processo.

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

> **Nota:** Embora a `instance` exponha esses serviços internos, o código da aplicação (como funções personalizadas e tarefas cron) deve usar o singleton global `rebase` de `@rebasepro/server` para interagir com a API do backend.

## API REST

A API REST é gerada automaticamente a partir das suas coleções. Cada coleção recebe estes endpoints:

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/data/:slug` | Listar entidades — filtragem, ordenação, paginação e busca são parâmetros de consulta |
| `GET` | `/api/data/:slug/count` | Quantas linhas a mesma consulta corresponde |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obter uma única entidade |
| `POST` | `/api/data/:slug` | Criar uma nova entidade |
| `PATCH` | `/api/data/:slug/:id` | Atualizar os campos enviados |
| `DELETE` | `/api/data/:slug/:id` | Excluir um registro |
| `POST` | `/api/data/:slug/bulk` | Criar várias linhas em uma única transação |
| `PATCH` | `/api/data/:slug/bulk` | Atualizar várias linhas em uma única transação |
| `POST` | `/api/data/:slug/bulk/delete` | Excluir várias linhas em uma única transação |

### Parâmetros de consulta

Existe uma referência exclusiva para eles e não é esta página. A [API REST](/docs/backend/api/)
documenta ambos os dialetos de consulta aceitos pelo servidor — o formato no estilo PostgREST
`?column=op.value` e o formato JSON `?where=` — juntamente com `orderBy`,
`limit`/`offset`, `include`, `fields`, `searchString` e busca vetorial.
[Endpoints](/docs/backend/endpoints/) é o índice de todas as rotas que o
servidor monta, incluindo as geradas automaticamente.

Um parâmetro que o servidor não reserva é interpretado como um filtro na coluna
com aquele nome; portanto, um parâmetro inventado não gera erro: ele simplesmente
não corresponderá a nada de forma silenciosa.

## WebSocket

O servidor WebSocket é acoplado ao mesmo servidor HTTP e fornece inscrições em tempo real:

- Inscrever-se em **alterações na coleção** — receba notificações quando qualquer entidade em uma coleção for criada, atualizada ou excluída
- Inscrever-se em **alterações na entidade** — receba notificações quando uma entidade específica for alterada
- Tratamento automático de **reconexão** no SDK do cliente

O backend utiliza PostgreSQL `LISTEN/NOTIFY` internamente. Para deploys com múltiplas instâncias, forneça uma `connectionString` no seu `PostgresBootstrapper` para habilitar a transmissão (broadcasting) entre instâncias.

## Tratamento de Erros

Toda falha — de qualquer rota, em qualquer subsistema — retorna em um único envelope:

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
|-------|:--------------:|---------|
| `message` | sim | Escrito para uma pessoa lendo um console. Identifica o obstáculo, não a regra. |
| `code` | sim | `SCREAMING_SNAKE_CASE` e estável. Este é o campo a ser usado para ramificações lógicas (branching). |
| `details` | não | Payload estruturado quando a recusa é *sobre* algo — uma lista de caminhos com falha, um conjunto de campos desconhecidos. |
| `requestId` | não | Presente quando a requisição carregava ou recebeu um ID; reflete o `X-Request-ID`. Cite-o em um relatório de bug. |

O status HTTP está na resposta, não no corpo. Trate as condições com base no `code`, não na
`message` — as mensagens são escritas para humanos e podem mudar.

O SDK do cliente converte cada uma dessas falhas em um `RebaseApiError` contendo
`status`, `code` e `details` — incluindo as falhas que nem sequer chegaram a um
servidor. Uma conexão recusada, uma falha de DNS, CORS ou um cancelamento (abort) chega como
`status: 0`, `code: "NETWORK_ERROR"`, com o erro do próprio runtime em `cause`,
em vez de qualquer coisa com a qual o `fetch` decidiu rejeitar. Assim, o
código da aplicação captura apenas uma classe:

```typescript
async function setPrice(id: string, price: number) {
    try {
        return await client.data.products.update(id, { price });
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

## Próximos Passos

- **[Autenticação](/docs/backend/authentication)** — Provedores JWT, OAuth e OIDC, MFA, chaves de API, gerenciamento de usuários
- **[Armazenamento](/docs/backend/storage)** — Armazenamento de arquivos local e no S3
- **[Callbacks de Entidades](/docs/collections/callbacks)** — Hooks de ciclo de vida e API `context.data`
- **[Histórico de Entidades](/docs/backend/history)** — Trilha de auditoria
- **[Funções Personalizadas](/docs/backend/custom-functions)** — Adicione endpoints de API customizados
- **[Tarefas Cron](/docs/backend/cron-jobs)** — Tarefas agendadas em segundo plano
- **[Branching de Banco de Dados](/docs/backend/branching)** — Cópias instantâneas do banco de dados para dev/staging
- **[Deploy](/docs/getting-started/deployment)** — Leve o backend para produção
