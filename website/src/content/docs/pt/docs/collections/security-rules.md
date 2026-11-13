---
sourceHash: f385a35cc59df9c6
title: Segurança a nível de linha
sidebar_label: Segurança a nível de linha
description: "Cada tabela declara sua postura de rls — admin-only, inherit ou uma lista de regras — e o Rebase a compila em políticas de row-level security do Postgres. Formatos de regra, condições abreviadas, defaultRls e o que falha em modo fechado."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Cada tabela define quem acessa suas linhas em sua chave `rls`. O Rebase compila
isso em segurança a nível de linha (row-level security) do Postgres: `ENABLE ROW LEVEL SECURITY`
na tabela e um `CREATE POLICY` por regra e operação. O Postgres então filtra cada
instrução, em cada rota — REST, realtime, MCP, o CMS e SQL executado como o
chamador — porque as regras estão no banco de dados, não no código da aplicação.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        status:   col.enum(["draft", "published"]).notNull().default("draft"),
        authorId: col.uuid().notNull().onCreateUser(),
    },
    rls: [
        // Anyone reads the published posts.
        { operation: "select", access: "public", condition: { status: "published" } },
        // Authors read and edit their own, drafts included.
        { operations: ["select", "insert", "update"], ownerField: "authorId" },
        // Editors may delete.
        { operation: "delete", roles: ["editor"] },
    ],
});
```

`rls` não tem valor padrão. Omiti-lo é um erro de tipo, e uma tabela que alcança
o compilador sem uma postura utilizável é recusada. Consulte
[O que falha em modo fechado](#o-que-falha-em-modo-fechado).

:::note[Vindo de collections?]
`rls` substitui `securityRules`, e é obrigatório. Uma regra escrita para
`securityRules` é uma entrada válida de `rls` tal como está. O guia de atualização
para esta versão aborda `defaultSecurityRules` e `disableDefaultPolicies`.
:::

## As três posturas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| `rls` | Significado |
|---|---|
| `"admin-only"` | Row-level security ativada e apenas as políticas de linha de base de admin: o papel `admin` e o próprio código do servidor acessam as linhas. Qualquer outro chamador não obtém nenhuma linha e suas gravações são recusadas. |
| `"inherit"` | O `defaultRls` exportado de `backend/schema/index.ts`. Recusado quando não houver nenhum. |
| uma lista de regras | As políticas a serem geradas, uma ou mais. `[]` é recusado: declare `"admin-only"` para restringir uma tabela apenas a administradores. |

`"admin-only"` é a postura inicial para uma tabela quando você ainda não decidiu
quem deve visualizá-la. Nada é exposto até que você escreva as regras que a
exponham.

### `defaultRls`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O `backend/schema/index.ts` pode exportar uma postura para as tabelas que declaram
`rls: "inherit"`:

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { posts } from "./posts";
export { comments } from "./comments";

export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
    { operations: ["insert", "update", "delete"], roles: ["editor"] },
];
```

`defaultRls` é `"admin-only"` ou uma lista não vazia de regras. Ele se aplica apenas
a tabelas que especificam `"inherit"`; uma tabela com regras próprias não herda
nenhuma dessas, e as duas listas nunca são combinadas. `rls: "inherit"` sem nenhum
`defaultRls` exportado interrompe `rebase db generate`, `rebase db push` e a
inicialização com um erro instruindo a exportar um.

## Políticas que uma tabela recebe sem precisar escrevê-las

<span class="since-badge" data-since="0.31">Desde 0.31</span>

As políticas em uma tabela vão além de suas próprias regras:

- **A linha de base de admin.** Cada tabela recebe políticas `<table>_default_admin_read` e
  `<table>_default_admin_write` para insert, update e delete. Elas são
  permissivas e admitem o contexto do servidor e o papel `admin`, de modo que admins
  leem e gravam todas as linhas. Políticas permissivas são combinadas com OR, portanto
  a linha de base expande o que quer que suas regras permitam; ela nunca as restringe.
- **A tabela de usuários.** Uma tabela declarada com
  [`defineAuthTable`](/docs/schema/auth-table/) também recebe uma política que permite
  a um usuário autenticado ler sua própria linha, e uma barreira restritiva que permite
  apenas a um admin gravar nas colunas de privilégios (`roles`), independentemente do que
  suas regras digam.
- **Tenancy.** Uma tabela com [`tenant`](/docs/collections/tenancy/) recebe uma
  política restritiva que confina cada operação ao tenant do chamador.
