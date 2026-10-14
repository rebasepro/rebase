---
sourceHash: 03e1d41a65491026
title: Busca vetorial
sidebar_label: Busca vetorial
description: Busca de vizinhos mais próximos sobre uma propriedade vetorial pela API REST — os parâmetros de consulta, limiares, embeddings longos demais para uma URL e como os filtros se comportam em um índice HNSW.
---

Se uma coleção define uma propriedade do tipo `vector`, você pode realizar buscas de similaridade de alta velocidade usando operações de distância do pgvector compiladas diretamente na consulta ao banco de dados.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Parâmetros de consulta

| Parâmetro | Tipo | Descrição |
|-----------|------|-----------|
| `vector_search` | `string` | O nome da propriedade vetorial a consultar. |
| `vector` | `string` | Um array de floats serializado em JSON que representa o vetor da consulta. |
| `vector_distance` | `string` | A métrica de distância a avaliar. Valores aceitos: `cosine` (padrão, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Limiar máximo de distância. Apenas registros com distância menor que esse limiar são retornados. |

Uma busca vetorial com um
`vector_threshold` não tem `meta.total`: contar as linhas dentro de uma distância significa
calcular essa distância para cada linha da tabela, o que nenhum índice atende — várias
vezes o custo da própria página, crescendo com linhas × dimensões. `meta.hasMore` é
exato, a partir da leitura de uma linha além da página. Sem um limiar, a contagem é a
comum.

Um embedding é longo em uma URL: 768 dimensões são cerca de 17 KB de query string e
1.536 cerca de 33 KB. O servidor aceita até 64 KB de linha de requisição e cabeçalhos
(antes eram 16 KB, um 431
a partir de 768 dimensões), e um proxy na frente dele costuma aceitar menos — o padrão do nginx
é 8 KB. Envie uma busca vetorial como [`POST …/query`](#consultas-longas-demais-para-uma-url)
em vez disso; o SDK sempre faz isso.

## Filtros em um índice aproximado

Uma busca vetorial que
também filtra — um `where`, uma busca, row-level security — retorna as linhas mais próximas
que correspondem. Um índice HNSW responde com um número fixo de candidatos mais próximos
(`hnsw.ef_search`, 40 por padrão), e as outras condições são aplicadas a eles;
quando poucos correspondem, a página voltava curta ou vazia embora muitas linhas
correspondessem, e as páginas por offset pulavam linhas. Com pgvector 0.8.0 ou posterior, a leitura liga
a varredura iterativa de índice do pgvector (`hnsw.iterative_scan = strict_order`, somente para a
transação dessa leitura), que continua varrendo até a página ficar cheia, até
`hnsw.max_scan_tuples` (20.000 por padrão) — um filtro que quase nada corresponde
perto do vetor da consulta ainda pode retornar uma página curta. Em um pgvector mais antigo, e em
um índice IVFFlat, uma busca vetorial filtrada mantém o comportamento de página curta; uma varredura
exata (`index: false`) nunca o teve.

## Consultas longas demais para uma URL

`POST /api/data/:slug/query`
é a listagem que `GET /api/data/:slug` responde, com os parâmetros de consulta em um corpo
JSON em vez da URL. Use-o quando a URL não couber — o embedding de uma busca vetorial,
um filtro com uma lista `in` longa. O SDK envia toda busca vetorial dessa forma,
e qualquer outra consulta cuja URL passaria de 6 KB.

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

As chaves do corpo são os parâmetros de consulta, e o servidor as lê de volta
exatamente nos parâmetros que o `GET` lê, pelo mesmo parser — mesmos filtros,
página, contagem, cursor e includes, mesma row-level security, mesmos erros. Um valor é
escrito como a URL o escreve: uma string (ou um número ou booleano), e para um filtro
repetido na URL uma lista (`"views": ["gte.10", "lte.99"]`). `where`, `include`,
`orderBy` e `vector` aceitam o próprio valor JSON ou esse JSON como string. Uma
lista para um parâmetro que a URL lê uma vez, um objeto em qualquer outro lugar, ou um parâmetro
colocado também na URL é um 400 `INVALID_QUERY_BODY`.

Ele apenas lê, então uma chave de API precisa de `data:read` para ele, não de `data:write`, e
conta no mesmo limite de taxa que o `GET`. As listagens aninhadas também o têm:
`POST /api/data/authors/42/posts/query`. Um servidor anterior à 0.24 o responde com 404;
o SDK então envia o `GET`.

A contagem tem o
mesmo gêmeo: `POST /api/data/:slug/count` (e `POST /api/data/authors/42/posts/count`)
é `GET /api/data/:slug/count` com seus parâmetros no corpo, lido da mesma forma
e recusado da mesma forma. Uma contagem carrega os filtros do `find()` que ela descreve,
então sua URL é igualmente longa. O `count()` do SDK segue a regra do `find()` — toda
busca vetorial, e qualquer contagem cuja URL passaria de 6 KB — e recorre ao
`GET` contra um servidor mais antigo.

## Relacionado

- [API REST](/docs/backend/api/) — todos os outros parâmetros que uma listagem aceita
- [Agregações e busca](/docs/sdk/aggregates-and-search/#vector-search) — `.vectorSearch()` pelo SDK, e o índice que uma propriedade vetorial recebe
