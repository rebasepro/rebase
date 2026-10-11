---
sourceHash: a03adef95cbad36c
title: Paginação
sidebar_label: Paginação
description: Pagine uma coleção com limit/offset, números de página ou um cursor keyset — e quando cada um deixa de ser correto.
---

Três maneiras de percorrer uma coleção: um offset, um número de página e um cursor. Os
dois primeiros são posicionais e o terceiro não é, o que faz toda a diferença —
uma página posicional relê contando a partir do início, então linhas gravadas enquanto
você pagina deslocam o que "linha 20" significa.

```typescript
// Offset-based pagination
const page1 = await client.data.products.find({ limit: 20, offset: 0 });
const page2 = await client.data.products.find({ limit: 20, offset: 20 });

// Check if more pages exist
if (page1.meta.hasMore) {
    // fetch next page
}

// Page-number pagination (1-indexed)
const page = await client.data.products.find({ page: 2, limit: 20 });
```

`limit` deve ser um número inteiro entre 1 e 1000. Um valor maior — ou zero,
negativo, ou fracionário — é recusado com um 400 `INVALID_LIMIT` em vez de ser
ajustado (clamped), porque uma página silenciosamente menor não pode ser diferenciada da última.
Para ler além desse teto, percorra as páginas com `iterate()` ou `findAll()`.

#### Paginação por cursor

Toda resposta de lista carrega um `meta.nextCursor` enquanto houver outra página.
Passe-o de volta como `after` e a próxima página continuará **estritamente após a última linha
retornada**, em vez de em uma *contagem* de linhas que gravações simultâneas já
deslocaram:

```typescript
let after: string | undefined;
do {
    const { data, meta } = await client.data.orders.find({
        orderBy: ["createdAt", "desc"],
        limit: 100,
        after
    });
    for (const order of data) await handle(order);
    after = meta.nextCursor;
} while (after);
```

`nextCursor` está ausente na última página, e em uma página que nenhum cursor
pode descrever: uma busca ordenada por relevância (`_score`), uma busca vetorial
e uma projeção `fields` que deixa de fora um dos campos de `orderBy` — o cursor
é construído a partir dos valores de ordenação da última linha, e essa linha não
os carrega. Ali, `meta.hasMore` pode ser `true` sem nenhum `nextCursor`, e o loop
acima para antes do fim: adicione os campos de ordenação a `fields`, ou pagine
por `offset`. O `iterate()`, ao receber um `cursor`, recusa essa listagem com
`cursor-missing` em vez de parar. Uma ordenação por um
[agregado sobre uma relação](/docs/sdk/relations/) pagina por cursor normalmente.

O cursor é **opaco**. Ele codifica as chaves de ordenação *e* os valores da última linha
para elas, de modo que ele só pode continuar a listagem da qual veio: mantenha o `orderBy`
idêntico entre as páginas, ou a requisição será recusada com
`CURSOR_ORDER_MISMATCH` em vez de buscar em uma ordem que ninguém solicitou. Uma
requisição que não define nenhum `orderBy` adota o do cursor, para que você possa passá-lo
diretamente de volta sem precisar redefinir a ordenação.

Não faça o parse dele e não construa um: a codificação existe para ser alterada, e
qualquer outra coisa resultará em `INVALID_CURSOR`.

Quatro consequências decorrem do que um cursor é:

- **`after` não pode ser combinado com `offset` ou `page`** (400
  `CURSOR_WITH_OFFSET`). Ambos informam onde a página começa, e honrar ambos
  pularia linhas.
