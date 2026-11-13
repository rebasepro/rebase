---
sourceHash: 93c74d4bdc0c12ea
title: Integração de Servidor Personalizado
sidebar_label: Servidor Personalizado
description: Construa o backend do Rebase a partir de partes públicas em seu próprio servidor — createRebaseBackend, seus grupos de rotas, mount, attachRealtime e start — ou incorpore o driver Postgres no Express.
---

# Integração de Servidor Personalizado

`initializeRebaseBackend` é um atalho. Ele constrói todo o backend, monta-o
em sua aplicação Hono sob `/api`, conecta o socket realtime ao seu servidor HTTP
e inicia o trabalho em segundo plano, tudo em uma única chamada. Quando é isso o que você
deseja, use-o.

Quando não for o caso, desça um nível. Cada parte dessa chamada é uma peça pública
que você mesmo pode chamar: construa o backend e, em seguida, monte-o por inteiro ou apenas os
grupos de rotas desejados, nos caminhos que quiser, e decida qual processo inicia
os temporizadores. [Incorporando o Driver Postgres](/docs/backend/embedding-postgres-driver/)
dá um passo além e abre apenas o driver Postgres em uma aplicação Express.

## Configuração de Ambiente

O Rebase fornece um utilitário `loadEnv()` centralizado em `@rebasepro/server` que valida suas variáveis de ambiente em relação a um esquema Zod estrito. Chame-o **após** carregar seu arquivo `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```

Para adicionar suas próprias variáveis tipadas, estenda o esquema:

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
Duas cópias do zod carregadas ao mesmo tempo costumavam quebrar essa chamada silenciosamente. O `loadEnv`
combinava os esquemas com `.merge()`, que aceita um esquema da outra cópia
e depois rejeita todos os campos que possuem um `.default()`. O servidor iniciava,
reportava sucesso e não executava nenhum dos seus crons; nada na falha mencionava
o zod.

O `loadEnv` agora valida o esquema base e o seu esquema `extend` cada um com seu
próprio `.parse()`, portanto um esquema construído por outra cópia do zod funciona. O runtime
fornece o `zod`, e o `backend/package.json` do scaffold o lista no intervalo
que o `@rebasepro/server` usa, portanto uma única cópia é instalada: mantenha as duas iguais.
:::

**Comportamentos principais:**
- Gera `JWT_SECRET` e `REBASE_SERVICE_KEY` em desenvolvimento quando não estiverem definidos, para que você possa começar sem configuração manual, e os armazena em cache no `.rebase-dev-secrets.json` para que um reinício não desconecte ninguém.
- Bloqueia segredos gerados automaticamente em produção — você deve defini-los explicitamente.
- Valida se `CORS_ORIGINS` ou `FRONTEND_URL` está definido em produção.
- Recusa um valor de `extend` que não seja um esquema zod.
- Lança um `Error` nomeando cada variável que está ausente ou incorreta, como `DATABASE_URL: is required`, com as inconsistências do zod em sua propriedade `issues`.

Consulte `.env.example` no aplicativo gerado (scaffold) para ver a lista completa de variáveis suportadas.

## Um nível abaixo de `initializeRebaseBackend`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`initializeRebaseBackend` se resume a estas chamadas, e nada mais:

```typescript
import { createRebaseBackend, installUnhandledRejectionHandler, setDefaultBackend } from "@rebasepro/server";

installUnhandledRejectionHandler();
const backend = await createRebaseBackend({
    ...options,
    // `false` or `{ tables: false, realtime: false }` in the cases
    // the `provision` section below lists.
    provision: true
});
setDefaultBackend(backend);
backend.mount(app, { basePath: "/api" });
await backend.attachRealtime(server);
backend.start();
```

O `shutdown()` retornado também fecha o servidor fornecido. Aqui está a
mesma coisa descrita como o `backend/src/index.ts` de um projeto, pronto para ser modificado.
O `rebase dev` executa esse arquivo quando um projeto possui um, no lugar da inicialização
padrão do runtime. Colado em um projeto gerado pelo scaffold, ele serve o que o runtime servia:
a API na porta escolhida pelo `rebase dev`, login e cadastro com a tabela de autenticação
do projeto, as tabelas que `backend/schema/index.ts` exporta, os hooks globais
em `backend/hooks.ts`, as funções em `backend/functions/`, os cron jobs
em `backend/crons/`, os buckets declarados em `backend/resources.ts` e o CORS
de que o painel de administração precisa em sua própria porta.

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

