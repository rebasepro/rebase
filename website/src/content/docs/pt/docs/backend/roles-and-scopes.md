---
sourceHash: 1610ca294114442e
title: Papéis e escopos
sidebar_label: Papéis e escopos
description: "O que um chamador pode fazer: o plano de dados que cada pessoa detém, o plano de administração concedido por papéis, os escopos que um aplicativo declara para si mesmo e como cada credencial os carrega."
---

Cada requisição para um backend Rebase faz uma pergunta: este chamador pode fazer isso?
A resposta é um **escopo**, uma string no formato `resource:action`: `data:read`,
`users:write`, `cron:read`. A sessão de uma pessoa, uma chave de API, um token MCP e um
papel detêm escopos, e todos usam as mesmas strings. Uma concessão é lida da mesma forma
em uma chave, em um papel e em uma tela de consentimento.

## Dois planos

Os escopos são divididos em dois planos, e uma pessoa os detém de maneiras diferentes.

**O plano de dados** é composto por `data:*`, `storage:*` e `functions:invoke`. Qualquer
pessoa autenticada detém todo ele. O que uma pessoa pode fazer com uma linha é decidido
pela [segurança em nível de linha](/docs/collections/security-rules/) da tabela, linha por linha,
e o que ela pode fazer com um arquivo pelas [políticas de armazenamento](/docs/backend/storage-authorization/).
Um escopo nunca decide isso para uma pessoa. Em uma chave ou token, os escopos do plano de dados
se restringem: uma chave que possui apenas `data:read:posts` lê `posts` e nada mais,
independentemente do que as regras permitiriam.

**O plano de administração** abrange todo o resto: usuários, esquema, o banco de dados, backups,
cron, logs e chaves. Ninguém o detém implicitamente. O papel integrado `admin` detém todo ele.
Qualquer outro papel detém o que a aplicação declarar para ele.

## Os escopos

| Escopo | Plano | Alvo | O que permite |
|---|---|---|---|
| `data:read` | data | collection | Ler linhas, por meio da segurança em nível de linha do chamador |
| `data:write` | data | collection | Criar e atualizar linhas, por meio da segurança em nível de linha do chamador |
| `data:delete` | data | collection | Excluir linhas, por meio da segurança em nível de linha do chamador |
| `storage:read` | data | storage source | Listar e baixar arquivos |
| `storage:write` | data | storage source | Fazer upload de arquivos e criar pastas |
| `storage:delete` | data | storage source | Excluir arquivos |
| `functions:invoke` | data | function | Chamar funções personalizadas. Uma função pode fazer tudo o que seu código fizer |
| `users:read` | admin | — | Listar contas e seus papéis |
| `users:write` | admin | — | Criar, editar e excluir contas, redefinir senhas e segundos fatores, atribuir papéis até o limite dos que o próprio detentor possui |
| `schema:read` | admin | — | Ler o esquema, planejar alterações de esquema, executar a auditoria de RLS, ler a documentação da API privada |
| `schema:write` | admin | — | Aplicar alterações de esquema: edita os arquivos de esquema e altera o banco de dados |
| `database:read` | admin | — | Listar bancos de dados, tabelas, papéis do Postgres e branches |
| `database:write` | admin | — | Executar SQL como proprietário do banco de dados, fora da segurança em nível de linha, e criar ou excluir branches |
| `backups:read` | admin | — | Listar e baixar backups: todas as linhas, fora da segurança em nível de linha |
| `cron:read` | admin | — | Listar tarefas cron e ler seu histórico de execução |
| `cron:write` | admin | — | Disparar tarefas cron e ativá-las ou desativá-las |
| `logs:read` | admin | — | Ler os logs do servidor |
| `keys:read` | admin | — | Listar as chaves de serviço do projeto. Nunca concedível a uma chave |
| `keys:write` | admin | — | Criar, alterar e revogar chaves de serviço. Nunca concedível a uma chave |

`GET /api/auth/scopes` retorna esta lista para o backend em execução, com os escopos
próprios da aplicação adicionados, além dos escopos que o chamador detém. Qualquer chamador
autenticado pode lê-la:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Alvos

Um escopo do plano de dados pode ser restringido a um alvo, após um segundo dois-pontos:

