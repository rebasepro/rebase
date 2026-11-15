---
sourceHash: 18de9bd3e1179740
title: Funções Personalizadas
sidebar_label: Funções Personalizadas
description: Adicione endpoints de API Hono personalizados junto com suas rotas CRUD do Rebase. Descobertos automaticamente a partir de um diretório, com acesso total à instância do backend.
---

## Visão Geral

As funções personalizadas permitem adicionar **rotas de API Hono arbitrárias** junto aos endpoints CRUD gerados automaticamente pelo Rebase. Elas seguem o mesmo padrão de **descoberta baseada em arquivos** que os cron jobs: coloque um arquivo TypeScript no seu diretório `functions/`, e o Rebase o montará automaticamente.

Use funções personalizadas para:

- **Endpoints de lógica de negócios** — aprovações, promoções, fluxos de trabalho personalizados
- **Integrações de terceiros** — webhooks da Stripe, comandos do Slack, proxies de APIs externas
- **Endpoints públicos** — formulários de contato, captura de leads, health checks
- **Consultas de agregação** — estatísticas de dashboard, relatórios, analytics

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

`POST`, porque é isso que o SDK envia por padrão — veja [Invocar a partir do cliente](#invocar-a-partir-do-cliente). Uma rota `GET` é igualmente válida; o chamador precisará então especificar `{ method: "GET" }`.

O `rebase dev` observa o diretório de funções, de modo que um arquivo adicionado enquanto ele estiver em execução é montado no próximo recarregamento — sem necessidade de reiniciar. (Ele precisa ser notificado: o diretório é escaneado em vez de importado, portanto o observador não pode deduzi-lo.)

## Invocar a partir do cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // the filename, without extension — one path segment
    { name: "Ada" }          // JSON body; omitted for a GET
);
```

O `invoke` monta a URL, anexa o token do chamador e lança um `RebaseApiError` em respostas que não sejam 2xx — assim, o formato de erro da própria função chega ao chamador em vez de uma rejeição genérica do `fetch`.

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
`client.call("functions/hello", payload)` também acessa uma função. Ele sempre envia um `POST` e, assim como o `invoke`, retorna o corpo textualmente — nenhum deles procura por uma chave `data`. Prefira o `functions.invoke`, que aceita um método, um subcaminho e um `responseType`; o `call` existe para rotas montadas fora de `/api/functions`, o que o `invoke` não consegue expressar.
:::

:::important
Importe de **`@rebasepro/server/functions`**, e não de `@rebasepro/server`.

Ambos funcionam. O subcaminho é a superfície de criação *portável*: ele não importa nada que exija Node, portanto uma função escrita com base nele pode rodar em qualquer runtime JavaScript. A raiz do pacote acessa todo o framework — a sequência de inicialização, os carregadores de arquivos, a camada de WebSocket — o que é apropriado para o ponto de entrada de um servidor e muito mais do que um manipulador de rota precisa. Ele também oferece acessadores de contexto tipados (`getUser`, `getDriver`) em vez de fazer o cast manual de `c.get("user")`.

Consulte [Portabilidade de runtime](#portabilidade-de-runtime) para ver o contrato completo.
:::

## Configuração

:::note[Onde isso é configurado]
**Runtime gerenciado:** nada a configurar — o runtime descobre `backend/functions/` por conta própria (`functions` na entrada do backend no `rebase.json`, caso você o tenha movido). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringem quais funções um processo com `REBASE_ROLE=functions` atende; qualquer outra role se recusará a inicializar se essas variáveis estiverem definidas.
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
2. Validar se cada export padrão é uma aplicação Hono (com duck typing via `.fetch()` + `.routes`)
3. Montar cada aplicação em `/api/functions/<filename>`
4. Aplicar o middleware de autenticação (veja [Autenticação](#autenticação-e-propagação-de-contexto) abaixo)

### Funções como valores

Um diretório é apenas uma forma de produzir o que o servidor disponibiliza: um registro mapeando segmentos de URL para aplicações Hono. Passe esse registro diretamente como `functions`, ou carregue um diretório para dentro dele com `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// the same as functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Forneça `functions` ou `functionsDir`, não ambos: a inicialização rejeita o uso conjunto. `loadFunctions(dir, { onSkip })` informa cada arquivo ignorado, juntamente com o motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` ainda funcionam, mas estão obsoletos e emitirão um aviso uma única vez. Isoladamente, o grupo de funções pode ser montado em qualquer caminho com `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funcionam dentro dele; consulte [Integração de Servidor Personalizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nomenclatura de Arquivos e Mapeamento de Rotas

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
- Subdiretórios e arquivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — reportados como problemas, pois o build compila mais arquivos do que o runtime carrega