Os caminhos são os do scaffold; omita a importação e a opção de `hooks` quando o
projeto não tiver um `backend/hooks.ts`. Os usuários são armazenados na tabela
que `backend/schema` declara com `defineAuthTable`, portanto `auth` não especifica nenhuma tabela.
O arquivo depende do que o `rebase dev` define: a
porta selecionada em `PORT`, o banco de dados gerenciado em `DATABASE_URL` e o
`.env` do projeto em `DOTENV_CONFIG_PATH`. O `loadEnv()` valida o que ele
contém e gera o `JWT_SECRET` em desenvolvimento quando não estiver definido. Escute em
outra porta e o painel de administração não conseguirá alcançar o servidor; pule o `loadEnv()` e,
sem o `JWT_SECRET`, o login ficará desativado.
O `rebase dev` também aguarda a linha `Server running at http://localhost:<port>`
antes de reportar que o backend está ativo. As opções de `auth` são as do scaffold; o
runtime também lê os provedores de OAuth, e-mail e as outras variáveis `AUTH_*`,
portanto passe as que você utiliza, conforme descrito em [Autenticação](/docs/backend/authentication/).
Este arquivo também não serve o painel de administração compilado em produção: o
ponto de entrada gerado por [`rebase eject`](/docs/cli/) o faz, com `serveSPA`, e abre
uma conexão por banco de dados declarado em `backend/resources.ts`.

`createRebaseBackend` aceita as mesmas opções que `initializeRebaseBackend`,
sem `app`, `server` e `basePath`, e com `provision` obrigatório. Ele
constrói tudo: abre o banco de dados, configura autenticação e armazenamento, carrega as
funções e cron jobs, e constrói cada grupo de rotas e o cliente em processo (in-process).
Ele não monta nada, não inicia nenhum temporizador e não adiciona nenhum listener ao processo. Cada
uma das outras partes é uma chamada que você faz ou omite:

