---
sourceHash: 41e067cb49021d45
title: Funções Personalizadas
sidebar_label: Funções Personalizadas
description: Adicione endpoints de API Hono personalizados junto às suas rotas CRUD do Rebase. Descobertos automaticamente a partir de um diretório, com acesso total à instância do backend.
---

## Visão Geral

As funções personalizadas permitem adicionar **rotas de API Hono arbitrárias** junto aos endpoints CRUD gerados automaticamente pelo Rebase. Elas seguem o mesmo padrão de **descoberta baseada em arquivos** que os cron jobs: coloque um arquivo TypeScript no seu diretório `functions/`, e o Rebase o montará automaticamente.

Use funções personalizadas para:

- **Endpoints de lógica de negócios** — aprovações, promoções, fluxos de trabalho personalizados
- **Integrações de terceiros** — webhooks do Stripe, comandos do Slack, proxies de API externa
- **Endpoints públicos** — formulários de contato, captura de leads, verificações de integridade (health checks)
- **Consultas de agregação** — estatísticas de dashboard, relatórios, analytics

## Definindo uma Função Personalizada

Crie um arquivo no seu diretório `backend/functions/` que exporte como padrão (default-export) uma aplicação Hono:

```typescript
// backend/functions/hello.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/", async (c) => {
        const { name } = await c.req.json<{ name?: string }>().catch(() => ({ name: undefined }));
        return c.json({ message: `Hello, ${name ?? "world"}!` });
    });
});
```

Isso é montado em **`/api/functions/hello`**. O nome do arquivo (sem extensão) se torna o prefixo da rota.

`POST`, porque é isso que o SDK envia por padrão — consulte [Invocar a partir do cliente](#invocar-a-partir-do-cliente). Uma rota `GET` é igualmente válida; o chamador então deve especificar `{ method: "GET" }`.

O `rebase dev` observa o diretório de funções, portanto um arquivo adicionado enquanto ele está em execução é montado no próximo recarregamento — sem reinicialização. (Ele precisa ser avisado: o diretório é escaneado em vez de importado, portanto o observador não pode inferi-lo.)

## Invocar a partir do cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

O `invoke` constrói a URL, anexa o token do chamador e lança um `RebaseApiError` em respostas que não sejam 2xx — assim, o formato de erro da própria função chega ao chamador em vez de uma rejeição pura do `fetch`.

Quatro coisas que ele aceita além do nome:

```typescript
// A different method. The payload is dropped for GET, since GET has no body.
await client.functions.invoke("hello", undefined, { method: "GET" });

// A sub-path — `/api/functions/hello/stats`. It goes here, never in the name:
// a name containing "/" is refused rather than percent-encoded into a 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// A query string. Passed as `path`, with no separator inserted before `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });

