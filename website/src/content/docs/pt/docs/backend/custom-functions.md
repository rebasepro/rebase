---
sourceHash: 22d7c8bbab763065
title: Funções Personalizadas
sidebar_label: Funções Personalizadas
description: Adicione endpoints de API Hono personalizados junto com suas rotas CRUD do Rebase. Descobertos automaticamente a partir de um diretório, com acesso total à instância do backend.
---

## Visão Geral

As funções personalizadas permitem adicionar **rotas de API Hono arbitrárias** junto com os endpoints CRUD gerados automaticamente pelo Rebase. Elas seguem o mesmo padrão de **descoberta baseada em arquivos** que as coleções e as tarefas cron: adicione um arquivo TypeScript no seu diretório `functions/`, e o Rebase o montará automaticamente.

Use funções personalizadas para:

- **Endpoints de lógica de negócios** — aprovações, promoções, fluxos de trabalho personalizados
- **Integrações de terceiros** — webhooks do Stripe, comandos do Slack, proxies de API externas
- **Endpoints públicos** — formulários de contato, captura de leads, verificações de integridade (health checks)
- **Consultas de agregação** — estatísticas de dashboard, relatórios, análises

## Definindo uma Função Personalizada

Crie um arquivo no seu diretório `backend/functions/` que exporte por padrão (default export) uma aplicação Hono:

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

Isso é montado em **`/api/functions/hello`**. O nome do arquivo (sem a extensão) se torna o prefixo da rota.

