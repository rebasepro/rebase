---
sourceHash: 3d3fc39a95926201
title: Visão Geral do Backend
sidebar_label: Backend
description: O backend do Rebase fornece um servidor completo com API REST, autenticação, armazenamento, tempo real via WebSocket e histórico de entidades — tudo inicializado com uma única chamada de função.
---

## Visão Geral

O backend do Rebase é um **servidor Node.js** construído sobre o [Hono](https://hono.dev/) que fornece:

- **REST API** — Endpoints CRUD gerados automaticamente para cada tabela
- **Autenticação** — Tokens JWT, login via OAuth e OIDC, magic links, códigos de uso único, MFA, chaves de API, gerenciamento de usuários/funções
- **Armazenamento** — Upload/download de arquivos com sistema de arquivos local ou S3
- **WebSocket** — Sincronização de dados em tempo real via PostgreSQL LISTEN/NOTIFY
- **Histórico de Entidades** — Trilha de auditoria para cada alteração de dados
- **Branching de Banco de Dados** — Cópias instantâneas e isoladas do banco de dados para dev/staging/testes
- **Cron Jobs** — Tarefas agendadas em segundo plano com painel de monitoramento

Tudo é inicializado com uma única função:

:::note[Onde isso fica]
A chamada abaixo é o que um backend **ejetado** (ejected) possui, em `backend/src/index.ts`. No
**runtime gerenciado** não existe tal arquivo: o runtime faz a chamada, e
você o configura por meio de variáveis de ambiente, das tabelas exportadas por `backend/schema/index.ts`,
dos recursos declarados em `backend/resources.ts` (`database()`,
`bucket()`), e de duas exportações lidas por ele: `storageAuthorize` de
`backend/storage.ts` e `hooks` de `backend/hooks.ts`. Cada página desta
seção indica qual dos dois se aplica à opção documentada e nomeia
aquelas que não possuem uma forma gerenciada. Exportar qualquer outra coisa desses dois módulos fará com que
o runtime avise na inicialização em vez de descartar silenciosamente; exportar uma opção
que uma declaração de recurso substituiu fará a inicialização recusá-la pelo nome, indicando
a linha de `backend/resources.ts` a ser escrita em seu lugar.
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

Essa única chamada é
um atalho para etapas públicas: `installUnhandledRejectionHandler` impede que uma rejeição
não tratada encerre o processo, `createRebaseBackend` compila o backend,
`setDefaultBackend` o define como aquele pelo qual a API em nível de módulo responde, e
`mount`, `attachRealtime` e `start` o colocam em execução. Para montar apenas alguns grupos
de rotas, colocá-los em outros caminhos, delegar os temporizadores a outro processo ou executar
dois backends em um único processo, execute as etapas você mesmo. Consulte
[Integração com Servidor Customizado](/docs/backend/custom-server/).

## Onde fica cada opção

Essa chamada é o formato **ejetado** — aquele que você mesmo escreve após `rebase
eject`, ou em um servidor customizado. Um projeto gerado via scaffold não o possui: o
runtime publicado inicializa o projeto, e cada opção chega como uma variável de ambiente
no `.env`, uma exportação de `backend/storage.ts` ou `backend/hooks.ts`,
ou um diretório que o bundle declara em `rebase.json`.

Ambos os caminhos chegam à mesma `RebaseBackendConfig`. Este é o mapa completo.

| Opção | Runtime gerenciado |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (padrão `/api`) |
| `tables`, `schemaDir`, `defaultRls` | o diretório `backend/schema/` (a chave `tables` de `rebase.json`): as tabelas e o `defaultRls` que seu `index.ts` exporta |
| `rpc` | <span class="since-badge" data-since="0.35">A partir da versão 0.35</span> as declarações `defineRpc` que `backend/schema/index.ts` exporta — consulte [Funções SQL como RPC](/docs/backend/rpc/) |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, além de uma declaração `database("<key>")` em `backend/resources.ts` para cada banco de dados além do padrão |
| `auth` | `JWT_SECRET`, as variáveis `OAUTH_*` e a tabela declarada em `backend/schema` com `defineAuthTable` |
| `storage` | as variáveis `STORAGE_*`, além de uma declaração `bucket("<key>")` em `backend/resources.ts` para cada bucket além do padrão |
| `storageAuthorize` | `export const storageAuthorize` de `backend/storage.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` de `backend/hooks.ts` — hooks globais de tabela |
| `history` | `REBASE_HISTORY` (ativado por padrão) — apenas na forma booleana |
| `push` | `REBASE_PUSH`, com `REBASE_VAPID_*` para as chaves — apenas na forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; não definido disponibiliza `/api/docs` para o público do endpoint de schema, `true` publica com a Swagger UI, `false` o mantém protegido por acesso administrativo |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` e suas credenciais `REBASE_LIVE_SCHEMA_*` — apenas na forma de repositório |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — consulte [Processos Divididos](/docs/deployment/split-processes/) |
| `corsHandled` | O CORS é instalado pelo runtime a partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | o build grava ambos no bundle |
| `app`, `server`, `provisioningDriverResult` | o runtime os cria |

### Opções sem rota gerenciada

Estas não possuem variável de ambiente nem exportação de módulo. Elas são acessíveis
apenas por meio de uma chamada manual a `initializeRebaseBackend` — `rebase eject`, ou em um
[servidor customizado](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` em seu formato de objeto (`{ retention }`) ·
`push` em seu formato de objeto (`{ allowedHosts, sender, vapid }`)

`schemaEditor` é desativado forçadamente em um bundle compilado: o editor reescreve os
arquivos *fonte* de `backend/schema`, e um bundle contém apenas a saída compilada.

## O Que é Criado

Após a inicialização, estas rotas são montadas:

| Caminho | Finalidade |
|------|---------|
| `/api/auth/*` | Autenticação (cadastro, login, refresh, OAuth, magic links, códigos de uso único, MFA) |
| `/api/admin/*` | Usuários, funções, chaves de serviço, cron, backups, logs e schema, cada um protegido pelo seu próprio [escopo](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Upload, download e exclusão de arquivos |
| `/api/data/:slug` | Operações CRUD por tabela (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Histórico de alterações de entidades (quando ativado) |
| `/api/docs` | Especificação OpenAPI das tabelas que o chamador tem permissão para visualizar (pública com `enableSwagger: true`; restrita a administradores com `false`) |
| `/api/swagger` | Swagger UI (com `enableSwagger: true`, somente fora de produção) |
| `/api/schema/tables` | As tabelas servidas por este backend, conforme visíveis pelo chamador — consulte [Endpoints](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | A versão do schema, o runtime e cada tabela conforme visualizados por um administrador (requer `schema:read`) |
| `/api/meta/schema-version` | Uma string de versão para esse schema (não autenticado) |
| `/api/rpc/:name` | <span class="since-badge" data-since="0.35">A partir da versão 0.35</span> As funções SQL declaradas com `defineRpc`, chamadas no contexto do chamador — consulte [Funções SQL como RPC](/docs/backend/rpc/) |
| `/api/functions/*` | Rotas de funções customizadas (quando `functions` ou `functionsDir` estiver configurado) |
| `/api/push/*` | Inscrições de [notificações push](/docs/backend/push-notifications/) (quando `push` estiver ativado) |
| `/api/admin/cron/*` | Gerenciamento de tarefas cron (`cron:read` / `cron:write`, quando `crons` ou `cronsDir` estiver configurado) |
| WebSocket no upgrade | Inscrições em tempo real, em `/` para uma API em `/api` |

---

## O Ciclo de Vida de Inicialização

Ao invocar `initializeRebaseBackend()`, o framework dispara uma sequência de inicialização em 5 etapas:

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

**A inicialização falha de forma ruidosa.** Se o banco de dados estiver inacessível, as credenciais estiverem
incorretas ou o schema não puder ser compilado ou aplicado, `initializeRebaseBackend`
lança um erro, nada é servido e o processo é encerrado com código `1`. Não há modo degradado
nem servidor parcial: um container que não consegue alcançar seu banco de dados reinicia, e
o erro fatal será a última coisa em seus logs.

Isso é deliberado. Um servidor que inicializa respondendo a login enquanto todas as
rotas `/api/data/*` falham é muito mais difícil de diagnosticar do que um que nunca chega a
subir — além disso, um orquestrador pode agir sobre um ciclo de reinicializações (crash loop).

Antes da primeira consulta, o processo de inicialização testa a conexão e exibe o diagnóstico: o
host e a porta que não puderam ser alcançados, o motivo do próprio driver (`ECONNREFUSED`,
`password authentication failed for user "app"`) e a solução recomendada. Consulte
[Solução de Problemas](/docs/troubleshooting/) para obter a lista detalhada de falhas.

### Depois que estiver em execução: `/livez` e `/health`

Dois testes, respondendo a duas perguntas diferentes.

| Caminho | Acessa o banco de dados | Resposta |
| --- | --- | --- |
| `/livez` | Não | `200 {"status":"ok"}` enquanto o processo estiver em execução. Use para o liveness probe. |
| `/health` | Sim, todas as fontes de dados | `200 {"status":"ok"}` quando todas as fontes de dados configuradas responderem; `503 {"status":"degraded"}` quando uma delas não responder. Use para o readiness probe. |

Configurar um liveness probe em `/health` é um erro que vale a pena destacar: uma oscilação temporária no banco de dados
faria o orquestrador encerrar um processo perfeitamente saudável, transformando uma breve indisponibilidade
em um ciclo de reinicializações.

`/health` não exige autenticação, portanto publica o veredito e não o motivo detalhado —
fora do ambiente de desenvolvimento, ele apenas informa qual fonte de dados está degradada e nada mais. O
texto de erro do driver indica o host, a porta, o nome do banco de dados e a role, sendo registrado
nos logs. `/health` também é disponibilizado sob o `basePath` (`/api/health`);
já `/livez` não.

Ambos os probes pertencem ao runtime gerenciado. Um arquivo `backend/src/index.ts` ejetado disponibiliza
`/health` e `/api/health` por conta própria, testando apenas o banco de dados padrão, e não
possui `/livez` até que você adicione um.

---

## Referência de Configuração

<span class="since-badge" data-since="0.35">A partir da versão 0.35</span> A opção `rpc` abaixo.

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

Cinco delas passam despercebidas facilmente e alteram comportamentos que, de outra forma, você só conseguiria
observar:

| Chave | Padrão | O que faz |
|---|---|---|
| `compression` | `true` | gzip/deflate nas respostas da API, negociado via `Accept-Encoding`. Corpos já compactados, transmitidos via stream ou com `no-transform` são mantidos inalterados, assim como corpos com menos de 1 KB (o gzip custaria mais do que economizaria nesses casos); portanto, é seguro mantê-lo ativado — uma lista JSON grande geralmente tem seu tamanho reduzido em cerca de 20x. Defina como `false` quando o nginx, Cloudflare ou outro proxy à frente já realizar compactação, para evitar pagar duas vezes. Variável de ambiente: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Limite máximo para o corpo de requisições nas rotas de API; `0` desativa o limite. Uploads no armazenamento utilizam o `maxFileSize` próprio da configuração de storage (50MB), que prevalece para essas rotas. Variável de ambiente: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | desativado | **Opcional (opt-in).** Uma API de BaaS é consumida por aplicativos móveis, SPAs em outros domínios e ferramentas CLI, nenhum dos quais envia um `Origin` aceitável por uma lista estática — logo, isso não fica ativado por padrão. Ative definindo as origens utilizadas pelos clientes do seu navegador. Sem formato via variável de ambiente: ejete para configurá-lo. |
| `cronPersistence` | `true` | Define se os logs de execução são gravados em `rebase.cron_logs`. `false` mantém os jobs em execução com o histórico somente em memória, que o painel do Studio perde ao reiniciar. |
| `schemaEditor` | ativado fora de produção, quando `schemaDir` estiver configurado | Força as rotas do editor de schema como ativadas ou desativadas. O editor reescreve os *arquivos-fonte* em `backend/schema`, necessitando de um diretório para escrita — e um bundle compilado não possui nenhum, motivo pelo qual uma implantação nunca o contém. |

O restante de `RebaseBackendConfig` está documentado em sua respectiva página (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) ou marcado como `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` e `runtimeVersion` são preenchidos por
`bootFromBundle` a partir do ambiente, e passá-los manualmente é uma maneira de
divergir do runtime sobre o que este processo representa.

## A Instância do Backend

`initializeRebaseBackend` retorna o backend construído, já montado e
iniciado. Seu tipo é `RebaseBackendInstance`, que corresponde a `RebaseBackend`, o
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

Ele também inclui
`rebase`, o cliente interno do processo, `fetch(request)`, `routes`, os grupos de rotas
como sub-aplicações Hono, `services`, suas próprias chaves JWT, modelo de acesso, repositório de chaves de API e
limitadores de taxa, e `verifyCredential(token)`; consulte
[Integração com Servidor Customizado](/docs/backend/custom-server/).

> **Nota:** Embora a `instance` exponha esses serviços internos, o código da aplicação (como funções customizadas e cron jobs) deve usar o singleton `rebase` de `@rebasepro/server` para interagir com a API do backend. Dentro de uma requisição, execução de cron ou job, `rebase` é o backend que o está atendendo; em outros locais, é o padrão do processo, que `initializeRebaseBackend` define como seu backend.

## API REST

A API REST é gerada a partir das suas tabelas. Toda tabela recebe estes endpoints:

| Método | Caminho | Descrição |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lista entidades — filtros, ordenação, paginação e busca são parâmetros de query |
| `GET` | `/api/data/:slug/count` | Quantidade de linhas que correspondem à mesma query |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obtém uma única entidade |
| `POST` | `/api/data/:slug` | Cria uma nova entidade |
| `PATCH` | `/api/data/:slug/:id` | Atualiza os campos enviados |
| `DELETE` | `/api/data/:slug/:id` | Exclui um registro |
| `POST` | `/api/data/:slug/bulk` | Cria várias linhas em uma única transação |
| `PATCH` | `/api/data/:slug/bulk` | Atualiza várias linhas em uma única transação |
| `POST` | `/api/data/:slug/bulk/delete` | Exclui várias linhas em uma única transação |

### Parâmetros de consulta

Existe uma documentação de referência dedicada para eles e não é esta página. A [API
REST](/docs/backend/api/) documenta ambos os dialetos de consulta que o servidor aceita — o
formato estilo PostgREST `?column=op.value` e o formato JSON `?where=` — juntamente com
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` e busca vetorial.
[Endpoints](/docs/backend/endpoints/) é o índice de todas as rotas montadas pelo
servidor, incluindo as rotas geradas automaticamente.

Qualquer parâmetro que o servidor não reserve é interpretado como um filtro na coluna
correspondente a esse nome; logo, inventar um parâmetro não causa erro: ele simplesmente não corresponderá a nada silenciosamente.

## WebSocket

O servidor WebSocket conecta-se ao mesmo servidor HTTP e oferece inscrições em tempo real. Ele responde a upgrades em um único caminho, `/` para uma API em `/api`, onde o SDK se conecta, deixando qualquer outro caminho para os seus próprios ouvintes de `upgrade`:

- Assine **alterações na tabela** — receba notificações quando qualquer linha de uma tabela for criada, atualizada ou excluída
- Assine **alterações na linha** — receba notificações quando uma linha específica for modificada
- Tratamento automático de **reconexão** no SDK tipado

O backend utiliza o `LISTEN/NOTIFY` do PostgreSQL internamente. Para implantações com múltiplas instâncias, forneça uma `connectionString` no seu `PostgresBootstrapper` para permitir a transmissão entre instâncias.

## Tratamento de Erros

Qualquer falha — de qualquer rota, em qualquer subsistema — retorna em um único envelope:

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
| `message` | sim | Redigido para uma pessoa lendo no console. Informa o obstáculo, não a regra. |
| `code` | sim | `SCREAMING_SNAKE_CASE` e estável. Este é o campo a ser usado em condicionais. |
| `details` | não | Payload estruturado quando a recusa for *sobre* algo específico — uma lista de caminhos com falha, um conjunto de campos desconhecidos. |
| `requestId` | não | Presente quando a requisição possuía ou recebeu um ID; reflete o cabeçalho `X-Request-ID`. Inclua-o ao reportar um bug. |

O status HTTP está na resposta, não no corpo. Crie condicionais com base no `code`, e não na
`message` — mensagens são escritas para humanos e podem mudar.

O SDK tipado converte cada uma dessas falhas em um `RebaseApiError` contendo
`status`, `code` e `details` — inclusive falhas que sequer chegaram ao
servidor. Uma conexão recusada, uma falha de DNS, CORS ou um cancelamento chegam como
`status: 0`, `code: "NETWORK_ERROR"`, com o erro do próprio runtime em `cause`,
em vez de qualquer rejeição com a qual o `fetch` decida falhar. Uma resposta sem
envelope — um erro 413 de um proxy, um erro 502 de um balanceador de carga — ainda recebe um `code` correspondente ao seu
status (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), e um
cliente instanciado fora de um navegador sem um `baseUrl` falha com
`BASE_URL_REQUIRED` em vez de um erro de rede.
Uma leitura bem-sucedida que não retorna a estrutura esperada — um status `204`, um corpo vazio, uma página sem a
lista `data` — falha com `UNEXPECTED_RESPONSE` em vez de resolver como "nenhuma linha", e
`createMany`, `updateMany`, `deleteMany` ou `batch` recebendo algo diferente de
um array falham com `INVALID_BULK_BODY`, o mesmo código usado pelo servidor para esse
erro. Dessa forma, o código da aplicação captura apenas uma classe:

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
- **[Armazenamento](/docs/backend/storage)** — Armazenamento de arquivos local e S3
- **[Hooks de tabela](/docs/collections/callbacks)** — Hooks de ciclo de vida e a API `context.data`
- **[Histórico de Entidades](/docs/backend/history)** — Trilha de auditoria
- **[Funções Customizadas](/docs/backend/custom-functions)** — Adicione endpoints customizados à API
- **[Funções SQL como RPC](/docs/backend/rpc)** — Execute uma função Postgres em `/api/rpc/<name>`, no contexto do chamador
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tarefas agendadas em segundo plano
- **[Branching de Banco de Dados](/docs/backend/branching)** — Cópias instantâneas de banco de dados para dev/staging
- **[Implantação](/docs/getting-started/deployment)** — Leve o backend para produção
