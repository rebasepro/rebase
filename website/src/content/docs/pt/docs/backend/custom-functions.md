---
sourceHash: 65910bc3708c9f5d
title: Funções Personalizadas
sidebar_label: Funções Personalizadas
description: Adicione endpoints de API Hono personalizados junto com suas rotas CRUD do Rebase. Descoberta automática a partir de um diretório, com acesso total à instância do backend.
---

## Visão Geral

As funções personalizadas permitem adicionar **rotas de API Hono arbitrárias** junto aos endpoints CRUD gerados automaticamente pelo Rebase. Elas seguem o mesmo padrão de **descoberta baseada em arquivos** das coleções e cron jobs: basta colocar um arquivo TypeScript no diretório `functions/` e o Rebase o monta automaticamente.

Use funções personalizadas para:

- **Endpoints de lógica de negócios** — aprovações, promoções, fluxos de trabalho personalizados
- **Integrações com terceiros** — webhooks do Stripe, comandos do Slack, proxies de APIs externas
- **Endpoints públicos** — formulários de contato, captura de leads, health checks
- **Consultas agregadas** — estatísticas de painel (dashboard), relatórios, analytics

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

Isso é montado em **`/api/functions/hello`**. O nome do arquivo (sem extensão) se torna o prefixo da rota.

