---
title: Funções Personalizadas
sidebar_label: Funções Personalizadas
description: Adicione endpoints de API Hono personalizados ao lado das suas rotas CRUD do Rebase. Descobertos automaticamente a partir de um diretório, com acesso total à instância de backend.
---

## Visão Geral

As funções personalizadas permitem adicionar **rotas de API Hono arbitrárias** ao lado dos endpoints CRUD auto-gerados do Rebase. Elas seguem o mesmo padrão de **descoberta baseada em arquivos** que as coleções e cron jobs: coloque um arquivo TypeScript no seu diretório `functions/`, e o Rebase o montará automaticamente.

Use funções personalizadas para:

- **Endpoints de lógica de negócios** — aprovações, promoções, fluxos de trabalho personalizados
- **Integrações de terceiros** — webhooks do Stripe, comandos do Slack, proxies de API externos
- **Endpoints públicos** — formulários de contato, captura de leads, verificações de saúde
- **Consultas agregadas** — estatísticas de dashboard, relatórios, análises

## Definindo uma Função Personalizada

Crie um arquivo no seu diretório `backend/functions/` que exporte por padrão um aplicativo Hono:

```typescript
// backend/functions/hello.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.get("/", (c) => {
    return c.json({ message: "Hello from custom function!" });
});

export default app;
```

Isso é montado em **`/api/functions/hello`**. O nome do arquivo (sem extensão) se torna o prefixo da rota.

## Configuração

Habilite as funções personalizadas adicionando `functionsDir` à sua configuração de backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

O Rebase irá:

1. Escanear o diretório em busca de arquivos `.ts` / `.js`
2. Validar que cada exportação padrão é um aplicativo Hono (duck-typed via `.fetch()` + `.routes`)
3. Montar cada aplicativo em `/api/functions/<filename>`
4. Aplicar o middleware de autenticação (veja [Autenticação](#authentication) abaixo)

## Nomenclatura de Arquivos e Mapeamento de Rotas

| Arquivo | Caminho de Montagem |
|------|-----------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

Arquivos que são **ignorados**:

- `index.ts` / `index.js` — reservado
- `*.test.ts` / `*.test.js` — arquivos de teste
- `*.d.ts` — declarações de tipo

## Formatos de Exportação

O carregador aceita dois formatos de exportação:

### Aplicativo Hono (recomendado)

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
const app = new Hono<HonoEnv>();
app.get("/status", (c) => c.json({ ok: true }));
export default app;
```

### Função de Fábrica

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

Ambos são detectados via duck-typing — o carregador verifica as propriedades `.fetch()` e `.routes`, então qualquer instância compatível com Hono funcionará independentemente da versão do Hono instalada.

## Autenticação

As funções personalizadas são montadas com o **mesmo middleware de autenticação** que as rotas de dados, mas com `requireAuth: false`. Isso significa:

- O JWT do usuário é **analisado e injetado** no contexto, se presente
- Mas as solicitações **não são rejeitadas** se nenhum JWT for fornecido
- Você deve **proteger explicitamente** as rotas que precisam de autenticação

### Protegendo Rotas

Use os auxiliares de autenticação incorporados do Rebase:

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

// Public endpoint — no auth required
app.get("/public", (c) => {
    return c.json({ message: "Anyone can access this" });
});

// Protected endpoint — requires a valid JWT
app.post("/protected", async (c) => {
    // Narrowed: the env types every variable the middleware may set.
    const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
    if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
    }
    return c.json({ message: `Hello, ${user.uid}` });
});

// Admin-only endpoint
app.post("/admin-only", async (c) => {
    const user = c.get("user") as { uid: string; roles?: string[] } | undefined;
    const roles: string[] = user?.roles ?? [];
    if (!roles.includes("admin")) {
        return c.json({ error: "Admin access required" }, 403);
    }
    return c.json({ message: "Admin operation succeeded" });
});

export default app;
```

:::important
O middleware JWT do Rebase é limitado às rotas de API incorporadas (`/api/data`, `/api/auth`, etc.). As rotas de função personalizadas recebem o **contexto do usuário analisado**, mas você deve impor o controle de acesso por conta própria.
:::

## Acessando o Banco de Dados

As funções personalizadas são executadas junto com o Rebase, então você pode acessar o banco de dados através de duas abordagens:

### 1. Via o Singleton do Rebase (Recomendado)

O pacote `@rebasepro/server` fornece um singleton `rebase` que lhe dá acesso de nível administrativo a todos os serviços com escopo de aplicativo (dados, autenticação, armazenamento, e-mail) de qualquer lugar do seu backend.

```typescript
// backend/functions/approve-job.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { rebase } from "@rebasepro/server";

const app = new Hono<HonoEnv>();

app.post("/:id/approve", async (c) => {
    const id = c.req.param("id");

    // Use the admin-level data API (bypasses RLS)
    await rebase.data.saveEntity("jobs", {
        id,
        status: "published",
        approved_at: new Date().toISOString(),
    });

    return c.json({ success: true });
});

export default app;
```

### 2. Via Acesso Direto ao Drizzle

```typescript
// backend/functions/reports.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import { db } from "../src/db"; // Your Drizzle instance
import { sql } from "drizzle-orm";

const app = new Hono<HonoEnv>();

app.get("/stats", async (c) => {
    const result = await db.execute(sql`
        SELECT COUNT(*) as total FROM jobs WHERE status = 'published'
    `);
    return c.json({ totalJobs: result.rows[0]?.total });
});

export default app;
```

:::tip
A instância `db` do Drizzle usada pelo Rebase é a mesma que você passa para `createPostgresBootstrapper`. Você pode compartilhá-la livremente entre funções personalizadas e o Rebase.
:::

## Ordem de Registro de Rotas

As funções personalizadas são carregadas e montadas **após** `initializeRebaseBackend()` concluir a configuração principal. A ordem de inicialização é:

1. **Bootstrappers** — Conexões de banco de dados, tabelas de autenticação, serviços em tempo real
2. **Rotas de autenticação** — `/api/auth/*`, `/api/admin/*`
3. **Rotas de armazenamento** — `/api/storage/*`
4. **Rotas de dados** — `/api/data/*` (CRUD para coleções)
5. **Funções personalizadas** ← `/api/functions/*`
6. **Cron jobs** — `/api/cron/*`
7. **WebSocket** — Assinaturas em tempo real

Isso significa que suas funções personalizadas têm acesso a todos os serviços inicializados. Registre quaisquer rotas que precisem ser executadas **antes** do Rebase diretamente no aplicativo Hono, antes de chamar `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

## Exemplo: Manipulador de Webhook

```typescript
// backend/functions/stripe-webhook.ts
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server";
import Stripe from "stripe";
import { instance } from "../src/index";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
const app = new Hono<HonoEnv>();

app.post("/", async (c) => {
    const sig = c.req.header("stripe-signature")!;
    const body = await c.req.text();

    const event = stripe.webhooks.constructEvent(
        body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET!
    );

    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        await instance.driver.data.subscriptions.create({
            userId: session.client_reference_id,
            stripe_id: session.subscription,
            status: "active",
        });
    }

    return c.json({ received: true });
});

export default app;
```

## Depuração

Quando uma função é carregada com sucesso, você verá:

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

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa da configuração do backend
- **[Callbacks de Entidade](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tarefas em segundo plano agendadas
---
