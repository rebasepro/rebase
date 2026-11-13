---
sourceHash: bc87b4afd43a6b60
title: Funções Customizadas
sidebar_label: Funções Customizadas
description: Adicione endpoints de API Hono customizados junto com suas rotas CRUD do Rebase. Descobertos automaticamente a partir de um diretório, com acesso total à instância do backend.
---

## Visão Geral

As funções customizadas permitem adicionar **rotas de API Hono arbitrárias** junto com os endpoints CRUD gerados automaticamente pelo Rebase. Elas seguem o mesmo padrão de **descoberta baseada em arquivos** que as coleções e os cron jobs: coloque um arquivo TypeScript no seu diretório `functions/`, e o Rebase o monta automaticamente.

Use funções customizadas para:

- **Endpoints de lógica de negócio** — aprovações, promoções, fluxos de trabalho customizados
- **Integrações de terceiros** — webhooks do Stripe, comandos do Slack, proxies de APIs externas
- **Endpoints públicos** — formulários de contato, captura de leads, health checks
- **Consultas de agregação** — estatísticas de dashboard, relatórios, analytics

## Definindo uma Função Customizada

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

Isso é montado em **`/api/functions/hello`**. O nome do arquivo (sem extensão) torna-se o prefixo da rota.

`POST`, porque é isso que o SDK envia por padrão — veja [Invocar a partir do cliente](#invocar-a-partir-do-cliente). Uma rota `GET` é igualmente válida; o chamador precisará então especificar `{ method: "GET" }`.

O comando `rebase dev` monitora o diretório de funções, portanto um arquivo adicionado enquanto ele está em execução é montado no próximo recarregamento — sem necessidade de reiniciar. (Ele precisa ser notificado: o diretório é escaneado em vez de importado, logo o watcher não consegue inferi-lo diretamente.)

## Invocar a partir do cliente

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3000" });

const { message } = await client.functions.invoke<{ message: string }>(
    "hello",                 // o nome do arquivo, sem extensão — um segmento de caminho
    { name: "Ada" }          // corpo JSON; omitido para um GET
);
```

O método `invoke` constrói a URL, anexa o token do chamador e lança um `RebaseApiError` em respostas que não sejam 2xx — garantindo que o próprio formato de erro da função chegue ao chamador, em vez de uma rejeição crua do `fetch`.

Quatro coisas que ele aceita além do nome:

```typescript
// Um método diferente. O payload é descartado para GET, já que GET não possui corpo.
await client.functions.invoke("hello", undefined, { method: "GET" });

// Um subcaminho — `/api/functions/hello/stats`. Ele entra aqui, nunca no nome:
// um nome contendo "/" é recusado em vez de codificado em percentual para um 404.
await client.functions.invoke("hello", undefined, { method: "GET", path: "stats" });

// Uma query string. Passada como `path`, sem nenhum separador inserido antes de `?`.
await client.functions.invoke("reports", undefined, { method: "GET", path: "?days=30" });

// Uma função que responde com texto ou arquivo (`c.text(csv)`, `c.body(pdf)`).
// A resposta é lida como JSON a menos que você especifique o contrário: "text" retorna uma string,
// "blob" um Blob, "response" o próprio Response com seu corpo ainda não lido.
const csv = await client.functions.invoke<string>("export-orders", undefined, { method: "GET", responseType: "text" });
```

:::note
`client.call("functions/hello", payload)` também acessa uma função. Ele sempre envia um `POST` e, assim como o `invoke`, retorna o corpo textualmente — nenhum dos dois busca por uma chave `data`. Prefira `functions.invoke`, que aceita método, subcaminho e `responseType`; o `call` existe para rotas montadas fora de `/api/functions`, o que o `invoke` não consegue expressar.
:::

:::important
Importe de **`@rebasepro/server/functions`**, e não de `@rebasepro/server`.

Ambos funcionam. O subcaminho é a superfície de criação *portável*: ele não importa nada que exija o Node, permitindo que uma função escrita com ele execute em qualquer runtime JavaScript. A raiz do pacote inclui todo o framework — a sequência de boot, os carregadores de arquivos, a camada WebSocket — o que é apropriado para o ponto de entrada de um servidor, mas mais do que um manipulador de rota precisa. Ele também fornece acessadores de contexto tipados (`getUser`, `getDriver`) em vez de fazer casting de `c.get("user")` manualmente.

Veja [Portabilidade de tempo de execução](#portabilidade-de-tempo-de-execu%C3%A7%C3%A3o) para o contrato completo.
:::

## Configuração

:::note[Onde isso é configurado]
**Runtime gerenciado:** nada a configurar — o runtime descobre `backend/functions/` automaticamente (`functions` na entrada do app backend em `rebase.json` se você o moveu). `REBASE_FUNCTIONS_ONLY` / `REBASE_FUNCTIONS_EXCLUDE` restringem quais funções um processo com `REBASE_ROLE=functions` atende; qualquer outra role se recusará a inicializar se essas variáveis estiverem definidas.
**Ejetado:** `initializeRebaseBackend({ functionsDir })`, ou `functions` (abaixo), em `backend/src/index.ts`.
:::

Habilite funções customizadas adicionando `functionsDir` à configuração do seu backend:

```typescript no-verify
import path from "path";

const instance = await initializeRebaseBackend({
    // ... outras configurações
    functionsDir: path.resolve(__dirname, "../functions"),
});
```

O Rebase irá:

1. Escanear o diretório em busca de arquivos `.ts` / `.js`
2. Validar se cada exportação padrão é uma aplicação Hono (duck-typed via `.fetch()` + `.routes`)
3. Montar cada aplicação em `/api/functions/<nome-do-arquivo>`
4. Aplicar o middleware de autenticação (veja [Autenticação](#autentica%C3%A7%C3%A3o-e-propaga%C3%A7%C3%A3o-de-contexto) abaixo)

### Funções como valores

Um diretório é uma forma de produzir o que o servidor atende: um registro que mapeia segmentos de URL para aplicações Hono. Passe esse registro diretamente como `functions`, ou leia um diretório nele com `loadFunctions`:

```typescript
import path from "path";
import { initializeRebaseBackend, loadFunctions } from "@rebasepro/server";
import sendInvoice from "../functions/send-invoice";

await initializeRebaseBackend({ app, server, functions: { "send-invoice": sendInvoice } }); // → /api/functions/send-invoice
// o mesmo que functionsDir:
await initializeRebaseBackend({ app, server, functions: await loadFunctions(path.resolve(__dirname, "../functions")) });
```

Informe `functions` ou `functionsDir`, não ambos: a inicialização recusa a combinação de ambos. `loadFunctions(dir, { onSkip })` entrega cada arquivo ignorado, juntamente com o motivo. `loadFunctionsFromDirectory` e `loadFunctionsWithDiagnostics` ainda funcionam, estão obsoletos (deprecated) e exibem um aviso uma única vez. Por conta própria, o grupo de funções pode ser montado em qualquer caminho com `app.route("/hooks", backend.routes.functions())`, e `getUser(c)` e `getDriver(c)` funcionam dentro dele; consulte [Integração de Servidor Customizado](/docs/backend/custom-server/#mounting-only-the-groups-you-want).

## Nomenclatura de Arquivos e Mapeamento de Rotas

| Arquivo | Caminho de Montagem |
|---------|---------------------|
| `functions/hello.ts` | `/api/functions/hello/*` |
| `functions/send-invoice.ts` | `/api/functions/send-invoice/*` |
| `functions/webhooks.ts` | `/api/functions/webhooks/*` |

As funções são descobertas **apenas no nível raiz do diretório** — não há recursão. `functions/admin/users.ts` é compilado por `rebase build`, mas nunca é montado; achate o nome em vez disso (`functions/admin-users.ts`). Um subdiretório é reportado na inicialização e contabilizado no endpoint de listagem em vez de ser ignorado silenciosamente.

Arquivos que são **ignorados**:

- `index.ts` / `index.js` — reservados
- `*.test.ts` / `*.test.js` — arquivos de teste
- `*.d.ts` — declarações de tipo
- Subdiretórios e arquivos `.mts` / `.cts` / `.tsx` / `.jsx` / `.mjs` / `.cjs` — reportados como problemas, já que a compilação compila mais do que o runtime carrega

O nome é a identidade da função em todos os outros lugares também: ele é o segmento de URL, o alvo do escopo `functions:invoke:<name>` que uma chave precisa para chamá-la e o valor selecionado por `REBASE_FUNCTIONS_ONLY` quando você atribui a uma função seu próprio processo.

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

O `defineFunction` retorna exatamente a aplicação Hono que estes constroem manualmente, portanto os três são intercambiáveis. Ele evita que você precise declarar `Hono<HonoEnv>` e disponibiliza o singleton `rebase` no callback.

---

## Sob o Capô: O Carregador Duck-Typing

Em um monorepo, suas funções podem resolver uma cópia do Hono diferente da utilizada pelo Rebase, fazendo com que `exported instanceof Hono` seja falso para um roteador perfeitamente funcional. Por isso, o carregador verifica a estrutura (`isHonoLike`): um objeto não nulo com um método `.fetch` e um array `.routes`.

### Escape do Compilador ES Module

O carregador transforma cada caminho de arquivo em uma URL de arquivo (`pathToFileURL(filePath).href`), funcionando tanto no Windows quanto em sistemas POSIX, e chama `import(url)` por meio de `new Function("url", "return import(url)")`, impedindo que uma compilação TypeScript o reescreva em um `require()` que falharia em ESM.

---

## Autenticação e Propagação de Contexto

As funções customizadas são montadas com o **mesmo middleware de autenticação** das rotas de dados, mas com `requireAuth: false`. Isso significa que:

- O JWT do usuário é **analisado e injetado** no contexto, se estiver presente
- As requisições **não são rejeitadas** se nenhum JWT for fornecido
- Você deve **proteger explicitamente** as rotas que exigem autenticação

Um chamador que apresente um token *inválido* nunca alcança o seu manipulador: um token inverificável ou expirado é rejeitado com 401 pelo próprio middleware, garantindo que uma sessão expirada nunca seja rebaixada silenciosamente para uma sessão anônima.

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

`getUser` retorna um objeto tipado e restrito: `uid` é uma string e `roles` é sempre um array, independentemente do método de autenticação utilizado pelo chamador. `getUserId(c)` e `getRoles(c)` são atalhos. `getScopes(c)` contém tudo o que o chamador tem permissão para fazer, como strings de [escopo](/docs/backend/roles-and-scopes/): para uma pessoa física, o plano de dados, os escopos da própria aplicação e os escopos das suas roles; para uma chave de API, exatamente o que a chave possui.

### A conta do chamador

`getUser(c)` lê o token de acesso, e o token contém o ID, as roles e o endereço do chamador. Ele não diz como a conta faz login ou qual é o seu nome de exibição. `getUserProfile(c)` lê essas informações do armazenamento de autenticação:

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

`providers` lista como a conta pode fazer login: `"password"` quando possui senha, seguido de cada provedor vinculado (`"google"`, `"apple"`, …) na ordem em que foi associado. Uma conta de convidado, ou uma que faz login apenas com código de uso único, possui uma lista vazia.

A leitura é atualizada para cada requisição: um provedor vinculado pelo chamador há instantes já aparece na sua próxima requisição, sem necessidade de aguardar a renovação do token. A primeira chamada em uma requisição custa duas buscas indexadas, executadas juntas. Chamadas subsequentes na mesma requisição reutilizam o resultado, e uma requisição que nunca o chama não tem custo algum.

Retorna `undefined` para um chamador anônimo, para um chamador com service key ou chave de API que não atua como nenhuma conta, e para uma conta que não existe mais. Também retorna `undefined` em um backend cujas contas residem em um [adaptador de autenticação](/docs/backend/auth-adapters/) externo: consulte esse provedor nesse caso. Quando um administrador envia `x-rebase-impersonate`, ele retorna a conta personificada.

### Protegendo Rotas

```typescript
import { defineFunction, requireAuth, requireAdmin, requireRole, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // Endpoint público — sem guard, qualquer pessoa pode acessá-lo.
    app.get("/public", (c) => c.json({ message: "Anyone can access this" }));

    // 401 para chamadores anônimos.
    app.post("/protected", requireAuth, (c) => c.json({ message: `Hello, ${getUserId(c)}` }));

    // 401 para anônimos, 403 sem a role admin. A ordem importa.
    app.post("/admin-only", requireAuth, requireAdmin, (c) => c.json({ ok: true }));

    // Qualquer uma das roles especificadas.
    app.post("/publish", requireAuth, requireRole("editor", "admin"), (c) => c.json({ ok: true }));
});
```

Coloque os guards no **slot de middleware da própria rota**, como mostrado acima, em vez de usar `app.use("/*", requireAuth)`. O `use()` cobre apenas as rotas declaradas *abaixo* dele, de modo que uma rota adicionada posteriormente — no final do arquivo, meses depois — ficaria desprotegida silenciosamente.

:::important
Ler `getUser(c)` **não** funciona como um guard. Um chamador anônimo recebe `undefined` e o seu manipulador executa normalmente. Somente um guard, ou uma verificação explícita `if (!user) return 401`, interrompe a requisição.
:::

### Escopos e escopos de app

`requireAdmin` aceita a role `admin` e ninguém mais. Para uma ação que uma role mais restrita ou uma chave de API deva acessar, proteja a rota com `requireScope`. Ele aceita um [escopo](/docs/backend/roles-and-scopes/) nativo ou um declarado pela aplicação sob `auth.scopes` na coleção de usuários, como `"project:deploy": { label: "Deploy projects", target: "project" }`:

```typescript
import { defineFunction, requireAuth, requireScope, hasScope } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    // 403 SCOPE_MISSING a menos que o chamador possua project:deploy ou project:deploy:<este projeto>.
    app.post("/:project", requireAuth, requireScope("project:deploy", c => c.req.param("project")), (c) => {
        return c.json({ deploying: c.req.param("project") });
    });

    // A mesma verificação dentro de um manipulador.
    app.get("/:project/can-deploy", requireAuth, (c) => c.json({ allowed: hasScope(c, "project:deploy", c.req.param("project")) }));
});
```

Cada pessoa autenticada possui todos os escopos de app, portanto, para uma pessoa física, o `requireScope` não decide nada: verifique dentro do manipulador se essa pessoa tem permissão para fazer o deploy desse projeto. O que o escopo adiciona é uma forma de **restringir uma chave**: uma chave com `project:deploy:p1` passa apenas para `p1`. Uma chave também precisa de `functions:invoke` ou `functions:invoke:<name>` antes de sequer alcançar a função. Consulte [Escopos de App](/docs/backend/roles-and-scopes/#app-scopes).

### Autenticação por Chave de Serviço (Service Key)

O Rebase suporta uma `REBASE_SERVICE_KEY` estática definida no seu arquivo `.env` para chamadas de scripts ou comunicação servidor-para-servidor.

Quando uma requisição externa envia a chave de serviço por meio do cabeçalho de Autorização (`Authorization: Bearer <service_key>`), o middleware de autenticação automaticamente:
1. Valida a chave usando comparação de tempo constante para evitar ataques de timing.
2. Concede acesso de nível de administrador, definindo o chamador como `{ uid: "service", roles: ["admin"] }`.
3. Injeta um `DataDriver` com escopo dessa mesma identidade de serviço. A Segurança em Nível de Linha (Row-Level Security - RLS) ainda se aplica — ela é avaliada como `{ uid: "service", roles: ["admin"] }`, e não ignorada.

### Autoautenticação Interna

Se você não configurou uma `REBASE_SERVICE_KEY`, o Rebase gera uma **chave interna aleatória por boot**. O singleton `rebase` usa essa chave automaticamente ao chamar as APIs do plano de controle do próprio servidor (como `rebase.auth` ou `rebase.storage`). Isso significa que a lógica do seu servidor sempre pode realizar tarefas administrativas, mesmo sem uma chave de serviço configurada manualmente.

## Acessando o Banco de Dados e Serviços

### 1. O driver com escopo do usuário — para qualquer coisa que atenda a uma requisição

`getDriver(c)` retorna o driver **com o escopo do chamador**, de modo que cada leitura e gravação seja avaliada em relação às suas políticas de Row-Level Security como aquele usuário:

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

`requireDriver(c)` é o mesmo que `getDriver(c)` sem o operador `!` — ele lança uma mensagem detalhando o problema de configuração em vez de falhar vinte linhas depois com `undefined`.

<span class="since-badge" data-since="0.31">Desde 0.31</span> `fetchCollection` e `fetchOne` retornam as linhas que `GET /api/data/<table>` retorna: datas como strings RFC 3339, um relacionamento `belongsTo` como sua chave estrangeira (`authorId`), e uma linha relacionada somente quando especificada em `include` — `driver.fetchOne({ path: "articles", id, include: ["author"] })`.

### 2. `rebase.dataAsAdmin` — para trabalho confiável em segundo plano

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

`rebase.dataAsAdmin` não é tipado até que você [registre o seu `Database` gerado](/docs/backend/typed-server-data).

### Driver com Escopo RLS vs. Singleton Rebase

|                     | `getDriver(c)` (escopo da requisição)          | `rebase.dataAsAdmin` (identidade de serviço)                     |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------- |
| **Executa como**    | O chamador (`uid`, suas roles)                 | `{ uid: "service", roles: ["admin"] }`                            |
| **Aplicação de RLS**| ✅ Sim (avaliado em relação ao chamador)       | ✅ Sim (avaliado em relação à identidade de serviço)             |
| **Ideal para...**   | CRUD comum de usuários, buscas e consultas     | Tarefas em segundo plano, gatilhos de sistema, webhooks          |
| **Estilo da API**   | Métodos de nível de driver (`fetchCollection`, `save`) | Acessadores fluentes de coleção (`rebase.dataAsAdmin.jobs.find`) |

#### O que o `dataAsAdmin` é, precisamente

`rebase.dataAsAdmin` tem **escopo de administrador, mas não ignora o RLS**. O driver recebe escopo uma única vez, na inicialização, com `withAuth({ uid: "service", roles: ["admin"] })`, fazendo com que cada leitura e gravação execute dentro de uma transação que alternou para a role restrita `rebase_user` com `app.uid = 'service'`. Suas políticas são avaliadas — contra essa identidade.

Para a maioria dos projetos, essa distinção nunca se torna visível, pois as políticas padrão injetadas pelo Rebase em cada coleção admitem `serverContext() OR rolesOverlap(['admin'])`, e a identidade de serviço cumpre a segunda condição. Ela se torna visível no momento em que você escreve suas próprias políticas:

- **`policy.serverContext()` é falso para ele.** Esse helper é compilado para `rebase.uid() IS NULL`, e o `uid` desse acessador é `'service'`. Uma coleção com `disableDefaultPolicies: true` cuja única regra de gravação seja `serverContext()` recusará uma gravação do `dataAsAdmin` com o erro Postgres `42501`, e uma leitura nessa coleção retornará **zero linhas com HTTP 200** — o comportamento silencioso. Escreva `rolesOverlap(["admin"])` (ou adicione-o em conjunto) quando quiser dizer "meu backend".
- **Seu alcance é igual ao de um usuário `admin`.** Conceder a role `admin` a um usuário da aplicação concede a ele exatamente as mesmas linhas que este acessador enxerga. Não se trata de um canal privado.

### 3. `getSql(c)` — SQL como o chamador

Quando o SDK não expressa uma consulta ou gravação de forma limpa — um upsert condicional, um `UPDATE … WHERE rev = $3 RETURNING` compare-and-swap, `count(*) FILTER (…)`, uma CTE — escreva o SQL e execute-o como o chamador:

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

A instrução executa na própria transação do chamador, como a role restrita `rebase_user` com sua respectiva identidade — a transação que o driver com escopo do usuário abre —, de modo que as regras de segurança das suas coleções decidem cada linha, exatamente como fazem para o SDK. Uma consulta que solicita todas as linhas obtém as do chamador.

- **Somente leitura por padrão.** Passe `{ write: true }` para inserir, atualizar ou excluir; as políticas de inserção e atualização continuam se aplicando.
- **O texto da consulta é seu; os valores vão em `params`** (`$1`, `$2`, …). A identidade do chamador reside em configurações de transação, as quais o SQL pode alterar; portanto, qualquer comando que possa alterá-las — `SET`, `RESET`, `set_config`, `pg_settings`, `DO`, ou múltiplas instruções — é recusado com `400 SQL_NOT_ALLOWED` antes de ser executado. Interpolar entradas de usuário diretamente no texto seria a forma de testar essa proteção; não faça isso.
- **O que ele compartilha com o SDK.** As políticas e três regras que o Postgres mantém para ambos: uma [view materializada](/docs/collections/views/#materialized-views) entrega suas linhas apenas para suas `roles`, uma linha de uma tabela que declare `tenant` não pode ser movida para outro tenant exceto por um chamador com `bypassRoles` (`TENANT_IMMUTABLE`), e as funções internas do servidor (`rebase.record_history`, `rebase.enqueue_job`) são recusadas. Uma coluna que o chamador não possa ler — `.private()`, ou um `.access({ read })` que ele não possua — é removida das linhas, assim como a API a remove, quando for uma referência simples à coluna (`SELECT *`, `password_hash AS h`); um valor *computado* a partir dela (`md5(password_hash)`) não é reconhecido, portanto não faça cálculos a partir dela.
- **O que ele não compartilha.** `beforeQuery` e `afterRead`, validações, hooks de salvamento e histórico residem no Node e não são executados.

A partir de um script, [`openRebase`](/docs/backend/embedding-postgres-driver/) oferece o mesmo: `(await rebase.withAuth(user)).sql(…)`.

#### `rebase.sqlAsAdmin()` — SQL como a identidade de serviço

Uma função que impõe suas próprias regras (um ticket por dia, uma verificação de tempo) sobre tabelas que apenas administradores podem ler não pode usar `getSql(c)`: o chamador precisaria de políticas que o autorizassem, e essas mesmas políticas abririam as tabelas na API de dados pública também. `rebase.sqlAsAdmin` executa o comando como `{ uid: "service", roles: ["admin"] }`, a mesma identidade utilizada por `rebase.dataAsAdmin`, sob a mesma segurança em nível de linha:

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

É o equivalente a `getSql(c)` com uma identidade diferente: a role de requisição restrita, a ramificação de admin das suas políticas, somente leitura a menos que `{ write: true }`, e a mesma proteção `SQL_NOT_ALLOWED`. Diferente do `rebase.sql()` do proprietário (owner), ele não pode executar DDL, e do armazenamento de autenticação ele acessa apenas o que um administrador acessa pela coleção de usuários: sessões, chaves e segredos de MFA são retidos da role de requisição, e o hash de senha é omitido das linhas. Uma instrução individual consome uma viagem de ida e volta (round trip), assim como `rebase.sql()`. Em scripts, `openRebase()` também o disponibiliza.

### 4. `rebase.sql()` — SQL de proprietário (owner) e o único acessador exclusivo de Node

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Se você genuinamente precisa de um bypass incondicional, `rebase.sql()` é a solução: SQL puro na conexão do proprietário, sem políticas, retornando todas as linhas. É o recurso com maior privilégio no contexto de uma função — mais ainda do que o acessador com "admin" no nome.

Ele não se destina à criação de tabelas. Uma tabela é [declarada](/docs/schema/) com `defineTable` em `backend/schema/` e criada no boot; uma tabela criada com `CREATE TABLE` em uma função não possui validações, hooks, configuração de segurança em nível de linha, visualização de admin ou tipagem no SDK. `rebase.sql()` executará tal instrução, mas registrará um aviso no log indicando a tabela a ser declarada.

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

Ele roda em uma conexão TCP com o seu banco de dados, o que o torna o único acessador vinculado a um processo Node. Isso não tem custo em nenhum dos tipos de deploy existentes hoje — é simplesmente o único ponto a ter em mente se uma função puder vir a ser migrada posteriormente. Consulte [Portabilidade de tempo de execução](#portabilidade-de-tempo-de-execu%C3%A7%C3%A3o).

:::caution[O acesso direto via Drizzle é exclusivo do Node]
Você também pode importar sua própria instância do Drizzle e consultá-la diretamente (`db.execute(sql\`…\`)`). Isso funciona perfeitamente em deploys Node auto-hospedados ou gerenciados.

Vale a pena ter em mente o que isso implica: uma função que importa `drizzle-orm` e um pool `pg` torna-se permanentemente uma função Node, ignora os hooks de tabela executados por `rebase.data` (nenhum dos dois verifica `.validate()`, que se aplica a [requisições de API](/docs/collections/validation-and-conditions/#where-validation-runs)), e obtém sua conexão de outro lugar que não a requisição. `rebase.sql()` fornece o mesmo SQL bruto através da conexão do próprio framework, e `getSql(c)` o disponibiliza sob as políticas do chamador. Dê preferência a estes últimos.
:::

## Configuração e Segredos

Leia as configurações **dentro** do manipulador, nunca no escopo do módulo:

```typescript
import { defineFunction, requireEnv, lazyResource } from "@rebasepro/server/functions";

// Construído uma única vez, na primeira requisição que dele necessitar — não no momento da importação.
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

Por que isso importa em **qualquer** runtime, inclusive no Node:

```typescript no-verify
// Não faça isso. Se STRIPE_SECRET_KEY não estiver definida, isso lançará um erro
// enquanto o arquivo estiver sendo importado — e o carregador reportará isso como
// uma *função ignorada*. A rota retornará 404, com o motivo oculto em uma linha de log de boot.
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
```

Uma leitura em escopo de módulo é avaliada quando o arquivo é importado, antes que qualquer requisição exista. No Node, isso significa que uma única variável ausente derruba o arquivo inteiro e todas as rotas contidas nele. Em um host que anexa configurações à requisição em vez de ao processo, não há absolutamente nada para ser lido em tempo de importação.

- `getEnv(c)` — todas as variáveis visíveis para esta requisição
- `env(c, "NAME")` — uma variável, com trim aplicado; valores em branco são considerados não definidos
- `requireEnv(c, "NAME")` — o mesmo, porém lança um erro com mensagem indicando o nome da variável
- `lazyResource(factory)` — cria um cliente custoso uma única vez, no primeiro uso

O comando `rebase doctor` relata leituras de `process.env` no escopo de módulo no seu diretório de funções.

## Trabalho em Segundo Plano

Movido para sua própria página: [Trabalho em Segundo Plano](/docs/backend/background-work/).

## Portabilidade de tempo de execução

Uma função customizada é uma aplicação Hono, portanto sua capacidade de executar em outros ambientes fora de um processo Node depende exclusivamente do que o seu próprio arquivo importa. `rebase.sql()`, clientes de banco de dados importados diretamente e módulos nativos do Node vinculam-na ao Node; o restante do `rebase` e a plataforma web não, e nada falha hoje por causa de nenhum dos dois. A seção [Portabilidade de tempo de execução](/docs/backend/runtime-portability/) lista o que é portável, como `rebase build` e `rebase doctor` relatam isso, e como ramificar de acordo com o runtime.

## Ordem de Registro de Rotas

As funções customizadas são carregadas e montadas **após** a conclusão da configuração principal pelo `initializeRebaseBackend()`. A ordem de inicialização é:

1. **Bootstrappers** — Conexões de banco de dados, tabelas de autenticação, serviços de realtime
2. **Rotas de autenticação** — `/api/auth/*`, `/api/admin/*`
3. **Rotas de storage** — `/api/storage/*`
4. **Rotas de dados** — `/api/data/*` (CRUD para coleções)
5. **Funções customizadas** ← `/api/functions/*`
6. **Cron jobs** — `/api/admin/cron/*`
7. **WebSocket** — Assinaturas em realtime

Isso significa que suas funções customizadas têm acesso a todos os serviços inicializados. Registre qualquer rota que precise executar **antes** do Rebase diretamente na aplicação Hono, antes de invocar `initializeRebaseBackend()`:

```typescript no-verify
const app = new Hono<HonoEnv>();

// Isso executa ANTES das rotas do Rebase
app.get("/health", (c) => c.json({ status: "ok" }));

// Inicialização do Rebase — registra todas as rotas /api/*
const instance = await initializeRebaseBackend({ app, /* ... */ });
```

:::caution
Rotas adicionadas à sua própria aplicação dessa maneira ficam **fora** de qualquer roteador do Rebase; portanto, nenhum middleware de autenticação foi executado nelas e `getDriver(c)` não estará definido. Proteja essas rotas com `requireAuth` / `requireAdmin` importados de **`@rebasepro/server`** — a raiz do pacote —, que verificam o token por conta própria. Os guards no subcaminho `/functions` leem uma identidade já resolvida por um roteador do Rebase e retornarão 500 em vez de fingir que uma identidade existe.
:::

## Exemplo: Manipulador de Webhook

```typescript
import { defineFunction, requireEnv, waitUntil, lazyResource } from "@rebasepro/server/functions";

