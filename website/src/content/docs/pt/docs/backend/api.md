---
title: API REST
sidebar_label: API REST
description: Endpoints de API REST gerados automaticamente para cada coleção, com filtragem, ordenação, paginação e inclusão de relações.
---

## Visão Geral

A Rebase gera automaticamente uma API completa a partir das definições das suas coleções:

- **API REST** — Endpoints CRUD para cada coleção em `/api/data/:slug`
- **Especificação OpenAPI** — Especificação legível por máquina em `/api/docs`
- **Swagger UI** — Explorador de API interativo em `/api/swagger` (somente em modo de desenvolvimento)

Nenhum código é necessário — defina suas coleções e a API aparece automaticamente.

## Endpoints REST

Para cada coleção, os seguintes endpoints são gerados:

| Método | Caminho | Descrição |
|--------|------|-------------|
| `GET` | `/api/data/:slug` | Listar entidades |
| `GET` | `/api/data/:slug/count` | Contar entidades |
| `GET` | `/api/data/:slug/:id` | Obter uma única entidade |
| `POST` | `/api/data/:slug` | Criar uma entidade |
| `PATCH` | `/api/data/:slug/:id` | Atualizar uma entidade |
| `PUT` | `/api/data/:slug/:id` | Atualizar uma entidade |
| `DELETE` | `/api/data/:slug/:id` | Excluir uma entidade |
| `POST` | `/api/data/:slug/bulk` | Create many entities in one transaction |
| `PATCH` | `/api/data/:slug/bulk` | Update many entities in one transaction |
| `POST` | `/api/data/:slug/bulk/delete` | Delete many entities in one transaction |

### Rotas de Subcoleções

As relações aninhadas são acessíveis via caminhos de URL:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post (PUT also accepted)
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Mecânica de Roteamento & Análise de Segmentos

Para lidar com profundidades arbitrárias de subcoleções aninhadas, a Rebase roteia as requisições recebidas usando a regex de parâmetro `:rest{.+}` do Hono. O motor interno de análise de segmentos analisa os caminhos contando os segmentos separados por barras:
- **Número ímpar de segmentos** (por ex., `authors/42/posts` -> 3 segmentos) representa uma requisição de lista de coleção.
- **Número par de segmentos** (por ex., `authors/42/posts/7` -> 4 segmentos) representa uma operação sobre um ID de entidade específico. O último segmento é extraído como o `entityId` alvo.

O motor filtra os namespaces reservados do sistema (por ex., `history`) da análise de segmentos do caminho para evitar colisões com os endpoints integrados.

## Autenticação

Todos os endpoints de dados exigem autenticação por padrão. Inclua um token Bearer no cabeçalho `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Para chamadas de servidor para servidor, use a chave de serviço:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

## Filtragem

Use parâmetros de consulta no estilo PostgREST para filtrar os resultados. O formato é `?field=operator.value`:

```bash
# Exact match
GET /api/data/products?active=eq.true

# Comparison operators
GET /api/data/products?price=gt.100
GET /api/data/products?price=lte.50

# Multiple filters (AND)
GET /api/data/products?active=eq.true&price=gt.10

# IN operator — match any value in a set
GET /api/data/products?status=in.(draft,published)

# NOT IN
GET /api/data/products?status=nin.(archived,deleted)

# Array contains
GET /api/data/products?tags=cs.electronics

# Array contains any
GET /api/data/products?tags=csa.(electronics,books)
```

### Operadores de Filtro

| Operador | Significado | Exemplo |
|----------|---------|---------|
| `eq` | Igual (`==`) | `?active=eq.true` |
| `neq` | Diferente (`!=`) | `?status=neq.draft` |
| `gt` | Maior que (`>`) | `?price=gt.100` |
| `gte` | Maior ou igual (`>=`) | `?price=gte.100` |
| `lt` | Menor que (`<`) | `?price=lt.50` |
| `lte` | Menor ou igual (`<=`) | `?price=lte.50` |
| `in` | Em array | `?status=in.(a,b,c)` |
| `nin` | Fora do array | `?status=nin.(a,b)` |
| `cs` | O array contém | `?tags=cs.value` |
| `csa` | O array contém algum | `?tags=csa.(a,b)` |

### Operadores Lógicos

Use `or` e `and` para condições complexas:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)
```

## Ordenação

Use `orderBy` com o formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

## Paginação

Use `limit` e `offset`, ou `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses default limit of 20)
GET /api/data/products?page=3
```

O limite padrão é **20**, o máximo é **100**.

### Formato da Resposta

As respostas de lista incluem metadados de paginação:

```json
{
    "data": [
        { "id": 1, "name": "Widget", "price": 29.99 },
        { "id": 2, "name": "Gadget", "price": 49.99 }
    ],
    "meta": {
        "total": 150,
        "limit": 20,
        "offset": 0,
        "hasMore": true
    }
}
```

As respostas de uma única entidade retornam um objeto plano:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "created_at": "2026-01-15T10:30:00Z"
}
```

## Busca de Texto

Use `searchString` para busca de texto completo em campos do tipo string:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Busca Vetorial

Se uma coleção definir uma propriedade do tipo `vector`, você pode realizar buscas de similaridade de alta velocidade usando operações de distância pgvector compiladas diretamente na consulta do banco de dados.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Parâmetros de Consulta Vetorial

| Parâmetro | Tipo | Descrição |
|-----------|------|-------------|
| `vector_search` | `string` | O nome da propriedade vetorial a ser consultada. |
| `vector` | `string` | Um array de floats serializado em JSON representando o vetor de consulta. |
| `vector_distance` | `string` | A métrica de distância a avaliar. Valores suportados: `cosine` (padrão, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Limite máximo de distância. Apenas registros com distância menor que este limite são retornados. |

## Inclusão de Relações

Use o parâmetro `include` para incorporar entidades relacionadas:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations
GET /api/data/articles?include=*
```

As relações incluídas são incorporadas diretamente na resposta:

```json
{
    "id": 1,
    "title": "Getting Started",
    "author_id": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com"
    }
}
```

## Seleção de Campos

Use `fields` para selecionar colunas específicas:

```bash
GET /api/data/products?fields=id,name,price
```

## Pipeline de Hooks do Ciclo de Vida

Cada operação de mutação REST (`POST`, `PUT`, `DELETE`) passa por um pipeline de execução de hooks estrito e sequencial:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hooks Bloqueantes vs. Diferidos

1. **Hooks bloqueantes (`beforeSave`, `beforeDelete`)**
   Esses hooks são executados de forma síncrona no ciclo principal da requisição *antes* de confirmar a transação do banco de dados. Eles podem modificar os payloads recebidos, executar validações personalizadas ou abortar a requisição por completo lançando um erro.

2. **Hooks diferidos (`afterSave`, `afterDelete`)**
   Esses hooks são executados de forma assíncrona depois que a transação do banco de dados foi confirmada com sucesso. Eles usam promises diferidas (fire-and-forget), o que significa que rodam em segundo plano e não bloqueiam a resposta HTTP do cliente. Ideal para enviar webhooks, disparar notificações push ou enfileirar tarefas externas.


## OpenAPI / Swagger

- **Especificação OpenAPI**: `GET /api/docs` — Retorna a especificação JSON completa do OpenAPI 3.0
- **Swagger UI**: `GET /api/swagger` — Explorador de API interativo (somente em modo de desenvolvimento)

A especificação OpenAPI é gerada automaticamente a partir das definições das suas coleções e inclui todos os endpoints, parâmetros de consulta e esquemas de resposta.

## Chaves de API

As chaves de API fornecem autenticação máquina a máquina para agentes, servidores MCP, pipelines de CI e integrações externas. Elas suportam escopo de permissões por coleção e acesso de administrador completo opcional.

### Criar uma Chave de API

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

A resposta inclui a chave completa em texto puro (`rk_live_...`) **exatamente uma vez** — armazene-a imediatamente.

### Usar uma Chave de API

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Permissões e RLS: dois portões independentes

A requisição de uma chave de API passa por **duas** verificações de autorização, e ambas devem permiti-la:

1. **A lista de permissões da chave** — coleção × operação, verificada na camada de rota.
2. **Segurança em nível de linha** — as chaves de API *não* ignoram a RLS. Uma chave é executada como
   `uid: "api-key:<id>"` com o papel `service` (mais `admin` quando
   `admin: true`). As chaves de administrador passam pelas políticas de administrador integradas; uma
   chave não-administradora só vê as linhas que uma regra de segurança concede explicitamente ao
   papel `service` ou ao público. Regras no estilo proprietário
   (`owner_id = auth.uid()`) nunca correspondem a uma chave de API.

Portanto, uma chave não-administradora com permissões `"*"` ainda pode obter resultados vazios — isso é
a RLS funcionando, não um bug. Conceda o papel `service` nas regras de segurança das
coleções pertinentes, ou use uma chave de administrador.

### Funções Personalizadas

As invocações de funções têm escopo como as coleções, sob o namespace `functions`:
`{"collection": "functions", "operations": ["write"]}` concede todas as
funções, `"functions/<name>"` concede uma, e o curinga global `"*"` concede
todas. Uma chave sem tal entrada não pode invocar funções de forma alguma.

