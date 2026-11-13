---
sourceHash: 8f9385dd3838df4f
title: Chaves de API
sidebar_label: Chaves de API
description: "Chaves de longa duração para scripts, CI, agentes e integrações: chaves de serviço e chaves pessoais, os escopos que elas possuem, como elas se compõem com a segurança em nível de linha (RLS) e as rotas que as gerenciam."
---

## Chaves de API

Uma chave de API é uma credencial bearer de longa duração, `rk_live_…`, para um
chamador que não é uma pessoa em um navegador: um script, um job de CI, um agente,
um cliente MCP, outro serviço. O que uma chave pode fazer é definido por uma lista
de [escopos](/docs/backend/roles-and-scopes/), como `data:read:orders` ou `cron:write`.

Existem dois tipos:

- Uma **chave de serviço** é a própria identidade de máquina do projeto. Ela atua como
  `api-key:<id>`, não como uma pessoa. Qualquer pessoa com `keys:write` as gerencia, em
  `/api/admin/api-keys`.
- Uma **chave pessoal** atua como a conta que a criou. Cada conta gerencia as
  suas próprias, em `/api/auth/keys`, quando o aplicativo as habilita.

### Usando uma chave

Envie-a como um token bearer, como um token de acesso. `$API_URL` é o endereço do
seu backend: o que foi exibido pelo `rebase dev` ou a URL do seu deploy.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

