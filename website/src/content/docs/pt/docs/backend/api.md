---
sourceHash: b480967e0adbfeed
title: API REST
sidebar_label: API REST
description: Endpoints de API REST gerados automaticamente para cada coleção, com filtragem, ordenação, paginação e inclusão de relações.
---

## Visão Geral

O Rebase gera automaticamente uma API completa a partir das definições das suas coleções:

- **API REST** — Endpoints CRUD para cada coleção em `/api/data/:slug`
- **Especificação OpenAPI** — Especificação legível por máquina em `/api/docs`
- **Swagger UI** — Explorador interativo de API em `/api/swagger` (apenas em modo de desenvolvimento)

Nenhum código é necessário — defina suas coleções e a API aparecerá automaticamente.

## Endpoints REST

Para cada coleção, os seguintes endpoints são gerados. Todas as outras rotas que o backend disponibiliza — autenticação, armazenamento, administração, metadados — estão no [índice de endpoints](/docs/backend/endpoints/).

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/data/:slug` | Listar entidades |
| `GET` | `/api/data/:slug/count` | Contar entidades |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, opcionalmente agrupados. Aceita os mesmos filtros que o endpoint de listagem, e o RLS se aplica às linhas sendo agregadas — consulte [Consultas](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Obter uma única entidade |
| `POST` | `/api/data/:slug` | Criar um registro |
| `PATCH` | `/api/data/:slug/:id` | Atualizar um registro (parcial — apenas as propriedades enviadas são gravadas) |
| `DELETE` | `/api/data/:slug/:id` | Excluir um registro |
| `POST` | `/api/data/:slug/bulk` | Criar várias entidades em uma única transação |
| `PATCH` | `/api/data/:slug/bulk` | Atualizar várias entidades em uma única transação |
| `POST` | `/api/data/:slug/bulk/delete` | Excluir várias entidades em uma única transação |
| `POST` | `/api/data/_batch` | Gravar **entre** coleções em uma única transação |

### Rotas de Subcoleções

Relações aninhadas são acessíveis via caminhos de URL:

```
GET    /api/data/authors/42/posts         → list author's posts
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Mecânica de Roteamento e Análise de Segmentos

Para lidar com profundidades arbitrárias de subcoleções aninhadas, o Rebase roteia requisições recebidas usando a regex de parâmetro `:rest{.+}` do Hono. O motor interno de análise de segmentos analisa os caminhos contando os segmentos separados por barras:
- **Contagem ímpar de segmentos** (ex., `authors/42/posts` -> 3 segmentos) representa uma requisição de listagem de coleção.
- **Contagem par de segmentos** (ex., `authors/42/posts/7` -> 4 segmentos) representa uma operação em um ID de entidade específico. O último segmento é extraído como o `entityId` de destino.

O motor filtra namespaces reservados do sistema (ex., `history`) da análise de segmentos de caminho para evitar colisões com endpoints integrados.

## Autenticação

Todos os endpoints de dados exigem autenticação por padrão. Inclua um token Bearer no cabeçalho `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Para chamadas de servidor para servidor, use a chave de serviço (service key):

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
|----------|-------------|---------|
| `eq` | Igual a (`==`) | `?active=eq.true` |
| `neq` | Diferente de (`!=`) | `?status=neq.draft` |
| `gt` | Maior que (`>`) | `?price=gt.100` |
| `gte` | Maior ou igual a (`>=`) | `?price=gte.100` |
| `lt` | Menor que (`<`) | `?price=lt.50` |
| `lte` | Menor ou igual a (`<=`) | `?price=lte.50` |
| `in` | No array | `?status=in.(a,b,c)` |
| `nin` | Fora do array | `?status=nin.(a,b)` |
| `cs` | Array contém | `?tags=cs.value` |
| `csa` | Array contém algum | `?tags=csa.(a,b)` |
| `like` | Correspondência de padrão, sensível a maiúsculas e minúsculas (`like`) | `?sku=like.AB-%` |
| `ilike` | Correspondência de padrão, insensível a maiúsculas e minúsculas (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Não corresponde ao padrão (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Não corresponde ao padrão, insensível a maiúsculas e minúsculas (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | A coluna é `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | A coluna não é `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

`isnull` e `notnull` ignoram seu valor — o operador é a condição completa,
e qualquer coisa após o ponto é descartada. O SDK escreve `.null`, portanto, essa é a
grafia que você verá na transmissão.

:::caution[`eq.null` é a string de quatro caracteres, não `IS NULL`]
`?deleted_at=eq.null` busca pelo texto literal `null`. Em SQL, `= NULL` nunca
é verdadeiro, portanto não há interpretação de `eq.null` que signifique o teste de nulo —
use `isnull` para isso. O SDK serializa `.where("deleted_at", "==", null)` como
`isnull.null` exatamente por esse motivo.
:::

### Operadores Lógicos

Use `or`, `and` e `not` para condições complexas:

```bash
# OR: match products that are either cheap or on sale
GET /api/data/products?or=(price.lt.10,on_sale.eq.true)

