---
sourceHash: 45064786f1785a65
title: Consultando Dados
sidebar_label: Consultando Dados
description: Operações CRUD, construtor de consultas fluente, operadores de filtro, ordenação, seleção de colunas e agregações com o SDK tipado do Rebase.
---

## Acessando tabelas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Acesse qualquer tabela através de `client.data.<tableName>` (camelCase, convertido automaticamente para snake_case) ou `client.data.table<Record<string, unknown>>("slug")` (slug explícito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.table<Record<string, unknown>>("blog_posts")
```

> **Modo estrito (SDK gerado):** Quando você passa o `tablesDictionary` gerado para `createRebaseClient` como `tables`, o proxy de dados valida os acessos às propriedades no momento do acesso. Um erro de digitação como `client.data.prodcuts` lança `UNKNOWN_TABLE` imediatamente com uma sugestão de correspondência mais próxima, em vez de produzir um 404 confuso posteriormente. Use `client.data.table<Record<string, unknown>>("slug")` para ignorar a validação para slugs dinâmicos ou determinados em tempo de execução.

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

Dois métodos, pois existem duas situações que exigem códigos diferentes.

`get` é para uma linha que você espera que exista — o id veio de um link, de um parâmetro de rota ou de outra linha. Ele retorna a linha, portanto nada posterior precisa fazer narrowing de tipo, e uma linha ausente é uma exceção na qual você pode criar ramificações:

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

`findById` é para uma linha que legitimamente pode não existir — uma busca por um id digitado pelo usuário, uma verificação de cache:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

`findById` recebe as relações a serem carregadas, assim como `find`:
`findById(1, { include: ["tags"] })`.

:::note
A segurança em nível de linha (row-level security) torna "linha inexistente" e "você não tem permissão para ler" a mesma resposta, deliberadamente: um 404 que os diferenciasse confirmaria a existência da linha.
:::

### Escrita

`create`, `upsert`, `update`, `delete` e suas versões em lote estão em
**[Gravando dados](/docs/sdk/writing/)**, juntamente com operações de campo, escritas
condicionais e chaves de idempotência.

### Count (Contagem)

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Fluent Query Builder

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
| `.where(path, op, value)` | Filtra em um caminho de [relação](/docs/sdk/relations#querying-through-a-relation) ou [JSON](/docs/sdk/aggregates-and-search#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Adiciona um [grupo OR/AND](#condições-lógicas-or--and--not) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordena os resultados | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordena por uma [agregação sobre uma relação](/docs/sdk/relations#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita a contagem de resultados | `.limit(25)` |
| `.offset(n)` | Pula os primeiros N resultados | `.offset(50)` |
| `.after(cursor)` | Continua após um [cursor](/docs/sdk/pagination#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Retorna [apenas estas colunas](#retornando-menos-colunas) | `.fields("id", "title")` |
| `.distinct()` | Agrupa linhas idênticas nessas colunas | `.fields("status").distinct()` |
| `.search(text)` | Busca textual — consulte [Search](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Busca de vizinhos mais próximos em uma propriedade `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carrega linhas relacionadas](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Executa a consulta | Retorna `FindResult<M>` |
| `.aggregate(params)` | [Reduz em vez de retornar linhas](#agregações) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Transmite em fluxo todas as linhas correspondentes](/docs/sdk/pagination#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Coleta todas as linhas correspondentes](/docs/sdk/pagination#reading-everything-iterate-and-findall) | Retorna `M[]` |
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
| `"array-contains-all"` | `"csall"` | Campo de array contém todos os valores |
| `"array-contained-by"` | `"cd"` | Campo de array contém exclusivamente os valores (array vazio incluso) |
| `"like"` | `"like"` | Correspondência de padrão **diferenciando** maiúsculas/minúsculas; `%` e `_` são os caracteres curinga |
| `"ilike"` | `"ilike"` | Correspondência de padrão sem diferenciar maiúsculas/minúsculas |
| `"not-like"` | `"nlike"` | Não corresponde ao padrão |
| `"not-ilike"` | `"nilike"` | Não corresponde ao padrão, sem diferenciar maiúsculas/minúsculas |
| `"is-null"` | `"isnull"` | A coluna é `NULL`. Não recebe valor — o que for passado é ignorado |
| `"is-not-null"` | `"notnull"` | A coluna não é `NULL`. Não recebe valor |

A coluna de alias é a grafia usada na **comunicação de rede (wire format)**,
utilizada nas query strings REST. Ela nunca aparece no código da aplicação: tanto
o SDK quanto o painel administrativo utilizam o operador canônico à esquerda.

Os quatro operadores de array funcionam em colunas nativas de array (`text[]`,
`integer[]`, …) e em arrays JSONB, e um índice GIN na coluna atende a todos eles.
Para listar os elementos distintos de uma coluna de array, agrupe uma agregação
por `unnest(<field>)` (consulte [Agregações](/docs/sdk/aggregates-and-search/#grouping-by-an-expression)).

Os quatro operadores de padrão realizam correspondência em texto. Um campo
`enum` é comparado pelo seu valor, portanto `{ status: ["like", "draft%"] }`
funciona em um status armazenado como um enum do Postgres. Em um número, data ou
qualquer outro campo que não seja texto, eles são rejeitados com um 400
`INVALID_FILTER_OPERATOR`.

### Ignorando maiúsculas e minúsculas: `lower(field)`

Uma chave de filtro pode converter um campo de texto para uma caixa específica —
`lower(artist)` ou `upper(code)` — e cada operador comparará então o valor
convertido, portanto escreva os valores nessa mesma caixa:

```typescript
await client.data.songs.find({
    where: { "lower(artist)": ["in", ["abba", "queen"]] }
});
```

Isso compila para `lower(artist) = ANY($1)`: uma lista vinculada de qualquer
tamanho, a qual um índice em `lower(artist)` atende. Via HTTP, a chave é escrita
da mesma forma: `?lower(artist)=in.(abba,queen)`.

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

> **Nota:** Strings pré-serializadas do PostgREST (formato 2) são uma válvula de escape para passar valores de filtro que já estão no formato de rede (wire format). Prefira a sintaxe de tupla para segurança de tipos e legibilidade.

## Condições Lógicas (OR / AND / NOT)

Todos os campos em `where` são combinados com AND. Para combinar condições com
OR, ou para negar um grupo, construa uma **condição lógica** com os utilitários
`or`, `and`, `not` e `cond` exportados pelo SDK:

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

`cond` recebe o operador canônico — a coluna da esquerda da tabela de
[Operadores de Filtro](#operadores-de-filtro). Um operador que o dialeto não possui
resulta em um `TypeError` quando a consulta é serializada, e não em uma
consulta silenciosamente diferente.

Em um cliente com [tipos gerados](/docs/sdk#typed-sdk-generation), `logical` e `.where(group)`
verificam cada condição na árvore contra a linha, da mesma forma que `where` faz:
uma coluna que a linha não possui, ou um valor com o tipo incorreto para o
operador (`cond("views", "==", "many")` em uma coluna numérica), é um erro de
compilação. Um caminho de relação ou JSON (`author.name`, `metadata->>tier`) não
é verificado.

### Negação

`not` nega a **conjunção** de suas condições: `not(a)` é `NOT a`, e
`not(a, b)` é `NOT (a AND b)`. Os grupos se aninham, portanto a outra metade
das leis de De Morgan é `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Ele compila para um `NOT (...)` SQL real, e não para operadores invertidos. Essa
distinção não é cosmética: o SQL utiliza lógica trivalente, portanto `NOT (a AND b)`
e `(NOT a) OR (NOT b)` deixam de coincidir no momento em que um `NULL` está
envolvido, e apenas um deles é a consulta que você escreveu.

Isso também significa que uma negação **inclui linhas cuja coluna é NULL** —
`not(cond("status", "==", "draft"))` retorna linhas sem nenhum status definido.
Isso é o que `NOT` significa e geralmente o que você deseja; caso não seja,
aplique um `is-not-null` com AND junto a ela.

### Como se compõe com o restante da consulta

`where`, `logical` e `search` são três grupos independentes, combinados entre si
com AND:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Não há como aplicar OR entre `where` e `logical`. Qualquer coisa que não seja um
simples AND dos três deve ser expressa dentro de uma única árvore `logical` —
mova os campos que você precisa em OR para dentro dela.

### No formato de rede

Um grupo lógico trafega como um único parâmetro de consulta `or=`, `and=` ou
`not=`, na mesma sintaxe com pontos que os filtros de campo utilizam:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Apenas um dos três se aplica por requisição — `or` tem precedência sobre `and`,
e ambos sobre `not`. Aninhe um grupo dentro de outro para combiná-los.

Vale a pena conhecer três codificações, pois são aquelas que costumam ser
escritas incorretamente em query strings manuais:

| Condição | Formato de rede | Nota |
|----------|-----------------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` é uma busca pela string de quatro caracteres `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` é uma lista contendo uma string vazia, o que representa uma consulta diferente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | um [caminho de relação](/docs/sdk/relations#querying-through-a-relation) mantém seu ponto |

Vírgulas, parênteses e barras invertidas dentro de um valor são escapados com
barra invertida, portanto `cond("name", "==", "Doe, John")` trafega como
`name.eq.Doe\, John` e não divide o grupo.

Os grupos podem ser aninhados em até 32 níveis de profundidade. Além disso, a
requisição é rejeitada com `INVALID_LOGICAL_GROUP` — nivele a estrutura, já que
`or(a,or(b,c))` equivale a `or(a,b,c)`.

## Paginação

Offsets, números de página e cursores keyset têm sua própria página:
[Paginação](/docs/sdk/pagination/).

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

Uma direção omitida assume o valor `"asc"` — o mesmo significado de
`?orderBy=name` via HTTP, qualquer que seja o banco de dados subjacente.

### Ordenando por mais de uma coluna

Uma ordenação é uma *lista* de chaves. A segunda decide o desempate entre linhas
consideradas iguais pela primeira, a terceira entre linhas iguais nas duas
primeiras — portanto, `orderBy` aceita uma lista de pares `[field, direction]`
tão facilmente quanto um único par:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

O construtor fluente expressa o mesmo chamando `.orderBy()` novamente. Cada
chamada **adiciona** uma chave abaixo das anteriores, em vez de substituí-las:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Toda ordenação termina no id da linha, em ordem decrescente, quer você tenha
solicitado ou não. É isso que torna a ordenação *total*: sem isso, duas linhas
que compartilham um valor seriam retornadas em qualquer ordem que agradasse ao
banco de dados, e paginar sobre uma ordem que pode variar entre duas execuções da
mesma consulta repete algumas linhas e pula outras.

Uma ordenação por múltiplas colunas pagina perfeitamente sob um
[cursor](/docs/sdk/pagination#cursor-pagination): a comparação é construída sobre
cada chave, em ordem. A única ordenação que um cursor não pode descrever é
**`_score`** — consulte [Busca](/docs/backend/search). A relevância é calculada
por consulta em vez de armazenada, portanto não há valor na linha do cursor para
comparar com a próxima página, e essa listagem não traz nenhum `nextCursor`.

### Onde os NULLs são ordenados

Por padrão, os valores NULL são ordenados **por último em ordem ascendente e
primeiro em ordem descendente** — convenção nativa do Postgres. Esse padrão é o
que coloca qualquer linha sem data no topo de uma lista do tipo "mais recentes
primeiro", à frente de todos os dados reais, e a única alternativa costumava ser
um filtro `is-not-null` que descartava essas linhas por completo.

Um terceiro elemento na chave define para onde eles vão em vez disso:

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

Via HTTP, isso é indicado por um terceiro segmento separado por dois-pontos,
`?orderBy=publishedAt:desc:last`, ou por uma chave `"nulls"` no formato de array
JSON. Qualquer valor diferente de `first`/`last` resulta em um erro 400 em vez de
uma ordenação silenciosamente diferente.

O [cursor](/docs/sdk/pagination#cursor-pagination) respeita o que foi declarado
na ordenação, portanto a paginação sobre uma chave que aceita valores nulos
permanece correta em qualquer um dos posicionamentos.

## Retornando menos colunas

`fields` restringe a leitura às colunas especificadas. Trata-se de uma projeção
realizada no banco de dados — essas são as colunas *lidas*, e não aquelas que
sobrevivem a um corte posterior na resposta —, portanto uma consulta que precisa
de apenas dois campos de uma linha ampla não paga pelo custo dos demais:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Duas regras sempre se aplicam, independentemente do que você especificar:

- **A chave primária é sempre retornada.** Uma linha que não pode ser
  endereçada não pode ser atualizada, excluída ou paginada — e o
  `meta.nextCursor` é derivado dela, portanto uma projeção sem ela desativaria
  silenciosamente a busca por cursor.
- **Colunas `excludeFromApi` permanecem ocultas.** Nomear uma delas não a torna
  visível.

Uma coluna desconhecida resulta em um 400 `UNKNOWN_FIELD`. Se fosse interpretado
como "omita-a", um erro de digitação como `fields: ["titel"]` retornaria linhas
sem títulos e sem nenhuma pista do motivo.

Uma relação nomeada em `include` é carregada independentemente de aparecer ou
não em `fields`; para restringir as colunas *dentro* de uma relação, consulte as
[opções por relação](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` agrupa linhas idênticas nas colunas que estão sendo retornadas, e uma
leitura com distinct retorna **apenas** as colunas que você especificar — a chave
primária é excluída da projeção, ao contrário de qualquer outra leitura. Precisa
ser assim: uma chave substituta (surrogate key) difere em cada linha, portanto
mantê-la tornaria cada linha única por definição, e a consulta retornaria 200 sem
ter feito nada.

Isso faz com que ele só tenha sentido junto com `fields`. Sem ele, você estaria
solicitando todas as colunas visíveis, chave incluída, e nada seria agrupado:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Uma leitura com distinct não referencia linhas específicas — não há chave para
referenciá-las —, portanto ela retorna um conjunto de valores em vez de um
conjunto de linhas para atualizar ou excluir, e não contém `nextCursor`. Ela
também **não informa `meta.total`**: a contagem exigiria um `COUNT(DISTINCT …)`
que o driver não emite, e relatar a contagem de linhas normais descreveria um
conjunto diferente do que foi entregue — um resultado completo de duas linhas
retornaria como `total: 8, hasMore: true`, fazendo o cliente paginar
indefinidamente. O `hasMore` vem da própria página.

Duas combinações são rejeitadas em vez de receberem respostas inúteis:

- **Uma consulta que pontua cada linha** — um `search()` com classificação ou um
  `vectorSearch()` anexa um `_score`/`_distance` por linha, de modo que duas
  linhas nunca serão iguais e o `DISTINCT` não teria efeito. (Uma busca simples
  por substring não anexa nada e funciona perfeitamente.)
- **Ordenar por uma coluna que você não retornou.** O Postgres não pode ordenar
  uma leitura `DISTINCT` por uma expressão fora da lista de seleção; a
  requisição resulta em um erro 400 `DISTINCT_ORDER_BY_NOT_SELECTED` em vez de um
  500 exibindo um SQL que você nunca escreveu.

Via HTTP: `?fields=status&distinct=true`.

## Agregações

`aggregate()` reduz as linhas correspondentes em vez de retorná-las — `count`,
`sum`, `avg`, `min`, `max`, opcionalmente agrupadas:

```typescript
const rows = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }, { fn: "count" }],
    groupBy: ["status"],
    where: { createdAt: [">=", startOfMonth] }
});
// [{ status: "paid", sum_total: 41822.5, count: 317 }, …]
```

Os filtros do builder são transferidos para ele, o que geralmente é a sintaxe
mais concisa:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

As chaves do resultado são **derivadas**, não escolhidas: `sum(total)` retorna
como `sum_total`, e um `count()` simples como `count`. Permitir nomeá-las
exigiria verificar se o nome também não é um campo do `groupBy` — uma regra que
ninguém adivinharia, gerando valores silenciosamente sobrescritos caso não fosse
verificada.

Os grupos são paginados como as linhas de uma listagem: `limit` restringe a
quantidade e `offset` pula registros (agrupar por uma coluna de alta cardinalidade
pode resultar nas linhas de uma tabela inteira em uma única resposta). Uma
agregação agrupada sem `limit` recebe o padrão de listagem — **50 grupos** via
HTTP —, portanto leia o `meta` no resultado antes de presumir que ele esteja
completo:

```typescript
const byCustomer = await client.data.orders.aggregate({
    select: [{ fn: "sum", field: "total" }],
    groupBy: ["customerId"],
    limit: 200
});
byCustomer.meta; // { limit: 200, offset: 0, hasMore: true } — page on with offset: 200
```

O resultado ainda é um array de linhas; `meta` é uma propriedade não enumerável
nele, portanto um spread ou um `JSON.stringify` enxerga apenas as linhas. Ele está
presente sempre que os grupos foram delimitados por um `limit`. Sem um `groupBy`
há apenas uma linha, `limit` não tem efeito e `offset` é recusado. Em uma função
de servidor (`rebase.data`, `context.data`), uma agregação agrupada sem `limit`
retorna todos os grupos. `include` não é enviado com uma agregação: não há
relações para carregar. Os grupos podem ser ordenados com `orderBy`, por uma
coluna do `groupBy` ou pela chave de uma agregação — consulte
[Agregações e busca](/docs/sdk/aggregates-and-search/).

O objetivo principal é não buscar linhas apenas para depois reduzi-las. "Receita
por status" sobre um milhão de pedidos é uma única consulta e uma linha por
status aqui, contra um `findAll()` mais um loop em outros lugares — o que é
incorreto com um `limit` e inviável sem um. Ele roda através do mesmo
manipulador com escopo de requisição que qualquer outra leitura, portanto a
segurança em nível de linha (row-level security) se aplica às linhas sendo
agregadas.

Via HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Filtros JSON, busca de texto completo e busca vetorial têm uma página própria:
[Agregações e busca](/docs/sdk/aggregates-and-search/).

A leitura de entidades relacionadas — `include` e os acessores que consultam
através de uma relação — tem uma página própria: [Consultando relações](/docs/sdk/relations/).

## Endpoints Personalizados

Chame endpoints de servidor personalizados registrados através do sistema de
funções:

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

Ambos retornam **o corpo de resposta da função, textualmente (verbatim)**. Nenhum
deles acessa internamente uma chave `data`, portanto uma função que responde
`{ data: [...] }` entrega esse objeto diretamente e você mesmo lê o `.data`.

`call()` recebe um caminho completo e sempre usa POST; `invoke()` recebe o nome
da função e pode receber um método, um subcaminho e cabeçalhos. Use `invoke()`, a
menos que esteja chamando algo que não seja uma função.

## Próximos Passos

- **[Autenticação](/docs/sdk/authentication)** — Entrar, cadastrar, OAuth, sessões
- **[Assinaturas em Tempo Real](/docs/sdk/realtime)** — Dados em tempo real com WebSockets
- **[Armazenamento e Arquivos](/docs/sdk/storage)** — Envie, baixe e gerencie arquivos
- **[Relações](/docs/collections/relations)** — Defina relações entre tabelas
