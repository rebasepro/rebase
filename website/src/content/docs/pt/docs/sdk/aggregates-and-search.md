---
sourceHash: 598d10fdd9ac95db
title: Agregações e busca
sidebar_label: Agregações e busca
description: "Conte, some e agrupe com o SDK, filtre dentro de colunas JSON e execute busca textual e vetorial a partir do cliente."
---

## Agregações

`count`, `sum`, `avg`, `min`, `max` e as funções abaixo sobre as linhas selecionadas por um
filtro, sem buscá-las:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)
```

```json
{ "data": [{ "count": 128, "sum_total": 40522 }] }
```

Agrupe para obter uma linha por valor:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)&groupBy=status
```

```json
{
  "data": [
    { "status": "paid",    "count": 96, "sum_total": 31200 },
    { "status": "pending", "count": 32, "sum_total": 9322 }
  ]
}
```

Os resultados são indexados por função e campo — `count()` torna-se `count`,
`sum(total)` torna-se `sum_total`.

### Mais funções

| `select` | SDK | Chave do resultado | O que é |
|---|---|---|---|
| `countDistinct(sid)` | `{ fn: "countDistinct", field: "sid" }` | `count_distinct_sid` | Valores distintos não nulos |
| `mode(lang)` | `{ fn: "mode", field: "lang" }` | `mode_lang` | O valor mais frequente |
| `percentile(price,0.95)` | `{ fn: "percentile", field: "price", p: 0.95 }` | `p95_price` | Percentil contínuo, `p` de 0 a 1 (`0.5` é a mediana) |
| `distinct(lang)` | `{ fn: "distinct", field: "lang" }` | `distinct_lang` | Os valores distintos não nulos, ordenados, como um array |
| `fingerprint()` | `{ fn: "fingerprint" }` | `fingerprint` | Uma string que muda sempre que uma linha abrangida muda |

### Agregações filtradas e nomes

Uma agregação pode contar apenas parte das linhas: forneça a ela seu próprio `where`
(`FILTER (WHERE …)` do SQL). Várias delas compõem uma única consulta sobre as linhas que
o `where` externo selecionou, de modo que um painel com oito contagens é uma única varredura. Nomeie
cada uma com `as`, o que é necessário para duas agregações da mesma função:

```ts
const [stats] = await client.data.songs.aggregate({
    select: [
        { fn: "count", as: "rows" },
        { fn: "count", as: "live", where: { tags: ["!=", []] } },
        { fn: "count", as: "unplayable", where: { playable: ["==", false] } },
        { fn: "sum", field: "plays", as: "plays" }
    ]
});
// { rows: 30000, live: 21480, unplayable: 312, plays: 918211 }
```

Um nome usado duas vezes, ou a chave de uma coluna do `groupBy`, é recusado
(`INVALID_AGGREGATE_SELECT`) em vez de sobrescrever um valor. Via HTTP, um nome
é escrito no estilo do PostgREST, `select=live:count()`; uma agregação com seu próprio
`where` é enviada como um array JSON — `select=[{"fn":"count","as":"live","where":{"tags":["!=",[]]}}]`.

O `field` de uma agregação pode ser um caminho JSON, `props->>players`: `sum`, `avg` e
`percentile` leem o valor ali como um número e ignoram valores que não sejam numéricos; os
outros o leem como texto. Um caminho JSON também pode ser uma entrada de `groupBy`, identificada pelo caminho
exatamente como escrito:

```ts
await client.data.events.aggregate({
    select: [{ fn: "count" }, { fn: "avg", field: "props->>players", as: "players" }],
    groupBy: ["props->>music"]
});
// [{ "props->>music": "80s", count: 412, players: 3.4 }, …]
```

### Agrupando por uma expressão

Uma entrada de `groupBy` pode transformar sua coluna. Via HTTP, ela é escrita como
uma função; no SDK, como `{ field, transform }`, e retorna sob
`<transform>_<field>` — que também é o nome usado por `orderBy`:

| Transformação | Agrupa por |
|---|---|
| `lower(name)`, `upper(name)` | A coluna como texto em minúsculas ou maiúsculas |
| `year(createdAt)`, `month(createdAt)`, `day(createdAt)` | A data, em UTC, como `2026`, `2026-11`, `2026-11-08` — ou em um fuso horário: `day(createdAt,Europe/Madrid)`, `{ field, transform: "day", timeZone: "Europe/Madrid" }` |
| `unnest(tags)` | Cada elemento de uma coluna de array: um grupo por elemento |

```ts
// How many songs carry each tag — the distinct elements of an array column.
const tags = await client.data.songs.aggregate({
    select: [{ fn: "count" }],
    groupBy: [{ field: "tags", transform: "unnest" }],
    orderBy: ["unnest_tags", "asc"]
});
// [{ unnest_tags: "pop", count: 812 }, …]

// Each artist's usual language, however the name is capitalised.
await client.data.songs.aggregate({
    select: [{ fn: "mode", field: "lang" }],
    groupBy: [{ field: "artist", transform: "lower" }]
});
```

```bash
GET /api/data/events/aggregate?select=count(),countDistinct(sid)&groupBy=day(at)&orderBy=day_at:asc
```

### Algo mudou? `fingerprint()`

`fingerprint()` responde a "esta tabela mudou desde a última vez que verifiquei?"
sem ler as linhas: guarde a string, consulte novamente mais tarde e recalcule
o que quer que você tenha derivado das linhas apenas quando houver diferença. Qualquer inserção, atualização ou
exclusão de uma linha abrangida a altera; uma escrita que não altera nada (definir uma
coluna com seu próprio valor) também pode alterá-la, e excluir uma linha recém-adicionada
a restaura. Ela abrange o que o chamador pode ver e o que os filtros selecionam,
e pode ser agrupada, de modo que `groupBy=lang` fornece um fingerprint por idioma.

```ts
let lastFingerprint: string | undefined;

async function catalogueChanged(): Promise<boolean> {
    const [{ fingerprint }] = await client.data.songs.aggregate({ select: [{ fn: "fingerprint" }] });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = String(fingerprint);
    return changed;
}
```

Ele é calculado a partir das versões de linha mantidas pelo Postgres, não dos valores, portanto
custa uma varredura da tabela e não o cálculo de hash de cada linha: em 30.000 linhas, leva 4 ms
onde `md5(string_agg(...))` sobre as linhas levaria 56 ms. Não está disponível em uma
view simples, que não armazena linhas; uma view materializada possui um.

Os grupos são paginados como as linhas de uma listagem. `limit` os delimita, `offset` (ou `page`)
os pula, e `orderBy` os ordena por um campo de `groupBy` ou por uma chave de resultado. A
ordenação sempre termina nas chaves do grupo, para que cada limite de página caia no mesmo
lugar. Uma agregação agrupada sem `limit` é truncada no padrão de listagem (50
grupos), igual a uma listagem. Com um `limit` — incluindo o padrão —, a
resposta indica se há mais itens, e o método `aggregate()` do SDK o retorna
como `meta` no resultado:

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` ou `orderBy` sem um `groupBy`, ou um cursor em qualquer agregação,
resulta em `400 INVALID_AGGREGATE_WINDOW`: uma agregação não agrupada tem apenas uma linha, e um
grupo não é uma linha a partir da qual um cursor possa continuar.

Uma agregação lê os valores armazenados e nunca executa `afterRead`. Portanto, em uma
tabela que um hook `afterRead` reescreve — seja global, da própria tabela ou o `.transform()` de uma coluna —,
apenas `count()` e `fingerprint()` sem `groupBy` são atendidos, tanto via HTTP quanto in-process;
qualquer outra coisa resulta em um `400 AGGREGATE_MASKED_BY_AFTER_READ`, pois uma soma,
um máximo ou um grupo leria os valores que o hook oculta.

No SDK, `aggregate()` aceita o mesmo `orderBy` que `find()` — uma
tupla `[key, "asc" | "desc"]` ou uma lista delas — onde a chave é uma coluna do `groupBy`
ou uma chave de resultado. Ambos são tipados: em um modelo gerado, uma chave que não
seja nenhuma das duas não compila. In-process (`rebase.data`), os grupos retornam
na mesma ordem que via HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Ele aceita os mesmos filtros que o endpoint de listagem, de modo que uma agregação pode ser filtrada
da mesma forma que uma listagem:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**A segurança em nível de linha (RLS) se aplica às linhas que estão sendo agregadas.** Uma agregação é uma
maneira eficiente de obter informações sobre linhas que você não pode ler, portanto, ela é executada sob as
próprias políticas do chamador: quem não pode selecionar nada, não conta nada.
:::

As agregações precisam de um driver que as implemente. Em um driver que não as implementa, o
endpoint responde com `501` em vez de um resultado vazio — um painel não deve
receber a mensagem "nenhum resultado encontrado" quando a verdade é "não suportado".

## Filtrando dentro de JSON

Uma coluna `json` ou `jsonb` pode ser filtrada por caminho, usando a própria sintaxe de
setas do Postgres:

```typescript
// Orders whose metadata says the country is US
const { data } = await client.data.orders
    .where("metadata->>country", "==", "US")
    .find();

