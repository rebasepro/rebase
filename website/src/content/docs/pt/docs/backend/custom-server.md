---
sourceHash: 8935b1e530b1bfb3
title: Integração com Servidor Customizado
sidebar_label: Servidor Customizado
description: Construa o backend do Rebase a partir de peças públicas no seu próprio servidor — createRebaseBackend, seus grupos de rotas, mount, attachRealtime e start — ou incorpore o driver do Postgres no Express.
---

# Integração com Servidor Customizado

O `initializeRebaseBackend` é um atalho. Ele constrói o backend inteiro, o monta
no seu app Hono sob `/api`, anexa o socket de tempo real ao seu servidor HTTP e
inicia o trabalho em segundo plano, tudo em uma só chamada. Quando é isso que você
quer, use-o.

Quando não for, desça um passo. Cada parte dessa chamada é uma peça pública que
você mesmo pode chamar: construa o backend, depois monte tudo ou apenas os grupos
de rotas que quiser, nos caminhos que quiser, e decida qual processo inicia os
timers. [Incorporando o Driver do Postgres](/docs/backend/embedding-postgres-driver/)
vai um passo além e abre apenas o driver do Postgres em um app Express.

## Configuração de Ambiente

O Rebase fornece um utilitário centralizado `loadEnv()` em `@rebasepro/server` que valida suas variáveis de ambiente contra um esquema Zod rigoroso. Chame-o **após** carregar seu arquivo `.env`:

```typescript
import dotenv from "dotenv";
import { loadEnv } from "@rebasepro/server";

// `rebase dev` and `rebase start` name the project's .env in DOTENV_CONFIG_PATH.
// Unset, dotenv reads `.env` in the working directory.
dotenv.config({ path: process.env.DOTENV_CONFIG_PATH, quiet: true });

export const env = loadEnv();
```


Para adicionar variáveis tipadas suas, estenda o esquema:

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

Importar `z` de `@rebasepro/server` é uma novidade. Na versão 0.17 e anteriores, o pacote não exportava o `z`: importe-o de `zod`, compatível com a versão major utilizada pelo runtime, e deixe seu bundler desduplicar as duas cópias.

:::caution[Duas cópias do zod]
Ter duas cópias do zod carregadas ao mesmo tempo costumava quebrar essa chamada
silenciosamente. O `loadEnv` combinava os esquemas com `.merge()`, que aceita um
esquema da outra cópia e então rejeita todos os campos que possuem um `.default()`.
O servidor iniciava, informava sucesso e não executava nenhum dos seus crons; nada
na falha mencionava o zod.

O `loadEnv` agora valida o esquema base e o seu esquema `extend` cada um com o
próprio `.parse()`, de modo que um esquema construído por outra cópia do zod
funciona. O runtime fornece o `zod`, e o `backend/package.json` do scaffold o lista
na faixa que o `@rebasepro/server` usa, de modo que uma única cópia é instalada:
mantenha as duas iguais.
:::

**Comportamentos principais:**
- Gera `JWT_SECRET` e `REBASE_SERVICE_KEY` em desenvolvimento quando não estão definidos, para que você possa começar sem configuração manual, e os guarda em cache em `.rebase-dev-secrets.json` para que uma reinicialização não desconecte ninguém.
- Bloqueia segredos gerados automaticamente em produção — você deve defini-los explicitamente.
- Valida se `CORS_ORIGINS` ou `FRONTEND_URL` está definido em produção.
- Recusa um valor `extend` que não seja um esquema zod.
- Lança um `Error` que nomeia cada variável ausente ou incorreta, como `DATABASE_URL: is required`, com os problemas apontados pelo zod na sua propriedade `issues`. Na 0.24 ele lança o próprio `ZodError` do zod, que não nomeia nenhuma variável quando nada o captura.

Consulte `.env.example` na aplicação gerada para obter a lista completa de variáveis suportadas.

## Um passo abaixo do `initializeRebaseBackend`

Na 0.24, o
`initializeRebaseBackend` é a única entrada, e nenhuma das peças abaixo é
exportada.

O `initializeRebaseBackend` é estas chamadas, e nada mais:

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