- **Tabelas de junção.** A junção de uma relação [`manyToMany`](/docs/collections/relations/#manytomany--through-a-junction)
  recebe políticas próprias.

`defaultPolicies: false` em uma tabela remove a linha de base permissiva de admin e
mantém as barreiras restritivas, de modo que a tabela passa a ter exatamente as regras
que você escreveu. Ele é recusado em conjunto com `"admin-only"`, que é a linha de base
e nada mais: a combinação deixaria uma tabela inacessível para qualquer chamador,
incluindo administradores.

O DDL gerado marca cada política injetada, e o comando `rebase db push` restaura
qualquer uma que tenha sido removida manualmente.

## Formatos de regras

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma regra segue um destes formatos. Misturar dois em uma mesma regra é um erro de
tipo, e o compilador também o recusa, capturando casos em JavaScript ou casts:
`access` junto de `ownerField`, `using` ou `withCheck`; `ownerField` junto de
`using`, `withCheck`, `condition` ou `check`; `condition` ou `check` junto de
`using` ou `withCheck`. O mesmo vale para valores fora da lista permitida para
`access`, `mode`, `operation(s)` ou `roles` (um `"restrictive"` digitado incorretamente
é recusado, não interpretado como permissivo). Uma regra nunca se torna uma política
que ignora silenciosamente metade do que foi escrito.

| Formato | Exemplo | `USING` (quais linhas) | `WITH CHECK` (o que pode ser gravado) |
|---|---|---|---|
| Proprietário (Owner) | `{ ownerField: "authorId" }` | a coluna é igual ao id do chamador | o mesmo |
| Público | `{ access: "public" }` | todas as linhas | todas as linhas |
| Autenticado | `{ access: "authenticated" }` | todas as linhas, para um chamador autenticado | o mesmo |
| Autenticado com conta | `{ access: "registered" }` | todas as linhas, para um chamador autenticado que não seja convidado | o mesmo |
| Acesso com condição | `{ access: "public", condition: { status: "published" } }` | a condição (e autenticado, para `"authenticated"` e `"registered"`) | `check`, caso contrário a condição, filtrada da mesma forma |
| Acesso com verificação | `{ access: "authenticated", check: { state: "open" } }` | apenas o teste de acesso | a verificação (`check`), filtrada pelo teste de acesso |
| Estruturado | `{ condition: policy.rolesOverlap(["moderator"]) }` | a condição | `check`, caso contrário a condição |
| SQL puro (Raw SQL) | `{ using: "{published_at} > now() - interval '30 days'" }` | o SQL | `withCheck`, caso contrário `using` |
| Apenas verificação bruta | `{ operation: "insert", withCheck: "{owner_id} = rebase.uid()" }` | nenhuma linha | o SQL |
| Apenas papéis (Roles) | `{ operation: "delete", roles: ["admin"] }` | todas as linhas, para os papéis | o mesmo |

Todos os formatos também aceitam as chaves compartilhadas:

| Chave | Padrão | O que faz |
|---|---|---|
| `operation` | `"all"` | `"select"`, `"insert"`, `"update"`, `"delete"` ou `"all"`. |
| `operations` | | Várias operações de uma vez; uma política é gerada por operação. Tem precedência sobre `operation`. |
| `roles` | | Papéis da aplicação; a regra se aplica apenas a um chamador que possua um deles. Combinado com AND ao restante da regra. |
| `mode` | `"permissive"` | `"restrictive"` torna a regra uma barreira que também deve passar. Consulte [Permissivo e restritivo](#permissivo-e-restritivo). |
| `name` | derivado | O nome da política. Sem ele, o nome é derivado da tabela, da operação e de um hash da regra, de modo que editar uma regra renomeia sua política. |
| `pgRoles` | `["public"]` | Papéis nativos do Postgres: a cláusula `TO` de `CREATE POLICY`. Diferente de `roles`. |

`roles` são papéis de aplicação do Rebase, armazenados na coluna `roles` da tabela
de usuários e lidos dentro de uma política por meio de `rebase.roles()`. Eles não
são papéis do Postgres: nomes como `anon` ou `authenticated` pertencem a `pgRoles`,
e em `roles` produzem uma condição que nenhum usuário atende. Quase todos os projetos
precisam de `roles`.

:::note[Regras migradas da versão 0.30]
O compilador da versão 0.30 lia apenas uma cláusula de uma regra e não conhecia
nenhum valor de `access` além de `"public"`, portanto quatro formatos agora
concedem algo diferente — um simples `access: "authenticated"` não concedia nada e
agora admite qualquer chamador autenticado. O comando `rebase migrate collections-to-tables`
lista cada um sob "Review before deploying"; consulte [o guia de atualização](/docs/upgrading/0-30-to-0-31/#review-before-deploying-these-rules-change-meaning).
:::

### Owner

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const notes = defineTable("notes", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        ownerId: col.uuid().notNull().onCreateUser(),
        body:    col.text(),
    },
    rls: [{ operation: "all", ownerField: "ownerId" }],
});
```

Isso gera `USING ((owner_id)::text = (SELECT rebase.uid()))`.
`ownerField` especifica uma chave de coluna, uma coluna SQL ou uma relação
`belongsTo` (sua coluna de chave estrangeira). Ele compara a coluna com o id do
chamador; ele não a preenche. `.onCreateUser()` faz com que o servidor grave o id
do chamador na criação, independentemente do que a requisição enviou, conferindo
significado real à comparação.

### Acesso público

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`{ operation: "select", access: "public" }` gera `USING (true)`: nenhum filtro de
linhas em leituras, portanto todo chamador que a API aceitar poderá ler todas as linhas.

Isso expande quais linhas um chamador visualiza, não quem pode fazer requisições.
Por padrão, a API ainda responde 401 para requisições sem token. Defina
`AUTH_REQUIRE=false` (`auth.requireAuth: false`) para remover essa barreira e deixar
que apenas as políticas decidam; com isso, um chamador não autenticado também poderá
ler essas linhas.

`{ access: "authenticated" }` é equivalente, mas com uma verificação de sessão:
o chamador precisa estar autenticado. Um convidado criado via login anônimo possui uma
sessão. `{ access: "registered" }` também exclui convidados; prefira este em projetos
com login anônimo. Ambos se combinam com `condition` e `check` da mesma forma que
`"public"`. Consulte [`authenticated()` e `registered()`](#authenticated-e-registered).

### Condições

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma `condition` define quais linhas existentes uma regra cobre; um `check` define
quais valores novos ou atualizados ela permite, tendo como padrão a própria condição.
Ambos aceitam o formato de objeto abreviado ou uma expressão estruturada.

O formato **abreviado** é um objeto simples contendo chaves de coluna e valores literais.
Ele é satisfeito quando cada coluna é igual ao seu respectivo valor, e um valor `null`
significa `IS NULL`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const reports = defineTable("reports", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        state:     col.enum(["open", "closed"]).notNull().default("open"),
        public:    col.boolean().notNull().default(false),
        deletedAt: col.timestamp({ withTimezone: true }),
    },
    rls: [
        // Anyone reads public reports that are not deleted.
        { operation: "select", access: "public", condition: { public: true, deletedAt: null } },
        // Signed-in callers may file a report, but only as an open one.
        { operation: "insert", access: "authenticated", check: { state: "open" } },
    ],
});
```

O formato abreviado requer pelo menos uma chave, e nenhuma chave pode ser nomeada
como `kind` (é assim que uma expressão estruturada é identificada; compare uma coluna
chamada `kind` utilizando a forma estruturada completa). Suas chaves são validadas
em relação à tabela quando o schema é compilado: uma chave que não faça referência
a nenhuma coluna é recusada, indicando a tabela e a chave no erro.

Uma condição **estruturada** é construída com `policy`, importado de
`@rebasepro/types`. Ela compila para SQL no banco de dados e é avaliada em
JavaScript pelo CMS, garantindo que o CMS nunca ofereça uma ação que o banco de dados
recusará:

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { policy } from "@rebasepro/types";

export const documents = defineTable("documents", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        teamId: col.uuid().notNull(),
        userId: col.uuid().notNull(),
    },
    rls: [
        // The owner, or anyone holding `moderator`.
        {
            operation: "update",
            condition: policy.or(
                policy.compare(policy.field("userId"), "eq", policy.authUid()),
                policy.rolesOverlap(["moderator"])
            ),
        },
        // Members of the document's team read it.
        {
            operation: "select",
            condition: policy.existsIn({
                table: "team_members",
                where: policy.and(
                    policy.compare(policy.field("team_id"), "eq", policy.outerField("teamId")),
                    policy.compare(policy.field("user_id"), "eq", policy.authUid())
                ),
            }),
        },
    ],
});
```

Dentro de `existsIn`, `policy.field()` referencia uma coluna da outra tabela e
`policy.outerField()` uma coluna da linha que está sendo verificada. Isso compila
em uma subconsulta `EXISTS` correlacionada.

| Expressão | Compila para |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` / `policy.not(e)` | conjunção, disjunção, negação |
| `policy.compare(left, op, right)` | uma comparação; `op` é `"eq"`, `"neq"`, `"lt"`, `"lte"`, `"gt"` ou `"gte"` |
| `policy.rolesOverlap(roles)` | o chamador possui **qualquer um** desses papéis |
| `policy.rolesContain(roles)` | o chamador possui **todos** esses papéis |
| `policy.authenticated()` | um chamador autenticado |
| `policy.registered()` | um chamador autenticado com conta, não um convidado |
| `policy.serverContext()` | `rebase.uid() IS NULL`; veja o aviso abaixo |
| `policy.existsIn({ table, where })` | um `EXISTS` correlacionado sobre outra tabela; se não houver `table`, é recusado na compilação do schema |
| `policy.raw(sql)` | o SQL, inserido exatamente como escrito |

