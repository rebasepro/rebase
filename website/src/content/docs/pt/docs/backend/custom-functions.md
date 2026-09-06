---
sourceHash: 65910bc3708c9f5d
title: Funções Personalizadas
sidebar_label: Funções Personalizadas
description: Adicione endpoints de API Hono personalizados junto às suas rotas CRUD do Rebase. Descobertos automaticamente a partir de um diretório, com acesso total à instância do backend.
---

## Visão Geral

As funções personalizadas permitem adicionar **rotas de API Hono arbitrárias** junto aos endpoints CRUD gerados automaticamente pelo Rebase. Seguem o mesmo padrão de **descoberta por arquivos** das collections e dos jobs cron: coloque um arquivo TypeScript no seu diretório `functions/` e o Rebase o monta automaticamente.

Use funções personalizadas para:

- **Endpoints de lógica de negócio** — aprovações, promoções, fluxos de trabalho personalizados
- **Integrações de terceiros** — webhooks do Stripe, comandos do Slack, proxies de APIs externas
- **Endpoints públicos** — formulários de contato, captação de leads, verificações de saúde
- **Consultas agregadas** — estatísticas de painéis, relatórios, análises

## Definir uma Função Personalizada

Crie um arquivo no seu diretório `backend/functions/` que exporte por padrão uma aplicação Hono:

```typescript
// backend/functions/hello.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.get("/", (c) => c.json({ message: "Hello from custom function!" }));
});
```

Ela é montada em **`/api/functions/hello`**. O nome do arquivo (sem extensão) torna-se o prefixo da rota.

:::important
Importe de **`@rebasepro/server/functions`**, não de `@rebasepro/server`.

Ambos funcionam. O subcaminho é a superfície de autoria *portátil*: não arrasta nada que exija Node, de modo que uma função escrita com ele pode rodar em qualquer runtime JavaScript. A raiz do pacote alcança todo o framework — a sequência de inicialização, os carregadores de arquivos, a camada WebSocket — o que é correto para um ponto de entrada de servidor e é mais do que um manipulador de rota precisa. Ela também lhe dá acessores de contexto tipados (`getUser`, `getDriver`) em vez de converter `c.get("user")` à mão.

