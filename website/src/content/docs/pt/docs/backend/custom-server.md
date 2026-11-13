---
sourceHash: c42fc466c64146e7
title: Integração com Servidor Personalizado
sidebar_label: Servidor Personalizado
description: Construa o backend do Rebase a partir de partes públicas em seu próprio servidor — createRebaseBackend, seus grupos de rotas, mount, attachRealtime e start — ou incorpore o driver do Postgres no Express.
---

# Integração com Servidor Personalizado

`initializeRebaseBackend` é um atalho. Ele cria todo o backend, monta-o
em sua aplicação Hono sob `/api`, conecta o socket de tempo real ao seu servidor
HTTP e inicia o trabalho em segundo plano, em uma única chamada. Quando for isso o que você
precisa, use-o.

Quando não for, dê um passo para trás. Cada parte dessa chamada é uma peça pública
que você mesmo pode chamar: construa o backend e, em seguida, monte tudo ou apenas os
grupos de rotas que desejar, nos caminhos que quiser, e decida qual processo inicia
os temporizadores. [Incorporando o driver do Postgres](/docs/backend/embedding-postgres-driver/)
vai um passo além e abre o driver do Postgres isoladamente em uma aplicação Express.

## Configuração de Ambiente

O Rebase fornece um utilitário centralizado `loadEnv()` em `@rebasepro/server` que valida suas variáveis de ambiente em relação a um esquema Zod rigoroso. Chame-o **após** carregar seu arquivo `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

Para adicionar variáveis tipadas próprias, estenda o esquema:

```typescript
import { loadEnv, z } from "@rebasepro/server";

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

:::caution[Duas cópias do zod]
Duas cópias do zod carregadas ao mesmo tempo costumavam quebrar essa chamada silenciosamente. `loadEnv`
combinava os esquemas com `.merge()`, que aceita um esquema da outra cópia
e depois rejeita todos os campos que possuem um `.default()`. O servidor inicializava,
reportava sucesso e não executava nenhum de seus crons; nada na falha mencionava
o zod.

`loadEnv` agora valida o esquema base e o seu esquema `extend` cada um com seu
próprio `.parse()`, portanto, um esquema construído por outra cópia do zod funciona. O runtime
fornece o `zod`, e o `backend/package.json` do scaffold o lista no intervalo
usado por `@rebasepro/server`, para que uma única cópia seja instalada: mantenha as duas iguais.
:::

**Comportamentos principais:**
- Gera `JWT_SECRET` e `REBASE_SERVICE_KEY` em desenvolvimento quando não estiverem definidos, para que você possa começar sem configuração manual, e os armazena em cache em `.rebase-dev-secrets.json` para que uma reinicialização não desconecte ninguém.
- Bloqueia segredos gerados automaticamente em produção — você deve defini-los explicitamente.
- Valida se `CORS_ORIGINS` ou `FRONTEND_URL` está definido em produção.
- Recusa um valor de `extend` que não seja um esquema zod.
- Lança um `Error` nomeando cada variável ausente ou incorreta, como `DATABASE_URL: is required`, com os problemas do zod em sua propriedade `issues`.

Consulte `.env.example` na aplicação gerada pelo scaffold para a lista completa de variáveis suportadas.

## Um passo abaixo de `initializeRebaseBackend`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`initializeRebaseBackend` resume-se a estas chamadas, e nada mais:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({
    ...options,
    // `false` or `{ collections: false, realtime: false }` in the cases
    // the `provision` section below lists.
    provision: true
});
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

O `shutdown()` que ele retorna também fecha o servidor fornecido. Aqui está
a mesma lógica descrita no arquivo `backend/src/index.ts` de um projeto, pronta para ser modificada.
O comando `rebase dev` executa esse arquivo quando um projeto o possui, no lugar da inicialização
padrão do runtime. Colado em um projeto gerado por scaffold, ele serve o que o runtime servia:
a API na porta escolhida por `rebase dev`, login e registro com a
tabela de autenticação do projeto, as tabelas exportadas por `backend/schema/index.ts`, os
hooks globais em `backend/hooks.ts`, as funções em `backend/functions/`, os cron jobs
em `backend/crons/`, os buckets declarados em `backend/resources.ts` e o CORS
que o painel de administração precisa em sua própria porta.