O nome é a identidade da função em todos os outros lugares também: ele é o segmento de URL, o alvo do escopo `functions:invoke:<name>` que uma chave precisa para chamá-la, e o valor que `REBASE_FUNCTIONS_ONLY` usa como filtro quando você dedica um processo próprio a uma função.

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

### Função Fábrica (Factory Function)

```typescript
import { Hono } from "hono";
import type { HonoEnv } from "@rebasepro/server/functions";

export default function () {
    const app = new Hono<HonoEnv>();
    app.get("/status", (c) => c.json({ ok: true }));
    return app;
}
```

O `defineFunction` retorna exatamente a aplicação Hono que esses formatos constroem manualmente, portanto os três são intercambiáveis. Ele evita que você precise declarar `Hono<HonoEnv>` e fornece o singleton `rebase` no callback.

---

## Por Baixo dos Panos: O Carregador com Duck-Typing

Em um monorepo, suas funções podem resolver uma cópia do Hono diferente da que o Rebase utiliza, fazendo com que `exported instanceof Hono` retorne falso mesmo para um roteador funcional. Por isso, o carregador verifica a estrutura (`isHonoLike`): um objeto não nulo com um método `.fetch` e um array `.routes`.

### Escape do Compilador de Módulos ES

O carregador converte cada caminho de arquivo em uma URL de arquivo (`pathToFileURL(filePath).href`), funcionando tanto no Windows quanto em sistemas POSIX, e chama `import(url)` por meio de `new Function("url", "return import(url)")`, garantindo que uma compilação TypeScript não o reescreva em um `require()` que falhe sob ESM.

---

## Autenticação e Propagação de Contexto

As funções personalizadas são montadas com o **mesmo middleware de autenticação** das rotas de dados, mas com `requireAuth: false`. Isso significa que:

- O JWT do usuário é **analisado e injetado** no contexto, caso esteja presente
- Mas as requisições **não são rejeitadas** se nenhum JWT for fornecido
- Você deve **proteger explicitamente** as rotas que exigem autenticação

Um chamador que apresente um token *inválido* nunca atinge o seu manipulador: um token não verificável ou expirado é rejeitado com status 401 pelo próprio middleware, evitando que uma sessão expirada seja silenciosamente rebaixada para uma anônima.

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

`getUser` retorna um objeto restrito: `uid` é uma string e `roles` é sempre um array, independentemente do método de autenticação utilizado pelo chamador. `getUserId(c)` e `getRoles(c)` são atalhos. `getScopes(c)` retorna tudo o que o chamador tem permissão para fazer, na forma de strings de [escopo](/docs/backend/roles-and-scopes/): para uma pessoa, o plano de dados, os escopos próprios da aplicação e os escopos das suas roles; para uma chave de API, exatamente o que a chave contém.

### A conta do chamador

`getUser(c)` lê o token de acesso, e o token contém o ID, as roles e o endereço do chamador. Ele não informa como a conta faz login nem qual é o seu nome de exibição. `getUserProfile(c)` lê essas informações a partir do armazenamento de autenticação:

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

