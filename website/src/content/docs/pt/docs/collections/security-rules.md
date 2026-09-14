---
sourceHash: 22cf5bf2953fb715
title: Regras de Segurança (RLS)
sidebar_label: Regras de Segurança
description: Defina políticas de Row Level Security para suas coleções usando atalhos de conveniência ou expressões SQL puras.
---

## Visão Geral

As regras de segurança permitem definir políticas de **Row Level Security (RLS)** para suas tabelas do PostgreSQL diretamente nas definições de coleção. Quando o schema do Drizzle é gerado, o Rebase cria as instruções `CREATE POLICY` correspondentes.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "authorId" }
    ]
});
```

## Como Funciona

1. Você define `securityRules` em uma coleção
2. `rebase schema generate` cria o schema do Drizzle com RLS habilitado
3. `rebase db push` ou `rebase db migrate` aplica as políticas ao PostgreSQL
4. Cada consulta é filtrada automaticamente pelo contexto do usuário atual

A identidade do usuário autenticado está disponível no SQL através de:

| Função | Retorno |
|----------|---------|
| `rebase.uid()` | O ID do usuário atual |
| `rebase.roles()` | IDs das roles da aplicação separados por vírgula |
| `rebase.jwt()` | Claims completos do JWT como JSONB |

Estes são definidos automaticamente por transação pelo backend do Rebase.

## Atalhos de Conveniência

### Acesso Baseado em Proprietário (Owner)

O padrão mais simples — os usuários só podem acessar as linhas das quais são proprietários:

```typescript
securityRules: [
    { operation: "all", ownerField: "user_id" }
]
```

Isso gera: `USING (user_id = rebase.uid())`

### Acesso Público

Permitir que qualquer pessoa (incluindo usuários não autenticados) leia:

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

Isso gera: `USING (true)`

### Acesso Autenticado

Permite qualquer usuário conectado (signed-in). Este é um `condition` em vez de um atalho `access` — `access` tem exatamente um valor, `"public"` — porque "conectado" é um teste contra o chamador, e o construtor é onde ficam os testes contra o chamador:

```typescript
import { policy } from "@rebasepro/types";

securityRules: [
    { operation: "select", condition: policy.authenticated() }
]
```

`policy.authenticated()` também é verdadeiro para o *login anônimo* (sign-in), que gera uma linha de usuário real e uma sessão real. Use `policy.registered()` onde um convidado (guest) não deve se qualificar — escrever uma avaliação, ingressar em uma organização, gastar dinheiro.

### Acesso Baseado em Funções (Role-based)

Restringir operações a roles específicas:

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

### Acesso Relacional / Associação (Membership)

Para delimitar o acesso pela associação em uma coleção *relacionada* — por exemplo, "apenas linhas cujo time o chamador pertence" — use a `condition` estruturada com `policy.existsIn`. Ela compila para uma única subconsulta `EXISTS` correlacionada (sem buscas por linha) e é a alternativa segura e de primeira classe para escrever o SQL puro manualmente mostrado abaixo.

```typescript
import { policy } from "@rebasepro/types";

// documents visible only to members of the document's team:
securityRules: [
    {
        operation: "select",
        condition: policy.existsIn({
            collection: "team_members",         // the join / membership collection
            where: policy.and(
                // correlate to the row being checked:
                policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
                // …and to the caller:
                policy.compare(policy.field("user_id"), "eq", policy.authUid()),
            ),
        }),
    },
]
```

Dentro de `where`, `policy.field(...)` refere-se a uma coluna da coleção associada (`team_members`), enquanto `policy.outerField(...)` refere-se a uma coluna da linha que está sendo verificada (`documents`). Combine com `policy.authUid()` para delimitar ao usuário atual. Como é imposto pelo banco de dados, a interface administrativa trata isso como de autoridade do servidor (server-authoritative).

#### O construtor `policy`, completo

Importado de `@rebasepro/types`. Expressões se compõem; operandos são as folhas.

| Expressão | Compila para |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` | conjunção / disjunção |
| `policy.not(e)` | negação |
| `policy.compare(left, op, right)` | uma comparação entre dois operandos |
| `policy.rolesOverlap(roles)` | o chamador possui **qualquer uma** destas roles da aplicação |
| `policy.rolesContain(roles)` | o chamador possui **todas** estas roles da aplicação |
| `policy.authenticated()` | conectado — `rebase.uid()` está definido **e não é uma sentinela anônima**. `IS NOT NULL` sozinho seria uma tautologia, já que uma requisição anônima define uma sentinela em vez de deixá-la indefinida |
| `policy.registered()` | conectado **com uma conta** — `authenticated()` e não um convidado. Veja abaixo |
| `policy.serverContext()` | `rebase.uid() IS NULL` — veja o aviso abaixo |
| `policy.existsIn({ collection, where })` | uma subconsulta `EXISTS` correlacionada |
| `policy.raw(sql)` | uma válvula de escape, inserida literalmente |

