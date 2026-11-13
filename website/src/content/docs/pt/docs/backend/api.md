---
sourceHash: 4fc45b4d1d08afde
title: API REST
sidebar_label: API REST
description: Endpoints de API REST gerados automaticamente para cada tabela, com filtragem, ordenação, paginação e inclusão de relações.
---

## Visão geral

O Rebase gera automaticamente uma API completa a partir das suas tabelas:

- **API REST** — Endpoints CRUD para cada tabela em `/api/data/:slug`
- **Especificação OpenAPI** — Especificação legível por máquina em `/api/docs`, servida para cada chamador autenticado para as tabelas que ele pode ver
- **Swagger UI** — Explorador interativo de API em `/api/swagger`, quando você publica o documento (`REBASE_ENABLE_SWAGGER=true`, fora de produção)

Nenhum código é necessário — [declare suas tabelas](/docs/schema/) e a API surge automaticamente.

## Endpoints REST

Para cada tabela, os seguintes endpoints são gerados. Todas as outras rotas que o backend monta — auth, storage, admin, meta — estão no [índice de endpoints](/docs/backend/endpoints/).

| Método | Caminho | Descrição |
|--------|---------|-----------|
| `GET` | `/api/data/:slug` | Listar entidades |
| `POST` | `/api/data/:slug/query` | A mesma listagem, com seus parâmetros de consulta em um corpo JSON — para consultas longas demais para uma URL. Consulte [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | Contar entidades |
| `GET` | `/api/data/:slug/aggregate` | `count()`, `sum()`, `avg()`, `min()`, `max()`, opcionalmente agrupados. Aceita os mesmos filtros do endpoint de listagem, e o RLS se aplica às linhas que estão sendo agregadas — consulte [Consultas](/docs/sdk/querying/) |
| `GET` | `/api/data/:slug/:id` | Obter uma única entidade |
| `POST` | `/api/data/:slug` | Criar um registro |
| `PATCH` | `/api/data/:slug/:id` | Atualizar um registro (parcial — apenas as propriedades enviadas são gravadas) |
| `DELETE` | `/api/data/:slug/:id` | Excluir um registro |
| `POST` | `/api/data/:slug/bulk` | Criar várias entidades em uma única transação |
| `PATCH` | `/api/data/:slug/bulk` | Atualizar várias entidades em uma única transação |
| `POST` | `/api/data/:slug/bulk/delete` | Excluir várias entidades em uma única transação |
| `POST` | `/api/data/_batch` | Gravar **entre** tabelas em uma única transação |

### Rotas aninhadas

As relações são acessíveis por meio de caminhos de URL:

```
GET    /api/data/authors/42/posts         → list author's posts
POST   /api/data/authors/42/posts/query   → the same listing, parameters in the body (0.24+)
POST   /api/data/authors/42/posts/count   → the same count, parameters in the body (0.24+)
GET    /api/data/authors/42/posts/7       → get a specific post by author
POST   /api/data/authors/42/posts         → create a post for author
PATCH  /api/data/authors/42/posts/7       → update the post
DELETE /api/data/authors/42/posts/7       → delete the post
```

#### Mecânica de roteamento e análise de segmentos

Para lidar com profundidades de aninhamento arbitrárias, o Rebase roteia as requisições recebidas usando o regex de parâmetro `:rest{.+}` do Hono. O mecanismo interno de análise de segmentos analisa os caminhos contando segmentos separados por barra:
- **Contagem ímpar de segmentos** (por exemplo, `authors/42/posts` -> 3 segmentos) representa uma requisição de listagem na tabela relacionada.
- **Contagem par de segmentos** (por exemplo, `authors/42/posts/7` -> 4 segmentos) representa uma operação em um ID de linha específico. O último segmento é extraído como o ID de destino.

O mecanismo filtra namespaces reservados do sistema (por exemplo, `history`) da análise de segmentos de caminho para evitar colisões com endpoints nativos.

## Autenticação

Todos os endpoints de dados exigem autenticação por padrão. Inclua um token Bearer no cabeçalho `Authorization`:

```bash
curl -H "Authorization: Bearer <access-token>" \
     https://api.example.com/api/data/products
```

Para chamadas servidor-a-servidor, use a chave de serviço:

```bash
curl -H "Authorization: Bearer <service-key>" \
     https://api.example.com/api/data/products
```

A filtragem de uma lista — operadores `?field=op.value`, grupos `or`/`and`, o dialeto JSON `where` e como eles se combinam — tem [sua própria página](/docs/backend/filtering).

## Ordenação

Use `orderBy` no formato `field:direction`:

```bash
# Sort by price descending
GET /api/data/products?orderBy=price:desc

# Sort by name ascending (default)
GET /api/data/products?orderBy=name:asc
```

Uma direção omitida é `asc`. Uma direção que não seja `asc` nem `desc`, ou um campo que a tabela não possui, resulta em um **400** — e não em um 200 com as linhas na ordem que o banco de dados preferir, o que seria indistinguível de uma ordenação bem-sucedida.

### Múltiplas chaves

A sintaxe abreviada aceita uma chave. Para mais chaves, passe um array JSON — a segunda chave desempata linhas que a primeira considera iguais:

```bash
# By category, and newest first within each category
GET /api/data/products?orderBy=[{"field":"category"},{"field":"createdAt","direction":"desc"}]
```

Ambas as formas funcionam em qualquer rota que liste linhas, incluindo rotas aninhadas (`/api/data/authors/:id/posts`). Toda ordenação termina com o ID da linha em ordem decrescente, quer você tenha solicitado ou não: é isso que torna a ordenação total, e paginar sobre uma ordem que não é total repete e pula linhas.

Um parâmetro `?orderBy=` repetido não é uma ordenação de múltiplas chaves — o último prevalece, como acontece com qualquer outro parâmetro de consulta. Use o array.

### Onde valores NULL são ordenados

Por padrão, valores NULL são ordenados **por último em ordem ascendente e primeiro em ordem descendente**, que é a própria convenção do Postgres. Um terceiro segmento separado por dois-pontos altera isso:

```bash
# Newest first, with the undated rows at the end rather than the top
GET /api/data/posts?orderBy=publishedAt:desc:last
```

O formato de array JSON aceita uma chave `"nulls"` para a mesma finalidade:

```bash
GET /api/data/posts?orderBy=[{"field":"publishedAt","direction":"desc","nulls":"last"}]
```

Qualquer valor diferente de `first` ou `last` resulta em um 400, e não em uma ordenação silenciosamente diferente. O cursor abaixo respeita o que a ordenação declarou, de modo que a paginação sobre uma chave anulável permanece correta em qualquer um dos posicionamentos.

## Paginação

Use `limit` e `offset`, ou `page` — um ou outro:

```bash
# Limit and offset
GET /api/data/products?limit=20&offset=40

# Page-based (uses the default limit of 50)
GET /api/data/products?page=3
```

O limite padrão é **50**, o máximo é **1000**. Ambos vêm de `DEFAULT_LIST_LIMIT` / `MAX_LIST_LIMIT`, que a especificação OpenAPI gerada também informa — um `limit` acima do máximo é rejeitado em vez de ser ajustado/truncado.

Todos os três parâmetros de janela são recusados em vez de corrigidos, e cada um identifica a si mesmo: `INVALID_LIMIT`, `INVALID_OFFSET` (um número inteiro maior ou igual a 0) e `INVALID_PAGE` (um número inteiro maior ou igual a 1). Uma janela silenciosamente diferente da solicitada não pode ser diferenciada de ter atingido o final da tabela, e é por isso que nenhum deles é truncado ou ignorado.

Pelo mesmo motivo, `page` e `offset` juntos resultam em um 400 `PAGE_WITH_OFFSET`, em vez de um deles prevalecer silenciosamente.

### Omitindo a contagem

`meta.total` é um `COUNT(*)` sobre todas as linhas correspondentes — em uma tabela grande, a maior parte do custo de uma requisição de listagem. `?count=none` (`GET /api/data/orders?count=none`) o ignora: sem `meta.total`, enquanto `meta.hasMore` permanece exato (a leitura solicita uma linha além da página). `?count=exact` é o padrão; qualquer outro valor resulta em um 400 `INVALID_COUNT`. Uma leitura com `?distinct=true` nunca é contada, nem uma busca vetorial com um `vector_threshold` (consulte [Busca vetorial](/docs/backend/vector-search/)).

### Paginação por cursor

O `offset` recomputa as linhas a cada requisição; portanto, uma linha inserida ou excluída entre duas páginas desloca a janela, e a iteração pula ou repete linhas silenciosamente. Em vez disso, `?after=` faz uma busca direta: a próxima página começa estritamente após a última linha servida.

Toda resposta de listagem traz `meta.nextCursor` enquanto houver outra página. Envie-o de volta inalterado:

```bash
GET /api/data/orders?orderBy=createdAt:desc&limit=100
# → meta.nextCursor = "eyJrIjpbWyJjcmVhdGVkX2F0Iiw…"

GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJjcmVhdGVkX2F0Iiw…
```

O cursor é **opaco** — ele codifica as chaves de ordenação *e* os valores da última linha para elas — portanto, seguem-se três regras, cada uma resultando em um 400 em vez de uma página errada:

| Situação | Código |
|----------|--------|
| `after` com `offset` ou `page` | `CURSOR_WITH_OFFSET` — ambos determinam onde a página começa |
| `after` com um `orderBy` diferente daquele sob o qual foi emitido | `CURSOR_ORDER_MISMATCH` |
| Um cursor que esta API não emitiu | `INVALID_CURSOR` |

Uma requisição que não define `orderBy` **adota o do cursor**, de modo que repassar `meta.nextCursor` sem reiterar a ordenação funciona.

Ordenações por múltiplas chaves e chaves anuláveis paginam corretamente: a comparação é construída sobre cada chave em ordem, com o posicionamento de NULL declarado na ordenação. A única ordenação que nenhum cursor pode descrever é a relevância (`_score`) — computada por consulta e não armazenada em lugar nenhum — e tal listagem simplesmente não traz `nextCursor`.

## Selecionando colunas

`?fields=` restringe uma leitura às colunas nomeadas. É uma projeção aplicada diretamente na consulta, não um corte da resposta:

```bash
GET /api/data/posts?fields=id,title&limit=50
```

A chave primária sempre retorna (uma linha que não pode ser referenciada não pode ser atualizada, excluída ou paginada — e o cursor é derivado dela), e colunas `.private()` permanecem ocultas quer sejam nomeadas ou não. Uma coluna desconhecida resulta em um 400 `UNKNOWN_FIELD`, em vez de uma linha com um campo faltando silenciosamente.

Uma relação indicada em `?include=` retorna independentemente de `?fields=` nomeá-la ou não: `?include=author&fields=title` retorna `title`, a chave e `author`. Nomear a relação em `?fields=` também é permitido e não altera nada.

`?distinct=true` agrupa linhas idênticas nessas colunas:

```bash
# The statuses actually in use
GET /api/data/posts?fields=status&distinct=true
```

Isso é recusado (400) em conjunto com uma `searchString` classificada por relevância ou uma busca vetorial, que anexam uma pontuação por linha tornando cada linha distinta por definição, e quando `orderBy` referencia uma coluna que `fields` não retorna (`DISTINCT_ORDER_BY_NOT_SELECTED`) — o Postgres não pode ordenar uma leitura DISTINCT por uma expressão fora de sua lista de seleção (SELECT).

`?fields=` e `?distinct=` também funcionam na rota get-by-id e nas rotas aninhadas.

### Formato de resposta

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

`nextCursor` está presente enquanto `hasMore` for true e a página tiver retornado pelo menos uma linha; ele fica ausente na última página e em ordenações que nenhum cursor consegue descrever.

As respostas de entidade única retornam um objeto plano:

```json
{
    "id": 1,
    "name": "Widget",
    "price": 29.99,
    "createdAt": "2026-01-15T10:30:00Z"
}
```

## Erros

Toda falha, de qualquer rota, retorna em um único envelope:

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

`message` e `code` estão sempre presentes. `details` aparece quando a recusa é *sobre* algo — o campo incorreto, os caminhos com falha. `requestId` aparece quando a requisição continha um cabeçalho `X-Request-ID` ou quando um foi atribuído a ela; ele também é refletido no cabeçalho de resposta e é o valor a ser citado em um relatório de bug.

**Faça o tratamento com base no `code`, nunca na `message` ou apenas no status.** Os códigos estão em `SCREAMING_SNAKE_CASE` e são estáveis; as mensagens são escritas para uma pessoa lendo um console e podem mudar livremente. O status HTTP está na resposta, não no corpo.

| Status | Código típico | Significado |
|--------|---------------|-------------|
| 400 | `BAD_REQUEST`, `INVALID_INPUT`, `INVALID_LIMIT`, `INVALID_OFFSET`, `INVALID_PAGE` | A requisição está malformada ou solicita algo impossível |
| 401 | `UNAUTHORIZED` | Nenhuma credencial, ou uma credencial que não identifica ninguém |
| 403 | `FORBIDDEN`, `SCOPE_MISSING`, `WRITE_DENIED` | Uma credencial que identifica alguém sem a permissão necessária |
| 404 | `NOT_FOUND` | O recurso solicitado não existe |
| 409 | `CONFLICT` | O estado está em conflito — uma chave duplicada, uma árvore suja |
| 501 | varia | O recurso existe, mas **não está configurado** nesta implantação |
| 503 | `SERVICE_UNAVAILABLE` | Uma dependência está fora do ar; a requisição nunca chegou a ela |

Um recurso ausente porque esta implantação não o habilitou responde 501 com um código e um motivo, não 404 — um 404 inexplicado em uma rota que a UI acabou de chamar parece uma implantação com problemas.

As rotas adicionam seus próprios códigos mais específicos além desses (`EMAIL_EXISTS`, `TOKEN_EXPIRED`, `UNKNOWN_FILTER_OPERATOR`, …); portanto, considere a lista de códigos como aberta. O SDK tipado converte todos eles em um único `RebaseApiError` contendo `status`, `code` e `details` — consulte [Tratamento de erros](/docs/backend#error-handling).

## Busca textual

Use `searchString` para busca de texto completo em campos de string:

```bash
GET /api/data/products?searchString=wireless%20keyboard
```

## Busca vetorial

Uma tabela com uma coluna `col.vector()` aceita uma busca por vizinhos mais próximos na listagem: `?vector_search=embedding&vector=[0.15,0.22,-0.05]`, com `vector_distance` e `vector_threshold` opcionais. Os parâmetros, limites e como os filtros se comportam no índice estão em [Busca vetorial](/docs/backend/vector-search/).

## Consultas longas demais para uma URL

`POST /api/data/:slug/query` (esta listagem) e `POST /api/data/:slug/count` aceitam os parâmetros de consulta em um corpo JSON, para consultas cuja URL não comportaria os parâmetros — como um embedding ou uma lista longa de `in`.
Consulte [Consultas longas demais para uma URL](/docs/backend/vector-search/#queries-too-long-for-a-url).

## Inclusão de relações

Use o parâmetro `include` para incorporar entidades relacionadas:

```bash
# Include specific relations
GET /api/data/articles?include=author,categories

# Include all relations, one hop deep
GET /api/data/articles?include=*

# A relation of a relation — up to three hops
GET /api/data/articles?include=comments.author
```

Um nome que não seja uma relação da tabela resulta em um **400 `UNKNOWN_RELATION`**, em qualquer nível. Anteriormente isso era ignorado, o que retornava 200 com o campo simplesmente ausente — indistinguível de uma linha que genuinamente não possui linha relacionada, fazendo com que um erro de digitação parecesse dados vazios. Um caminho com mais de três saltos resulta em `INCLUDE_TOO_DEEP`. Um nome é a chave exata da relação em `relations` da tabela; grafias em slug e snake_case que versões mais antigas também tentavam usar não são aceitas. Linhas relacionadas retornam no [`orderBy`](/docs/collections/relations/) declarado da relação quando a requisição não especifica nenhum, e uma chave estrangeira gerada por uma relação em uma coluna `bigint` ou `numeric` é servida como um número.

### Restringindo uma relação

O formato separado por vírgulas não permite definir um `limit` por relação, portanto `include` também aceita JSON — diferenciado por uma chave de abertura inicial:

```bash
GET /api/data/posts?include={"comments":{"limit":5,"where":{"published":["==",true]},"orderBy":"createdAt:desc","fields":["id","body"],"include":{"author":true}}}
```

| Chave | Significado |
|-------|-------------|
| `limit` | Linhas **por linha pai**, e não na página toda. Aplicado pela consulta, de modo que as linhas além dele nunca são lidas do banco de dados |
| `where` | O mesmo dialeto de filtro usado pelo `where` de nível superior |
| `logical` | Um grupo `or`/`and`/`not` sobre as linhas relacionadas |
| `orderBy` | A mesma sintaxe de ordenação, incluindo o posicionamento de NULL. Empates, e um `limit` sem `orderBy`, ordenam pela chave da linha relacionada, em ordem ascendente |
| `fields` | Colunas da linha *relacionada*; sua chave sempre é mantida |
| `include` | Relações da linha relacionada, por sua vez |
| `count` | `true` também retorna o total de cada pai sob `_count` (`"_count":{"comments":37}`), contado pela mesma instrução. Apenas relações para muitos (to-many). Consulte [Contando o que um limite deixa de fora](/docs/sdk/relations#counting-what-a-limit-leaves-out) |

`true` significa "carregar tudo", então `{"author":true}` e `author` são a mesma requisição.
Ambas as sintaxes funcionam na rota de listagem, na rota get-by-id e nas rotas aninhadas.

Cada salto é uma consulta em lote para toda a página, nunca uma por linha.

Relações incluídas são incorporadas diretamente na resposta:

```json
{
    "id": 1,
    "title": "Getting Started",
    "authorId": 42,
    "author": {
        "id": 42,
        "name": "Jane Doe",
        "email": "jane@example.com",
        "companyId": 7
    }
}
```

Uma linha incluída é exatamente o que a própria rota do destino (`GET /api/data/authors/42`) serve: as mesmas colunas e codificações, chaves estrangeiras como colunas, sem objetos de referência.

## Escrita

Chaves de idempotência, escritas condicionais (`ETag` / `If-Match`), operações de campo (`$inc`, `$push`, `$pull`, `$merge`), upsert em uma chave natural, `Prefer: return=minimal`, e o endpoint entre tabelas `POST /api/data/_batch` estão todos em sua própria página: **[Escrita via REST](/docs/backend/writes/)**.

## Pipeline de hooks de ciclo de vida

No Postgres, cada mutação REST (`POST`, `PATCH`, `DELETE`) executa os hooks da sua tabela em ordem, dentro da mesma transação que realiza a escrita:

```
Request ──► BEGIN ──► beforeSave/beforeDelete ──► DB operation ──► afterSave/afterDelete ──► COMMIT ──► Response
```

Cada hook é aguardado com await, e uma exceção (throw) em qualquer um deles desfaz toda a escrita:

1. **`beforeSave`, `beforeDelete`** são executados antes da escrita. Eles podem alterar os valores recebidos, validar ou recusar a requisição lançando um erro — o chamador recebe **400 `CALLBACK_REJECTED`** e nada é gravado.
2. **`afterSave`, `afterDelete`** são executados após a escrita, mas *antes* do commit. Um throw reverte a linha e responde com o mesmo 400, com `details.stage` indicando o hook. Eles mantêm a transação aberta enquanto são executados, o que os torna o lugar inadequado para webhooks ou qualquer outra chamada de rede — [Hooks](/docs/backend/hooks#side-effects-that-must-not-hold-the-transaction) explica onde esse trabalho deve ser feito.

## Endpoints do sistema

| Método | Caminho | Autenticação | Descrição |
|--------|---------|--------------|-----------|
| `GET` | `/health` e `/api/health` | nenhuma | Verificação de disponibilidade/prontidão (liveness/readiness) |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">A partir de 0.31</span> por padrão, os chamadores para os quais `GET /api/schema/tables` descreve tabelas (401 anônimo a menos que `schemaTables.public`); nenhuma quando `enableSwagger` é `true`; a barreira de admin quando é `false` | A especificação JSON do OpenAPI 3.0 — por padrão apenas as tabelas, colunas e relações que o endpoint de schema descreve para esse chamador. `404 DOCS_UNAVAILABLE` quando nenhuma autenticação estiver configurada |
| `GET` | `/api/swagger` | nenhuma | Swagger UI. Servido apenas quando `enableSwagger` é `true` (`REBASE_ENABLE_SWAGGER=true`), e nunca em produção |
| `GET` | `/api/meta/schema-version` | nenhuma | O hash do schema a partir do qual este backend foi construído e a versão do runtime — deliberadamente não autenticado, sem conter nada que descreva o schema |
| `GET` | `/api/meta/contract` | `schema:read`: um administrador, a chave de serviço ou uma chave de API que o possua | A versão do schema, o runtime e cada tabela como um administrador os vê, para `rebase generate-sdk --from`. Fail-closed: `404` quando nenhuma autenticação estiver configurada |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` quando definido | Métricas do Prometheus, quando `REBASE_METRICS=true` |

## OpenAPI / Swagger

A especificação OpenAPI é gerada automaticamente a partir das suas tabelas: ela descreve os endpoints list, query, count, aggregate, read, create, update, delete e bulk de cada tabela que o backend serve, suas rotas aninhadas e `_batch`, com seus parâmetros de consulta e esquemas de resposta. Não se trata de um mapa completo de toda a superfície HTTP — as rotas de auth, storage, functions e cron estão documentadas apenas neste site — e colunas marcadas como `.private()` são omitidas. A `description` de uma tabela e o `.describe()` de uma coluna são suas descrições.

Para uma tabela com [`softDelete`](/docs/collections/soft-delete/), a especificação indica que uma exclusão, individual ou em lote, move a linha para a lixeira, e documenta `?hard=true` em ambas as exclusões e `?deleted=include|only` na listagem, na leitura individual, na contagem e na agregação. O explorador de API do Studio envia apenas os parâmetros nomeados na especificação; portanto, é isso que permite a ele expurgar uma linha ou listar a lixeira.

Chamadores automatizados/máquinas autenticam-se com uma chave com escopo em vez de uma sessão: [Chaves de API](/docs/backend/api-keys/).

## Metadados do schema

<span class="since-badge" data-since="0.31">A partir de 0.31</span>

As tabelas que o backend serve são descritas, por chamador, em `GET /api/schema/tables` — os descritores a partir dos quais o CMS e o Studio realizam a renderização. Qualquer chamador autenticado recebe as tabelas que tem permissão de ver, ocultando o que não puder ler; [Endpoints](/docs/backend/endpoints/#schema) contém a matriz.

Todo o schema como um administrador o vê é servido em:

```bash
GET /api/meta/contract
```

```json
{ "schemaVersion": "v2:…", "runtime": { "version": "0.30.1", "contract": 2 }, "tables": [ … ] }
```

Ele requer o escopo **`schema:read`**, que um administrador possui, e em uma implantação sem autenticação configurada ele não é servido de forma alguma (404 `CONTRACT_UNAVAILABLE`), em vez de expor o schema para qualquer pessoa. As versões de schema começam com `v2:` desde a versão 0.31: elas são calculadas a partir das tabelas compiladas, de modo que a versão de cada projeto mudou uma vez. Seu endpoint irmão retorna uma string de versão que representa o schema sem descrevê-lo, e é deliberadamente acessível sem nenhuma credencial — que é o que um job de CI consulta:

```bash
GET /api/meta/schema-version
```

Para o formato dos endpoints em vez do schema por trás deles, o documento OpenAPI está em `GET /api/docs`: autenticado, você obtém o documento das tabelas que pode visualizar. O Swagger UI em `/api/swagger` é servido apenas quando o documento é publicado com `REBASE_ENABLE_SWAGGER=true`, fora de produção.

## Próximos passos

- **[SDK tipado](/docs/sdk)** — Cliente type-safe para a API REST
- **[Tabelas](/docs/schema/)** — Defina seu schema de dados
- **[Regras de segurança (RLS)](/docs/collections/security-rules)** — Controle o acesso por linha