`POST`, porque é isso que o SDK envia por padrão — consulte
[Invocar a partir do cliente](#invocar-a-partir-do-cliente). Uma rota `GET` é igualmente
válida; o chamador então precisa definir `{ method: "GET" }`.

O comando `rebase dev` observa o diretório de funções, portanto, um arquivo adicionado enquanto
ele está em execução é montado na próxima recarga — sem necessidade de reiniciar. (Ele precisa ser
informado: o diretório é escaneado em vez de importado, portanto, o observador não pode inferi-lo.)

## Invocar a partir do cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

O método `invoke` constrói a URL, anexa o token do chamador e lança um
`RebaseApiError` em caso de status não-2xx — de modo que o formato de erro da própria função
chega ao chamador em vez de uma rejeição pura de `fetch`.

Quatro opções que ele aceita além do nome:

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
`client.call("functions/hello", payload)` também alcança uma função. Ele sempre
faz um `POST` e, assim como o `invoke`, retorna o corpo textualmente — nenhum dos dois busca
uma chave `data`. Prefira `functions.invoke`, que aceita um método, um subcaminho e um
`responseType`; o `call` existe para rotas montadas fora de `/api/functions`, o que o
`invoke` não pode expressar.
:::

:::important
Importe de **`@rebasepro/server/functions`**, e não de `@rebasepro/server`.

Ambos funcionam. O subcaminho é a superfície de criação *portável*: ele não puxa nada que exija Node, portanto, uma função escrita a partir dele pode rodar em qualquer runtime JavaScript. A raiz do pacote alcança todo o framework — a sequência de inicialização, os carregadores de arquivos, a camada de WebSocket — o que é apropriado para o ponto de entrada de um servidor e muito mais do que um manipulador de rota precisa. Ele também oferece acessadores de contexto tipados (`getUser`, `getDriver`) em vez de fazer o casting de `c.get("user")` manualmente.

Consulte [Portabilidade de runtime](#portabilidade-de-runtime) para o contrato completo.
:::

## Configuração

:::note[Onde isso se aplica]
**Runtime gerenciado:** nada a configurar — o runtime descobre `backend/functions/` por conta própria (`functions` na entrada `rebase.json` do aplicativo de backend se você o moveu). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringem quais funções um processo `REBASE_ROLE=functions` atende; qualquer outra role se recusa a inicializar com elas definidas.
**Ejetado:** `initializeRebaseBackend({ functionsDir })`, ou `functions` (abaixo), em `backend/src/index.ts`.
:::

Habilite funções personalizadas adicionando `functionsDir` à sua configuração de backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

O Rebase irá:

1. Escanear o diretório em busca de arquivos `.ts` / `.js`
2. Validar se cada exportação padrão é um aplicativo Hono (verificado por tipagem estrutural/duck-typing via `.fetch()` + `.routes`)
3. Montar cada aplicativo em `/api/functions/<filename>`
4. Aplicar o middleware de autenticação (consulte [Autenticação](#autenticação-e-propagação-de-contexto) abaixo)

### Funções como valores

Na versão 0.24, as funções vêm apenas de um diretório.

Um diretório é uma maneira de produzir o que o servidor atende: um registro de segmentos de URL para aplicativos Hono. Passe você mesmo esse registro como `functions`, ou leia um diretório para ele usando `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Forneça `functions` ou `functionsDir`, não ambos: a inicialização recusa a combinação de ambos. `loadFunctions(dir, { onSkip })` entrega cada arquivo que foi ignorado, com o respectivo motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` ainda funcionam, estão obsoletos (deprecated) e exibem um aviso uma única vez. Isoladamente, o grupo de funções pode ser montado em qualquer caminho com `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funcionam dentro dele; consulte [Integração de Servidor Personalizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nomeação de Arquivos e Mapeamento de Rotas

| Arquivo | Caminho de Montagem |
|---------|---------------------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

As funções são descobertas **apenas no nível raiz do diretório** — não há recursão. `functions/admin/users.ts` é compilado por `rebase build`, mas nunca montado; em vez disso, achate o nome (`functions/admin-users.ts`). Um subdiretório é reportado na inicialização e contabilizado no endpoint de listagem, em vez de ser ignorado silenciosamente.

Arquivos que são **ignorados**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — arquivos de teste
- `*.d.ts` — declarações de tipos
- Subdiretórios e arquivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — reportados como problemas, já que a compilação compila mais arquivos do que o runtime carrega

O nome é a identidade da função em todos os outros lugares também: ele é o segmento de URL, o alvo do escopo `functions:invoke:<name>` que uma chave precisa para chamá-la e o valor pelo qual `REBASE_FUNCTIONS_ONLY` seleciona quando você dedica um processo próprio a uma função.

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

`defineFunction` retorna exatamente o aplicativo Hono que estes constroem manualmente, portanto, os três são intercambiáveis. Ele evita que você precise declarar `Hono<HonoEnv>` e disponibiliza o singleton `rebase` no callback.

---

## Nos Bastidores: O Carregador com Duck-Typing

Em um monorepo, suas funções podem resolver uma cópia do Hono diferente daquela usada pelo Rebase e, nesse caso, `exported instanceof Hono` seria falso para um roteador funcional. Por isso, o carregador verifica a estrutura (`isHonoLike`): um objeto não nulo com um método `.fetch` e um array `.routes`.

### Escape do Compilador ES Module

O carregador converte cada caminho de arquivo em uma URL de arquivo (`pathToFileURL(filePath).href`), funcionando tanto no Windows quanto no POSIX, e chama `import(url)` por meio de `new Function("url", "return import(url)")`, de modo que a compilação do TypeScript não possa reescrevê-lo em um `require()` incompatível com ESM.

---

## Autenticação e Propagação de Contexto

As funções personalizadas são montadas com o **mesmo middleware de autenticação** das rotas de dados, mas com `requireAuth: false`. Isso significa que:

- O JWT do usuário é **analisado e injetado** no contexto, se estiver presente
- Porém, as requisições **não são rejeitadas** se nenhum JWT for fornecido
- Você deve **proteger explicitamente** as rotas que necessitam de autenticação

Um chamador que apresenta um token *inválido* nunca alcança o seu manipulador: um token não verificável ou expirado é rejeitado com 401 pelo próprio middleware, de modo que uma sessão expirada nunca é rebaixada silenciosamente para uma anônima.

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

`getUser` retorna um objeto restrito: `uid` é uma string e `roles` é sempre um array, independentemente do método de autenticação utilizado pelo chamador. `getUserId(c)` e `getRoles(c)` são atalhos. `getScopes(c)` representa tudo o que o chamador pode fazer, na forma de strings de [escopo](/docs/backend/roles-and-scopes/): para uma pessoa, o plano de dados, os escopos do próprio aplicativo e os escopos das suas funções; para uma chave de API, exatamente o que a chave detém.

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

Coloque os guards no **próprio slot de middleware da rota**, como visto acima, em vez de usar `app.use("/*", requireAuth)`. O método `use()` cobre apenas as rotas declaradas *abaixo* dele, portanto, uma rota adicionada posteriormente — no final do arquivo, meses depois — ficaria desprotegida silenciosamente.

:::important
A leitura de `getUser(c)` **não** atua como um guard. Um chamador anônimo recebe `undefined` e o seu manipulador é executado de qualquer forma. Apenas um guard, ou um `if (!user) return 401` explícito, interrompe a requisição.
:::

### Escopos e escopos do aplicativo

`requireAdmin` autoriza a role `admin` e ninguém mais. Para uma ação que uma role mais restrita ou uma chave de API deva acessar, proteja a rota com `requireScope`. Ele aceita um [escopo](/docs/backend/roles-and-scopes/) nativo, ou um que o aplicativo declare sob `auth.scopes` na coleção de usuários, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Toda pessoa autenticada detém todos os escopos do aplicativo, portanto, para uma pessoa, o `requireScope` não decide nada: verifique no manipulador se essa pessoa pode implantar esse projeto. O que o escopo adiciona é uma maneira de **restringir uma chave**: uma chave que possui `project:deploy:p1` passa apenas para `p1`. Uma chave também precisa de `functions:invoke`, ou `functions:invoke:<name>`, antes mesmo de alcançar a função. Consulte [Escopos do aplicativo](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticação por Chave de Serviço

O Rebase suporta uma variável estática `REBASE_SERVICE_KEY` definida no seu `.env` para scripts ou chamadas entre servidores (server-to-server).

Quando uma requisição externa envia a chave de serviço por meio do cabeçalho de autorização (`Authorization: Bearer <service_key>`), o middleware de autenticação automaticamente:
1. Valida a chave usando comparação de tempo constante para evitar ataques de temporização (timing attacks).
2. Concede acesso de nível de administrador, definindo o chamador como `{ uid: "service", roles: ["admin"] }`.
3. Injeta um `DataDriver` com escopo dessa mesma identidade de serviço. A Segurança em Nível de Linha (RLS) continua em vigor — ela é avaliada como `{ uid: "service", roles: ["admin"] }`, não ignorada.

### Autoautenticação Interna

Se você não configurou uma `REBASE_SERVICE_KEY`, o Rebase gera uma **chave interna aleatória a cada inicialização**. O singleton `rebase` usa essa chave automaticamente ao chamar as APIs do plano de controle do próprio servidor (como `rebase.auth` ou `rebase.storage`). Isso significa que a lógica do seu servidor sempre pode executar tarefas administrativas, mesmo sem uma chave de serviço configurada manualmente.

## Acessando o Banco de Dados e Serviços

### 1. O driver com escopo de usuário — para tudo que atende a uma requisição

`getDriver(c)` retorna o driver **com escopo voltado para o chamador**, portanto, toda leitura e gravação é avaliada em relação às suas políticas de Segurança em Nível de Linha (RLS) como aquele usuário:

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

`requireDriver(c)` é o `getDriver(c)` sem o operador `!` — ele lança uma mensagem apontando o problema de vinculação em vez de falhar vinte linhas depois com `undefined`.

### 2. `rebase.dataAsAdmin` — para tarefas em segundo plano confiáveis

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

### Driver com Escopo de RLS vs. Singleton Rebase

|                     | `getDriver(c)` (escopo de requisição)          | `rebase.dataAsAdmin` (identidade de serviço)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Executa como**    | O chamador (`uid`, suas roles)                 | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicação de RLS**| ✅ Sim (avaliado contra o chamador)            | ✅ Sim (avaliado contra a identidade de serviço)                 |
| **Ideal para...**   | CRUD geral de usuários, buscas e consultas     | Tarefas em segundo plano, gatilhos de sistema, webhooks          |
| **Estilo da API**   | Métodos a nível de driver (`fetchCollection`, `save`) | Acessadores de coleção fluentes (`rebase.dataAsAdmin.jobs.find`) |

#### O que `dataAsAdmin` é, precisamente

`rebase.dataAsAdmin` tem **escopo de administrador, não contorna o RLS**. O driver é definido uma vez, na inicialização, com `withAuth({ uid: "service", roles: ["admin"] })`, portanto, toda leitura e gravação roda dentro de uma transação que mudou para a role restrita `rebase_user` com `app.uid = 'service'`. Suas políticas são avaliadas — contra essa identidade.

Para a maioria dos projetos essa distinção nunca se manifesta, porque as políticas padrão que o Rebase injeta em cada coleção aceitam `serverContext() OR rolesOverlap(['admin'])`, e a identidade de serviço passa pelo segundo critério. Ela aparece no momento em que você escreve suas próprias políticas:

- **`policy.serverContext()` é falso para ela.** Esse helper compila para `rebase.uid() IS NULL`, e o `uid` deste acessador é `'service'`. Uma coleção com `disableDefaultPolicies: true` cuja única regra de escrita seja `serverContext()` recusará uma gravação de `dataAsAdmin` com o erro do Postgres `42501`, e uma leitura em tal coleção retornará **zero linhas com HTTP 200** — a direção silenciosa. Escreva `rolesOverlap(["admin"])` (ou adicione-o conjuntamente) quando você se referir ao "meu backend".
- **Seu alcance é igual ao de um usuário `admin`.** Conceder a role `admin` a um usuário da aplicação concede a ele exatamente as linhas que este acessador vê. Não é um canal privado.

### 3. `rebase.sql()` — SQL bruto, e o único acessador exclusivo de Node

Se você realmente precisa de um bypass incondicional, `rebase.sql()` é a solução: SQL puro na conexão proprietária, sem políticas, acessando todas as linhas. É o recurso com maiores privilégios no contexto de uma função — mais até do que o acessador com "admin" no nome.

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

Ele roda em uma conexão TCP com seu banco de dados, o que o torna o único acessador atrelado a um processo Node. Isso não acarreta custos em nenhuma implantação existente hoje — é simplesmente o detalhe a se atentar caso uma função venha a ser migrada posteriormente. Consulte [Portabilidade de runtime](#portabilidade-de-runtime).

:::caution[Acesso direto ao Drizzle é exclusivo do Node]
Você também pode importar sua própria instância do Drizzle e consultá-la diretamente (`db.execute(sql\`…\`)`). Isso funciona e, em uma implantação Node auto-hospedada ou gerenciada, não há problemas.

Vale a pena saber o custo disso: uma função que importa `drizzle-orm` e um pool do `pg` torna-se permanentemente uma função Node, contorna os callbacks de coleção executados pelo `rebase.data` (nenhum dos dois verifica `validation`, que se aplica a [requisições de API](/docs/collections/validation-and-conditions/#where-validation-runs)), e obtém sua conexão de outro lugar que não a requisição. O método `rebase.sql()` oferece o mesmo SQL bruto através da própria conexão do framework. Dê preferência a ele.
:::

## Configuração e Variáveis Secretas

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

Por que isso importa em **qualquer** runtime, inclusive o Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Uma leitura no escopo do módulo é avaliada quando o arquivo é importado, antes de qualquer requisição existir. No Node, isso significa que uma única variável ausente quebra o arquivo inteiro e todas as rotas contidas nele. Em um provedor que anexa a configuração à requisição e não ao processo, não há nada a ser lido no momento da importação.

- `getEnv(c)` — todas as variáveis visíveis para esta requisição
- `env(c, "NAME")` — uma única variável, sem espaços extras (trimmed); em branco conta como não definida
- `requireEnv(c, "NAME")` — o mesmo, mas lança um erro indicando o nome da variável
- `lazyResource(factory)` — instancia um cliente pesado uma única vez, no primeiro uso

O comando `rebase doctor` relata leituras de `process.env` em escopo de módulo dentro do seu diretório de funções.

## Trabalho em Segundo Plano

Tarefas que devem durar mais do que a resposta devem ser colocadas em `waitUntil`:

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

Uma promise não aguardada (sem await) parece equivalente, mas não é. `waitUntil` garante duas coisas:

- **No Node**, a promise é rastreada, de modo que o encerramento gracioso (graceful shutdown) aguarda por ela em vez de o processo finalizar durante o envio de um webhook. Uma promise solta em um sinal `SIGTERM` é simplesmente perdida.
- **Em hosts baseados em isolates**, o host é instruído a manter o isolate ativo até que a promise seja resolvida. Sem isso, o trabalho é descartado assim que a resposta for concluída — silenciosamente, com um status 200 normal nos logs.

Uma rejeição é registrada em log em vez de ser repassada ao manipulador geral de rejeições não tratadas (unhandled rejection), identificando a rota exata de onde ela se originou.

## Portabilidade de runtime

Uma função personalizada é um aplicativo Hono, e o Hono roda em todos os runtimes JavaScript para servidores. Saber se a *sua* função poderia rodar em outro lugar que não um processo Node se resume, portanto, ao que o arquivo dela importa e acessa.

Nada do que está aqui representa uma restrição sobre o que você pode escrever hoje. Toda implantação do Rebase é um processo Node; uma função que lê um arquivo ou abre um socket é perfeitamente válida, e nenhuma compilação ou deploy falha por causa disso. Isso está detalhado aqui para que as capacidades sejam conhecidas agora, em vez de descobertas caso a caso no futuro.

**Portável — funciona em qualquer runtime:**

- Tudo exportado de `@rebasepro/server/functions`
- `getDriver(c)` e `rebase.dataAsAdmin` — ambos utilizam a mesma comunicação de rede onde quer que estejam rodando
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — a plataforma web padrão
- Qualquer dependência que não exija o Node

**Exclusivo do Node:**

- `rebase.sql()` — a conexão proprietária com o banco de dados é um socket TCP
- Um cliente Drizzle/`pg`/`mongodb` importado diretamente, pelo mesmo motivo
- Módulos nativos do Node: `fs`, `path`, `crypto` (o módulo Node — `globalThis.crypto` é portável), `child_process`, …
- Pacotes construídos sobre eles: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bugs latentes em qualquer runtime** — vale a pena corrigi-los de qualquer maneira:

- `process.env` lido no escopo do módulo (consulte [Configuração e Variáveis Secretas](#configuração-e-variáveis-secretas))
- Promises estilo "dispare e esqueça" (fire-and-forget) em vez de [`waitUntil`](#trabalho-em-segundo-plano)
- Depender de um manipulador que continua rodando após o tempo limite da requisição ter expirado. No Node ele continua; essa é uma propriedade do processo, não uma garantia fornecida pelo framework

### Verificando suas próprias funções

O comando `rebase build` imprime uma linha para cada ocorrência detectada e grava o resultado por função no manifesto do bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

O comando `rebase doctor` relata a mesma informação sem a necessidade de compilar.

### Caso você precise de um caminho específico para determinado runtime

`runtimeKey()` retorna `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"`; `isNodeRuntime()` é a verificação mais comum. Use-os para degradação graciosa, não para bifurcar uma implementação — uma função que precisa de duas implementações consiste em duas funções diferentes.

```typescript
import { defineFunction, isNodeRuntime } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", async (c) => {
        if (!isNodeRuntime()) return c.json({ error: "Not available here" }, 501);
        const rows = await rebase.sql("SELECT count(*) AS total FROM jobs");
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```

## Ordem de Registro das Rotas

As funções personalizadas são carregadas e montadas **após** `initializeRebaseBackend()` concluir a configuração do núcleo. A ordem de inicialização é:

1. **Bootstrappers** — Conexões de banco de dados, tabelas de autenticação, serviços em tempo real
2. **Rotas de autenticação** — `/api/auth/*`, `/api/admin/*`
3. **Rotas de armazenamento** — `/api/storage/*`
4. **Rotas de dados** — `/api/data/*` (CRUD para coleções)
5. **Funções personalizadas** ← `/api/functions/*`
6. **Tarefas Cron** — `/api/admin/cron/*`
7. **WebSocket** — Inscrições em tempo real

Isso significa que suas funções personalizadas têm acesso a todos os serviços inicializados. Registre qualquer rota que precise rodar **antes** do Rebase diretamente na aplicação Hono, antes de invocar `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
As rotas adicionadas ao seu próprio aplicativo dessa forma ficam **fora** de qualquer roteador do Rebase, portanto, nenhum middleware de autenticação foi executado nelas e `getDriver(c)` não estará definido. Proteja-as com `requireAuth` / `requireAdmin` importados de **`@rebasepro/server`** — a raiz do pacote — que verificam o token por conta própria. Os guards no subcaminho `/functions` leem uma identidade já resolvida por um roteador Rebase e responderão com 500 em vez de fingir que ela existe.
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

Quando as funções são carregadas, a inicialização registra `Loaded custom functions` com a contagem. A linha de cada função é registrada em `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Se o carregamento falhar, o carregador fornecerá mensagens de diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

O roteador é montado para o **diretório**, não individualmente para as funções contidas nele. Se todos os arquivos falharem ao importar — uma única variável de ambiente ausente no escopo do módulo é suficiente para derrubar todos eles — a rota `GET /api/functions` ainda responderá com `200` com uma lista vazia mais a contagem de `skipped`, diferenciando a situação de "nada pôde ser carregado" de "esta versão não enviou nenhuma função". A listagem em si exige um chamador autenticado, uma chave de API que possua o escopo simples `functions:invoke`, ou a chave de serviço — as funções continuam acessíveis por quem cada uma autorizar, mas o inventário delas não é público. Os motivos continuam visíveis nos logs de inicialização.

## Limites de Tempo (Timeouts) e Limites de Taxa (Rate Limits)

Dois limites se aplicam a `/api/functions/*`:

- **Timeout de requisição** — 30 segundos por padrão, respondendo `504` com o código `FUNCTION_TIMEOUT`. Configure com `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` desativa o timeout. O manipulador não pode ser interrompido externamente, mas ele é notificado: o `getSignal(c)` de `@rebasepro/server/functions` é abortado no exato momento do 504, então repasse-o para o `fetch` e qualquer outra chamada que aceite um sinal (`fetch(url, { signal: getSignal(c) })`). Operações que não receberem o sinal continuarão sendo executadas — o timeout libera o cliente e o socket, não o processamento em si. O fato de o manipulador *continuar rodando* após o 504 é uma particularidade de um processo Node persistente, não uma garantia formal da arquitetura; tudo o que precisar ser concluído obrigatoriamente deve ser colocado em [`waitUntil`](#trabalho-em-segundo-plano).
- **Limite de taxa (Rate limit)** — Chamadores autenticados e por chave de API compartilham os limites da API de dados. Chamadores anônimos recebem sua própria cota, muito mais permissiva (3000 por janela), já que este roteador é público por padrão para receptores de webhooks. Sobrescreva com `rateLimit.anonymousFunctions`; o valor `null` desativa o limite.

Rejeições de promises não tratadas são registradas em log em vez de serem fatais: uma chamada do tipo fire-and-forget em uma única função, de outro modo, encerraria todo o processo. Defina `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para manter o comportamento padrão do Node.

No Rebase Cloud, a borda (edge) em frente às suas funções possui seus próprios limites, e o estado a nível de módulo, o sistema de arquivos e as portas de saída se comportam de maneiras que valem a pena conhecer antes de projetar em torno delas. Consulte [Runtime gerenciado de backend](/docs/deployment/managed-runtime/).

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Callbacks de Entidade](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Tarefas Cron](/docs/backend/cron-jobs)** — Tarefas agendadas em segundo plano
