---
sourceHash: 3b3d8ad69537b827
title: Roles e escopos
sidebar_label: Roles e escopos
description: "O que um chamador pode fazer: o plano de dados que cada pessoa possui, o plano administrativo que as roles concedem, os escopos que um app declara para si mesmo e como cada credencial os carrega."
---

Toda requisição para um backend do Rebase faz uma pergunta: este chamador pode fazer isso?
A resposta é um **escopo**, uma string no formato `recurso:ação`: `data:read`,
`users:write`, `cron:read`. A sessão de uma pessoa, uma chave de API, um token MCP e uma
role possuem escopos, e todos eles usam as mesmas strings. Uma concessão é lida da mesma
forma em uma chave, em uma role e em uma tela de consentimento.

## Dois planos

Os escopos são divididos em dois planos, e uma pessoa os possui de maneiras diferentes.

**O plano de dados** é `data:*`, `storage:*` e `functions:invoke`. Toda
pessoa autenticada possui tudo dele. O que uma pessoa pode fazer com uma linha é decidido pelo
[row-level security](/docs/collections/security-rules/) da tabela, linha por linha,
e o que ela pode fazer com um arquivo pelas [políticas de armazenamento](/docs/backend/storage-authorization/).
Um escopo nunca decide isso para uma pessoa. Em uma chave ou token, os escopos do plano de dados
restringem-se: uma chave que possui apenas `data:read:posts` lê `posts` e nada mais,
independentemente do que as regras permitiriam.

**O plano administrativo** é todo o resto: usuários, esquema, banco de dados, backups,
cron, logs e chaves. Ninguém o possui implicitamente. A role integrada `admin` possui
tudo dele. Qualquer outra role possui o que a aplicação declarar para ela.

## Os escopos

| Escopo | Plano | Alvo | O que permite |
|---|---|---|---|
| `data:read` | dados | coleção | Ler linhas, por meio do row-level security do chamador |
| `data:write` | dados | coleção | Criar e atualizar linhas, por meio do row-level security do chamador |
| `data:delete` | dados | coleção | Excluir linhas, por meio do row-level security do chamador |
| `storage:read` | dados | fonte de armazenamento | Listar e baixar arquivos |
| `storage:write` | dados | fonte de armazenamento | Fazer upload de arquivos e criar pastas |
| `storage:delete` | dados | fonte de armazenamento | Excluir arquivos |
| `functions:invoke` | dados | função | Chamar funções personalizadas. Uma função pode fazer qualquer coisa que seu código faça |
| `users:read` | admin | — | Listar contas e suas roles |
| `users:write` | admin | — | Criar, editar e excluir contas, redefinir senhas e segundos fatores, atribuir roles até as próprias do detentor |
| `schema:read` | admin | — | Ler o esquema, planejar alterações de esquema, executar a auditoria de RLS, ler os documentos da API privada |
| `schema:write` | admin | — | Aplicar alterações de esquema: edita os arquivos de esquema e altera o banco de dados |
| `database:read` | admin | — | Listar bancos de dados, tabelas, roles do Postgres e branches |
| `database:write` | admin | — | Executar SQL como proprietário do banco de dados, fora do row-level security, e criar ou excluir branches |
| `backups:read` | admin | — | Listar e baixar backups: todas as linhas, fora do row-level security |
| `cron:read` | admin | — | Listar tarefas cron e ler o histórico de execuções |
| `cron:write` | admin | — | Disparar tarefas cron e ativá-las ou desativá-las |
| `logs:read` | admin | — | Ler os logs do servidor |
| `keys:read` | admin | — | Listar as chaves de serviço do projeto. Nunca concedível a uma chave |
| `keys:write` | admin | — | Criar, alterar e revogar chaves de serviço. Nunca concedível a uma chave |

`GET /api/auth/scopes` retorna esta lista para o backend em execução, com os
escopos próprios do app adicionados, além dos escopos que o chamador possui. Qualquer chamador autenticado pode
lê-la:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Alvos

Um escopo do plano de dados pode ser restringido a um único alvo, após um segundo dois-pontos:

- `data:read:posts` lê apenas a tabela `posts`. O alvo é o slug de uma tabela.
- `storage:write:avatars` faz upload apenas para a fonte de armazenamento `avatars`. O
  id da fonte padrão é `(default)`: `storage:read:(default)`.
