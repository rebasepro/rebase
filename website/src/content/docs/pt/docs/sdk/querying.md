---
sourceHash: 3cba57377cf922df
title: Consultando Dados
sidebar_label: Consultando Dados
description: Operações CRUD, construtor de consultas fluente, operadores de filtro, ordenação, seleção de colunas e agregações com o Rebase Client SDK.
---

## Acessando Coleções

Acesse qualquer coleção através de `client.data.<collectionName>` (camelCase, convertido automaticamente para snake_case) ou `client.data.collection<Record<string, unknown>>("slug")` (slug explícito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Modo estrito (SDK gerado):** Quando você passa o `collectionsDictionary` gerado para `createRebaseClient`, o proxy de dados valida os acessos a propriedades no momento do acesso. Um erro de digitação como `client.data.prodcuts` lançará imediatamente um erro explicativo com uma sugestão de correspondência mais próxima, em vez de produzir um erro 404 confuso posteriormente. Use `client.data.collection<Record<string, unknown>>("slug")` para ignorar a validação em slugs dinâmicos ou determinados em tempo de execução.

## Operações CRUD

### Find (Listar)

```typescript
// All products (default limit: 50)
const { data, meta } = await client.data.products.find();

// With pagination, filtering, and sorting
const { data, meta } = await client.data.products.find({
    where: { active: ["==", true], price: [">=", 100] },
    orderBy: ["createdAt", "desc"],
    limit: 25,
    offset: 0
});

// data is Row[] — flat rows, with the id at the top level
// meta has { total, limit, offset, hasMore }
```

### Ler um por ID

Dois métodos, pois existem duas situações que demandam códigos diferentes.

`get` é para um registro que você espera que exista — o ID veio de um link, de um parâmetro de rota ou de outro registro. Ele retorna o registro, para que nada downstream precise fazer narrowing de tipo, e um registro ausente é uma exceção que você pode tratar:

```typescript
const product = await client.data.products.get(42);
product.name;    // Row, not Row | undefined
```

```typescript
import { RebaseApiError } from "@rebasepro/client";

async function loadProduct(id: string) {
    try {
        return await client.data.products.get(id);
    } catch (e) {
        if (e instanceof RebaseApiError && e.code === "NOT_FOUND") return null;
        throw e;
    }
}
```

`findById` é para um registro que legitimamente pode não existir — uma busca por um ID digitado pelo usuário, uma verificação em cache:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
A segurança em nível de linha (row-level security) faz com que "registro inexistente" e "sem permissão de leitura" tenham a mesma resposta, deliberadamente: um 404 que fizesse essa distinção confirmaria a existência do registro.
:::

### Escrita

`create`, `upsert`, `update`, `delete` e suas variantes em lote estão em **[Escrevendo dados](/docs/sdk/writing/)**, junto com operações de campo, escritas condicionais e chaves de idempotência.

### Count (Contagem)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Construtor de Consultas Fluente (Fluent Query Builder)

Encadeie métodos para consultas mais expressivas:

```typescript
const { data } = await client.data.products
    .where("price", ">=", 100)
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(10)
    .find();
```

### Métodos Disponíveis

| Método | Descrição | Exemplo |
|--------|-----------|---------|
| `.where(field, op, value)` | Adiciona uma condição de filtro | `.where("age", ">=", 18)` |
| `.where(path, op, value)` | Filtra por uma [relação](#querying-through-a-relation) ou caminho [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Adiciona um [grupo OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordena os resultados | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordena por uma [agregação sobre uma relação](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita a quantidade de resultados | `.limit(25)` |
| `.offset(n)` | Pula os primeiros N resultados | `.offset(50)` |
| `.after(cursor)` | Continua após um [cursor](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Retorna [apenas estas colunas](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Agrupa registros idênticos nessas colunas | `.fields("status").distinct()` |
| `.search(text)` | Busca textual — veja [Busca](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Busca por vizinhos mais próximos em uma propriedade `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carrega registros relacionados](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Executa a consulta | Retorna `FindResult<M>` |
| `.aggregate(params)` | [Reduz em vez de retornar registros](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Transmite (stream) cada linha correspondente](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Coleta todas as linhas correspondentes](#reading-everything-iterate-and-findall) | Retorna `M[]` |
| `.count()` | Conta as linhas correspondentes | Retorna `number` |
| `.listen(onUpdate, onError?)` | Inscreve-se em atualizações em tempo real | Retorna `unsubscribe()` |

### Operadores de Filtro

| Operador | Alias | Descrição |
|----------|-------|-----------|
| `"=="` | `"eq"` | Igual |
| `"!="` | `"neq"` | Diferente |
| `">"` | `"gt"` | Maior que |
| `">="` | `"gte"` | Maior ou igual a |
| `"<"` | `"lt"` | Menor que |
| `"<="` | `"lte"` | Menor ou igual a |
| `"in"` | | Valor contido no array |
| `"not-in"` | `"nin"` | Valor não contido no array |
| `"array-contains"` | `"cs"` | Campo de array contém o valor |
| `"array-contains-any"` | `"csa"` | Campo de array contém qualquer um dos valores |
| `"like"` | `"like"` | Correspondência de padrão **diferenciando maiúsculas e minúsculas**; `%` e `_` são curingas |
| `"ilike"` | `"ilike"` | Correspondência de padrão sem diferenciar maiúsculas e minúsculas |
| `"not-like"` | `"nlike"` | Não corresponde ao padrão |
| `"not-ilike"` | `"nilike"` | Não corresponde ao padrão, sem diferenciar maiúsculas e minúsculas |
| `"is-null"` | `"isnull"` | Coluna é `NULL`. Não recebe valor — o que você passar é ignorado na normalização |
| `"is-not-null"` | `"notnull"` | Coluna não é `NULL`. Não recebe valor |

A coluna de alias representa a sintaxe de **rede (wire)**, usada em strings de consulta REST. Ela nunca aparece no código da aplicação: tanto o SDK quanto o painel administrativo utilizam o operador canônico à esquerda.

### Sintaxes da Cláusula Where

O parâmetro `where` em `find()` suporta dois formatos:

```typescript no-verify
// 1. Tuple syntax — [operator, value] (recommended)
await client.data.products.find({
    where: {
        status: ["==", "active"],
        featured: ["==", true],
        price: [">=", 100],
        category: ["in", ["electronics", "gadgets"]],
        deleted_at: ["!=", null]
    }
});

// 2. Pre-serialized PostgREST string syntax (advanced)
await client.data.products.find({
    where: { status: "eq.published", price: "gte.100" }
});
```

> **Nota:** Strings pré-serializadas do PostgREST (formato 2) são uma alternativa de escape para passar valores de filtro que já estão no formato de rede. Dê preferência à sintaxe de tupla para segurança de tipos e legibilidade.

## Condições Lógicas (OR / AND / NOT)

Cada campo em `where` é combinado com AND. Para agrupar condições com OR, ou para negar um grupo, construa uma **condição lógica** com os utilitários `or`, `and`, `not` e `cond` exportados pelo SDK:

```typescript
import { or, and, not, cond } from "@rebasepro/client";

const { data } = await client.data.products.find({
    logical: or(
        cond("status", "==", "active"),
        and(
            cond("status", "==", "draft"),
            cond("authorId", "==", currentUserId)
        )
    )
});
```

O construtor fluente aceita a mesma árvore:

```typescript
const { data } = await client.data.products
    .where(or(cond("status", "==", "active"), cond("featured", "==", true)))
    .orderBy("createdAt", "desc")
    .find();
```

`cond` aceita o operador canônico — a coluna esquerda da tabela de [Operadores de Filtro](#filter-operators). Um operador inexistente no dialeto resultará em um `TypeError` quando a consulta for serializada, em vez de executar uma consulta silenciosamente diferente.

### Negação

`not` nega a **conjunção** de suas condições: `not(a)` é `NOT a`, e `not(a, b)` é `NOT (a AND b)`. Grupos podem ser aninhados, de modo que o outro lado das leis de De Morgan é `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Ele compila para um `NOT (...)` real em SQL, e não para operadores invertidos. Essa distinção não é cosmética: o SQL utiliza lógica ternária (three-valued logic), logo `NOT (a AND b)` e `(NOT a) OR (NOT b)` deixam de concordar no momento em que um `NULL` está envolvido, e apenas um deles corresponde à consulta que você escreveu.

Isso também significa que uma negação **inclui linhas cuja coluna seja NULL** — `not(cond("status", "==", "draft"))` retorna linhas sem status algum. Esse é o significado de `NOT` e normalmente o que se espera; se não for o caso, adicione um `is-not-null` com AND ao lado dele.

### Como se compõe com o restante da consulta

`where`, `logical` e `search` são três grupos independentes, combinados entre si com AND:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Não há como aplicar OR entre `where` e `logical`. Qualquer coisa que não seja um simples AND entre os três deve ser expressa dentro de uma única árvore `logical` — mova para dentro dela os campos que você precisa em OR.

### No tráfego de rede (Wire format)

Um grupo lógico trafega como um único parâmetro de consulta `or=`, `and=` ou `not=`, utilizando a mesma sintaxe de pontos usada pelos filtros de campos:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Apenas um dos três se aplica por requisição — `or` tem precedência sobre `and`, e ambos sobre `not`. Aninhe um grupo dentro de outro para combiná-los.

Três codificações são importantes de se conhecer, pois são aquelas que costumam ser erradas em consultas escritas manualmente:

| Condição | Formato de rede (Wire) | Nota |
|----------|------------------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` é uma busca pela string de quatro caracteres `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` é uma lista contendo uma única string vazia, o que constitui uma consulta diferente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | um [caminho de relação](#querying-through-a-relation) preserva seu ponto |

Vírgulas, parênteses e barras invertidas dentro de um valor recebem escape com barra invertida, de modo que `cond("name", "==", "Doe, John")` trafega como `name.eq.Doe\, John` sem quebrar o grupo.

Grupos podem ser aninhados em até 32 níveis de profundidade. Além disso, a requisição será rejeitada com `INVALID_LOGICAL_GROUP` — achate a estrutura, uma vez que `or(a,or(b,c))` é equivalente a `or(a,b,c)`.

## Paginação

Offsets, números de página e cursores keyset têm uma página própria: [Paginação](/docs/sdk/pagination/).

## Ordenação

```typescript
// Sort by field (format: ["field", "direction"])
const { data } = await client.data.products.find({
    orderBy: ["createdAt", "desc"]
});

// Fluent style
const { data } = await client.data.products
    .orderBy("price", "asc")
    .find();
```

Uma direção omitida assume `"asc"` — o mesmo significado de `?orderBy=name` via HTTP, independentemente do banco de dados utilizado.

### Ordenando por mais de uma coluna

A ordenação é uma *lista* de chaves. A segunda decide o desempate entre linhas consideradas iguais pela primeira, a terceira desempata o que as duas primeiras empatarem — logo, `orderBy` aceita uma lista de pares `[field, direction]` tão naturalmente quanto um par individual:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

No construtor fluente, faz-se o mesmo chamando `.orderBy()` novamente. Cada chamada **adiciona** uma chave abaixo das anteriores em vez de substituí-las:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Toda ordenação é finalizada com o ID da linha em ordem decrescente, quer você tenha especificado isso ou não. É isso que torna a ordenação *total*: sem isso, duas linhas que compartilham o mesmo valor são retornadas na ordem que o banco de dados preferir, e paginar sobre uma ordenação que varia entre execuções da mesma consulta repete algumas linhas e pula outras.

Uma ordenação de múltiplas colunas pagina perfeitamente sob um [cursor](#cursor-pagination): a comparação é construída sobre cada chave, em ordem. A única ordenação que um cursor não pode descrever é **`_score`** — veja [Busca](/docs/backend/search). A relevância é calculada por consulta em vez de ser armazenada, logo não há valor na linha do cursor para comparar com a próxima página, e uma listagem dessas não possui `nextCursor`.

### Onde os NULLs se posicionam na ordenação

Por padrão, valores NULL são ordenados **por último em ordem ascendente e primeiro em ordem descendente** — convenção própria do Postgres. Esse padrão é o que coloca qualquer linha sem data no topo absoluto de uma lista "mais recentes primeiro", à frente de registros válidos, e a única saída costumava ser um filtro `is-not-null` que descartava essas linhas inteiramente.

Um terceiro elemento na chave define para onde eles vão:

```typescript
// Newest first, and the ones with no date at the end where they belong.
const { data } = await client.data.posts.find({
    orderBy: [["publishedAt", "desc", "last"]]
});
```

```typescript
const { data } = await client.data.posts
    .orderBy("publishedAt", "desc", "last")
    .find();
```

Via HTTP, trata-se de um terceiro segmento delimitado por dois pontos, `?orderBy=publishedAt:desc:last`, ou uma chave `"nulls"` no formato de array JSON. Qualquer valor diferente de `first`/`last` retorna um 400 em vez de aplicar silenciosamente uma ordem diferente.

O [cursor](#cursor-pagination) respeita o que foi declarado na ordenação, garantindo que a paginação sobre uma chave anulável permaneça correta em qualquer posicionamento.

## Retornando Menos Colunas

`fields` restringe a leitura às colunas especificadas. Trata-se de uma projeção realizada no próprio banco de dados — essas são as colunas *lidas*, não aquelas que restam após podar a resposta —, de modo que uma consulta que precisa de apenas dois campos de uma linha ampla não paga pelo processamento do restante:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Duas premissas sempre se mantêm, não importa o que você especifique:

- **A chave primária sempre retorna.** Uma linha que não pode ser referenciada não pode ser atualizada, excluída ou paginada — e `meta.nextCursor` é derivado dela, de modo que uma projeção sem ela desativaria silenciosamente a busca por cursor.
- **Colunas com `excludeFromApi` permanecem ocultas.** Nomear uma delas não anula a restrição.

Uma coluna desconhecida resulta em um erro 400 `UNKNOWN_FIELD`. Se fosse interpretado como "omitir", um erro de digitação como `fields: ["titel"]` retornaria linhas sem títulos e sem explicação do motivo.

Uma relação especificada em `include` é carregada quer ela apareça em `fields` ou não; para restringir as colunas *dentro* de uma relação, consulte [opções por relação](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` agrupa linhas que são idênticas em relação às colunas retornadas, e uma leitura com distinct retorna **apenas** as colunas especificadas — a chave primária é excluída da projeção, diferentemente de todas as outras leituras. Isso é indispensável: uma chave substituta (surrogate key) difere em cada linha, portanto mantê-la tornaria cada linha única por definição e a consulta retornaria 200 sem ter feito nada.

Isso faz com que o método só tenha significado junto com `fields`. Sem ele, você estaria solicitando todas as colunas visíveis, incluindo a chave primária, e nada seria agrupado:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Uma leitura com distinct não referencia linhas específicas — não há chave para referenciá-las —, portanto ela retorna um conjunto de valores em vez de um conjunto de linhas para atualizar ou deletar, e não traz `nextCursor`. Ela também **não informa `meta.total`**: a contagem exigiria um `COUNT(DISTINCT …)` que o driver não emite, e relatar o número de linhas descreveria um conjunto diferente do retornado — um resultado completo de duas linhas retornaria como `total: 8, hasMore: true`, fazendo o cliente paginar indefinidamente. `hasMore` é obtido da própria página.

Duas combinações são recusadas em vez de gerarem respostas inúteis:

- **Uma consulta que pontua cada linha** — um `search()` com relevância ou um `vectorSearch()` anexa um `_score`/`_distance` por linha; assim, duas linhas nunca serão iguais e o `DISTINCT` não teria efeito. (Uma busca simples por substring não anexa nada e funciona perfeitamente.)
- **Ordenar por uma coluna que não foi retornada.** O Postgres não pode ordenar uma leitura `DISTINCT` por uma expressão fora da lista de seleção; a requisição resulta em um erro 400 `DISTINCT_ORDER_BY_NOT_SELECTED` em vez de um 500 exibindo SQL que você nunca escreveu.

Via HTTP: `?fields=status&distinct=true`.

## Agregações

`aggregate()` reduz as linhas correspondentes em vez de retorná-las — `count`, `sum`, `avg`, `min`, `max`, opcionalmente agrupadas:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

Os filtros do construtor fluente são propagados para a agregação, o que normalmente resulta em uma escrita mais concisa:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

As chaves do resultado são **derivadas**, não escolhidas: `sum(total)` retorna como `sum_total`, um `count()` puro como `count`. Permitir a personalização dos nomes exigiria validar se o nome escolhido não coincide com um campo do `groupBy` — uma regra que ninguém adivinharia, gerando sobrescrita silenciosa de valores caso não fosse verificada.

`limit` restringe o número de **grupos** (agrupar por uma coluna de alta cardinalidade retornaria uma tabela inteira de linhas em uma só resposta) e é ignorado sem um `groupBy`, já que uma agregação sem agrupamento é sempre uma única linha. `orderBy`, `include` e parâmetros de página não se aplicam: uma agregação não tem linhas para ordenar, nem relações para carregar, nem página para continuar.

O objetivo principal é evitar a busca de linhas apenas para reduzi-las na aplicação. "Receita por status" em um milhão de pedidos é resolvido aqui com uma consulta e uma linha por status, enquanto em outros lugares exigiria um `findAll()` com um loop — o que é incorreto com um `limit` e impraticável sem ele. Essa operação é executada sob o mesmo handle de requisição de qualquer outra leitura, garantindo a aplicação de row-level security às linhas agregadas.

Via HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Filtros JSON, busca textual completa (full-text search) e busca vetorial possuem uma página dedicada: [Agregações e busca](/docs/sdk/aggregates-and-search/).

A leitura de entidades relacionadas — `include` e os métodos de acesso para consultar através de relações — possui uma página dedicada: [Consultando relações](/docs/sdk/relations/).

## Endpoints Customizados

Chame endpoints de servidor customizados registrados por meio do sistema de functions:

```typescript
// Using client.functions.invoke()
const result = await client.functions.invoke<{ summary: string }>(
    "generate-summary",
    { articleId: 42 }
);

// With options
const result = await client.functions.invoke<{ status: string }>(
    "process-order",
    { orderId: 123 },
    { method: "POST", path: "status/check" }
);

// Shorthand via client.call()
const result = await client.call<{ summary: string }>(
    "functions/generate-summary",
    { articleId: 42 }
);
```

Ambos retornam **o corpo de resposta da função, textualmente**. Nenhum deles tenta extrair uma chave `data` automaticamente, de forma que uma função que responda `{ data: [...] }` retornará exatamente esse objeto, e você acessará `.data` por conta própria.

`call()` recebe um caminho completo e sempre realiza um POST; `invoke()` recebe o nome da função e pode receber método, subcaminho e cabeçalhos. Utilize `invoke()` a menos que esteja chamando algo que não seja uma function.

## Próximos Passos

- **[Autenticação](/docs/sdk/authentication)** — Login, cadastro, OAuth, sessões
- **[Inscrições em Tempo Real](/docs/sdk/realtime)** — Dados ao vivo com WebSockets
- **[Armazenamento e Arquivos](/docs/sdk/storage)** — Envio, download e gerenciamento de arquivos
- **[Relações](/docs/collections/relations)** — Defina relações entre coleções

---