/** Construído na primeira requisição, a partir da configuração daquela requisição. */
const secret = lazyResource((env) => env.STRIPE_WEBHOOK_SECRET ?? "");

export default defineFunction((app, { rebase }) => {
    // Deliberadamente público: o Stripe não envia token. A assinatura é a
    // autenticação, portanto verifique-a antes de realizar qualquer outra ação.
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
            // O cumprimento da ação pode durar mais do que a resposta; o status 200 informa ao Stripe para não tentar novamente.
            waitUntil(c, notifyFulfilment(requireEnv(c, "FULFILMENT_URL"), session));
        }

        return c.json({ received: true });
    });
});

declare function verifySignature(body: string, signature: string, secret: string): boolean;
declare function notifyFulfilment(url: string, session: Record<string, string>): Promise<void>;
```

## Depuração

Quando as funções são carregadas, a inicialização registra `Loaded custom functions` junto com a sua contagem. A linha de cada função é registrada no nível `debug` (`LOG_LEVEL=debug`):

```
⚡ Loaded function route: hello
```

Se o carregamento falhar, o carregador fornece detalhes de diagnóstico:

```
[functions] broken-function.ts: default export is not a Hono app or factory. Skipping.
  export type: object (SomeClass)
  prototype methods: constructor, someMethod
  Hint: ensure the function exports a Hono app created with the same hono version as the server.
  Author with `defineFunction(...)` from @rebasepro/server/functions for a typed, checked contract.
  The loader checks for .fetch() and .routes — any Hono-compatible app will work.
