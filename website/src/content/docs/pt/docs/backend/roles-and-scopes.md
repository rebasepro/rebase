---
sourceHash: fe0da2499f512a69
title: Papéis e escopos
sidebar_label: Papéis e escopos
description: "O que um chamador pode fazer: o plano de dados que toda pessoa tem, o plano administrativo que os papéis concedem, os escopos que um app declara para si mesmo e como cada credencial os carrega."
---

<span class="since-badge" data-since="0.24">Desde 0.24</span> Toda requisição a um backend Rebase faz uma pergunta: este chamador pode fazer isto?
A resposta é um **escopo**, uma string no formato `resource:action`: `data:read`,
`users:write`, `cron:read`. A sessão de uma pessoa, uma chave de API, um token MCP e um
papel têm escopos, e todos usam as mesmas strings. Uma concessão se lê da mesma forma
em uma chave, em um papel e em uma tela de consentimento.

## Dois planos

Os escopos se dividem em dois planos, e uma pessoa os tem de formas diferentes.

**O plano de dados** é `data:*`, `storage:*` e `functions:invoke`. Toda
pessoa autenticada tem todo ele. O que uma pessoa pode fazer com uma linha é decidido pelas
[regras de segurança](/docs/collections/security-rules/) da coleção, linha por linha,
e o que ela pode fazer com um arquivo, pelas [políticas de storage](/docs/backend/storage/#per-object-authorization).
Um escopo nunca decide isso para uma pessoa. Em uma chave ou em um token, os escopos do plano de dados
restringem: uma chave que tem apenas `data:read:posts` lê `posts` e nada mais,
seja o que for que as regras permitiriam.

**O plano administrativo** é todo o resto: usuários, esquema, o banco de dados, backups,
cron, logs e chaves. Ninguém o tem implicitamente. O papel embutido `admin` tem
todo ele. Qualquer outro papel tem o que o app declara para ele.

## Os escopos

| Escopo | Plano | Alvo | O que permite |
|---|---|---|---|
| `data:read` | dados | coleção | Ler linhas, através da row-level security do chamador |
| `data:write` | dados | coleção | Criar e atualizar linhas, através da row-level security do chamador |
| `data:delete` | dados | coleção | Excluir linhas, através da row-level security do chamador |
| `storage:read` | dados | fonte de storage | Listar e baixar arquivos |
| `storage:write` | dados | fonte de storage | Enviar arquivos e criar pastas |
| `storage:delete` | dados | fonte de storage | Excluir arquivos |
| `functions:invoke` | dados | função | Chamar funções personalizadas. Uma função pode fazer tudo o que seu código faz |
| `users:read` | administrativo | — | Listar contas e seus papéis |
| `users:write` | administrativo | — | Criar, editar e excluir contas, redefinir senhas e segundos fatores, atribuir papéis até os do próprio titular |
| `schema:read` | administrativo | — | Ler o esquema das coleções, planejar alterações de esquema, executar a auditoria de RLS, ler a documentação privada da API |
| `schema:write` | administrativo | — | Aplicar alterações de esquema: edita os arquivos de coleção e altera o banco de dados |
| `database:read` | administrativo | — | Listar bancos de dados, tabelas, papéis do Postgres e branches |
| `database:write` | administrativo | — | Executar SQL como dono do banco de dados, fora da row-level security, e criar ou excluir branches |
| `backups:read` | administrativo | — | Listar e baixar backups: todas as linhas, fora da row-level security |
| `cron:read` | administrativo | — | Listar cron jobs e ler seu histórico de execuções |
| `cron:write` | administrativo | — | Disparar cron jobs e ativá-los ou desativá-los |
| `logs:read` | administrativo | — | Ler os logs do servidor |
| `keys:read` | administrativo | — | Listar as chaves de serviço do projeto. Nunca pode ser concedido a uma chave |
| `keys:write` | administrativo | — | Criar, alterar e revogar chaves de serviço. Nunca pode ser concedido a uma chave |

`GET /api/auth/scopes` retorna esta lista para o backend em execução, com os escopos
do próprio app acrescentados, mais os escopos que o chamador tem. Qualquer chamador autenticado pode lê-la:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Alvos

Um escopo do plano de dados pode ser restringido a um alvo, depois de um segundo dois-pontos:

- `data:read:posts` lê apenas a coleção `posts`. O alvo é o slug de uma coleção.
- `storage:write:avatars` envia arquivos apenas para a fonte de storage `avatars`. O
  id da fonte padrão é `(default)`: `storage:read:(default)`.
- `functions:invoke:export` chama apenas a função `export`.

O escopo simples cobre todos os alvos. Um escopo restrito cobre o próprio alvo e
nada mais. Ele nunca responde a uma pergunta sobre todos os alvos: uma chave que tem
`data:read:posts` não pode listar todas as coleções.

Os escopos do plano administrativo não aceitam alvo. Um escopo de app aceita um quando declara um
`target`, como abaixo.

## Declarando papéis

<span class="since-badge" data-since="0.24">Desde 0.24</span> Os papéis são declarados na coleção de usuários, em `auth.roles`. Um papel é um nome
que o banco de dados vê, ao qual as políticas de RLS podem corresponder, mais uma lista de escopos do plano
administrativo e de escopos de app.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"]
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"]
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" },
        roles: {
            name: "Roles",
            type: "array",
            columnType: "text[]",
            of: {
                name: "Role",
                type: "string",
                enum: { admin: "Admin", support: "Support", developer: "Developer", editor: "Editor" }
            }
        }
    }
});
```

Uma pessoa tem um papel quando sua coluna `roles` o lista. Atribua-o no painel
administrativo, ou com `PUT /api/admin/users/:uid`.

A inicialização recusa uma declaração que se leria como uma concessão que ela não é:

- **`admin` não pode ser declarado.** Ele é embutido e tem todos os escopos.
- **Um papel não pode listar um escopo do plano de dados.** Toda pessoa já tem o plano
  de dados. `data:write` em um papel não concederia nada e pareceria conceder
  algo. O que um papel pode fazer com linhas pertence às `securityRules` da coleção.
- **Todo escopo precisa existir.** Um nome desconhecido faz a inicialização falhar e lista os válidos.

Um papel que você não declara continua sendo um papel. `editor` acima não tem entrada, então
não tem nenhum escopo do plano administrativo, e uma política de RLS ainda pode corresponder a ele.

`defaultRole`, o papel que todo novo cadastro recebe, não pode ser `admin` nem um
papel declarado que tenha algum escopo do plano administrativo. Um desconhecido que se cadastra não deve
ter nada que gerencie o projeto. A inicialização o recusa.

:::note[`schema-admin` não existe mais]
Versões anteriores tratavam um papel chamado `schema-admin` como um segundo administrador. Agora ele
não significa nada por si só. Se o seu projeto o usava, declare-o com os escopos
que você pretendia, por exemplo
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` lista `admin` e cada papel declarado com seus escopos. Ele
requer `users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## Escopos de app

Um app pode nomear suas próprias operações como escopos, em `auth.scopes`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project"
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

O nome é `resource:action`, em minúsculas, sem alvo. Ele não pode reutilizar um
recurso embutido: `data`, `storage`, `functions`, `users`, `schema`,
`database`, `backups`, `cron`, `logs` e `keys` já estão em uso. `label` é obrigatório,
porque é o que uma pessoa lê quando concede o escopo. `target` diz o que
um alvo significa, para que uma chave possa ter `project:deploy:p1`.

Toda pessoa autenticada tem todos os escopos de app. Assim como no plano de dados, o código
por trás do escopo decide se esta pessoa pode agir. O escopo existe para que
uma chave possa ser restringida a essa única ação. Um papel também pode listar escopos de app.

Verifique um deles em uma [função personalizada](/docs/backend/custom-functions/) com `requireScope`:

```typescript
import { defineFunction, requireAuth, requireScope, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post(
        "/:project",
        requireAuth,
        requireScope("project:deploy", c => c.req.param("project")),
        async (c) => {
            // A person always passes requireScope. Decide here whether
            // this person may deploy this project.
            return c.json({ project: c.req.param("project"), by: getUserId(c) });
        }
    );
});
```

Uma chave que tem `project:deploy:p1` passa para `p1` e recebe `403 SCOPE_MISSING`
para qualquer outro projeto. Ela também precisa de `functions:invoke`, ou de
`functions:invoke:<name>` para esta função, para sequer alcançar a função.
`hasScope(c, scope, target)` e `getScopes(c)` respondem à mesma pergunta dentro de um
handler.

## O que admin significa

`admin` é o único papel embutido, e é mais do que uma lista de escopos:

- Ele tem todos os escopos do plano administrativo, `keys:*` incluído.
- É um papel que o banco de dados vê. As políticas padrão que o Rebase adiciona a cada
  coleção o admitem, então um administrador lê e escreve todas as linhas de uma coleção
  que as mantém. Uma coleção com `disableDefaultPolicies: true` as descarta.
- Apenas um administrador pode conceder `admin`. Um papel que lista todos os escopos do plano administrativo
  ainda não é `admin`: ele não pode distribuir `admin`, e as políticas padrão não
  o admitem.

`requireAdmin` verifica o papel. Prefira `requireScope` para qualquer coisa que um papel
mais restrito ou uma chave deva poder fazer.

## Ninguém concede mais do que tem

Uma regra cobre todas as portas que distribuem acesso: **nada é concedido com mais
do que quem concede tem.**

Para chaves:

- Os escopos de uma chave devem estar dentro dos escopos do seu criador. Caso contrário, `403 SCOPE_EXCEEDS_CREATOR`.
- Os papéis de RLS de uma chave de serviço devem ser papéis que seu criador tem, a menos que o criador
  seja administrador. Caso contrário, `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` e `keys:write` nunca vão em uma chave. Uma chave que gerencia chaves poderia
  criar a própria sucessora. `400 KEY_MANAGEMENT_SCOPE`.

Para contas, quem tem `users:write`:

- não pode editar, redefinir ou excluir uma conta que tenha um papel ou escopo que ele não tem:
  `403 ACCOUNT_OUTRANKS_CALLER`. Sem isso, um papel de suporte poderia redefinir a senha
  de um administrador e entrar como ele.
- não pode conceder papéis que tenham mais do que ele tem: `403 ROLE_EXCEEDS_CALLER`.

## Como cada credencial tem escopos

| Credencial | Age como | Tem |
|---|---|---|
| A sessão de uma pessoa | a pessoa | o plano de dados, todos os escopos de app e os escopos dos seus papéis. Um administrador tem tudo |
| [Chave de serviço](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, com os papéis de RLS `service` mais os próprios `roles` | exatamente seus escopos |
| [Chave pessoal](/docs/backend/api-keys/#personal-keys) `rk_live_…` | seu proprietário, com os papéis do proprietário como estão a cada requisição | seus escopos, reduzidos ao que o proprietário tem agora |
| [Token MCP](/docs/ai/mcp/#the-remote-endpoint) | a pessoa que o conectou | `data:read`, `data:write`, `data:delete` conforme concedidos, opcionalmente por coleção |
| `REBASE_SERVICE_KEY` | `service`, com o papel `admin` | tudo |

Uma chave ou um token nunca ignora a row-level security. Seus escopos são um teto,
e as políticas do banco de dados para a identidade como a qual ele age são outro.

## Quando falta um escopo

<span class="since-badge" data-since="0.24">Since 0.24</span> A resposta é `403 SCOPE_MISSING`, e `details.requiredScope` nomeia o escopo,
com seu alvo quando há um:

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Para uma pessoa, a solução é um papel que liste o escopo. Para uma chave, é uma nova chave
que o tenha.

## Próximos passos

- [Chaves de API](/docs/backend/api-keys/): chaves de serviço, chaves pessoais e as regras de emissão
- [Regras de Segurança (RLS)](/docs/collections/security-rules/): o que uma pessoa pode fazer com cada linha
- [Índice de endpoints](/docs/backend/endpoints/): o escopo que cada rota requer
- [Códigos de erro](/docs/backend/errors/#authentication-and-accounts): cada recusa acima
