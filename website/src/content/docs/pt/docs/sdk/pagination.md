---
sourceHash: f040abfe0eee948c
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

O cursor é **opaco**. Ele codifica as chaves de ordenação *e* os valores da última linha
para elas, de modo que ele só pode continuar a listagem da qual veio: mantenha o `orderBy`
idêntico entre as páginas, ou a requisição será recusada com
`CURSOR_ORDER_MISMATCH` em vez de buscar em uma ordem que ninguém solicitou. Uma
requisição que não define nenhum `orderBy` adota o do cursor, para que você possa passá-lo
diretamente de volta sem precisar redefinir a ordenação.

Não faça o parse dele e não construa um: a codificação existe para ser alterada, e
qualquer outra coisa resultará em `INVALID_CURSOR`.

Três consequências decorrem do que um cursor é:

- **`after` não pode ser combinado com `offset` ou `page`** (400
  `CURSOR_WITH_OFFSET`). Ambos informam onde a página começa, e honrar ambos
  pularia linhas.
- **Ordenações por múltiplas chaves e chaves que aceitam nulo funcionam.** A comparação é construída sobre
  cada chave em ordem, com o [posicionamento de NULL](#where-nulls-sort) que a ordenação
  declarou — não um único `>` em uma coluna.
- **Relevância não pode ser um cursor.** Um `_score` é calculado por consulta e não é armazenado
  em lugar nenhum, e duas consultas com strings de busca diferentes produzem pontuações que não
  estão na mesma escala. Tal listagem simplesmente não carrega `nextCursor`; pagine-a
  com `offset`.

Via HTTP, é um único parâmetro:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

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

Três opções moldam o percurso:

| Opção | Padrão | O que faz |
|-------|--------|-----------|
| `pageSize` | 200 | Linhas por requisição. |
| `cursor` | — | Busca em uma coluna em vez de paginar por offset. Veja abaixo. |
| `maxPages` | 10 000 | Teto de requisições, para que um servidor que nunca para de retornar `hasMore` não fique em loop infinito. |
| `maxRows` | 10 000 | Apenas `findAll()`. Exceder esse valor **lança um erro** em vez de retornar um array truncado como se fosse a resposta completa. Passe `Infinity` para desativar, ou use `iterate()`. |

**Prefira `cursor` sempre que a coleção tiver uma coluna única e ordenável.**
A paginação por offset reconta as linhas a cada requisição, portanto uma linha inserida ou excluída
*enquanto a iteração é executada* desloca a janela e o percurso pula ou repete
linhas silenciosamente. A busca solicita linhas estritamente após a última visualizada, as quais
gravações simultâneas antes do cursor não podem mover:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` aqui significa "buscar em vez de paginar por offset" e define a coluna pela
qual ordenar quando a consulta ainda não especificar. A busca em si é
[o cursor do servidor](#cursor-pagination): a iteração repassa `meta.nextCursor` de volta
como `after` e não constrói nenhuma comparação própria, razão pela qual uma ordenação por múltiplas chaves
funciona —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— e por que uma chave de ordenação que aceita nulos também funciona.

A ordenação ainda precisa ser **total**, o que na prática significa única: o id da linha
desempata no final, de modo que qualquer coluna funciona como critério de desempate, mas um percurso cujo
cursor para de avançar lança `cursor-stalled` em vez de entrar em loop infinito. Uma
consulta que nenhum cursor consegue descrever (relevância) lança `cursor-missing`;
remova `cursor` e pagine por offset.

## Veja também

- [Consultando dados](/docs/sdk/querying/) — filtros, o fluent builder, ordenação.
- [Agregações e busca](/docs/sdk/aggregates-and-search/) — por que a relevância não pode ser chave de um cursor.

---