```

O roteador é montado para o **diretório**, não para as funções nele contidas. Se todos os arquivos falharem ao importar — uma única variável de ambiente ausente no escopo do módulo é suficiente para derrubar todos —, o `GET /api/functions` ainda responderá `200` com uma lista vazia mais uma contagem de `skipped`, permitindo distinguir "nada carregou" de "esta compilação não incluiu funções". A listagem em si requer um chamador autenticado, uma chave de API que possua o escopo `functions:invoke` simples, ou a chave de serviço — as funções permanecem invocáveis por quem cada uma autorizar, mas o inventário completo delas não é público. Os motivos continuam descritos no log de boot.

## Limites de Tempo e Taxa (Timeouts e Rate Limits)

Dois limites máximos se aplicam a `/api/functions/*`:

- **Timeout de requisição** — 30 segundos por padrão, respondendo `504` com o código `FUNCTION_TIMEOUT`. Configure com `functionsTimeoutMs` (ou `REBASE_FUNCTIONS_TIMEOUT_MS`); `0` desabilita. O manipulador não pode ser interrompido externamente, mas é informado: o `getSignal(c)` de `@rebasepro/server/functions` é abortado no momento do 504; portanto, passe-o para o `fetch` e qualquer outra chamada que aceite um sinal (`fetch(url, { signal: getSignal(c) })`). Trabalhos que não receberem o sinal continuarão executando — o timeout libera o cliente e o socket, não o processamento em si. O fato de o manipulador *continuar executando* após o 504 é uma característica de um processo Node de longa duração, não uma garantia do contrato; qualquer tarefa que precise necessariamente ser concluída deve ser colocada em [`waitUntil`](#trabalho-em-segundo-plano).
- **Rate limit** — Chamadores com chave de API e autenticados compartilham os mesmos limites da API de dados. Chamadores anônimos recebem sua própria cota, muito mais permissiva (3000 por janela), pois este roteador é público por padrão para recepção de webhooks. Sobrescreva com `rateLimit.anonymousFunctions`; `null` o desativa.

Rejeições de promises não tratadas são registradas em log em vez de serem fatais: caso contrário, uma chamada fire-and-forget em uma única função encerraria o processo inteiro. Defina `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` para restaurar o comportamento padrão do Node.

No Rebase Cloud, a camada de borda (edge) à frente das suas funções possui limites próprios, e o estado em nível de módulo, o sistema de arquivos e as portas de saída comportam-se de formas importantes de conhecer antes de projetar sua arquitetura. Consulte [Runtime gerenciado de backend](/docs/deployment/managed-runtime/).

## Próximos Passos

- **[Visão Geral do Backend](/docs/backend)** — Referência completa de configuração do backend
- **[Hooks de tabela](/docs/collections/callbacks)** — Execute lógica em alterações de dados
- **[Cron Jobs](/docs/backend/cron-jobs)** — Tarefas agendadas em segundo plano
