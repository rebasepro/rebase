---
sourceHash: 889a7fb508265011
title: Busca Vetorial
sidebar_label: Busca Vetorial
description: Busca pelo vizinho mais próximo em uma coluna col.vector() por meio da API REST — os parâmetros de consulta, limites, embeddings longos demais para uma URL e como os filtros se comportam em um índice HNSW.
---

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Uma tabela com uma coluna `col.vector()` pode ser consultada por similaridade: as
linhas mais próximas de um vetor de consulta, por uma distância pgvector calculada na consulta ao banco de dados.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Declarando a coluna

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        name:      col.text().notNull(),
        embedding: col.vector({ dimensions: 1536, index: { method: "hnsw", metric: ["cosine", "l2"] } }),
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

`col.vector({ dimensions })` é uma coluna `vector(dimensions)` do pgvector, lida e
gravada como um `number[]`. Ela recebe um índice de vizinhos mais próximos aproximados (approximate-nearest-neighbour), a menos que
`index` especifique o contrário:

| Opção de `index` | Padrão | O que faz |
|---|---|---|
| `method` | `"hnsw"` | `"hnsw"` ou `"ivfflat"`. |
| `metric` | `"cosine"` | `"cosine"`, `"l2"` ou `"ip"` (produto interno), ou uma lista: um índice é criado por métrica. |
| `m` | Padrão do pgvector | HNSW: conexões por camada. |
| `efConstruction` | Padrão do pgvector | HNSW: tamanho da lista de candidatos durante a construção. |
| `lists` | Padrão do pgvector | IVFFlat: número de listas. |

`index: false` não cria nenhum índice, portanto, cada busca vetorial é uma varredura exata. Uma
busca por uma distância que não possui um índice próprio também é uma varredura exata; portanto,
indexe cada métrica com a qual você faz consultas. O parâmetro de consulta especifica o produto interno
como `inner_product`; a opção da coluna o especifica como `ip`.


## Parâmetros de consulta

| Parâmetro | Tipo | Descrição |
|-----------|------|-------------|
| `vector_search` | `string` | A chave da coluna vetorial a ser consultada. |
| `vector` | `string` | Um array de floats serializado em JSON representando o vetor de consulta. |
| `vector_distance` | `string` | A métrica de distância a ser avaliada. Valores suportados: `cosine` (padrão, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Limiar de distância máxima. Apenas registros com distância menor que este limiar são retornados. |

Uma busca vetorial com um
`vector_threshold` não possui `meta.total`: contar as linhas dentro de uma distância significa
calcular essa distância para cada linha da tabela, o que nenhum índice suporta — várias
vezes o custo da própria página, crescendo com linhas × dimensões. `meta.hasMore` é
exato, obtido pela leitura de uma linha além da página. Sem um limiar, a contagem é a
padrão.

Um embedding é longo em uma URL: 768 dimensões representam cerca de 17 KB de query string e
1.536 cerca de 33 KB. O servidor aceita até 64 KB de linha de requisição e cabeçalhos
(16 KB anteriormente, gerando um erro 431
a partir de 768 dimensões), e um proxy à frente dele normalmente aceita menos — o padrão do
nginx é 8 KB. Em vez disso, envie uma busca vetorial como [`POST …/query`](#consultas-longas-demais-para-uma-url);
o SDK sempre faz dessa forma.

## Filtros em um índice aproximado

Uma busca vetorial que
também aplica filtros — um `where`, uma busca, segurança em nível de linha (row-level security) — retorna as linhas mais próximas
que correspondem aos critérios. Um índice HNSW responde com um número fixo de candidatos mais próximos
(`hnsw.ef_search`, 40 por padrão), e as outras condições são aplicadas a eles;
quando poucos deles correspondem, a página retornava incompleta ou vazia, mesmo que muitas linhas
fossem compatíveis, e páginas com deslocamento (offset) pulavam linhas. Com o pgvector 0.8.0 ou posterior, a leitura ativa
a varredura iterativa de índice do pgvector (`hnsw.iterative_scan = strict_order`, apenas para a transação dessa leitura),
que continua a varredura até que a página esteja cheia, até `hnsw.max_scan_tuples` (20.000 por padrão) — um
filtro que quase não encontre correspondências perto do vetor de consulta ainda pode retornar uma página incompleta. Em uma versão mais antiga do pgvector e em
um índice IVFFlat, uma busca vetorial filtrada mantém o comportamento de página incompleta; uma varredura
exata (`index: false`) nunca teve esse comportamento.

## Consultas longas demais para uma URL

`POST /api/data/:slug/query`
é a listagem que o `GET /api/data/:slug` responde, com os parâmetros de consulta em um
corpo JSON em vez da URL. Use-o quando a URL não couber — o embedding de uma busca
vetorial, um filtro em uma longa lista `in`. O SDK envia todas as buscas vetoriais dessa forma,
assim como qualquer outra consulta cuja URL ultrapasse 6 KB.

```bash
POST /api/data/docs/query
Content-Type: application/json

{
  "vector_search": "embedding",
  "vector": [0.15, 0.22, -0.05],
  "vector_threshold": 0.8,
  "where": { "status": ["==", "published"] },
  "limit": 10
}
```

As chaves do corpo são os parâmetros de consulta, e o servidor as interpreta de volta
exatamente nos parâmetros lidos pelo `GET`, através do mesmo analisador — mesmos filtros,
página, contagem, cursor e includes, mesma segurança em nível de linha, mesmos erros. Um valor é
especificado da mesma forma que na URL: uma string (ou um número ou booleano) e, para um filtro
repetido na URL, uma lista (`"views": ["gte.10", "lte.99"]`). `where`, `include`,
`orderBy` e `vector` aceitam o próprio valor JSON ou esse JSON como uma string. Uma
lista para um parâmetro que a URL lê apenas uma vez, um objeto em qualquer outro lugar, ou um parâmetro
também inserido na URL resulta em um erro 400 `INVALID_QUERY_BODY`.

Ele realiza apenas leituras, portanto, uma chave de API precisa de `data:read` para ele, não `data:write`, e ele
conta para o mesmo limite de taxa (rate limit) que o `GET`. Listagens aninhadas também contam com esse suporte:
`POST /api/data/authors/42/posts/query`. Um servidor anterior à versão 0.24 responderá com 404;
o SDK então enviará o `GET`.

A contagem tem o
mesmo equivalente: `POST /api/data/:slug/count` (e `POST /api/data/authors/42/posts/count`)
é `GET /api/data/:slug/count` com seus parâmetros no corpo, lidos da mesma maneira
e recusados da mesma maneira. Uma contagem carrega os filtros do `find()` que ela descreve,
portanto, sua URL é tão longa quanto. O `count()` do SDK segue a mesma regra do `find()` — toda
busca vetorial e qualquer contagem cuja URL ultrapassaria 6 KB — e recorre ao
`GET` caso seja um servidor mais antigo.

## Relacionados

- [REST API](/docs/backend/api/) — todos os outros parâmetros que uma listagem aceita
- [Agregações e busca](/docs/sdk/aggregates-and-search/#vector-search) — `.vectorSearch()` do SDK