| Operando | Significado |
|---|---|
| `policy.field(name)` | uma coluna da linha sendo verificada ou, dentro de `existsIn`, da outra tabela |
| `policy.outerField(name)` | dentro de `existsIn`, uma coluna da linha sendo verificada |
| `policy.literal(value)` | uma string, número, booleano ou `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | os papéis do chamador como um array |
| `policy.authClaim(name)` | uma claim personalizada no token de sessão, convertida para o tipo da coluna com a qual é comparada |

`existsIn`, `raw` e `authClaim` são avaliados exclusivamente pelo banco de dados;
o CMS os trata como desconhecidos e reflete o que o servidor reportar.

### Raw SQL

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`using` e `withCheck` aceitam SQL. `{column}` faz referência à coluna da tabela,
e o chamador fica acessível como `rebase.uid()`, `rebase.roles()` (papéis separados
por vírgula) e `rebase.jwt()` (as claims do token como `jsonb`):

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        orgId:    col.uuid().notNull(),
        isLocked: col.boolean().notNull().default(false),
    },
    rls: [
        {
            operation: "select",
            using: "EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = {org_id} AND m.user_id = rebase.uid())",
        },
        { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" },
    ],
});
```

O SQL puro é aplicado exclusivamente pelo Postgres: o CMS não tem como avaliá-lo.
Prefira uma condição abreviada ou estruturada sempre que for possível expressar a
mesma regra.