### Armazenamento

O armazenamento funciona da mesma forma, sob o namespace `storage`:
`{"collection": "storage", "operations": ["read", "write"]}` permite que a chave
baixe/liste (`read`), envie e crie pastas (`write`), e exclua arquivos
(`delete`). O curinga global `"*"` também concede armazenamento. Uma chave sem tal
entrada não pode tocar no armazenamento. As rotas de upload retomável TUS contam como `write`
em cada etapa (incluindo a verificação de offset e o cancelamento), então uma chave com escopo de escrita
pode concluir um upload sozinha.

### Agentes e Servidores MCP

Um agente precisa da chave *mais restrita* que dê conta do seu trabalho, não de
uma chave de administrador. Comece com escopo restrito e dê a ela uma expiração:

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

As operações são `read`, `write` e `delete`, derivadas do método HTTP:
`GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` →
`delete`.

#### Uma chave com escopo restrito lê zero linhas até que uma regra conceda `service`

Este é o passo que faz uma chave corretamente restrita parecer quebrada. Uma
chave não-administradora é executada como `uid: "api-key:<id>"` com os papéis
`["service"]`, e a política de RLS injetada por padrão em cada coleção é
compilada para:

```sql
auth.uid() IS NULL OR (string_to_array(auth.roles(), ',') && ARRAY['admin'])
```

— o contexto do servidor, ou um administrador. Uma chave não-administradora não
corresponde a nenhum dos dois ramos, então em uma coleção sem `securityRules` a
requisição é bem-sucedida com um conjunto de resultados vazio e sem nenhum erro
que explique o motivo. Conceda o papel explicitamente:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Como `auth.uid()` carrega o id da chave, uma regra também pode restringir as
linhas a uma chave específica:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Não use `"*"` para uma chave somente leitura

O curinga `"*"` não abrange apenas as coleções — ele também corresponde ao
namespace `functions` e a `storage`. Um `GET` conta como `read`, e o handler de
uma função personalizada é código arbitrário que pode escrever: uma chave
curinga supostamente somente leitura pode, portanto, alterar dados através de
uma função. Nomear as coleções explicitamente deixa a chave sem nenhum acesso a
funções.

#### `--admin --full-access`: CI, migrações e ferramentas próprias

`"admin": true` concede à chave o papel de administrador — as rotas
`/api/admin/*` para gerenciamento de esquema, gerenciamento de usuários e mais,
além de cron, backups e logs. Combinada com `--full-access` (`{"collection":
"*", "operations": ["read", "write", "delete"]}`), a chave detém todas as
coleções, mais todo o armazenamento e todas as funções personalizadas. Esse é o
formato certo para CI, migrações e ferramentas próprias de confiança — não para
agentes.

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

#### Sem tempo real com chaves de API

O WebSocket de tempo real não interpreta tokens `rk_` — ele aceita apenas JWTs
de usuário e a chave de serviço. Um agente autenticado com uma chave de API faz
polling nos endpoints REST em vez de se inscrever.

### Opções da Chave

| Campo | Tipo | Descrição |
|---|---|---|
| `name` | `string` | Rótulo legível por humanos |
| `permissions` | `ApiKeyPermission[]` | Acesso por coleção (`"*"` = tudo; `"functions/<name>"` = uma função; `"storage"` = armazenamento de arquivos) |
| `admin` | `boolean` | Conceder o papel de administrador — rotas de administrador + políticas de administrador RLS |
| `rate_limit` | `number \| null` | Requisições por janela de 15 min (`null` = o padrão do servidor, 1000) |
| `expires_at` | `string \| null` | Timestamp de expiração ISO-8601 |

A CLI requer um escopo explícito: passe `--permissions '<json>'` ou opte por
`--full-access` — não há um padrão silencioso de acesso completo.

As chaves podem ser listadas, atualizadas e revogadas via `/api/admin/api-keys`
ou pelos comandos CLI `rebase api-keys` — mas não por uma chave de API.
Qualquer requisição a `/api/admin/api-keys` autenticada com uma chave `rk_` é
recusada com `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`, qualquer que seja o seu
sinalizador `admin`. O gerenciamento de chaves exige a sessão de um usuário
administrador ou a chave de serviço.

## Endpoint de Metadados

Obtenha uma lista de todas as coleções disponíveis e sua estrutura:

```bash
GET /api/collections
```

## Próximos Passos

- **[SDK Cliente](/docs/sdk)** — Cliente com tipos seguros para a API REST
- **[Coleções](/docs/collections)** — Defina seu esquema de dados
- **[Regras de Segurança (RLS)](/docs/collections/security-rules)** — Controle o acesso por linha
