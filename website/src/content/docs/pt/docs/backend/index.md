---
sourceHash: c9afeee7ed06431e
title: Visão Geral do Backend
sidebar_label: Backend
description: O backend do Rebase fornece um servidor completo com API REST, autenticação, armazenamento, WebSocket em tempo real e histórico de entidades — tudo inicializado com uma única chamada de função.
---

## Visão Geral

O backend do Rebase é um **servidor Node.js** construído sobre o [Hono](https://hono.dev/) que fornece:

- **API REST** — Endpoints CRUD gerados automaticamente para cada tabela
- **Autenticação** — Tokens JWT, login via OAuth e OIDC, magic links, códigos de uso único, MFA, chaves de API, gerenciamento de usuários/papéis
- **Armazenamento** — Upload/download de arquivos com sistema de arquivos local ou S3
- **WebSocket** — Sincronização de dados em tempo real via PostgreSQL LISTEN/NOTIFY
- **Histórico de Entidades** — Trilha de auditoria para cada alteração de dados
- **Ramificação de Banco de Dados** — Cópias de banco de dados instantâneas e isoladas para dev/staging/testes
- **Cron Jobs** — Tarefas em segundo plano agendadas com painel de monitoramento

Tudo é inicializado com uma única função:

:::note[Onde isso vai]
A chamada abaixo é o que um backend **ejetado** (ejected) tem, em `backend/src/index.ts`. No
**runtime gerenciado** não existe esse arquivo: o runtime faz a chamada, e
você o configura por meio de variáveis de ambiente, das tabelas exportadas por
`backend/schema/index.ts`, dos recursos declarados em `backend/resources.ts` (`database()`,
`bucket()`) e de duas exportações que ele lê: `storageAuthorize` de
`backend/storage.ts` e `hooks` de `backend/hooks.ts`. Cada página nesta
seção informa qual das duas opções se aplica à configuração documentada e lista
aquelas que não possuem uma forma gerenciada. Exporte qualquer outra coisa desses dois módulos e
o runtime emitirá um aviso na inicialização em vez de ignorá-la silenciosamente; exporte algo
que uma declaração de recurso substituiu e a inicialização recusará pelo nome, indicando a
linha de `backend/resources.ts` a ser escrita em seu lugar.
:::

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";
import path from "node:path";
import { env } from "./env";

const instance = await initializeRebaseBackend({
    app,
    server,
    schemaDir: path.resolve(__dirname, "../schema"),
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations }
    }),
    auth: {
        jwtSecret: env.JWT_SECRET,
    },
    storage: { type: "local", basePath: "./uploads" },
    history: true
});
```

Essa chamada única é
um atalho sobre etapas públicas: `installUnhandledRejectionHandler` evita que uma rejeição
inesperada encerre o processo, `createRebaseBackend` cria o backend,
`setDefaultBackend` o define como aquele pelo qual a API a nível de módulo responde, e
`mount`, `attachRealtime` e `start` o servem. Para montar apenas alguns grupos de
rotas, colocá-los em outros caminhos, deixar os temporizadores para outro processo ou executar
dois backends em um único processo, execute as etapas você mesmo. Veja
[Integração com Servidor Customizado](/docs/backend/custom-server/).

## Onde cada opção reside

Essa chamada é o formato **ejetado** — aquele que você mesmo escreve após `rebase eject` ou em um servidor customizado. Um projeto gerado via scaffold não o possui: o runtime publicado inicializa o projeto, e cada opção chega como uma variável de ambiente em `.env`, uma exportação de `backend/storage.ts` ou `backend/hooks.ts`, ou um diretório declarado pelo bundle em `rebase.json`.

Ambos os caminhos chegam ao mesmo `RebaseBackendConfig`. Este é o mapa completo.

| Opção | Runtime gerenciado |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (padrão `/api`) |
| `tables`, `schemaDir`, `defaultRls` | o diretório `backend/schema/` (a chave `tables` de `rebase.json`): as tabelas e o `defaultRls` exportados pelo seu `index.ts` |
| `rpc` | <span class="since-badge" data-since="0.35">Desde 0.35</span> as declarações `defineRpc` exportadas por `backend/schema/index.ts` — veja [Funções SQL como RPC](/docs/backend/rpc/) |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, além de uma declaração `database("<key>")` em `backend/resources.ts` para cada banco de dados além do padrão |
| `auth` | `JWT_SECRET`, as variáveis `OAUTH_*` e a tabela declarada em `backend/schema` com `defineAuthTable` |
| `storage` | as variáveis `STORAGE_*`, além de uma declaração `bucket("<key>")` em `backend/resources.ts` para cada bucket além do padrão |
| `storageAuthorize` | `export const storageAuthorize` de `backend/storage.ts` |
| `storagePolicies` | `STORAGE_POLICIES`, como regras JSON — veja [Autorização de armazenamento](/docs/backend/storage-authorization/#as-data-storage_policies) |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` de `backend/hooks.ts` — hooks globais de tabela |
| `history` | `REBASE_HISTORY` (ativado por padrão) — apenas na forma booleana |
| `push` | `REBASE_PUSH`, com `REBASE_VAPID_*` para as chaves — apenas na forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; se não definido, serve `/api/docs` para o público do endpoint de schema, `true` publica-o com a Swagger UI, `false` mantém-no protegido pelo acesso de administrador |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` e suas credenciais `REBASE_LIVE_SCHEMA_*` — apenas no formato de repositório |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — veja [Processos Divididos](/docs/deployment/split-processes/) |
| `corsHandled` | O CORS é instalado pelo runtime a partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | a compilação inclui ambos no bundle |
| `app`, `server`, `provisioningDriverResult` | o runtime os cria |

### Opções sem rota gerenciada

Estas não possuem variável de ambiente nem exportação de módulo. Elas são acessíveis apenas a partir de uma chamada manual de `initializeRebaseBackend` — `rebase eject` ou em um [servidor customizado](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` em seu formato de objeto (`{ retention }`) ·
`push` em seu formato de objeto (`{ allowedHosts, sender, vapid }`)