```typescript
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { getRequestListener } from "@hono/node-server";
import {
    CORS_EXPOSED_HEADERS,
    createRebaseBackend,
    installShutdownHandlers,
    installUnhandledRejectionHandler,
    isLocalhostOrigin,
    loadEnv,
    logger,
    resolveStorageSources,
    setDefaultBackend,
    type HonoEnv
} from "@rebasepro/server";
import {
    createPostgresAdapter,
    createPostgresDatabaseConnection,
    postgresDriverConfigFromEnv
} from "@rebasepro/server-postgres";
import { declaredStorageSources } from "@rebasepro/types";
import "../resources";
import { storageAuthorize } from "../storage";
import { hooks } from "../hooks";

// dotenv never overrides a variable already set, so what `rebase dev` sets wins.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });
const env = loadEnv();

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cronsDir = path.join(root, "backend/crons");

installUnhandledRejectionHandler();

const app = new Hono<HonoEnv>();

// Localhost in development, and the origins in CORS_ORIGINS or FRONTEND_URL.
const origins = (env.CORS_ORIGINS || env.FRONTEND_URL || "").split(",").map((origin) => origin.trim());
app.use("/*", cors({
    origin: (origin) =>
        origins.includes(origin) || (env.NODE_ENV !== "production" && isLocalhostOrigin(origin)) ? origin : null,
    credentials: true,
    exposeHeaders: [...CORS_EXPOSED_HEADERS]
}));
app.use("/*", secureHeaders());

const server = createServer({ maxHeaderSize: 64 * 1024 }, getRequestListener(app.fetch));
const { db, pool, connectionString } = createPostgresDatabaseConnection(env.DATABASE_URL);

const backend = await createRebaseBackend({
    schemaDir: path.join(root, "backend/schema"),
    hooks,
    functionsDir: path.join(root, "backend/functions"),
    cronsDir: existsSync(cronsDir) ? cronsDir : undefined,
    database: createPostgresAdapter(postgresDriverConfigFromEnv({ connection: db, connectionString })),
    auth: {
        jwtSecret: env.JWT_SECRET,
        serviceKey: env.REBASE_SERVICE_KEY,
        allowRegistration: env.ALLOW_REGISTRATION,
        cookieAuth: { sameSite: "Lax" }
    },
    storage: resolveStorageSources(process.env, declaredStorageSources(), path.join(root, "uploads")),
    storageAuthorize,
    history: true,
    provision: true
});

setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();

// The runtime answers health on both paths; an orchestrator probes `/health`.
for (const healthPath of ["/health", "/api/health"]) {
    app.get(healthPath, async (c) => {
        const { healthy } = await backend.healthCheck();
        return c.json({ status: healthy ? "ok" : "degraded" }, healthy ? 200 : 503);
    });
}

// `rebase dev` reads this line to know the backend is up.
server.listen(env.PORT, () => logger.info(`Server running at http://localhost:${env.PORT}`));
installShutdownHandlers(
    { shutdown: (timeoutMs) => backend.shutdown(timeoutMs, { server }) },
    { onCleanup: () => pool.end() }
);
```

Os caminhos são os do scaffold; omita a importação e a opção `hooks` quando o
projeto não possuir `backend/hooks.ts`. Os usuários são armazenados na tabela declarada
por `backend/schema` com `defineAuthTable`, portanto `auth` não nomeia nenhuma tabela.
O arquivo depende do que `rebase dev` define: a
porta escolhida em `PORT`, o banco de dados gerenciado em `DATABASE_URL` e o
`.env` do projeto em `DOTENV_CONFIG_PATH`. `loadEnv()` valida o que ele
contém e gera `JWT_SECRET` em desenvolvimento quando não estiver definido. Escute em
outra porta e o painel de administração não conseguirá alcançar o servidor; pule `loadEnv()` e,
sem `JWT_SECRET`, o login fica desativado.
O `rebase dev` também aguarda a linha `Server running at http://localhost:<port>`
antes de relatar que o backend está ativo. As opções de `auth` são as do scaffold; o
runtime também lê os provedores OAuth, e-mail e as outras variáveis `AUTH_*`,
portanto passe as que você utiliza, conforme descrito em [Autenticação](/docs/backend/authentication/).
O arquivo também não serve o painel de administração compilado em produção: o
ponto de entrada gerado por [`rebase eject`](/docs/cli/) faz isso, com `serveSPA`, e abre
uma conexão por banco de dados declarado em `backend/resources.ts`.

