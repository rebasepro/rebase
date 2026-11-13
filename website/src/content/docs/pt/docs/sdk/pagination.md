---
sourceHash: e658ebda47d3942e
title: Paginação
sidebar_label: Paginação
description: Paginar uma tabela com limit/offset, números de página ou um cursor keyset — e quando cada um deixa de ser correto.
---

Três maneiras de percorrer uma tabela: um offset, um número de página e um cursor. Os
dois primeiros são posicionais e o terceiro não, o que faz toda a diferença —
uma página posicional relê contando a partir do início, portanto, linhas gravadas enquanto
você pagina deslocam o significado de "linha 20".

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

Use um ou o outro. `page` e `offset` juntos descrevem a mesma janela
duas vezes, e a leitura é recusada com `PAGE_WITH_OFFSET` em vez de silenciosamente
aplicar `page`. O SDK recusa isso antes de qualquer requisição, via HTTP, em processo e
offline; o servidor responde a uma requisição direta que envie ambos com um 400.

`limit` deve ser um número inteiro entre 1 e 1000. Um valor maior — ou zero,
negativo ou fracionário — é recusado com um erro 400 `INVALID_LIMIT` em vez de ser
limitado (clamped), porque uma página silenciosamente menor não pode ser distinguida da última página.
Para ler além desse teto, percorra as páginas com `iterate()` ou `findAll()`.

#### Paginação por cursor

Toda resposta de listagem traz um `meta.nextCursor` enquanto houver outra página.
Passe-o de volta como `after` e a próxima página continuará **estritamente após a última linha
retornada**, em vez de uma *contagem* de linhas que gravações concorrentes já
tenham alterado:

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

`nextCursor` fica ausente na última página e em páginas que nenhum cursor consegue descrever:
uma busca ordenada por relevância (`_score`), uma busca vetorial e uma projeção de `fields`
que omite um dos campos de `orderBy` — o cursor é construído a partir dos valores de ordenação
da última linha, e essa linha não os contém. Nesses casos, `meta.hasMore` pode ser
`true` sem nenhum `nextCursor`, e o loop acima para antes da hora: adicione os campos de ordenação
a `fields`, ou pagine por `offset`. O `iterate()` que recebe um `cursor` recusa essa
listagem com `cursor-missing` em vez de simplesmente parar. Uma ordenação por um
[agregado sobre uma relação](/docs/sdk/relations/) permite paginação por cursor.

O cursor é **opaco**. Ele codifica as chaves de ordenação *e* os valores da última linha
para elas, de modo que só pode continuar a listagem de onde veio: mantenha o `orderBy`
idêntico em todas as páginas, caso contrário a requisição será recusada com
`CURSOR_ORDER_MISMATCH` em vez de buscar em uma ordem que ninguém pediu. Uma
requisição que não define nenhum `orderBy` adota o do cursor, para que você possa passá-lo
diretamente de volta sem precisar declarar a ordenação novamente.

Não tente fazer o parse nem construir um cursor manualmente: a codificação existe para sofrer alterações, e
qualquer outra coisa resultará em `INVALID_CURSOR`.

Quatro consequências decorrem do que um cursor é:

- **`after` não pode ser combinado com `offset` ou `page`** (400
  `CURSOR_WITH_OFFSET`). Ambos indicam onde a página começa, e respeitar
  os dois pularia linhas.