`schemaEditor` é desativado forçadamente em um bundle compilado: o editor reescreve os arquivos de *código-fonte* em `backend/schema`, e um bundle contém apenas a saída compilada.

## O Que É Criado

Após a inicialização, estas rotas são montadas:

| Caminho | Finalidade |
|------|---------|
| `/api/auth/*` | Autenticação (cadastro, login, refresh, OAuth, magic links, códigos de uso único, MFA) |
| `/api/admin/*` | Usuários, papéis, chaves de serviço, cron, backups, logs e schema, cada um sob seu próprio [escopo](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Upload, download e exclusão de arquivos |
| `/api/data/:slug` | Operações CRUD por tabela (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Histórico de alterações de entidade (quando ativado) |
| `/api/docs` | Especificação OpenAPI das tabelas visíveis ao chamador (público com `enableSwagger: true`; restrito a admin com `false`) |
| `/api/swagger` | Swagger UI (com `enableSwagger: true`, somente fora de produção) |
| `/api/schema/tables` | As tabelas servidas por este backend, como o chamador pode vê-las — veja [Endpoints](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | A versão do schema, o runtime e cada tabela como um administrador os visualiza (requer `schema:read`) |
| `/api/meta/schema-version` | Uma string de versão para esse schema (não autenticado) |
| `/api/rpc/:name` | <span class="since-badge" data-since="0.35">Desde 0.35</span> As funções SQL declaradas com `defineRpc`, chamadas como o chamador — veja [Funções SQL como RPC](/docs/backend/rpc/) |
| `/api/functions/*` | Rotas de funções customizadas (quando `functions` ou `functionsDir` está configurado) |
| `/api/push/*` | Assinaturas de [notificações push](/docs/backend/push-notifications/) (quando `push` está ativado) |
| `/api/admin/cron/*` | Gerenciamento de tarefas cron (`cron:read` / `cron:write`, quando `crons` ou `cronsDir` está configurado) |
| WebSocket no upgrade | Assinaturas em tempo real, em `/` para uma API em `/api` |

---

## O Ciclo de Vida de Inicialização

Quando você invoca `initializeRebaseBackend()`, o framework dispara uma sequência de inicialização sequencial de 5 estágios:

```
[Start Boot]
     │
     ▼
1. Configuration (the database adapter, the auth and storage options you passed)
     │
     ▼
2. Schema Loading (imports backend/schema/index.ts, compiles every table — a problem in any refuses the boot)
     │
     ▼
3. Database Bootstrapping (creates schemas/auth/helper SQL functions, as `provision` allows)
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

**A inicialização falha de forma ruidosa (loudly).** Se o banco de dados estiver inacessível, as credenciais estiverem
incorretas ou o schema não puder ser compilado ou aplicado, o `initializeRebaseBackend`
lança um erro, nada é servido e o processo é encerrado com código `1`. Não há modo degradado
nem servidor parcial: um contêiner que não consegue alcançar seu banco de dados é reiniciado, e
o erro que causou a falha é a última coisa registrada em seus logs.

Isso é intencional. Um servidor que inicializa respondendo a solicitações de login enquanto todas
as rotas `/api/data/*` falham é muito mais difícil de diagnosticar do que um que nunca chega a
subir — e um orquestrador pode agir diante de um loop de falhas (crash loop).

Antes da primeira consulta, a inicialização testa a conexão e exibe o diagnóstico: o
host e a porta que não puderam ser alcançados, o motivo reportado pelo próprio driver (`ECONNREFUSED`,
`password authentication failed for user "app"`) e a solução. Veja
[Solução de Problemas](/docs/troubleshooting/) para a lista detalhada de falhas.

### Quando estiver em execução: `/livez` e `/health`

Duas sondas (probes), respondendo a duas perguntas diferentes.

| Caminho | Acessa o banco de dados | Responde |
| --- | --- | --- |
| `/livez` | Não | `200 {"status":"ok"}` enquanto o processo estiver em execução. Use para a sonda de vivacidade (liveness probe). |
| `/health` | Sim, todas as fontes de dados | `200 {"status":"ok"}` quando todas as fontes de dados configuradas respondem; `503 {"status":"degraded"}` quando alguma falhar. Use para a sonda de prontidão (readiness probe). |

Configurar uma sonda de vivacidade (liveness probe) em `/health` é um erro que vale a pena destacar: uma oscilação momentânea no banco de dados faria o orquestrador encerrar um processo perfeitamente saudável, transformando uma breve interrupção em um ciclo contínuo de reinicializações.

`/health` não exige autenticação, portanto ele divulga o veredito e não o motivo detalhado —
fora do ambiente de desenvolvimento, ele apenas identifica qual fonte de dados está degradada. O
texto de erro do driver indica o host, porta, nome do banco e perfil (role), e isso é registrado
nos logs. `/health` também é servido sob o `basePath` (`/api/health`);
o `/livez` não.

Ambas as sondas pertencem ao runtime gerenciado. Um `backend/src/index.ts` ejetado serve
`/health` e `/api/health` por conta própria, testando apenas o banco de dados padrão, e não
possui `/livez` a menos que você adicione um.

---

## Referência de Configuração

<span class="since-badge" data-since="0.35">Desde 0.35</span> A opção `rpc` abaixo.

```typescript
interface RebaseBackendConfig {
    // HTTP framework
    app: Hono;               // Hono application instance
    server: Server;           // Node.js HTTP server (for WebSocket attachment)
    basePath?: string;        // Route prefix (default: "/api")

    // Tables
    tables?: (AnyTableDef | AnyViewDef)[]; // defineTable / defineAuthTable / defineView results
    defaultRls?: DefaultRls;  // What `rls: "inherit"` tables take, when you pass `tables`
    schemaDir?: string;       // The backend/schema directory: loaded when `tables` is absent, and what the schema editor writes
    hooks?: TableHooks;       // Global table hooks, run for every table

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

    // SQL functions served at /api/rpc/<name> (defineRpc). Read from the
    // schemaDir index when the tables are; pass them as values otherwise.
    rpc?: AnyRpcDef[];

    // Custom API endpoints: values, or a directory of files (not both)
    functions?: Record<string, FunctionApp>;  // { "send-invoice": app } → /api/functions/send-invoice
    functionsDir?: string;    // Auto-load Hono routes from a directory

    // Scheduled tasks: values, or a directory of files (not both)
    crons?: Record<string, CronJobDefinition>; // { "nightly-report": defineCron(…) }
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

Cinco dessas opções passam facilmente despercebidas e alteram comportamentos que, de outra forma, você só conseguiria observar na prática:

| Chave | Padrão | O que faz |
|---|---|---|
| `compression` | `true` | gzip/deflate nas respostas da API, negociado a partir de `Accept-Encoding`. Corpos já comprimidos, transmitidos por streaming e marcados com `no-transform` não são alterados, assim como corpos abaixo de 1 KB (o processamento do gzip custa mais do que economiza nesse caso), portanto é seguro manter ativado — uma lista grande em JSON normalmente é reduzida em cerca de 20x. Defina como `false` quando o nginx, Cloudflare ou outro proxy à frente já fizer compressão, evitando processamento duplicado. Variável de ambiente: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Limite máximo para corpos de requisição nas rotas da API; `0` desativa. Uploads de armazenamento utilizam o `maxFileSize` próprio da configuração de armazenamento (50MB), que prevalece para essas rotas. Variável de ambiente: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | desativado | **Opcional (Opt-in).** Uma API BaaS é consumida por aplicativos móveis, SPAs em outros domínios e ferramentas CLI, nenhum dos quais envia um `Origin` que uma lista fixa aceitaria — portanto, isso não fica ativado por padrão. Ative definindo as origens usadas pelos seus clientes web no navegador. Sem formato por variável de ambiente: requer ejeção (eject) para configurar. |
| `cronPersistence` | `true` | Define se os logs de execução são gravados em `rebase.cron_logs`. `false` mantém as tarefas em execução e o histórico apenas em memória, que o painel do Studio perde após a reinicialização. |
| `schemaEditor` | ativado fora de produção, quando `schemaDir` estiver configurado | Força a ativação ou desativação das rotas do editor de schema. O editor reescreve os *arquivos-fonte* de `backend/schema`, necessitando de um diretório para gravação — e um bundle compilado não tem diretório, razão pela qual ele nunca está presente em produção. |

O restante de `RebaseBackendConfig` é documentado em sua própria página (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) ou marcado como `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` e `runtimeVersion` são preenchidos pelo
`bootFromBundle` a partir do ambiente, e passá-los manualmente é uma maneira de
entrar em conflito com o runtime sobre a natureza deste processo.

## A Instância do Backend

`initializeRebaseBackend` retorna o backend construído, já montado e
iniciado. Seu tipo é `RebaseBackendInstance`, que é `RebaseBackend`, o
tipo retornado por `createRebaseBackend`:

```typescript
const instance = await initializeRebaseBackend(config);

// Internal service access
instance.driver              // Default data driver
instance.driverRegistry      // All drivers (for multi-database)
instance.realtimeService     // Default realtime service
instance.auth?.userService       // User management
instance.storageController   // Default storage
instance.storageRegistry     // All storage backends
instance.getTableDescriptors() // The compiled tables, as GET /api/schema/tables serves them
instance.history?.historyService // Entity history
instance.cronScheduler       // Cron job scheduler (when crons or cronsDir is set)
instance.jobQueue            // Durable job queue (when jobs are enabled)
instance.setTableHooks(slug, hooks) // Replace a table's hooks
instance.shutdown()          // Drain and stop; also closes the server it was given
```

Ela também traz
`rebase`, o cliente in-process, `fetch(request)`, `routes`, os grupos de rotas
como sub-aplicações do Hono, `services`, suas próprias chaves JWT, modelo de acesso, repositório de chaves de API e
limitadores de taxa (rate limiters), e `verifyCredential(token)`; veja
[Integração com Servidor Customizado](/docs/backend/custom-server/).

> **Nota:** Embora a `instance` exponha esses serviços internos, o código da aplicação (como funções customizadas e cron jobs) deve usar o singleton `rebase` de `@rebasepro/server` para interagir com a API do backend. Dentro de uma requisição, execução de cron ou tarefa, `rebase` é o backend que a atende; em outros locais, é o padrão do processo, definido por `initializeRebaseBackend` para o seu backend.

## API REST

A API REST é gerada a partir das suas tabelas. Toda tabela recebe estes endpoints:

| Método | Caminho | Descrição |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Listar entidades — filtros, ordenação, paginação e busca são parâmetros de consulta |
| `GET` | `/api/data/:slug/count` | Quantas linhas correspondem à mesma consulta |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obter uma única entidade |
| `POST` | `/api/data/:slug` | Criar uma nova entidade |
| `PATCH` | `/api/data/:slug/:id` | Atualizar os campos enviados |
| `DELETE` | `/api/data/:slug/:id` | Excluir um registro |
| `POST` | `/api/data/:slug/bulk` | Criar múltiplas linhas em uma única transação |
| `PATCH` | `/api/data/:slug/bulk` | Atualizar múltiplas linhas em uma única transação |
| `POST` | `/api/data/:slug/bulk/delete` | Excluir múltiplas linhas em uma única transação |

### Parâmetros de consulta

Existe uma referência específica para eles, e não é esta página. A documentação da [API
REST](/docs/backend/api/) detalha ambos os dialetos de consulta aceitos pelo servidor — o
formato estilo PostgREST `?column=op.value` e o formato JSON `?where=` — juntamente com
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` e busca
vetorial. A página de [Endpoints](/docs/backend/endpoints/) é o índice de todas as rotas que o
servidor monta, incluindo as rotas geradas.

Um parâmetro que o servidor não reserva é interpretado como um filtro na coluna correspondente a
esse nome, portanto, um parâmetro inventado não causa erro: ele simplesmente não retorna nenhuma correspondência em silêncio.

## WebSocket

O servidor WebSocket é anexado ao mesmo servidor HTTP e fornece assinaturas em tempo real. Ele responde a upgrades em um caminho, `/` para uma API em `/api`, onde o SDK se conecta, deixando todos os outros caminhos para seus próprios listeners de `upgrade`:

- Assinar **alterações de tabela** — receba notificações quando qualquer linha em uma tabela for criada, atualizada ou excluída
- Assinar **alterações de linha** — receba notificações quando uma linha específica for alterada
- Tratamento automático de **reconexão** no SDK tipado

O backend utiliza PostgreSQL `LISTEN/NOTIFY` internamente. Para implantações multi-instância, forneça uma `connectionString` no seu `PostgresBootstrapper` para permitir a transmissão entre instâncias.

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
|-------|:--------------:|------------|
| `message` | sim | Escrito para leitura humana no console. Descreve o obstáculo, não a regra. |
| `code` | sim | `SCREAMING_SNAKE_CASE` e estável. Este é o campo usado para ramificações condicionais. |
| `details` | não | Dados estruturados quando a recusa se refere a algo específico — uma lista de caminhos com falha, um conjunto de campos desconhecidos. |
| `requestId` | não | Presente quando a requisição trouxe ou recebeu um ID atribuído; reflete `X-Request-ID`. Cite-o em relatórios de problemas. |

O status HTTP está na resposta, não no corpo. Trate as condições com base no `code`, e não na
`message` — mensagens são escritas para humanos e estão sujeitas a alterações.

O SDK tipado converte cada um desses erros em um `RebaseApiError` contendo
`status`, `code` e `details` — incluindo as falhas que nunca chegaram a alcançar um
servidor. Uma conexão recusada, uma falha de DNS, CORS ou um cancelamento (abort) chega como
`status: 0`, `code: "NETWORK_ERROR"`, trazendo o erro do próprio runtime em `cause`,
em vez de qualquer erro genérico que o `fetch` decida rejeitar. Uma resposta sem
envelope — um erro 413 de um proxy, um 502 de um balanceador de carga — ainda recebe um `code` baseado em seu
status (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), e um
cliente instanciado fora do navegador sem uma `baseUrl` falha com
`BASE_URL_REQUIRED` em vez de um erro de rede.
Uma leitura que retorna sucesso
sem a estrutura esperada — um `204`, um corpo vazio, uma página sem a lista
`data` — falha com `UNEXPECTED_RESPONSE` em vez de resolver como "nenhuma linha", e
invocações de `createMany`, `updateMany`, `deleteMany` ou `batch` fornecendo algo que não seja
um array falham com `INVALID_BULK_BODY`, o mesmo código usado pelo servidor para esse
erro. Portanto, o código da aplicação captura uma única classe:

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
- **[Hooks de tabela](/docs/collections/callbacks)** — Hooks de ciclo de vida e a API `context.data`
- **[Histórico de Entidades](/docs/backend/history)** — Trilha de auditoria
- **[Funções Customizadas](/docs/backend/custom-functions)** — Adicione endpoints de API customizados
- **[Funções SQL como RPC](/docs/backend/rpc)** — Chame uma função Postgres em `/api/rpc/<name>`, como o chamador
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tarefas em segundo plano agendadas
- **[Ramificação de Banco de Dados](/docs/backend/branching)** — Cópias de banco de dados instantâneas para dev/staging
- **[Implantação](/docs/getting-started/deployment)** — Leve o backend para produção
