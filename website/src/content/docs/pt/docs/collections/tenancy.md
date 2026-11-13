---
sourceHash: 9338d2b094861fba
title: Tenancy
sidebar_label: Tenancy
description: Defina o escopo de cada linha de uma tabela para um site, organização ou workspace com uma única declaração de tenant, aplicada pelo row-level security do Postgres.
---

## O que ele faz

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`tenant` em uma tabela define a coluna que armazena o tenant ao qual uma linha
pertence (um site, uma organização, um workspace) e especifica de onde o tenant do
chamador é originado. A partir dessa única declaração, o Rebase gera:

- **Uma política RLS restritiva**, `<table>_tenant_scope`. Políticas restritivas
  são combinadas com `AND` a qualquer outra política na tabela, portanto a tenancy restringe o que o
  `rls` da tabela permite e nunca o amplia. Uma regra
  `access: "public"` em outro lugar do arquivo não consegue remover esse limite.
- **Uma coluna `NOT NULL` e indexada.** Uma linha sem tenant não pertenceria a ninguém,
  e uma coluna de tenant não indexada transformaria qualquer leitura em uma busca sequencial (sequential scan).
- **O tenant nas operações de escrita.** Uma criação que deixa o campo vazio recebe o
  tenant do chamador quando este possui exatamente um. Qualquer valor ambíguo ou desconhecido é
  recusado (veja [Escritas](#escritas)).
- **Um trigger que mantém as linhas no seu tenant.** Uma atualização que move uma linha para
  outro tenant é recusada, tanto na API quanto no SQL executado como o chamador.

Como o Postgres aplica essas restrições, o painel de administração, a API REST, o SDK e o SQL
executado como o chamador veem todos as mesmas linhas.

## Um tenant por usuário: uma claim

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Quando cada usuário pertence a exatamente um tenant, inclua-o em seu token de sessão
e especifique o nome da claim:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        siteId: col.uuid().notNull(),
        title:  col.text().notNull(),
    },
    tenant: { field: "siteId", from: { claim: "site_id" } },
    rls: [{ operation: "all", access: "authenticated" }],
});
```

A política compara o `site_id` da linha com a claim `site_id`, convertida para o
tipo da coluna. A
claim vem do seu provedor de identidade ou do hook de autenticação
`customizeAccessToken` (`auth.hooks`, veja [Autenticação](/docs/backend/authentication/);
o runtime gerenciado não possui rotas para hooks, portanto isso requer um backend ejetado).
Claims reservadas como `uid`, `roles` e `aal` não podem nomear um tenant: elas
são gravadas após as claims customizadas, logo um hook não pode sobrescrevê-las, e uma configuração
que utiliza uma delas será recusada.

## Vários tenants por usuário: uma tabela de membros

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Quando as pessoas trabalham em vários tenants (um editor em dois sites, um consultor em três
organizações), mantenha as associações em uma tabela própria:

```ts
// backend/schema/site-members.ts
import { defineTable, col } from "@rebasepro/server/schema";

// One row per person per site they work on.
export const siteMembers = defineTable("site_members", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        userId: col.uuid().notNull(),
        siteId: col.uuid().notNull(),
    },
    // Members read their own rows. Required: the tenancy policy reads this
    // table as the caller, so without it nobody but an admin sees a post.
    rls: [{ operation: "select", ownerField: "userId" }],
});
```

```ts
// backend/schema/posts.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        siteId: col.uuid().notNull(),
        title:  col.text().notNull(),
    },
    tenant: {
        field: "siteId",
        from: { membership: { table: "site_members", userField: "userId", tenantField: "siteId" } },
    },
    rls: [{ operation: "all", access: "authenticated" }],
});
```

`membership.table` é o identificador (slug) da tabela de associação; `userField` e
`tenantField` são chaves de coluna nela.

A política é um `EXISTS` correlacionado sobre `site_members`: "o chamador é um
membro do site desta linha?", respondido na mesma consulta. Nada é inserido no
token, portanto adicionar ou remover uma associação passa a ter efeito na instrução seguinte,
sem a necessidade de fazer login novamente.

A tabela de associação deve permitir que os chamadores leiam suas próprias linhas, porque uma
política é avaliada como o usuário que faz a consulta e o próprio RLS da tabela de associação
é aplicado dentro dela. A inicialização (boot) recusa configurações onde isso não acontece, e o erro indica
a regra a ser adicionada. A inicialização também recusa uma tabela de membros que não existe, não possui qualquer uma
das colunas especificadas ou não está armazenada no mesmo banco de dados Postgres.

## A quem ele não se aplica

`bypassRoles` lista as roles que leem e escrevem em todos os tenants. O
padrão é `["admin"]`, para que o painel de administração não exiba uma tabela vazia
para um admin. Um array vazio significa que nenhuma role faz o bypass; o contexto
confiável do próprio servidor (migrações, fluxos de autenticação) continua fazendo.

```typescript
tenant: { field: "siteId", from: { claim: "site_id" }, bypassRoles: ["admin", "support"] }
```

## Escritas

Toda recusa é um erro `400` que indica o campo, antes que o banco de dados seja consultado:

| Código | Quando |
|---|---|
| `TENANT_REQUIRED` | Uma criação deixou o campo vazio e o chamador não possui nenhum tenant, ou pertence a vários. Envie o tenant na escrita |
| `TENANT_MISMATCH` | A escrita especifica um tenant ao qual o chamador não pertence |
| `TENANT_IMMUTABLE` | Uma atualização moveria a linha para outro tenant. Crie-a no outro tenant e delete esta, ou faça isso usando uma role listada em `bypassRoles` |

O SQL executado como o chamador recebe as mesmas respostas do Postgres: o `WITH CHECK`
da política recusa um tenant externo, e um trigger `BEFORE UPDATE` recusa uma
transferência (`42501`). Um chamador em uma role de bypass fica isento de todos os três casos.

## O campo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- Uma coluna de texto, `uuid`, enum ou inteiro (`numeric` também), ou uma relação
  `belongsTo` para a tabela de tenants. No caso de uma relação, sua coluna de chave estrangeira é
  o campo; nenhuma segunda coluna é criada.
- Deve ser declarado na tabela e ser legível: o esquema é recusado quando o
  campo está ausente, é de outro tipo ou está restrito por `.private()` ou
  `.access({ read })`. Os tipos verificam se o campo faz referência a uma coluna válida.
- A coluna torna-se `NOT NULL` independentemente de como foi declarada, e é indexada.
- Não pode ser em uma view: o row-level security é o que garante a imposição da regra.

## O que ele não cobre

- **Arquivos.** Uploads não são linhas. Defina o escopo deles por caminho usando a
  [autorização de armazenamento](/docs/backend/storage-authorization/), por exemplo, uma
  pasta por site.
- **Navegação.** As tabelas são exibidas ou ocultadas no CMS por role, não por
  tenant. Um membro de um site vê as mesmas tabelas que todos os outros, contendo
  apenas as linhas do seu site.
- **Infraestrutura separada.** Todos os tenants compartilham o mesmo banco de dados e o mesmo servidor.
  Quando os tenants não puderem compartilhar infraestrutura de forma alguma, forneça a cada um seu próprio
  deployment.

## Relacionados

- [Row-level security](/docs/collections/security-rules/): as regras com as quais a tenancy é combinada via AND
- [Acesso a campos](/docs/collections/field-access/): permissões de leitura e escrita por campo
- [Autorização de armazenamento](/docs/backend/storage-authorization/): quem lê e grava quais arquivos
