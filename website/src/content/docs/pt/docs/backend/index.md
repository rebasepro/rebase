---
sourceHash: 9be8187c5259c1dd
title: Visão Geral do Backend
sidebar_label: Backend
description: O backend do Rebase fornece um servidor completo com API REST, autenticação, armazenamento, tempo real via WebSocket e histórico de entidades — tudo inicializado com uma única chamada de função.
---

## Visão Geral

O backend do Rebase é um **servidor Node.js** construído sobre o [Hono](https://hono.dev/) que fornece:

- **REST API** — Endpoints CRUD gerados automaticamente para cada tabela
- **Authentication** — Tokens JWT, login via OAuth e OIDC, magic links, códigos de uso único, MFA, chaves de API, gerenciamento de usuários/papéis
- **Storage** — Upload/download de arquivos com sistema de arquivos local ou S3
- **WebSocket** — Sincronização de dados em tempo real via PostgreSQL LISTEN/NOTIFY
- **Entity History** — Trilha de auditoria para cada alteração de dados
- **Database Branching** — Cópias de banco de dados instantâneas e isoladas para dev/staging/testes
- **Cron Jobs** — Tarefas agendadas em segundo plano com painel de monitoramento

Tudo é inicializado com uma única função:

:::note[Onde isso fica]
A chamada abaixo é o que um backend **ejetado** (ejected) possui, em `backend/src/index.ts`. No
**runtime gerenciado** não existe esse arquivo: o runtime faz a chamada, e
você o configura por meio de variáveis de ambiente, das tabelas que `backend/schema/index.ts`
exporta, dos recursos declarados em `backend/resources.ts` (`database()`,
`bucket()`), e de duas exportações que ele lê: `storageAuthorize` de
`backend/storage.ts` e `hooks` de `backend/hooks.ts`. Cada página nesta
seção informa qual dos dois se aplica à opção documentada e nomeia
aquelas que não possuem uma forma gerenciada. Exporte qualquer outra coisa desses dois módulos e
o runtime emitirá um aviso na inicialização em vez de ignorar em silêncio; exporte um
que uma declaração de recurso substituiu e a inicialização recusará pelo nome, indicando a
linha de `backend/resources.ts` que deve ser escrita em vez disso.
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
um atalho para etapas públicas: `installUnhandledRejectionHandler` evita que uma rejeição
inesperada encerre o processo, `createRebaseBackend` constrói o backend,
`setDefaultBackend` o define como aquele pelo qual a API em nível de módulo responde, e
`mount`, `attachRealtime` e `start` o servem. Para montar apenas alguns grupos
de rotas, colocá-los em outros caminhos, deixar os temporizadores para outro processo ou executar
dois backends em um único processo, chame as etapas você mesmo. Consulte
[Integração com Servidor Customizado](/docs/backend/custom-server/).

## Onde cada opção fica

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Essa chamada é o formato **ejetado** — aquele que você mesmo escreve após `rebase
eject`, ou em um servidor customizado. Um projeto gerado por scaffolding não a possui: o
runtime publicado inicializa o projeto, e cada opção chega como uma variável de
ambiente em `.env`, uma exportação de `backend/storage.ts` ou `backend/hooks.ts`,
ou um diretório que o bundle declara em `rebase.json`.

Ambos os caminhos chegam à mesma `RebaseBackendConfig`. Este é o mapa completo.

| Opção | Runtime gerenciado |
|---|---|
| `basePath` | `REBASE_BASE_PATH` (padrão `/api`) |
| `tables`, `schemaDir`, `defaultRls` | o diretório `backend/schema/` (a chave `tables` de `rebase.json`): as tabelas e o `defaultRls` que seu `index.ts` exporta |
| `functions`, `functionsDir` | `backend/functions/` |
| `functionsTimeoutMs` | `REBASE_FUNCTIONS_TIMEOUT_MS` |
| `crons`, `cronsDir` | `backend/crons/` |
| `bootstrappers`, `database` | `DATABASE_URL`, além de uma declaração `database("<key>")` em `backend/resources.ts` para cada banco de dados além do padrão |
| `auth` | `JWT_SECRET`, as variáveis `OAUTH_*`, e a tabela que `backend/schema` declara com `defineAuthTable` |
| `storage` | as variáveis `STORAGE_*`, além de uma declaração `bucket("<key>")` em `backend/resources.ts` para cada bucket além do padrão |
| `storageAuthorize` | `export const storageAuthorize` de `backend/storage.ts` |
| `storagePublicRead` | `STORAGE_PUBLIC_READ` |
| `storageRenditionCache` | `STORAGE_RENDITION_CACHE` |
| `storageInsecureAllowAnyAuthenticated` | `STORAGE_ALLOW_ANY_AUTHENTICATED` |
| `storageDownloadTokenTtl` | `STORAGE_DOWNLOAD_TOKEN_TTL` |
| `hooks` | `export const hooks` de `backend/hooks.ts` — hooks globais de tabela |
| `history` | `REBASE_HISTORY` (habilitado por padrão) — apenas na forma booleana |
| `enableSwagger` | `REBASE_ENABLE_SWAGGER`; não definido serve `/api/docs` para o público do endpoint de schema, `true` publica com a Swagger UI, `false` mantém protegido atrás de acesso de administrador |
| `compression` | `REBASE_COMPRESSION` |
| `maxBodySize` | `REBASE_MAX_BODY_SIZE` |
| `logging` | `LOG_LEVEL` |
| `liveSchema` | `REBASE_LIVE_SCHEMA_REPOSITORY` e suas credenciais `REBASE_LIVE_SCHEMA_*` — apenas na forma de repositório |
| `rlsAudit` | `REBASE_RLS_AUDIT` |
| `provisionSchema`, `surfaces`, `ownership`, `functionsSelection`, `functionsUpstream` | `REBASE_ROLE` — consulte [Processos Divididos](/docs/deployment/split-processes/) |
| `corsHandled` | O CORS é instalado pelo runtime a partir de `CORS_ORIGINS` |
| `schemaVersion`, `runtimeVersion` | a compilação grava ambos no bundle |
| `app`, `server`, `provisioningDriverResult` | o runtime os cria |

### Opções sem rota gerenciada

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Estas não possuem variável de ambiente e nem exportação de módulo. Elas são acessíveis
apenas a partir de uma chamada manual a `initializeRebaseBackend` — `rebase eject`, ou um
[servidor customizado](/docs/backend/custom-server/):

`rateLimit` · `jobs` · `csrf` · `cronPersistence` ·
`storagePolicies` · `storageTriggers` · `baas` · `schemaTables` ·
`history` em sua forma de objeto (`{ retention }`)

`schemaEditor` é forçadamente desativado em um bundle compilado: o editor reescreve os arquivos
*fonte* de `backend/schema`, e um bundle contém apenas a saída compilada.

## O que é criado

Após a inicialização, estas rotas são montadas:

| Caminho | Finalidade |
|------|---------|
| `/api/auth/*` | Autenticação (cadastro, login, refresh, OAuth, magic links, códigos de uso único, MFA) |
| `/api/admin/*` | Usuários, papéis, chaves de serviço, cron, backups, logs e schema, cada um protegido por seu próprio [escopo](/docs/backend/roles-and-scopes/) |
| `/api/storage/*` | Upload, download e exclusão de arquivos |
| `/api/data/:slug` | Operações CRUD por tabela (GET, POST, PATCH, DELETE) |
| `/api/data/:slug/:id/history` | Histórico de alterações de entidade (quando habilitado) |
| `/api/docs` | Especificação OpenAPI das tabelas que o chamador pode ver (público com `enableSwagger: true`; apenas para admin com `false`) |
| `/api/swagger` | Swagger UI (com `enableSwagger: true`, apenas fora de produção) |
| `/api/schema/tables` | As tabelas que este backend serve, conforme o chamador tem permissão para vê-las — consulte [Endpoints](/docs/backend/endpoints/#schema) |
| `/api/meta/contract` | A versão do schema, o runtime e cada tabela como um administrador os vê (requer `schema:read`) |
| `/api/meta/schema-version` | Uma string de versão para esse schema (não autenticado) |
| `/api/functions/*` | Rotas de funções customizadas (quando `functions` ou `functionsDir` está definido) |
| `/api/admin/cron/*` | Gerenciamento de tarefas cron (`cron:read` / `cron:write`, quando `crons` ou `cronsDir` está definido) |
| WebSocket no upgrade | Inscrições em tempo real, em `/` para uma API em `/api` |

---

## O Ciclo de Vida de Inicialização

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Quando você invoca `initializeRebaseBackend()`, o framework dispara uma sequência de inicialização de 5 etapas:

```
[Início do Boot]
     │
     ▼
1. Configuração (o adaptador de banco de dados, as opções de auth e storage que você passou)
     │
     ▼
2. Carregamento de Schema (importa backend/schema/index.ts, compila cada tabela — um problema em qualquer uma recusa o boot)
     │
     ▼
3. Bootstrapping do Banco de Dados (cria schemas/auth/funções SQL auxiliares, conforme `provision` permitir)
     │
     ▼
4. Inicialização de Serviços (instâncias de clientes Auth, Storage S3/Local, população inicial do armazenamento do Cron)
     │
     ▼
5. Montagem de Rotas e Carregamento de Edge (controladores Hono, funções customizadas, vinculação de WebSocket)
     │
     ▼
[Boot Concluído]
```

---

## O que acontece quando a inicialização falha

**A inicialização falha ruidosamente.** Se o banco de dados estiver inacessível, as credenciais estiverem
incorretas ou o schema não puder ser compilado ou aplicado, `initializeRebaseBackend`
lança uma exceção, nada é servido e o processo é encerrado com código `1`. Não há modo degradado
nem servidor parcial: um container que não consegue alcançar seu banco de dados reinicia, e
o erro que o encerrou é a última coisa em seus logs.

Isso é deliberado. Um servidor que inicializa respondendo ao login enquanto cada
rota `/api/data/*` falha é muito mais difícil de diagnosticar do que um que nunca
inicia — e um orquestrador pode agir sobre um loop de falhas (crash loop).

Antes da primeira consulta, o boot sonda a conexão e imprime o diagnóstico: o
host e a porta que não pôde alcançar, o motivo indicado pelo próprio driver (`ECONNREFUSED`,
`password authentication failed for user "app"`), e a solução. Consulte
[Solução de Problemas](/docs/troubleshooting/) para obter a lista detalhada de falhas.

### Uma vez em execução: `/livez` e `/health`

Duas sondas (probes), respondendo a duas perguntas diferentes.

| Caminho | Acessa o banco de dados | Resposta |
| --- | --- | --- |
| `/livez` | Não | `200 {"status":"ok"}` enquanto o processo estiver em execução. Use para uma sonda de vivacidade (liveness probe). |
| `/health` | Sim, todas as fontes de dados | `200 {"status":"ok"}` quando todas as fontes de dados configuradas respondem; `503 {"status":"degraded"}` quando uma delas não responde. Use para uma sonda de prontidão (readiness probe). |

Uma sonda de vivacidade em `/health` é um erro que vale a pena destacar: uma oscilação momentânea do banco de dados
faria o orquestrador matar um processo que de outra forma estaria saudável, transformando uma breve indisponibilidade
em um loop de reinicialização.

`/health` não requer autenticação, portanto publica o veredito e não o motivo —
fora do ambiente de desenvolvimento, ele apenas informa qual fonte de dados está degradada e nada mais. O
texto de erro do driver cita o host, a porta, o nome do banco de dados e a role, e isso vai
para os logs. `/health` também é servido sob o `basePath` (`/api/health`);
o `/livez` não.

Ambas as sondas são do runtime gerenciado. Um `backend/src/index.ts` ejetado serve
`/health` e `/api/health` por conta própria, sondando apenas o banco de dados padrão, e não possui
`/livez` até que você adicione uma.

---

## Referência de Configuração

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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

Cinco dessas opções são fáceis de passar despercebidas e alteram comportamentos que, de outra forma, você só conseguiria
observar:

| Chave | Padrão | O que faz |
|---|---|---|
| `compression` | `true` | gzip/deflate em respostas da API, negociado a partir de `Accept-Encoding`. Corpos já comprimidos, em streaming e marcados como `no-transform` são mantidos intactos, assim como corpos com menos de 1 KB (onde o gzip custa mais do que economiza), portanto é seguro deixar ativado — uma lista JSON grande normalmente é reduzida em aproximadamente 20x. Defina como `false` quando o nginx, Cloudflare ou outro proxy à frente já fizer a compressão, para evitar processamento duplicado. Ambiente: `REBASE_COMPRESSION`. |
| `maxBodySize` | `10485760` (10MB) | Limite máximo para corpos de requisição em rotas de API; `0` desativa. Uploads de storage usam o próprio `maxFileSize` (50MB) da configuração de storage, que prevalece para essas rotas. Ambiente: `REBASE_MAX_BODY_SIZE`. |
| `csrf` | desativado | **Opcional (opt-in).** Uma API BaaS é chamada por aplicativos móveis, SPAs em outros domínios e ferramentas de CLI, nenhum dos quais envia um `Origin` que uma lista fixa aceitaria — portanto, isso não fica ativado por padrão. Ative com as origens que seus clientes no navegador utilizam. Sem formato de variável de ambiente: ejete para configurá-lo. |
| `cronPersistence` | `true` | Se os logs de execução devem ser gravados em `rebase.cron_logs`. `false` mantém as tarefas em execução e o histórico apenas em memória, que o painel do Studio perde ao reiniciar. |
| `schemaEditor` | ativado fora de produção, quando `schemaDir` estiver definido | Força a ativação ou desativação das rotas do editor de schema. O editor reescreve os *arquivos-fonte* de `backend/schema`, portanto precisa de um diretório no qual gravar — e um bundle compilado não possui nenhum, razão pela qual um ambiente de deployment nunca o inclui. |

O restante de `RebaseBackendConfig` está documentado em sua própria página (`auth`,
`storage`, `jobs`, `hooks`, `liveSchema`, `rlsAudit`, `schemaTables`) ou marcado como `@internal`:
`bootstrappers`, `provisioningDriverResult`, `provisionSchema`, `corsHandled`,
`functionsSelection`, `functionsUpstream` e `runtimeVersion` são preenchidos por
`bootFromBundle` a partir do ambiente, e passá-los manualmente é uma maneira de
entrar em conflito com o runtime sobre a natureza deste processo.

## A Instância do Backend

`initializeRebaseBackend` retorna o backend que construiu, já montado e
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

Ele também traz
`rebase`, o cliente em processo (in-process), `fetch(request)`, `routes`, os grupos de rotas
como sub-aplicações Hono, `services`, suas próprias chaves JWT, modelo de acesso, armazenamento de chaves de API e
limitadores de taxa, além de `verifyCredential(token)`; consulte
[Integração com Servidor Customizado](/docs/backend/custom-server/).

> **Nota:** Embora a `instance` exponha esses serviços internos, o código da aplicação (como funções customizadas e tarefas cron) deve usar o singleton `rebase` de `@rebasepro/server` para interagir com a API do backend. Dentro de uma requisição, execução de cron ou job, `rebase` é o backend que está respondendo; em outros locais, é o padrão do processo, que `initializeRebaseBackend` define como o seu backend.

## API REST

A API REST é gerada a partir das suas tabelas. Toda tabela recebe estes endpoints:

| Método | Caminho | Descrição |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Lista entidades — filtragem, ordenação, paginação e busca são parâmetros de consulta |
| `GET` | `/api/data/:slug/count` | Quantas linhas a mesma consulta corresponde |
| `GET` | `/api/data/:slug/aggregate` | `count`/`sum`/`avg`/`min`/`max`, opcionalmente agrupados |
| `GET` | `/api/data/:slug/:id` | Obtém uma única entidade |
| `POST` | `/api/data/:slug` | Cria uma nova entidade |
| `PATCH` | `/api/data/:slug/:id` | Atualiza os campos enviados |
| `DELETE` | `/api/data/:slug/:id` | Exclui um registro |
| `POST` | `/api/data/:slug/bulk` | Cria várias linhas em uma única transação |
| `PATCH` | `/api/data/:slug/bulk` | Atualiza várias linhas em uma única transação |
| `POST` | `/api/data/:slug/bulk/delete` | Exclui várias linhas em uma única transação |

### Parâmetros de consulta

Existe uma referência dedicada para eles e não é esta página. A [API
REST](/docs/backend/api/) documenta ambos os dialetos de consulta que o servidor aceita — o
formato estilo PostgREST `?column=op.value` e o formato JSON `?where=` — juntamente com
`orderBy`, `limit`/`offset`, `include`, `fields`, `searchString` e busca
vetorial. [Endpoints](/docs/backend/endpoints/) é o índice de todas as rotas que o
servidor monta, incluindo as geradas.

Um parâmetro que o servidor não reserva é lido como um filtro na coluna
correspondente a esse nome, portanto, um parâmetro inventado não falha: ele silenciosamente não encontra correspondências.

## WebSocket

O servidor WebSocket é anexado ao mesmo servidor HTTP e fornece inscrições em tempo real. Ele responde a upgrades em um único caminho, `/` para uma API em `/api`, onde o SDK se conecta, e deixa todos os outros caminhos para os seus próprios ouvintes (listeners) de `upgrade`:

- Inscreva-se em **alterações na tabela** — receba notificações quando qualquer linha em uma tabela for criada, atualizada ou excluída
- Inscreva-se em **alterações na linha** — receba notificações quando uma linha específica for alterada
- Tratamento automático de **reconexão** no SDK tipado

O backend usa PostgreSQL `LISTEN/NOTIFY` internamente. Para deployments com múltiplas instâncias, forneça uma `connectionString` em seu `PostgresBootstrapper` para habilitar a transmissão (broadcasting) entre instâncias.

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
| `message` | sim | Escrito para uma pessoa lendo um console. Nomeia o obstáculo, não a regra. |
| `code` | sim | `SCREAMING_SNAKE_CASE` e estável. Este é o campo a ser utilizado em condicionais (branching). |
| `details` | não | Payload estruturado quando a recusa for *sobre* algo — uma lista de caminhos com falha, um conjunto de campos desconhecidos. |
| `requestId` | não | Presente quando a requisição possuía ou recebeu um ID atribuído; reflete `X-Request-ID`. Cite-o em um relatório de bug. |

O status HTTP está na resposta, não no corpo. Trate condições com base no `code`, e não na
`message` — mensagens são escritas para humanos e podem mudar livremente.

O SDK tipado transforma cada uma dessas falhas em um `RebaseApiError` contendo
`status`, `code` e `details` — incluindo falhas que sequer chegaram a
um servidor. Uma conexão recusada, uma falha de DNS, CORS ou um cancelamento (abort) chegam como
`status: 0`, `code: "NETWORK_ERROR"`, com o erro do próprio runtime em `cause`,
em vez de qualquer erro genérico com o qual o `fetch` tenha decidido rejeitar. Uma resposta sem
envelope — o 413 de um proxy, o 502 de um balanceador de carga — ainda recebe um `code` baseado em seu
status (`PAYLOAD_TOO_LARGE`, `SERVICE_UNAVAILABLE`, `INTERNAL_ERROR`, …), e um
cliente instanciado fora do navegador sem `baseUrl` falha com
`BASE_URL_REQUIRED` em vez de um erro de rede.
Uma leitura que obtém sucesso
sem o formato esperado — um `204`, um corpo vazio, uma página sem uma lista `data`
— falha com `UNEXPECTED_RESPONSE` em vez de resolver como "nenhuma linha", e
`createMany`, `updateMany`, `deleteMany` ou `batch` que recebam algo diferente de
um array falham com `INVALID_BULK_BODY`, o mesmo código que o servidor usa para o mesmo
erro. Assim, o código da aplicação captura apenas uma classe:

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
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tarefas agendadas em segundo plano
- **[Branching de Banco de Dados](/docs/backend/branching)** — Cópias instantâneas do banco de dados para dev/staging
- **[Deployment](/docs/getting-started/deployment)** — Leve o backend para produção