# AND: explicit conjunction
GET /api/data/products?and=(active.eq.true,price.gt.0)

# NOT: everything that is not a discontinued in-stock item
GET /api/data/products?not=(discontinued.eq.true,stock.gt.0)
```

`not` nega a **conjunção** de suas condições: `not(a)` é `NOT a`, e
`not(a,b)` é `NOT (a AND b)`. Ele é compilado para um `NOT (...)` real em SQL, em vez de
operadores invertidos — o SQL possui lógica ternária (three-valued), de modo que `NOT (a AND b)` e
`(NOT a) OR (NOT b)` deixam de concordar a partir do momento em que um NULL está envolvido. Uma negação,
portanto, **inclui linhas cuja coluna é NULL**, que é o significado de `NOT`; adicione
um `notnull` junto com ele se não for isso que você deseja.

**Um grupo por requisição: `or` tem precedência sobre `and`, e ambos sobre `not`.** Eles são
três grafias para o mesmo slot, não três filtros. Em vez disso, aninhe-os:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Os grupos podem ser aninhados em até 32 níveis de profundidade; além disso, a requisição é recusada com
`INVALID_LOGICAL_GROUP`.

Um grupo **restringe** juntamente com os filtros de campo em vez de substituí-los — veja
[Como os filtros se combinam](#how-the-filters-combine).

### O dialeto JSON `where`

Os filtros de campo acima são uma das duas maneiras de enviar um filtro. A outra é um
único objeto JSON, que é o que o documento OpenAPI publica em cada
`GET /api/data/{slug}` e o que as rotas de subcoleções aninhadas aceitam:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Cada chave é um campo, cada valor é uma tupla canônica `[operator, value]` — as mesmas
tuplas que o SDK grava. Um valor também pode ser uma string separada por ponto pré-serializada
(`{"status":"eq.active"}`) ou um escalar simples (`{"status":"active"}`); todos os três
compilam para a mesma condição.

A diferença que vale a pena saber: **o JSON carrega tipos.** `?price=gte.100` envia a
string `"100"` e o driver faz o cast pelo tipo da coluna, enquanto
`?where={"price":[">=",100]}` envia um número. Para uma coluna cujas leituras textual e
numérica diferem — uma string de versão, um código preenchido com zeros — esse é o
parâmetro a ser utilizado.

Um `where` malformado resulta em um 400 `INVALID_WHERE`, e não em um filtro descartado silenciosamente:
descartá-lo executaria a leitura sem filtros e retornaria tudo o que a segurança em nível de linha (RLS)
porventura permitisse.

### Como os filtros se combinam

`?field=op.value`, `?where=`, `?or=`/`?and=` e `?searchString=` são
independentes, e cada um deles que estiver presente deve corresponder:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

Não há como aplicar OR entre eles. Qualquer coisa que não seja um AND simples
desses grupos deve ficar dentro de uma única árvore `or=`/`and=`.

## Ordenação

Use `orderBy` com o formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Uma direção ausente é assumida como `asc`. Uma direção que não seja `asc` nem `desc`, ou um
campo que a coleção não possui, resulta em um **400** — não em um 200 com as linhas na ordem
que o banco de dados preferir, o que seria indistinguível de uma ordenação que funcionou.

### Múltiplas chaves

A forma abreviada aceita uma chave. Para mais, passe um array JSON — a segunda chave
desempata linhas que a primeira considera iguais:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Ambas as grafias funcionam em todas as rotas que listam linhas, incluindo as aninhadas
(`/api/data/authors/:id/posts`). Toda ordenação termina no id da linha em ordem decrescente,
quer você tenha solicitado ou não: é isso que torna a ordenação total, e paginar
sobre uma ordem que não é total repete e pula linhas.

Um parâmetro `?orderBy=` repetido não é uma ordenação de múltiplas chaves — o último prevalece,
assim como para qualquer outro parâmetro de consulta. Use o array.

### Onde os NULLs são ordenados

Por padrão, os valores NULL são ordenados **por último em ordem ascendente e primeiro em ordem descendente**,
que é a própria convenção do Postgres. Um terceiro segmento separado por dois-pontos define o contrário:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

O formato de array JSON aceita uma chave `"nulls"` para a mesma finalidade:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Qualquer coisa diferente de `first` ou `last` é um 400, e não uma ordem silenciosamente diferente.
O cursor abaixo respeita o que a ordenação declarou, portanto, a paginação sobre uma chave
anulável permanece correta em qualquer posicionamento.

## Paginação

Use `limit` e `offset`, ou `page`:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

O limite padrão é **50**, o máximo é **1000**. Ambos vêm de `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, que a especificação OpenAPI gerada também informa — um `limit` acima do máximo é rejeitado em vez de ser limitado silenciosamente.