## Avaliado uma vez por instrução

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Qualquer parte de uma regra que não leia a linha — o id do chamador, uma checagem
de papéis, uma claim, `serverContext()` — compila dentro de uma subconsulta escalar.
Uma regra de proprietário (owner) se torna `(user_id)::text = (SELECT rebase.uid())`.
O Postgres computa essa subconsulta uma única vez por instrução em vez de uma vez por
linha, planejando a execução como se a checagem passasse por metade da tabela em vez de
1,5% dela, mantendo paginações profundas de tabelas grandes nos índices adequados. Quem
pode ler ou gravar o quê permanece inalterado.

O SQL puro recebe o mesmo tratamento quando o Rebase consegue interpretar sua estrutura
(como em `owner_id = rebase.uid()`). Qualquer outra expressão é inserida exatamente como
escrita; portanto, envolva as chamadas manualmente: `(SELECT rebase.uid())`.

## `authenticated()` e `registered()`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma requisição sem nenhuma sessão recebe um ID sentinela; assim, `rebase.uid()` nunca
é `NULL` em uma requisição, e `policy.authenticated()` (assim como
`access: "authenticated"`) a exclui.

Um **convidado (guest)** funciona de forma diferente: `POST /auth/anonymous` cria uma
linha de usuário real com uma sessão real, portanto um convidado passa em qualquer
verificação que consulte o ID. `policy.registered()` (e `access: "registered"`) é
`authenticated()` mais "não ser um convidado". Use-o em qualquer lugar em que uma
regra envolva uma pessoa que deva ser responsabilizada — escrever uma avaliação, entrar
em uma organização, efetuar pagamentos — e use `authenticated()` onde convidados forem
bem-vindos: um carrinho antes do checkout, um rascunho antes do cadastro.

:::caution[`serverContext()` não é satisfeito por `dataAsAdmin`]
Ele é compilado para `rebase.uid() IS NULL`, verdadeiro apenas para os fluxos
nativos executados sem usuário (cadastro, migrações). `rebase.dataAsAdmin` executa
como `uid: "service"` com o papel `admin`, logo ele é **falso** nesse caso. Uma tabela
com `defaultPolicies: false` cuja única regra seja `serverContext()` recusará essas
gravações e não retornará linhas para essas leituras. `rebase.sql()` é o método
de acesso que ignora as políticas.
:::