`createRebaseBackend` aceita as mesmas opções que `initializeRebaseBackend`,
sem `app`, `server` e `basePath`, e com `provision` obrigatório. Ele
constrói tudo: abre o banco de dados, configura autenticação e armazenamento, carrega as
funções e cron jobs, e cria cada grupo de rotas e o cliente interno do processo.
Ele não monta nada, não inicia nenhum temporizador e não adiciona nenhum listener ao processo. Cada
uma das etapas restantes é uma chamada que você faz, ou omite:

| Chamada | O que faz | Ao omitir |
|---|---|---|
| `installUnhandledRejectionHandler()` | Registra a rejeição de uma promise que nada tratou, como uma chamada fire-and-forget em uma função personalizada, em vez de deixar o Node encerrar o processo. Afeta todo o processo, sendo uma decisão do processo, não de um backend. Retorna uma função que o desinstala, ou `undefined` quando já houver um instalado ou se `REBASE_EXIT_ON_UNHANDLED_REJECTION` estiver definido. | uma rejeição não tratada encerra o processo, padrão do Node |
| `setDefaultBackend(backend)` | Torna este backend o [padrão do processo](#vários-backends-em-um-processo): o que `import { rebase }` e o restante da API de nível de módulo atendem fora das requisições, execuções de cron e jobs que um backend serve | essa API não tem nenhum backend para responder nesse contexto |
| `backend.mount(app, { basePath })` | Monta todos os grupos de rotas sob `basePath` (padrão `/api`), atrás dos middlewares globais do processo: IDs de requisição, limite de corpo, compressão, CSRF, log de requisições e o envelope JSON para erros e caminhos desconhecidos. Também o documento JWKS, o servidor MCP, os documentos OpenAPI e os aliases de rotas legadas. | nada é servido via HTTP; `backend.rebase` e `backend.fetch` continuam funcionando |
| `backend.attachRealtime(server, { path })` | O socket de tempo real, em `server`, respondendo a upgrades apenas em `path` | não há live queries |
| `backend.start()` | O agendador de cron, os workers de jobs, as limpezas de tokens expirados e retenção de histórico, o amostrador de métricas e a auditoria programada de RLS, cada um onde o `ownership` atribuir a este processo. Seguro para chamar duas vezes. | nenhum deles é executado, o que é o desejado para um processo que apenas atende requisições em uma [implantação dividida](/docs/deployment/split-processes/) |
| `backend.shutdown(timeoutMs, { server })` | Encerra o que `start()` e `attachRealtime()` iniciaram, aguardando execuções de cron e jobs em andamento. Fecha o `server` apenas quando você o passar. | |

O `path` padrão do socket é o caminho base fornecido a `mount()` sem o sufixo
`/api`, portanto `/api` resulta em `/` e `/x/api` resulta em `/x`; um caminho base que
não termina em `/api` resulta em `/`. É para onde o
SDK aponta, pois ele se conecta ao seu `baseUrl` enquanto suas requisições HTTP vão para
`${baseUrl}/api`. Um upgrade para qualquer outro caminho é deixado para os outros
listeners de `upgrade` do servidor, permitindo que sua aplicação execute seu próprio servidor WebSocket no mesmo
`http.Server`.

### O que a criação de um backend pode alterar: `provision`

A criação de um backend pode executar DDL, portanto `createRebaseBackend` solicita sua decisão:

| `provision` | Cria | Para |
|---|---|---|
| `true` | Tudo o que o backend serve: as tabelas declaradas e suas políticas de RLS, captura de alterações para tempo real, o papel (role) com o qual as requisições são executadas e as tabelas próprias do framework (chaves de API, execuções de cron, jobs, métricas). | uma implantação de processo único; o que `initializeRebaseBackend` passa |
| `false` | Nada, na inicialização ou posteriormente: as tabelas que outros backends criam no primeiro uso (chaves de idempotência, reivindicações de cron) também não são criadas. O esquema já deve existir, aplicado por `rebase db push`, uma migração ou outro processo. Tabelas de autenticação ausentes são recusadas na inicialização; uma tabela opcional ausente desativa seu recurso, sendo nomeada no log. | um script, um teste, um REPL, um processo somente leitura, um banco de dados que apenas seu processo de alteração pode modificar |
| `{ collections: false, realtime: false }` | As tabelas do framework e o papel, mas não o esquema das tabelas declaradas ou a captura de alterações. A chave mantém seu nome antigo. | um processo que não gerencia o esquema em uma implantação dividida |

Trata-se de uma opção intencional em vez de uma etapa posterior. O driver lê as
tabelas no momento da abertura e anexa a captura de alterações àquelas existentes naquele instante.
Um `provision()` chamado posteriormente seria executado após o driver já ter
decidido o que existe. `REBASE_MIGRATE_ON_BOOT=none` ainda desativa o esquema
de tabelas para qualquer backend no processo. `initializeRebaseBackend` passa
`false` quando `REBASE_PROVISION=false`.

## Montando apenas os grupos desejados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`backend.routes` contém os grupos de rotas. Cada um é uma sub-aplicação Hono que você pode
montar individualmente, em qualquer caminho:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, tables, defaultRls, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`tables` é uma lista de resultados de `defineTable`, `defineAuthTable` e `defineView` — normalmente tudo o que `backend/schema/index.ts` exporta — e `defaultRls` é o que suas tabelas com `rls: "inherit"` assumem, o `defaultRls` exportado por aquele índice. Cada tabela é compilada quando o backend é criado, e um problema em qualquer uma delas (sem `rls`, `"inherit"` sem `defaultRls`, uma relação para uma tabela fora da lista) resulta em recusa com um `SchemaDefinitionError` nomeando cada erro. Passe `schemaDir` para carregar o diretório da mesma forma que o runtime faz, incluindo as exportações de índice e `defaultRls`; passe ambos e `tables` será o que é servido enquanto `schemaDir` será onde o editor de esquema grava.

```typescript no-verify
import * as schema from "../schema";

const tables = [schema.users, schema.posts];
const defaultRls = schema.defaultRls;
```

| Grupo | Normalmente em | Serve |
|---|---|---|
| `routes.auth()` | `/api/auth` | login, sessões, OAuth, redefinição de senha, `GET /config`, as próprias chaves de API do chamador e o catálogo de escopos |
| `routes.data()` | `/api/data` | as rotas REST das tabelas e seu histórico |
| `routes.storage()` | `/api/storage` | armazenamento de arquivos, ou o roteador que responde com `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | suas [funções personalizadas](/docs/backend/custom-functions/), ou o encaminhador para o processo que as serve |
| `routes.admin()` | `/api/admin` | usuários e papéis, chaves de serviço, edição de esquema, manutenção de armazenamento, backups, auditoria de RLS, exportação SQL, caixa de correio de desenvolvimento e logs |
| `routes.cron()` | `/api/admin/cron` | a interface de administração de cron |
| `routes.meta()` | `/api/meta` | o contrato do projeto lido por um SDK gerado |
| `routes.schema()` | `/api/schema` | `GET /tables`: os descritores de tabela a partir dos quais o CMS e o Studio realizam a renderização — consulte [Endpoints](/docs/backend/endpoints/#schema) |

Cada grupo carrega os middlewares necessários: o contexto de autenticação que coloca o
`user`, `driver` e `scopes` do chamador na requisição, seus limites de taxa (rate limits) e seu
bloqueio de administrador. Portanto, ele responde da mesma forma onde quer que seja montado, inclusive sob um
caminho parametrizado como `/:tenant/data`. Um grupo também detecta onde foi
montado, de modo que a API de dados continue direcionando cada tabela para seu respectivo banco de dados e
a listagem de funções indique os caminhos reais onde é servida.

Um grupo também recusa `x-rebase-impersonate` e `x-rebase-simulate-*` por padrão
(`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), a menos que seja o grupo
de dados ou de funções, que os aceitam. `refuseUnhonouredImpersonation(honouredMounts)`
de `@rebasepro/server` faz o mesmo para rotas próprias.