`POST`, porque é isso que o SDK envia por padrão — veja
[Invocar a partir do cliente](#invocar-a-partir-do-cliente). Uma rota `GET` é igualmente
válida; o chamador terá então que especificar `{ method: "GET" }`.

O `rebase dev` monitora o diretório de funções, portanto, um arquivo adicionado enquanto ele estiver
em execução é montado no próximo recarregamento — sem necessidade de reiniciar. (É necessário avisar: o
diretório é escaneado em vez de importado, logo o watcher não consegue inferi-lo.)

## Invocar a partir do cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

O `invoke` constrói a URL, anexa o token do chamador e lança um
`RebaseApiError` em caso de resposta diferente de 2xx — de modo que o próprio formato de erro da função chegue ao
chamador em vez de uma rejeição crua do `fetch`.

Três coisas que ele aceita além do nome:

```typescript
// A different method. The payload is dropped for GET, since GET has no body.
await client.functions.invoke("hello", undefined, { method: "GET" });

// A sub-path — `/api/functions/hello/stats`. It goes here, never in the name:
// a name containing "/" is refused rather than percent-encoded into a 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// A query string. Passed as `path`, with no separator inserted before `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });
```

:::note
`client.call("functions/hello", …)` também acessa uma função e faz algo
sutilmente diferente: ele desempacota `res.data` quando a resposta tem um. Ter duas formas de
acesso com dois contratos de resposta diferentes é uma armadilha — use `functions.invoke`. O `call` existe
para rotas montadas fora de `/api/functions`, que o `invoke` não consegue expressar.
:::

:::important
Importe de **`@rebasepro/server/functions`**, não de `@rebasepro/server`.

Ambos funcionam. O subcaminho é a superfície de autoria *portável*: ele não inclui nada que exija o Node, portanto, uma função escrita com ele pode rodar em qualquer runtime JavaScript. A raiz do pacote acessa todo o framework — a sequência de inicialização (boot), os carregadores de arquivos, a camada WebSocket — o que é apropriado para o ponto de entrada do servidor, mas muito mais do que um manipulador de rota necessita. Ele também fornece acessadores de contexto tipados (`getUser`, `getDriver`) em vez de fazer o cast manual de `c.get("user")`.

Veja [Portabilidade de runtime](#portabilidade-de-runtime) para o contrato completo.
:::

## Configuração

:::note[Onde configurar]
**Runtime gerenciado:** nada a configurar — o runtime descobre `backend/functions/` por conta própria (`entry.functions` em `rebase.json` caso tenha movido). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringem quais funções um processo atende.
**Ejetado (Ejected):** `initializeRebaseBackend({ functionsDir })` em `backend/src/index.ts`.
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
2. Validar se cada exportação padrão é uma aplicação Hono (duck-typed via `.fetch()` + `.routes`)
3. Montar cada aplicação em `/api/functions/<filename>`
4. Aplicar o middleware de autenticação (veja [Autenticação](#autenticação-e-propagação-de-contexto) abaixo)

## Nomeação de Arquivos e Mapeamento de Rotas

| Arquivo | Caminho de Montagem |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

As funções são descobertas **apenas no nível superior do diretório** — não há recursão. `functions/admin/users.ts` é compilado pelo `rebase build`, mas nunca montado; em vez disso, achate o nome (`functions/admin-users.ts`). Subdiretórios são reportados durante a inicialização e contabilizados no endpoint de listagem, em vez de serem ignorados silenciosamente.

Arquivos que são **ignorados**:

- `index.ts` / `index.js` — reservado
- `*.test.ts` / `*.test.js` — arquivos de teste
- `*.d.ts` — declarações de tipos
- Subdiretórios e arquivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — reportados como problemas, já que a compilação (build) compila mais do que o runtime carrega

O nome é a identidade da função em todos os outros lugares também: é o segmento da URL, a permissão da chave de API `functions/<name>`, e o valor pelo qual `REBASE_FUNCTIONS_ONLY` faz a seleção quando você atribui um processo próprio para uma função.

## Formatos de Exportação

O carregador aceita dois formatos de exportação além de `defineFunction`:

### Aplicação Hono

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

O `defineFunction` retorna exatamente a aplicação Hono que esses métodos constroem manualmente, portanto, os três são intercambiáveis. Ele poupa a declaração de `Hono<HonoEnv>` e entrega o singleton `rebase` no callback.

---

## Sob o Capô: O Carregador Duck-Typing

Ao compilar bases de código com múltiplos diretórios aninhados ou em monorepos, você pode se deparar com a **duplicação do pacote Hono**.

Se o framework Rebase depender de uma versão do Hono e o diretório local de funções resolver para outra, as verificações padrão de herança de classe (`exported instanceof Hono`) falharão porque seus protótipos existem em espaços de memória separados.

Para evitar falsos negativos e rejeitar o carregamento de roteadores funcionais, o Rebase usa um validador baseado em duck typing (`isHonoLike`):
- Verifica se o objeto exportado é um `object` não nulo.
- Verifica se o objeto expõe um método `.fetch` (necessário para rotear requisições).
- Verifica se `.routes` é um `array`.

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### Escape do Compilador para Módulos ES

Para importar arquivos TypeScript e JavaScript dinamicamente tanto no Windows quanto em sistemas POSIX, o carregador converte caminhos de arquivo em URIs de arquivo padrão por meio de `pathToFileURL(filePath).href`.

Para evitar que a compilação do TypeScript reescreva importações dinâmicas nativas do ESM (`import(url)`) em chamadas `require()` do CommonJS (o que lançaria erros em tempo de execução em runtimes ESM), o Rebase executa um escape do compilador em runtime:

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Autenticação e Propagação de Contexto

As funções personalizadas são montadas com o **mesmo middleware de autenticação** das rotas de dados, mas com `requireAuth: false`. Isso significa que:

- O JWT do usuário é **analisado e injetado** no contexto, caso esteja presente
- Mas as requisições **não são rejeitadas** se nenhum JWT for fornecido
- Você deve **proteger explicitamente** as rotas que necessitam de autenticação

Um chamador que apresente um token *inválido* nunca chega ao seu manipulador: um token não verificável ou expirado é rejeitado com 401 pelo próprio middleware, de modo que uma sessão expirada nunca seja rebaixada silenciosamente para uma sessão anônima.

### Lendo o chamador

```typescript
import { defineFunction, getUser, getUserId, getRoles, isAdmin } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/me", (c) => {
        const user = getUser(c);          // { uid, roles, ...claims } | undefined
        if (!user) return c.json({ error: "Unauthorized" }, 401);
        return c.json({ uid: user.uid, roles: user.roles, admin: isAdmin(c) });
    });
});
```

`getUser` retorna um objeto restrito: `uid` é uma string e `roles` é sempre um array, independentemente do método de autenticação utilizado pelo chamador. `getUserId(c)` e `getRoles(c)` são atalhos.

### Protegendo Rotas

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Public endpoint — no guard, so anyone can call it.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 for anonymous callers.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 anonymous, 403 without an administrative role. Order matters.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Any one of the named roles.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Coloque os guards no **slot de middleware da própria rota**, como acima, em vez de usar `app.use("/*", requireAuth)`. O `use()` cobre apenas as rotas declaradas *abaixo* dele, portanto, uma rota adicionada posteriormente — no final do arquivo, meses depois — ficaria desprotegida silenciosamente.

:::important
Ler `getUser(c)` **não** é um guard. Um chamador anônimo recebe `undefined` e o seu manipulador é executado mesmo assim. Apenas um guard, ou um `if (!user) return 401` explícito, interrompe a requisição.
:::

### Autenticação por Chave de Serviço (Service Key)

O Rebase suporta uma `REBASE_SERVICE_KEY` estática definida no seu `.env` para scripts ou chamadas server-to-server.

Quando uma requisição externa passa a chave de serviço por meio do cabeçalho Authorization (`Authorization: Bearer <service_key>`), o middleware de autenticação automaticamente:
1. Valida a chave usando comparação em tempo constante para evitar ataques de temporização (timing attacks).
2. Concede acesso de nível de administrador, definindo o chamador como `{ uid: "service", roles: ["admin"] }`.
3. Injeta um `DataDriver` com escopo dessa mesma identidade de serviço. O Row-Level Security ainda se aplica — ele é avaliado como `{ uid: "service", roles: ["admin"] }`, e não ignorado.

### Autoautenticação Interna

Se você não configurou uma `REBASE_SERVICE_KEY`, o Rebase gera uma **chave interna aleatória a cada inicialização (per-boot)**. O singleton `rebase` usa essa chave automaticamente ao chamar as APIs do plano de controle do próprio servidor (como `rebase.auth` ou `rebase.storage`). Isso significa que a lógica do seu servidor sempre pode executar tarefas administrativas, mesmo sem uma chave de serviço configurada manualmente.

## Acessando o Banco de Dados e Serviços

### 1. O driver com escopo do usuário — para qualquer coisa que atenda a uma requisição

`getDriver(c)` retorna o driver **com escopo no chamador**, de modo que cada leitura e gravação seja avaliada contra suas políticas de Row-Level Security como aquele usuário:

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

`requireDriver(c)` é o `getDriver(c)` sem o `!` — ele lança uma mensagem nomeando o problema de conexão/configuração em vez de falhar vinte linhas depois com `undefined`.

### 2. `rebase.dataAsAdmin` — para trabalhos em segundo plano confiáveis

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

### Driver com Escopo RLS vs. Singleton Rebase

|                     | `getDriver(c)` (escopo da requisição)          | `rebase.dataAsAdmin` (identidade de serviço)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Executa como**    | O chamador (`uid`, suas roles)                 | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicação de RLS**| ✅ Sim (avaliado contra o chamador)            | ✅ Sim (avaliado contra a identidade de serviço)                 |
| **Ideal para...**   | CRUD de usuário geral, busca e consultas       | Tarefas em segundo plano, triggers do sistema, webhooks          |
| **Estilo de API**   | Métodos a nível de driver (`fetchCollection`, `save`) | Acessadores fluentes de coleção (`rebase.dataAsAdmin.jobs.find`) |

#### O que `dataAsAdmin` é, exatamente

O `rebase.dataAsAdmin` tem **escopo de admin, não bypass de RLS**. O driver recebe o escopo uma vez, na inicialização, com `withAuth({ uid: "service", roles: ["admin"] })`, de modo que cada leitura e gravação seja executada dentro de uma transação que mudou para a role restrita `rebase_user` com `app.uid = 'service'`. Suas políticas são avaliadas — contra essa identidade.

Para a maioria dos projetos essa distinção nunca se manifesta, porque as políticas padrão que o Rebase injeta em cada coleção admitem `serverContext() OR rolesOverlap(['admin'])`, e a identidade de serviço satisfaz o segundo braço. Ela se manifesta a partir do momento em que você escreve suas próprias políticas:

- **`policy.serverContext()` é falso para ela.** Esse helper compila para `rebase.uid() IS NULL`, e o `uid` desse acessador é `'service'`. Uma coleção com `disableDefaultPolicies: true` cuja única regra de escrita seja `serverContext()` recusará uma escrita do `dataAsAdmin` com o erro do Postgres `42501`, e uma leitura nessa coleção retornará **zero linhas com HTTP 200** — a direção silenciosa. Escreva `rolesOverlap(["admin"])` (ou adicione-o junto) quando quiser dizer "meu backend".
- **Seu alcance é igual ao alcance de um usuário `admin`.** Conceder a role `admin` a um usuário da aplicação concede a ele exatamente as linhas que esse acessador vê. Não é um canal privado.

### 3. `rebase.sql()` — SQL bruto, e o único acessador exclusivo do Node

Se você genuinamente precisa de um bypass incondicional, `rebase.sql()` é a solução: SQL bruto na conexão do proprietário (owner), sem políticas, todas as linhas. É a coisa mais privilegiada no contexto de uma função — mais até do que o acessador com "admin" no nome.

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

Ele roda em uma conexão TCP com o seu banco de dados, o que o torna o único acessador atrelado a um processo Node. Isso não custa nada em nenhuma implantação existente hoje — é apenas algo a se ter em mente caso uma função venha a ser migrada posteriormente. Veja [Portabilidade de runtime](#portabilidade-de-runtime).

:::caution[Acesso direto ao Drizzle é exclusivo do Node]
Você também pode importar sua própria instância do Drizzle e consultá-la diretamente (`db.execute(sql\`…\`)`). Isso funciona e, em um ambiente Node gerenciado ou self-hosted, não há problema.