Veja [Portabilidade entre runtimes](#portabilidade-entre-runtimes) para o contrato completo.
:::

## Configuração

Habilite as funções personalizadas adicionando `functionsDir` à configuração do seu backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

O Rebase irá:

1. Varrer o diretório em busca de arquivos `.ts` / `.js`
2. Validar que cada exportação padrão é uma aplicação Hono (verificado por duck-typing com `.fetch()` + `.routes`)
3. Montar cada aplicação em `/api/functions/<filename>`
4. Aplicar o middleware de autenticação (veja [Autenticação](#autenticação-e-propagação-de-contexto) abaixo)

## Nomes de Arquivo e Mapeamento de Rotas

| Arquivo | Caminho de Montagem |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

As funções são descobertas **apenas no nível superior do diretório** — não há recursão. `functions/admin/users.ts` é compilado pelo `rebase build`, mas nunca montado; achate o nome (`functions/admin-users.ts`). Um subdiretório é reportado na inicialização e contabilizado no endpoint de listagem, em vez de ser ignorado em silêncio.

Arquivos que são **ignorados**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — arquivos de teste
- `*.d.ts` — declarações de tipos
- Subdiretórios e arquivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — reportados como problemas, já que a compilação abrange mais do que o runtime carrega

O nome também é a identidade da função em todos os outros lugares: é o segmento da URL, a permissão `functions/<name>` de uma chave de API e o valor que `REBASE_FUNCTIONS_ONLY` seleciona quando você dá a uma função seu próprio processo.

## Formatos de Exportação

Além de `defineFunction`, o carregador aceita dois formatos de exportação:

### Aplicação Hono

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Função Fábrica

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

`defineFunction` devolve exatamente a aplicação Hono que estas constroem à mão, então as três são intercambiáveis. Ela poupa-lhe declarar `Hono<HonoEnv>` e entrega-lhe o singleton `rebase` no callback.

---

## Nos Bastidores: O Carregador com Duck-Typing

Ao compilar bases de código com vários diretórios aninhados ou em monorepos, você pode encontrar **duplicação do pacote Hono**.

Se o framework Rebase depende de uma versão do Hono e o seu diretório local de funções resolve outra, as verificações clássicas de herança (`exported instanceof Hono`) falham, porque seus protótipos existem em espaços de memória distintos.

Para evitar falsos negativos e a rejeição de routers válidos, o Rebase usa um validador por duck-typing (`isHonoLike`):
- Verifica que o objeto exportado é um `object` não nulo.
- Verifica que o objeto expõe um método `.fetch` (necessário para rotear requisições).
- Verifica que `.routes` é um `array`.

```typescript no-verify
function isHonoLike(obj: unknown): boolean {
    if (!obj || typeof obj !== "object") return false;
    const record = obj as Record<string, unknown>;
    return typeof record.fetch === "function" && Array.isArray(record.routes);
}
```

### Escape do Compilador de Módulos ES

Para importar arquivos TypeScript e JavaScript dinamicamente tanto no Windows quanto em sistemas Posix, o carregador converte caminhos de arquivo em URIs de arquivo padrão via `pathToFileURL(filePath).href`.

Para impedir que a compilação TypeScript reescreva os imports dinâmicos ESM nativos (`import(url)`) como chamadas `require()` do CommonJS (o que lançaria erros em tempo de execução sob runtimes ESM), o Rebase executa um escape do compilador em tempo de execução:

```typescript no-verify
const dynamicImport = new Function("url", "return import(url)");
const mod = await dynamicImport(fileUrl);
```

---

## Autenticação e Propagação de Contexto

As funções personalizadas são montadas com o **mesmo middleware de autenticação** das rotas de dados, mas com `requireAuth: false`. Isso significa que:

- O JWT do usuário é **analisado e injetado** no contexto, se presente
- Mas as requisições **não são rejeitadas** se nenhum JWT for fornecido
- Você deve **proteger explicitamente** as rotas que exigem autenticação

Quem apresenta um token *inválido* nunca chega ao seu manipulador: um token não verificável ou expirado é rejeitado com 401 pelo próprio middleware, para que uma sessão expirada nunca seja silenciosamente rebaixada a anônima.

### Ler o chamador

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

`getUser` devolve um objeto restrito: `uid` é uma string e `roles` é sempre um array, seja qual for o método de autenticação usado pelo chamador. `getUserId(c)` e `getRoles(c)` são atalhos.

### Proteger Rotas

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

Coloque as proteções no **slot de middleware da própria rota**, como acima, em vez de `app.use("/*", requireAuth)`. `use()` cobre apenas as rotas declaradas *abaixo* dele, então uma rota acrescentada mais tarde — no fim do arquivo, daqui a alguns meses — fica silenciosamente desprotegida.

:::important
Ler `getUser(c)` **não** é uma proteção. Um chamador anônimo recebe `undefined` e o seu manipulador executa mesmo assim. Só uma proteção, ou um `if (!user) return 401` explícito, interrompe a requisição.
:::

### Autenticação por Chave de Serviço

O Rebase suporta uma `REBASE_SERVICE_KEY` estática definida no seu `.env` para scripts ou chamadas servidor a servidor.

Quando uma requisição externa passa a chave de serviço pelo cabeçalho Authorization (`Authorization: Bearer <service_key>`), o middleware de autenticação automaticamente:
1. Valida a chave com comparação em tempo constante, para prevenir ataques de temporização.
2. Concede acesso de nível administrador, definindo o chamador como `{ uid: "service", roles: ["admin"] }`.
3. Injeta um `DataDriver` restrito a essa mesma identidade de serviço. A Row-Level Security continua a aplicar-se — é avaliada como `{ uid: "service", roles: ["admin"] }`, não ignorada.

### Auto-Autenticação Interna

Se você não configurou uma `REBASE_SERVICE_KEY`, o Rebase gera uma **chave interna aleatória por inicialização**. O singleton `rebase` a usa automaticamente ao chamar as APIs do plano de controle do próprio servidor (como `rebase.auth` ou `rebase.storage`). A sua lógica do lado do servidor pode, portanto, sempre executar tarefas administrativas, mesmo sem uma chave de serviço configurada manualmente.

## Acessar o Banco de Dados e os Serviços

### 1. O driver restrito ao usuário — para tudo o que serve uma requisição

`getDriver(c)` devolve o driver **restrito ao chamador**, de modo que cada leitura e escrita é avaliada contra as suas políticas de Row-Level Security como aquele usuário:

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

`requireDriver(c)` é `getDriver(c)` sem o `!` — lança uma mensagem que nomeia o problema de montagem em vez de falhar vinte linhas depois em `undefined`.

### 2. `rebase.dataAsAdmin` — para trabalho de confiança em segundo plano

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

### Driver restrito por RLS vs. Singleton do Rebase

|                     | `getDriver(c)` (ligado à requisição)           | `rebase.dataAsAdmin` (identidade de serviço)                      |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Executa como**    | O chamador (`uid`, os seus papéis)             | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicação de RLS** | ✅ Sim (avaliada contra o chamador)           | ✅ Sim (avaliada contra a identidade de serviço)                  |
| **Ideal para...**   | CRUD de usuário, buscas e consultas             | Jobs em segundo plano, gatilhos de sistema, webhooks              |
| **Estilo de API**   | Métodos do driver (`fetchCollection`, `save`)   | Acessores fluentes de collection (`rebase.dataAsAdmin.jobs.find`) |

#### O que é `dataAsAdmin`, precisamente

`rebase.dataAsAdmin` é **restrito a administrador, não contorna a RLS**. O driver é restrito uma única vez, na inicialização, com `withAuth({ uid: "service", roles: ["admin"] })`, de modo que cada leitura e escrita ocorre dentro de uma transação que mudou para o papel restrito `rebase_user` com `app.uid = 'service'`. As suas políticas são avaliadas — contra essa identidade.

Para a maioria dos projetos a distinção nunca aparece, porque as políticas padrão que o Rebase injeta em cada collection admitem `serverContext() OR rolesOverlap(['admin'])`, e a identidade de serviço satisfaz o segundo ramo. Ela aparece no momento em que você escreve políticas próprias:

- **`policy.serverContext()` é falso para ele.** Esse auxiliar compila para `rebase.uid() IS NULL`, e o `uid` deste acessor é `'service'`. Uma collection com `disableDefaultPolicies: true` cuja única regra de escrita seja `serverContext()` recusará uma escrita de `dataAsAdmin` com o erro do Postgres `42501`, e uma leitura contra tal collection devolve **zero linhas com HTTP 200** — a direção silenciosa. Escreva `rolesOverlap(["admin"])` (ou acrescente-o ao lado) quando quiser dizer "o meu backend".
- **O seu alcance equivale ao de um usuário `admin`.** Conceder o papel `admin` a um usuário da aplicação concede-lhe exatamente as linhas que este acessor vê. Não é um canal privado.

### 3. `rebase.sql()` — SQL bruto, e o único acessor exclusivo do Node

Se você realmente precisa de um contorno incondicional, `rebase.sql()` é isso: SQL bruto na conexão do proprietário, sem políticas, todas as linhas. É a coisa mais privilegiada no contexto de uma função — mais do que o acessor que traz "admin" no nome.

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

Ele roda sobre uma conexão TCP ao seu banco de dados, o que o torna o único acessor atado a um processo Node. Isso não custa nada em nenhum deployment que exista hoje — é simplesmente a única coisa a saber caso uma função venha a mudar de casa mais tarde. Veja [Portabilidade entre runtimes](#portabilidade-entre-runtimes).

:::caution[O acesso direto ao Drizzle é exclusivo do Node]
Você também pode importar a sua própria instância do Drizzle e consultá-la diretamente (`db.execute(sql\`…\`)`). Funciona, e num deployment Node auto-hospedado ou gerenciado está tudo bem.

Vale saber o que custa: uma função que importa `drizzle-orm` e um pool `pg` é permanentemente uma função Node, contorna os callbacks e a validação da sua collection, e retira a conexão de outro lugar que não a requisição. `rebase.sql()` dá-lhe o mesmo SQL bruto através da conexão do próprio framework. Prefira-o.
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

Por que isso importa em **qualquer** runtime, Node incluído:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Uma leitura no escopo do módulo é avaliada quando o arquivo é importado, antes de existir qualquer requisição. No Node isso significa que uma única variável ausente derruba o arquivo inteiro e todas as suas rotas com ele. Num host que anexa a configuração à requisição em vez de ao processo, simplesmente não há nada a ler no momento do import.

- `getEnv(c)` — todas as variáveis visíveis para esta requisição
- `env(c, "NAME")` — uma variável, sem espaços sobrantes; vazia conta como não definida
- `requireEnv(c, "NAME")` — o mesmo, mas lança uma mensagem que nomeia a variável
- `lazyResource(factory)` — constrói um cliente caro uma única vez, no primeiro uso

`rebase doctor` reporta leituras de `process.env` no escopo do módulo no seu diretório de funções.

## Trabalho em Segundo Plano

O trabalho que deve sobreviver à resposta vai em `waitUntil`:

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

Uma promise sem `await` parece equivalente e não é. `waitUntil` traz duas coisas:

- **No Node**, a promise é rastreada, de modo que um desligamento gracioso a aguarda em vez de o processo sair por baixo de um webhook meio enviado. Uma promise solta no `SIGTERM` é simplesmente perdida.
- **Num host baseado em isolates**, o host é instruído a manter o isolate vivo até a promise se resolver. Sem isso, o trabalho é descartado no instante em que a resposta se resolve — em silêncio, com um 200 limpo nos logs.

Uma rejeição é registrada em vez de ser deixada ao manipulador de rejeições não tratadas, para que a falha nomeie a rota de onde veio.

## Portabilidade entre runtimes

Uma função personalizada é uma aplicação Hono, e o Hono roda em todos os runtimes de servidor JavaScript. Se *a sua* função poderia rodar em outro lugar que não um processo Node depende, portanto, inteiramente do que o próprio arquivo dela importa e toca.

Nada disso restringe o que você pode escrever hoje. Todo deployment do Rebase é um processo Node, uma função que lê um arquivo ou abre um socket é uma função perfeitamente válida, e nenhuma compilação ou deployment falha por causa disso. Está escrito para que a resposta seja conhecível agora, em vez de descoberta arquivo a arquivo mais tarde.

**Portátil — funciona em qualquer runtime:**

- Tudo o que `@rebasepro/server/functions` exporta
- `getDriver(c)` e `rebase.dataAsAdmin` — ambos passam pelo mesmo fio onde quer que rodem
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — a plataforma web
- Qualquer dependência que não precise de Node

**Exclusivo do Node:**

- `rebase.sql()` — a conexão do proprietário do banco de dados é um socket TCP
- Um cliente Drizzle/`pg`/`mongodb` importado diretamente, pela mesma razão
- Módulos embutidos do Node: `fs`, `path`, `crypto` (o módulo do Node — `globalThis.crypto` é portátil), `child_process`, …
- Pacotes construídos sobre eles: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Bugs latentes em qualquer runtime** — vale corrigir de qualquer forma:

- `process.env` lido no escopo do módulo (veja [Configuração e Segredos](#configuração-e-segredos))
- Promises soltas em vez de [`waitUntil`](#trabalho-em-segundo-plano)
- Contar com um manipulador que continue rodando depois de a sua requisição expirar. No Node ele continua; isso é uma propriedade do processo, não uma promessa do framework

### Verificar as suas próprias funções

`rebase build` imprime uma linha por achado acionável e registra o veredito por função no manifesto do bundle:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` reporta o mesmo sem compilar.

### Se precisar de um caminho específico do runtime

`runtimeKey()` devolve `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` ou `"other"`; `isNodeRuntime()` é a verificação habitual. Use-os para degradar, não para bifurcar uma implementação — uma função que precisa de duas implementações são duas funções.

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

As funções personalizadas são carregadas e montadas **depois** de `initializeRebaseBackend()` concluir a configuração central. A ordem de inicialização é:

1. **Bootstrappers** — conexões de banco de dados, tabelas de autenticação, serviços em tempo real
2. **Rotas de autenticação** — `/api/auth/*`, `/api/admin/*`
3. **Rotas de armazenamento** — `/api/storage/*`
4. **Rotas de dados** — `/api/data/*` (CRUD das collections)
5. **Funções personalizadas** ← `/api/functions/*`
6. **Jobs cron** — `/api/cron/*`
7. **WebSocket** — assinaturas em tempo real

As suas funções personalizadas têm, assim, acesso a todos os serviços inicializados. Registre quaisquer rotas que precisem rodar **antes** do Rebase diretamente na aplicação Hono, antes de chamar `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
As rotas que você adiciona dessa forma à sua própria aplicação ficam **fora** de todos os routers do Rebase: nenhum middleware de autenticação rodou sobre elas, e `getDriver(c)` não está definido. Proteja-as com `requireAuth` / `requireAdmin` importados de **`@rebasepro/server`** — a raiz do pacote — que verificam o token por si mesmos. As proteções do subcaminho `/functions` leem uma identidade que um router do Rebase já resolveu, e responderão 500 em vez de fingir que existe uma.
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

Quando uma função carrega com sucesso, você verá:

```
⚡ Loaded function route: hello
```

Se o carregamento falhar, o carregador fornece um diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
```

O router é montado para o **diretório**, não para as funções nele. Se todos os arquivos falharem ao importar — uma única variável de ambiente ausente no escopo do módulo basta para derrubar todos — `GET /api/functions` continua respondendo `200` com uma lista vazia mais uma contagem `skipped`, de modo que "nada carregou" permanece distinguível de "esta build não trazia funções". As razões ficam no log de inicialização.

## Tempos Limite e Limites de Taxa

Dois tetos se aplicam a `/api/functions/*`:

- **Tempo limite da requisição** — 30 segundos por padrão, respondendo `504` com o código `FUNCTION_TIMEOUT`. Configure com `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` o desativa. O manipulador não pode ser cancelado de fora, então dê um `AbortSignal` às chamadas HTTP de saída — o tempo limite libera o cliente e o socket, não o trabalho. Que o manipulador *continue rodando* após o 504 é uma propriedade de um processo Node de vida longa, não uma garantia do contrato; tudo o que precisa ser concluído pertence a [`waitUntil`](#trabalho-em-segundo-plano).
- **Limite de taxa** — chamadores com chave de API e chamadores autenticados compartilham os buckets da API de dados. Chamadores anônimos têm a sua própria cota, bem mais folgada (3000 por janela), porque este router é público por padrão para receptores de webhooks. Sobrescreva com `rateLimit.anonymousFunctions`; `null` o desliga.

Rejeições de promise não tratadas são registradas em vez de fatais: uma chamada fire-and-forget numa função encerraria, de outro modo, o processo inteiro. Defina `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para o comportamento padrão do Node.

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Callbacks de Entidade](/docs/collections/callbacks)** — Executar lógica em mudanças de dados
- **[Jobs Cron](/docs/backend/cron-jobs)** — Tarefas agendadas em segundo plano