## Permissivo e restritivo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Regras permissivas (o padrão) são combinadas com OR: uma linha pode ser acessada
quando qualquer uma delas a permitir. Regras restritivas são combinadas com AND
a elas: todas as regras restritivas também precisam ser satisfeitas. Uma regra
permissiva expande o acesso; uma restritiva só pode afunilá-lo. O isolamento de tenants
(tenancy) é uma regra restritiva por este motivo: uma regra `access: "public"` em
outra parte da tabela não é capaz de romper o limite do tenant.

## O que falha em modo fechado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma tabela não pode ficar acessível por acidente:

- **No editor**, `rls` é obrigatório e `[]` não é um valor válido.
- **Quando o módulo carrega**, `defineTable` lança um erro se `rls` estiver ausente,
  vazio ou não for uma das três posturas, garantindo que usos em JavaScript e casts
  também sejam capturados.
- **Quando o schema é compilado** — em `rebase db generate`, `rebase db push`,
  `rebase doctor` e na inicialização do servidor — o schema é recusado se houver
  `"inherit"` sem um `defaultRls`, `"admin-only"` com `defaultPolicies: false`, ou
  uma regra que aponte para uma coluna inexistente na tabela (em `ownerField`, em uma
  chave abreviada ou em `policy.field()`). Caso contrário, um erro de digitação em
  uma regra chegaria a `CREATE POLICY` e falharia no banco, em uma tabela com row-level
  security já ativada, deixando-a bloqueada para todos.
- **Sem um schema**, quando o backend lê as tabelas do banco de dados, qualquer tabela
  sem `ENABLE ROW LEVEL SECURITY` não é disponibilizada. A inicialização a identifica,
  indicando o comando `ALTER TABLE … ENABLE ROW LEVEL SECURITY` necessário para protegê-la.
  Consulte [Apenas backend](/docs/getting-started/headless/).

Cada requisição executa suas instruções sob um papel de banco de dados ao qual a
segurança a nível de linha se aplica, dentro de uma transação que transporta o id, os
papéis e as claims do chamador. É isso que `rebase.uid()`, `rebase.roles()` e
`rebase.jwt()` leem.

## Requisições sem sessão

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma requisição sem token atinge as políticas apenas se `AUTH_REQUIRE=false`; caso
contrário, a API responde 401 imediatamente. Ela então é executada com `rebase.uid()`
definido como `'anonymous'` e sem papéis: regras `access: "public"` a admitem,
enquanto regras `access: "authenticated"` e de proprietário a rejeitam.

Um formulário de contato aceita inserções de qualquer pessoa e é lido apenas por
administradores:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contactMessages = defineTable("contact_messages", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        email:   col.text().notNull().validate({ email: true }),
        message: col.text().notNull().validate({ max: 5000 }),
    },
    rls: [
        { operation: "insert", access: "public" },
        { operations: ["select", "update", "delete"], roles: ["admin"] },
    ],
});
```

## Linhas aqui, colunas ao lado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`rls` decide quais linhas um chamador alcança. Ele não atua sobre as colunas
de uma linha que já foi alcançada: uma regra que permita a um funcionário ler
as linhas de sua equipe permite que ele leia todas as colunas dessas linhas,
incluindo o salário. Regras específicas por coluna são definidas com
[`.access()`](/docs/collections/field-access/) na própria coluna:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().generatedByDefaultAsIdentity(),
        name:   col.text().notNull(),
        // Everyone the rules let read the row; only HR receives this column.
        salary: col.numeric({ precision: 10, scale: 2 }).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

Os papéis são exatamente os mesmos: `policy.rolesOverlap(["hr"])` em uma regra
e `.access({ read: ["hr"] })` em uma coluna referem-se ao mesmo `hr`. Regras
de coluna são aplicadas pelo servidor, cobrindo assim todas as rotas da API;
uma consulta executada por meio de `rebase.sql()` acessa todas as colunas, pois
ignora a segurança a nível de linha.

## Próximos passos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Acesso a campos](/docs/collections/field-access/): papéis de leitura e gravação por coluna
- [Tenancy](/docs/collections/tenancy/): um limite restritivo por tenant
- [Papéis e escopos](/docs/backend/roles-and-scopes/): de onde vêm os papéis
- [A tabela de usuários](/docs/schema/auth-table/): as políticas adicionadas por `defineAuthTable`
