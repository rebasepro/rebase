---
sourceHash: 6d40635c3d2f94ea
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

> **Modo estrito (SDK gerado):** Ao passar o `collectionsDictionary` gerado para `createRebaseClient`, o proxy de dados valida os acessos a propriedades no momento do acesso. Um erro de digitação como `client.data.prodcuts` lançará imediatamente um erro útil e uma sugestão de correspondência mais próxima, em vez de gerar um 404 confuso posteriormente. Use `client.data.collection<Record<string, unknown>>("slug")` para ignorar a validação em slugs dinâmicos ou determinados em tempo de execução.

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

Dois métodos, porque existem duas situações e elas exigem códigos diferentes.

`get` é para uma linha que você espera que exista — o id veio de um link, de um parâmetro de rota ou de outra linha. Ele retorna a linha, para que nada downstream precise fazer narrowing (refinamento de tipo), e uma linha ausente é uma exceção na qual você pode criar ramificações:

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

`findById` é para uma linha que pode legitimamente não estar lá — uma busca por um id digitado por um usuário, uma verificação de cache:

```typescript
const maybe = await client.data.products.findById(42);
// Row | undefined
```

:::note
A segurança em nível de linha (row-level security) faz com que "linha inexistente" e "sem permissão de leitura" sejam a mesma resposta, deliberadamente: um 404 que as diferenciasse confirmaria que a linha existe.
:::

### Escrita

