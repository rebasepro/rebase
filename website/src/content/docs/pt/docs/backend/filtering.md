---
sourceHash: d75d6ec231ad3911
title: Filtragem da API REST
sidebar_label: Filtragem
description: Filtre requisições de listagem REST com operadores no estilo PostgREST, grupos or/and e o dialeto JSON where, e veja como os filtros se combinam.
---

Use parâmetros de consulta (query parameters) no estilo PostgREST para filtrar resultados. O formato é `?campo=operador.valor`:

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

# Array contains all
GET /api/data/products?tags=csall.(electronics,refurbished)

# Array holds nothing outside the list
GET /api/data/products?tags=cd.(electronics,books,toys)
```

## Operadores de Filtro

| Operador | Significado | Exemplo |
|----------|-------------|---------|
| `eq` | Igual (`==`) | `?active=eq.true` |
| `neq` | Diferente (`!=`) | `?status=neq.draft` |
| `gt` | Maior que (`>`) | `?price=gt.100` |
| `gte` | Maior ou igual (`>=`) | `?price=gte.100` |
| `lt` | Menor que (`<`) | `?price=lt.50` |
| `lte` | Menor ou igual (`<=`) | `?price=lte.50` |
| `in` | No array | `?status=in.(a,b,c)` |
| `nin` | Não está no array | `?status=nin.(a,b)` |
| `cs` | Array contém | `?tags=cs.value` |
| `csa` | Array contém qualquer um | `?tags=csa.(a,b)` |
| `csall` | Array contém todos | `?tags=csall.(a,b)` |
| `cd` | Array contido por: nenhum elemento fora da lista | `?tags=cd.(a,b)` |
| `like` | Correspondência de padrão, diferencia maiúsculas/minúsculas (`like`) | `?sku=like.AB-%` |
| `ilike` | Correspondência de padrão, não diferencia maiúsculas/minúsculas (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Não corresponde ao padrão (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Não corresponde, sem diferenciar maiúsculas/minúsculas (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | Coluna é `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | Coluna não é `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

Os quatro operadores de padrão correspondem a texto. Uma coluna enum é comparada pelo seu valor
(`?status=like.draft%25`); em um número, uma data ou qualquer outra coluna que não seja
texto, eles resultam em um erro 400 `INVALID_FILTER_OPERATOR`.

`isnull` e `notnull` não recebem operando — o operador é a condição inteira, e
`.null`, `.true`, `.false` ou nada após o ponto têm o mesmo significado. O SDK
escreve `.null`, portanto essa é a grafia que você verá trafegando na rede. Qualquer outra coisa
após o ponto não é considerada um operando válido, de modo que a string inteira é lida como um
valor: `?reason=notnull.reason` corresponde ao texto `notnull.reason`.

:::caution[`eq.null` é a string de quatro caracteres, não `IS NULL`]
`?deleted_at=eq.null` busca pelo texto literal `null`. O `= NULL` do SQL nunca é
verdadeiro, portanto não há interpretação de `eq.null` que signifique o teste de nulo —
use `isnull` para isso. O SDK serializa `.where("deleted_at", "==", null)` como
`isnull.null` exatamente por essa razão.
:::

## Operadores Lógicos

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
`not(a,b)` é `NOT (a AND b)`. Ele é compilado para um `NOT (...)` real em SQL, em vez
de operadores invertidos — o SQL possui lógica de três valores, portanto `NOT (a AND b)` e
`(NOT a) OR (NOT b)` deixam de concordar a partir do momento em que um NULL está envolvido. Uma negação,
portanto, **inclui linhas cuja coluna é NULL**, que é o significado de `NOT`; adicione
um `notnull` com AND ao lado se não for isso que você deseja.

**Um grupo por requisição: `or` tem precedência sobre `and`, e ambos sobre `not`.** Eles são
três grafias para o mesmo espaço, não três filtros. Em vez disso, faça o aninhamento:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Os grupos podem ser aninhados em até 32 níveis de profundidade; além disso, a requisição é recusada com
`INVALID_LOGICAL_GROUP`.

Uma condição dentro de um grupo cujo operador não existe no dialeto —
`?not=(title.contains.x)` — resulta em um erro 400 `UNKNOWN_FILTER_OPERATOR`, assim como ocorre em um
`where` JSON. Ela não é interpretada como uma igualdade em relação a `contains.x`, o que, dentro de `not`,
teria correspondido a todas as linhas.

Um grupo **restringe** em conjunto com os filtros de campo em vez de substituí-los — consulte
[Como os filtros se combinam](#como-os-filtros-se-combinam).

## O dialeto JSON `where`

Os filtros de campo acima são uma das duas maneiras de enviar um filtro. A outra é um
único objeto JSON, que é o que o documento OpenAPI publica em cada
`GET /api/data/{slug}` e o que as rotas aninhadas aceitam:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Cada chave é um campo, cada valor é uma tupla canônica `[operador, valor]` — as mesmas
tuplas que o SDK escreve. Um valor também pode ser uma string com ponto pré-serializada
(`{"status":"eq.active"}`) ou um escalar simples (`{"status":"active"}`); todos os três
compilam para a mesma condição. Um array de valores simples é um `in` implícito: `{"category":["electronics","gadgets"]}` é lido como
`["in", ["electronics","gadgets"]]`, enquanto um primeiro elemento com formato de operador que
não seja um operador real (`["!!","x"]`) resulta em um erro 400 `UNKNOWN_FILTER_OPERATOR`.

O mesmo objeto é lido da mesma forma onde quer que chegue: aqui, no `where` do SDK,
em uma consulta MCP e no `filter` do socket em tempo real — em suas requisições de listagem e
contagem e em suas assinaturas ativas.

A diferença que vale a pena conhecer: **o JSON preserva tipos.** `?price=gte.100` envia a
string `"100"` e o driver faz o cast de acordo com o tipo da coluna, enquanto
`?where={"price":[">=",100]}` envia um número. Para uma coluna cujas leituras de texto e
numérica diferem — uma string de versão, um código com zeros à esquerda — esse é o
parâmetro a ser utilizado.

Um `where` malformado resulta em um erro 400 `INVALID_WHERE`, e não em um filtro descartado silenciosamente:
descartá-lo executaria a leitura sem filtros e retornaria tudo o que a segurança em nível de linha (RLS)
porventura permitisse.

## Como os filtros se combinam

`?field=op.value`, `?where=`, `?or=`/`?and=`/`?not=` e `?searchString=` são
independentes, e cada um dos que estiver presente deve corresponder:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

A única exceção é um campo nomeado tanto em `?field=op.value` quanto em `where`: nesse
caso, o parâmetro de consulta **substitui** a condição `where` naquele campo, por ser a
requisição mais específica, em vez de ser combinado com AND a ela.

Não há como aplicar OR entre um e outro. Qualquer coisa que não seja um simples AND
desses grupos deve pertencer a uma única árvore `or=`/`and=`.

## Próximos Passos

- **[API REST](/docs/backend/api)** — Endpoints, ordenação, paginação e inclusão de relações
- **[Consultando Dados](/docs/sdk/querying)** — Os mesmos filtros a partir do SDK tipado