Todos os três parâmetros de janela são recusados em vez de corrigidos, e cada um
nomeia a si mesmo: `INVALID_LIMIT`, `INVALID_OFFSET` (um número inteiro de 0 ou mais) e
`INVALID_PAGE` (um número inteiro de 1 ou mais). Uma janela sutilmente diferente da
solicitada não pode ser distinguida de ter atingido o final da coleção, e é por isso que
nenhum deles é truncado ou ignorado.

### Paginação por cursor

`offset` reconta as linhas a cada requisição, portanto, uma linha inserida ou excluída entre
duas páginas desloca a janela e a navegação silenciosamente pula ou repete linhas.
`?after=` faz uma busca direta (seek): a próxima página começa estritamente após a última linha retornada.

Cada resposta de listagem inclui `meta.nextCursor` enquanto houver outra página. Envie-o
de volta inalterado:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

O cursor é **opaco** — ele codifica as chaves de ordenação *e* os valores da última linha
para elas — portanto, três regras se aplicam, cada uma resultando em um 400 em vez de uma página incorreta:

| Situação | Código |
|----------|--------|
| `after` com `offset` ou `page` | `CURSOR_WITH_OFFSET` — ambos definem onde a página começa |
| `after` com um `orderBy` diferente daquele sob o qual foi emitido | `CURSOR_ORDER_MISMATCH` |
| Um cursor que esta API não emitiu | `INVALID_CURSOR` |

Uma requisição que não especifica nenhum `orderBy` **adota o do cursor**, portanto,
reenviar `meta.nextCursor` sem reafirmar a ordenação funciona.

Ordenações de múltiplas chaves e chaves anuláveis paginam corretamente: a comparação é construída
sobre cada chave em ordem, com o posicionamento de NULL que a ordenação declarou. A única
ordenação que nenhum cursor pode descrever é a relevância (`_score`) — computada por consulta e
não armazenada em lugar nenhum — e tal listagem simplesmente não traz `nextCursor`.

## Selecionando colunas

<span class="since-badge" data-since="0.20">Desde 0.20</span>

`?fields=` restringe uma leitura às colunas que você especificar. É uma projeção aplicada
diretamente na consulta, não um corte na resposta:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

A chave primária sempre é retornada (uma linha que não pode ser referenciada não pode ser
atualizada, excluída ou paginada — e o cursor é derivado dela), e colunas
`excludeFromApi` permanecem ocultas, sejam nomeadas ou não. Uma coluna desconhecida resulta
em um 400 `UNKNOWN_FIELD`, em vez de uma linha silenciosamente sem um campo.

`?distinct=true` agrupa linhas idênticas nessas colunas:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

É recusado (400) juntamente com um `searchString` ranqueado ou uma busca vetorial, que
atribuem uma pontuação por linha tornando cada linha distinta por definição, e quando
`orderBy` especifica uma coluna que `fields` não retorna
(`DISTINCT_ORDER_BY_NOT_SELECTED`) — o Postgres não pode ordenar uma leitura DISTINCT por uma
expressão fora de sua lista de seleção.

`?fields=` e `?distinct=` também funcionam na rota de busca por ID e nas rotas de
subcoleções aninhadas.

### Formato da Resposta