O que um grupo não carrega é o middleware global do processo que `mount()` coloca à
frente de tudo. Ao montar grupos um a um, adicione o que desejar
por conta própria: um limite de corpo (`bodyLimit` de `hono/body-limit`), compressão e
o envelope de erro JSON:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Cada chamada retorna um novo roteador sobre os mesmos manipuladores, permitindo montar um grupo em dois lugares. Solicitar um grupo cuja superfície não foi incluída na criação do backend (`surfaces: { data: false }`) lança um erro, pois o backend nunca o construiu. Os documentos OpenAPI e o servidor MCP não têm grupo próprio: eles descrevem as URLs do layout de `mount()`, portanto apenas `mount()` os serve.

## O backend sem um servidor

Um backend construído pode ser usado sem montar nada.
`backend.rebase` é seu cliente interno no processo, e `backend.fetch(request)`
responde a uma `Request` da mesma forma que `mount()` responderia em `/api`:

```typescript
const backend = await createRebaseBackend({ database: adapter, schemaDir, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

As chamadas do plano de controle nesse cliente (`rebase.auth`, `rebase.admin`,
`rebase.functions` e `rebase.cron`) alcançam as rotas próprias do backend
internamente no processo. Elas funcionam independentemente de onde, ou se, você montou os grupos, e
os middlewares adicionados à sua própria aplicação não são executados nelas.

Para um script que precisa apenas dos dados, [`openRebase`](/docs/backend/scripts/)
abre o banco de dados sem construir um backend.

## Vários backends em um processo

`createRebaseBackend` não grava variáveis globais no processo. Cada backend mantém seu próprio
estado em `backend.services`, permitindo que dois deles coexistam no mesmo processo de forma independente: cada
um assina e verifica sessões com suas próprias chaves, avalia escopos segundo seus próprios papéis,
verifica chaves de API em seu próprio armazenamento e contabiliza limites de taxa em seu próprio repositório.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, tables, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, tables, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | O que é |
|---|---|
| `jwt` | O serviço JWT do backend: assina e verifica sessões, links de download e outros tokens, e serve seu JWKS |
| `access` | Seu modelo de acesso (papéis para escopos) e o resolvedor para o proprietário de uma chave pessoal |
| `apiKeyStore` | Onde suas chaves de API são validadas |
| `rateLimitStore`, `authLimiters` | Seus contadores de limite de taxa e os limitadores em suas rotas de autenticação |
| `tables()` | Os descritores compilados das tabelas que ele serve |
| `topics`, `queues` | Seus runtimes de tópicos e filas |

Um backend que não recebe `auth.jwtSecret`, como aquele cujo `auth` é um adaptador,
não assina nada próprio, portanto seu `services.jwt` segue o padrão do processo.

**Os recursos pertencem ao processo.** As declarações `database()`, `bucket()`, `topic()` e
`queue()` em `backend/resources.ts` são valores de nível de módulo, e
todos os backends no processo leem todas elas: um backend cujo projeto não
declara nenhum tópico ainda assim ativará sua fila de jobs para o tópico de outro projeto,
recusando-se a inicializar se seu driver não puder suportá-lo. Execute os recursos de apenas
um projeto por processo. Múltiplos backends desse mesmo projeto, cada um em seu próprio
banco de dados, funcionam perfeitamente.

**Para onde vai o `rebase`.** Dentro de uma requisição, execução de cron ou job atendido por
um backend, o `rebase` — seja importado de `@rebasepro/server` ou recebido como
`ctx.rebase` — refere-se àquele backend específico, assim como o `publish` de tópicos e o `enqueue` de filas.
Em qualquer outro lugar (escopo de módulo, um script, um teste), eles respondem pelo **padrão do processo**,
definido por `setDefaultBackend(backend)`, e que
`initializeRebaseBackend` define para seu próprio backend. O mesmo se aplica ao restante da
API em nível de módulo: `verifyAccessToken` e os outros utilitários de JWT,
`getAccessModel`, `verifyCredential` e `extractUserFromToken`.

Três partes operam diretamente em um backend, e uma não depende de backend algum:

```typescript
import { createJwtService, requireAuth, requireScope } from "@rebasepro/server";

