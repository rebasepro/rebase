---
sourceHash: c7bebbe33f0a0611
title: A tabela de usuários
sidebar_label: Tabela de usuários
description: "defineAuthTable declara a tabela na qual a autenticação armazena os usuários: as colunas de que a autenticação precisa, uma política de auto-leitura, colunas de privilégio exclusivas para administradores e o modelo de acesso — roles, escopos de aplicativo, chaves pessoais e os hooks de ciclo de vida do usuário."
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`defineAuthTable` declara a tabela que a autenticação lê e escreve. É um
`defineTable` com três adições:

- **As colunas de que a autenticação precisa** são adicionadas quando a tabela não as declara:
  o e-mail, o hash da senha, a coluna `roles`, o estado de verificação e
  os outros campos utilizados pelo login.
- **As políticas das quais a autenticação depende** são adicionadas independentemente do que o `rls` disser: um usuário autenticado
  lê sua própria linha, e apenas um administrador grava nas colunas de privilégio, para que ninguém
  possa conceder uma role a si mesmo.
- **Um bloco `auth`** declara o modelo de acesso e os hooks executados quando um
  administrador cria um usuário ou redefine uma senha.

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

Um projeto tem no máximo uma tabela de usuários. Um segundo `defineAuthTable` é recusado
quando o schema é compilado; torne-o um `defineTable`.

O `rls` é obrigatório aqui como em qualquer tabela. A auto-leitura injetada e a barreira
de escrita para administradores são adicionadas junto às suas regras, portanto `"admin-only"` é uma postura válida:
administradores gerenciam usuários, e cada usuário ainda lê sua própria linha.

## As colunas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Declare as colunas que seu aplicativo lê ou apresenta, com os modificadores que desejar;
a autenticação adiciona aquelas de que precisa e que você omitiu. Uma coluna declarada com a
chave ou o nome SQL de uma coluna de autenticação (`email`, `displayName`, `roles`, `passwordHash`,
`emailVerified`, `createdAt`, …) é essa coluna.

Os segredos do servidor nunca saem do servidor: o hash da senha e o
token de verificação são privados, independentemente do que a declaração diga, portanto uma leitura nunca
os retorna e uma escrita do cliente não pode defini-los.

Um usuário possui uma role quando sua coluna `roles` a lista. Declarar a coluna como
`col.text({ enum: [...] }).array()` a restringe às roles especificadas; omitir
isso a mantém aberta, visto que uma role passa a existir assim que é atribuída a um usuário.

Regras em outras tabelas podem referenciar as colunas da tabela de usuários normalmente. Uma regra na
própria tabela de usuários também pode referenciar todas as colunas de autenticação, declaradas ou não.

## O bloco `auth`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Chave | O que faz |
|---|---|
| `roles` | As roles que um usuário pode ter, cada uma com um `name`, uma `description` opcional e os `scopes` de aplicativo e de plano de administração concedidos. O `admin` é integrado e não pode ser declarado. |
| `scopes` | Os escopos do próprio aplicativo, pelo nome `resource:action`, cada um com um `label`, uma `description` opcional e um `target` opcional. |
| `personalKeys` | `true` permite que cada usuário crie [chaves de API pessoais](/docs/backend/api-keys/#personal-keys). |
| `onCreateUser` | Executado quando um administrador cria um usuário por meio da API: retorne os valores a serem armazenados e, opcionalmente, uma senha temporária para exibir ao administrador. |
| `onResetPassword` | Executado quando um administrador redefine a senha de um usuário: retorne uma senha temporária ou envie seu próprio link de redefinição. |

`roles`, `scopes` e `personalKeys` são disponibilizados com o descritor da tabela.
Os dois hooks permanecem no servidor; o descritor apenas informa quais deles existem. [Roles e escopos](/docs/backend/roles-and-scopes/)
aborda o que cada escopo concede e como chaves e tokens o restringem.

### `onCreateUser` e `onResetPassword`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

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

Uma `temporaryPassword` retornada de `onResetPassword` torna-se a senha da
conta: o Rebase calcula o hash, salva-o, encerra todas as sessões do usuário e
exibe a senha ao administrador para repasse. Não retorne nenhuma senha quando o hook enviar seu próprio link
de redefinição; a senha permanecerá como está até que o usuário defina uma nova, e suas
sessões ainda serão encerradas.

Ambos os hooks recebem um contexto com:

- `hashPassword(password)`: calcula o hash com o algoritmo configurado;
- `sendEmail(options)`: envia um e-mail, presente apenas quando o e-mail estiver configurado.
  Retorna o que o provedor reportou (`messageId`, `accepted`,
  `rejected`);
- `emailConfigured`, `appName` e `resetPasswordUrl`.

## O que não é executado em operações de escrita da autenticação

<span class="since-badge" data-since="0.31">Desde 0.31</span>

O cadastro, o login via OAuth e o gerenciamento de usuários por administradores escrevem na tabela de usuários
diretamente. Os [hooks](/docs/collections/callbacks/) da tabela não são executados para essas
operações de escrita, portanto um e-mail de boas-vindas em `afterSave` nunca é disparado no cadastro. Configure-o
nos hooks de ciclo de vida de autenticação (`beforeUserCreate`, `afterUserCreate`, `afterUserDelete`,
…) configurados no backend. Consulte [Autenticação](/docs/backend/authentication/).

## Próximos passos

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- [Autenticação](/docs/backend/authentication/): métodos de login, tokens e os hooks de autenticação
- [Roles e escopos](/docs/backend/roles-and-scopes/): declaração de roles e escopos de aplicativo
- [Segurança em nível de linha](/docs/collections/security-rules/): as políticas em conjunto com as injetadas