// Nested paths walk with -> and take the leaf with ->>
await client.data.orders.where("metadata->address->>city", "==", "Berlin").find();
```

Via REST:

```bash
GET /api/data/orders?metadata->>country=eq.US
```

Os segmentos de caminho são sempre enviados como parâmetros vinculados (bound parameters), nunca interpolados diretamente no SQL.

### Como os valores são comparados

`->>` produz **texto**, portanto as comparações são comparações de texto — exceto quando um
operador de ordenação (`>`, `>=`, `<`, `<=`) recebe um **número**, convertendo-o para numérico:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Linhas cujo valor naquele caminho não seja um número são excluídas de uma
comparação numérica em vez de falhar a consulta. Booleanos são comparados como `"true"` /
`"false"`, que é como `->>` os renderiza.

:::note
O `array-contains` e os outros operadores de coluna inteira não estão disponíveis em um
caminho — eles fazem uma verificação sobre o documento completo, portanto, use-os na própria
coluna.
:::

## Busca textual

```typescript
// Via find params
const { data } = await client.data.products.find({
    searchString: "wireless headphones"
});

// Fluent style
const { data } = await client.data.products
    .search("wireless headphones")
    .limit(10)
    .find();
```

Por padrão, trata-se de uma **correspondência de substring que não diferencia maiúsculas de minúsculas**
nas colunas de texto de nível superior da tabela. Não é uma busca full-text: ela
não acessa o interior de colunas JSON ou de array, não realiza stemização nem classificação por relevância (ranking) e não
pode usar um índice.

Uma tabela pode habilitar busca full-text real declarando um
bloco `search`, o que também permite classificar os resultados por `_score`. Consulte
[Busca](/docs/backend/search).

## Busca vetorial

Para tabelas com uma coluna `col.vector()`, ordene as linhas por similaridade em relação a um
embedding de consulta. As linhas retornam da mais próxima para a mais distante, cada uma contendo um `_distance`. A
distância define a ordenação: um `orderBy` na mesma consulta é ignorado. Sem um
`limit`, uma busca vetorial retorna 10 linhas, em vez das 50 de uma listagem.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

O `where` na mesma consulta atua como um filtro sobre quais linhas são candidatas — isso
retorna as linhas mais próximas que também correspondem ao filtro, e não as linhas mais próximas filtradas
depois. No índice HNSW, isso é válido a partir do pgvector 0.8.0 (consulte
[Filters on an approximate index](/docs/backend/vector-search/#filters-on-an-approximate-index));
em versões mais antigas do pgvector, um filtro pelo qual poucas das linhas mais próximas passam retorna uma página
curta. Gerar o `queryVector` é sua responsabilidade: o Rebase armazena e pesquisa
embeddings, ele não os calcula.

O SDK envia uma
busca vetorial como `POST /api/data/<table>/query`, com o embedding no
corpo da requisição: na URL, 768 dimensões ocupam cerca de 17 KB, ultrapassando o que o Node (16 KB) e a maioria
dos proxies (nginx: 8 KB) aceitam. O `count()` com uma busca vetorial segue o mesmo caminho,
como `POST /api/data/<table>/count`. Em um servidor anterior à versão 0.24, que
não possui essa rota, ambos recorrem ao `GET` — e, nesse caso, um embedding longo
ainda pode ser recusado com erro 431 ou 414.

Com um `threshold`,
o resultado não possui `meta.total` — contar as linhas dentro de uma distância exige calcular isso
para cada linha da tabela. Faça a paginação com `meta.hasMore`, que permanece exato.

### O que você precisa fornecer

- **pgvector.** Uma propriedade `vector` é compilada para uma coluna `VECTOR(n)`, e esse
  tipo vem da extensão `vector`. O Rebase irá instalá-la para você, mas
  apenas onde você autorizar:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Essa linha é uma permissão, não uma solicitação — o Rebase executa
  `CREATE EXTENSION IF NOT EXISTS vector` somente quando algo no seu esquema
  precisa dela. Ela é opcional (opt-in) porque instalar uma extensão depende de fatores
  que o Rebase não pode verificar de dentro da conexão: a imagem precisa fornecer a
  biblioteca (a imagem `pgvector/pgvector:pg18` do scaffold fornece, uma `postgres:18` padrão
  não), a role precisa ter permissão para instalá-la e um provedor gerenciado
  precisa tê-la em sua lista de permissões.

  Se nada for especificado, o Rebase não instala nada — em vez disso, instale manualmente uma vez.
  De qualquer forma, a coluna é criada, e o Postgres a rejeita com
  `type "vector" does not exist` em um banco de dados que não possua nenhum dos dois, indicando
  ambas as soluções.

A coluna, seu índice ANN e esse `CREATE EXTENSION` são gerados em
`.rebase/sql/vector.sql`, ao lado de `schema.sql` e `policies.sql`, e o comando `rebase db
push` os aplica para você. Eles têm um arquivo próprio porque o Atlas — o
mecanismo por trás do `db push` — calcula seu diff materializando `schema.sql` em um
banco de dados temporário que é limpo no início de cada execução; portanto, um `VECTOR(n)` ali
seria resolvido em um banco de dados que nunca poderia ter o pgvector.

O comando `rebase db generate` anexa esse arquivo à migração gerada, de modo que uma
migração reproduzida em um banco de dados novo também cria a coluna. Uma alteração isolada
na propriedade de vetor não gera nenhuma migração, porque o esquema comparado pelo Atlas
permanece inalterado — o `db generate` informa isso quando ocorre.

### O índice

Cada coluna vetorial recebe um índice HNSW para distância de cosseno, criado junto com
a tabela e informado na inicialização. Cosseno porque é isso que o `vectorSearch` utiliza
como métrica, a menos que você informe `distance` — um índice atende a exatamente um operador, portanto uma
consulta `l2` contra um índice de cosseno silenciosamente volta a realizar uma varredura completa.

Ajuste-o ou desative-o na propriedade:

```ts
embedding: {
    type: "vector",
    dimensions: 1536,
    // Defaults: one HNSW index, cosine. Any of these may be omitted.
    index: {
        method: "hnsw",              // or "ivfflat"
        distance: ["cosine", "l2"],  // one index each
        m: 24,                       // hnsw
        efConstruction: 128          // hnsw
    }
}
```

`index: false` mantém intencionalmente a varredura exata. Acima de 2000 dimensões, o pgvector
não consegue criar nenhum dos tipos de índice; portanto, a coluna é criada e deixada sem índice, e
a inicialização informa isso — o `vectorSearch` ainda responde, operando como uma varredura exata.

`vectorSearch` é uma consulta, não uma assinatura (subscription): usar `.listen()` nele é recusado
em vez de ser atendido como uma listagem comum, pois nada recalcula as distâncias durante uma
escrita.

## Próximos passos

- [Consultando dados](/docs/sdk/querying/) — o construtor de consultas sobre o qual esses recursos funcionam
- [Busca](/docs/backend/search/) — como a busca full-text e vetorial são configuradas no backend
- [API REST](/docs/backend/api/) — as mesmas consultas via HTTP
