---
sourceHash: 72b63305690d555c
title: Consultando Dados
sidebar_label: Consultando Dados
description: Operações de CRUD, construtor de consultas fluente, operadores de filtro, ordenação, seleção de colunas e agregações com o SDK Rebase Client.
---

## Acessando Coleções

Acesse qualquer coleção por meio de `client.data.<collectionName>` (camelCase, convertido automaticamente para snake_case) ou `client.data.collection<Record<string, unknown>>("slug")` (slug explícito):

```typescript
// Property-style access (camelCase → snake_case slug)
client.data.blogPosts       // → slug "blog_posts"
client.data.users           // → slug "users"

// Dynamic access by slug
client.data.collection<Record<string, unknown>>("blog_posts")
```

> **Modo estrito (SDK gerado):** Quando você passa o `collectionsDictionary` gerado para `createRebaseClient`, o proxy de dados valida os acessos a propriedades no momento do acesso. Um erro de digitação como `client.data.prodcuts` lançará um erro imediatamente com uma mensagem útil e uma sugestão de correspondência mais próxima, em vez de produzir um 404 confuso posteriormente. Use `client.data.collection<Record<string, unknown>>("slug")` para contornar a validação para slugs dinâmicos ou determinados em tempo de execução.

## Operações de CRUD

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

Dois métodos, porque existem duas situações e elas exigem códigos diferentes.

`get` é para uma linha que você espera que exista — o id veio de um link, de um parâmetro de rota ou de outra linha. Ele retorna a linha, para que nada downstream precise restringir tipos, e uma linha ausente é uma exceção na qual você pode criar ramificações:

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

`findById` é para uma linha que pode legitimamente não estar lá — uma busca por um id digitado pelo usuário, uma verificação de cache:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
A segurança em nível de linha (row-level security) torna "nenhuma linha encontrada" e "você não tem permissão para ler" a mesma resposta, deliberadamente: um 404 que os diferenciasse confirmaria a existência da linha.
:::

### Escrita

`create`, `upsert`, `update`, `delete` e suas versões em lote estão em **[Escrevendo dados](/docs/sdk/writing/)**, juntamente com operações de campo, gravações condicionais e chaves de idempotência.

### Count

```typescript
const total = await client.data.products.count();

// With filters
const activeCount = await client.data.products.count({
    where: { active: ["==", true] }
});
```