- `functions:invoke:export` chama apenas a função `export`.

O escopo simples cobre todos os alvos. Um escopo restringido cobre seu próprio alvo e
nada mais. Ele nunca responde a uma pergunta sobre todos os alvos: uma chave que possui
`data:read:posts` não pode listar todas as tabelas.

Os escopos do plano administrativo não aceitam alvo. Um escopo de app aceita um quando declara um
`target`, como abaixo.

## Declarando roles

<span class="since-badge" data-since="0.31">Desde 0.31</span>

As roles são declaradas na [tabela de usuários](/docs/schema/auth-table/), em
`auth.roles`. Uma role é um nome visível pelo banco de dados, com o qual as políticas de
row-level security podem corresponder, além de uma lista de escopos do plano administrativo e do app.

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        roles: col.text({ enum: ["admin", "support", "developer", "editor"] }).array(),
    },
    rls: "admin-only",
    auth: {
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"],
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"],
            },
        },
    },
});
```

Uma pessoa possui uma role quando a coluna `roles` dela a lista. Atribua-a no painel
de administração, ou com `PUT /api/admin/users/:uid`.

A inicialização recusa uma declaração que seria interpretada como uma concessão que na verdade não é:

- **`admin` não pode ser declarada.** Ela é integrada e possui todos os escopos.
- **Uma role não pode listar um escopo do plano de dados.** Toda pessoa já possui o
  plano de dados. `data:write` em uma role não concederia nada e aparentaria ter concedido
  algo. O que uma role pode fazer com linhas pertence ao [`rls`](/docs/collections/security-rules/) da tabela.
- **Todo escopo deve existir.** Um nome desconhecido faz a inicialização falhar e lista os nomes válidos.

Uma role que você não declara ainda é uma role. O `editor` acima não possui entrada, portanto
não possui escopo do plano administrativo, e uma política de RLS ainda pode corresponder a ela.

`defaultRole`, a role que todo novo usuário registrado recebe, não pode ser `admin` nem uma
role declarada que possua qualquer escopo do plano administrativo. Um estranho que se cadastra não deve
possuir nada que gerencie o projeto. A inicialização a recusa.

:::note[`schema-admin` foi descontinuado]
Versões anteriores tratavam uma role chamada `schema-admin` como um segundo admin. Agora ela
não significa nada por si só. Se o seu projeto a utilizava, declare-a com os escopos
desejados, por exemplo
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` lista `admin` e todas as roles declaradas com seus escopos. Isso
requer `users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## Escopos de app

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma aplicação pode nomear suas próprias operações como escopos, sob `auth.scopes`:

```ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id:    col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
    },
    rls: "admin-only",
    auth: {
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project",
            },
        },
    },
});
```

O nome é `recurso:ação`, em letras minúsculas, sem alvo. Ele não pode reutilizar um
recurso integrado: `data`, `storage`, `functions`, `users`, `schema`,
`database`, `backups`, `cron`, `logs` e `keys` já estão reservados. `label` é obrigatório,
pois é o que a pessoa lê ao conceder o escopo. `target` especifica o significado de
um alvo, permitindo que uma chave contenha `project:deploy:p1`.

Toda pessoa autenticada possui todos os escopos de app. Assim como no plano de dados, o código
por trás do escopo decide se essa pessoa pode agir. O escopo existe para que
uma chave possa ser limitada àquela ação específica. Uma role também pode listar escopos de app.

Verifique um escopo em uma [função personalizada](/docs/backend/custom-functions/) com `requireScope`:

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

Uma chave com `project:deploy:p1` passa para `p1` e recebe `403 SCOPE_MISSING`
para qualquer outro projeto. Ela também precisa de `functions:invoke`, ou
`functions:invoke:<name>` para esta função, para sequer alcançar a função.
`hasScope(c, scope, target)` e `getScopes(c)` respondem à mesma pergunta dentro de um
handler.

`requireScope`
recusa um escopo que ninguém poderia ter. Um nome que não é um escopo, ou um escopo
integrado digitado incorretamente como `data:raed`, lança um erro no carregamento da função. Um escopo de app que o
backend não declara sob `auth.scopes` responde a qualquer chamador, inclusive a um
administrador, com `500 SCOPE_NOT_DECLARED`.

## O que admin significa

`admin` é a única role integrada e é mais do que uma lista de escopos:

- Ela possui todos os escopos do plano administrativo, incluindo `keys:*`.
- É uma role que o banco de dados enxerga. As políticas padrão que o Rebase adiciona a cada
  tabela a aceitam, de modo que um admin lê e grava em todas as linhas de uma tabela que as
  mantém. Uma tabela com `defaultPolicies: false` as remove.
- Apenas um admin pode conceder `admin`. Uma role que lista todos os escopos do plano administrativo
  ainda não é `admin`: ela não pode conceder `admin`, e as políticas padrão não a
  aceitam.

`requireAdmin` verifica a existência da role. Prefira `requireScope` para qualquer ação que uma
role mais restrita ou uma chave deva ser capaz de realizar.

## Ninguém concede mais do que possui

Uma regra cobre todas as portas de concessão de acesso: **nada é concedido com mais
do que seu concedente possui.**

Para chaves:

- Os escopos de uma chave devem estar dentro dos escopos do próprio criador. Caso contrário, `403 SCOPE_EXCEEDS_CREATOR`.
- As roles de RLS de uma chave de serviço devem ser roles que seu criador possui, a menos que o criador
  seja um admin. Caso contrário, `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` e `keys:write` nunca são atribuídos a uma chave. Uma chave que gerencia chaves poderia
  gerar seu próprio sucessor. `400 KEY_MANAGEMENT_SCOPE`.
- Um detentor de `keys:write` não pode alterar ou revogar uma chave que possua uma role ou
  escopo que ele próprio não possui, a menos que seja um admin: `403 KEY_OUTRANKS_CALLER`.
  Sem isso, ele poderia expandir uma chave com role de admin para todos os escopos de dados.

Para contas, um detentor de `users:write`:

- não pode editar, redefinir ou excluir uma conta cujas roles possuam um escopo que ele não possui,
  ou `admin` caso ele não seja um admin:
  `403 ACCOUNT_OUTRANKS_CALLER`. Sem isso, uma role de suporte poderia redefinir a
  senha de um admin e entrar como ele.
- não pode conceder roles que tenham mais privilégios do que ele possui, incluindo `admin`: `403 ROLE_EXCEEDS_CALLER`.

O nome de uma role pode ser qualquer coisa, exceto um nome que seria interpretado como outras
roles: um nome vazio ou contendo `,` `{` `}` `"` `\` ou um caractere de
controle é recusado com `400 INVALID_ROLE` onde quer que uma role seja gravada (usuários,
tabela de usuários, chaves de serviço).

