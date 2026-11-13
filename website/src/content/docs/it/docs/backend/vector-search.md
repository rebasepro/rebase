---
sourceHash: 889a7fb508265011
title: Ricerca vettoriale
sidebar_label: Ricerca vettoriale
description: Ricerca dei vicini più prossimi su una colonna col.vector() tramite API REST — i parametri di query, le soglie, gli embedding troppo lunghi per un URL e il comportamento dei filtri su un indice HNSW.
---

<span class="since-badge" data-since="0.31">Da 0.31</span>

Una tabella con una colonna `col.vector()` può essere interrogata per similarità: le righe più vicine a un vettore di query, in base a una distanza pgvector calcolata nella query del database.

```bash
GET /api/data/products?vector_search=embedding&vector=[0.15,0.22,-0.05]&vector_distance=cosine&vector_threshold=0.8
```

## Dichiarazione della colonna

<span class="since-badge" data-since="0.31">Da 0.31</span>

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

`col.vector({ dimensions })` è una colonna pgvector `vector(dimensions)`, letta e scritta come `number[]`. Riceve un indice approximate-nearest-neighbour a meno che `index` non indichi diversamente:

| Opzione `index` | Predefinito | Descrizione |
|---|---|---|
| `method` | `"hnsw"` | `"hnsw"` o `"ivfflat"`. |
| `metric` | `"cosine"` | `"cosine"`, `"l2"` o `"ip"` (prodotto scalare), oppure una lista: viene creato un indice per ciascuna metrica. |
| `m` | Quello di pgvector | HNSW: connessioni per livello. |
| `efConstruction` | Quello di pgvector | HNSW: dimensione della lista dei candidati durante la creazione. |
| `lists` | Quello di pgvector | IVFFlat: numero di liste. |

`index: false` non crea alcun indice, quindi ogni ricerca vettoriale è una scansione esatta. Anche una ricerca basata su una distanza priva di un proprio indice è una scansione esatta, perciò indicizza ogni metrica utilizzata nelle query. Il parametro di query indica il prodotto scalare come `inner_product`; l'opzione della colonna lo indica come `ip`.


## Parametri di query

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `vector_search` | `string` | La chiave della colonna vettoriale su cui eseguire la query. |
| `vector` | `string` | Un array di float serializzato in JSON che rappresenta il vettore di query. |
| `vector_distance` | `string` | La metrica di distanza da valutare. Valori supportati: `cosine` (predefinito, `<=>`), `l2` (`<->`), `inner_product` (`<#>`). |
| `vector_threshold` | `number` | Soglia massima di distanza. Vengono restituiti solo i record con distanza inferiore a questa soglia. |

Una ricerca vettoriale con un `vector_threshold` non ha `meta.total`: contare le righe entro una certa distanza comporta il calcolo di tale distanza per ogni riga della tabella, operazione non supportata da alcun indice — con un costo pari a diverse volte quello della pagina stessa, che cresce con righe × dimensioni. `meta.hasMore` è esatto, ricavato leggendo una riga oltre la pagina. Senza una soglia, il conteggio è quello ordinario.

Un embedding è lungo in un URL: 768 dimensioni corrispondono a circa 17 KB di query string e 1.536 a circa 33 KB. Il server accetta fino a 64 KB di riga di richiesta e header (in precedenza 16 KB, con un errore 431 a partire da 768 dimensioni in su), e un proxy intermedio solitamente ne accetta meno — il valore predefinito di nginx è 8 KB. Invia invece una ricerca vettoriale come [`POST …/query`](#query-troppo-lunghe-per-un-url); l'SDK lo fa sempre.

## Filtri su un indice approssimato

Una ricerca vettoriale che applica anche filtri — un `where`, una ricerca, la row-level security — restituisce le righe più vicine corrispondenti. Un indice HNSW risponde con un numero fisso di candidati più vicini (`hnsw.ef_search`, 40 per impostazione predefinita), e le altre condizioni vengono applicate a questi ultimi; quando pochi di essi corrispondono, la pagina restituita risultava incompleta o vuota anche se molte righe soddisfacevano i criteri, e la paginazione con offset saltava delle righe. Con pgvector 0.8.0 o versioni successive, la lettura attiva la scansione iterativa dell'indice di pgvector (`hnsw.iterative_scan = strict_order`, solo per la transazione di quella lettura), che continua la scansione finché la pagina non è piena, fino a `hnsw.max_scan_tuples` (20.000 per impostazione predefinita) — un filtro che non trova quasi corrispondenze vicino al vettore di query può comunque restituire una pagina incompleta. Nelle versioni precedenti di pgvector e su un indice IVFFlat, una ricerca vettoriale filtrata mantiene il comportamento della pagina incompleta; una scansione esatta (`index: false`) non ha mai avuto questo problema.

## Query troppo lunghe per un URL

`POST /api/data/:slug/query` è l'elenco restituito da `GET /api/data/:slug`, con i parametri di query in un corpo JSON anziché nell'URL. Utilizzalo quando l'URL risulterebbe troppo lungo — l'embedding di una ricerca vettoriale, un filtro su una lunga lista `in`. L'SDK invia ogni ricerca vettoriale in questo modo, così come qualsiasi altra query il cui URL supererebbe i 6 KB.

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

Le chiavi del body sono i parametri di query, e il server le interpreta esattamente come i parametri letti dalla `GET`, tramite lo stesso parser — stessi filtri, pagina, conteggio, cursore e inclusioni, stessa row-level security, stessi errori. Un valore viene indicato nello stesso modo dell'URL: una stringa (o un numero o un booleano) e, per un filtro ripetuto nell'URL, una lista (`"views": ["gte.10", "lte.99"]`). `where`, `include`, `orderBy` e `vector` accettano il rispettivo valore JSON direttamente o tale JSON sotto forma di stringa. Una lista per un parametro che l'URL legge una sola volta, un oggetto in qualsiasi altro punto, oppure un parametro specificato anche nell'URL restituisce un 400 `INVALID_QUERY_BODY`.

Esegue solo letture, quindi una chiave API necessita del permesso `data:read` e non di `data:write`, e viene conteggiata rispetto allo stesso rate limit della `GET`. Anche gli elenchi nidificati lo supportano: `POST /api/data/authors/42/posts/query`. Un server precedente alla versione 0.24 risponde con 404; l'SDK invia quindi la `GET`.

Il conteggio ha la stessa controparte: `POST /api/data/:slug/count` (e `POST /api/data/authors/42/posts/count`) corrisponde a `GET /api/data/:slug/count` con i relativi parametri nel body, letti e rifiutati nello stesso modo. Un conteggio include i filtri del `find()` che descrive, quindi il suo URL è altrettanto lungo. Il metodo `count()` dell'SDK segue la stessa regola di `find()` — ogni ricerca vettoriale e qualsiasi conteggio il cui URL supererebbe i 6 KB — e ricorre alla `GET` in presenza di un server precedente.

## Correlati

- [REST API](/docs/backend/api/) — tutti gli altri parametri supportati da un elenco
- [Aggregazioni e ricerca](/docs/sdk/aggregates-and-search/#vector-search) — `.vectorSearch()` dall'SDK