`create`, `upsert`, `update`, `delete` e suas variantes em lote estão em **[Escrita de dados](/docs/sdk/writing/)**, juntamente com operações de campo, escritas condicionais e chaves de idempotência.

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
| `.where(path, op, value)` | Filtra em um caminho de [relação](#querying-through-a-relation) ou [JSON](#filtering-inside-json) | `.where("author.name", "==", "bob")` |
| `.where(group)` | Adiciona um [grupo OR/AND](#logical-conditions-or--and) | `.where(or(cond(…), cond(…)))` |
| `.orderBy(field, dir, nulls?)` | Ordena os resultados | `.orderBy("name", "asc")` |
| `.orderBy(aggregate, dir)` | Ordena por uma [agregação sobre uma relação](#sort-by-an-aggregate-over-a-relation) | `.orderBy({ relation: "orders", agg: "count" }, "desc")` |
| `.limit(n)` | Limita a contagem de resultados | `.limit(25)` |
| `.offset(n)` | Pula os primeiros N resultados | `.offset(50)` |
| `.after(cursor)` | Continua após um [cursor](#cursor-pagination) | `.after(meta.nextCursor)` |
| `.fields(...columns)` | Retorna [apenas estas colunas](#returning-fewer-columns) | `.fields("id", "title")` |
| `.distinct()` | Recolhe linhas idênticas nessas colunas | `.fields("status").distinct()` |
| `.search(text)` | Busca textual — veja [Busca](/docs/backend/search) | `.search("laptop")` |
| `.vectorSearch(prop, vector, opts?)` | Busca por vizinhos mais próximos sobre uma propriedade `vector` | `.vectorSearch("embedding", vec)` |
| `.include(...relations)` | [Carrega linhas relacionadas](/docs/sdk/relations#loading-related-rows) | `.include("author", "tags")` |
| `.find()` | Executa a consulta | Retorna `FindResult<M>` |
| `.aggregate(params)` | [Reduz em vez de retornar linhas](#aggregates) | `.aggregate({ select: [{ fn: "count" }] })` |
| `.iterate(options?)` | [Transmite via stream cada linha correspondente](#reading-everything-iterate-and-findall) | `for await (const r of qb.iterate())` |
| `.findAll(options?)` | [Coleta todas as linhas correspondentes](#reading-everything-iterate-and-findall) | Retorna `M[]` |
| `.count()` | Conta as linhas correspondentes | Retorna `number` |
| `.listen(onUpdate, onError?)` | Inscreve-se em atualizações em tempo real | Retorna `unsubscribe()` |

### Operadores de Filtro

| Operador | Alias | Descrição |
|----------|-------|-------------|
| `"=="` | `"eq"` | Igual |
| `"!="` | `"neq"` | Diferente |
| `">"` | `"gt"` | Maior que |
| `">="` | `"gte"` | Maior ou igual a |
| `"<"` | `"lt"` | Menor que |
| `"<="` | `"lte"` | Menor ou igual a |
| `"in"` | | Valor no array |
| `"not-in"` | `"nin"` | Valor não presente no array |
| `"array-contains"` | `"cs"` | Campo do tipo array contém o valor |
| `"array-contains-any"` | `"csa"` | Campo do tipo array contém qualquer um dos valores |
| `"like"` | `"like"` | Correspondência de padrão sensível a maiúsculas/minúsculas (**case-sensitive**); `%` e `_` são os curingas |
| `"ilike"` | `"ilike"` | Correspondência de padrão insensível a maiúsculas/minúsculas (case-insensitive) |
| `"not-like"` | `"nlike"` | Não corresponde ao padrão |
| `"not-ilike"` | `"nilike"` | Não corresponde ao padrão, de forma case-insensitive |
| `"is-null"` | `"isnull"` | A coluna é `NULL`. Não recebe valor — qualquer valor passado é ignorado |
| `"is-not-null"` | `"notnull"` | A coluna não é `NULL`. Não recebe valor |

A coluna de alias é a grafia usada na **comunicação de rede** (wire), utilizada nas query strings REST. Ela nunca aparece no código da aplicação: tanto o SDK quanto o painel de administração usam o operador canônico da esquerda.

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

> **Nota:** Strings pré-serializadas do PostgREST (formato 2) são uma alternativa de escape para passar valores de filtro que já estão no formato de rede. Prefira a sintaxe de tupla para segurança de tipos e legibilidade.

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

`cond` recebe o operador canônico — a coluna esquerda da tabela de [Operadores de Filtro](#filter-operators). Um operador inexistente no dialeto resultará em um `TypeError` quando a consulta for serializada, em vez de uma consulta silenciosamente diferente.

### Negação

`not` nega a **conjunção** de suas condições: `not(a)` é `NOT a`, e `not(a, b)` é `NOT (a AND b)`. Os grupos podem ser aninhados, então a outra metade das Leis de De Morgan é `not(or(a, b))`.

```typescript
// Everything that is NOT a draft with fewer than ten views.
const { data } = await client.data.posts.find({
    logical: not(
        cond("status", "==", "draft"),
        cond("views", "<", 10)
    )
});
```

Ele é compilado para um `NOT (...)` real em SQL, e não para operadores invertidos. Essa distinção não é meramente estética: o SQL tem lógica trivalente, portanto `NOT (a AND b)` e `(NOT a) OR (NOT b)` deixam de concordar a partir do momento em que um `NULL` está envolvido, e apenas uma dessas expressões corresponde à consulta que você escreveu.

Isso também significa que uma negação **inclui linhas cuja coluna é NULL** — `not(cond("status", "==", "draft"))` retorna linhas sem nenhum status definido. Isso é o que `NOT` significa, e geralmente o que você deseja; se não for o caso, adicione um `is-not-null` com AND ao lado.

### Como isso se compõe com o restante da consulta

`where`, `logical` e `search` são três grupos independentes, combinados entre si com AND:

```
(where fields, AND-ed)  AND  (logical group)  AND  (search)
```

Não há como aplicar OR entre `where` e `logical`. Qualquer coisa que não seja um simples AND entre os três deve ser expressa dentro de uma única árvore `logical` — mova para dentro dela os campos que você precisa combinar com OR.

### Na rede

Um grupo lógico trafega como um único parâmetro de consulta `or=`, `and=` ou `not=`, na mesma sintaxe de ponto usada pelos filtros de campo:

```
GET /api/data/products?or=(status.eq.active,featured.eq.true)
GET /api/data/posts?not=(status.eq.draft,views.lt.10)
```

Apenas um dos três é aplicado por requisição — `or` tem precedência sobre `and`, e ambos sobre `not`. Aninhe um grupo dentro de outro para combiná-los.

Vale a pena conhecer três codificações, pois são aquelas que costumam ser escritas incorretamente em uma query string manual:

| Condição | Formato de rede | Observação |
|-----------|-----------|------|
| `cond("deleted_at", "==", null)` | `deleted_at.isnull.null` | `eq.null` é uma busca pela string de quatro caracteres `null` |
| `cond("id", "in", [])` | `id.in.(\)` | `in.()` é uma lista que contém uma string vazia, o que representa uma consulta diferente |
| `cond("author.name", "==", "bob")` | `author.name.eq.bob` | um [caminho de relação](#querying-through-a-relation) mantém seu ponto |

Vírgulas, parênteses e barras invertidas dentro de um valor são escapados com barra invertida, de modo que `cond("name", "==", "Doe, John")` trafega como `name.eq.Doe\, John` e não divide o grupo.

Os grupos podem ser aninhados em até 32 níveis de profundidade. Além disso, a requisição é rejeitada com `INVALID_LOGICAL_GROUP` — achate a estrutura, já que `or(a,or(b,c))` é equivalente a `or(a,b,c)`.

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

A direção omitida tem como padrão `"asc"` — o mesmo significado de `?orderBy=name` via HTTP, qualquer que seja o banco de dados subjacente.

### Ordenando por mais de uma coluna

Uma ordenação é uma *lista* de chaves. A segunda decide o desempate entre linhas que a primeira considera iguais, a terceira entre linhas que as duas primeiras consideram iguais — portanto, `orderBy` aceita uma lista de pares `[field, direction]` tão facilmente quanto um único par:

```typescript
// By category, and newest first within each category.
const { data } = await client.data.products.find({
    orderBy: [["category", "asc"], ["createdAt", "desc"]]
});
```

O construtor fluente expressa a mesma coisa chamando `.orderBy()` novamente. Cada chamada **adiciona** uma chave após as anteriores em vez de substituí-las:

```typescript
const { data } = await client.data.products
    .orderBy("category")            // primary
    .orderBy("createdAt", "desc")  // tie-breaker
    .find();
```

Toda ordenação termina no id da linha, em ordem decrescente, quer você tenha solicitado ou não. É isso que torna a ordenação *total*: sem isso, duas linhas que compartilham o mesmo valor são retornadas na ordem que o banco de dados bem entender, e paginar sobre uma ordem que pode variar entre duas execuções da mesma consulta repete algumas linhas e pula outras.

Uma ordenação por múltiplas colunas funciona perfeitamente com paginação baseada em [cursor](#cursor-pagination): a comparação é construída sobre cada chave, em ordem. A única ordenação que um cursor não pode descrever é **`_score`** — consulte [Busca](/docs/backend/search). A relevância é calculada por consulta em vez de armazenada, portanto não há valor na linha do cursor para comparar com a próxima página, e tal listagem não inclui `nextCursor`.

### Posicionamento de valores NULL na ordenação

Por padrão, os NULLs são ordenados **por último em ordem ascendente e primeiro em ordem descendente** — convenção própria do Postgres. Esse padrão é o que coloca todas as linhas sem data no topo de uma lista "mais recentes primeiro", à frente de todos os registros reais, e a única saída costumava ser um filtro `is-not-null` que descartava essas linhas inteiramente.

Um terceiro elemento na chave define onde eles devem ficar:

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

Via HTTP, trata-se de um terceiro segmento separado por dois-pontos, `?orderBy=publishedAt:desc:last`, ou uma chave `"nulls"` no formato de array JSON. Qualquer valor diferente de `first`/`last` resulta em um erro 400 em vez de uma ordenação silenciosamente diferente.

O [cursor](#cursor-pagination) respeita o que foi declarado na ordenação, de modo que a paginação sobre uma chave que aceita nulos permanece correta em qualquer uma das posições.

## Retornando menos colunas

`fields` restringe a leitura às colunas nomeadas. É uma projeção realizada diretamente no banco de dados — essas são as colunas *lidas*, e não as que sobrevivem a um corte posterior na resposta —, portanto, uma consulta que precisa de dois campos de uma linha ampla não paga pelo restante:

```typescript
const { data } = await client.data.posts.find({
    fields: ["id", "title"],
    limit: 50
});
```

```typescript
const { data } = await client.data.posts.fields("id", "title").find();
```

Duas regras sempre se aplicam, independentemente do que for especificado:

- **A chave primária é sempre retornada.** Uma linha que não pode ser referenciada não pode ser atualizada, excluída ou paginada — e o `meta.nextCursor` é derivado dela, de modo que uma projeção sem ela desativaria silenciosamente a navegação.
- **Colunas com `excludeFromApi` permanecem ocultas.** Nomear uma delas não a tornará visível.

Uma coluna desconhecida resulta em um erro 400 `UNKNOWN_FIELD`. Se fosse interpretado como "omita isso", um erro de digitação como `fields: ["titel"]` retornaria linhas sem títulos e sem nenhuma indicação do motivo.

Uma relação indicada em `include` é carregada quer ela apareça em `fields` ou não; para restringir as colunas *dentro* de uma relação, consulte as [opções por relação](/docs/sdk/relations#narrowing-what-a-relation-loads).

### `distinct`

`distinct` agrupa linhas idênticas nas colunas retornadas. Ele só tem efeito quando usado junto com `fields`, já que a chave primária está sempre presente na projeção padrão e, portanto, cada linha já é naturalmente distinta:

```typescript
// The statuses actually in use.
const { data } = await client.data.posts
    .fields("status")
    .distinct()
    .find();
```

`meta.total` também contabiliza linhas distintas, garantindo que `hasMore` descreva com precisão o conjunto paginado. Duas combinações são recusadas em vez de gerarem respostas inúteis:

- **Uma consulta que pontua cada linha** — uma chamada ranqueada a `search()` ou `vectorSearch()` anexa um `_score`/`_distance` por linha, portanto nenhuma linha é igual a outra e o `DISTINCT` não teria efeito. (Uma busca simples por substring não anexa nada e funciona perfeitamente.)
- **Ordenar por uma coluna que não foi retornada.** O Postgres não pode ordenar uma leitura com `DISTINCT` por uma expressão fora da lista de seleção; a requisição resulta em um erro 400 `DISTINCT_ORDER_BY_NOT_SELECTED` em vez de um 500 citando um SQL que você nunca escreveu.

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

Os filtros do construtor são mantidos nele, o que geralmente resulta em uma escrita mais concisa:

```typescript
const rows = await client.data.orders
    .where("createdAt", ">=", startOfMonth)
    .aggregate({ select: [{ fn: "sum", field: "total" }], groupBy: ["status"] });
```

As chaves do resultado são **derivadas**, não escolhidas: `sum(total)` retorna como `sum_total`, um `count()` simples como `count`. Permitir nomeá-las exigiria verificar se o nome não coincide com um campo de `groupBy` — uma regra difícil de adivinhar e que causaria sobrescrita silenciosa de valores caso não fosse verificada.

`limit` restringe o número de **grupos** (agrupar por uma coluna de alta cardinalidade pode trazer o equivalente a uma tabela inteira em uma única resposta) e é ignorado sem um `groupBy`, já que uma agregação não agrupada resulta em uma única linha. `orderBy`, `include` e a paginação não se aplicam: uma agregação não possui linhas para ordenar, relações para carregar nem página para continuar.

O objetivo principal é evitar buscar linhas apenas para reduzi-las. "Receita por status" sobre um milhão de pedidos é apenas uma consulta e uma linha por status aqui, enquanto em outros lugares seria um `findAll()` seguido de um loop — o que fica incorreto com um `limit` e inviável sem ele. Isso é executado através do mesmo handle com escopo de requisição que qualquer outra leitura, portanto a segurança em nível de linha (row-level security) se aplica às linhas sendo agregadas.

Via HTTP: `GET /api/data/orders/aggregate?select=sum(total),count()&groupBy=status`.

Filtragem JSON, busca full-text e busca vetorial têm uma página própria:
[Agregações e busca](/docs/sdk/aggregates-and-search/).

A leitura de entidades relacionadas — `include` e os acessores para consulta através de relações — tem uma página própria: [Consultando relações](/docs/sdk/relations/).

## Endpoints Personalizados

Chame endpoints de servidor personalizados registrados por meio do sistema de funções:

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

Ambos retornam **o corpo de resposta da função, textualmente**. Nenhum deles tenta extrair uma chave `data`, portanto, uma função que responde com `{ data: [...] }` retorna esse objeto diretamente e cabe a você acessar `.data`.

`call()` recebe um caminho completo e sempre realiza requisições POST; `invoke()` recebe o nome de uma função e pode aceitar um método, um subcaminho e cabeçalhos. Use `invoke()`, a menos que esteja chamando algo que não seja uma função.

## Próximos Passos

- **[Autenticação](/docs/sdk/authentication)** — Iniciar sessão, cadastrar-se, OAuth, sessões
- **[Assinaturas em Tempo Real](/docs/sdk/realtime)** — Dados em tempo real com WebSockets
- **[Armazenamento e Arquivos](/docs/sdk/storage)** — Enviar, baixar e gerenciar arquivos
- **[Relações](/docs/collections/relations)** — Definir relações entre coleções

---