Vale a pena saber o que isso custa: uma função que importa `drizzle-orm` e um pool `pg` é permanentemente uma função Node, ignora os callbacks e validações da sua coleção e obtém sua conexão de outro lugar que não a requisição. O `rebase.sql()` oferece o mesmo SQL bruto por meio da própria conexão do framework. Dê preferência a ele.
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

Por que isso importa em **qualquer** runtime, incluindo o Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Uma leitura em escopo de módulo é avaliada quando o arquivo é importado, antes de qualquer requisição existir. No Node, isso significa que uma única variável ausente derruba o arquivo inteiro e todas as rotas contidas nele. Em um host que anexa a configuração à requisição em vez de ao processo, não há absolutamente nada para ler no momento da importação.

- `getEnv(c)` — todas as variáveis visíveis para esta requisição
- `env(c, "NAME")` — uma variável, sem espaços extras (trimmed); vazia conta como não definida
- `requireEnv(c, "NAME")` — o mesmo, mas lança uma mensagem nomeando a variável
- `lazyResource(factory)` — instancia um cliente pesado uma única vez, no primeiro uso

O `rebase doctor` relata leituras de `process.env` em escopo de módulo no seu diretório de funções.

## Trabalho em Segundo Plano

O trabalho que deve continuar após a resposta deve ser colocado em `waitUntil`:

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

