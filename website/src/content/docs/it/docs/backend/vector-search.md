---
sourceHash: 03e1d41a65491026
title: Ricerca vettoriale
sidebar_label: Ricerca vettoriale
description: Ricerca del vicino più prossimo su una proprietà vector tramite l'API REST — i parametri di query, le soglie, gli embedding troppo lunghi per un URL e come si comportano i filtri su un indice HNSW.
---

Se una collection definisce una proprietà di tipo `vector`, puoi eseguire ricerche di similarità ad alta velocità con le operazioni di distanza di pgvector compilate direttamente nella query del database.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Parametri di query

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `vector_search` | `string` | Il nome della proprietà vector su cui eseguire la query. |
| `vector` | `string` | Un array di float serializzato in JSON che rappresenta il vettore della query. |
| `vector_distance` | `string` | La metrica di distanza da valutare. Valori supportati: `cosine` (predefinito, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Soglia massima di distanza. Vengono restituiti solo i record con distanza inferiore a questa soglia. |

Una ricerca vettoriale con una
`vector_threshold` non ha `meta.total`: contare le righe entro una distanza significa
calcolare quella distanza per ogni riga della tabella, cosa che nessun indice serve — diverse
volte il costo della pagina stessa, in crescita con righe × dimensioni. `meta.hasMore` è
esatto, ottenuto leggendo una riga oltre la pagina. Senza una soglia il conteggio è
quello ordinario.

Un embedding è lungo in un URL: 768 dimensioni sono circa 17 KB di query string e
1.536 circa 33 KB. Il server accetta fino a 64 KB di request line e header
(prima 16 KB, un 431
da 768 dimensioni in su), e un proxy davanti ad esso di solito ne accetta meno — il valore
predefinito di nginx è 8 KB. Invia invece una ricerca vettoriale come [`POST …/query`](#query-troppo-lunghe-per-un-url);
l'SDK lo fa sempre.

## Filtri su un indice approssimato

Una ricerca vettoriale che
filtra anche — un `where`, una ricerca, la row-level security — restituisce le righe più vicine
che corrispondono. Un indice HNSW risponde con un numero fisso di candidati più vicini
(`hnsw.ef_search`, 40 per impostazione predefinita), e le altre condizioni vengono applicate a quelli;
quando ne corrispondono pochi, la pagina tornava corta o vuota benché molte righe
corrispondessero, e le pagine con offset saltavano righe. Con pgvector 0.8.0 o successivo la lettura attiva
la scansione iterativa dell'indice di pgvector (`hnsw.iterative_scan = strict_order`, solo per la
transazione di quella lettura), che continua a scansionare finché la pagina non è piena, fino a
`hnsw.max_scan_tuples` (20.000 per impostazione predefinita) — un filtro che non corrisponde quasi a nulla
vicino al vettore della query può comunque restituire una pagina corta. Su un pgvector più vecchio, e su
un indice IVFFlat, una ricerca vettoriale filtrata mantiene il comportamento della pagina corta; una scansione
esatta (`index: false`) non l'ha mai avuto.

## Query troppo lunghe per un URL

`POST /api/data/:slug/query`
è l'elenco che `GET /api/data/:slug` restituisce, con i parametri di query in un body JSON
invece che nell'URL. Usalo quando l'URL non ci starebbe — l'embedding di una ricerca vettoriale,
un filtro su una lunga lista `in`. L'SDK invia ogni ricerca vettoriale in questo modo,
e qualsiasi altra query il cui URL supererebbe 6 KB.

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

Le chiavi del body sono i parametri di query, e il server li rilegge negli
stessi parametri che legge il `GET`, tramite lo stesso parser — stessi filtri,
pagina, conteggio, cursore e include, stessa row-level security, stessi errori. Un valore è
scritto come lo scrive l'URL: una stringa (o un numero o un booleano), e per un filtro
ripetuto nell'URL una lista (`"views": ["gte.10", "lte.99"]`). `where`, `include`,
`orderBy` e `vector` accettano il loro valore JSON stesso o quel JSON come stringa. Una
lista per un parametro che l'URL legge una sola volta, un oggetto in qualsiasi altro punto, o un parametro
messo anche nell'URL è un 400 `INVALID_QUERY_BODY`.

Legge soltanto, quindi una chiave API richiede `data:read` per esso, non `data:write`, e
conta contro lo stesso rate limit del `GET`. Anche gli elenchi annidati lo hanno:
`POST /api/data/authors/42/posts/query`. Un server precedente alla 0.24 risponde 404;
l'SDK invia allora il `GET`.

Il conteggio ha lo
stesso gemello: `POST /api/data/:slug/count` (e `POST /api/data/authors/42/posts/count`)
è `GET /api/data/:slug/count` con i suoi parametri nel body, letti allo stesso modo
e rifiutati allo stesso modo. Un conteggio porta i filtri del `find()` che descrive,
quindi il suo URL è altrettanto lungo. Il `count()` dell'SDK segue la regola di `find()` — ogni
ricerca vettoriale, e qualsiasi conteggio il cui URL supererebbe 6 KB — e ripiega sul
`GET` con un server più vecchio.

## Correlati

- [API REST](/docs/backend/api/) — ogni altro parametro che accetta un elenco
- [Aggregazioni e ricerca](/docs/sdk/aggregates-and-search/#vector-search) — `.vectorSearch()` dall'SDK, e l'indice che ottiene una proprietà vector