`providers` lista como a conta pode fazer login: `"password"` quando possuir senha, seguido por cada provedor vinculado (`"google"`, `"apple"`, …) na ordem em que foram associados. Uma conta de convidado, ou uma que faz login apenas com código de uso único, terá uma lista vazia.

A leitura é realizada de forma atualizada a cada requisição: um provedor que o chamador acabou de vincular aparece em sua próxima requisição, sem a necessidade de aguardar a renovação do token. A primeira chamada dentro de uma requisição custa duas buscas indexadas, executadas juntas. Chamadas subsequentes na mesma requisição reutilizam o resultado, e uma requisição que nunca a chama não tem custo algum.

Retorna `undefined` para um chamador anônimo, para um chamador via chave de serviço ou chave de API que não atua como conta alguma, e para uma conta que não existe mais. Também retorna `undefined` em um backend cujas contas residem em um [adaptador de autenticação](/docs/backend/auth-adapters/) externo: consulte esse provedor diretamente. Quando um administrador envia o cabeçalho `x-rebase-impersonate`, a função retorna a conta personificada.

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

Coloque os guards no **espaço de middleware da própria rota**, como mostrado acima, em vez de usar `app.use("/*", requireAuth)`. O método `use()` cobre apenas as rotas declaradas *abaixo* dele, de modo que uma rota adicionada posteriormente — no final do arquivo, meses depois — ficaria desprotegida silenciosamente.

:::important
Apenas ler `getUser(c)` **não** constitui um guard. Um chamador anônimo recebe `undefined` e o seu manipulador é executado mesmo assim. Somente um guard, ou uma verificação explícita `if (!user) return 401`, interrompe a requisição.
:::

### Escopos e escopos da aplicação

`requireAdmin` admite a role `admin` e ninguém mais. Para uma ação que uma role mais restrita ou uma chave de API deva acessar, proteja a rota com `requireScope`. Ele aceita um [escopo](/docs/backend/roles-and-scopes/) nativo ou um escopo declarado pela aplicação sob `auth.scopes` na coleção de usuários, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

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