## Como cada credencial possui escopos

| Credencial | Atua como | Possui |
|---|---|---|
| Sessão de uma pessoa | a pessoa | o plano de dados, todos os escopos de app e os escopos de suas roles. Um admin possui tudo |
| [Chave de serviço](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, com as roles de RLS `service` mais as suas próprias `roles` | exatamente seus escopos |
| [Chave pessoal](/docs/backend/api-keys/#personal-keys) `rk_live_…` | seu proprietário, com as roles do proprietário no estado em que se encontram a cada requisição | seus escopos, limitados ao que o proprietário possui no momento |
| [Token MCP](/docs/ai/remote-mcp/) | a pessoa que o conectou | `data:read`, `data:write`, `data:delete` conforme concedido, opcionalmente por coleção |
| `REBASE_SERVICE_KEY` | `service`, com a role `admin` | tudo |

Uma chave ou token nunca ignora a segurança em nível de linha (row-level security). Seus escopos são um teto limite,
e as políticas do banco de dados para a identidade sob a qual atua são outro.

## Quando um escopo está ausente

A resposta é `403 SCOPE_MISSING`, e `details.requiredScope` indica o escopo,
com seu alvo quando houver:

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

Para uma pessoa, a solução é uma role que liste o escopo. Para uma chave, é uma nova chave
que o possua.

## Próximos passos

- [Chaves de API](/docs/backend/api-keys/): chaves de serviço, chaves pessoais e as regras de geração
- [Segurança em nível de linha](/docs/collections/security-rules/): o que uma pessoa pode fazer com cada linha
- [Índice de endpoints](/docs/backend/endpoints/): o escopo de que cada rota necessita
- [Códigos de erro](/docs/backend/errors/#authentication-and-accounts): todas as recusas mencionadas acima
