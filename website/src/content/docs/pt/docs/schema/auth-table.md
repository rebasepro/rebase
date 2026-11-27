---
sourceHash: 6d0133e3a1068d99
title: A tabela de usuários
sidebar_label: Tabela de usuários
description: "O defineAuthTable declara a tabela na qual a autenticação armazena os usuários: as colunas de que a autenticação precisa, uma política de auto-leitura, colunas de privilégio exclusivas para admin e o modelo de acesso — roles, escopos da aplicação, chaves pessoais e os hooks do ciclo de vida do usuário."
---

`defineAuthTable` declara a tabela que a autenticação lê e escreve. É um
`defineTable` com três coisas adicionadas:

- **As colunas de que a autenticação precisa** são adicionadas quando a tabela não as declara:
  o e-mail, o hash da senha, a coluna `roles`, o estado de verificação e os
  outros campos que o login utiliza.
- **As políticas das quais a autenticação depende** são adicionadas independentemente do que o `rls` defina: um usuário autenticado
  lê a sua própria linha, e apenas um admin escreve nas colunas de privilégio, para que ninguém
  possa conceder uma role a si mesmo.
- **Um bloco `auth`** declara o modelo de acesso e os hooks que são executados quando um
  admin cria um usuário ou redefine uma senha.

```ts
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:          col.uuid().primaryKey().defaultRandom(),
        email:       col.text().notNull().unique(),
        displayName: col.text(),
        roles:       col.text({ enum: ["admin", "editor", "support"] }).array(),
        createdAt:   col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
    },
    rls: [
        // Editors may list users; everyone reads their own row through the injected policy.
        { operation: "select", roles: ["editor"] },
    ],
    auth: {
        roles: {
            support: { name: "Support", scopes: ["users:read", "users:write", "logs:read"] },
        },
        personalKeys: true,
    },
});
```

Um projeto tem, no máximo, uma tabela de usuários. Um segundo `defineAuthTable` é recusado
quando o schema é compilado; transforme-o em um `defineTable`.

`rls` é obrigatório aqui como em qualquer tabela. A auto-leitura injetada e o controle de
escrita de admin são adicionados juntamente com as suas regras, de modo que `"admin-only"` é uma postura válida:
administradores gerenciam usuários, e cada usuário ainda lê a sua própria linha.

## As colunas

Declare as colunas que a sua aplicação lê ou exibe, com os modificadores que desejar;
a autenticação adiciona aquelas de que precisa e que você omitiu. Uma coluna declarada com a
chave ou o nome SQL de uma coluna de autenticação (`email`, `displayName`, `roles`, `passwordHash`,
`emailVerified`, `createdAt`, …) é essa coluna.

Os segredos do servidor nunca saem do servidor: o hash da senha e o
token de verificação são privados, independentemente do que a declaração diga, portanto uma leitura nunca
os retorna e uma escrita do cliente não pode defini-los.

Um usuário possui uma role quando a sua coluna `roles` a lista. Declarar a coluna como
`col.text({ enum: [...] }).array()` a restringe às roles nomeadas; omiti-la
a mantém aberta, já que uma role passa a existir assim que é atribuída a um usuário.

Regras em outras tabelas podem referenciar as colunas da tabela de usuários como de costume. Uma regra na
própria tabela de usuários também pode referenciar todas as colunas de autenticação, declaradas ou não.

## Sem uma tabela de usuários

Declarar uma é opcional. A autenticação integrada sempre tem exatamente uma
tabela de usuários: sem `defineAuthTable`, a autenticação mantém seus usuários
em `rebase.users` e o servidor serve essa tabela como a tabela de autenticação.
Os usuários passam a ser uma coleção no admin como qualquer outra tabela, com
as ações de uma tabela de usuários declarada, e só administradores podem lê-la
ou gravá-la. Isso vale tanto para um projeto que declara suas tabelas quanto
para um cujas tabelas são lidas do banco de dados.

Se o projeto já tiver uma tabela chamada `users` (em qualquer schema) que não
seja sua tabela de autenticação, `rebase.users` não é servida como tabela, e a
inicialização avisa. O login continua funcionando; declare você mesmo a tabela
de usuários, com outro slug, para gerenciar os usuários como uma coleção.