Todo usuário autenticado possui todos os escopos da aplicação, portanto, para uma pessoa, o `requireScope` não decide nada: verifique no próprio manipulador se esse usuário pode fazer deploy desse projeto. O que o escopo adiciona é uma forma de **restringir uma chave**: uma chave contendo `project:deploy:p1` é aceita apenas para `p1`. Uma chave também precisa de `functions:invoke`, ou `functions:invoke:<name>`, antes mesmo de conseguir alcançar a função. Consulte [Escopos da aplicação](/docs/backend/roles-and-scopes/#app-scopes).

### Limites de Taxa (Rate Limits)

Uma rota que gere custo por chamada pode receber o middleware `rateLimit`, que realiza a contagem entre réplicas. Consulte [Limites de taxa em funções](/docs/backend/function-rate-limits/).

### Autenticação por Chave de Serviço (Service Key)

O Rebase suporta uma `REBASE_SERVICE_KEY` estática definida no seu `.env` para scripts ou chamadas entre servidores.

Quando uma requisição externa envia a chave de serviço por meio do cabeçalho de autorização (`Authorization: Bearer <service_key>`), o middleware de autenticação automaticamente:
1. Valida a chave usando comparação em tempo constante para evitar ataques de temporização (timing attacks).
2. Concede acesso de nível administrativo, configurando o chamador como `{ uid: "service", roles: ["admin"] }`.
3. Injeta um `DataDriver` com escopo dessa mesma identidade de serviço. A Segurança a Nível de Linha (RLS) continua em vigor — sendo avaliada como `{ uid: "service", roles: ["admin"] }`, sem ser ignorada.

### Autoautenticação Interna

Se você não tiver configurado uma `REBASE_SERVICE_KEY`, o Rebase gera uma **chave interna aleatória por inicialização**. O singleton `rebase` usa essa chave automaticamente ao chamar as APIs do plano de controle do próprio servidor (como `rebase.auth` ou `rebase.storage`). Isso significa que a lógica do lado do servidor sempre pode realizar tarefas administrativas, mesmo sem uma chave de serviço configurada manualmente.

## Acessando o Banco de Dados e Serviços

### 1. O driver com escopo de usuário — para tudo que atende a uma requisição

`getDriver(c)` retorna o driver **com o escopo do chamador**, de modo que cada leitura e escrita é avaliada em relação às suas políticas de Segurança a Nível de Linha (RLS) sob a identidade desse usuário:

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

`requireDriver(c)` é o equivalente a `getDriver(c)` sem o operador de asserção `!` — ele lança uma mensagem identificando o problema de configuração em vez de falhar vinte linhas depois com `undefined`.

`fetchCollection` e `fetchOne` retornam os registros que `GET /api/data/<table>` retornaria: datas como strings RFC 3339, um `belongsTo` como sua chave estrangeira (`authorId`), e registros relacionados somente quando especificados em `include` — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

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

`rebase.dataAsAdmin` não possui tipagem forte até que você [registre seu `Database` gerado](/docs/backend/typed-server-data).

### Driver com Escopo de RLS vs. Singleton Rebase

|                     | `getDriver(c)` (escopo da requisição)          | `rebase.dataAsAdmin` (identidade de serviço)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Executa como**    | O chamador (`uid`, suas roles)                 | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicação de RLS**| ✅ Sim (avaliado contra o chamador)            | ✅ Sim (avaliado contra a identidade de serviço)                 |
| **Ideal para...**   | CRUD comum de usuários, buscas e consultas    | Tarefas em segundo plano, gatilhos do sistema, webhooks          |
| **Estilo da API**   | Métodos de nível de driver (`fetchCollection`, `save`) | Acessadores fluentes de tabela (`rebase.dataAsAdmin.jobs.find`) |

#### O que é o `dataAsAdmin`, precisamente

`rebase.dataAsAdmin` tem **escopo de administrador, mas não ignora o RLS**. O driver recebe escopo uma única vez, na inicialização, via `withAuth({ uid: "service", roles: ["admin"] })`, portanto cada leitura e escrita roda dentro de uma transação que mudou para a role restrita `rebase_user` com `app.uid = 'service'`. Suas políticas continuam sendo avaliadas — em relação a essa identidade.

Para a maioria dos projetos, essa distinção nunca se torna visível, pois as políticas padrão que o Rebase injeta em cada tabela aceitam `serverContext() OR rolesOverlap(['admin'])`, e a identidade de serviço atende à segunda condição. Ela se torna perceptível no momento em que você escreve suas próprias políticas:

- **`policy.serverContext()` é falso para ele.** Esse helper é compilado como `rebase.uid() IS NULL`, e o `uid` deste acessador é `'service'`. Uma tabela com `disableDefaultPolicies: true` cuja única regra de escrita seja `serverContext()` recusará uma escrita do `dataAsAdmin` com o erro Postgres `42501`, e uma leitura nessa coleção retornará **zero linhas com HTTP 200** — a falha silenciosa. Escreva `rolesOverlap(["admin"])` (ou adicione-o juntamente) quando quiser representar "meu backend".
- **Seu alcance é igual ao alcance de um usuário `admin`.** Conceder a role `admin` a um usuário da aplicação concede a ele exatamente as mesmas linhas que este acessador enxerga. Não se trata de um canal privado.

### 3. `getSql(c)` — SQL como o chamador

Quando o SDK não expressa uma consulta ou escrita de forma simples — um upsert condicional, um compare-and-swap `UPDATE … WHERE rev = $3 RETURNING`, `count(*) FILTER (…)`, uma CTE — escreva o SQL diretamente e execute-o com a identidade do chamador:

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

A instrução é executada na transação do próprio chamador, sob a role restrita `rebase_user` com sua identidade — a mesma transação que o driver com escopo de usuário abre — garantindo que as regras de `rls` das suas tabelas decidam cada linha, exatamente como fazem no SDK. Uma consulta que solicite todas as linhas retornará apenas as linhas que o chamador pode acessar.

- **Somente leitura por padrão.** Passe `{ write: true }` para inserir, atualizar ou deletar; as políticas de inserção e atualização continuam sendo aplicadas.
- **O texto da consulta é seu; os valores vão em `params`** (`$1`, `$2`, …). A identidade do chamador fica armazenada nas configurações da transação, que podem ser alteradas via SQL. Por isso, qualquer instrução potencialmente perigosa — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, ou múltiplas instruções juntas — é recusada com `400 SQL_NOT_ALLOWED` antes de ser executada. Interpolar dados do usuário diretamente no texto seria a forma de tentar burlar essa proteção; nunca faça isso.
- **O que ele compartilha com o SDK.** As políticas e três regras que o Postgres aplica a ambos: uma [view materializada](/docs/collections/views/#materialized-views) disponibiliza suas linhas apenas para as suas `roles`, uma linha de uma tabela que declare `tenant` não pode ser transferida para outro tenant exceto por um chamador com `bypassRoles` (`TENANT_IMMUTABLE`), e as funções internas do servidor (`rebase.record_history`, `rebase.enqueue_job`) têm sua execução recusada. Uma coluna que o chamador não pode ler — marcada como `.private()` ou com `.access({ read })` ausente — é omitida das linhas, da mesma forma que a API omite, desde que seja uma referência direta à coluna (`SELECT *`, `password_hash AS h`); um valor *computado* a partir dela (`md5(password_hash)`) não é identificado, portanto evite computações a partir de tais colunas.
- **O que ele não compartilha.** Hooks como `beforeQuery` e `afterRead`, validações, save hooks e histórico residem no Node e não são executados.

A partir de um script, o [`openRebase`](/docs/backend/embedding-postgres-driver/) oferece o mesmo recurso: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL como a identidade de serviço

Uma função que precise aplicar suas próprias regras (um bilhete por dia, uma checagem de horário) sobre tabelas que somente administradores podem ler não pode usar `getSql(c)`: o chamador precisaria de políticas que dessem acesso a ele, e essas mesmas políticas abririam as tabelas na API de dados pública também. O `rebase.sqlAsAdmin` executa a instrução como `{ uid: "service", roles: ["admin"] }`, a identidade que o `rebase.dataAsAdmin` usa, sob as mesmas regras de segurança a nível de linha:

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

Trata-se do `getSql(c)` com uma identidade diferente: a role restrita da requisição, o braço de administrador das suas políticas, somente leitura a menos que seja passado `{ write: true }`, e a mesma proteção `SQL_NOT_ALLOWED`. Ao contrário do `rebase.sql()` do proprietário (owner), ele não pode executar DDL, e do armazenamento de autenticação ele acessa apenas o que um administrador acessa pela coleção de usuários: sessões, chaves e segredos MFA não são acessíveis para a role de requisição, e o hash de senha é omitido dos resultados. Uma instrução individual custa um round trip, assim como o `rebase.sql()`. Em scripts, o `openRebase()` também conta com esse recurso.

### 4. `rebase.sql()` — SQL de proprietário (owner), e o único acessador exclusivo para Node

Se você realmente precisar ignorar todas as restrições incondicionalmente, `rebase.sql()` é a solução: SQL puro na conexão do proprietário, sem políticas, acessando todas as linhas. É o recurso mais privilegiado no contexto de uma função — ainda mais do que o acessador que leva "admin" no nome.

Ele não deve ser usado para criar tabelas. Uma tabela é [declarada](/docs/schema/) com `defineTable` em `backend/schema/` e criada durante a inicialização; uma tabela criada com `CREATE TABLE` dentro de uma função não terá validação, hooks, configuração de segurança a nível de linha, visualização no painel administrativo ou tipagem no SDK. O `rebase.sql()` executa essa instrução, mas registra um aviso indicando a tabela que deveria ter sido declarada formalmente.

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

Ele roda em uma conexão TCP com o seu banco de dados, o que o torna o único acessador vinculado a um processo Node. Isso não impõe custos adicionais nas opções de implantação atuais — é apenas um detalhe importante a considerar caso a função precise ser migrada no futuro. Consulte [Portabilidade de runtime](#portabilidade-de-runtime).

:::caution[O acesso direto ao Drizzle é exclusivo para Node]
Você também pode importar sua própria instância do Drizzle e consultá-la diretamente (`db.execute(sql\`…\`)`). Isso funciona perfeitamente em uma implantação Node auto-hospedada ou gerenciada.

No entanto, é importante entender o impacto: uma função que importa `drizzle-orm` e um pool `pg` torna-se permanentemente uma função Node, ignora os hooks de tabela que o `rebase.data` executa (nenhum dos dois verifica `.validate()`, que se aplica a [requisições de API](/docs/collections/validation-and-conditions/#where-validation-runs)), e consome sua conexão de um pool diferente da requisição. O `rebase.sql()` oferece o mesmo SQL bruto usando a conexão do próprio framework, e `getSql(c)` oferece isso sob as políticas do chamador. Prefira essas alternativas.
:::

## Configuração e Segredos

Leia configurações **dentro** do manipulador, nunca no escopo do módulo:

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

Por que isso é importante em **qualquer** runtime, inclusive Node:

```typescript no-verify
// Don't. If STRIPE_SECRET_KEY is unset, this throws while the file is being
// imported — and the loader reports that as a *skipped function*. The route
// 404s, with the reason buried in a boot log line.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Uma leitura no escopo do módulo é avaliada no momento em que o arquivo é importado, antes de qualquer requisição existir. No Node, isso significa que uma única variável ausente interrompe o arquivo inteiro e todas as rotas contidas nele. Em uma plataforma que anexa a configuração à requisição em vez de ao processo, simplesmente não há nada para ler no momento da importação.

- `getEnv(c)` — todas as variáveis visíveis para esta requisição
- `env(c, "NAME")` — uma variável com trim; valores em branco são considerados indefinidos
- `requireEnv(c, "NAME")` — igual ao anterior, mas lança um erro indicando o nome da variável caso esteja ausente
- `lazyResource(factory)` — inicializa um cliente pesado uma única vez, no primeiro uso

O comando `rebase doctor` aponta leituras de `process.env` no escopo do módulo dentro do seu diretório de funções.

## Tarefas em Segundo Plano (Background Work)

Movido para uma página própria: [Tarefas em Segundo Plano](/docs/backend/background-work/).

## Portabilidade de runtime

Uma função personalizada é uma aplicação Hono; portanto, a possibilidade de executá-la fora de um processo Node depende exclusivamente do que o arquivo importa. O `rebase.sql()`, clientes de banco de dados importados diretamente e módulos nativos do Node a amarram ao Node; o restante do `rebase` e as APIs padrão da Web não impõem essa restrição, e nada falha hoje por conta disso. A página [Portabilidade de runtime](/docs/backend/runtime-portability/) descreve o que é portável, como `rebase build` e `rebase doctor` relatam esses casos e como criar variações com base no runtime.

## Ordem de Registro de Rotas

As funções personalizadas são carregadas e montadas **depois** que o `initializeRebaseBackend()` conclui a configuração inicial. A ordem de inicialização é:

1. **Bootstrappers** — Conexões de banco de dados, tabelas de autenticação, serviços em tempo real
2. **Rotas de autenticação** — `/api/auth/*`, `/api/admin/*`
3. **Rotas de armazenamento** — `/api/storage/*`
4. **Rotas de dados** — `/api/data/*` (CRUD para tabelas)
5. **Funções personalizadas** ← `/api/functions/*`
6. **Cron jobs** — `/api/admin/cron/*`
7. **WebSocket** — Assinaturas em tempo real

Isso significa que suas funções personalizadas têm acesso a todos os serviços já inicializados. Registre quaisquer rotas que precisem rodar **antes** do Rebase diretamente na aplicação Hono, antes de chamar `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// This runs BEFORE Rebase routes
app.get("/health", (c) => c.json({ status: "ok" }));

// Rebase initialization — registers all /api/* routes
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Rotas adicionadas à sua própria aplicação dessa maneira ficam **fora** de todos os roteadores do Rebase, portanto nenhum middleware de autenticação foi executado nelas e `getDriver(c)` não estará definido. Proteja essas rotas usando `requireAuth` / `requireAdmin` importados de **`@rebasepro/server`** — a raiz do pacote — que verificam o token por conta própria. Os guards do subcaminho `/functions` leem uma identidade que um roteador do Rebase já resolveu anteriormente e retornarão 500 em vez de fingir que uma identidade existe.
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

Quando as funções são carregadas, a inicialização registra `Loaded custom functions` com a contagem total. Cada função tem sua própria linha registrada no nível `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Se o carregamento falhar, o carregador exibirá informações de diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

O roteador é montado para o **diretório**, e não individualmente para as funções contidas nele. Se todos os arquivos falharem ao importar — uma única variável de ambiente ausente no escopo do módulo é suficiente para derrubar todos eles —, o `GET /api/functions` ainda responderá com `200` contendo uma lista vazia e a contagem de `skipped`, permitindo distinguir "nada foi carregado" de "este build não continha funções". A listagem em si requer um chamador autenticado, uma chave de API com o escopo simples `functions:invoke`, ou a chave de serviço — as funções permanecem acessíveis para quem cada uma autoriza, mas a listagem do inventário não é pública. Os motivos permanecem descritos no log de inicialização.

## Limites de Tempo (Timeouts) e de Taxa (Rate Limits)

Dois limites máximos se aplicam a `/api/functions/*`:

- **Timeout da requisição** — 30 segundos por padrão, respondendo `504` com o código `FUNCTION_TIMEOUT`. Configure com `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` desativa o timeout. O manipulador não pode ser interrompido externamente, mas é notificado: o sinal retornado por `getSignal(c)` de `@rebasepro/server/functions` é abortado no momento do 504, portanto repasse-o para o `fetch` e para qualquer outra função que aceite um sinal (`fetch(url, { signal: getSignal(c) })`). Processos que não receberem o sinal continuam rodando — o timeout libera o cliente e o socket, não o trabalho pendente. O fato de o manipulador *continuar executando* após o 504 é uma característica de processos Node de longa duração, não uma garantia contratual; qualquer tarefa que precise ser concluída obrigatoriamente deve ser colocada em [`waitUntil`](#tarefas-em-segundo-plano-background-work).
- **Limite de taxa (rate limit)** — Chamadores com chave de API ou autenticados compartilham os limites da API de dados. Chamadores anônimos recebem uma cota própria e muito mais generosa (3000 por janela), já que esse roteador é público por padrão para permitir receptores de webhooks. Sobrescreva isso com `rateLimit.anonymousFunctions`; `null` desativa o limite.

Rejeições de promises não tratadas são registradas no log em vez de encerrar a aplicação: caso contrário, uma chamada em background sem await em uma função derrubaria o processo inteiro. Defina `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para manter o comportamento padrão do Node.

No Rebase Cloud, a borda (edge) à frente das suas funções tem limites próprios, e o estado a nível de módulo, o sistema de arquivos e as portas de saída comportam-se de maneiras importantes de conhecer antes de estruturar seu projeto. Consulte [Runtime de backend gerenciado](/docs/deployment/managed-runtime/).

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Table hooks](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tarefas agendadas em segundo plano