- **Ordenações por múltiplas chaves e chaves que aceitam nulo funcionam.** A comparação é construída sobre
  cada chave em ordem, com o [posicionamento de NULL](/docs/sdk/querying#where-nulls-sort) que a ordenação
  declarou — não um único `>` em uma coluna.
- **Relevância não pode ser um cursor.** Um `_score` é calculado por consulta e não é armazenado em
  lugar nenhum, e duas consultas com strings de busca diferentes produzem pontuações que não estão
  na mesma escala. Tal listagem simplesmente não carrega `nextCursor`; pagine-a com `offset`. O
  mesmo vale para a distância de uma busca vetorial, e um cursor enviado com uma é recusado com
  `VECTOR_CURSOR_UNSUPPORTED`.
- **Uma assinatura não pode continuar a partir de um cursor.** `listen()` reexecuta sua consulta a
  cada escrita, e `after` indica um ponto em uma única execução dela, então `listen({ after })` é
  recusado com `CURSOR_NOT_LIVE` antes de qualquer envio. Use `offset` ou `page` para uma janela ao
  vivo, ou `find({ after })` para ler a página uma vez.

Via HTTP, é um único parâmetro:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Ignorando a contagem

<span class="since-badge" data-since="0.25">Desde 0.25</span> `meta.total` é um `COUNT(*)` sobre todas as linhas que a consulta encontra, executado ao lado da
página — e numa tabela grande custa mais do que a própria página. Uma leitura que só pagina para a frente nunca precisa dele, porque
`meta.hasMore` não depende dele: passe `count: "none"` e a leitura pede uma linha além da página.

```typescript
const { data, meta } = await client.data.orders.find({ limit: 100, count: "none" });
meta.hasMore; // exact
```

Sem contagem não há total a informar: via HTTP, `meta.total` está ausente,
e no mesmo processo ele são as linhas até o fim da página (`offset` mais a
página). Via HTTP é `?count=none`; `?count=exact` é o padrão, e qualquer
outro valor resulta em um 400 `INVALID_COUNT`. `iterate()` e `findAll()` o enviam
em cada página por conta própria, já que um percurso não informa total.

#### Quais leituras são envelopadas e quais não são

Dois formatos e uma regra: **uma janela é envelopada, uma resposta completa não é.**

| Método | Retorna | Por quê |
|--------|---------|---------|
| `find()`, `listen()` | `{ data, meta }` | Uma página. `meta.total` / `meta.hasMore` são a única forma de saber se há mais |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Nada restante para relatar — o percurso terminou ou o lote *são* as linhas |
| `iterate()` | uma linha por vez | Nada é materializado |
| `findById()`, `get()`, `create()`, `update()` | uma linha | Não é uma lista |

`data` não é um wrapper que o SDK às vezes adiciona e às vezes esquece. É
onde os metadados de paginação residem, e está presente exatamente quando há algum.

#### Lendo tudo: `iterate()` e `findAll()`

`iterate()` transmite cada linha correspondente a uma consulta, uma por vez, buscando uma página de
cada vez nos bastidores. Nada se acumula, portanto é o método a ser usado para uma
coleção que você não pode manter na memória:

```typescript
for await (const order of client.data.orders.iterate({
    where: { status: ["==", "pending"] }
})) {
    await handleOrder(order);
}
```

`findAll()` é o mesmo percurso coletado em um array:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
```

Ambos também estão no fluent builder, onde `.limit()` se torna o **tamanho da página**
em vez de um total:

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Quatro opções moldam o percurso:

| Opção | Padrão | O que faz |
|-------|--------|-----------|
| `pageSize` | 200 | Linhas por requisição. |
| `cursor` | — | Exige a busca: lança um erro em vez de recorrer ao offset. Veja abaixo. |
| `maxPages` | 10 000 | Teto de requisições, para que um servidor que nunca para de retornar `hasMore` não fique em loop infinito. |
| `maxRows` | 10 000 | Apenas `findAll()`. Exceder esse valor **lança um erro** em vez de retornar um array truncado como se fosse a resposta completa. Passe `Infinity` para desativar, ou use `iterate()`. |

**O percurso faz a busca por conta própria.** Depois da primeira página, ele devolve
[o cursor do servidor](#paginação-por-cursor) — `meta.nextCursor` — como `after`,
de modo que cada requisição pede linhas estritamente após a última visualizada. Gravações
simultâneas antes dessa linha não podem deslocar a janela, e o banco de dados nunca precisa
pular linhas por contagem, que era o que tornava lentos os percursos longos por offset: cada página custava
mais do que a anterior.

Onde o servidor não emite cursor — uma busca ordenada por relevância, uma busca
vetorial, uma leitura com `distinct`, uma projeção de `fields` que deixa de fora um campo
de ordenação — o percurso pagina por offset, e uma linha
inserida ou excluída *enquanto o percurso é executado* pode fazê-lo pular ou repetir uma linha.
Passe `cursor` para tornar a busca uma exigência em vez de uma preferência:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` define a coluna pela qual ordenar quando a consulta ainda não especificar, e
transforma o recurso ao offset em um erro. O percurso não constrói nenhuma comparação
própria, razão pela qual uma ordenação por múltiplas chaves
funciona —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— e por que uma chave de ordenação que aceita nulos também funciona.

A ordenação ainda precisa ser **total**, o que na prática significa única: o id da linha
desempata no final, de modo que qualquer coluna funciona como critério de desempate. Com `cursor`, um
percurso cujo cursor para de avançar lança `cursor-stalled` em vez de entrar em loop
infinito, e uma consulta que nenhum cursor consegue descrever (relevância) lança
`cursor-missing`; remova `cursor` e o percurso as pagina por offset.

## Veja também

- [Consultando dados](/docs/sdk/querying/) — filtros, o fluent builder, ordenação.
- [Agregações e busca](/docs/sdk/aggregates-and-search/) — por que a relevância não pode ser chave de um cursor.