// A function that answers text or a file (`c.text(csv)`, `c.body(pdf)`).
// The answer is read as JSON unless you say otherwise: "text" gives a string,
// "blob" a Blob, "response" the Response itself with its body unread.
const csv = await client.functions.invoke<string>("export-orders", undefined, { method: "GET", responseType: "text" });
```

:::note
`client.call("functions/hello", payload)` também acessa uma função. Ele sempre faz `POST` e, assim como o `invoke`, retorna o corpo textualmente — nenhum dos dois procura por uma chave `data`. Prefira `functions.invoke`, que aceita um método, um subcaminho e um `responseType`; o `call` existe para rotas montadas fora de `/api/functions`, o que o `invoke` não consegue expressar.
:::

:::important
Importe de **`@rebasepro/server/functions`**, não de `@rebasepro/server`.

Ambos funcionam. O subcaminho é a superfície de criação *portável*: ele não puxa nada que exija o Node, portanto uma função escrita com base nele pode rodar em qualquer runtime JavaScript. A raiz do pacote acessa todo o framework — a sequência de inicialização (boot), os carregadores de arquivos, a camada de WebSocket —, o que é adequado para o ponto de entrada de um servidor e mais do que um manipulador de rotas precisa. Ele também oferece acessores de contexto tipados (`getUser`, `getDriver`) em vez de fazer casting de `c.get("user")` manualmente.

Consulte [Portabilidade de runtime](#portabilidade-de-runtime) para ver o contrato completo.
:::

## Configuração

:::note[Onde isso vai]
**Runtime gerenciado:** nada a configurar — o runtime descobre `backend/functions/` por conta própria (`functions` na entrada do `rebase.json` do aplicativo backend caso você o tenha movido). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringem quais funções um processo com `REBASE_ROLE=functions` atende; qualquer outra role se recusará a inicializar com essas variáveis definidas.
**Ejetado:** `initializeRebaseBackend({ functionsDir })`, ou `functions` (abaixo), em `backend/src/index.ts`.
:::

Habilite funções personalizadas adicionando `functionsDir` à configuração do seu backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

O Rebase irá:

1. Escanear o diretório em busca de arquivos `.ts` / `.js`
2. Validar se cada exportação padrão é um aplicativo Hono (duck-typed via `.fetch()` + `.routes`)
3. Montar cada aplicativo em `/api/functions/<filename>`
4. Aplicar o middleware de autenticação (consulte [Autenticação](#autenticação-e-propagação-de-contexto) abaixo)

### Funções como valores

Um diretório é uma forma de produzir o que o servidor serve: um registro do segmento de URL para o aplicativo Hono. Passe esse registro você mesmo como `functions`, ou leia um diretório para dentro dele com `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Forneça `functions` ou `functionsDir`, não ambos: a inicialização recusa a combinação de ambos. `loadFunctions(dir, { onSkip })` entrega cada arquivo que foi ignorado, junto ao motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` ainda funcionam, estão obsoletos (deprecated) e exibem um aviso uma única vez. Isoladamente, o grupo de funções pode ser montado em qualquer caminho com `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funcionam dentro dele; consulte [Integração de Servidor Personalizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nomeação de Arquivos e Mapeamento de Rotas

| Arquivo | Caminho de Montagem |
|---------|---------------------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

As funções são descobertas **apenas no nível superior do diretório** — não há recursão. `functions/admin/users.ts` é compilado por `rebase build`, mas nunca montado; em vez disso, achate o nome (`functions/admin-users.ts`). Um subdiretório é reportado na inicialização e contabilizado no endpoint de listagem em vez de ser ignorado silenciosamente.

Arquivos que são **ignorados**:

- `index.ts` / `index.js` — reservado
- `*.test.ts` / `*.test.js` — arquivos de teste
- `*.d.ts` — declarações de tipos
- Subdiretórios e arquivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — reportados como problemas, já que a compilação compila mais do que o runtime carrega

O nome também é a identidade da função em todos os outros lugares: é o segmento de URL, o alvo do escopo `functions:invoke:<name>` que uma chave precisa para chamá-la e o valor pelo qual `REBASE_FUNCTIONS_ONLY` filtra quando você atribui a uma função seu próprio processo.

## Formatos de Exportação

O carregador aceita dois formatos de exportação além de `defineFunction`:

### Aplicativo Hono

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Função Factory

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

O `defineFunction` retorna exatamente o aplicativo Hono que esses constroem manualmente, portanto os três são intercambiáveis. Ele evita que você precise declarar `Hono<HonoEnv>` e disponibiliza o singleton `rebase` no callback.

---

## Por Baixo dos Panos: O Carregador por Duck-Typing

Em um monorepo, suas funções podem resolver uma cópia diferente do Hono em relação à que o Rebase usa, e então `exported instanceof Hono` é falso para um roteador perfeitamente funcional. Por isso, o carregador verifica a estrutura (`isHonoLike`): um objeto não nulo com um método `.fetch` e um array `.routes`.

### Escape do Compilador de Módulos ES

O carregador transforma o caminho de cada arquivo em uma URL de arquivo (`pathToFileURL(filePath).href`), para que importe tanto no Windows quanto em POSIX, e chama `import(url)` por meio de `new Function("url", "return import(url)")`, evitando que uma compilação TypeScript o reescreva em um `require()` que falharia em ESM.

---

## Autenticação e Propagação de Contexto

As funções personalizadas são montadas com o **mesmo middleware de autenticação** que as rotas de dados, mas com `requireAuth: false`. Isso significa que:

- O JWT do usuário é **analisado e injetado** no contexto, se estiver presente
- Mas as requisições **não são rejeitadas** se nenhum JWT for fornecido
- Você deve **proteger explicitamente** as rotas que necessitam de autenticação

Um chamador que apresenta um token *inválido* nunca alcança o seu manipulador: um token inverificável ou expirado é rejeitado com 401 pelo próprio middleware, de modo que uma sessão expirada nunca é rebaixada silenciosamente para uma sessão anônima.

### Lendo o chamador

```typescript
import { defineFunction, getUser, getUserId, getRoles, getScopes, isAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/me", (c) => {
        const user = getUser(c);          // { uid, roles, ...claims } | undefined
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        return c.json({ uid: user.uid, roles: user.roles, admin: isAdmin(c), scopes: getScopes(c) });
    });
});
```

`getUser` retorna um objeto restrito: `uid` é uma string e `roles` é sempre um array, qualquer que seja o método de autenticação usado pelo chamador. `getUserId(c)` e `getRoles(c)` são atalhos. `getScopes(c)` é tudo o que o chamador pode fazer, representado como strings de [escopo](/docs/backend/roles-and-scopes/): para uma pessoa, o plano de dados, os escopos do próprio aplicativo e os escopos de suas roles; para uma chave de API, exatamente o que a chave contém.

### A conta do chamador

`getUser(c)` lê o token de acesso, e o token contém o ID, as roles e o endereço do chamador. Ele não informa como a conta faz login ou qual é o seu nome de exibição. `getUserProfile(c)` lê essas informações do repositório de autenticação:

```typescript
import { defineFunction, getUserProfile } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/whoami", async (c) => {
        const profile = await getUserProfile(c);
        if (!profile) return c.json({ error: "Unauthorized" }, 401);
        // { uid, email?, displayName?, photoURL?, emailVerified, isAnonymous, providers }
        return c.json({ name: profile.displayName ?? null, social: profile.providers.some(p => p !== "password") });
    });
});
```

`providers` lista como a conta pode fazer login: `"password"` quando ela possui uma, seguido por cada provedor vinculado (`"google"`, `"apple"`, …) na ordem em que foi vinculado. Uma conta de convidado, ou uma que faça login apenas com um código de uso único (one-time code), possui uma lista vazia.

A leitura é atualizada a cada requisição: um provedor que o chamador vinculou há pouco tempo aparece em sua próxima requisição, sem esperar que o token seja atualizado. A primeira chamada em uma requisição custa duas buscas por chave, feitas juntas. Chamadas posteriores na mesma requisição reutilizam o resultado, e uma requisição que nunca a chama não custa nada.

Ele retorna `undefined` para um chamador anônimo, para um chamador com chave de serviço (service key) ou chave de API que não atua como nenhuma conta, e para uma conta que não existe mais. Também retorna `undefined` em um backend cujas contas residem em um [adaptador de autenticação](/docs/backend/auth-adapters/) externo: consulte esse provedor em vez disso. Quando um administrador envia `x-rebase-impersonate`, ele retorna a conta personificada.

### Protegendo Rotas

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Public endpoint — no guard, so anyone can call it.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 for anonymous callers.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonymous, 403 without the admin role. Order matters.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Any one of the named roles.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Coloque as proteções (guards) no **próprio slot de middleware da rota**, como acima, em vez de `app.use("/*", requireAuth)`. O `use()` cobre apenas as rotas declaradas *abaixo* dele, portanto uma rota adicionada posteriormente — no final do arquivo, meses depois — ficaria silenciosamente desprotegida.

:::important
Ler `getUser(c)` **não** é uma proteção (guard). Um chamador anônimo recebe `undefined` e seu manipulador é executado mesmo assim. Apenas uma proteção, ou um `if (!user) return 401` explícito, interrompe a requisição.
:::

### Escopos e escopos do aplicativo

`requireAdmin` admite a role `admin` e ninguém mais. Para uma ação que uma role mais restrita ou uma chave de API deva acessar, proteja a rota com `requireScope`. Ele aceita um [escopo](/docs/backend/roles-and-scopes/) nativo ou um declarado pelo aplicativo sob `auth.scopes` na coleção de usuários, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

```typescript
import { defineFunction, requireAuth, requireScope, hasScope } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // 403 SCOPE_MISSING unless the caller holds project:deploy, or project:deploy:<this project>.
    app.post("/:project", requireAuth, requireScope("project:deploy", c => c.req.param("project")), (c) => {
        return c.json({ deploying: c.req.param("project") });
    });

    // The same question inside a handler.
    app.get("/:project/can-deploy", requireAuth, (c) => c.json({ allowed: hasScope(c, "project:deploy", c.req.param("project")) }));
});
```

Toda pessoa autenticada possui todos os escopos de aplicativo, portanto, para uma pessoa, `requireScope` não decide nada: verifique no manipulador se essa pessoa pode fazer o deploy deste projeto. O que o escopo adiciona é uma forma de **restringir uma chave**: uma chave com `project:deploy:p1` passa apenas para `p1`. Uma chave também precisa de `functions:invoke`, ou `functions:invoke:<name>`, antes mesmo de alcançar a função. Consulte [Escopos de aplicativo](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticação por Service Key

O Rebase suporta uma `REBASE_SERVICE_KEY` estática definida no seu `.env` para chamadas de scripts ou chamadas servidor-para-servidor (server-to-server).

Quando uma requisição externa passa a chave de serviço por meio do cabeçalho de Autorização (`Authorization: Bearer <service_key>`), o middleware de autenticação automaticamente:
1. Valida a chave usando comparação em tempo constante para evitar ataques de temporização (timing attacks).
2. Concede acesso de nível de administrador, definindo o chamador como `{ uid: "service", roles: ["admin"] }`.
3. Injeta um `DataDriver` com escopo definido para essa mesma identidade de serviço. A Segurança em Nível de Linha (Row-Level Security - RLS) ainda se aplica — ela é avaliada como `{ uid: "service", roles: ["admin"] }`, e não ignorada.

### Autoautenticação Interna

Se você não configurou uma `REBASE_SERVICE_KEY`, o Rebase gera uma **chave interna por inicialização** aleatória. O singleton `rebase` usa essa chave automaticamente ao chamar as próprias APIs de plano de controle do servidor (como `rebase.auth` ou `rebase.storage`). Isso significa que sua lógica do lado do servidor sempre pode executar tarefas administrativas, mesmo sem uma chave de serviço configurada manualmente.

## Acessando o Banco de Dados e Serviços

### 1. O driver no escopo do usuário — para qualquer coisa que atenda a uma requisição

`getDriver(c)` retorna o driver **no escopo do chamador**, de modo que cada leitura e escrita é avaliada em relação às suas políticas de Segurança em Nível de Linha como aquele usuário:

```typescript
import { defineFunction, requireAuth, requireDriver } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", requireAuth, async (c) => {
        const driver = requireDriver(c);
        const myProducts = await driver.fetchCollection({ path: "products", limit: 10 });
        return c.json(myProducts);
    });
});
```

`requireDriver(c)` é o `getDriver(c)` sem o `!` — ele lança uma mensagem nomeando o problema de conexão em vez de falhar vinte linhas depois com `undefined`.

<span class="since-badge" data-since="0.31">Desde 0.31</span> `fetchCollection` e `fetchOne` retornam as linhas que `GET /api/data/<table>` retorna: datas como strings RFC 3339, um `belongsTo` como sua chave estrangeira (`authorId`), e uma linha relacionada somente quando `include` a nomeia — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

### 2. `rebase.dataAsAdmin` — para trabalho em segundo plano confiável

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/:id/approve", requireAuth, requireAdmin, async (c) => {
        const id = c.req.param("id");
        await rebase.dataAsAdmin.table<Record<string, unknown>>("jobs").update(id, {
            status: "published",
            approved_at: new Date().toISOString(),
        });
        return c.json({ success: true });
    });
});
```

`rebase.dataAsAdmin` não é tipado até que você [registre seu `Database` gerado](/docs/backend/typed-server-data).

### Driver no Escopo de RLS vs. Singleton do Rebase

|                     | `getDriver(c)` (escopo da requisição)          | `rebase.dataAsAdmin` (identidade de serviço)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Executa como**    | O chamador (`uid`, suas roles)                 | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicação de RLS**| ✅ Sim (avaliado em relação ao chamador)       | ✅ Sim (avaliado em relação à identidade de serviço)             |
| **Ideal para...**   | CRUD geral de usuários, busca e consultas      | Jobs em segundo plano, gatilhos de sistema, webhooks              |
| **Estilo de API**   | Métodos a nível de driver (`fetchCollection`, `save`) | Acessores fluentes de tabela (`rebase.dataAsAdmin.jobs.find`)    |

#### O que `dataAsAdmin` é, precisamente

`rebase.dataAsAdmin` é **no escopo de administrador, não contorna o RLS**. O driver é delimitado uma vez, na inicialização, com `withAuth({ uid: "service", roles: ["admin"] })`, portanto cada leitura e escrita é executada dentro de uma transação que alternou para a role restrita `rebase_user` com `app.uid = 'service'`. Suas políticas são avaliadas — em relação a essa identidade.

Para a maioria dos projetos, essa distinção nunca se manifesta, porque as políticas padrão que o Rebase injeta em cada tabela admitem `serverContext() OR rolesOverlap(['admin'])`, e a identidade de serviço satisfaz o segundo critério. Ela vem à tona no momento em que você escreve suas próprias políticas:

- **`policy.serverContext()` é falso para ele.** Esse helper é compilado para `rebase.uid() IS NULL`, e o `uid` deste acessor é `'service'`. Uma tabela com `disableDefaultPolicies: true` cuja única regra de escrita seja `serverContext()` recusará uma escrita do `dataAsAdmin` com o erro do Postgres `42501`, e uma leitura nessa coleção retornará **zero linhas com HTTP 200** — a falha silenciosa. Escreva `rolesOverlap(["admin"])` (ou adicione-o junto) quando você quiser dizer "meu backend".
- **Seu alcance é igual ao alcance de um usuário `admin`.** Conceder a role `admin` a um usuário da aplicação concede a ele exatamente as linhas que este acessor vê. Não é um canal privado.

### 3. `getSql(c)` — SQL como o chamador

Quando o SDK não expressa uma consulta ou escrita de forma limpa — um upsert condicional, um compare-and-swap `UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, uma CTE — escreva o SQL e execute-o como o chamador:

```typescript
import { defineFunction, getSql, requireAuth } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/my-stats", requireAuth, async (c) => {
        const sql = getSql(c);
        const rows = await sql(
            "SELECT lower(artist) AS artist, count(*) FILTER (WHERE liked) AS likes FROM songs WHERE lang = $1 GROUP BY 1",
            { params: [c.req.query("lang") ?? "en"] }
        );
        return c.json(rows);
    });
});
```

O comando roda na própria transação do chamador, como a role restrita `rebase_user` com a identidade dele — a transação que o driver no escopo do usuário abre —, de modo que as regras de `rls` das suas tabelas decidem cada linha, exatamente como fazem para o SDK. Uma consulta que solicita todas as linhas obtém as do chamador.

- **Somente leitura por padrão.** Passe `{ write: true }` para inserir, atualizar ou excluir; as políticas de inserção e atualização ainda se aplicam.
- **O texto da consulta é seu; os valores vão em `params`** (`$1`, `$2`, …). A identidade do chamador reside nas configurações da transação, que o SQL pode alterar; portanto, uma instrução que poderia fazer isso — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, mais de uma instrução — é recusada com `400 SQL_NOT_ALLOWED` antes de ser executada. Interpolar a entrada do usuário no texto é como essa proteção seria colocada à prova; não faça isso.
- **O que ele compartilha com o SDK.** As políticas e três regras que o Postgres mantém para ambos: uma [materialized view](/docs/collections/views/#materialized-views) serve suas linhas apenas para suas `roles`, uma linha de uma tabela que declara `tenant` não pode ser movida para outro tenant, exceto por um chamador `bypassRoles` (`TENANT_IMMUTABLE`), e as próprias funções do servidor (`rebase.record_history`, `rebase.enqueue_job`) são recusadas. Uma coluna que o chamador não tem permissão para ler — `.private()`, ou um `.access({ read })` que ele não possui — é omitida das linhas, assim como a API a omite, quando se trata de uma referência direta à coluna (`SELECT *`, `password_hash AS h`); um valor *computado* a partir dela (`md5(password_hash)`) não é reconhecido, portanto não faça cálculos a partir dela.
- **O que ele não compartilha.** `beforeQuery` e `afterRead`, validação, hooks de salvamento e histórico residem no Node e não são executados.

A partir de um script, [`openRebase`](/docs/backend/embedding-postgres-driver/) oferece o mesmo: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL como a identidade de serviço

Uma função que aplica suas próprias regras (um tíquete por dia, uma verificação de tempo) sobre tabelas que apenas administradores podem ler não pode usar `getSql(c)`: o chamador precisaria de políticas que o admitissem, e essas mesmas políticas abririam as tabelas na API de dados pública também. O `rebase.sqlAsAdmin` executa o comando como `{ uid: "service", roles: ["admin"] }`, a identidade que o `rebase.dataAsAdmin` usa, sob a mesma segurança em nível de linha:

```typescript
import { defineFunction, rebase } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/claim", async (c) => {
        const { device } = await c.req.json();
        const rows = await rebase.sqlAsAdmin(
            "INSERT INTO tickets (device, day) VALUES ($1, current_date) ON CONFLICT DO NOTHING RETURNING id",
            { params: [device], write: true }
        );
        return c.json({ claimed: rows.length === 1 });
    });
});
```

É o `getSql(c)` com uma identidade diferente: a role de requisição restrita, o braço administrativo de suas políticas, somente leitura a menos que `{ write: true }`, e a mesma proteção `SQL_NOT_ALLOWED`. Diferentemente do `rebase.sql()` do proprietário (owner), ele não pode executar DDL, e do repositório de autenticação ele acessa apenas o que um administrador acessa por meio da coleção de usuários: sessões, chaves e segredos de MFA são retidos da role de requisição, e o hash da senha é removido das linhas. Uma única instrução custa uma viagem de ida e volta (round trip), assim como o `rebase.sql()`. A partir de um script, o `openRebase()` também conta com isso.

### 4. `rebase.sql()` — SQL do proprietário e o único acessor exclusivo do Node

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Se você realmente precisa de um desvio incondicional (bypass), o `rebase.sql()` é a solução: SQL puro na conexão do proprietário, sem políticas, todas as linhas. É o recurso mais privilegiado no contexto de uma função — ainda mais do que o acessor com "admin" no nome.

Ele não serve para criar tabelas. Uma tabela é [declarada](/docs/schema/) com `defineTable` em `backend/schema/` e criada na inicialização; uma feita com `CREATE TABLE` em uma função não possui validação, hooks, postura de segurança em nível de linha, visualização de admin ou tipo no SDK. O `rebase.sql()` executa tal instrução e registra um aviso informando a tabela que deveria ser declarada em seu lugar.

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", requireAuth, requireAdmin, async (c) => {
        const rows = await rebase.sql(
            "SELECT count(*) AS total FROM jobs WHERE status = $1",
            { params: ["published"] }
        );
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```

Ele roda em uma conexão TCP com seu banco de dados, o que o torna o único acessor vinculado a um processo Node. Isso não tem custo algum em nenhum deployment existente hoje — é simplesmente algo a se ter em mente caso uma função venha a ser migrada posteriormente. Consulte [Portabilidade de runtime](#portabilidade-de-runtime).

:::caution[O acesso direto ao Drizzle é exclusivo do Node]
Você também pode importar sua própria instância do Drizzle e consultá-la diretamente (`db.execute(sql\`…\`)`). Funciona e, em uma implantação Node auto-hospedada ou gerenciada, não há problema.

Vale a pena saber o que isso custa: uma função que importa `drizzle-orm` e um pool de `pg` é permanentemente uma função Node, ela ignora os hooks da sua tabela, que o `rebase.data` executa (nenhum dos dois verifica `.validate()`, que se aplica a [requisições de API](/docs/collections/validation-and-conditions/#where-validation-runs)), e obtém sua conexão de outro lugar que não seja a requisição. O `rebase.sql()` oferece o mesmo SQL bruto por meio da própria conexão do framework, e o `getSql(c)` o disponibiliza sob as políticas do chamador. Dê preferência a eles.
:::

## Configuração e Segredos

Leia a configuração **dentro** do manipulador, nunca no escopo do módulo:

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Built once, on the first request that needs it — not at import time.
const apiKey = lazyResource((env) => env.PRICING_API_KEY ?? "");

export default defineFunction((app) => {
    app.get("/price", async (c) => {
        const endpoint = requireEnv(c, "PRICING_API_URL");
        const response = await fetch(endpoint, {
            headers: { authorization: `Bearer ${apiKey(c)}` }
        });
        return c.json(await response.json());
    });
});
```

Por que isso é importante em **qualquer** runtime, incluindo o Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Uma leitura no escopo do módulo é avaliada quando o arquivo é importado, antes de qualquer requisição existir. No Node, isso significa que uma única variável ausente derruba o arquivo inteiro e todas as rotas contidas nele. Em um host que anexa a configuração à requisição em vez de ao processo, não há absolutamente nada para ler no momento da importação.

- `getEnv(c)` — todas as variáveis visíveis para esta requisição
- `env(c, "NAME")` — uma variável, com espaços removidos (trimmed); em branco conta como não definida
- `requireEnv(c, "NAME")` — o mesmo, mas lança uma mensagem nomeando a variável
- `lazyResource(factory)` — constrói um cliente com custo alto de criação uma única vez, no primeiro uso

O `rebase doctor` reporta leituras de `process.env` no escopo do módulo dentro do seu diretório de funções.

## Trabalho em Segundo Plano

Movido para sua própria página: [Trabalho em Segundo Plano](/docs/backend/background-work/).

## Portabilidade de runtime

Uma função personalizada é um aplicativo Hono; portanto, a capacidade de ela rodar em outro lugar que não seja um processo Node depende do que o próprio arquivo importa. `rebase.sql()`, um cliente de banco de dados importado diretamente e os módulos internos (built-ins) do Node a vinculam ao Node; o restante do `rebase` e a plataforma web não o fazem, e nada falha hoje por causa de nenhum dos dois. [Portabilidade de runtime](/docs/backend/runtime-portability/) lista o que é portável, como o `rebase build` e o `rebase doctor` reportam isso e como ramificar com base no runtime.

## Ordem de Registro de Rotas

As funções personalizadas são carregadas e montadas **após** `initializeRebaseBackend()` concluir a configuração principal. A ordem de inicialização é:

1. **Bootstrappers** — Conexões de banco de dados, tabelas de autenticação, serviços em tempo real
2. **Rotas de autenticação** — `/api/auth/*`, `/api/admin/*`
3. **Rotas de armazenamento** — `/api/storage/*`
4. **Rotas de dados** — `/api/data/*` (CRUD para tabelas)
5. **Funções personalizadas** ← `/api/functions/*`
6. **Cron jobs** — `/api/admin/cron/*`
7. **WebSocket** — Inscrições em tempo real

Isso significa que suas funções personalizadas têm acesso a todos os serviços inicializados. Registre quaisquer rotas que precisem ser executadas **antes** do Rebase diretamente no aplicativo Hono, antes de chamar `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
As rotas que você adiciona ao seu próprio aplicativo dessa forma ficam **fora** de qualquer roteador do Rebase, portanto nenhum middleware de autenticação foi executado nelas e `getDriver(c)` estará indefinido. Proteja essas rotas com `requireAuth` / `requireAdmin` importados de **`@rebasepro/server`** — a raiz do pacote —, que verificam o token por conta própria. As proteções no subcaminho `/functions` leem uma identidade que um roteador do Rebase já resolveu e responderão com 500 em vez de fingir que uma existe.
:::

## Exemplo: Manipulador de Webhook

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Constructed on the first request, from that request's configuration. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Deliberately public: Stripe has no token to send. The signature is the
    // authentication, so verify it before doing anything else.
    app.post("/", async (c) => {
        const signature = c.req.header("stripe-signature");
        const body = await c.req.text();

        if (!signature || !verifySignature(body, signature, secret(c))) {
            return c.json({ error: "Bad signature" }, 400);
        }

        const event = JSON.parse(body) as { type: string; data: { object: Record<string, string> } };

        if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            await rebase.dataAsAdmin.table("subscriptions").create({
                user_id: session.client_reference_id,
                stripe_id: session.subscription,
                status: "active",
            });
            // Fulfilment can outlive the response; the 200 tells Stripe to stop retrying.
            waitUntil(c, notifyFulfilment(requireEnv(c, "FULFILMENT_URL"), session));
        }

        return c.json({ received: true });
    });
});

declare function verifySignature(body: string, signature: string, secret: string): boolean;
declare function notifyFulfilment(url: string, session: Record<string, string>): Promise<void>;
```

## Depuração

Quando as funções carregam, a inicialização registra no log `Loaded custom functions` com a contagem delas. A linha de cada função é registrada em nível `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Se o carregamento falhar, o carregador fornece uma saída de diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

O roteador é montado para o **diretório**, e não para as funções dentro dele. Se a importação de todos os arquivos falhar — uma única variável de ambiente ausente no escopo do módulo é suficiente para derrubar todos eles —, `GET /api/functions` ainda responde com `200` com uma lista vazia mais uma contagem de `skipped`, de forma que "nada foi carregado" possa ser distinguido de "esta compilação não enviou funções". A listagem em si requer um chamador autenticado, uma chave de API que possua o escopo simples `functions:invoke` ou a chave de serviço — as funções permanecem acessíveis para quem cada uma delas permitir, mas o inventário delas não é público. Os motivos permanecem no log de inicialização.

## Limites de Tempo (Timeouts) e Limites de Taxa (Rate Limits)

Dois limites máximos se aplicam a `/api/functions/*`:

- **Timeout de requisição** — 30 segundos por padrão, respondendo `504` com o código `FUNCTION_TIMEOUT`. Configure com `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` desativa. O manipulador não pode ser interrompido externamente, mas ele é avisado: `getSignal(c)` de `@rebasepro/server/functions` é abortado no momento do 504, portanto passe-o para `fetch` e qualquer outra coisa que aceite um signal (`fetch(url, { signal: getSignal(c) })`). O trabalho que não receber o signal continuará — o timeout libera o cliente e o socket, não o trabalho. O fato de o manipulador *continuar em execução* após o 504 é uma propriedade de um processo Node de longa duração, não uma garantia do contrato; qualquer coisa que precise ser concluída deve ficar em [`waitUntil`](#trabalho-em-segundo-plano).
- **Limite de taxa (rate limit)** — Chamadores com chave de API e chamadores autenticados compartilham os buckets da API de dados. Chamadores anônimos recebem sua própria cota, muito mais generosa (3000 por janela), porque este roteador é público por padrão para receptores de webhook. Sobrescreva com `rateLimit.anonymousFunctions`; `null` o desativa.

Rejeições de promessas não tratadas (unhandled promise rejections) são registradas em log em vez de serem fatais: caso contrário, uma chamada no padrão fire-and-forget em uma função derrubaria o processo inteiro. Defina `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para o comportamento padrão do Node.

No Rebase Cloud, o edge na frente das suas funções tem seus próprios limites, e o estado em nível de módulo, o sistema de arquivos e as portas de saída se comportam de maneiras que vale a pena conhecer antes de projetar em torno delas. Consulte [Runtime de backend gerenciado](/docs/deployment/managed-runtime/).

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Hooks de tabela](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tarefas em segundo plano agendadas
