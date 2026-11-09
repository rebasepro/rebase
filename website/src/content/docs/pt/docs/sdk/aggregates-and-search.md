---
sourceHash: 3cf0b5bcc258e52f
title: Agregações e busca
sidebar_label: Agregações e busca
description: "Conte, some e agrupe com o SDK, filtre dentro de colunas JSON e execute busca de texto completo e vetorial a partir do cliente."
---

## Agregações

`count`, `sum`, `avg`, `min`, `max` e as funções abaixo sobre as linhas selecionadas por
um filtro, sem buscá-las:

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

Os resultados são indexados por função e campo — `count()` se torna `count`,
`sum(total)` se torna `sum_total`.

### Mais funções

| `select` | SDK | Chave do resultado | O que é |
|---|---|---|---|
| `countDistinct(sid)` | `{ fn: "countDistinct", field: "sid" }` | `count_distinct_sid` | Valores distintos não nulos |
| `mode(lang)` | `{ fn: "mode", field: "lang" }` | `mode_lang` | O valor mais frequente |
| `percentile(price,0.95)` | `{ fn: "percentile", field: "price", p: 0.95 }` | `p95_price` | Percentil contínuo, `p` de 0 a 1 (`0.5` é a mediana) |
| `distinct(lang)` | `{ fn: "distinct", field: "lang" }` | `distinct_lang` | Os valores distintos não nulos, ordenados, como um array |
| `fingerprint()` | `{ fn: "fingerprint" }` | `fingerprint` | Uma string que muda sempre que uma linha coberta muda |

### Agregações filtradas e nomes

Uma agregação pode contar apenas algumas das linhas: dê a ela um `where` próprio
(o `FILTER (WHERE …)` do SQL). Várias delas formam uma única consulta sobre as linhas que
o `where` externo escolheu, então um painel de oito contagens é uma única varredura. Dê um
nome a cada uma com `as`, de que duas agregações da mesma função precisam:

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

Um nome usado duas vezes, ou a chave de uma coluna de `groupBy`, é recusado
(`INVALID_AGGREGATE_SELECT`) em vez de sobrescrever um valor. Via HTTP um nome é escrito
ao estilo do PostgREST, `select=live:count()`; uma agregação com um `where` próprio vai
como um array JSON — `select=[{"fn":"count","as":"live","where":{"tags":["!=",[]]}}]`.

O `field` de uma agregação pode ser um caminho JSON, `props->>players`: `sum`, `avg` e
`percentile` leem o valor ali como número e deixam de fora o que não for, as demais o
leem como texto. Um caminho JSON também é uma entrada de `groupBy`, com a chave igual ao
caminho como foi escrito:

```ts
await client.data.events.aggregate({
    select: [{ fn: "count" }, { fn: "avg", field: "props->>players", as: "players" }],
    groupBy: ["props->>music"]
});
// [{ "props->>music": "80s", count: 412, players: 3.4 }, …]
```

### Agrupando por uma expressão

Um item de `groupBy` pode transformar a sua coluna. Via HTTP é escrito como uma
função, no SDK como `{ field, transform }`, e volta sob `<transform>_<field>` — que
também é o nome usado por `orderBy`:

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

`fingerprint()` responde "esta coleção mudou desde a última vez que olhei?" sem ler
as linhas: guarde a string, pergunte de novo depois e recalcule o que você derivou
das linhas apenas quando ela for diferente. Qualquer inserção, atualização ou
exclusão de uma linha coberta a altera; uma gravação que não muda nada (definir uma
coluna com o próprio valor) também pode alterá-la, e excluir uma linha que você
acabou de adicionar a traz de volta. Ela cobre o que o chamador pode ver e o que os
filtros selecionam, e pode ser agrupada, então `groupBy=lang` dá um fingerprint por
idioma.

```ts
let lastFingerprint: string | undefined;

async function catalogueChanged(): Promise<boolean> {
    const [{ fingerprint }] = await client.data.songs.aggregate({ select: [{ fn: "fingerprint" }] });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = String(fingerprint);
    return changed;
}
```

Ela é calculada a partir das versões de linha que o Postgres mantém, não a partir
dos valores, então custa uma varredura da tabela e não um hash de cada linha: em
30.000 linhas, 4 ms contra 56 do `md5(string_agg(...))` sobre as linhas. Não está
disponível em uma view simples, que não armazena linhas; uma view materializada tem
uma.

