---
sourceHash: 92edb85e26e286c4
title: Chaves de API
sidebar_label: Chaves de API
description: "Chaves de longa duração para scripts, CI, agentes e integrações: chaves de serviço e chaves pessoais, os escopos que possuem, como se combinam com segurança em nível de linha (RLS) e as rotas que as gerenciam."
---

## Chaves de API

Uma chave de API é uma credencial bearer de longa duração, `rk_live_…`, para um
chamador que não é uma pessoa em um navegador: um script, um job de CI, um
agente, um cliente MCP, outro serviço. O que uma chave pode fazer é definido por
uma lista de [escopos](/docs/backend/roles-and-scopes/), como `data:read:orders`
ou `cron:write`.

Existem dois tipos:

- Uma **chave de serviço** é a identidade de máquina do próprio projeto. Ela
  atua como `api-key:<id>`, não como uma pessoa. Qualquer pessoa com `keys:write`
  as gerencia, em `/api/admin/api-keys`.
- Uma **chave pessoal** atua como a conta que a criou. Cada conta gerencia as
  suas próprias chaves, em `/api/auth/keys`, quando o aplicativo as habilita.

### Usando uma chave

Envie-a como um token bearer, como um token de acesso. `$API_URL` é o endereço do
seu backend: o que foi impresso pelo `rebase dev` ou a URL do seu deploy.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

A mesma chave funciona na API REST, storage, funções customizadas, nas
superfícies de administração que seus escopos alcançam, no WebSocket em tempo
real e no [endpoint `/mcp`](/docs/ai/remote-mcp/).

## Chaves de serviço

### Criando uma chave

Uma chave de serviço precisa de um nome e de pelo menos um escopo.

```bash
# CLI: talks to the backend with the service key from .env
rebase api-keys create --name "Order sync" --scopes data:read:orders,data:write:orders

# REST: needs keys:write
curl -X POST "$API_URL/api/admin/api-keys" \
  -H "Authorization: Bearer $REBASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Order sync",
    "scopes": ["data:read:orders", "data:write:orders"]
  }'
```

Ou com o SDK do cliente:

```ts
const { key } = await client.apiKeys.createKey({
    name: "Order sync",
    scopes: ["data:read:orders", "data:write:orders"],
    expires_at: "2027-01-01T00:00:00.000Z"
});
console.log(key.key); // the only time the plaintext is returned
```

