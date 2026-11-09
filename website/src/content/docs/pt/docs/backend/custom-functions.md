---
sourceHash: 5c7b883b40f3262f
title: Funções Personalizadas
sidebar_label: Funções Personalizadas
description: Adicione endpoints de API Hono personalizados junto às suas rotas CRUD do Rebase. Descobertos automaticamente a partir de um diretório, com acesso total à instância do backend.
---

## Visão Geral

As funções personalizadas permitem adicionar **rotas de API Hono arbitrárias** junto aos endpoints CRUD gerados automaticamente pelo Rebase. Elas seguem o mesmo padrão de **descoberta baseada em arquivos** que coleções e cron jobs: adicione um arquivo TypeScript no seu diretório `functions/` e o Rebase o montará automaticamente.

Use funções personalizadas para:

- **Endpoints de lógica de negócios** — aprovações, promoções, fluxos de trabalho personalizados
- **Integrações de terceiros** — webhooks do Stripe, comandos do Slack, proxies de APIs externas
- **Endpoints públicos** — formulários de contato, captura de leads, health checks
- **Consultas agregadas** — estatísticas de dashboard, relatórios, analytics

## Definindo uma Função Personalizada

Crie um arquivo no seu diretório `backend/functions/` que exporte como padrão (default export) uma aplicação Hono:

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