O `shutdown()` que ele retorna também fecha o servidor que recebeu. Aqui está a
mesma coisa escrita como o `backend/src/index.ts` de um projeto, pronta para você
alterar. O `rebase dev` executa esse arquivo quando o projeto tem um, no lugar do
boot do próprio runtime. Colado em um projeto gerado pelo scaffold, ele serve o que o
runtime servia: a API na porta que o `rebase dev` escolheu, o login e o registro com a
coleção de usuários do projeto, as funções em `backend/functions/`, os cron jobs em
`backend/crons/`, os buckets declarados em `config/resources.ts` e o CORS de que o
painel de administração precisa na própria porta.

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
import "../../config/resources";
import usersCollection from "../../config/collections/users";
import { storageAuthorize } from "../../config/storage";

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
    collectionsDir: path.join(root, "config/collections"),
    functionsDir: path.join(root, "backend/functions"),
    cronsDir: existsSync(cronsDir) ? cronsDir : undefined,
    database: createPostgresAdapter(postgresDriverConfigFromEnv({ connection: db, connectionString })),
    auth: {
        collection: usersCollection,
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

Os caminhos são os do scaffold. O arquivo depende do que o `rebase dev` define: a
porta que ele escolheu em `PORT`, o banco de dados gerenciado em `DATABASE_URL` e o
`.env` do projeto em `DOTENV_CONFIG_PATH`. O `loadEnv()` valida o que isso contém e
gera o `JWT_SECRET` em desenvolvimento quando ele não está definido. Escute em outra
porta e o painel de administração não consegue alcançar o servidor; pule o `loadEnv()`
e, sem `JWT_SECRET`, o login fica desativado.
O `rebase dev` também espera pela linha `Server running at http://localhost:<port>`
antes de informar que o backend está no ar. As opções de `auth` são as do scaffold; o
runtime também lê os provedores OAuth, o e-mail e as demais variáveis `AUTH_*`, então
passe as que você usa, como descreve [Autenticação](/docs/backend/authentication/).
O arquivo também não serve o painel de administração compilado em produção: o
entrypoint que o [`rebase eject`](/docs/cli/) escreve serve, com `serveSPA`, e abre
uma conexão por banco de dados declarado em `config/resources.ts`.

O `createRebaseBackend` recebe as mesmas opções que o `initializeRebaseBackend`,
sem `app`, `server` e `basePath`, e com `provision` obrigatório. Ele constrói
tudo: abre o banco de dados, configura a autenticação e o armazenamento, carrega
as funções e os cron jobs, e constrói cada grupo de rotas e o cliente em
processo. Ele não monta nada, não inicia nenhum timer e não adiciona nenhum
listener de processo. Cada um dos demais é uma chamada que você faz, ou deixa de
fora:

| Chamada | O que faz | Se você a deixar de fora |
|---|---|---|
| `installUnhandledRejectionHandler()` | Registra em log uma rejeição de promise que ninguém tratou, como uma chamada fire-and-forget em uma função personalizada, em vez de deixar o Node encerrar o processo. Vale para o processo todo, então é uma decisão do processo, não de um backend. Retorna uma função que a desinstala, ou `undefined` quando já havia uma instalada ou `REBASE_EXIT_ON_UNHANDLED_REJECTION` está definido. | uma rejeição não tratada encerra o processo, o padrão do Node |
| `setDefaultBackend(backend)` | Torna este backend o [padrão do processo](#vários-backends-em-um-mesmo-processo): aquele a que o `import { rebase }` e o restante da API em nível de módulo respondem fora das requisições, execuções de cron e jobs que um backend atende | essa API não tem backend a que responder ali |
| `backend.mount(app, { basePath })` | Todos os grupos de rotas sob `basePath` (padrão `/api`), atrás do middleware de todo o processo: ids de requisição, o limite de corpo, a compressão, o CSRF, o log de requisições e o envelope JSON para erros e caminhos desconhecidos. Também o documento JWKS, o servidor MCP, a documentação OpenAPI e os aliases de rotas legados. | nada é servido por HTTP; `backend.rebase` e `backend.fetch` continuam funcionando |
| `backend.attachRealtime(server, { path })` | O socket de tempo real, em `server`, respondendo a upgrades apenas em `path` | não há consultas ao vivo |
| `backend.start()` | O agendador de cron, os workers de jobs, as varreduras de tokens expirados e de retenção de histórico, o amostrador de métricas e a auditoria de RLS agendada, cada um onde o `ownership` o atribui a este processo. Seguro de chamar duas vezes. | nenhum deles roda, que é o que um processo que atende requisições em um [deploy dividido](/docs/deployment/split-processes/) quer |
| `backend.shutdown(timeoutMs, { server })` | Para o que o `start()` e o `attachRealtime()` iniciaram, aguardando as execuções de cron e os jobs em andamento. Fecha o `server` apenas quando você o passa. | |

O `path` padrão do socket é o caminho base passado ao `mount()` sem o `/api`
final, então `/api` dá `/` e `/x/api` dá `/x`; um caminho base que
não termina em `/api` dá `/`. É ali que o SDK se conecta,
porque ele conecta ao seu `baseUrl` enquanto suas requisições HTTP vão para
`${baseUrl}/api`. Um upgrade para qualquer outro caminho fica para os outros
listeners de `upgrade` do servidor, então seu app pode rodar o próprio servidor
WebSocket no mesmo `http.Server`.

### O que criar um backend pode alterar: `provision`

Criar um backend pode executar DDL, então o `createRebaseBackend` pede que você
decida:

| `provision` | Cria | Para |
|---|---|---|
| `true` | Tudo o que o backend serve: as tabelas das coleções e suas políticas de RLS, a captura de mudanças para o tempo real, a role com que as requisições rodam e as tabelas do próprio framework (chaves de API, execuções de cron, jobs, métricas). | um deploy de processo único; o que o `initializeRebaseBackend` passa |
| `false` | Nada, nem no boot nem depois: as tabelas que outros backends criam no primeiro uso (chaves de idempotência, claims do cron) também não são criadas. O schema já deve estar lá, aplicado pelo `rebase db push`, por uma migração ou por outro processo. Tabelas de auth ausentes fazem o boot ser recusado; uma tabela opcional ausente desliga sua funcionalidade e é nomeada no log. | um script, um teste, um REPL, um processo que só lê, um banco de dados que só o seu processo de mudanças pode alterar |
| `{ collections: false, realtime: false }` | As tabelas do framework e a role, mas não o schema das coleções nem a captura de mudanças. | um processo que não é dono do schema em um deploy dividido |

É uma opção, e não um passo posterior, de propósito. O driver lê as tabelas ao
abrir e anexa a captura de mudanças às que existem naquele momento. Um
`provision()` chamado depois rodaria depois de o driver já ter decidido o que
existe. O `REBASE_MIGRATE_ON_BOOT=none` ainda desliga o schema das coleções para
qualquer backend do processo. <span class="since-badge" data-since="0.26">A partir da versão 0.26</span> `initializeRebaseBackend` passa `false` quando `REBASE_PROVISION=false`.

## Montando apenas os grupos que você quer

O `backend.routes` guarda os grupos de rotas. Cada um é um sub-app Hono que você
pode montar sozinho, em qualquer caminho:

```typescript
import { Hono } from "hono";
import { createRebaseBackend, type HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();
const backend = await createRebaseBackend({ database: adapter, auth, collections, functions, provision: true });

app.route("/v2/data", backend.routes.data());      // the data API, at a path of your own
app.route("/hooks", backend.routes.functions());   // getUser(c) and getDriver(c) work inside
```

O `collections` é o array que o `config/collections/index.ts` de um scaffold exporta. Ele carrega os `defaultSecurityRules` desse índice, como o `collectionsDir` faz, então o backend provisiona as políticas que o `rebase db push` provisionaria. Um array seu carrega apenas as regras que suas coleções declaram, e o `provision: true` torna exclusiva para administradores uma coleção que não declara nenhuma, descartando as políticas que o Rebase gerou para ela antes, em todo servidor que compartilha o banco de dados.

O índice do scaffold aplica os padrões ao seu array. Em um projeto gerado na 0.24, copie esse laço do `config/collections/index.ts` de um scaffold novo, ou passe `collectionsDir`.

| Grupo | Normalmente em | Serve |
|---|---|---|
| `routes.auth()` | `/api/auth` | login, sessões, OAuth, redefinição de senha, `GET /config`, as chaves de API do próprio chamador e o catálogo de escopos |
| `routes.data()` | `/api/data` | as rotas REST das coleções e seu histórico |
| `routes.storage()` | `/api/storage` | o armazenamento de arquivos, ou o roteador que responde `STORAGE_NOT_CONFIGURED` |
| `routes.functions()` | `/api/functions` | suas [funções personalizadas](/docs/backend/custom-functions/), ou o encaminhador para o processo que as serve |
| `routes.admin()` | `/api/admin` | usuários e roles, chaves de serviço, edição de schema, manutenção do armazenamento, backups, a auditoria de RLS, exportação de SQL, a caixa de e-mail de desenvolvimento e os logs |
| `routes.cron()` | `/api/admin/cron` | a superfície de administração do cron |
| `routes.meta()` | `/api/meta` | o contrato do projeto que um SDK gerado lê |

Cada grupo carrega o middleware de que precisa: o contexto de autenticação que
coloca o `user`, o `driver` e os `scopes` do chamador na requisição, seus limites
de taxa e seu portão de administração. Por isso ele responde da mesma forma onde
quer que seja montado, inclusive sob um caminho parametrizado como
`/:tenant/data`. Um grupo também lê onde foi montado, então a API de dados ainda
encaminha cada coleção à sua fonte de dados e a listagem de funções nomeia os
caminhos em que ela realmente é servida.

Um grupo também recusa por conta própria `x-rebase-impersonate` e `x-rebase-simulate-*`
(`400 IMPERSONATION_UNSUPPORTED` / `SIMULATION_UNSUPPORTED`), a menos que seja o grupo de
dados ou o de funções, que os honram; na 0.25, um grupo montado sozinho
respondia como o administrador. `refuseUnhonouredImpersonation(honouredMounts)`
de `@rebasepro/server` faz o mesmo para rotas suas.

O que um grupo não carrega é o middleware de todo o processo que o `mount()`
coloca na frente de tudo. Ao montar os grupos um a um, adicione você mesmo o que
quiser dele: um limite de corpo (`bodyLimit` de `hono/body-limit`), a compressão
e o envelope JSON de erro:

```typescript
import { errorHandler } from "@rebasepro/server";

app.onError(errorHandler);
```

Cada chamada retorna um roteador novo sobre os mesmos handlers, então você pode
montar um grupo em dois lugares. Pedir um grupo cuja superfície este backend foi
criado sem (`surfaces: { data: false }`) lança um erro, porque o backend nunca o
construiu. A documentação OpenAPI e o servidor MCP não têm grupo: eles descrevem
as URLs do layout do `mount()`, então só o `mount()` os serve.

## O backend sem um servidor

Um backend que você construiu pode ser usado sem montar nada. O `backend.rebase`
é o seu cliente em processo, e o `backend.fetch(request)` responde a um
`Request` como o `mount()` faria em `/api`:

```typescript
const backend = await createRebaseBackend({ database: adapter, collections, provision: false });

const { data } = await backend.rebase.dataAsAdmin.posts.find({ limit: 5 });
const res = await backend.fetch(new Request("http://local/api/meta/schema-version"));

await backend.shutdown();
```

As chamadas de plano de controle nesse cliente (`rebase.auth`, `rebase.admin`,
`rebase.functions` e `rebase.cron`) alcançam as rotas do próprio backend em
processo. Elas funcionam onde quer que você tenha montado os grupos, ou mesmo se
não os montou, e o middleware que você adicionou ao seu próprio app não roda nelas.

Para um script que só precisa dos dados, o [`openRebase`](/docs/backend/scripts/)
abre o banco de dados sem construir um backend.

## Vários backends em um mesmo processo

Na 0.24, a
configuração de JWT, o modelo de acesso, o armazenamento de chaves de API, o
armazenamento de limites de taxa e o `rebase` são globais do processo, e o último
backend construído vence todos eles.

O `createRebaseBackend` não escreve nenhum global de processo. Cada backend guarda
o próprio estado em `backend.services`, então dois deles em um mesmo processo
continuam dois: cada um assina e verifica sessões com as próprias chaves, julga
escopos pelas próprias roles, confere chaves de API no próprio armazenamento e
conta limites de taxa no próprio armazenamento.

```typescript
const a = await createRebaseBackend({ database: adapterA, auth: { jwtSecret: SECRET_A }, collections, provision: true });
const b = await createRebaseBackend({ database: adapterB, auth: { jwtSecret: SECRET_B }, collections, provision: true });

app.route("/a/data", a.routes.data());
app.route("/b/data", b.routes.data());   // a session from `a` is a 401 here
```

| `backend.services` | O que é |
|---|---|
| `jwt` | O serviço JWT do backend: assina e verifica sessões, links de download e seus outros tokens, e serve o seu JWKS |
| `access` | Seu modelo de acesso (roles para escopos) e o resolvedor do dono de uma chave pessoal |
| `apiKeyStore` | Onde suas chaves de API são conferidas |
| `rateLimitStore`, `authLimiters` | Seus contadores de limite de taxa, e os limitadores nas suas rotas de autenticação |
| `collections()` | As coleções que ele serve |
| `topics`, `queues` | Seus runtimes de tópicos e de filas |

Um backend sem `auth.jwtSecret`, como um cujo `auth` é um adaptador, não assina
nada por conta própria, então o seu `services.jwt` acompanha o padrão do processo.

**Os recursos são do processo.** As declarações `database()`, `bucket()`, `topic()` e
`queue()` em `config/resources.ts` são valores de nível de módulo, e
todo backend do processo lê todas elas: um backend cujo próprio projeto
não declara nenhum tópico ainda liga a sua fila de jobs para o tópico de outro projeto,
e se recusa a inicializar se o seu driver não puder carregar um. Execute os
recursos de um projeto por processo. Vários backends desse mesmo projeto, cada um em seu próprio
banco de dados, não há problema.

**Para onde vai o `rebase`.** Dentro de uma requisição, de uma execução de cron
ou de um job que um backend atende, o `rebase`, seja importado de
`@rebasepro/server` ou recebido como `ctx.rebase`, é esse backend, e o mesmo vale
para o `publish` de tópicos e o `enqueue` de filas. Em qualquer outro lugar
(escopo de módulo, um script, um teste) eles respondem pelo **padrão do
processo**, que o `setDefaultBackend(backend)` define, e que o
`initializeRebaseBackend` define como o seu próprio backend. O mesmo vale para o
restante da API em nível de módulo: `verifyAccessToken` e os outros helpers de
JWT, `getAccessModel`, `verifyCredential` e `extractUserFromToken`.

Três peças trabalham diretamente em um backend, e uma em nenhum backend:

```typescript
import { createJwtService, requireAuth, requireScope } from "@rebasepro/server";

// Mint a session for one of this backend's users, in a test or a login of your
// own. `userId` is the user's id in the users collection.
const token = await backend.services.jwt.generateAccessToken(userId, ["editor"]);

// Check a session token, an rk_ API key or the service key for a socket or a tunnel of your
// own, as this backend's routes judge it: its uid, roles, scopes and kind, or null.
const caller = await backend.verifyCredential(token);

// A route of your own, outside the groups, judged by this backend. The users collection
// declares the app scope: auth: { scopes: { "project:deploy": { label: "Deploy projects" } } }.
app.post("/deploy", (c, next) => { c.set("services", backend.services); return next(); },
    requireAuth, requireScope("project:deploy"), (c) => c.json({ ok: true }));

// A JWT service on its own.
const jwt = createJwtService({ secret: process.env.JWT_SECRET!, accessExpiresIn: "15m" });
const payload = await jwt.verifyAccessToken(token);
```

Uma sessão emitida é verificada como qualquer outra a cada requisição, então o seu
uid precisa ser de um usuário que existe: para um uid sem usuário a requisição é
recusada.

O `verifyCredential` chega ao mesmo veredito que as rotas: uma sessão que o próprio dono encerrou, um uid sem usuário e uma conta desativada voltam como null, e as roles são as que a conta tem agora. Ele lança um erro quando não consegue alcançar o banco de dados. Na 0.24 ele verifica apenas a assinatura e lê as roles do token.

Todo grupo de rotas define o `c.var.services` por conta própria. Uma rota fora
dos grupos que usa `requireAuth`, `requireScope` ou outro guarda de
`@rebasepro/server` o lê dali, e recorre ao padrão do processo quando ele não
está definido. O `requireScope` julga o chamador que o `requireAuth` identificou,
então vem depois do `requireAuth`: sozinho, ele recusa toda requisição com um 401.
Ele aceita um escopo embutido, ou um escopo de app que o backend declara em
`auth.scopes` na sua coleção de usuários, como no comentário acima.

Um nome que não é um escopo, ou um escopo embutido com erro de digitação como `data:raed`, lança um erro onde a rota é registrada. Para um escopo de app que o backend que atende a requisição não declara, a resposta a todo chamador, inclusive a um administrador, é `500 SCOPE_NOT_DECLARED`. Na 0.24 ambos respondem `403 SCOPE_MISSING` a todo chamador.

## Desligamento

Um backend de
`createRebaseBackend` é novo; o restante desta seção vale também para a 0.24.

A partir do `initializeRebaseBackend`, entregue o backend ao helper embutido em
vez de escrever um manipulador de sinal. Ele drena o HTTP, para o agendador de
cron, derruba o tempo real, fecha o pool SMTP quando nada mais pode enviar,
protege contra sinais repetidos e força a saída se o desligamento travar:

```typescript
import { initializeRebaseBackend, installShutdownHandlers } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ app, server, database: adapter, collections });
installShutdownHandlers(backend, { onCleanup: () => pool.end() });
```

**Não** o combine com o seu próprio `server.close()`: o `shutdown()` desse
backend já fecha o servidor que recebeu, e um segundo fechamento causa deadlock.
Um backend de `createRebaseBackend` fecha um servidor apenas quando você o passa,
`backend.shutdown(timeoutMs, { server })`, como no exemplo do início desta página.

## Incorporando o driver do Postgres

Um passo mais abaixo, o `@rebasepro/server-postgres` funciona sem o servidor do Rebase
de forma alguma: abra seu driver de dados e o socket de tempo real dentro do Express, do Fastify
ou do Node puro, e monte o resto você mesmo. Veja
[Incorporando o Driver do Postgres](/docs/backend/embedding-postgres-driver/).

## CORS para um frontend no navegador
Um servidor customizado é dono da sua própria configuração de CORS, e um frontend em outra origem só consegue ler os cabeçalhos de resposta que ela expõe. Exponha os que o SDK lê, ou `etagOf(row)` será sempre `undefined` ali — uma escrita com `ifMatch` então sai sem nenhum `If-Match` — e um 429 perde seu `Retry-After`:

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

`CORS_EXPOSED_HEADERS` é a lista que o próprio runtime expõe, de modo que um
cabeçalho que o SDK passe a ler em uma versão posterior chega ao seu frontend sem
nenhuma mudança aqui. São `ETag`, `Retry-After`, `X-Request-ID`, os três
cabeçalhos `X-RateLimit-*` e `Preference-Applied`, mais `Location`,
`Upload-Offset` e `Rebase-Upload-Result`, nos quais um upload retomável (arquivos acima de
8 MiB) responde, e `X-Rebase-Simulated-Context`, que informa com qual identidade a requisição
simulada de um administrador foi executada. Sem os três cabeçalhos de upload, o SDK não consegue acompanhar um upload a partir de outra
origem, e envia cada arquivo como uma única requisição multipart. Na 0.24,
escreva a lista à mão.

O runtime do Rebase e o backend ejetado já enviam essa lista. Na 0.23
eles não expõem nenhum desses cabeçalhos, então um frontend em outra origem não lê nenhum `ETag`.

## Relacionados

- [Incorporando o Driver do Postgres](/docs/backend/embedding-postgres-driver/) — o driver de dados e o socket de tempo real sozinhos, no Express
- [Scripts e o Console](/docs/backend/scripts/) — os dados do projeto a partir de um script, de um teste ou de um REPL, sem servidor
- [Visão Geral do Backend](/docs/backend/) — onde cada opção fica quando o runtime inicializa em vez disso
- [Divisão em vários processos](/docs/deployment/split-processes/) — as roles que um servidor customizado precisa reproduzir
- [Configuração de Armazenamento](/docs/backend/storage/) — as fontes que um servidor customizado deve resolver por conta própria