| Operando | Significado |
|---|---|
| `policy.field(name)` | uma coluna da coleção sendo verificada — ou, dentro de `existsIn`, da coleção associada |
| `policy.outerField(name)` | dentro de `existsIn`, uma coluna da linha externa |
| `policy.literal(value)` | uma string, número, booleano ou `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | `rebase.roles()` |

### `authenticated()` e `registered()`

Duas coisas diferentes são chamadas de anônimas, e vale a pena ser preciso sobre qual delas uma regra se refere.

Uma requisição **não autenticada** não carrega nenhuma sessão. Ela recebe um ID sentinela para que `rebase.uid()` nunca seja `NULL` no fluxo do usuário, e `policy.authenticated()` a exclui — é isso que faz com que signifique "conectado" em vez de "qualquer pessoa".

Um **convidado** (guest) é a outra coisa: uma sessão sem ninguém por trás dela. `POST /auth/anonymous` cria uma linha de usuário real com um uid real, então um convidado passa em todos os testes que verificam o id. Esse é o objetivo do recurso — um carrinho antes do checkout, um rascunho antes do cadastro — e isso significa que `authenticated()` é verdadeiro para qualquer pessoa que clicou em *Continuar como convidado*, o que não exige e-mail, nem senha e nenhum aceite de termos.

`policy.registered()` é `authenticated()` mais "não é um convidado". Use-o sempre que uma regra for sobre uma pessoa que possa ser responsabilizada por algo: escrever uma avaliação, ingressar em uma organização, gastar dinheiro. Recorra a `authenticated()` onde um convidado for genuinamente bem-vindo.

```ts
// Anyone with a session, guests included — a draft cart.
{ operation: "insert", check: policy.authenticated() }