`POST`, porque é isso que o SDK envia por padrão — veja [Invocar a partir do cliente](#invocar-a-partir-do-cliente). Uma rota `GET` é igualmente válida; quem faz a chamada só precisa especificar `{ method: "GET" }`.

O `rebase dev` observa o diretório de funções, de modo que um arquivo adicionado enquanto ele está em execução é montado no próximo recarregamento — sem necessidade de reiniciar. (Ele precisa ser informado: o diretório é escaneado em vez de importado, portanto o observador não pode inferi-lo.)

## Invocar a partir do cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

O `invoke` constrói a URL, anexa o token de quem fez a chamada e lança um `RebaseApiError` em respostas que não sejam 2xx — garantindo que a própria estrutura de erro da função chegue a quem chamou, em vez de uma simples rejeição do `fetch`.

Quatro parâmetros que ele aceita além do nome:

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
`client.call("functions/hello", payload)` também acessa uma função. Ele sempre usa `POST` e, assim como o `invoke`, retorna o corpo textualmente — nenhum dos dois busca por uma chave `data`. Prefira `functions.invoke`, que aceita método, subcaminho e um `responseType`; `call` existe para rotas montadas fora de `/api/functions`, que o `invoke` não consegue expressar.
:::

:::important
Importe de **`@rebasepro/server/functions`**, e não de `@rebasepro/server`.

Ambos funcionam. O subcaminho é a superfície de criação *portável*: ele não importa nada que exija Node, portanto uma função escrita com ele pode rodar em qualquer runtime JavaScript. A raiz do pacote carrega todo o framework — a sequência de inicialização, os carregadores de arquivos, a camada de WebSocket — o que é adequado para o ponto de entrada de um servidor, mas mais do que um handler de rota precisa. Ele também oferece acessadores de contexto tipados (`getUser`, `getDriver`) em vez de fazer casting de `c.get("user")` manualmente.

Consulte [Portabilidade de Runtime](#portabilidade-de-runtime) para o contrato completo.
:::

## Configuração

:::note[Onde isso vai]
**Runtime gerenciado:** nada a configurar — o runtime descobre `backend/functions/` por conta própria (`functions` na entrada `rebase.json` da aplicação backend, caso você tenha movido). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringem quais funções um processo com `REBASE_ROLE=functions` atende; qualquer outra role recusará a inicialização caso essas variáveis estejam definidas.
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
2. Validar se cada exportação padrão é uma aplicação Hono (verificada via duck-typing com `.fetch()` + `.routes`)
3. Montar cada aplicação em `/api/functions/<filename>`
4. Aplicar o middleware de autenticação (veja [Autenticação](#autenticação-e-propagação-de-contexto) abaixo)

### Funções como valores

Na versão 0.24, as funções vêm apenas de um diretório.

Um diretório é uma forma de produzir o que o servidor atende: um registro de segmento de URL para uma aplicação Hono. Passe você mesmo esse registro como `functions`, ou leia um diretório para dentro dele com `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Forneça `functions` ou `functionsDir`, não ambos: a inicialização recusa o par. `loadFunctions(dir, { onSkip })` retorna cada arquivo ignorado junto com o motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` ainda funcionam, estão obsoletos (deprecated) e exibem um aviso uma única vez. Isoladamente, o grupo de funções pode ser montado em qualquer caminho com `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funcionam dentro dele; consulte [Integração de Servidor Customizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nomenclatura de Arquivos e Mapeamento de Rotas

| Arquivo | Caminho de Montagem |
|---------|---------------------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

As funções são descobertas **apenas no nível raiz do diretório** — não há recursão. `functions/admin/users.ts` é compilado por `rebase build`, mas nunca é montado; em vez disso, achate o nome (`functions/admin-users.ts`). Um subdiretório é reportado na inicialização e contabilizado no endpoint de listagem, em vez de ser ignorado silenciosamente.

Arquivos que são **ignorados**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — arquivos de teste
- `*.d.ts` — declarações de tipos
- Subdiretórios e arquivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — reportados como problemas, já que a compilação compila mais do que o runtime carrega

O nome também é a identidade da função em todos os outros lugares: ele é o segmento de URL, o alvo do escopo `functions:invoke:<name>` que uma chave precisa para chamá-la, e o valor que `REBASE_FUNCTIONS_ONLY` seleciona quando você isola uma função em seu próprio processo.

## Formatos de Exportação

O carregador aceita dois formatos de exportação além do `defineFunction`:

### App Hono

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

O `defineFunction` retorna exatamente a aplicação Hono que estes constroem manualmente, portanto os três são intercambiáveis. Ele evita que você tenha que declarar `Hono<HonoEnv>` e entrega o singleton `rebase` no callback.

---

## Por Baixo dos Panos: O Carregador por Duck-Typing

Em um monorepo, suas funções podem resolver uma cópia do Hono diferente daquela usada pelo Rebase e, nesse caso, `exported instanceof Hono` retornaria falso para um roteador funcional. Por isso, o carregador valida a estrutura (`isHonoLike`): um objeto não nulo com um método `.fetch` e um array `.routes`.

### Escape do Compilador de ES Module

O carregador converte cada caminho de arquivo em uma URL de arquivo (`pathToFileURL(filePath).href`), funcionando da mesma forma no Windows e em sistemas POSIX, e chama `import(url)` por meio de `new Function("url", "return import(url)")`, evitando que uma compilação TypeScript o reescreva em um `require()` que falharia sob ESM.

---

## Autenticação e Propagação de Contexto

As funções personalizadas são montadas com o **mesmo middleware de autenticação** das rotas de dados, mas com `requireAuth: false`. Isso significa que:

- O JWT do usuário é **processado e injetado** no contexto, caso esteja presente
- Mas as requisições **não são rejeitadas** caso nenhum JWT seja fornecido
- Você deve **proteger explicitamente** as rotas que necessitam de autenticação

Quem fizer uma chamada apresentando um token *inválido* nunca chega ao seu handler: um token não verificável ou expirado é rejeitado com 401 pelo próprio middleware, garantindo que uma sessão expirada nunca seja rebaixada silenciosamente para anônima.

### Lendo quem fez a chamada

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

O `getUser` retorna um objeto restrito: `uid` é uma string e `roles` é sempre um array, independentemente do método de autenticação utilizado por quem chamou. `getUserId(c)` e `getRoles(c)` são atalhos. `getScopes(c)` retorna tudo o que quem chamou tem permissão para fazer, como strings de [escopo](/docs/backend/roles-and-scopes/): para uma pessoa, o plano de dados, os escopos próprios da aplicação e os escopos das suas roles; para uma chave de API, exatamente o que a chave contém.

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

Coloque os guards no **slot de middleware da própria rota**, como mostrado acima, em vez de usar `app.use("/*", requireAuth)`. O `use()` cobre apenas as rotas declaradas *abaixo* dele, de modo que uma rota incluída posteriormente — no final do arquivo, meses depois — ficaria desprotegida silenciosamente.

:::important
Ler `getUser(c)` **não** é um guard. Um usuário anônimo recebe `undefined` e o seu handler é executado de qualquer forma. Apenas um guard, ou um `if (!user) return 401` explícito, interrompe a requisição.
:::

### Escopos e escopos da aplicação

O `requireAdmin` admite a role `admin` e ninguém mais. Para uma ação que uma role mais restrita ou uma chave de API deva acessar, proteja a rota com `requireScope`. Ele aceita um [escopo](/docs/backend/roles-and-scopes/) nativo, ou um declarado pela aplicação sob `auth.scopes` na coleção de usuários, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Toda pessoa autenticada possui todos os escopos da aplicação, portanto, para uma pessoa, o `requireScope` não decide nada: verifique dentro do handler se essa pessoa pode fazer deploy desse projeto. O que o escopo adiciona é uma forma de **restringir uma chave**: uma chave contendo `project:deploy:p1` passa apenas para `p1`. Uma chave também precisa de `functions:invoke`, ou `functions:invoke:<name>`, antes mesmo de conseguir acessar a função. Consulte [Escopos da aplicação](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticação por Chave de Serviço

O Rebase suporta uma `REBASE_SERVICE_KEY` estática definida no seu `.env` para chamadas de scripts ou comunicação entre servidores (server-to-server).

Quando uma requisição externa fornece a chave de serviço pelo header Authorization (`Authorization: Bearer <service_key>`), o middleware de autenticação automaticamente:
1. Valida a chave usando comparação em tempo constante para evitar ataques de temporização (timing attacks).
2. Concede acesso de nível admin, definindo quem chamou como `{ uid: "service", roles: ["admin"] }`.
3. Injeta um `DataDriver` com escopo dessa mesma identidade de serviço. A Segurança em Nível de Linha (RLS) ainda se aplica — ela é avaliada como `{ uid: "service", roles: ["admin"] }`, e não ignorada.

### Autoautenticação Interna

Se você não tiver configurado uma `REBASE_SERVICE_KEY`, o Rebase gera uma **chave interna aleatória a cada inicialização**. O singleton `rebase` usa essa chave automaticamente ao chamar as APIs do plano de controle do próprio servidor (como `rebase.auth` ou `rebase.storage`). Isso significa que a sua lógica no lado do servidor sempre pode executar tarefas administrativas, mesmo sem uma chave de serviço configurada manualmente.

## Acessando o Banco de Dados e Serviços

### 1. O driver com escopo de usuário — para tudo que atende a uma requisição

`getDriver(c)` retorna o driver **com escopo de quem fez a chamada**, de modo que cada leitura e escrita seja avaliada em relação às suas políticas de Segurança em Nível de Linha (RLS) como aquele usuário:

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

`requireDriver(c)` é o `getDriver(c)` sem o `!` — ele lança uma mensagem apontando o problema de configuração em vez de falhar vinte linhas depois com `undefined`.

### 2. `rebase.dataAsAdmin` — para trabalho em segundo plano confiável

```typescript
import { defineFunction, requireAuth, requireAdmin } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/:id/approve", requireAuth, requireAdmin, async (c) => {
        const id = c.req.param("id");
        await rebase.dataAsAdmin.collection<Record<string, unknown>>("jobs").update(id, {
            status: "published",
            approved_at: new Date().toISOString(),
        });
        return c.json({ success: true });
    });
});
```

`rebase.dataAsAdmin` não é tipado até que você [registre o seu `Database` gerado](/docs/backend/typed-server-data).

### Driver com Escopo de RLS vs. Singleton do Rebase

|                     | `getDriver(c)` (escopo de requisição)          | `rebase.dataAsAdmin` (identidade de serviço)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Executado como**  | Quem chamou (`uid`, suas roles)                | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicação de RLS**| ✅ Sim (avaliado contra quem chamou)           | ✅ Sim (avaliado contra a identidade de serviço)                 |
| **Ideal para...**   | CRUD geral de usuário, buscas e consultas      | Jobs em segundo plano, gatilhos de sistema, webhooks             |
| **Estilo de API**   | Métodos a nível de driver (`fetchCollection`, `save`) | Acessadores fluentes de coleção (`rebase.dataAsAdmin.jobs.find`) |

#### O que é `dataAsAdmin`, precisamente

`rebase.dataAsAdmin` possui **escopo de admin, não bypass de RLS**. O driver recebe escopo uma vez, na inicialização, com `withAuth({ uid: "service", roles: ["admin"] })`, de modo que cada leitura e escrita roda dentro de uma transação que mudou para a role restrita `rebase_user` com `app.uid = 'service'`. Suas políticas são avaliadas — em relação a essa identidade.

Para a maioria dos projetos a distinção nunca aparece, porque as políticas padrão que o Rebase injeta em cada coleção aceitam `serverContext() OR rolesOverlap(['admin'])`, e a identidade de serviço cumpre a segunda condição. Ela aparece no momento em que você escreve suas próprias políticas:

- **`policy.serverContext()` é falso para ele.** Esse helper compila para `rebase.uid() IS NULL`, e o `uid` desse acessador é `'service'`. Uma coleção com `disableDefaultPolicies: true` cuja única regra de escrita seja `serverContext()` recusará uma escrita de `dataAsAdmin` com o erro do Postgres `42501`, e uma leitura nessa coleção retornará **zero linhas com HTTP 200** — o caminho silencioso. Escreva `rolesOverlap(["admin"])` (ou adicione-o conjuntamente) quando quiser dizer "meu backend".
- **Seu alcance equivale ao alcance de um usuário `admin`.** Conceder a role `admin` a um usuário da aplicação concede a ele exatamente as linhas que esse acessador enxerga. Não é um canal privado.

### 3. `getSql(c)` — SQL como o chamador

Quando o SDK não expressa bem uma consulta ou uma gravação — um upsert condicional, um `UPDATE … WHERE rev = $3 RETURNING` de compare-and-swap, `count(*) FILTER (…)`, uma CTE — escreva o SQL e execute-o como o chamador:

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

A instrução é executada na própria transação do chamador, como o papel restrito `rebase_user` com a identidade dele — a transação que o driver com escopo de usuário abre — de modo que as regras de segurança das suas coleções decidem cada linha, exatamente como no SDK. Uma consulta que pede todas as linhas recebe as do chamador.

- **Somente leitura por padrão.** Passe `{ write: true }` para inserir, atualizar ou excluir; as políticas de inserção e atualização continuam valendo.
- **O texto da consulta é seu; os valores vão em `params`** (`$1`, `$2`, …). A identidade do chamador fica em configurações da transação, que o SQL pode alterar, então uma instrução que possa fazer isso — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, mais de uma instrução — é recusada com `400 SQL_NOT_ALLOWED` antes de ser executada. Interpolar entrada do usuário no texto é exatamente o que essa proteção poria à prova; não faça isso.
- **O que ele compartilha com o SDK.** As políticas, e três regras que o Postgres aplica a ambos: uma [view materializada](/docs/collections/views/#materialized-views) serve suas linhas apenas às suas `roles`, uma linha de uma coleção que declara `tenant` não pode ser movida para outro tenant, exceto por um chamador `bypassRoles` (`TENANT_IMMUTABLE`), e as funções do próprio servidor (`rebase.record_history`, `rebase.enqueue_job`) são recusadas. Uma coluna que o chamador não pode ler — `excludeFromApi`, ou um `access.read` que ele não tem — é removida das linhas, como a API faz, quando é uma referência simples à coluna (`SELECT *`, `password_hash AS h`); um valor *calculado* a partir dela (`md5(password_hash)`) não é reconhecido, então não calcule nada a partir de uma coluna assim.
- **O que ele não compartilha.** `beforeQuery` e `afterRead`, a validação, os callbacks de salvamento e o histórico vivem no Node e não são executados.

A partir de um script, [`openRebase`](/docs/backend/embedding-postgres-driver/) oferece o mesmo: `(await rebase.withAuth(user)).sql(…)`.

### 4. `rebase.sql()` — SQL do proprietário e o único acessador exclusivo para Node

Se você realmente precisa de um bypass incondicional, `rebase.sql()` é a solução: SQL bruto na conexão do proprietário, sem políticas, em todas as linhas. É o recurso mais privilegiado no contexto de uma função — mais até do que o acessador com "admin" no nome.

Ele não serve para criar tabelas. Uma tabela é uma [coleção](/docs/collections/), declarada em `config/collections/` e criada na inicialização; uma tabela criada com `CREATE TABLE` dentro de uma função não tem validações, callbacks, regras de segurança, visualização no painel administrativo ou tipagem no SDK. `rebase.sql()` executa essa instrução e registra um aviso informando a coleção que deveria ser declarada em vez disso.

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

Ele roda em uma conexão TCP com o seu banco de dados, o que o torna o único acessador atrelado a um processo Node. Isso não tem custo em nenhum deployment existente hoje — é simplesmente algo a se ter em mente caso a função venha a ser migrada futuramente. Consulte [Portabilidade de Runtime](#portabilidade-de-runtime).

:::caution[O acesso direto ao Drizzle é exclusivo para Node]
Você também pode importar sua própria instância do Drizzle e consultá-la diretamente (`db.execute(sql\`…\`)`). Funciona, e em um deployment Node self-hosted ou gerenciado, não há problema.