- **Ordenações com múltiplas chaves e chaves anuláveis (nullable) funcionam.** A comparação é construída sobre
  cada chave em ordem, com o [posicionamento de NULL](/docs/sdk/querying#where-nulls-sort) declarado na ordenação
  — e não um simples `>` em uma única coluna.
- **Relevância não pode ser usada como cursor.** Um `_score` é calculado por consulta e não é armazenado
  em lugar nenhum, e duas consultas com termos de busca diferentes geram pontuações que não estão
  na mesma escala. Essa listagem simplesmente não traz um `nextCursor`; pagine-a
  com `offset`. A distância em uma busca vetorial funciona da mesma forma, e um cursor enviado com
  ela é recusado com `VECTOR_CURSOR_UNSUPPORTED`.
- **Uma subscription não pode continuar a partir de um cursor.** O `listen()` executa novamente sua consulta
  a cada escrita, e o `after` indica uma posição em uma única execução dela, de modo que `listen({ after })`
  é recusado com `CURSOR_NOT_LIVE` antes de qualquer envio. Use `offset` ou
  `page` para uma janela em tempo real (live), ou `find({ after })` para ler a página uma única vez.

Via HTTP, é um único parâmetro:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Ignorando a contagem

`meta.total` é um `COUNT(*)` sobre cada linha correspondente à consulta, executado paralelamente
à página — e em uma tabela grande, isso custa mais caro do que a própria página. Uma leitura que apenas
avança páginas nunca precisa dele, porque `meta.hasMore` não depende disso:
passe `count: "none"` e a leitura solicitará uma linha além da página.

```typescript
const { data, meta } = await client.data.orders.find({ limit: 100, count: "none" });
meta.hasMore; // exact
```

Sem uma contagem, não há total a ser informado: via HTTP `meta.total` fica ausente
e, em processo, corresponde às linhas até o final da página (`offset` mais a
página). Via HTTP utiliza-se `?count=none`; `?count=exact` é o padrão, e qualquer
outro valor resulta em um 400 `INVALID_COUNT`. `iterate()` e `findAll()` enviam esse parâmetro
automaticamente em cada página, já que uma iteração contínua (walk) não relata um total.

#### Quais leituras são encapsuladas e quais não são

Dois formatos e uma regra: **uma janela vem encapsulada, uma resposta completa não.**

| Método | Retorno | Motivo |
|--------|---------|--------|
| `find()`, `listen()` | `{ data, meta }` | Uma página. `meta.total` / `meta.hasMore` são a única forma de saber se há mais |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Nada restante a relatar — a iteração terminou, ou o lote *são* as linhas em si |
| `iterate()` | uma linha por vez | Nada é materializado |
| `findById()`, `get()`, `create()`, `update()` | uma linha | Não é uma lista |

`data` não é um wrapper que o SDK adiciona às vezes e esquece outras vezes. É
onde residem os metadados de paginação, e ele está presente exatamente quando há metadados.

#### Lendo tudo: `iterate()` e `findAll()`

O `iterate()` transmite via stream cada linha correspondente à consulta, uma por vez, buscando uma página por
vez nos bastidores. Nada é acumulado, por isso é a opção recomendada para uma
tabela que não cabe na memória:

```typescript
for await (const order of client.data.orders.iterate({
    where: { status: ["==", "pending"] }
})) {
    await handleOrder(order);
}
```

`findAll()` é a mesma iteração, mas coletada em um array:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
```

Ambos também estão disponíveis no fluent builder, onde `.limit()` passa a ser o **tamanho da página**
em vez de um limite total:

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Quatro opções moldam a iteração:

| Opção | Padrão | O que faz |
|-------|--------|-----------|
| `pageSize` | 200 | Linhas por requisição. |
| `cursor` | — | Exigir busca por cursor (seeking): lança um erro em vez de recorrer ao offset. Veja abaixo. |
| `maxPages` | 10 000 | Teto de requisições, para que um servidor que nunca para de responder `hasMore` não entre em loop infinito. |
| `maxRows` | 10 000 | Apenas para `findAll()`. Exceder esse limite **lança um erro** em vez de retornar um array truncado como se fosse a resposta completa. Passe `Infinity` para desativar, ou use `iterate()`. |

**A iteração faz o seeking automaticamente.** Após a primeira página, ela passa
[o cursor do servidor](#paginação-por-cursor) — `meta.nextCursor` — de volta como `after`,
para que cada requisição solicite linhas estritamente após a última visualizada.
Gravações concorrentes antes dessa linha não conseguem deslocar a janela, e o banco de dados nunca precisa
pular linhas por contagem, que é o que tornava lentas as longas iterações por offset: cada página custava
mais do que a anterior.

Quando o servidor não fornece um cursor — uma busca ordenada por relevância, uma busca
vetorial, uma leitura `distinct`, uma projeção de `fields` que omite um campo de ordenação
—, a iteração pagina por offset, e uma linha inserida ou excluída *enquanto a iteração está em execução*
pode fazer com que uma linha seja pulada ou repetida. Passe `cursor` para tornar o seeking obrigatório
em vez de uma preferência:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

O `cursor` especifica a coluna pela qual ordenar quando a consulta ainda não a definiu, e
transforma o fallback para offset em um erro. A iteração não cria nenhuma comparação própria,
e é por isso que uma ordenação com múltiplas chaves funciona —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— e é por isso que uma chave de ordenação anulável (nullable) também funciona.

A ordenação ainda precisa ser **total**, o que na prática significa única: o id da linha
serve como desempate final, portanto qualquer coluna funciona para desempatar. Ao especificar `cursor`, uma
iteração cujo cursor para de avançar lança `cursor-stalled` em vez de ficar em loop
infinito, e uma consulta que nenhum cursor pode descrever (relevância) lança
`cursor-missing`; remova `cursor` e a iteração paginará esses casos por offset.

## Veja também

- [Consultando dados](/docs/sdk/querying/) — filtros, o fluent builder, ordenação.
- [Agregados e busca](/docs/sdk/aggregates-and-search/) — por que a relevância não pode servir de chave para um cursor.