Para adicionar colunas, papéis ou hooks, declare-a: parta do
`backend/schema/users.ts` do scaffold ou execute
`rebase schema introspect --users` em um banco de dados que já tenha
`rebase.users`. Ambos correspondem à tabela que a autenticação cria (uma chave
`text` e todas as colunas de autenticação), então `db push` não altera nada
nela, e uma migração de `db generate` a cria com `IF NOT EXISTS`. Depois,
adicione suas próprias colunas.

## Usuários gerenciados fora do Rebase

Um backend cujo `auth` é um [`AuthAdapter`](/docs/backend/auth-adapters/)
não serve uma tabela de usuários própria: os usuários pertencem ao adapter, e
o `userManagement` dele responde a `/api/admin/users`. Para exibi-los no admin,
declare a tabela onde eles ficam com `defineTable`, mapeada sobre as colunas
que ela tiver, como qualquer outra tabela.

## O bloco `auth`

| Chave | O que faz |
|---|---|
| `roles` | As roles que um usuário pode possuir, cada uma com um `name`, uma `description` opcional e os `scopes` do painel de administração e da aplicação que ela concede. `admin` é integrada e não pode ser declarada. |
| `scopes` | Os escopos da própria aplicação, por nome `resource:action`, cada um com um `label`, uma `description` opcional e um `target` opcional. |
| `personalKeys` | `true` permite que cada usuário crie [chaves de API pessoais](/docs/backend/api-keys/#personal-keys). |
| `onCreateUser` | Executado quando um admin cria um usuário por meio da API: retorne os valores a serem armazenados e, opcionalmente, uma senha temporária para exibir ao admin. |
| `onResetPassword` | Executado quando um admin redefine a senha de um usuário: retorne uma senha temporária ou envie o seu próprio link de redefinição. |

`roles`, `scopes` e `personalKeys` são disponibilizados com o descritor da tabela.
Os dois hooks permanecem no servidor; o descritor apenas informa quais deles existem. [Roles e escopos](/docs/backend/roles-and-scopes/)
aborda o que cada escopo concede e como chaves e tokens o restringem.

### `onCreateUser` e `onResetPassword`

```ts
import { randomBytes } from "node:crypto";
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const members = defineAuthTable("members", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        onCreateUser: async (values, ctx) => {
            const temporaryPassword = randomBytes(12).toString("base64url");
            return {
                values: { ...values, passwordHash: await ctx.hashPassword(temporaryPassword), emailVerified: true },
                temporaryPassword,
            };
        },
        onResetPassword: async (_userId, ctx) => {
            if (ctx.emailConfigured && ctx.sendEmail) {
                // Send your own reset link here and return no temporary password.
                return { invitationSent: true };
            }
            return { temporaryPassword: randomBytes(12).toString("base64url"), invitationSent: false };
        },
    },
});
```

Uma `temporaryPassword` retornada de `onResetPassword` se torna a senha da
conta: o Rebase gera o hash, salva, encerra todas as sessões do usuário e
a exibe para que o admin a repasse. Não retorne nenhuma se o hook enviar o seu próprio link de
redefinição; a senha então permanecerá como está até que o usuário defina uma nova, e as suas
sessões ainda assim serão encerradas.

Ambos os hooks recebem um contexto com:

- `hashPassword(password)`: gera o hash com o algoritmo configurado;
- `sendEmail(options)`: envia um e-mail, presente apenas quando o e-mail está configurado.
  Resolve com o que o provedor reportou (`messageId`, `accepted`,
  `rejected`);
- `emailConfigured`, `appName` e `resetPasswordUrl`.

## O que não é executado para escritas de autenticação

O cadastro, o login via OAuth e o gerenciamento de usuários feito por um admin escrevem na tabela de usuários
diretamente. Os [hooks](/docs/collections/callbacks/) da tabela não são executados para essas
escritas, portanto um e-mail de boas-vindas em `afterSave` nunca será disparado no cadastro. Coloque-o nos
hooks do ciclo de vida da autenticação (`beforeUserCreate`, `afterUserCreate`, `afterUserDelete`,
…) configurados no backend. Consulte [Autenticação](/docs/backend/authentication/).

## Próximos passos

- [Autenticação](/docs/backend/authentication/): métodos de login, tokens e os hooks de autenticação
- [Roles e escopos](/docs/backend/roles-and-scopes/): declaração de roles e escopos da aplicação
- [Segurança em nível de linha](/docs/collections/security-rules/): as políticas além das injetadas