As respostas de listagem incluem metadados de paginação:

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
        "hasMore": true,
        "nextCursor": "eyJrIjpbWyJpZCIsImRlc2MiXV0sInYiOnsiaWQiOjJ9LCJpIjoyfQ"
    }
}
```

`nextCursor` está presente enquanto `hasMore` for verdadeiro e a página tiver retornado pelo
menos uma linha; ele fica ausente na última página e em ordenações que nenhum cursor pode
descrever.

Respostas de entidade única retornam um objeto plano:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Erros

Toda falha, de qualquer rota, retorna no mesmo envelope:

```json
{
    "error": {
        "message": "Unknown filter operator 'contains' on field 'title'.",
        "code": "UNKNOWN_FILTER_OPERATOR",
        "details": { "field": "title", "operator": "contains" },
        "requestId": "9f1c0b8e-4d2a-4e1b-9d0f-2c7a5b3e6a11"
    }
}
```

`message` e `code` estão sempre presentes. `details` aparece quando a recusa é
*sobre* algo — o campo incorreto, os caminhos que falharam. `requestId`
aparece quando a requisição continha um cabeçalho `X-Request-ID` ou quando um lhe foi atribuído;
ele também é refletido no cabeçalho da resposta e é o valor a ser citado em um relatório de bug.

**Faça o tratamento de fluxo com base no `code`, nunca na `message` ou apenas no status.** Os códigos estão em
`SCREAMING_SNAKE_CASE` e são estáveis; as mensagens são escritas para uma pessoa lendo um
console e estão sujeitas a alterações. O status HTTP está na resposta, não no corpo.

| Status | Código comum | Significado |
|--------|--------------|-------------|
| 400 | `BAD_REQUEST`, `VALIDATION_ERROR`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | A requisição está malformada ou solicita algo impossível |
| 401 | `UNAUTHORIZED` | Nenhuma credencial informada, ou uma credencial que não identifica ninguém |
| 403 | `FORBIDDEN`, `DB_PERMISSION_DENIED` | Uma credencial que identifica alguém sem a devida permissão |
| 404 | `NOT_FOUND` | O recurso solicitado não existe |
| 409 | `CONFLICT` | O estado entra em conflito — uma chave duplicada, uma árvore corrompida |
| 501 | varia | A funcionalidade existe, mas **não está configurada** nesta implantação |
| 503 | `SERVICE_UNAVAILABLE` | Uma dependência está fora do ar; a requisição nem chegou a alcançá-la |

Uma superfície que está ausente porque esta implantação não a habilitou responde com 501
acompanhado de um código e um motivo, e não 404 — um 404 sem explicação em uma rota que a
interface acabou de chamar parece uma implantação quebrada.

As rotas adicionam seus próprios códigos mais específicos sobre estes (`EMAIL_EXISTS`,
`TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …), portanto, considere a lista de códigos como
aberta. O SDK cliente converte todos eles em um único `RebaseApiError` contendo
`status`, `code` e `details` — consulte
[Tratamento de erros](/docs/backend#error-handling).

## Busca Textual

Use `searchString` para busca de texto completo (full-text search) em campos de texto:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Busca Vetorial

Se uma coleção definir uma propriedade com o tipo `vector`, você poderá realizar buscas de similaridade de alta velocidade usando operações de distância do pgvector compiladas diretamente na consulta do banco de dados.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

### Parâmetros de Consulta Vetorial

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `vector_search` | `string` | O nome da propriedade de vetor a ser consultada. |
| `vector` | `string` | Um array serializado em JSON de números de ponto flutuante representando o vetor de consulta. |
| `vector_distance` | `string` | A métrica de distância a ser avaliada. Valores suportados: `cosine` (padrão, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Limiar máximo de distância. Apenas registros com distância menor que este limiar são retornados. |

## Inclusão de Relações

Use o parâmetro `include` para embutir entidades relacionadas:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations, one hop deep
GET /api/data/articles?include=*

# A relation of a relation — up to three hops
GET /api/data/articles?include=comments.author
```

Um nome que não seja uma relação da coleção resulta em um **400
`UNKNOWN_RELATION`**, em qualquer nível. Anteriormente isso era ignorado, o que respondia 200
com o campo simplesmente ausente — indistinguível de uma linha que genuinamente não
possui uma linha relacionada, fazendo com que um erro de digitação parecesse exatamente com dados vazios. Um caminho com
profundidade superior a três níveis (hops) resulta em `INCLUDE_TOO_DEEP`.

### Restringindo uma relação

O formato separado por vírgulas não tem onde posicionar um `limit` por relação; portanto,
`include` também aceita JSON — diferenciado por uma chave de abertura:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Chave | Significado |
|-------|-------------|
| `limit` | Linhas **por linha pai**, não em toda a página |
| `where` | O mesmo dialeto de filtro utilizado pelo `where` de nível superior |
| `logical` | Um grupo `or`/`and`/`not` sobre as linhas relacionadas |
| `orderBy` | A mesma sintaxe de ordenação, incluindo o posicionamento de NULL |
| `fields` | Colunas da linha *relacionada*; sua chave sempre é mantida |
| `include` | Relações da linha relacionada, por sua vez |

`true` significa "carregar por completo", portanto `{"author":true}` e `author` são a mesma
requisição. Ambas as formas funcionam na rota de listagem, na rota de busca por ID e nas
rotas de subcoleções aninhadas.

Cada salto (hop) é uma consulta em lote para toda a página, nunca uma por linha.

As relações incluídas são embutidas diretamente na resposta:

```json
{
    "id": 1,
    "title": "Getting Started",
    "authorId": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com"
    }
}
```

## Escrita

Chaves de idempotência, escritas condicionais (`ETag` / `If-Match`), operações de campo
(`$inc`, `$push`, `$pull`, `$merge`), upsert com chave natural,
`Prefer: return=minimal`, e o endpoint entre coleções `POST /api/data/_batch`
estão todos em sua própria página: **[Escrita via
REST](/docs/backend/writes/)**.

## Pipeline de Hooks de Ciclo de Vida

Toda operação de mutação REST (`POST`, `PATCH`, `DELETE`) passa por um pipeline de execução de hooks rigoroso e sequencial:

```
Request ──► beforeSave/beforeDelete (blocking) ──► DB Operation ──► afterSave/afterDelete (deferred) ──► Response
```

### Hooks Bloqueantes vs. Adiados (Deferred)

1. **Hooks Bloqueantes (`beforeSave`, `beforeDelete`)**
   Esses hooks são executados sincronicamente no ciclo principal da requisição *antes* de confirmar (commit) a transação no banco de dados. Eles podem modificar os payloads recebidos, executar validações personalizadas ou abortar a requisição completamente lançando um erro.

2. **Hooks Adiados (`afterSave`, `afterDelete`)**
   Esses hooks são executados de forma assíncrona após a transação do banco de dados ter sido confirmada com sucesso. Eles usam promises adiadas (fire-and-forget), o que significa que são executados em segundo plano e não bloqueiam a resposta HTTP para o cliente. Ideal para enviar webhooks, disparar notificações push ou enfileirar tarefas externas.

## Endpoints do sistema

| Método | Caminho | Autenticação | Descrição |
|--------|---------|--------------|-----------|
| `GET` | `/health` e `/api/health` | nenhuma | Verificação de disponibilidade/prontidão (liveness/readiness) |
| `GET` | `/api/docs` | nenhuma | A especificação JSON OpenAPI 3.0 |
| `GET` | `/api/swagger` | nenhuma | Swagger UI. Ativo em desenvolvimento, desativado em produção; `REBASE_ENABLE_SWAGGER` substitui essa definição em ambos os casos |
| `GET` | `/api/meta/schema-version` | nenhuma | O hash do schema a partir do qual este backend foi construído — deliberadamente não autenticado, retornando apenas esse hash |
| `GET` | `/api/meta/contract` | admin, chave de serviço ou chave de API de admin | O contrato completo de coleções, para `rebase generate-sdk --from`. Fail-closed: `404` quando nenhuma autenticação estiver configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando definido | Métricas do Prometheus, quando `REBASE_METRICS=true` |

## OpenAPI / Swagger

A especificação OpenAPI é gerada automaticamente a partir das definições das suas coleções: ela descreve os endpoints de listagem, leitura, criação, atualização, exclusão e operações em lote de cada coleção servida pelo backend, com seus parâmetros de consulta e esquemas de resposta. Não é um mapa completo de toda a superfície HTTP — as rotas de autenticação, armazenamento, funções e cron são documentadas apenas neste site — e colunas marcadas com `excludeFromApi` são deixadas de fora dela.

Clientes automatizados (máquinas) autenticam-se com uma chave com escopo em vez de uma sessão:
[Chaves de API](/docs/backend/api-keys/).

## Metadados do Schema

O schema completo de coleções do projeto — cada coleção, propriedade e relação —
é servido a um admin autenticado:

```bash
GET /api/meta/contract
```

Ele é **exclusivo para admin**, e em uma implantação sem autenticação configurada ele
não é servido de forma alguma (404 `CONTRACT_UNAVAILABLE`), em vez de expor o
schema a qualquer pessoa. Seu endpoint irmão retorna uma string de versão que representa o
schema sem descrevê-lo, sendo deliberadamente acessível sem nenhuma credencial
— que é o que um job de CI consulta periodicamente:

```bash
GET /api/meta/schema-version
```

Para a estrutura dos endpoints em vez do schema por trás deles, o documento OpenAPI
está em `GET /api/docs`, com o Swagger UI em `/api/swagger` quando
`enableSwagger` estiver ativado.

## Próximos Passos

- **[SDK Cliente](/docs/sdk)** — Cliente type-safe para a API REST
- **[Coleções](/docs/collections)** — Defina o schema dos seus dados
- **[Regras de Segurança (RLS)](/docs/collections/security-rules)** — Controle o acesso por linha

---