Vale a pena saber o que isso acarreta: uma função que importa `drizzle-orm` e um pool do `pg` torna-se permanentemente uma função Node, ignora os callbacks de coleção que o `rebase.data` executa (nenhum dos dois verifica `validation`, que se aplica a [requisições de API](/docs/collections/validation-and-conditions/#where-validation-runs)), e obtém a conexão de outro lugar que não a requisição. O `rebase.sql()` fornece o mesmo SQL bruto através da própria conexão do framework, e o `getSql(c)` o fornece sob as políticas do chamador. Prefira utilizá-los.
:::

## Configuração e Segredos

Leia as configurações **dentro** do handler, nunca no escopo do módulo:

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

Por que isso importa em **qualquer** runtime, incluindo o Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Uma leitura no escopo do módulo é avaliada quando o arquivo é importado, antes que qualquer requisição exista. No Node, isso significa que uma única variável ausente derruba o arquivo inteiro e todas as rotas contidas nele. Em um host que associa a configuração à requisição e não ao processo, não há nada para ser lido no momento da importação.

- `getEnv(c)` — todas as variáveis visíveis para esta requisição
- `env(c, "NAME")` — uma variável, sem espaços extras; vazia é considerada indefinida
- `requireEnv(c, "NAME")` — o mesmo, mas lança um erro nomeando a variável
- `lazyResource(factory)` — instancia um cliente pesado apenas uma vez, no primeiro uso

O `rebase doctor` aponta leituras de `process.env` no escopo de módulo dentro do seu diretório de funções.

## Trabalho em Segundo Plano

Trabalhos que devem continuar após a resposta ser enviada devem ser colocados em `waitUntil`:

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // The caller does not wait for this, but shutdown does.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

Uma promise sem `await` parece equivalente, mas não é. O `waitUntil` garante duas vantagens:

- **No Node**, a promise é rastreada, de modo que um encerramento gracioso (graceful shutdown) aguarda por ela em vez de finalizar o processo interrompendo um webhook pela metade. Uma promise solta em um `SIGTERM` é simplesmente perdida.
- **Em um host baseado em isolates**, o host é instruído a manter o isolate ativo até que a promise seja concluída. Sem isso, a execução é interrompida no momento em que a resposta é resolvida — silenciosamente, exibindo um 200 normal nos logs.

Uma rejeição é registrada em log em vez de ser deixada para o handler de unhandled-rejection, permitindo que a falha identifique a rota de onde se originou.

Código executado fora de qualquer requisição não possui um `c` para passar: um inicializador a nível de módulo, um helper compartilhado entre rotas e crons, ou uma tarefa iniciada por um cron que não é aguardada. Passe para o `waitUntil` apenas o trabalho:

```typescript no-verify
import { waitUntil } from "@rebasepro/server/functions";

let ready: Promise<void> | undefined;

export function ensureCatalogue(): Promise<void> {
    ready ??= loadCatalogue().then(() => {
        // No request to attach it to, but shutdown still waits for it.
        waitUntil(rateNewSongs());
    });
    return ready;
}
```

O trabalho é rastreado para o encerramento gracioso e eventuais rejeições são registradas em log, assim como com `c`. O que ele não consegue fazer é manter um isolate ativo, pois esse é o contexto de execução da requisição: passe `c` sempre que houver uma requisição disponível. Trabalhos que uma execução de cron, um job ou um handler de fila podem simplesmente aguardar com `await` devem ser aguardados diretamente; a execução é o que o encerramento aguarda, e seu resultado é registrado com ela.

O encerramento aguarda no máximo 5 segundos por essas tarefas. Trabalhos que levam minutos devem estar em um [cron job](/docs/backend/cron-jobs/) ou em um [job](/docs/backend/jobs/), que são registrados e reinicializáveis. Um cron job também roda [um de cada vez entre instâncias](/docs/backend/cron-across-instances/#concurrency-guarding), seja disparado pelo agendamento ou por acionamento manual.

## Portabilidade de Runtime

Uma função personalizada é uma aplicação Hono, portanto, a possibilidade de ela rodar em um ambiente diferente de um processo Node depende do que seu próprio arquivo importa. `rebase.sql()`, um cliente de banco de dados importado diretamente e módulos nativos do Node a prendem ao Node; o restante do `rebase` e a plataforma web não fazem isso, e nada falha hoje por causa de nenhum dos dois. [Portabilidade de Runtime](/docs/backend/runtime-portability/) lista o que é portável, como `rebase build` e `rebase doctor` relatam isso e como alternar conforme o runtime.

## Ordem de Registro de Rotas

As funções personalizadas são carregadas e montadas **depois** que o `initializeRebaseBackend()` conclui a configuração principal. A ordem de inicialização é:

1. **Bootstrappers** — Conexões de banco de dados, tabelas de autenticação, serviços em tempo real
2. **Rotas de autenticação** — `/api/auth/*`, `/api/admin/*`
3. **Rotas de armazenamento (storage)** — `/api/storage/*`
4. **Rotas de dados** — `/api/data/*` (CRUD para coleções)
5. **Funções personalizadas** ← `/api/functions/*`
6. **Cron jobs** — `/api/admin/cron/*`
7. **WebSocket** — Assinaturas em tempo real

Isso significa que suas funções personalizadas têm acesso a todos os serviços inicializados. Registre qualquer rota que precise rodar **antes** do Rebase diretamente na aplicação Hono, antes de chamar `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Rotas adicionadas à sua própria aplicação dessa maneira ficam **fora** de todos os roteadores do Rebase, de modo que nenhum middleware de autenticação foi executado nelas e `getDriver(c)` estará indefinido. Proteja essas rotas com `requireAuth` / `requireAdmin` importados de **`@rebasepro/server`** — a raiz do pacote — que verificam o token por conta própria. Os guards no subcaminho `/functions` leem uma identidade que um roteador do Rebase já resolveu e responderão com 500 em vez de fingir que ela existe.
:::

## Exemplo: Handler de Webhook

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
            await rebase.dataAsAdmin.collection("subscriptions").create({
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

Quando as funções são carregadas, a inicialização registra `Loaded custom functions` com a contagem total. A linha individual de cada função é registrada como `debug` (`LOG_LEVEL=debug`):

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

O roteador é montado para o **diretório**, não para as funções dentro dele. Se a importação de todos os arquivos falhar — uma única variável de ambiente ausente no escopo do módulo é suficiente para derrubar todos eles —, `GET /api/functions` ainda responderá `200` com uma lista vazia mais uma contagem `skipped`, permitindo distinguir "nada foi carregado" de "esta compilação não incluiu funções". A listagem em si requer um chamador autenticado, uma chave de API com o escopo simples `functions:invoke`, ou a chave de serviço — as funções continuam podendo ser chamadas por quem cada uma permitir, mas a listagem de inventário não é pública. Os motivos permanecem no log de inicialização.

## Timeouts e Limites de Taxa

Dois limites se aplicam a `/api/functions/*`:

- **Timeout de requisição** — 30 segundos por padrão, respondendo `504` com o código `FUNCTION_TIMEOUT`. Configure com `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` desativa o timeout. O handler não pode ser interrompido externamente, mas ele é informado: `getSignal(c)` de `@rebasepro/server/functions` é abortado no momento do 504, portanto repasse-o para o `fetch` e qualquer outra chamada que aceite um sinal (`fetch(url, { signal: getSignal(c) })`). Trabalhos que não receberem o sinal continuarão executando — o timeout libera o cliente e o socket, não o processamento. O fato de o handler *continuar rodando* após o 504 é uma característica de processos Node de longa duração, não uma garantia contratual; qualquer coisa que precise ser concluída deve ficar dentro de [`waitUntil`](#trabalho-em-segundo-plano).
- **Limite de taxa (Rate limit)** — Chamadas com chave de API e autenticadas compartilham os limites da API de dados. Chamadas anônimas recebem uma cota própria e muito mais permissiva (3000 por janela), já que esse roteador é público por padrão para receptores de webhook. Sobrescreva com `rateLimit.anonymousFunctions`; `null` o desativa.

Rejeições de promises não tratadas são registradas em log em vez de serem fatais: caso contrário, uma chamada no formato fire-and-forget em uma função derrubaria o processo inteiro. Defina `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para manter o comportamento padrão do Node.

No Rebase Cloud, a camada de borda (edge) à frente das suas funções possui limites próprios, e o estado a nível de módulo, o sistema de arquivos e as portas de saída se comportam de maneiras que vale a pena conhecer antes de projetar sua arquitetura. Consulte [Runtime gerenciado de backend](/docs/deployment/managed-runtime/).

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Callbacks de Entidades](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tarefas agendadas em segundo plano