| Chamada | O que faz | Se omitir |
|---|---|---|
| `installUnhandledRejectionHandler()` | Registra no log uma rejeição de promise que não foi tratada, como uma chamada fire-and-forget em uma função personalizada, em vez de deixar o Node encerrar o processo. Tem escopo em todo o processo, sendo uma decisão do processo, não de um backend específico. Retorna uma função que o desinstala, ou `undefined` quando já houver um instalado ou `REBASE_EXIT_ON_UNHANDLED_REJECTION` estiver definido. | uma rejeição não tratada encerra o processo, que é o padrão do Node |
| `setDefaultBackend(backend)` | Torna este backend o [padrão do processo](#vários-backends-em-um-único-processo): aquilo a que `import { rebase }` e o restante da API em nível de módulo respondem fora das requisições, execuções de cron e jobs que um backend atende | essa API não terá nenhum backend para responder nesse contexto |
| `backend.mount(app, { basePath })` | Monta todos os grupos de rotas sob `basePath` (padrão `/api`), atrás dos middlewares de todo o processo: IDs de requisição, limite de corpo, compressão, CSRF, log de requisições e o envelope JSON para erros e rotas desconhecidas. Também inclui o documento JWKS, o servidor MCP, a documentação OpenAPI e os aliases de rotas legadas. | nada é servido via HTTP; `backend.rebase` e `backend.fetch` continuam funcionando |
| `backend.attachRealtime(server, { path })` | O socket realtime, em `server`, respondendo a upgrades apenas em `path` | não haverá consultas ao vivo (live queries) |
| `backend.start()` | O agendador de cron, os workers de jobs, as varreduras de retenção de histórico e tokens expirados, o amostrador de métricas e a auditoria de RLS agendada, cada um onde o `ownership` o atribui a este processo. Seguro para chamar duas vezes. | nenhum deles é executado, o que é o desejado para um processo que atende requisições em uma [implantação dividida](/docs/deployment/split-processes/) |
| `backend.shutdown(timeoutMs, { server })` | Interrompe o que `start()` e `attachRealtime()` iniciaram, aguardando as execuções de cron e jobs em andamento terminarem. Fecha o `server` apenas se você o passar como parâmetro. | |

O `path` padrão do socket é o caminho base fornecido a `mount()` com o
`/api` final removido, de modo que `/api` resulta em `/` e `/x/api` resulta em `/x`; um caminho base que
não termina em `/api` resulta em `/`. É para onde o
SDK se conecta, pois ele estabelece conexão com sua `baseUrl` enquanto suas requisições HTTP vão para
`${baseUrl}/api`. Um upgrade para qualquer outro caminho é deixado para os outros
listeners de `upgrade` do servidor, permitindo que sua aplicação execute seu próprio servidor WebSocket no mesmo
`http.Server`.

### O que a criação de um backend pode alterar: `provision`

Criar um backend pode executar comandos DDL, então `createRebaseBackend` solicita que você decida:

| `provision` | Cria | Para |
|---|---|---|
| `true` | Tudo o que o backend serve: as tabelas declaradas e suas políticas de RLS, captura de alterações (change capture) para realtime, a role sob a qual as requisições são executadas e as tabelas próprias do framework (chaves de API, execuções de cron, jobs, métricas). | uma implantação de processo único; o que `initializeRebaseBackend` passa |
| `false` | Nada, na inicialização ou posteriormente: as tabelas que outros backends criam no primeiro uso (chaves de idempotência, reivindicações de cron) também não são criadas. O esquema já deve estar presente, aplicado por `rebase db push`, uma migração ou outro processo. Tabelas de autenticação ausentes causam rejeição na inicialização; uma tabela opcional ausente desativa seu respectivo recurso, informado no log. | um script, um teste, um REPL, um processo somente de leitura, um banco de dados que apenas seu processo de mudanças pode alterar |
| `{ tables: false, realtime: false }` | As tabelas do framework e a role, mas não o esquema das tabelas declaradas ou a captura de alterações. | um processo que não gerencia o esquema em uma implantação dividida |

Isso é uma opção deliberada em vez de uma etapa posterior. O driver lê as
tabelas no momento em que se abre e conecta a captura de alterações às que existem naquele instante.
Uma chamada de `provision()` feita depois seria executada após o driver já ter
determinado o que existe. `REBASE_MIGRATE_ON_BOOT=none` ainda desativa o
esquema de tabelas para qualquer backend no processo. `initializeRebaseBackend` passa
`false` quando `REBASE_PROVISION=false`.

## Montando apenas os grupos desejados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`backend.routes` contém os grupos de rotas. Cada um é uma subaplicação Hono que você pode
montar separadamente, em qualquer caminho:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, tables, defaultRls, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

`tables` é uma lista dos resultados de `defineTable`, `defineAuthTable` e `defineView` — normalmente tudo o que `backend/schema/index.ts` exporta — e `defaultRls` é o que suas tabelas com `rls: "inherit"` assumem, o `defaultRls` exportado por esse index. Cada tabela é compilada quando o backend é criado, e qualquer problema em uma delas (ausência de `rls`, `"inherit"` sem `defaultRls`, uma relação com uma tabela que não está na lista) a rejeita com um `SchemaDefinitionError` especificando cada erro. Em vez disso, passe `schemaDir` para carregar o diretório da mesma forma que o runtime faz, incluindo as exportações de index e o `defaultRls`; se passar ambos, `tables` é o que é servido, enquanto `schemaDir` é onde o editor de esquemas faz suas gravações.

```typescript no-verify
import * as schema from "../schema";

const tables = [schema.users, schema.posts];
const defaultRls = schema.defaultRls;
```

| Grupo | Normalmente em | Serve |
|---|---|---|
| `routes.auth()` | `/api/auth` | login, sessões, OAuth, redefinição de senha, `GET /config`, as próprias chaves de API do solicitante e o catálogo de escopos |
| `routes.data()` | `/api/data` | as rotas REST das tabelas e seu histórico |
| `routes.storage()` | `/api/storage` | armazenamento de arquivos, ou o roteador que responde com `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | suas [funções personalizadas](/docs/backend/custom-functions/), ou o encaminhador para o processo que as atende |
| `routes.admin()` | `/api/admin` | usuários e roles, chaves de serviço, edição de esquemas, manutenção de armazenamento, backups, auditoria de RLS, exportação SQL, a caixa de correio de desenvolvimento e os logs |
| `routes.cron()` | `/api/admin/cron` | a interface administrativa de cron |
| `routes.meta()` | `/api/meta` | o contrato do projeto lido por um SDK gerado |
| `routes.schema()` | `/api/schema` | `GET /tables`: os descritores de tabela a partir dos quais o CMS e o Studio realizam a renderização — consulte [Endpoints](/docs/backend/endpoints/#schema) |

Cada grupo carrega os middlewares de que necessita: o contexto de autenticação que injeta o
`user`, `driver` e `scopes` do chamador na requisição, seus limites de taxa e seu
controle de acesso de administrador. Portanto, ele responde da mesma forma independentemente de onde for montado, inclusive sob um
caminho parametrizado como `/:tenant/data`. Um grupo também identifica onde foi
montado, de modo que a API de dados ainda roteia cada tabela para seu respectivo banco de dados e
a listagem de funções indica os caminhos exatos onde elas são realmente servidas.

Um grupo também rejeita `x-rebase-impersonate` e `x-rebase-simulate-*` por conta própria
(`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), a menos que seja o
grupo data ou functions, que oferecem suporte a eles. `refuseUnhonouredImpersonation(honouredMounts)`
de `@rebasepro/server` faz o mesmo para suas próprias rotas.

