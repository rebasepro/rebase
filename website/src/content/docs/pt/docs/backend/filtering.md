---
sourceHash: f4fe63c58f66c539
title: Filtragem na API REST
sidebar_label: Filtragem
description: Filtre as listas da API REST com operadores no estilo PostgREST, grupos or/and e o dialeto JSON where, e veja como os filtros se combinam.
---

Use parâmetros de consulta no estilo PostgREST para filtrar resultados. O formato é `?field=operator.value`:

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

## Operadores de Filtro

| Operador | Significado | Exemplo |
|----------|---------|---------|
| `eq` | Igual (`==`) | `?active=eq.true` |
| `neq` | Diferente (`!=`) | `?status=neq.draft` |
| `gt` | Maior que (`>`) | `?price=gt.100` |
| `gte` | Maior ou igual (`>=`) | `?price=gte.100` |
| `lt` | Menor que (`<`) | `?price=lt.50` |
| `lte` | Menor ou igual (`<=`) | `?price=lte.50` |
| `in` | No array | `?status=in.(a,b,c)` |
| `nin` | Não está no array | `?status=nin.(a,b)` |
| `cs` | O array contém | `?tags=cs.value` |
| `csa` | O array contém qualquer um | `?tags=csa.(a,b)` |
| `like` | Correspondência de padrão, sensível a maiúsculas e minúsculas (`like`) | `?sku=like.AB-%` |
| `ilike` | Correspondência de padrão, insensível a maiúsculas e minúsculas (`ilike`) | `?name=ilike.%widget%` |
| `nlike` | Não corresponde ao padrão (`not-like`) | `?sku=nlike.TMP-%` |
| `nilike` | Não corresponde, insensível a maiúsculas e minúsculas (`not-ilike`) | `?name=nilike.%test%` |
| `isnull` | A coluna é `NULL` (`is-null`) | `?deleted_at=isnull.null` |
| `notnull` | A coluna não é `NULL` (`is-not-null`) | `?deleted_at=notnull.null` |

Os quatro operadores de padrão comparam texto. Uma coluna enum é comparada pelo seu valor
(`?status=like.draft%25`); em um número, uma data ou qualquer outra coluna que não seja
texto, resultam em um 400 `INVALID_FILTER_OPERATOR`.

`isnull` e `notnull` não recebem operando — o operador é a condição completa, e
`.null`, `.true`, `.false` ou nada após o ponto significam a mesma coisa. O SDK
escreve `.null`, portanto essa é a grafia que você verá trafegando na rede. Qualquer outra
coisa após o ponto não é um operando que eles tenham, então a string inteira é lida como
um valor: `?reason=notnull.reason` corresponde ao texto `notnull.reason`.

:::caution[`eq.null` é a string de quatro caracteres, não `IS NULL`]
`?deleted_at=eq.null` pesquisa pelo texto literal `null`. Em SQL, `= NULL` nunca
é verdadeiro, portanto não há interpretação de `eq.null` que signifique a verificação
de nulo — use `isnull` para isso. O SDK serializa `.where("deleted_at", "==", null)`
como `isnull.null` exatamente por esse motivo.
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
`not(a,b)` é `NOT (a AND b)`. Ele é compilado para um `NOT (...)` SQL real em vez
de operadores invertidos — o SQL possui lógica trivalente, portanto `NOT (a AND b)` e
`(NOT a) OR (NOT b)` deixam de concordar a partir do momento em que um NULL está envolvido.
Uma negação, portanto, **inclui linhas cuja coluna é NULL**, que é o significado de `NOT`;
adicione um `notnull` com AND ao lado caso não seja isso o que você deseja.

**Um grupo por requisição: `or` tem precedência sobre `and`, e ambos sobre `not`.** Eles
são três grafias do mesmo slot, não três filtros. Em vez disso, faça aninhamento:

```bash
GET /api/data/products?or=(price.lt.10,and(active.eq.true,price.gt.0))
GET /api/data/products?not=(or(status.eq.draft,status.eq.archived))
```

Os grupos podem ser aninhados em até 32 níveis de profundidade; além disso, a requisição é recusada com
`INVALID_LOGICAL_GROUP`.

Uma condição dentro de um grupo cujo operador o dialeto não possui —
`?not=(title.contains.x)` — resulta em um 400 `UNKNOWN_FILTER_OPERATOR`, como em um
`where` JSON. Ela não é lida como uma igualdade em `contains.x`, o que dentro de `not`
teria correspondido a todas as linhas.

Um grupo **restringe** juntamente com os filtros de campo em vez de substituí-los — veja
[Como os filtros se combinam](#como-os-filtros-se-combinam).

## O dialeto JSON de `where`

Os filtros de campo acima são uma das duas formas de enviar um filtro. A outra é um
único objeto JSON, que é o que o documento OpenAPI publica em cada
`GET /api/data/{slug}` e o que as rotas de subcoleções aninhadas aceitam:

```bash
GET /api/data/products?where={"status":["==","active"],"price":[">=",100]}
```

Cada chave é um campo e cada valor é uma tupla canônica `[operator, value]` — as mesmas
tuplas que o SDK escreve. Um valor também pode ser uma string pré-serializada com ponto
(`{"status":"eq.active"}`) ou um escalar simples (`{"status":"active"}`); todos os três
compilam para a mesma condição. Um array de valores simples é um `in` implícito: `{"category":["electronics","gadgets"]}` é lido como
`["in", ["electronics","gadgets"]]`, enquanto um primeiro elemento com forma de operador
que não é um operador real (`["!!","x"]`) é um 400 `UNKNOWN_FILTER_OPERATOR`.

O mesmo objeto é lido da mesma forma onde quer que chegue: aqui, no `where` do SDK,
em uma consulta MCP e no `filter` do socket de realtime — suas requisições de lista e
contagem e suas assinaturas ao vivo.

A diferença que vale a pena conhecer: **o JSON carrega tipos.** `?price=gte.100` envia a
string `"100"` e o driver faz a conversão de tipo (cast) pelo tipo da coluna, enquanto
`?where={"price":[">=",100]}` envia um número. Para uma coluna cujas interpretações
textual e numérica diferem — uma string de versão, um código preenchido com zeros à esquerda —,
esse é o parâmetro ideal para se usar.

Um `where` malformado resulta em um 400 `INVALID_WHERE`, e não em um filtro descartado
silenciosamente: descartá-lo executaria a leitura sem filtros e retornaria tudo o que a segurança
em nível de linha (RLS) porventura permitisse.

## Como os filtros se combinam

`?field=op.value`, `?where=`, `?or=`/`?and=`/`?not=` e `?searchString=` são
independentes, e cada um deles presente deve corresponder:

```text
(field filters and `where`, AND-ed together)
  AND (the logical group)
  AND (the search string)
```

A única exceção é um campo citado tanto em `?field=op.value` quanto em `where`: nesse
caso, o parâmetro de consulta **substitui** a condição de `where` naquele campo, por ser
a solicitação mais específica, em vez de ser combinado com ela por AND.

Não há como fazer uma operação OR entre eles. Qualquer coisa que não seja um AND
simples desses grupos deve ficar dentro de uma única árvore `or=`/`and=`.

## Próximos passos

- **[API REST](/docs/backend/api)** — Endpoints, ordenação, paginação e inclusão de relações
- **[Consultando Dados](/docs/sdk/querying)** — Os mesmos filtros a partir do SDK tipado
