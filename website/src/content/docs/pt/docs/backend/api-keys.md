---
sourceHash: 7c51c9877d9d0803
title: Chaves de API
sidebar_label: Chaves de API
description: "Chaves de longa duração para scripts, CI, agentes e integrações: chaves de serviço e chaves pessoais, os escopos que elas têm, como se combinam com a segurança em nível de linha (RLS) e as rotas que as gerenciam."
---

## Chaves de API

Uma chave de API é uma credencial bearer de longa duração, `rk_live_…`, para um chamador que
não é uma pessoa em um navegador: um script, um job de CI, um agente, um cliente MCP, outro
serviço. O que uma chave pode fazer é uma lista de [escopos](/docs/backend/roles-and-scopes/),
como `data:read:orders` ou `cron:write`.

Existem dois tipos:

- Uma **chave de serviço** é a identidade de máquina do próprio projeto. Ela age como
  `api-key:<id>`, não como uma pessoa. Quem tem `keys:write` as gerencia, em
  `/api/admin/api-keys`.
- Uma **chave pessoal** age como a conta que a criou. Cada conta gerencia as
  suas, em `/api/auth/keys`, quando o app as ativa.

### Usando uma chave

Envie-a como um bearer token, assim como um token de acesso. `$API_URL` é o endereço do seu backend:
o que o `rebase dev` imprimiu, ou a URL da sua implantação.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