A resposta inclui a chave completa em texto puro (`rk_live_...`) **exatamente uma vez**.
Armazene-a imediatamente.

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | `string` | Um rótulo para pessoas |
| `scopes` | `string[]` | O que a chave pode fazer. Pelo menos um |
| `roles` | `string[]` | Roles de RLS que a chave executa, além de `service`. Opcional |
| `rate_limit` | `number \| null` | Requisições por janela de 15 minutos. `null` ou ausente usa o padrão do servidor para chaves de API, 1000. Consulte [Rate limit](#rate-limit) |
| `expires_at` | `string \| null` | Expiração ISO-8601. Ausente significa que nunca expira |

### Escopos e RLS: duas barreiras independentes

Uma requisição feita com uma chave passa por duas verificações, e ambas devem permiti-la:

1. **Os escopos da chave**, verificados pela rota: `data:write:orders` permite
   que a chave escreva em `orders` e nada mais.
2. **Segurança em nível de linha (RLS)**, verificada pelo banco de dados. Uma
   chave nunca a ignora. Uma chave de serviço é executada como `uid: "api-key:<id>"`
   com a role `service`, além de quaisquer `roles` atribuídas a ela. Regras de
   propriedade no estilo proprietário (`owner_id = rebase.uid()`) nunca
   correspondem a ela.

Portanto, uma chave com `data:read` ainda pode obter resultados vazios. Isso é o
RLS funcionando, não um bug. Conceda a role `service` nas regras de segurança da
coleção ou dê à chave a role `admin`.

#### Uma chave de serviço lê zero linhas até que uma regra conceda `service`

Este é o passo que faz uma chave com os escopos corretos parecer quebrada. A
política de RLS que o Rebase adiciona a cada tabela por padrão compila para:

```sql
(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))
```

Esse é o contexto do servidor ou de um admin. Uma chave de serviço sem a role
`admin` não corresponde a nenhuma das partes. Em uma tabela cujo `rls` é
`"admin-only"`, a requisição é bem-sucedida com um resultado vazio e nenhum erro
explicando o motivo. Conceda a role explicitamente no `rls` da tabela:

```ts
rls: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Como `rebase.uid()` carrega o ID da chave, uma regra também pode delimitar
linhas para uma chave específica:

```ts
rls: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### A role `admin`

`roles: ["admin"]` (`--roles admin` na CLI) faz com que a chave seja executada
também com a role de RLS `admin`, liberando as políticas de administração padrão
de cada coleção que as mantém. Essas políticas cobrem `SELECT`, `INSERT`,
`UPDATE` e `DELETE`, de modo que o RLS não limita as leituras, gravações ou
exclusões da chave: ela pode ler, alterar e excluir qualquer linha que seus
escopos alcancem. A role também passa pelas verificações de admin fora do banco de
dados: `requireAdmin` em [funções customizadas](/docs/backend/custom-functions/)
e as gravações que o storage reserva para admins. Ela não concede nenhum escopo
adicional: a chave ainda acessa apenas o que consta em sua lista de `scopes`.

Um criador só pode conceder a uma chave as roles que ele próprio possui, a menos
que seja um admin.

### Acesso total, para CI e migrações

O parâmetro `--full-access` concede à chave todos os escopos que seu criador
possui, exceto `keys:read` e `keys:write`, que nenhuma chave pode ter. Por meio da
CLI, que usa a chave de serviço, isso inclui todos os escopos do data-plane e
admin-plane. Adicione `--roles admin` e a segurança em nível de linha deixará de
limitar quais linhas ela lê, altera ou exclui:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

Esse é o formato ideal para CI, migrações e ferramentas internas confiáveis. Não
é o formato adequado para um agente.

### Rate limit

O `rate_limit` de uma chave define quantas requisições ela pode fazer em uma
janela de 15 minutos, e todos os acessos contam contra ela em um único bucket,
`api-key:<id>`:

- suas requisições HTTP para as APIs de dados, storage e funções;
- seus frames de dados no socket em tempo real: buscas (fetches), contagens,
  gravações e exclusões, além de inscrições e requisições de histórico de canais
  além da [cota](/docs/backend/realtime/#what-a-write-costs-and-the-limits) de
  cada socket;
- suas requisições para [`/mcp`](/docs/ai/remote-mcp/).

Sem um `rate_limit`, o bucket utiliza o padrão do servidor para chaves de API,
1000. Uma chave pessoal não tem um `rate_limit` próprio e é contabilizada em seu
próprio bucket com esse valor padrão. Ao ultrapassar o limite, uma requisição
HTTP retorna `429` e um frame de socket retorna `RATE_LIMITED`.

As rotas de administração em `/api/admin` e as mensagens de administração do
socket, como as do editor SQL, não têm limite de taxa.

Um administrador simulando uma chave ("Simular acesso",
`x-rebase-simulate-api-key-id`) consome sua própria cota, não a da chave: a
integração em execução nessa chave mantém todo o seu orçamento. A simulação ou
personificação de um usuário é cobrada do administrador da mesma forma.

## Chaves pessoais

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma chave pessoal atua **como seu proprietário**: seu uid e suas roles como
estão no momento de cada requisição. Regras no estilo de proprietário
correspondem a ela, então ela lê exatamente o que seu proprietário leria,
delimitada por seus escopos. Ela é adequada para scripts próprios de uma pessoa,
uma CLI em seu laptop ou uma ferramenta que ela conecta à sua própria conta.

Elas ficam desativadas por padrão, pois cada uma é uma credencial de longa
duração para uma conta. Ative-as no bloco `auth` da [tabela de usuários](/docs/schema/auth-table/):

```typescript
// backend/schema/users.ts
import { defineAuthTable, col } from "@rebasepro/server/schema";

export const users = defineAuthTable("users", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique()
    },
    rls: "admin-only",
    auth: { personalKeys: true }
});
```

Em seguida, uma conta conectada gerencia suas próprias chaves:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

O mesmo via REST. `$ACCESS_TOKEN` é o próprio token de acesso da conta, obtido
ao fazer login:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Uma chave pessoal aceita `name`, `scopes` e `expires_at`. Ela não carrega
`roles`, pois é executada com as roles de seu proprietário, e não possui
`rate_limit`. O envio de qualquer um desses campos resulta em `400 INVALID_INPUT`.

O que uma chave pessoal possui são seus escopos, restritos ao que seu
proprietário possui **no momento**. Remova uma role do proprietário e todas as
chaves criadas por ele serão reduzidas com ela. Exclua a conta e suas chaves
deixarão de funcionar. Desative `personalKeys` e todas as chaves pessoais também
deixarão de funcionar.

Apenas uma conta pode ter chaves pessoais. Uma chave de API, a chave de serviço
e uma sessão de convidado são recusadas: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`
para uma chave, `403 PERSONAL_KEY_NEEDS_ACCOUNT` para as outras duas. Com o
recurso desativado, todas as rotas respondem com `403 PERSONAL_KEYS_DISABLED`.

## O que cada escopo alcança

### Dados

`data:read`, `data:write` e `data:delete`, genéricos ou delimitados a uma coleção
(`data:read:posts`). A operação provém do método HTTP: `GET`, `HEAD` e `OPTIONS`
realizam leitura, `POST`, `PUT` e `PATCH` realizam escrita, `DELETE` realiza
exclusão. `POST /api/data/:slug/bulk/delete` conta como uma exclusão, embora seja
um `POST`.

Em um caminho aninhado, a operação é verificada em relação à coleção onde o
caminho termina, e cada coleção pela qual ele passa precisa de `data:read`. Uma
chave contendo apenas `data:read:posts` tem o acesso recusado a
`/api/data/authors/1/posts` até que também possa ler `authors`.

### Storage

`storage:read` lista e faz downloads. `storage:write` faz uploads e cria pastas,
cobrindo cada etapa de um upload retomável (TUS), incluindo a verificação de
deslocamento (offset) e o cancelamento. `storage:delete` exclui. O alvo é o id
de uma fonte de storage. O id da fonte padrão é `(default)`, de modo que
`storage:read:(default)` lê apenas a fonte padrão, e `storage:write:avatars`
grava em uma fonte chamada `avatars`. Após a verificação do escopo,
[`storageAuthorize`](/docs/backend/storage-authorization/) ainda é executado,
com a identidade da chave.

### Funções

`functions:invoke` chama todas as funções customizadas. `functions:invoke:<name>`
chama uma específica. Listar as funções em `GET /api/functions` requer o escopo
genérico.

Não conceda `functions:invoke` a uma chave que você deseja que seja somente
leitura. Uma função é código e pode realizar gravações. Dentro de uma função,
`getScopes(c)` e `hasScope(c, …)` leem o que a chave possui, e uma aplicação
pode declarar seus próprios escopos para que uma função os verifique. Consulte
[Funções Customizadas](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Superfícies de administração

Um escopo do admin-plane em uma chave permite acessar essa superfície. Um
agendador que aciona jobs cron precisa de `cron:write`. Um encaminhador de logs
precisa de `logs:read`. Um job de backup precisa de `backups:read`. O [índice de
endpoints](/docs/backend/endpoints/#admin) lista o escopo que cada rota exige.

`keys:read` e `keys:write` nunca podem ser atribuídos a uma chave. Uma chave que
pudesse gerenciar chaves poderia emitir seu próprio sucessor ou ampliar a si
mesma. Qualquer requisição para as rotas de chave feita com uma chave é recusada
com `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Gerencie chaves como uma pessoa que
possui `keys:write` ou com a chave de serviço.

### Realtime

Uma chave também autentica o WebSocket: envie-a na mensagem `AUTHENTICATE`.
Buscas e inscrições precisam de `data:read` em sua coleção, gravações de
`data:write`, exclusões de `data:delete`. Uma inscrição em um caminho aninhado
precisa do escopo genérico. Canais (transmissão/broadcast e presença) são
recusados para chaves. As mensagens do editor SQL e de branches precisam de
`database:read` ou `database:write`.

## Agentes e servidores MCP

Um agente precisa da chave *mais restrita* possível para realizar seu trabalho.
Comece com escopos específicos e defina uma expiração:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Omita `data:delete` quando o agente puder editar, mas não deva remover dados.
`delete` é separado de `write` exatamente por esse motivo.

## Regras de emissão

Cada chave é verificada contra quem a cria, da mesma forma em ambas as rotas:

| Recusa | Quando |
|---|---|
| `400 INVALID_SCOPES` | Um escopo está malformado, é desconhecido ou carrega um alvo que ele não aceita. `details.validScopes` lista os escopos que uma chave pode ter. Ele omite `keys:*`, que nenhuma chave pode ter |
| `400 UNKNOWN_SCOPE_TARGET` | Um alvo nomeia uma coleção, fonte de storage ou função que este backend não atende |
| `400 KEY_MANAGEMENT_SCOPE` | `keys:read` ou `keys:write` foi solicitado |
| `403 SCOPE_EXCEEDS_CREATOR` | Um escopo que o criador não possui. Uma chave nunca possui mais permissões do que a conta que a criou |
| `403 ROLE_EXCEEDS_CREATOR` | Uma role de chave de serviço que o criador não possui, quando o criador não é um admin |
| `400 INVALID_ROLE` | O nome de uma role está vazio ou contém `,` `{` `}` `"` `\` ou um caractere de controle, o que o RLS interpretaria como outras roles |
| `403 KEY_OUTRANKS_CALLER` | Em uma alteração (`PUT`) ou revogação (`DELETE`): a chave já possui uma role ou escopo que o chamador não possui, e o chamador não é um admin |

Uma requisição para a qual a própria chave não possui um escopo responde com
`403 SCOPE_MISSING`, com o escopo indicado em `details.requiredScope`. Consulte
[Códigos de erro](/docs/backend/errors/#authentication-and-accounts).

## Gerenciando chaves

| Método | Caminho | Requer |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Altera `name`, `scopes`, `roles`, `rate_limit` ou `expires_at`, sob as mesmas regras de criação |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Revoga |
| `GET` | `/api/auth/keys` | Uma conta: suas próprias chaves pessoais |
| `POST` | `/api/auth/keys` | Uma conta, com `personalKeys` ativado |
| `DELETE` | `/api/auth/keys/:id` | Uma conta: revoga uma de suas próprias chaves |

Todas as rotas retornam chaves mascaradas: `key_prefix`, nunca o hash. Cada chave
relata seu tipo (`kind`: `service` ou `personal`), seus `scopes`, suas `roles` e,
para uma chave pessoal, seu `owner_uid`.

A CLI cobre chaves de serviço: `rebase api-keys list`, `get`, `create`, `revoke`
e `scopes`, que lista todos os escopos que o backend conhece. Consulte a
[referência da CLI](/docs/cli/#rebase-api-keys). Ela se autentica com
`REBASE_SERVICE_KEY` do `.env` e a envia apenas para o servidor que o
`rebase dev` está executando para este projeto, de modo que, com esse servidor
parado, ela não envia nada. Para um servidor executado de outra forma, como
`rebase start` ou um contêiner, defina `REBASE_BASE_URL` com seu endereço
([o próprio ambiente da CLI](/docs/getting-started/configuration/#the-clis-own-environment)).

## Chaves criadas antes dos escopos

As chaves criadas antes da existência dos escopos contêm uma lista de
`permissions` e uma flag `admin`. Na inicialização, o store atribui a cada uma os
escopos que ela passa a deter. Nada é ampliado; onde uma concessão antiga não
possui correspondência exata, ela é restringida:

| Concessão antiga | Escopos atuais |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` e `storage:<op>` para cada operação, além de `functions:invoke` se tinha `write` |
| `"storage"` | `storage:<op>` para cada operação |
| `"functions"` | `functions:invoke`, apenas se tinha `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, apenas se tinha `write` |
| `admin: true` | a role `admin`, além de `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

O segredo não muda, portanto a integração continua funcionando. Duas concessões
são restringidas:

- Uma concessão de função sem `write` torna-se nada. Um `GET` costumava contar
  como uma leitura, mas uma função é código, e chamar uma função não é uma
  leitura.
- Uma chave de admin não recebe `database:*`, que nunca pôde acessar antes, e
  nenhum `keys:*`, que nenhuma chave pode possuir.

As colunas antigas `permissions` e `admin` são mantidas no lugar, para que um
rollback para um runtime mais antigo ainda consiga ler suas chaves. Uma requisição
que envie `permissions` ou `admin` em vez de `scopes` é recusada com
`400 INVALID_INPUT`.

## Próximos passos

- [Roles e escopos](/docs/backend/roles-and-scopes/): cada escopo e como as roles os contêm
- [Índice de endpoints](/docs/backend/endpoints/): o escopo que cada rota exige
- [Regras de segurança (RLS)](/docs/collections/security-rules/): o que o banco de dados impõe sobre os escopos de uma chave