## Construtor de Consultas Fluente

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
| `.where(path, op, value)` | Filtra em uma [relação](#querying-through-a-relation) ou caminho [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Adiciona um [grupo OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordena os resultados | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordena por um [agregado em uma relação](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita a contagem de resultados | `.limit(25)` |
| `.offset(n)` | Pula os primeiros N resultados | `.offset(50)` |
| `.after(cursor)` | Continua após um [cursor](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Retorna [apenas estas colunas](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Colapsa linhas idênticas nessas colunas | `.fields("status").distinct()` |
| `.search(text)` | Busca textual — consulte [Busca](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Busca por vizinho mais próximo em uma propriedade `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carrega linhas relacionadas](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Executa a consulta | Retorna `FindResult<M>` |
| `.aggregate(params)` | [Reduz em vez de retornar linhas](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Transmite via stream cada linha correspondente](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Coleta cada linha correspondente](#reading-everything-iterate-and-findall) | Retorna `M[]` |
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
| `"in"` | | Valor presente no array |
| `"not-in"` | `"nin"` | Valor não presente no array |
| `"array-contains"` | `"cs"` | Campo do tipo array contém o valor |
| `"array-contains-any"` | `"csa"` | Campo do tipo array contém qualquer um dos valores |
| `"like"` | `"like"` | Correspondência de padrão **diferenciando maiúsculas de minúsculas**; `%` e `_` são os curingas |
| `"ilike"` | `"ilike"` | Correspondência de padrão insensível a maiúsculas/minúsculas |
| `"not-like"` | `"nlike"` | Não corresponde ao padrão |
| `"not-ilike"` | `"nilike"` | Não corresponde ao padrão, insensível a maiúsculas/minúsculas |
| `"is-null"` | `"isnull"` | A coluna é `NULL`. Não aceita valor — o que você passar é descartado na normalização |
| `"is-not-null"` | `"notnull"` | A coluna não é `NULL`. Não aceita valor |

A coluna de alias é a grafia de **transmissão (wire)**, usada em strings de consulta REST. Ela nunca aparece no código da aplicação: o SDK e o painel de administração utilizam o operador canônico à esquerda.

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

> **Nota:** Strings pré-serializadas do PostgREST (formato 2) são uma alternativa de escape para passar valores de filtro que já estão no formato de transmissão. Prefira a sintaxe de tupla para segurança de tipos e legibilidade.

## Condições Lógicas (OR / AND / NOT)

Cada campo em `where` é combinado com AND. Para combinar condições com OR, ou para negar um grupo, construa uma **condição lógica** com os utilitários `or`, `and`, `not` e `cond` exportados pelo SDK:

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

`cond` recebe o operador canônico — a coluna da esquerda da tabela de [Operadores de Filtro](#filter-operators). Um operador inexistente no dialeto resultará em um `TypeError` quando a consulta for serializada, em vez de uma consulta silenciosamente diferente.

### Negação

`not` nega a **conjunção** de suas condições: `not(a)` é `NOT a`, e `not(a, b)` é `NOT (a AND b)`. Grupos podem ser aninhados, portanto a outra metade das leis de De Morgan é `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Isso é compilado para um SQL `NOT (...)` real, não para operadores invertidos. Essa distinção não é cosmética: o SQL é trivalente, então `NOT (a AND b)` e `(NOT a) OR (NOT b)` deixam de concordar a partir do momento em que um `NULL` é envolvido, e apenas um deles é a consulta que você escreveu.

Isso também significa que uma negação **inclui linhas cuja coluna é NULL** — `not(cond("status", "==", "draft"))` retorna linhas sem status algum. Isso é o que `NOT` significa e, normalmente, o que você deseja; se não for o caso, adicione um `is-not-null` com AND juntamente a ela.

### Como se compõe com o restante da consulta

`where`, `logical` e `search` são três grupos independentes, combinados entre si com AND:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Não há como aplicar OR entre `where` e `logical`. Qualquer coisa que não seja um simples AND dos três deve ser expressa dentro de uma única árvore `logical` — mova os campos que você precisa com OR para dentro dela.

### Na transmissão

Um grupo lógico trafega como um único parâmetro de consulta `or=`, `and=` ou `not=`, na mesma sintaxe de ponto usada pelos filtros de campo:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Apenas um dos três se aplica por requisição — `or` tem precedência sobre `and`, e ambos sobre `not`. Aninhe um grupo dentro de outro para combiná-los.

Vale a pena conhecer três codificações, pois são aquelas em que uma string de consulta escrita manualmente costuma errar:

| Condição | Formato na transmissão | Observação |
|-----------|-----------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` é uma busca pela string de quatro caracteres `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` é uma lista contendo uma string vazia, o que representa uma consulta diferente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | um [caminho de relação](#querying-through-a-relation) mantém o ponto |

Vírgulas, parênteses e barras invertidas dentro de um valor são escapados com barra invertida, de modo que `cond("name", "==", "Doe, John")` trafega como `name.eq.Doe\, John` e não divide o grupo.

Os grupos podem ser aninhados em até 32 níveis de profundidade. Além disso, a requisição é rejeitada com `INVALID_LOGICAL_GROUP` — simplifique-a (achate-a), já que `or(a,or(b,c))` equivale a `or(a,b,c)`.

## Paginação

Offsets, números de página e cursores keyset têm uma página própria:
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

Uma direção omitida é `"asc"` — o mesmo significado de `?orderBy=name` via HTTP, qualquer que seja o banco de dados subjacente.

### Ordenando por mais de uma coluna

Uma ordenação é uma *lista* de chaves. A segunda decide o desempate entre linhas que a primeira considera iguais, a terceira entre linhas que as duas primeiras consideram — portanto, `orderBy` aceita uma lista de pares `[field, direction]` tão facilmente quanto um único:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

O construtor fluente expressa a mesma coisa chamando `.orderBy()` novamente. Cada chamada **adiciona** uma chave após as anteriores, em vez de substituí-las:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Toda ordenação termina no id da linha, em ordem decrescente, quer você tenha solicitado ou não. É isso que torna a ordenação *total*: sem isso, duas linhas que compartilham um valor são retornadas na ordem que o banco de dados preferir, e a paginação sobre uma ordem que pode variar entre duas execuções da mesma consulta repete algumas linhas e pula outras.

Uma ordenação por múltiplas colunas pagina perfeitamente com um [cursor](#cursor-pagination): a comparação é construída sobre cada chave, em ordem. A única ordenação que um cursor não pode descrever é **`_score`** — consulte [Busca](/docs/backend/search). A relevância é calculada por consulta em vez de armazenada, portanto não há valor na linha do cursor para comparar com a próxima página, e essa listagem não traz `nextCursor`.

### Onde os NULLs são ordenados

Por padrão, os valores NULL são ordenados **por último em ordem ascendente e primeiro em descendente** — convenção do próprio Postgres. Esse padrão é o que coloca cada linha sem data no topo absoluto de uma lista ordenada por "mais recentes primeiro", à frente de tudo que é real, e a única saída costumava ser um filtro `is-not-null` que descartava totalmente essas linhas.

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

Via HTTP, é um terceiro segmento separado por dois-pontos, `?orderBy=publishedAt:desc:last`, ou uma chave `"nulls"` no formato de array JSON. Qualquer coisa diferente de `first`/`last` resulta em um 400 em vez de uma ordem silenciosamente diferente.

O [cursor](#cursor-pagination) respeita o que a ordenação declarou, portanto a paginação sobre uma chave anulável permanece correta em qualquer um dos posicionamentos.

## Retornando menos colunas

`fields` restringe uma leitura às colunas nomeadas. Trata-se de uma projeção no banco de dados — essas são as colunas *lidas*, e não aquelas que sobrevivem a um corte na resposta — de modo que uma consulta que precisa de apenas dois campos de uma linha ampla não paga pelo restante:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Duas coisas sempre se aplicam, independentemente do que você especificar:

- **A chave primária é sempre retornada.** Uma linha que não pode ser referenciada não pode ser atualizada, excluída ou paginada — e `meta.nextCursor` é derivado dela, de modo que uma projeção sem ela desativaria silenciosamente a navegação (seeking).
- **As colunas com `excludeFromApi` continuam ocultas.** Especificar uma delas não a tornará visível.

Uma coluna desconhecida resulta em um 400 `UNKNOWN_FIELD`. Se fosse interpretado como "omita-a", um erro de digitação como `fields: ["titel"]` retornaria linhas sem títulos e nenhuma indicação do motivo.

Uma relação nomeada em `include` é carregada quer apareça ou não em `fields`; para restringir as colunas *dentro* de uma relação, consulte as [opções por relação](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

<span class="since-badge" data-since="0.20">A partir de 0.20</span>

`distinct` agrupa linhas idênticas nas colunas retornadas, e uma leitura distinta retorna **apenas** as colunas especificadas — a chave primária fica de fora da projeção, ao contrário de qualquer outra leitura. Deve ser assim: uma chave substituta (surrogate key) difere em cada linha, portanto mantê-la tornaria cada linha única por definição, e a consulta retornaria 200 sem ter feito nada.

Isso faz com que ele faça sentido apenas em conjunto com `fields`. Sem ele, você estaria solicitando todas as colunas visíveis, chave inclusa, e nada seria agrupado:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

Uma leitura distinta não referencia linhas específicas — não há chave pela qual referenciá-las —, portanto ela retorna um conjunto de valores em vez de um conjunto de linhas para atualizar ou excluir, e não traz `nextCursor`. Ela também **não relata `meta.total`**: a contagem exigiria um `COUNT(DISTINCT …)` que o driver não executa, e relatar a contagem de linhas descreveria um conjunto diferente do que foi servido — um resultado completo de duas linhas retornaria como `total: 8, hasMore: true`, fazendo o cliente paginar indefinidamente. O `hasMore` vem da própria página.

Duas combinações são recusadas em vez de respondidas inutilmente:

- **Uma consulta que pontua cada linha** — uma `search()` ranqueada ou uma `vectorSearch()` anexa um `_score`/`_distance` por linha, de forma que duas linhas nunca são iguais e o `DISTINCT` não teria efeito. (Uma busca simples por substring não anexa nada e funciona normalmente.)
- **Ordenar por uma coluna que você não retornou.** O Postgres não pode ordenar uma leitura `DISTINCT` por uma expressão fora da lista de seleção; a requisição resulta em um 400 `DISTINCT_ORDER_BY_NOT_SELECTED`, em vez de um 500 citando um SQL que você nunca escreveu.

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

Os filtros do construtor são propagados para ela, o que costuma ser a escrita mais concisa:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

As chaves do resultado são **derivadas**, não escolhidas: `sum(total)` retorna como `sum_total`, um `count()` simples como `count`. Permitir que você as nomeie exigiria verificar se o nome não coincide com um campo de `groupBy` — uma regra que ninguém adivinharia e que geraria valores sobrescritos silenciosamente caso não fosse verificada.

`limit` limita o número de **grupos** (agrupar por uma coluna de alta cardinalidade traria o equivalente a uma tabela inteira de linhas em uma única resposta) e é ignorado sem um `groupBy`, já que uma agregação não agrupada retorna apenas uma linha. `orderBy`, `include` e a paginação não se aplicam: uma agregação não tem linhas para ordenar, relações para carregar nem página para continuar.

O objetivo principal é não buscar linhas apenas para reduzi-las. "Receita por status" em um milhão de pedidos é uma única consulta e uma linha por status aqui, contra um `findAll()` seguido de um loop em qualquer outro lugar — o que é incorreto sob um `limit` e inviável sem um. Isso é executado pelo mesmo manipulador com escopo de requisição de qualquer outra leitura, portanto a segurança em nível de linha se aplica às linhas sendo agregadas.

Via HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Filtragem JSON, busca de texto completo e busca vetorial têm uma página própria:
[Agregações e busca](/docs/sdk/aggregates-and-search/).

A leitura de entidades relacionadas — `include` e os acessadores que consultam por meio de uma relação — tem uma página própria: [Consultando relações](/docs/sdk/relations/).

## Endpoints Personalizados

Chame endpoints personalizados do servidor registrados por meio do sistema de funções:

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

Ambos retornam **o corpo de resposta da função na íntegra**. Nenhum deles acessa uma chave `data` interna, portanto uma função que responde com `{ data: [...] }` entregará esse objeto e você lerá `.data` por conta própria.

`call()` aceita um caminho completo e sempre usa POST; `invoke()` aceita o nome de uma função e pode receber um método, um subcaminho e cabeçalhos. Use `invoke()` a menos que esteja chamando algo que não seja uma função.

## Próximos Passos

- **[Autenticação](/docs/sdk/authentication)** — Login, cadastro, OAuth, sessões
- **[Inscrições em Tempo Real](/docs/sdk/realtime)** — Dados em tempo real com WebSockets
- **[Armazenamento e Arquivos](/docs/sdk/storage)** — Faça upload, download e gerencie arquivos
- **[Relações](/docs/collections/relations)** — Defina relações entre coleções

---