A mesma chave funciona na REST API, no storage, nas funções personalizadas, nas superfícies
administrativas que seus escopos alcançam, no WebSocket de realtime e no [endpoint `/mcp`](/docs/ai/mcp/#the-remote-endpoint).

## Chaves de serviço

### Criando uma

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

A resposta inclui a chave completa em texto simples (`rk_live_...`) **exatamente uma vez**.
Armazene-a imediatamente.

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | `string` | Um rótulo para pessoas |
| `scopes` | `string[]` | O que a chave pode fazer. Pelo menos um |
| `roles` | `string[]` | Papéis de RLS com que a chave é executada, além de `service`. Opcional |
| `rate_limit` | `number \| null` | Requisições por janela de 15 minutos. `null` ou ausente usa o padrão do servidor para chaves de API, 1000. Veja [Limite de taxa](#limite-de-taxa) |
| `expires_at` | `string \| null` | Expiração em ISO-8601. Ausente significa que nunca expira |

### Escopos e RLS: duas verificações independentes

Uma requisição feita com uma chave passa por duas verificações, e ambas devem permiti-la:

1. **Os escopos da chave**, verificados pela rota: `data:write:orders` permite que a chave
   escreva em `orders` e em nada mais.
2. **Row-level security**, verificada pelo banco de dados. Uma chave nunca a ignora. Uma
   chave de serviço é executada como `uid: "api-key:<id>"` com o papel `service`, além de quaisquer
   `roles` que tenha recebido. Regras baseadas em proprietário (`owner_id = rebase.uid()`) nunca
   correspondem a ela.

Portanto, uma chave com `data:read` ainda pode receber resultados vazios. Isso é o RLS funcionando,
não um bug. Conceda o papel `service` nas regras de segurança da coleção, ou dê
à chave o papel `admin`.

#### Uma chave de serviço lê zero linhas até que uma regra conceda `service`

Este é o passo que faz uma chave com o escopo correto parecer quebrada. A política de RLS
que o Rebase adiciona a cada coleção por padrão compila para:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

Ou seja, o contexto do servidor ou um administrador. Uma chave de serviço sem o papel `admin`
não corresponde a nenhuma das duas condições. Em uma coleção sem `securityRules`, a requisição é bem-sucedida
com um resultado vazio e sem nenhum erro explicando o motivo. Conceda o papel explicitamente:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Como `rebase.uid()` carrega o id da chave, uma regra também pode restringir linhas a uma
chave:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### O papel `admin`

`roles: ["admin"]` (`--roles admin` na CLI) faz a chave ser executada também com o papel de RLS `admin`,
de modo que ela passa pelas políticas de administrador padrão de todas as coleções que
as mantêm. Essas políticas cobrem `SELECT`, `INSERT`, `UPDATE` e `DELETE`, então a
row-level security não limita as leituras, escritas ou exclusões da chave: ela pode
ler, alterar e excluir todas as linhas que seus escopos alcançam. O papel também passa
nas verificações de administrador fora do banco de dados: `requireAdmin` nas
[funções personalizadas](/docs/backend/custom-functions/) e as escritas que o storage
reserva aos administradores. Não concede nenhum escopo: a chave continua alcançando
apenas o que seus `scopes` listam.

Quem cria uma chave só pode dar a ela papéis que ele próprio tem, a menos que seja
administrador.

### Acesso total, para CI e migrações

`--full-access` dá à chave todos os escopos que seu criador tem, menos `keys:read` e
`keys:write`, que nenhuma chave pode ter. Pela CLI, que usa a chave de serviço,
isso significa todos os escopos do plano de dados e do plano administrativo. Adicione `--roles admin` e a
row-level security deixa de limitar quais linhas ela lê, altera ou exclui:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

Esse é o formato certo para CI, migrações e ferramentas próprias confiáveis. Não
é o formato certo para um agente.

### Limite de taxa

O `rate_limit` de uma chave é quantas requisições ela pode fazer em uma janela de
15 minutos, e todas as portas de entrada contam para ele em um único bucket, `api-key:<id>`:

- suas requisições HTTP às APIs de dados, de storage e de funções;
- seus frames de dados no socket de realtime: buscas, contagens, salvamentos e exclusões;
- suas requisições ao [`/mcp`](/docs/ai/mcp/#the-remote-endpoint).

Sem um `rate_limit`, o bucket usa o padrão do servidor para chaves de API, 1000. Uma
chave pessoal não tem um `rate_limit` próprio e conta em seu próprio bucket com esse
padrão. Passado o limite, uma requisição HTTP responde `429` e um frame do socket,
`RATE_LIMITED`.

As rotas administrativas em `/api/admin` e as mensagens administrativas do socket, como
as do editor SQL, não têm limite de taxa.

## Chaves pessoais

Uma chave pessoal age **como seu proprietário**: com o uid dele e com os papéis dele, como estão
a cada requisição. Regras baseadas em proprietário correspondem a ela, então ela lê exatamente o que seu proprietário
leria, restringido pelos seus escopos. Ela serve para os scripts de uma pessoa, uma CLI no seu
laptop ou uma ferramenta que ela conecta à própria conta.

Elas vêm desativadas por padrão, porque cada uma é uma credencial de longa duração para uma
conta. Ative-as no bloco auth da coleção de usuários:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: { enabled: true, personalKeys: true },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Depois, uma conta autenticada gerencia as próprias chaves:

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

Uma chave pessoal aceita `name`, `scopes` e `expires_at`. Ela não tem `roles`,
porque é executada com os do seu proprietário, nem `rate_limit`. Enviar qualquer um dos dois resulta em
`400 INVALID_INPUT`.

O que uma chave pessoal tem são seus escopos, reduzidos ao que seu proprietário tem **agora**.
Remova um papel do proprietário e todas as chaves que ele criou encolhem junto. Exclua a
conta e as chaves dela param de funcionar. Desative `personalKeys` e todas as chaves pessoais
param de funcionar também.

Apenas uma conta pode ter chaves pessoais. Uma chave de API, a chave de serviço e uma sessão de convidado
são recusadas: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` para uma chave,
`403 PERSONAL_KEY_NEEDS_ACCOUNT` para as outras duas. Com o recurso desativado, todas
as rotas respondem `403 PERSONAL_KEYS_DISABLED`.

## O que cada escopo alcança

### Dados

`data:read`, `data:write` e `data:delete`, simples ou restritos a uma coleção
(`data:read:posts`). A operação vem do método HTTP: `GET`, `HEAD`
e `OPTIONS` leem, `POST`, `PUT` e `PATCH` escrevem, `DELETE` exclui.
`POST /api/data/:slug/bulk/delete` conta como exclusão, embora seja um `POST`.

Em um caminho aninhado, a operação é verificada contra a coleção em que o caminho termina,
e cada coleção pela qual ele passa precisa de `data:read`. Uma chave que tem apenas
`data:read:posts` é recusada em `/api/data/authors/1/posts` até poder ler também
`authors`.

### Storage

`storage:read` lista e baixa. `storage:write` envia arquivos e cria pastas,
e cobre cada etapa de um upload retomável (TUS), incluindo a verificação de deslocamento
e o cancelamento. `storage:delete` exclui. O alvo é o id de uma fonte de storage. O
id da fonte padrão é `(default)`, então `storage:read:(default)` lê apenas a fonte padrão,
e `storage:write:avatars` escreve em uma fonte chamada `avatars`.
Depois da verificação de escopo, [`storageAuthorize`](/docs/backend/storage/#per-object-authorization)
ainda é executado, com a identidade da chave.

### Funções

`functions:invoke` chama todas as funções personalizadas. `functions:invoke:<name>` chama
uma. Listar as funções em `GET /api/functions` requer o escopo simples.

Não dê `functions:invoke` a uma chave que você quer que seja somente leitura. Uma função é
código, e pode escrever. Dentro de uma função, `getScopes(c)` e `hasScope(c, …)`
leem o que a chave tem, e um app pode declarar seus próprios escopos para uma função
verificar. Consulte [Funções Personalizadas](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Superfícies administrativas

Um escopo do plano administrativo em uma chave alcança aquela superfície. Um agendador que dispara
cron jobs precisa de `cron:write`. Um coletor de logs precisa de `logs:read`. Um job de backup precisa
de `backups:read`. O [índice de endpoints](/docs/backend/endpoints/#admin) lista o
escopo que cada rota requer.

`keys:read` e `keys:write` nunca podem ir em uma chave. Uma chave capaz de gerenciar chaves
poderia criar a própria sucessora, ou se ampliar. Qualquer requisição às rotas de chaves
feita com uma chave é recusada com `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Gerencie
as chaves como uma pessoa que tem `keys:write`, ou com a chave de serviço.

### Realtime

Uma chave também autentica o WebSocket: envie-a na mensagem `AUTHENTICATE`.
Buscas e inscrições precisam de `data:read` na sua coleção, salvamentos de
`data:write`, exclusões de `data:delete`. Uma inscrição em um caminho aninhado precisa do
escopo simples. Canais (broadcast e presence) são recusados para chaves. O editor
SQL e as mensagens de branch precisam de `database:read` ou `database:write`.

## Agentes e servidores MCP

Um agente precisa da chave *mais restrita* que faz o seu trabalho. Comece com escopo restrito e defina
uma expiração:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Deixe de fora `data:delete` quando o agente puder editar, mas não deva remover.
`delete` é separado de `write` exatamente por esse motivo.

## Regras de emissão

Cada chave é verificada contra quem a cria, da mesma forma nas duas rotas:

| Recusa | Quando |
|---|---|
| `400 INVALID_SCOPES` | Um escopo está malformado, é desconhecido ou carrega um alvo que não aceita. `details.validScopes` lista todos os válidos |
| `400 UNKNOWN_SCOPE_TARGET` | Um alvo nomeia uma coleção, fonte de storage ou função que este backend não serve |
| `400 KEY_MANAGEMENT_SCOPE` | Foi pedido `keys:read` ou `keys:write` |
| `403 SCOPE_EXCEEDS_CREATOR` | Um escopo que o criador não tem. Uma chave nunca tem mais do que a conta que a criou |
| `403 ROLE_EXCEEDS_CREATOR` | Um papel de chave de serviço que o criador não tem, quando o criador não é administrador |

Uma requisição para a qual a própria chave não tem o escopo responde `403 SCOPE_MISSING`, com o
escopo em `details.requiredScope`. Consulte [Códigos de erro](/docs/backend/errors/#authentication-and-accounts).

## Gerenciando chaves

| Método | Caminho | Requer |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Altera `name`, `scopes`, `roles`, `rate_limit` ou `expires_at`, sob as mesmas regras da criação |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Revoga |
| `GET` | `/api/auth/keys` | Uma conta: as próprias chaves pessoais |
| `POST` | `/api/auth/keys` | Uma conta, com `personalKeys` ativado |
| `DELETE` | `/api/auth/keys/:id` | Uma conta: revoga uma das suas |

Todas as rotas retornam as chaves mascaradas: `key_prefix`, nunca o hash. Cada chave informa
seu `kind` (`service` ou `personal`), seus `scopes`, seus `roles` e, no caso de uma
chave pessoal, seu `owner_uid`.

A CLI cobre as chaves de serviço: `rebase api-keys list`, `get`, `create`, `revoke`
e `scopes`, que lista todos os escopos que o backend conhece. Consulte a
[referência da CLI](/docs/cli/#rebase-api-keys).

## Chaves criadas antes dos escopos

As chaves criadas antes de os escopos existirem carregam uma lista `permissions` e uma flag `admin`.
Na inicialização, o store dá a cada uma os escopos que ela passa a ter. Nada se amplia;
onde uma concessão antiga não tem correspondência exata, ela se restringe:

| Concessão antiga | Escopos agora |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` e `storage:<op>` para cada operação, mais `functions:invoke` se tinha `write` |
| `"storage"` | `storage:<op>` para cada operação |
| `"functions"` | `functions:invoke`, apenas se tinha `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, apenas se tinha `write` |
| `admin: true` | o papel `admin`, mais `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

O segredo não muda, então uma integração continua funcionando. Duas concessões se restringem:

- Uma concessão de função sem `write` vira nada. Um `GET` contava como
  leitura, mas uma função é código, e chamar uma função não é uma leitura.
- Uma chave de administrador não recebe nenhum `database:*`, que ela nunca pôde alcançar antes, nem
  `keys:*`, que nenhuma chave pode ter.

As antigas colunas `permissions` e `admin` são mantidas, para que um rollback para um
runtime mais antigo ainda leia suas chaves. Uma requisição que envia `permissions` ou
`admin` em vez de `scopes` é recusada com `400 INVALID_INPUT`.

## Próximos Passos

- [Papéis e escopos](/docs/backend/roles-and-scopes/): todos os escopos, e como os papéis os têm
- [Índice de endpoints](/docs/backend/endpoints/): o escopo que cada rota requer
- [Regras de Segurança (RLS)](/docs/collections/security-rules/): o que o banco de dados impõe além dos escopos de uma chave