// Mint a session for one of this backend's users, in a test or a login of your
// own. `userId` is the user's id in the auth table.
const token = await backend.services.jwt.generateAccessToken(userId, ["editor"]);

// Check a session token, an rk_ API key or the service key for a socket or a tunnel of your
// own, as this backend's routes judge it: its uid, roles, scopes and kind, or null.
const caller = await backend.verifyCredential(token);

// A route of your own, outside the groups, judged by this backend. The auth table
// declares the app scope: auth: { scopes: { "project:deploy": { label: "Deploy projects" } } }.
app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
    requireAuth, requireScope("project:deploy"), (c) => c.json({ ok: true }));

// A JWT service on its own.
const jwt = createJwtService({ secret: process.env.JWT_SECRET!, accessExpiresIn: "15m" });
const payload = await jwt.verifyAccessToken(token);
```

Uma sessão gerada é verificada como qualquer outra a cada requisição, portanto seu uid deve pertencer a um usuário existente: se for um uid sem usuário correspondente, a requisição é recusada.

`verifyCredential` chega à mesma conclusão que as rotas chegam: uma sessão cujo proprietário fez logout, um uid sem usuário e uma conta desativada retornam null, e os papéis são aqueles que a conta possui atualmente. Lança uma exceção se o banco de dados estiver inacessível.

Cada grupo de rotas define `c.var.services` por conta própria. Uma rota fora dos grupos que utiliza `requireAuth`, `requireScope` ou outro guard de `@rebasepro/server` o lê a partir dali, recorrendo ao padrão do processo quando não estiver definido. `requireScope` valida o chamador identificado por `requireAuth`, devendo vir depois dele: isolado, ele recusa qualquer requisição com um 401. Aceita um escopo interno ou um escopo de aplicação declarado pelo backend sob `auth.scopes` em sua tabela de autenticação, conforme o comentário acima.

Um nome que não seja um escopo, ou um escopo interno digitado incorretamente como `data:raed`, lança um erro no registro da rota. Um escopo de aplicação que o backend responsável não declara responde a qualquer chamador, inclusive administradores, com `500 SCOPE_NOT_DECLARED`.

## Encerrando (Shutting down)

A partir de `initializeRebaseBackend`, passe o backend para o utilitário integrado em vez
de criar um manipulador de sinais próprio. Ele drena as conexões HTTP, para o agendador de cron,
desconecta o tempo real, fecha o pool SMTP assim que nada mais puder enviar mensagens, previne
sinais repetidos e força a saída se o encerramento travar:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, tables });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

**Não** combine isso com seu próprio `server.close()`: o `shutdown()` daquele
backend já fecha o servidor fornecido, e um segundo fechamento
provoca deadlock. Um backend de `createRebaseBackend` fecha um servidor apenas se você
o passar explicitamente, `backend.shutdown(timeoutMs, { server })`, como no exemplo no
início desta página.

## Incorporando o driver do Postgres

Indo um passo além, `@rebasepro/server-postgres` funciona sem o servidor
Rebase: abra seu driver de dados e socket de tempo real dentro do Express, Fastify
ou Node puro, e monte o restante por conta própria. Consulte
[Incorporando o driver do Postgres](/docs/backend/embedding-postgres-driver/).

## CORS para um frontend de navegador

Um servidor customizado gerencia sua própria configuração de CORS, e um frontend em outra origem só pode
ler os cabeçalhos de resposta explicitamente expostos por ele. Exponha os cabeçalhos que o SDK lê, caso contrário
`etagOf(row)` será sempre `undefined` ali — uma gravação com `ifMatch` sairá
sem `If-Match` — e uma resposta 429 perderá seu `Retry-After`:

```typescript
import express from "express";
import cors from "cors";
import { CORS_EXPOSED_HEADERS } from "@rebasepro/server";