A mesma chave funciona na API REST, storage, funções customizadas, nas superfícies
administrativas que seus escopos alcançam, no WebSocket em tempo real e no [endpoint `/mcp`](/docs/ai/remote-mcp/).

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
| `roles` | `string[]` | Papéis (roles) de RLS sob os quais a chave executa, além de `service`. Opcional |
| `rate_limit` | `number \| null` | Requisições por janela de 15 minutos. `null` ou ausente usa o padrão de chave de API do servidor, 1000. Consulte [Limite de taxa](#rate-limit) |
| `expires_at` | `string \| null` | Expiração em formato ISO-8601. Ausente significa que nunca expira |

### Escopos e RLS: dois portões independentes

Uma requisição feita com uma chave passa por duas verificações, e ambas devem permitir o acesso:

1. **Os escopos da chave**, verificados pela rota: `data:write:orders` permite que a chave
   escreva em `orders` e nada mais.
2. **Row-level security**, verificada pelo banco de dados. Uma chave nunca a ignora. Uma
   chave de serviço executa como `uid: "api-key:<id>"` com o papel `service`, além de quaisquer
   `roles` atribuídos a ela. Regras de propriedade estilo owner (`owner_id = rebase.uid()`) nunca
   corresponderão a ela.

Portanto, uma chave com `data:read` ainda pode receber resultados vazios. Isso é o RLS funcionando,
não um bug. Conceda o papel `service` nas regras de `rls` da tabela ou dê
à chave o papel `admin`.

#### Uma chave de serviço lê zero linhas até que uma regra conceda `service`

Este é o passo que faz uma chave com escopo correto parecer quebrada. A política de RLS
que o Rebase adiciona a cada tabela por padrão compila para:

```sql
(SELECT (rebase.uid() IS NULL) OR (string_to_array(rebase.roles(), ',') && ARRAY['admin']))
```

Esse é o contexto do servidor ou de um administrador. Uma chave de serviço sem o papel `admin`
não corresponde a nenhuma das condições. Em uma tabela cujo `rls` é `"admin-only"`, a requisição
tem sucesso com um resultado vazio e nenhum erro explicando o motivo. Conceda o papel
explicitamente no `rls` da tabela:

```ts
rls: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Como `rebase.uid()` carrega o id da chave, uma regra também pode delimitar linhas a uma
única chave:

```ts
rls: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### O papel `admin`

`roles: ["admin"]` (`--roles admin` na CLI) faz com que a chave execute também com o papel
RLS `admin`, liberando as políticas de admin padrão de cada tabela que as
mantém. Essas políticas cobrem `SELECT`, `INSERT`, `UPDATE` e `DELETE`, portanto o
row-level security não limita as leituras, escritas ou exclusões da chave: ela pode
ler, alterar e excluir qualquer linha que seus escopos permitirem. O papel também passa pelas
verificações de admin fora do banco de dados: `requireAdmin` em
[funções customizadas](/docs/backend/custom-functions/) e as gravações que o storage
reserva para admins. Ele não concede nenhum escopo adicional: a chave ainda alcança apenas o que sua
lista de `scopes` contém.

Um criador só pode atribuir a uma chave os papéis que ele próprio possui, a menos que seja um
admin.

### Acesso total, para CI e migrações

`--full-access` concede à chave todos os escopos que seu criador possui, exceto `keys:read` e
`keys:write`, que nenhuma chave pode ter. Através da CLI, que usa a chave de serviço,
isso inclui todos os escopos do plano de dados e do plano de administração. Adicione `--roles admin` e
o row-level security não mais limitará quais linhas ela lê, altera ou exclui:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

Esse é o formato ideal para CI, migrações e ferramentas proprietárias confiáveis. Não é
o formato adequado para um agente.

### Rate limit

O `rate_limit` de uma chave determina quantas requisições ela pode fazer em uma janela
de 15 minutos, e cada entrada conta contra ela em um único bucket, `api-key:<id>`:

- suas requisições HTTP para as APIs de dados, storage e funções;
- seus frames de dados no socket em tempo real: buscas (fetches), contagens (counts), salvamentos (saves) e exclusões (deletes),
  bem como assinaturas e requisições de histórico de canal além do
  [limite concedido](/docs/backend/realtime/#what-a-write-costs-and-the-limits) a cada socket;
- suas requisições para [`/mcp`](/docs/ai/remote-mcp/).

Sem um `rate_limit`, o bucket utiliza o padrão de chave de API do servidor, 1000. Uma
chave pessoal não possui um `rate_limit` próprio e é contabilizada em seu próprio bucket usando
esse padrão. Ao ultrapassar o limite, uma requisição HTTP retorna `429` e um frame de socket
retorna `RATE_LIMITED`.

As rotas de administração em `/api/admin` e as mensagens administrativas do socket, como as do
editor SQL, não sofrem limitação de taxa.

Um administrador simulando uma chave ("Simulate access", `x-rebase-simulate-api-key-id`)
consome sua própria cota, não a da chave: a integração que usa essa chave
mantém todo o seu orçamento de requisições. A simulação ou personificação de um usuário é cobrada do
administrador da mesma forma.

## Chaves pessoais

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma chave pessoal atua **como seu proprietário**: seu uid e seus papéis conforme estiverem no
momento de cada requisição. Regras baseadas em propriedade correspondem a ela, portanto ela lê exatamente o que seu proprietário
leria, restrita pelos seus escopos. É ideal para scripts próprios de uma pessoa, uma CLI em seu
computador ou uma ferramenta conectada à sua própria conta.

Elas vêm desativadas por padrão, pois cada uma é uma credencial de longa duração para uma
conta. Ative-as no bloco `auth` da [tabela de usuários](/docs/schema/auth-table/):

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

Em seguida, uma conta autenticada gerencia suas próprias chaves:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

O mesmo via REST. `$ACCESS_TOKEN` é o token de acesso da própria conta, obtido ao
fazer login:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

Uma chave pessoal aceita `name`, `scopes` e `expires_at`. Ela não aceita `roles`,
pois executa com os papéis de seu proprietário, e não tem `rate_limit`. Enviar qualquer um desses dois resulta em
`400 INVALID_INPUT`.

O que uma chave pessoal possui são seus escopos, reduzidos àquilo que seu proprietário possui **no momento**.
Remova um papel do proprietário e todas as chaves criadas por ele encolhem junto. Exclua a
conta e suas chaves param de funcionar. Desative `personalKeys` e todas as chaves pessoais
também deixam de funcionar.

Apenas uma conta pode ter chaves pessoais. Uma chave de API, a chave de serviço e uma sessão de convidado
são recusadas: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` para uma chave,
`403 PERSONAL_KEY_NEEDS_ACCOUNT` para as outras duas. Com o recurso desativado, todas as
rotas respondem com `403 PERSONAL_KEYS_DISABLED`.

## O que cada escopo alcança

### Dados

`data:read`, `data:write` e `data:delete`, genéricos ou restritos a uma tabela específica
(`data:read:posts`). A operação vem do método HTTP: `GET`, `HEAD`
e `OPTIONS` leem, `POST`, `PUT` e `PATCH` gravam, `DELETE` exclui.
`POST /api/data/:slug/bulk/delete` conta como exclusão, embora seja um `POST`.

Em um caminho aninhado, a operação é verificada em relação à tabela onde o caminho termina,
e cada tabela pela qual ele passa precisa de `data:read`. Uma chave que possui apenas
`data:read:posts` é recusada em `/api/data/authors/1/posts` até que também possa
ler `authors`.

### Storage

`storage:read` lista e faz downloads. `storage:write` faz uploads e cria pastas,
cobrindo cada etapa de um upload retomável (TUS), incluindo a verificação de deslocamento (offset)
e o cancelamento. `storage:delete` exclui. O alvo é o id de uma fonte de storage. O id da fonte
padrão é `(default)`, portanto `storage:read:(default)` lê apenas a fonte padrão,
e `storage:write:avatars` grava em uma fonte chamada `avatars`.
Após a verificação de escopo, [`storageAuthorize`](/docs/backend/storage-authorization/)
ainda é executado, com a identidade da chave.

### Funções

`functions:invoke` chama todas as funções customizadas. `functions:invoke:<name>` chama
uma função específica. Listar as funções em `GET /api/functions` exige o escopo genérico.

Não conceda `functions:invoke` a uma chave que você deseja que seja somente leitura. Uma função é
código e pode realizar gravações. Dentro de uma função, `getScopes(c)` e `hasScope(c, …)`
leem o que a chave possui, e uma aplicação pode declarar seus próprios escopos para uma função
verificar. Consulte [Funções customizadas](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Superfícies administrativas

Um escopo do plano de administração em uma chave alcança essa superfície. Um agendador que aciona
jobs cron precisa de `cron:write`. Um coletor de logs precisa de `logs:read`. Um job de backup precisa de
`backups:read`. O [índice de endpoints](/docs/backend/endpoints/#admin) lista o
escopo que cada rota exige.

`keys:read` e `keys:write` nunca podem ser atribuídos a uma chave. Uma chave que pudesse gerenciar chaves
poderia emitir sua própria sucessora ou ampliar seus próprios privilégios. Qualquer requisição para as rotas de chave
feita com uma chave é recusada com `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Gerencie
chaves como uma pessoa que possui `keys:write` ou com a chave de serviço.

### Realtime

Uma chave também autentica o WebSocket: envie-a na mensagem `AUTHENTICATE`.
Buscas (fetches) e assinaturas (subscriptions) exigem `data:read` em sua respectiva tabela, gravações
`data:write`, exclusões `data:delete`. Uma assinatura para um caminho aninhado exige o
escopo genérico. Canais (broadcast e presence) são recusados para chaves. As mensagens do editor
SQL e de branches exigem `database:read` ou `database:write`.

## Agentes e servidores MCP

Um agente deve ter a chave mais *restrita* possível para realizar sua tarefa. Comece delimitando os escopos e defina
uma data de expiração:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Omita `data:delete` quando o agente puder editar, mas não deva remover.
O `delete` é separado do `write` exatamente por esse motivo.

## Regras de emissão

Cada chave é verificada contra quem a está criando, da mesma forma em ambas as rotas:

| Recusa | Quando |
|---|---|
| `400 INVALID_SCOPES` | Um escopo está malformado, é desconhecido ou contém um alvo que ele não aceita. `details.validScopes` lista os escopos que uma chave pode ter. Ele omite `keys:*`, que nenhuma chave pode ter |
| `400 UNKNOWN_SCOPE_TARGET` | Um alvo nomeia uma tabela, fonte de storage ou função que este backend não atende |
| `400 KEY_MANAGEMENT_SCOPE` | `keys:read` ou `keys:write` foi solicitado |
| `403 SCOPE_EXCEEDS_CREATOR` | Um escopo que o criador não possui. Uma chave nunca possui mais do que a conta que a criou |
| `403 ROLE_EXCEEDS_CREATOR` | Um papel de chave de serviço que o criador não possui, quando o criador não é um admin |
| `400 INVALID_ROLE` | Um nome de papel está vazio ou contém `,` `{` `}` `"` `\` ou um caractere de controle, que o RLS interpretaria como outros papéis |
| `403 KEY_OUTRANKS_CALLER` | Em uma alteração (`PUT`) ou revogação (`DELETE`): a chave já possui um papel ou escopo que o chamador não possui, e o chamador não é um admin |

Uma requisição para a qual a própria chave não possui escopo suficiente responde com `403 SCOPE_MISSING`, com o
escopo especificado em `details.requiredScope`. Consulte [Códigos de erro](/docs/backend/errors/#authentication-and-accounts).

## Gerenciando chaves

| Método | Caminho | Requisitos |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Altera `name`, `scopes`, `roles`, `rate_limit` ou `expires_at`, sob as mesmas regras de criação |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Revoga |
| `GET` | `/api/auth/keys` | Uma conta: suas próprias chaves pessoais |
| `POST` | `/api/auth/keys` | Uma conta, com `personalKeys` ativado |
| `DELETE` | `/api/auth/keys/:id` | Uma conta: revoga uma de suas próprias chaves |

Todas as rotas retornam as chaves mascaradas: `key_prefix`, nunca o hash. Cada chave informa
seu `kind` (`service` ou `personal`), seus `scopes`, seus `roles` e, para uma
chave pessoal, seu `owner_uid`.

A CLI cobre as chaves de serviço: `rebase api-keys list`, `get`, `create`, `revoke`,
e `scopes`, que lista todos os escopos conhecidos pelo backend. Consulte a
[referência da CLI](/docs/cli/#rebase-api-keys). Ela autentica com
`REBASE_SERVICE_KEY` do `.env` e o envia apenas para o servidor que o `rebase dev`
está executando para este projeto, portanto, se esse servidor estiver parado, nada será enviado. Para
um servidor executado de outra forma, como `rebase start` ou um container, defina
`REBASE_BASE_URL` com seu endereço
([o próprio ambiente da CLI](/docs/getting-started/configuration/#the-clis-own-environment)).

## Chaves criadas antes dos escopos

As chaves criadas antes da existência dos escopos possuem uma lista de `permissions` e uma
flag `admin`. Na inicialização, a store atribui a cada uma os escopos que ela passa a deter. Nada é ampliado;
onde uma permissão antiga não tem correspondência exata, ela é restringida:

| Permissão antiga | Escopos atuais |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` e `storage:<op>` para cada operação, além de `functions:invoke` se possuía `write` |
| `"storage"` | `storage:<op>` para cada operação |
| `"functions"` | `functions:invoke`, somente se possuía `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, somente se possuía `write` |
| `admin: true` | o papel `admin`, mais `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

O segredo não muda, portanto a integração continua funcionando. Duas permissões são restringidas:

- Uma permissão de função sem `write` passa a não conceder nada. Um `GET` costumava contar como uma
  leitura, mas uma função é código, e executá-la não é uma leitura.
- Uma chave admin não recebe nenhum `database:*`, ao qual nunca teve acesso anteriormente, e nenhum
  `keys:*`, que nenhuma chave pode ter.

As colunas antigas `permissions` e `admin` são mantidas no lugar, para que um rollback para um
runtime anterior ainda consiga ler suas chaves. Uma requisição que envie `permissions` ou
`admin` em vez de `scopes` é recusada com `400 INVALID_INPUT`.

## Próximos passos

- [Papéis e escopos](/docs/backend/roles-and-scopes/): todos os escopos e como os papéis os contêm
- [Índice de endpoints](/docs/backend/endpoints/): o escopo necessário para cada rota
- [Regras de segurança (RLS)](/docs/collections/security-rules/): o que o banco de dados impõe além dos escopos de uma chave
