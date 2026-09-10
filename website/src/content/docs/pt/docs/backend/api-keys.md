---
sourceHash: 87d15c9eb4314422
title: Chaves de API
sidebar_label: Chaves de API
description:"\"Chaves revogáveis e com escopo para chamadores automatizados: o que uma chave pode acessar, como os escopos se combinam com a segurança em nível de linha (RLS) e os endpoints administrativos para gerenciá-las.\""
---

## Chaves de API

As chaves de API fornecem autenticação máquina a máquina para agentes, servidores MCP, pipelines de CI e integrações externas. Elas oferecem suporte a escopos de permissão por coleção e acesso total de administrador opcional.

### Criando uma Chave de API

```bash
# Via CLI
rebase api-keys create --name "My Integration" \
  --permissions '[{"collection":"orders","operations":["read","write"]}]'

# Via REST (requires admin auth)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "permissions": [{ "collection": "orders", "operations": ["read", "write"] }]
  }'
```

A resposta inclui a chave completa em texto simples (`rk_live_...`) **exatamente uma vez** — armazene-a imediatamente.

### Usando uma Chave de API

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Permissões e RLS: duas verificações independentes

A requisição de uma chave de API passa por **duas** verificações de autorização, e ambas devem permitir o acesso:

1. **A lista de permissões da chave** — coleção × operação, verificada na camada de rota.
2. **Row-Level Security (RLS)** — Chaves de API *não* ignoram o RLS. Uma chave é executada como
   `uid: "api-key:<id>"` com o papel `service` (além de `admin` quando
   `admin: true`). Chaves de administrador passam pelas políticas de administração integradas; uma
   chave que não seja de administrador só vê linhas que uma regra de segurança conceder explicitamente
   ao papel `service` ou ao público. Regras baseadas em proprietário
   (`owner_id = rebase.uid()`) nunca corresponderão a uma chave de API.

Portanto, uma chave não administrativa com permissões `"*"` ainda pode receber resultados vazios — isso é o
RLS funcionando, não um bug. Conceda o papel `service` nas regras de segurança
das coleções relevantes ou use uma chave de administrador.

### Funções Personalizadas

Invocação de funções tem escopo definido como coleções, sob o namespace
`functions`: `{"collection": "functions", "operations": ["write"]}` concede acesso a todas as
funções, `"functions/<name>"` concede a uma, e o caractere curinga global `"*"` concede a
todas. Uma chave sem essa entrada não poderá invocar funções de forma alguma.

### Storage

O Storage funciona da mesma forma, sob o namespace `storage`:
`{"collection": "storage", "operations": ["read", "write"]}` permite que a chave
baixe/liste (`read`), envie arquivos e crie pastas (`write`), e exclua arquivos
(`delete`). O caractere curinga global `"*"` também concede acesso ao storage. Uma chave sem
essa entrada não pode acessar o storage. As rotas de upload retomável via TUS contam como `write`
para cada etapa (incluindo a verificação de deslocamento e cancelamento), portanto, uma chave com escopo de escrita
pode concluir um upload por conta própria.

### Agentes e Servidores MCP

Um agente precisa da chave com o escopo mais *restrito* possível para realizar seu trabalho, e não de uma chave de administrador. Comece
com escopo reduzido e defina uma expiração:

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

As operações são `read`, `write` e `delete`, derivadas do método HTTP:
`GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` →
`delete`.

#### Uma chave com escopo lê zero linhas até que uma regra conceda `service`

Este é o passo que faz uma chave com escopo correto parecer quebrada. Uma chave não administrativa
é executada como `uid: "api-key:<id>"` com os papéis `["service"]`, e a política de RLS
injetada em cada coleção por padrão compila para:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

— o contexto do servidor ou um administrador. Uma chave não administrativa não corresponde a nenhuma das duas condições, portanto, em
uma coleção sem `securityRules`, a requisição é bem-sucedida com um conjunto de resultados vazio
e sem nenhum erro explicando o motivo. Conceda o papel explicitamente:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Como `rebase.uid()` carrega o id da chave, uma regra também pode restringir linhas a uma
chave específica:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Não use `"*"` para uma chave somente leitura

O caractere curinga `"*"` não significa "todas as coleções" — ele também corresponde ao namespace
`functions` e ao `storage`. Um `GET` conta como `read`, e o manipulador de uma função personalizada
é código arbitrário que pode realizar operações de escrita, portanto, uma chave curinga "somente leitura" pode
realizar mutações por meio de uma função. Nomear coleções explicitamente não dá à chave
nenhum acesso a funções.

#### `--admin --full-access`: CI, migrações e ferramentas proprietárias

`"admin": true` concede à chave o papel de administrador — rotas `/api/admin/*` para gerenciamento
de esquema, gerenciamento de usuários e muito mais, além de cron, backups e logs. Combinado
com `--full-access` (`{"collection": "*", "operations": ["read", "write",
"delete"]}`), a chave tem acesso a todas as coleções, além de todo o storage e cada função personalizada.
Esse é o formato ideal para CI, migrações e ferramentas proprietárias
confiáveis — não para agentes.

```bash
# CLI
rebase api-keys create -n "CI" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

#### Sem realtime via chaves de API

O WebSocket de realtime não processa tokens `rk_` — ele aceita apenas JWTs de usuário e
a service key. Um agente autenticado com uma chave de API faz polling nos
endpoints REST em vez de se inscrever.

### Opções de Chave

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | `string` | Rótulo legível por humanos |
| `permissions` | `ApiKeyPermission[]` | Acesso por coleção (`"*"` = tudo; `"functions/<name>"` = uma função; `"storage"` = armazenamento de arquivos) |
| `admin` | `boolean` | Concede papel de administrador — rotas administrativas + políticas de RLS de administrador |
| `rate_limit` | `number \| null` | Requisições por janela de 15 min (`null` = o padrão do servidor, 1000) |
| `expires_at` | `string \| null` | Timestamp de expiração em ISO-8601 |

A CLI requer um escopo explícito: passe `--permissions '<json>'` ou opte por
`--full-access` — não há um padrão silencioso de acesso total.

As chaves podem ser listadas, atualizadas e revogadas via `/api/admin/api-keys` ou pelos
comandos da CLI `rebase api-keys` — mas não por uma chave de API. Qualquer requisição para
`/api/admin/api-keys` autenticada com uma chave `rk_` é recusada com `403
API_KEY_SELF_MANAGEMENT_FORBIDDEN`, independentemente de sua flag `admin`. O gerenciamento de chaves
requer a sessão de um usuário administrador ou a service key.

## Próximos Passos

- [REST API](/docs/backend/api/) — os endpoints que uma chave chama
- [Índice de endpoints](/docs/backend/endpoints/) — a barreira de verificação em cada rota, incluindo chaves
- [Regras de Segurança (RLS)](/docs/collections/security-rules/) — o que o banco de dados impõe além dos escopos de uma chave

---