const app = express();
app.use(cors({
    origin: ["https://app.example.com"],
    credentials: true,
    exposedHeaders: [...CORS_EXPOSED_HEADERS]
}));
```

`CORS_EXPOSED_HEADERS` é a lista exposta pelo próprio runtime, garantindo que qualquer
cabeçalho que o SDK passe a ler em versões futuras chegue ao seu frontend sem necessidade
de alterações aqui. Inclui `ETag`, `Retry-After`, `X-Request-ID`, os três
cabeçalhos `X-RateLimit-*` e `Preference-Applied`, além de `Location`,
`Upload-Offset` e `Rebase-Upload-Result` (usados nas respostas de uploads retomáveis para arquivos acima
de 8 MiB), e `X-Rebase-Simulated-Context`, que indica o contexto sob o qual a requisição simulada
de um administrador foi executada. Sem os três cabeçalhos de upload, o SDK não consegue acompanhar
um upload originado de outro domínio, enviando cada arquivo como uma única requisição multipart.

O runtime do Rebase e o backend ejetado já enviam essa lista por padrão.

## Relacionados

- [Incorporando o driver do Postgres](/docs/backend/embedding-postgres-driver/) — o driver de dados e socket de tempo real isolados, no Express
- [Scripts e o Console](/docs/backend/scripts/) — os dados do projeto a partir de um script, teste ou REPL, sem servidor
- [Visão Geral do Backend](/docs/backend/) — onde cada opção reside quando a inicialização é feita pelo runtime
- [Processos Divididos](/docs/deployment/split-processes/) — os papéis que um servidor personalizado precisa reproduzir
- [Configuração de Armazenamento](/docs/backend/storage/) — as fontes que um servidor personalizado deve resolver por conta própria