Grupos paginam como as linhas de uma listagem. `limit` os limita, `offset` (ou `page`)
os pula, e `orderBy` os ordena por um campo de `groupBy` ou uma chave de resultado. A
ordenação sempre termina nas chaves de grupo, para que cada limite de página fique no
mesmo lugar. Uma agregação agrupada sem `limit` é cortada no padrão de listagem (50
grupos), igual a uma listagem. Com um `limit` — incluindo o padrão —, a resposta
informa se há mais itens, e o `aggregate()` do SDK o retorna como `meta` no resultado:

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` ou `orderBy` sem um `groupBy`, ou um cursor em qualquer agregação,
resulta em um `400 INVALID_AGGREGATE_WINDOW`: uma agregação não agrupada possui uma
única linha, e um grupo não é uma linha após a qual um cursor possa continuar.

Uma agregação lê os valores armazenados e nunca executa `afterRead`. Portanto, em uma
coleção que um callback `afterRead` reescreve — seja global, de coleção ou de propriedade —,
apenas `count()` e `fingerprint()` sem `groupBy` são atendidos, tanto via HTTP quanto no processo; qualquer outra
coisa resulta em um `400 AGGREGATE_MASKED_BY_AFTER_READ`, pois uma soma, um máximo ou um
grupo leria os valores que o callback oculta.

A partir do SDK, `aggregate()` aceita o mesmo `orderBy` que um `find()` — uma tupla
`[key, "asc" | "desc"]` ou uma lista delas —, onde a chave é uma coluna de `groupBy` ou
uma chave de resultado. Ambas são tipadas: em um modelo gerado, uma chave que não seja
nenhuma das duas não compila. No processo (`rebase.data`), os grupos retornam na mesma
ordem que via HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Ele aceita os mesmos filtros que o endpoint de listagem, portanto, uma agregação pode
ser filtrada da mesma forma que uma listagem:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**A segurança em nível de linha se aplica às linhas sendo agregadas.** Uma agregação é uma
maneira eficiente de obter informações sobre linhas que você não pode ler, portanto, ela é
executada sob as próprias políticas do chamador: quem não pode selecionar nada, conta nada.
:::

Agregações precisam de um driver que as implemente. Em um que não implementa, o endpoint
responde com `501` em vez de um resultado vazio — um painel não deve receber a mensagem
"nenhuma correspondência" quando a verdade for "não suportado".

## Filtrando Dentro do JSON

Uma coluna `json` ou `jsonb` pode ser filtrada por caminho (path), usando a própria
sintaxe de seta do Postgres:

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

Os segmentos de caminho são sempre enviados como parâmetros vinculados (bound parameters),
nunca interpolados no SQL.

### Como os valores são comparados

`->>` produz **texto**, portanto, as comparações são comparações de texto — exceto que um
operador de ordenação (`>`, `>=`, `<`, `<=`) recebendo um **número** faz o cast para numérico:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Linhas cujo valor naquele caminho não seja um número são excluídas de uma comparação
numérica, em vez de falharem a consulta. Booleanos são comparados como `"true"` /
`"false"`, que é como o `->>` os renderiza.

:::note
`array-contains` e os outros operadores de coluna inteira não estão disponíveis em um
caminho — eles fazem uma pergunta sobre o documento inteiro, portanto, use-os na
própria coluna.
:::

## Busca de Texto

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

Por padrão, esta é uma **correspondência de substring que não diferencia maiúsculas de minúsculas**
entre as propriedades `string` de nível superior da coleção. Não é uma busca de texto completo
(full-text search): ela não acessa o conteúdo de propriedades `map` ou `array`, não faz stem
nem rankeamento e não pode usar índice.

Uma coleção Postgres pode optar pela busca de texto completo real declarando um bloco
`search`, o que também torna os resultados classificáveis por `_score`. Consulte
[Busca](/docs/backend/search).

## Busca Vetorial

Para coleções com uma propriedade `vector`, ordene as linhas por similaridade a um embedding
de consulta. As linhas retornam da mais próxima para a mais distante, cada uma carregando um
`_distance`. A distância é a ordenação: um `orderBy` na mesma consulta é ignorado. Sem um
`limit`, uma busca vetorial retorna 10 linhas, em vez das 50 de uma listagem.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

O `where` na mesma consulta atua como um filtro definindo quais linhas são candidatas — isso
retorna as linhas mais próximas que também correspondem, não as linhas mais próximas filtradas
depois. No índice HNSW, isso é válido a partir do pgvector 0.8.0 (consulte
[Filtros em um índice aproximado](/docs/backend/vector-search/#filters-on-an-approximate-index));
em uma versão mais antiga do pgvector, um filtro pelo qual poucas das linhas mais próximas
passam retorna uma página curta. Gerar o `queryVector` é seu trabalho: o Rebase armazena
e pesquisa embeddings, ele não os calcula.

O SDK envia uma busca vetorial como `POST /api/data/<collection>/query`, com o embedding no
corpo da requisição: na URL, 768 dimensões têm cerca de 17 KB, ultrapassando o que o Node
(16 KB) e a maioria dos proxies (nginx: 8 KB) aceitam. O `count()` com uma busca vetorial
segue o mesmo caminho, como `POST /api/data/<collection>/count`. Em um servidor anterior
ao 0.24, que não possui essa rota, ambos recorrem ao `GET` — e um embedding longo ali ainda
pode ser recusado com um erro 431 ou 414.

Com um `threshold`, o resultado não possui `meta.total` — contar as linhas dentro de uma
distância exige calcular isso para cada linha da tabela. Realize a paginação com `meta.hasMore`,
que permanece exato.

### O que você precisa fornecer

- **pgvector.** Uma propriedade `vector` compila para uma coluna `VECTOR(n)`, e esse
  tipo vem da extensão `vector`. O Rebase a instalará para você, mas apenas onde você
  autorizar:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Essa linha é uma permissão em vez de uma solicitação — o Rebase executa
  `CREATE EXTENSION IF NOT EXISTS vector` somente quando algo no seu schema precisa disso.
  É opcional (opt-in) porque instalar uma extensão depende de coisas que o Rebase não
  consegue ver a partir de dentro da conexão: a imagem precisa incluir a biblioteca (a
  `pgvector/pgvector:pg18` do scaffold inclui, uma `postgres:18` padrão não), a role precisa
  ter permissão para instalá-la e um provedor gerenciado precisa tê-la em uma allowlist.

  Não defina nada e o Rebase não instalará nada — em vez disso, instale manualmente uma vez.
  De qualquer forma, a coluna é criada, e o Postgres a rejeita com
  `type "vector" does not exist` em um banco de dados que não possui nenhum dos dois,
  apontando ambas as soluções.

A coluna, seu índice ANN e esse `CREATE EXTENSION` são gerados em `.rebase/sql/vector.sql`,
ao lado de `schema.sql` e `policies.sql`, e o comando `rebase db push` os aplica para você.
Eles têm um arquivo próprio porque o Atlas — o mecanismo por trás do `db push` — calcula seu
diff materializando o `schema.sql` em um banco de dados temporário que ele limpa no início
de cada execução, de modo que um `VECTOR(n)` ali seria resolvido contra um banco de dados
que nunca pode ter o pgvector.

O comando `rebase db generate` anexa esse arquivo à migração que ele grava, de modo que uma
migração executada novamente em um banco de dados novo também constrói a coluna. Uma alteração
apenas na propriedade vector não produz nenhuma migração, pois o schema comparado pelo Atlas
não foi alterado — o `db generate` informa isso quando acontece.

### O índice

Toda coluna vetorial recebe um índice HNSW para distância de cosseno, criado junto com a
tabela e informado na inicialização. Cosseno porque é isso que o `vectorSearch` utiliza como
métrica, a menos que você informe `distance` — um índice atende a exatamente um operador,
portanto, uma consulta `l2` contra um índice de cosseno silenciosamente volta a realizar
varredura completa (scanning).

Ajuste-o, ou desative-o, na propriedade:

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

`index: false` mantém a varredura exata propositalmente. Acima de 2000 dimensões, o pgvector
não consegue construir nenhum dos tipos de índice, então a coluna é criada e deixada sem
índice, e a inicialização avisa sobre isso — o `vectorSearch` ainda responde, como uma varredura
exata.

`vectorSearch` é uma consulta, não uma assinatura: invocar `.listen()` em uma delas é recusado
em vez de ser atendido como uma listagem comum, porque nada recalcula as distâncias em uma
escrita.

## Próximos Passos

- [Consultando Dados](/docs/sdk/querying/) — o construtor de consultas sobre o qual tudo isso é executado
- [Busca](/docs/backend/search/) — como a busca vetorial e de texto completo são configuradas no backend
- [API REST](/docs/backend/api/) — as mesmas consultas via HTTP
