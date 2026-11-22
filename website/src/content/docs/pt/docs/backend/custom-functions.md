---
sourceHash: adb0c8f318e1c09a
title: Funções Personalizadas
sidebar_label: Funções Personalizadas
description: Adicione endpoints de API Hono personalizados junto às suas rotas CRUD do Rebase. Descoberta automática a partir de um diretório, com acesso total à instância do backend.
---

## Visão Geral

Funções personalizadas permitem adicionar **rotas de API Hono arbitrárias** junto aos endpoints CRUD gerados automaticamente pelo Rebase. Elas seguem o mesmo padrão de **descoberta baseada em arquivos** dos cron jobs: basta colocar um arquivo TypeScript no seu diretório `functions/` e o Rebase o monta automaticamente.

Use funções personalizadas para:

- **Endpoints de lógica de negócios** — aprovações, promoções, fluxos de trabalho personalizados
- **Integrações de terceiros** — webhooks do Stripe, comandos do Slack, proxies de APIs externas
- **Endpoints públicos** — formulários de contato, captura de leads, health checks
- **Consultas agregadas** — estatísticas de dashboard, relatórios, analytics

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

`POST`, porque é isso que o SDK envia por padrão — veja [Invocar a partir do cliente](#invocar-a-partir-do-cliente). Uma rota `GET` é igualmente válida; o chamador então deve informar `{ method: "GET" }`.

O `rebase dev` observa o diretório de funções, portanto um arquivo adicionado enquanto ele está
em execução é montado no próximo recarregamento — sem necessidade de reiniciar. (Ele precisa ser informado: o
diretório é verificado em vez de importado, de modo que o observador não pode inferi-lo.)

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
`RebaseApiError` em caso de resposta não-2xx — para que o próprio formato de erro da função chegue ao
chamador em vez de uma rejeição pura do `fetch`.

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
`client.call("functions/hello", payload)` também acessa uma função. Ele sempre
faz `POST` e, assim como o `invoke`, retorna o corpo textualmente — nenhum dos dois busca por
uma chave `data`. Prefira `functions.invoke`, que aceita um método, um subcaminho e um
`responseType`; o `call` existe para rotas montadas fora de `/api/functions`, o que
o `invoke` não consegue expressar.
:::

:::important
Importe de **`@rebasepro/server/functions`**, não de `@rebasepro/server`.

Ambos funcionam. O subcaminho é a superfície de autoria *portável*: ele não importa nada que exija Node, portanto uma função escrita com base nele pode rodar em qualquer runtime JavaScript. A raiz do pacote alcança todo o framework — a sequência de inicialização, os carregadores de arquivos, a camada WebSocket — o que é adequado para o ponto de entrada de um servidor e mais do que um manipulador de rotas precisa. Ele também fornece acessadores de contexto tipados (`getUser`, `getDriver`) em vez de fazer o casting de `c.get("user")` manualmente.

Veja [Portabilidade de runtime](#portabilidade-de-runtime) para o contrato completo.
:::

## Configuração

:::note[Onde isso fica]
**Runtime gerenciado:** nada a configurar — o runtime descobre `backend/functions/` por conta própria (`functions` na entrada do app backend no `rebase.json` se você o moveu). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringem quais funções um processo `REBASE_ROLE=functions` atende; qualquer outra role se recusa a inicializar com essas variáveis definidas.
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

1. Varrer o diretório em busca de arquivos `.ts` / `.js`
2. Validar se cada exportação padrão é uma aplicação Hono (com tipagem estrutural via `.fetch()` + `.routes`)
3. Montar cada aplicação em `/api/functions/<filename>`
4. Aplicar o middleware de autenticação (veja [Autenticação](#autenticação-e-propagação-de-contexto) abaixo)

### Funções como valores

Um diretório é uma forma de produzir o que o servidor disponibiliza: um registro (record) do segmento de URL para a aplicação Hono. Passe você mesmo esse registro como `functions`, ou leia um diretório para dentro dele com `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Informe `functions` ou `functionsDir`, não ambos: a inicialização recusa o par. `loadFunctions(dir, { onSkip })` entrega cada arquivo que foi ignorado, com o motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` ainda funcionam, estão obsoletos (deprecated) e exibem um aviso uma única vez. Por si só, o grupo de funções pode ser montado em qualquer caminho com `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funcionam dentro dele; veja [Integração com Servidor Personalizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nomenclatura de Arquivos e Mapeamento de Rotas

| Arquivo | Caminho de Montagem |
|---------|---------------------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

As funções são descobertas **apenas no nível superior do diretório** — não há recursão. `functions/admin/users.ts` é compilado por `rebase build`, mas nunca montado; nivele o nome em vez disso (`functions/admin-users.ts`). Um subdiretório é reportado na inicialização e contabilizado no endpoint de listagem, em vez de ser ignorado silenciosamente.

Arquivos que são **ignorados**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — arquivos de teste
- `*.d.ts` — declarações de tipos
- Subdiretórios e arquivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — reportados como problemas, já que a compilação compila mais do que o runtime carrega

O nome é a identidade da função em todos os outros lugares também: é o segmento da URL, o alvo do escopo `functions:invoke:<name>` que uma chave precisa para chamá-la e o valor pelo qual `REBASE_FUNCTIONS_ONLY` seleciona quando você atribui a uma função seu próprio processo.

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

O `defineFunction` retorna exatamente a aplicação Hono que essas opções constroem manualmente, portanto os três são intercambiáveis. Ele evita que você declare `Hono<HonoEnv>` e disponibiliza o singleton `rebase` no callback.

---

## Por Baixo dos Panos: O Carregador Duck-Typing

Em um monorepo, suas funções podem resolver uma cópia diferente do Hono daquela utilizada pelo Rebase, e então `exported instanceof Hono` resulta em falso para um roteador perfeitamente funcional. Por isso, o carregador verifica a estrutura (`isHonoLike`): um objeto não nulo com um método `.fetch` e um array `.routes`.

### Escape do Compilador para Módulos ES

O carregador transforma cada caminho de arquivo em uma URL de arquivo (`pathToFileURL(filePath).href`) para que ele seja importado tanto no Windows quanto em POSIX, e chama `import(url)` por meio de `new Function("url", "return import(url)")`, evitando que o build do TypeScript o reescreva em um `require()` que falharia em ESM.

---

## Autenticação e Propagação de Contexto

Funções personalizadas são montadas com o **mesmo middleware de autenticação** que as rotas de dados, mas com `requireAuth: false`. Isso significa que:

- O JWT do usuário é **analisado e injetado** no contexto se estiver presente
- Mas as requisições **não são rejeitadas** caso nenhum JWT seja fornecido
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

`getUser` retorna um objeto restrito: `uid` é uma string e `roles` é sempre um array, independentemente do método de autenticação utilizado pelo chamador. `getUserId(c)` e `getRoles(c)` são atalhos. `getScopes(c)` é tudo o que o chamador pode fazer, na forma de strings de [escopo](/docs/backend/roles-and-scopes/): para uma pessoa, o plano de dados, os escopos do próprio app e os escopos das suas roles; para uma chave de API, exatamente o que a chave contém.

### A conta do chamador

`getUser(c)` lê o token de acesso, e o token contém o ID, as roles e o endereço do chamador. Ele não informa como a conta faz login ou qual é o seu nome de exibição. `getUserProfile(c)` lê essas informações do armazenamento de autenticação:

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

`providers` lista como a conta pode fazer login: `"password"` quando ela possui uma senha, seguido por cada provedor vinculado (`"google"`, `"apple"`, …) na ordem em que foi vinculado. Uma conta de convidado, ou uma que faz login apenas com um código de uso único, tem uma lista vazia.

A leitura é recente para cada requisição: um provedor que o chamador vinculou há pouco tempo é exibido na sua próxima requisição, sem esperar que o token seja atualizado. A primeira chamada em uma requisição custa duas buscas por chave, feitas juntas. Chamadas posteriores na mesma requisição reutilizam o resultado, e uma requisição que nunca o chama não tem custo algum.

Ele retorna `undefined` para um chamador anônimo, para um chamador via chave de serviço ou chave de API que não atua como conta alguma, e para uma conta que não existe mais. Ele também retorna `undefined` em um backend cujas contas residem em um [adaptador de autenticação](/docs/backend/auth-adapters/) externo: consulte esse provedor em vez disso. Quando um administrador envia `x-rebase-impersonate`, ele retorna a conta personificada.

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

Coloque os guards no **próprio slot de middleware da rota**, como mostrado acima, em vez de `app.use("/*", requireAuth)`. `use()` cobre apenas as rotas declaradas *abaixo* dele, de modo que uma rota adicionada posteriormente — no final do arquivo, meses depois — ficaria desprotegida silenciosamente.

:::important
Ler `getUser(c)` **não** é um guard. Um chamador anônimo recebe `undefined` e o seu manipulador é executado mesmo assim. Apenas um guard, ou um `if (!user) return 401` explícito, interrompe a requisição.
:::

### Escopos e escopos de aplicação

`requireAdmin` admite a role `admin` e ninguém mais. Para uma ação que uma role mais restrita ou uma chave de API deva alcançar, proteja a rota com `requireScope`. Ele aceita um [escopo](/docs/backend/roles-and-scopes/) integrado ou um que a aplicação declare sob `auth.scopes` na coleção de usuários, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Toda pessoa autenticada possui todos os escopos da aplicação, portanto, para uma pessoa, `requireScope` não decide nada: verifique no manipulador se essa pessoa pode fazer deploy deste projeto. O que o escopo adiciona é uma forma de **restringir uma chave**: uma chave que contém `project:deploy:p1` passa apenas para `p1`. Uma chave também precisa de `functions:invoke`, ou `functions:invoke:<name>`, antes mesmo de chegar à função. Veja [Escopos da aplicação](/docs/backend/roles-and-scopes/#app-scopes).

### Limites de taxa (Rate limits)

Uma rota que possui um custo computacional ou financeiro por chamada aceita o middleware `rateLimit`, que contabiliza entre as réplicas. Veja [Limites de taxa em funções](/docs/backend/function-rate-limits/).

### Autenticação por Chave de Serviço

O Rebase suporta uma `REBASE_SERVICE_KEY` estática definida no seu `.env` para chamadas de scripts ou de servidor para servidor.

Quando uma requisição externa passa a chave de serviço por meio do cabeçalho de autorização (`Authorization: Bearer <service_key>`), o middleware de autenticação automaticamente:
1. Valida a chave usando comparação em tempo constante para evitar ataques de temporização (timing attacks).
2. Concede acesso de nível de administrador, definindo o chamador como `{ uid: "service", roles: ["admin"] }`.
3. Injeta um `DataDriver` com o escopo dessa mesma identidade de serviço. A Segurança em Nível de Linha (Row-Level Security - RLS) ainda se aplica — ela é avaliada como `{ uid: "service", roles: ["admin"] }`, e não ignorada.

### Autoautenticação Interna

Se você não configurou uma `REBASE_SERVICE_KEY`, o Rebase gera uma **chave interna por inicialização** aleatória. O singleton `rebase` usa essa chave automaticamente ao chamar as APIs do plano de controle do próprio servidor (como `rebase.auth` ou `rebase.storage`). Isso significa que sua lógica no lado do servidor pode sempre executar tarefas administrativas, mesmo sem uma chave de serviço configurada manualmente.

## Acessando o Banco de Dados e Serviços

### 1. O driver com escopo de usuário — para tudo que atende a uma requisição

`getDriver(c)` retorna o driver **com escopo do chamador**, de modo que cada leitura e escrita é avaliada em relação às suas políticas de Segurança em Nível de Linha (Row-Level Security) como aquele usuário:

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

`requireDriver(c)` é o `getDriver(c)` sem o `!` — ele lança uma mensagem nomeando o problema de configuração em vez de falhar vinte linhas depois com `undefined`.

`fetchCollection` e `fetchOne` retornam as linhas que `GET /api/data/<table>` retorna: datas como strings RFC 3339, um `belongsTo` como sua chave estrangeira (`authorId`), e uma linha relacionada apenas quando `include` a especifica — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

### 2. `rebase.dataAsAdmin` — para tarefas em segundo plano confiáveis

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

### Driver com Escopo de RLS vs. Singleton do Rebase

|                     | `getDriver(c)` (escopo da requisição)          | `rebase.dataAsAdmin` (identidade de serviço)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Executa como**    | O chamador (`uid`, suas roles)                 | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicação de RLS**| ✅ Sim (avaliada em relação ao chamador)       | ✅ Sim (avaliada em relação à identidade de serviço)             |
| **Ideal para...**   | CRUD geral de usuários, busca e consultas      | Tarefas em segundo plano, gatilhos de sistema, webhooks          |
| **Estilo da API**   | Métodos a nível de driver (`fetchCollection`, `save`) | Acessadores de tabela fluentes (`rebase.dataAsAdmin.jobs.find`) |

#### O que `dataAsAdmin` é, precisamente

`rebase.dataAsAdmin` tem **escopo de admin, não ignora o RLS**. O driver é delimitado uma vez, na inicialização, com `withAuth({ uid: "service", roles: ["admin"] })`, de modo que cada leitura e escrita é executada dentro de uma transação que mudou para a role restrita `rebase_user` com `app.uid = 'service'`. Suas políticas são avaliadas — em relação a essa identidade.

Para a maioria dos projetos a distinção nunca vem à tona, porque as políticas padrão que o Rebase injeta em cada tabela admitem `serverContext() OR rolesOverlap(['admin'])`, e a identidade de serviço satisfaz o segundo braço da condição. Ela surge no momento em que você escreve suas próprias políticas:

- **`policy.serverContext()` é falso para ele.** Esse auxiliar compila para `rebase.uid() IS NULL`, e o `uid` desse acessador é `'service'`. Uma tabela com `defaultPolicies: false` cuja única regra de escrita seja `serverContext()` recusará uma escrita de `dataAsAdmin` com o erro do Postgres `42501`, e uma leitura nessa tabela retornará **zero linhas com HTTP 200** — o caminho silencioso. Escreva `rolesOverlap(["admin"])` (ou adicione-o em conjunto) quando quiser se referir a "meu backend".
- **O seu alcance é igual ao alcance de um usuário `admin`.** Conceder a role `admin` a um usuário da aplicação concede a ele exatamente as linhas que esse acessador vê. Não é um canal privado.

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
Os valores são os do Postgres, com dois formatados como `/api/data` os formata: um `timestamptz` é RFC 3339 em UTC (`2026-11-18T10:52:23.500Z`), e um `bigint` é um número quando cabe em um inteiro seguro (acima de 2^53 permanece como dígitos, em formato de string). Um `numeric` é uma string, para que nenhum dígito seja perdido; converta-o na consulta (`total::float8`) quando o que você deseja for um número.

A instrução é executada na própria transação do chamador, como a role restrita `rebase_user` com a identidade dele — a transação que o driver com escopo de usuário abre — de modo que as regras de `rls` das suas tabelas decidem cada linha, exatamente como fazem para o SDK. Uma consulta que solicita todas as linhas obtém as do chamador.

- **Somente leitura por padrão.** Passe `{ write: true }` para inserir, atualizar ou excluir; as políticas de inserção e atualização ainda se aplicam.
- **O texto da consulta é seu; os valores vão em `params`** (`$1`, `$2`, …). A identidade do chamador reside nas configurações de transação, que o SQL pode alterar; portanto, uma instrução que poderia fazê-lo — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, mais de uma instrução — é recusada com `400 SQL_NOT_ALLOWED` antes de ser executada. Interpolar entradas do usuário no texto é como essa proteção seria testada; não faça isso.
- **O que ele compartilha com o SDK.** As políticas e três regras que o Postgres mantém para ambos: uma [view materializada](/docs/collections/views/#materialized-views) serve suas linhas apenas para suas `roles`, uma linha de uma tabela que declara `tenant` não pode ser movida para outro tenant, exceto por um chamador com `bypassRoles` (`TENANT_IMMUTABLE`), e as próprias funções do servidor (`rebase.record_history`, `rebase.enqueue_job`) são recusadas. Uma coluna que o chamador não pode ler — `.private()` ou um `.access({ read })` do qual ele não dispõe — é removida das linhas, assim como a API a remove, quando for uma referência simples à coluna (`SELECT *`, `password_hash AS h`); um valor *computado* a partir dela (`md5(password_hash)`) não é reconhecido, portanto não faça computações a partir dele.
- **O que ele não compartilha.** `beforeQuery` e `afterRead`, validação, hooks de salvamento e histórico residem no Node e não são executados.

A partir de um script, [`openRebase`](/docs/backend/embedding-postgres-driver/) oferece o mesmo: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL como a identidade de serviço

Uma função que aplica suas próprias regras (um tíquete por dia, uma verificação de tempo) sobre tabelas que apenas administradores podem ler não pode usar `getSql(c)`: o chamador precisaria de políticas que o admitissem, e essas mesmas políticas abririam as tabelas na API pública de dados também. `rebase.sqlAsAdmin` executa a instrução como `{ uid: "service", roles: ["admin"] }`, a identidade que `rebase.dataAsAdmin` usa, sob a mesma segurança em nível de linha:

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

Trata-se de `getSql(c)` com uma identidade diferente: a role de requisição restrita, o braço admin de suas políticas, somente leitura a menos que `{ write: true }`, e a mesma proteção `SQL_NOT_ALLOWED`. Diferente de `rebase.sql()` do proprietário (owner), ele não pode executar DDL e, do armazenamento de autenticação, alcança apenas o que um administrador alcança por meio da coleção de usuários: sessões, chaves e segredos de MFA são retidos da role de requisição, e o hash de senha é removido das linhas. Uma instrução individual custa um round trip, assim como `rebase.sql()`. A partir de um script, `openRebase()` também conta com isso.

### 4. `rebase.sql()` — SQL de proprietário (owner) e o único acessador exclusivo para Node

Se você realmente precisa de um bypass incondicional, `rebase.sql()` é a solução: SQL puro na conexão do proprietário (owner), sem políticas, em todas as linhas. É a coisa mais privilegiada no contexto de uma função — mais ainda do que o acessador com "admin" em seu nome.

Ele não serve para criar tabelas. Uma tabela é [declarada](/docs/schema/) com `defineTable` em `backend/schema/` e criada na inicialização; uma tabela criada com `CREATE TABLE` em uma função não possui validação, hooks, postura de segurança em nível de linha, visualização de admin ou tipo no SDK. O `rebase.sql()` executa essa instrução e registra um aviso informando a tabela que deveria ser declarada em seu lugar.

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

Ele é executado em uma conexão TCP com seu banco de dados, o que o torna o único acessador atrelado a um processo Node. Isso não tem custo algum em qualquer implantação existente hoje — é simplesmente a única coisa que você deve saber se uma função puder vir a ser migrada posteriormente. Veja [Portabilidade de runtime](#portabilidade-de-runtime).

:::caution[O acesso direto ao Drizzle é exclusivo para Node]
Você também pode importar sua própria instância do Drizzle e consultá-la diretamente (`db.execute(sql\`…\`)`). Funciona e, em uma implantação Node auto-hospedada ou gerenciada, não há problema.

Vale a pena saber o que isso custa: uma função que importa `drizzle-orm` e um pool do `pg` torna-se permanentemente uma função Node, ignora os hooks de tabela executados por `rebase.data` (nenhum dos dois verifica `.validate()`, que se aplica a [requisições de API](/docs/collections/validation-and-conditions/#where-validation-runs)) e obtém sua conexão de outro lugar que não a requisição. O `rebase.sql()` oferece o mesmo SQL puro através da conexão do próprio framework, e `getSql(c)` o disponibiliza sob as políticas do chamador. Prefira estes.
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

Uma leitura no escopo do módulo é avaliada quando o arquivo é importado, antes que qualquer requisição exista. No Node, isso significa que uma única variável ausente derruba o arquivo inteiro e todas as rotas contidas nele. Em um host que anexa a configuração à requisição em vez de ao processo, não há absolutamente nada para ler no momento da importação.

- `getEnv(c)` — todas as variáveis visíveis para esta requisição
- `env(c, "NAME")` — uma variável, com espaços removidos (trimmed); em branco conta como não definida
- `requireEnv(c, "NAME")` — o mesmo, mas lança uma mensagem com o nome da variável
- `lazyResource(factory)` — instancia um cliente pesado apenas uma vez, no primeiro uso

O `rebase doctor` relata leituras de `process.env` em escopo de módulo no seu diretório de funções.

## Tarefas em Segundo Plano

Movido para uma página própria: [Tarefas em Segundo Plano](/docs/backend/background-work/).

## Portabilidade de runtime

Uma função personalizada é uma aplicação Hono, de modo que a possibilidade de executá-la fora de um processo Node depende do que o próprio arquivo importa. O `rebase.sql()`, um cliente de banco de dados importado diretamente e os módulos integrados do Node o vinculam ao Node; o restante do `rebase` e a plataforma web não fazem isso, e nada falha hoje por causa de nenhum deles. [Portabilidade de runtime](/docs/backend/runtime-portability/) lista o que é portável, como `rebase build` e `rebase doctor` relatam isso e como alternar a lógica dependendo do runtime.

## Ordem de Registro de Rotas

Funções personalizadas são carregadas e montadas **depois** que `initializeRebaseBackend()` conclui a configuração principal. A ordem de inicialização é:

1. **Bootstrappers** — Conexões de banco de dados, tabelas de autenticação, serviços de tempo real
2. **Rotas de autenticação** — `/api/auth/*`, `/api/admin/*`
3. **Rotas de armazenamento (storage)** — `/api/storage/*`
4. **Rotas de dados** — `/api/data/*` (CRUD para tabelas)
5. **Funções personalizadas** ← `/api/functions/*`
6. **Cron jobs** — `/api/admin/cron/*`
7. **WebSocket** — Inscrições em tempo real

Isso significa que suas funções personalizadas têm acesso a todos os serviços inicializados. Registre quaisquer rotas que precisem ser executadas **antes** do Rebase diretamente na aplicação Hono, antes de chamar `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Rotas que você adiciona ao seu próprio app dessa forma estão **fora** de qualquer roteador do Rebase, portanto nenhum middleware de autenticação foi executado nelas e `getDriver(c)` não estará definido. Proteja essas rotas com `requireAuth` / `requireAdmin` importados de **`@rebasepro/server`** — a raiz do pacote — que verificam o token por conta própria. Os guards no subcaminho `/functions` leem uma identidade que um roteador do Rebase já resolveu e responderão com 500 em vez de fingir que uma existe.
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

Quando as funções carregam, a inicialização registra nos logs `Loaded custom functions` com a contagem delas. A linha de cada função é registrada em nível `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Se o carregamento falhar, o carregador fornecerá uma saída de diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

O roteador é montado para o **diretório**, não para as funções nele contidas. Se a importação de todos os arquivos falhar — uma única variável de ambiente ausente no escopo do módulo é suficiente para derrubar todos eles —, `GET /api/functions` ainda responderá `200` com uma lista vazia mais a contagem de `skipped`, de forma que "nada carregado" seja distinguível de "esta compilação não incluiu funções". A listagem em si requer um chamador autenticado, uma chave de API que contenha o escopo simples `functions:invoke` ou a chave de serviço — as funções continuam acessíveis por quem cada uma admite, mas o inventário delas não é público. Os motivos permanecem no log de inicialização.

## Limites de Tempo (Timeouts) e Taxa (Rate Limits)

Dois limites se aplicam a `/api/functions/*`:

- **Timeout de requisição** — 30 segundos por padrão, respondendo `504` com o código `FUNCTION_TIMEOUT`. Configure-o para todas as funções com `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` o desativa. Uma função que aguarda um serviço lento, como um LLM, declara seu próprio timeout no segundo argumento de `defineFunction`: `defineFunction((app) => { … }, { timeoutMs: 150_000 })`. Ele substitui o timeout global do servidor apenas para essa função, seja ele maior ou menor, conta a partir do momento em que a requisição atingiu o roteador de funções e se aplica mesmo onde o global for `0`; o servidor o limita a `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` (300000, 5 minutos, por padrão), e ele não pode ser `0`. A mensagem do 504 informa qual limite foi aplicado e onde foi definido, e `error.details` o traz como `{ timeoutMs, source }` (`source` é `default`, `env`, `option` ou `function`). O manipulador não pode ser interrompido externamente, mas ele é notificado: `getSignal(c)` de `@rebasepro/server/functions` é abortado no momento do 504, portanto repasse-o para o `fetch` e para qualquer outra coisa que aceite um signal (`fetch(url, { signal: getSignal(c) })`). Trabalhos para os quais o signal não foi repassado continuam em execução — o timeout libera o cliente e o socket, não o processamento. O fato de o manipulador *continuar em execução* após o 504 é uma característica de um processo Node de longa duração, não uma garantia do contrato; qualquer coisa que precise ser concluída pertence ao [`waitUntil`](#tarefas-em-segundo-plano).
- **Limite de taxa (Rate limit)** — Chamadores autenticados e com chave de API compartilham os limites da API de dados. Chamadores anônimos recebem sua própria cota, muito mais permissiva (3000 por janela), pois esse roteador é público por padrão para receptores de webhooks. Sobrescreva com `rateLimit.anonymousFunctions`; `null` o desativa.

Rejeições de promessas não tratadas são registradas em log em vez de serem fatais: de outro modo, uma chamada fire-and-forget em uma função derrubaria o processo inteiro. Defina `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para o comportamento padrão do Node.

No Rebase Cloud, o edge à frente das suas funções tem seus próprios limites, e o
estado em nível de módulo, o sistema de arquivos e as portas de saída se comportam de maneiras que
vale a pena conhecer antes de projetar sua arquitetura. Veja
[Runtime de backend gerenciado](/docs/deployment/managed-runtime/).

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Hooks de tabela](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tarefas em segundo plano agendadas