- `data:read:posts` lê apenas a tabela `posts`. O alvo é o slug de uma tabela.
- `storage:write:avatars` faz upload apenas para a fonte de armazenamento `avatars`. O
  id da fonte padrão é `(default)`: `storage:read:(default)`.
- `functions:invoke:export` chama apenas a função `export`.

O escopo simples cobre todos os alvos. Um escopo restrito cobre seu próprio alvo e nada
mais. Ele nunca responde a uma consulta sobre todos os alvos: uma chave que detém
`data:read:posts` não pode listar todas as tabelas.

Escopos do plano de administração não aceitam alvo. Um escopo de aplicação aceita um
quando declara um `target`, como mostrado abaixo.

## Declarando papéis

<span class="since-badge" data-since="0.31">Since 0.31</span>

Os papéis são declarados na [tabela de usuários](/docs/schema/auth-table/), sob
`auth.roles`. Um papel é um nome visível para o banco de dados, com o qual as políticas
de segurança em nível de linha podem corresponder, além de uma lista de escopos do plano de administração e da aplicação.

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

Uma pessoa detém um papel quando sua coluna `roles` o lista. Atribua-o no painel de administração,
ou com `PUT /api/admin/users/:uid`.

A inicialização recusa uma declaração que seria interpretada como uma concessão que na realidade não é:

- **`admin` não pode ser declarado.** Ele é integrado e detém todos os escopos.
- **Um papel não pode listar um escopo do plano de dados.** Qualquer pessoa já detém o plano
  de dados. `data:write` em um papel não concederia nada e apenas pareceria conceder
  algo. O que um papel pode fazer com linhas pertence ao [`rls`](/docs/collections/security-rules/) da tabela.
- **Todo escopo deve existir.** Um nome desconhecido faz a inicialização falhar e lista os nomes válidos.

Um papel que você não declarar ainda é um papel. `editor` acima não possui nenhuma entrada,
portanto não detém nenhum escopo do plano de administração, e uma política de RLS ainda pode corresponder a ele.

`defaultRole`, o papel que todo novo usuário cadastrado recebe, não pode ser `admin` nem um papel
declarado que detenha qualquer escopo do plano de administração. Um desconhecido que se cadastre
não deve deter nada que gerencie o projeto. A inicialização recusa isso.

:::note[`schema-admin` foi removido]
Versões anteriores tratavam um papel chamado `schema-admin` como um segundo admin. Agora ele não
significa nada por si só. Se o seu projeto o utilizava, declare-o com os escopos pretendidos,
por exemplo
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` lista `admin` e todos os papéis declarados com seus escopos. Ele
requer `users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## Escopos da aplicação

<span class="since-badge" data-since="0.31">Since 0.31</span>

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

O nome é `resource:action`, em letras minúsculas, sem alvo. Ele não pode reutilizar um
recurso integrado: `data`, `storage`, `functions`, `users`, `schema`, `database`,
`backups`, `cron`, `logs` e `keys` já estão reservados. `label` é obrigatório, pois é
o que uma pessoa lê ao conceder o escopo. `target` define o significado de um alvo,
permitindo que uma chave detenha `project:deploy:p1`.

Qualquer pessoa autenticada detém todos os escopos da aplicação. Assim como no plano de dados,
o código por trás do escopo decide se essa pessoa pode agir. O escopo existe para que
uma chave possa ser restrita a essa ação específica. Um papel também pode listar escopos da aplicação.

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

Uma chave que possui `project:deploy:p1` passa para `p1` e recebe `403 SCOPE_MISSING`
para qualquer outro projeto. Ela também precisa de `functions:invoke`, ou
`functions:invoke:<name>` para esta função, para conseguir alcançar a função.
`hasScope(c, scope, target)` e `getScopes(c)` respondem à mesma pergunta dentro de um
handler.

`requireScope`
recusa um escopo que ninguém poderia deter. Um nome que não é um escopo, ou um integrado
com erro de digitação como `data:raed`, lança um erro durante o carregamento da função. Um escopo
de aplicação que o backend não declara sob `auth.scopes` responde a qualquer chamador,
inclusive a um administrador, com `500 SCOPE_NOT_DECLARED`.

## O que admin significa

`admin` é o único papel integrado, e ele é mais do que uma lista de escopos:

- Ele detém todos os escopos do plano de administração, incluindo `keys:*`.
- É um papel visível para o banco de dados. As políticas padrão que o Rebase adiciona
  a cada tabela o admitem, de modo que um admin lê e escreve em todas as linhas de uma tabela
  que as mantenha. Uma tabela com `defaultPolicies: false` as remove.
- Apenas um admin pode conceder `admin`. Um papel que lista todos os escopos do plano de administração
  ainda não é `admin`: ele não pode conceder `admin`, e as políticas padrão não o admitem.

`requireAdmin` verifica o papel. Prefira `requireScope` para qualquer ação que um papel
mais específico ou uma chave deva ser capaz de realizar.

## Ninguém concede mais do que possui

Uma regra cobre todas as portas que concedem acesso: **nada é concedido com mais
privilégios do que o seu outorgante detém.**

Para chaves:

- Os escopos de uma chave devem estar dentro dos que o próprio criador detém. Caso contrário, `403 SCOPE_EXCEEDS_CREATOR`.
- Os papéis de RLS de uma chave de serviço devem ser papéis que o seu criador detém, a menos
  que o criador seja um admin. Caso contrário, `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` e `keys:write` nunca são atribuídos a uma chave. Uma chave que gerencia chaves
  poderia emitir sua própria sucessora. `400 KEY_MANAGEMENT_SCOPE`.
- Quem detém `keys:write` não pode alterar ou revogar uma chave que detenha um papel ou
  escopo que ele não possui, a menos que seja um admin: `403 KEY_OUTRANKS_CALLER`.
  Sem isso, seria possível expandir uma chave com papel de admin para todos os escopos de dados.

Para contas, quem detém `users:write`:

- não pode editar, redefinir ou excluir uma conta cujos papéis detenham um escopo que ele não
  possui, ou `admin` se ele não for um admin:
  `403 ACCOUNT_OUTRANKS_CALLER`. Sem isso, um papel de suporte poderia redefinir a senha
  de um admin e autenticar-se como ele.
- não pode conceder papéis que detenham mais privilégios do que ele próprio, incluindo `admin`: `403 ROLE_EXCEEDS_CALLER`.

O nome de um papel pode ser qualquer coisa, exceto um nome que seria interpretado como outros
papéis: um nome vazio, ou um que contenha `,` `{` `}` `"` `\` ou um caractere de controle,
é recusado com `400 INVALID_ROLE` onde quer que um papel seja registrado (usuários,
tabela de usuários, chaves de serviço).

## Como cada credencial detém escopos

| Credencial | Atua como | Detém |
|---|---|---|
| A sessão de uma pessoa | a pessoa | o plano de dados, todos os escopos da aplicação e os escopos dos seus papéis. Um admin detém tudo |
| [Chave de serviço](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, com os papéis de RLS `service` mais seus próprios `roles` | exatamente os seus escopos |
| [Chave pessoal](/docs/backend/api-keys/#personal-keys) `rk_live_…` | seu proprietário, com os papéis do proprietário conforme estão a cada requisição | seus escopos, reduzidos ao que o proprietário detém no momento |
| [Token MCP](/docs/ai/remote-mcp/) | a pessoa que o conectou | `data:read`, `data:write`, `data:delete` conforme concedidos, opcionalmente por tabela |
| `REBASE_SERVICE_KEY` | `service`, com o papel `admin` | tudo |

Uma chave ou um token nunca ignora a segurança em nível de linha. Seus escopos são um limite
máximo, e as políticas do banco de dados para a identidade sob a qual atua são outro.

## Quando um escopo está ausente

A resposta é `403 SCOPE_MISSING`, e `details.requiredScope` informa o escopo,
com seu alvo quando houver um:

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
que o detenha.

## Próximos passos

- [Chaves de API](/docs/backend/api-keys/): chaves de serviço, chaves pessoais e as regras de emissão
- [Segurança em nível de linha](/docs/collections/security-rules/): o que uma pessoa pode fazer com cada linha
- [Índice de endpoints](/docs/backend/endpoints/): o escopo necessário para cada rota
- [Códigos de erro](/docs/backend/errors/#authentication-and-accounts): todas as recusas mencionadas acima