// Someone with an account.
{ operation: "insert", check: policy.registered() }
```

Nos bastidores, a flag de convidado viaja com a sessão — ela está no token de acesso e chega ao banco de dados como `rebase.is_anonymous()` —, portanto, uma política pode fazer a verificação sem uma consulta extra. Um banco de dados atendido por um servidor antigo demais para defini-la lê cada sessão como uma conta, que é o comportamento que a implantação já possuía.

:::caution[`serverContext()` não é atendido pelo singleton do servidor]
Ele compila para `rebase.uid() IS NULL`, e `rebase.dataAsAdmin` é executado como `uid: "service"` — portanto, é **falso** para o acessador que a maioria das pessoas entende por "o servidor". Uma coleção com `disableDefaultPolicies: true` cuja única regra é `serverContext()` nega essas gravações (`42501`) e retorna zero linhas — HTTP 200, vazio — para essas leituras. `rebase.sql()` é o acessador que genuinamente ignora as políticas.
:::

## Expressões SQL Puras

Para lógicas complexas, use `using` e `withCheck`:

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

- **`using`** — Filtra quais linhas existentes são visíveis (aplica-se a SELECT, UPDATE, DELETE)
- **`withCheck`** — Valida novos valores de linha (aplica-se a INSERT, UPDATE)

As referências a colunas usam a sintaxe `{column_name}`, que é resolvida para a coluna totalmente qualificada com a tabela.

## Combinando Atalhos e SQL

Misture atalhos de conveniência com SQL puro:

```typescript
securityRules: [
    // Admins can do anything
    { operation: "all", roles: ["admin"], using: "true" },
    // Regular users can only see their own rows
    { operation: "select", ownerField: "user_id" },
    // Users can insert, but only for themselves
    { operation: "insert", withCheck: "{user_id} = rebase.uid()" },
    // Locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permissivo vs Restritivo

O PostgreSQL possui dois modos de política:

- **Permissivo** (padrão) — Múltiplas políticas permissivas são combinadas com **OR**. Se qualquer uma passar, o acesso é concedido.
- **Restritivo** — Políticas restritivas são combinadas com **AND**. Todas devem passar.

```typescript
securityRules: [
    // Permissive: owners can access their rows
    { operation: "all", ownerField: "user_id" },
    // Restrictive: but locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Operações

| Operação | Equivalente em SQL | Descrição |
|-----------|---------------|-------------|
| `"select"` | `SELECT` | Ler linhas |
| `"insert"` | `INSERT` | Criar novas linhas |
| `"update"` | `UPDATE` | Modificar linhas existentes |
| `"delete"` | `DELETE` | Remover linhas |
| `"all"` | Todas as anteriores | Abreviação para todas as operações |

Você também pode usar `operations` (plural) para aplicar uma regra a múltiplas operações:

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "authorId" }
```

## Interface Completa de SecurityRule

`SecurityRule` é uma **union**, não um único objeto aberto: uma regra escolhe exatamente uma forma de expressar seu predicado, e as outras são tipadas como `never`, de modo que misturá-las gera um erro de compilação em vez de uma política que ignora silenciosamente metade do que você escreveu.

```typescript no-verify
// Shared by every variant
interface SecurityRuleBase {
    name?: string;                        // Policy name. Omit it and one is derived
    operation?: SecurityOperation;        // "select" | "insert" | "update" | "delete" | "all"
    operations?: SecurityOperation[];     // …or several at once
    mode?: "permissive" | "restrictive";  // Default: "permissive"
    roles?: string[];                     // App roles, via rebase.roles()
    pgRoles?: string[];                   // Native Postgres roles — the CREATE POLICY `TO` clause.
                                          // NOT the same as `roles`. Default: ["public"]
}

// …plus exactly one of:
{ ownerField: string }                        // <column> = rebase.uid()
{ access: "public" }                          // the one shortcut — "no row filter"
{ condition: PolicyExpression;                // the structured builder — `policy.*`
  check?: PolicyExpression }                  // defaults to `condition`, as Postgres does
{ using?: string; withCheck?: string }        // raw SQL
```

`roles` e `pgRoles` são as duas que geram confusão. `roles` é uma role da aplicação, imposta *dentro* da cláusula `USING` / `WITH CHECK` através de `rebase.roles()`. `pgRoles` é uma role do banco de dados e controla a quais conexões a política está vinculada. Quase todos os projetos precisam de `roles`.

:::tip[Preenchendo a coluna indicada por ownerField]
`ownerField` compara uma coluna com `rebase.uid()`; ele não insere nada nela. Declare essa coluna como uma string com [`autoValue: "user_on_create"`](/docs/collections/properties#audit-columns) e o driver registrará o uid do usuário atuante na inserção, sobrescrevendo qualquer coisa enviada no corpo da requisição — o que torna a premissa da política verdadeira. Uma coluna fornecida pelo chamador é uma coluna sobre a qual o chamador pode mentir.
:::

## Exemplos

### Plataforma de Blog

```typescript
securityRules: [
    // Anyone can read published posts
    { operation: "select", using: "{status} = 'published'" },
    // Authors can see their own drafts
    { operation: "select", ownerField: "authorId" },
    // Authors can create and edit their own posts
    { operations: ["insert", "update"], ownerField: "authorId" },
    // Only admins can delete
    { operation: "delete", roles: ["admin"] }
]
```

### SaaS Multi-Tenant

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

## Acesso Anônimo (Inserções Públicas)

Uma necessidade comum é permitir que **usuários não autenticados** enviem dados — formulários de contato, inscrições em newsletters, candidaturas públicas. O Rebase oferece um padrão limpo para isso.

### Recomendado: uma regra `withCheck` pura

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const contactMessagesCollection = defineCollection({
    slug: "contact_messages",
    name: "Contact Messages",
    table: "contact_messages",
    securityRules: [
        // Anyone can submit a contact message
        {
            operation: "insert",
            // A raw rule carries `using` (which rows are visible) and `withCheck`
            // (what a write must satisfy); an insert only exercises the latter.
            using: "true",
            withCheck: "true"
        },
        // Only admins can read, update, or delete messages
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

O atalho `access: "public"` gera uma política que permite a operação sem exigir autenticação.

### Para Captura de Leads / Cadastros

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const leadSignupsCollection = defineCollection({
    slug: "lead_magnet_signups",
    name: "Lead Magnet Signups",
    table: "lead_magnet_signups",
    securityRules: [
        // Allow anonymous inserts
        { operation: "insert", using: "true", withCheck: "true" },
        // Admins can view all signups
        { operation: "select", roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

### Como Funcionam as Requisições Anônimas

Quando uma requisição chega sem um token JWT, o backend do Rebase define as variáveis de sessão do PostgreSQL como:

| Variável | Valor |
|----------|-------|
| `app.user_id` | `'anonymous'` |
| `app.user_roles` | `''` (vazio) |

Isso significa que:

- `rebase.uid()` retorna `'anonymous'`
- `rebase.roles()` retorna uma string vazia
- As políticas `access: "public"` passam porque geram `USING (true)` / `WITH CHECK (true)`
- As condições `policy.authenticated()` falham porque verificam a existência de um ID de usuário real
- As políticas `ownerField` falham porque nenhuma linha terá `user_id = 'anonymous'` (a menos que explicitamente definido)

### Avançado: SQL Puro para Anônimos

Se precisar de um controle mais granular, use SQL puro:

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "rebase.uid() = 'anonymous' OR rebase.uid() IS NOT NULL"
    }
]
```

:::tip
Evite o padrão legado de verificar `string_to_array(rebase.roles(), ',')` para acesso anônimo. O atalho `access: "public"` é mais simples e gera a política correta automaticamente.
:::

## Linhas aqui, campos ao lado

As regras de segurança respondem a uma pergunta: **a quais linhas** esse chamador tem acesso. Elas são aplicadas pelo próprio Postgres, em cada instrução, independentemente da rota — e é por isso que são o modelo de autorização e tudo acima delas é conveniência.

Elas não interferem nas *colunas* de uma linha que o chamador acessa. Uma política que permite a um funcionário ler as linhas da sua equipe permite que ele leia todos os campos dessas linhas, salário incluído. É para isso que serve o [`access`](/docs/collections/field-access/) por propriedade:

```typescript
salary: {
    type: "number",
    // Everyone the rules above let read the row; only HR gets this column.
    access: { read: ["hr"], write: [] }
}
```

Os dois se sobrepõem e nunca se contradizem: uma regra de campo não pode ampliar o acesso a linhas, e uma linha que você não pode ler não tem campos dos quais falar. As roles são as mesmas roles — `rebase.roles()` dentro de uma política, `user.roles` na requisição —, portanto, `rolesOverlap(['hr'])` em uma regra e `access: { read: ["hr"] }` em uma propriedade significam o mesmo `hr`. As regras de campo são aplicadas pelo servidor e não pelo Postgres, cobrindo assim a superfície da API; uma consulta executada via `rebase.sql()` vê todas as colunas, exatamente da mesma forma que ignora o RLS.

## Próximos Passos

- **[Acesso a campos](/docs/collections/field-access)** — Roles de leitura/gravação por campo
- **[Relações](/docs/collections/relations)** — Chaves estrangeiras e joins
- **[Callbacks de Entidade](/docs/collections/callbacks)** — Hooks de ciclo de vida
- **[Funções Customizadas](/docs/backend/custom-functions)** — Endpoints de API customizados