Uma promise sem `await` parece equivalente, mas não é. O `waitUntil` oferece duas vantagens:

- **No Node**, a promise é rastreada, de modo que um encerramento gracioso (graceful shutdown) aguarda por ela em vez de o processo finalizar no meio do envio de um webhook. Uma promise flutuante em um `SIGTERM` é simplesmente perdida.
- **Em um host baseado em isolates**, o host é instruído a manter o isolate ativo até que a promise seja concluída. Sem isso, o trabalho é descartado no momento em que a resposta é resolvida — silenciosamente, com um 200 limpo nos logs.

Uma rejeição é registrada em log em vez de ser deixada para o manipulador de rejeições não tratadas (unhandled-rejection), garantindo que uma falha aponte a rota de onde veio.

## Portabilidade de runtime

Uma função personalizada é uma aplicação Hono, e o Hono roda em todos os runtimes de servidor JavaScript. O fato de a *sua* função poder rodar em outro lugar que não seja um processo Node resume-se, portanto, ao que o próprio arquivo dela importa e consome.

Nada aqui é uma restrição ao que você pode escrever hoje. Toda implantação do Rebase é um processo Node, uma função que lê um arquivo ou abre um socket é perfeitamente válida, e nenhuma compilação ou deploy falha por causa disso. Isso está documentado para que a resposta possa ser conhecida agora, em vez de descoberta arquivo por arquivo mais tarde.

**Portável — funciona em qualquer runtime:**

- Tudo exportado de `@rebasepro/server/functions`
- `getDriver(c)` e `rebase.dataAsAdmin` — ambos trafegam pelo mesmo canal onde quer que rodem
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — a plataforma web
- Qualquer dependência que não precise do Node

**Exclusivo do Node:**

- `rebase.sql()` — a conexão do proprietário do banco de dados é um socket TCP
- Um cliente Drizzle/`pg`/`mongodb` importado diretamente, pelo mesmo motivo
- Módulos nativos do Node: `fs`, `path`, `crypto` (o módulo do Node — `globalThis.crypto` é portável), `child_process`, …
- Pacotes construídos sobre eles: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bugs latentes em todos os runtimes** — vale a pena corrigi-los de qualquer maneira:

- Leitura de `process.env` no escopo do módulo (veja [Configuração e Segredos](#configuração-e-segredos))
- Promises no estilo dispara-e-esquece (fire-and-forget) em vez de [`waitUntil`](#trabalho-em-segundo-plano)
- Depender da continuidade da execução de um manipulador após a requisição sofrer timeout. No Node ele continua; isso é uma característica do processo, não uma garantia dada pelo framework

### Verificando suas próprias funções

O `rebase build` imprime uma linha para cada ocorrência acionável e registra o veredito por função no manifesto do bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

O `rebase doctor` relata a mesma coisa sem precisar compilar.

### Se você precisar de um caminho específico por runtime

`runtimeKey()` retorna `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"`; `isNodeRuntime()` é a verificação mais comum. Use-os para degradar graciosamente, não para bifurcar uma implementação — uma função que precisa de duas implementações são duas funções.

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

## Ordem de Registro de Rotas

As funções personalizadas são carregadas e montadas **depois** que `initializeRebaseBackend()` conclui a configuração principal. A ordem de inicialização é:

1. **Inicializadores (Bootstrappers)** — Conexões de banco de dados, tabelas de autenticação, serviços em tempo real (realtime)
2. **Rotas de autenticação** — `/api/auth/*`, `/api/admin/*`
3. **Rotas de armazenamento (storage)** — `/api/storage/*`
4. **Rotas de dados** — `/api/data/*` (CRUD para coleções)
5. **Funções personalizadas** ← `/api/functions/*`
6. **Cron jobs** — `/api/cron/*`
7. **WebSocket** — Inscrições em tempo real (realtime)

Isso significa que suas funções personalizadas têm acesso a todos os serviços inicializados. Registre quaisquer rotas que precisem ser executadas **antes** do Rebase diretamente na aplicação Hono, antes de chamar `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Rotas adicionadas à sua própria aplicação dessa maneira ficam **fora** de qualquer roteador do Rebase, logo nenhum middleware de autenticação foi executado nelas e `getDriver(c)` não estará definido. Proteja essas rotas com `requireAuth` / `requireAdmin` importados de **`@rebasepro/server`** — a raiz do pacote — que verificam o token por conta própria. Os guards no subcaminho `/functions` leem uma identidade que um roteador do Rebase já resolveu e responderão com 500 em vez de fingir que uma identidade existe.
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

Quando uma função for carregada com sucesso, você verá:

```
⚡ Loaded function route: hello
```

Se o carregamento falhar, o carregador fornecerá uma saída de diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

O roteador é montado para o **diretório**, não para as funções nele contidas. Se todos os arquivos falharem ao importar — uma única variável de ambiente ausente no escopo do módulo é suficiente para derrubar todos eles —, `GET /api/functions` ainda responderá `200` com uma lista vazia mais uma contagem de `skipped`, de modo que "nada carregado" possa ser distinguido de "esta compilação não incluiu funções". A listagem em si requer um chamador autenticado, uma chave de API ou a chave de serviço — as funções continuam acessíveis por quem quer que cada uma permita, mas o inventário delas não é público. Os motivos permanecem no log de inicialização.

## Timeouts e Limites de Taxa (Rate Limits)

Dois limites se aplicam a `/api/functions/*`:

- **Timeout da requisição** — 30 segundos por padrão, respondendo `504` com o código `FUNCTION_TIMEOUT`. Configure com `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` desativa o timeout. O manipulador não pode ser cancelado externamente, portanto, forneça um `AbortSignal` para chamadas HTTP externas — o timeout libera o cliente e o socket, não o trabalho pendente. O fato de o manipulador *continuar em execução* após o 504 é uma propriedade de um processo Node de longa duração, não uma garantia contratual; qualquer coisa que precise ser concluída pertence ao [`waitUntil`](#trabalho-em-segundo-plano).
- **Limite de taxa (Rate limit)** — Chamadores autenticados e com chave de API compartilham os buckets da API de dados. Chamadores anônimos recebem uma cota própria e bem mais generosa (3000 por janela), pois este roteador é público por padrão para receptores de webhooks. Sobrescreva com `rateLimit.anonymousFunctions`; `null` desativa o limite.

Rejeições de promises não tratadas são registradas em log em vez de serem fatais: de outro modo, uma chamada fire-and-forget em uma função encerraria todo o processo. Defina `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para o comportamento padrão do Node.

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Callbacks de Entidade](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tarefas agendadas em segundo plano