O que um grupo não carrega são os middlewares de todo o processo que `mount()` coloca
na frente de tudo. Ao montar grupos individualmente, adicione você mesmo o que desejar:
um limite de corpo (`bodyLimit` de `hono/body-limit`), compressão e
o envelope de erro em JSON:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Cada chamada retorna um novo roteador sobre os mesmos manipuladores, permitindo que você monte um grupo em dois lugares. Solicitar um grupo cuja interface não foi incluída na criação deste backend (`surfaces: { data: false }`) lança um erro, pois o backend nunca o construiu. A documentação OpenAPI e o servidor MCP não possuem grupo: eles descrevem as URLs do layout de `mount()`, portanto apenas `mount()` os serve.

## O backend sem um servidor

Um backend que você construiu pode ser usado sem montar nada.
`backend.rebase` é o seu cliente em processo (in-process), e `backend.fetch(request)`
responde a uma `Request` como `mount()` faria em `/api`:

```typescript
const backend = await createRebaseBackend({ database: adapter, schemaDir, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

As chamadas do plano de controle nesse cliente (`rebase.auth`, `rebase.admin`,
`rebase.functions` e `rebase.cron`) alcançam as rotas próprias do backend
em processo. Elas funcionam independentemente de onde, ou se, você montou os grupos, e
os middlewares adicionados ao seu próprio aplicativo não são executados nelas.

Para um script que precisa apenas dos dados, [`openRebase`](/docs/backend/scripts/)
abre o banco de dados sem construir nenhum backend.

## Vários backends em um único processo

`createRebaseBackend` não escreve nenhuma variável global de processo. Cada backend mantém seu próprio
estado em `backend.services`, de modo que dois deles em um único processo continuam separados: cada um
assina e verifica sessões com suas próprias chaves, avalia escopos segundo suas próprias roles,
verifica chaves de API em seu próprio armazenamento e contabiliza limites de taxa em seu próprio armazenamento.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, tables, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, tables, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | O que é |
|---|---|
| `jwt` | O serviço JWT do backend: assina e verifica sessões, links de download e outros tokens, e serve seu JWKS |
| `access` | Seu modelo de acesso (roles para escopos) e o resolvedor para o proprietário de uma chave pessoal |
| `apiKeyStore` | Onde suas chaves de API são verificadas |
| `rateLimitStore`, `authLimiters` | Seus contadores de limite de taxa e os limitadores em suas rotas de autenticação |
| `tables()` | Os descritores compilados das tabelas que ele atende |
| `topics`, `queues` | Seus runtimes de tópicos e filas |

Um backend que não recebe `auth.jwtSecret`, como aquele cujo `auth` é um adaptador,
não assina nada próprio; portanto, seu `services.jwt` segue o padrão do processo.

**Os recursos pertencem ao processo.** As declarações `database()`, `bucket()`, `topic()` e
`queue()` em `backend/resources.ts` são valores em nível de módulo, e
cada backend no processo lê todas elas: um backend cujo próprio projeto
não declara nenhum tópico ainda assim ativará sua fila de jobs para o tópico de outro projeto
e se recusará a inicializar se o seu driver não puder suportá-lo. Execute os
recursos de um único projeto por processo. Vários backends desse mesmo projeto, cada um em seu
próprio banco de dados, funcionam perfeitamente.

**Para onde `rebase` aponta.** Dentro de uma requisição, execução de cron ou job
atendido por um backend, `rebase`, seja importado de `@rebasepro/server` ou recebido como
`ctx.rebase`, representa aquele backend específico, e o mesmo vale para `publish` de tópicos e `enqueue` de filas.
Em qualquer outro lugar (escopo de módulo, um script, um teste), eles respondem pelo **padrão
do processo**, definido por `setDefaultBackend(backend)` e que
`initializeRebaseBackend` define para seu próprio backend. O mesmo se aplica ao restante da
API em nível de módulo: `verifyAccessToken` e os outros utilitários JWT,
`getAccessModel`, `verifyCredential` e `extractUserFromToken`.

Três componentes funcionam diretamente em um backend, e um funciona sem backend algum:

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

Uma sessão gerada é verificada como qualquer outra a cada requisição, portanto seu uid deve corresponder a um usuário existente: para um uid sem usuário correspondente, a requisição é recusada.

`verifyCredential` chega ao mesmo veredito alcançado pelas rotas: uma sessão da qual o proprietário fez logout, um uid sem usuário e uma conta desativada retornam null, e as roles são aquelas que a conta possui no momento. Ele lança uma exceção quando o banco de dados não puder ser acessado.

Cada grupo de rotas define `c.var.services` por si próprio. Uma rota fora dos grupos que utilize `requireAuth`, `requireScope` ou outro guard do `@rebasepro/server` o lê ali, recorrendo ao padrão do processo quando não estiver definido. `requireScope` avalia o solicitante identificado por `requireAuth`, portanto deve vir após `requireAuth`: sozinho, ele recusa qualquer requisição com um erro 401. Ele aceita um escopo integrado ou um escopo de aplicativo declarado pelo backend sob `auth.scopes` em sua tabela de autenticação, como no comentário acima.

Um nome que não seja um escopo, ou um escopo integrado com erro de digitação, como `data:raed`, lança um erro no ponto onde a rota é registrada. Um escopo de aplicativo que o backend respondedor não declara responde a qualquer solicitante, inclusive administradores, com `500 SCOPE_NOT_DECLARED`.

## Encerrando

Ao usar `initializeRebaseBackend`, passe o backend para o utilitário integrado em vez
de escrever um manipulador de sinais próprio. Ele drena as conexões HTTP, interrompe o agendador de cron,
encerra o realtime, fecha o pool SMTP assim que nada mais puder ser enviado, protege contra
sinais repetidos e força o encerramento se o shutdown travar:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, tables });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

**Não** combine isso com seu próprio `server.close()`: o
`shutdown()` daquele backend já fecha o servidor fornecido a ele, e um segundo fechamento
causa um deadlock. Um backend de `createRebaseBackend` fecha o servidor apenas quando você
o passa explicitamente, `backend.shutdown(timeoutMs, { server })`, como no exemplo no
início desta página.

## Incorporando o driver Postgres

Dando mais um passo além, o `@rebasepro/server-postgres` funciona totalmente sem o
servidor Rebase: abra seu driver de dados e socket realtime dentro do Express, Fastify
ou Node puro e monte o restante você mesmo. Consulte
[Incorporando o Driver Postgres](/docs/backend/embedding-postgres-driver/).

## CORS para um frontend de navegador

Um servidor personalizado gerencia sua própria configuração de CORS, e um frontend em outra origem só
pode ler os cabeçalhos de resposta que ele expõe. Exponha aqueles que o SDK lê; caso contrário,
`etagOf(row)` será sempre `undefined` lá — uma escrita com `ifMatch` será enviada
sem `If-Match` — e uma resposta 429 perderá o cabeçalho `Retry-After`:

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

`CORS_EXPOSED_HEADERS` é a lista que o próprio runtime expõe, permitindo que um
cabeçalho que o SDK passe a ler em uma versão futura chegue ao seu frontend sem
necessidade de alterações aqui. Ela inclui `ETag`, `Retry-After`, `X-Request-ID`, os três
cabeçalhos `X-RateLimit-*` e `Preference-Applied`, além de `Location`,
`Upload-Offset` e `Rebase-Upload-Result`, usados em respostas de upload retomável (arquivos com mais de
8 MiB), e `X-Rebase-Simulated-Context`, que indica o contexto sob o qual uma requisição
simulada de administrador foi executada. Sem os três cabeçalhos de upload, o
SDK não consegue acompanhar um upload vindo de outra origem e passa a enviar cada arquivo como uma
única requisição multipart.

O runtime do Rebase e o backend ejetado já enviam essa lista por padrão.

## Conteúdo relacionado

- [Incorporando o Driver Postgres](/docs/backend/embedding-postgres-driver/) — o driver de dados e o socket realtime isolados, no Express
- [Scripts e o Console](/docs/backend/scripts/) — os dados do projeto a partir de um script, teste ou REPL, sem servidor
- [Visão Geral do Backend](/docs/backend/) — onde cada opção reside quando a inicialização é feita pelo runtime
- [Processos Divididos](/docs/deployment/split-processes/) — os papéis que um servidor personalizado deve reproduzir
- [Configuração de Armazenamento](/docs/backend/storage/) — as fontes que um servidor personalizado deve resolver por conta própria
