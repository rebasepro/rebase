---
sourceHash: 598d10fdd9ac95db
title: Aggregazioni e ricerca
sidebar_label: Aggregazioni e ricerca
description: "Esegui conteggi, somme e raggruppamenti con l'SDK, filtra all'interno delle colonne JSON ed esegui ricerche full-text e vettoriali dal client."
---

## Aggregazioni

`count`, `sum`, `avg`, `min`, `max` e le funzioni seguenti sulle righe selezionate da un
filtro, senza recuperarle:

```bash
GET /api/data/orders/aggregate?select=count(),sum(total)
```

```json
{ "data": [{ "count": 128, "sum_total": 40522 }] }
```

Raggruppa per ottenere una riga per valore:

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

I risultati sono indicizzati per funzione e campo: `count()` diventa `count`,
`sum(total)` diventa `sum_total`.

### Altre funzioni

| `select` | SDK | Chiave del risultato | Descrizione |
|---|---|---|---|
| `countDistinct(sid)` | `{ fn: "countDistinct", field: "sid" }` | `count_distinct_sid` | Valori non nulli distinti |
| `mode(lang)` | `{ fn: "mode", field: "lang" }` | `mode_lang` | Il valore più frequente |
| `percentile(price,0.95)` | `{ fn: "percentile", field: "price", p: 0.95 }` | `p95_price` | Percentile continuo, `p` da 0 a 1 (`0.5` è la mediana) |
| `distinct(lang)` | `{ fn: "distinct", field: "lang" }` | `distinct_lang` | I valori non nulli distinti, ordinati, come array |
| `fingerprint()` | `{ fn: "fingerprint" }` | `fingerprint` | Una stringa che cambia ogni volta che cambia una riga inclusa |

### Aggregazioni filtrate e nomi

Un'aggregazione può conteggiare solo alcune delle righe: assegnale una propria
clausola `where` (il `FILTER (WHERE …)` di SQL). Più aggregazioni costituiscono
un'unica query sulle righe scelte dalla clausola `where` esterna, quindi una
dashboard con otto conteggi corrisponde a una sola scansione. Assegna a ciascuna
un nome con `as`, necessario nel caso di due aggregazioni con la stessa funzione:

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

Un nome usato due volte, o la chiave di una colonna `groupBy`, viene rifiutato
(`INVALID_AGGREGATE_SELECT`) anziché sovrascrivere un valore. Tramite HTTP, un nome
viene scritto secondo lo stile di PostgREST, `select=live:count()`; un'aggregazione con una
propria clausola `where` viene passata come array JSON: `select=[{"fn":"count","as":"live","where":{"tags":["!=",[]]}}]`.

Il `field` di un'aggregazione può essere un percorso JSON, `props->>players`: `sum`, `avg` e
`percentile` leggono il valore corrispondente come numero ed escludono quelli che non lo sono,
mentre le altre funzioni lo leggono come testo. Un percorso JSON può essere anche una voce di
`groupBy`, indicizzata con il percorso così come scritto:

```ts
await client.data.events.aggregate({
    select: [{ fn: "count" }, { fn: "avg", field: "props->>players", as: "players" }],
    groupBy: ["props->>music"]
});
// [{ "props->>music": "80s", count: 412, players: 3.4 }, …]
```

### Raggruppamento per espressione

Una voce di `groupBy` può trasformare la propria colonna. Tramite HTTP viene scritta come una
funzione, nell'SDK come `{ field, transform }`, e viene restituita sotto
`<transform>_<field>`, che è anche il nome utilizzato da `orderBy`:

| Trasformazione | Raggruppa per |
|---|---|
| `lower(name)`, `upper(name)` | La colonna come testo in minuscolo o maiuscolo |
| `year(createdAt)`, `month(createdAt)`, `day(createdAt)` | La data, in UTC, come `2026`, `2026-11`, `2026-11-08` — oppure in un fuso orario: `day(createdAt,Europe/Madrid)`, `{ field, transform: "day", timeZone: "Europe/Madrid" }` |
| `unnest(tags)` | Ogni elemento di una colonna array: un gruppo per elemento |

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

### È cambiato qualcosa? `fingerprint()`

`fingerprint()` risponde alla domanda "questa tabella è cambiata dall'ultima volta che ho controllato?"
senza leggere le righe: conserva la stringa, richiedila più tardi e ricalcola
ciò che hai ricavato dalle righe solo quando differisce. Qualsiasi operazione di insert, update o
delete di una riga coperta la modifica; anche una scrittura che non cambia nulla (impostando una
colonna sul suo stesso valore) potrebbe modificarla, ed eliminare una riga appena aggiunta
la ripristina. Copre ciò che il chiamante può vedere e ciò che i filtri selezionano,
e può essere raggruppata, quindi `groupBy=lang` restituisce un fingerprint per lingua.

```ts
let lastFingerprint: string | undefined;

async function catalogueChanged(): Promise<boolean> {
    const [{ fingerprint }] = await client.data.songs.aggregate({ select: [{ fn: "fingerprint" }] });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = String(fingerprint);
    return changed;
}
```

Viene calcolata a partire dalle versioni delle righe conservate da Postgres, non dai valori, quindi
costa una scansione della tabella e non l'hashing di ogni singola riga: su 30.000 righe, richiede 4 ms
dove `md5(string_agg(...))` sulle righe ne impiega 56. Non è disponibile su una
vista standard, che non memorizza righe; una vista materializzata ne ha una.

I gruppi supportano la paginazione come le righe di un elenco. `limit` ne limita il numero, `offset` (o `page`)
li salta, e `orderBy` li ordina in base a un campo di `groupBy` o a una chiave del risultato. L'ordinamento
termina sempre con le chiavi del gruppo, in modo che ogni confine di pagina cada nello stesso
punto. Un'aggregazione raggruppata senza `limit` viene limitata al valore predefinito dell'elenco (50
gruppi), esattamente come una lista. Con un `limit` — compreso quello predefinito — la
risposta indica se ce ne sono altri, e il metodo `aggregate()` dell'SDK lo restituisce
come `meta` nel risultato:

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` o `orderBy` senza un `groupBy`, oppure un cursore su qualsiasi aggregazione,
restituisce un errore `400 INVALID_AGGREGATE_WINDOW`: un'aggregazione non raggruppata ha una sola riga, e un
gruppo non è una riga dopo la quale un cursore può proseguire.

Un'aggregazione legge i valori memorizzati e non esegue mai `afterRead`. Di conseguenza, su una
tabella che un hook `afterRead` riscrive — globale, specifico della tabella o `.transform()` di una colonna —
vengono serviti solo `count()` e `fingerprint()` senza `groupBy`, sia tramite HTTP che in-process;
qualsiasi altra operazione restituisce `400 AGGREGATE_MASKED_BY_AFTER_READ`, poiché una somma, un
massimo o un raggruppamento leggerebbero i valori nascosti dall'hook.

Dall'SDK, `aggregate()` accetta lo stesso `orderBy` di `find()` — una
tupla `[key, "asc" | "desc"]` o un elenco di tuple — dove la chiave è una colonna di `groupBy`
o una chiave del risultato. Entrambe sono tipizzate: su un modello generato, una chiave che non
corrisponde a nessuna delle due non compila. In-process (`rebase.data`), i gruppi vengono restituiti
nello stesso ordine che tramite HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Accetta gli stessi filtri dell'endpoint di elenco, quindi un'aggregazione può essere ristretta
nello stesso modo di un elenco:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**La Row-Level Security si applica alle righe che vengono aggregate.** Un'aggregazione è un
modo efficiente per ricavare informazioni su righe che non si possono leggere, pertanto viene eseguita secondo le
policy del chiamante: chi non può selezionare nulla, non conterà nulla.
:::

Le aggregazioni richiedono un driver che le implementi. Con un driver che non lo fa,
l'endpoint risponde con `501` anziché con un risultato vuoto: a una dashboard non dovrebbe essere
detto "nessun risultato" quando la realtà è "non supportato".

## Filtrare all'interno di JSON

Una colonna `json` o `jsonb` può essere filtrata per percorso, utilizzando la sintassi a freccia
propria di Postgres:

```typescript
// Orders whose metadata says the country is US
const { data } = await client.data.orders
    .where("metadata->>country", "==", "US")
    .find();

// Nested paths walk with -> and take the leaf with ->>
await client.data.orders.where("metadata->address->>city", "==", "Berlin").find();
```

Tramite REST:

```bash
GET /api/data/orders?metadata->>country=eq.US
```

I segmenti di percorso vengono sempre inviati come parametri associati (bound parameters), mai concatenati direttamente nell'SQL.

### Come vengono confrontati i valori

`->>` restituisce **testo**, quindi i confronti sono confronti tra stringhe — a meno che a un
operatore di ordinamento (`>`, `>=`, `<`, `<=`) non venga fornito un **numero**, nel qual caso esegue il cast a numerico:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Le righe il cui valore in quel percorso non è un numero vengono escluse dal
confronto numerico anziché far fallire la query. I booleani vengono confrontati come `"true"` /
`"false"`, che è il modo in cui `->>` li restituisce.

:::note
`array-contains` e gli altri operatori per intere colonne non sono disponibili su un
percorso: pongono una condizione sull'intero documento, pertanto vanno usati direttamente sulla colonna
stessa.
:::

## Ricerca testuale

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

Per impostazione predefinita, si tratta di una **ricerca di sottostringhe senza distinzione tra maiuscole e minuscole** (case-insensitive)
tra le colonne di testo di primo livello della tabella. Non è una ricerca full-text: non
accede all'interno di colonne JSON o array, non applica lo stemming o il ranking e non può
utilizzare un indice.

Una tabella può abilitare una vera ricerca full-text dichiarando un blocco
`search`, che rende inoltre i risultati ordinabili per rilevanza tramite `_score`. Consulta
[Ricerca](/docs/backend/search).

## Ricerca vettoriale

Per le tabelle con una colonna `col.vector()`, ordina le righe in base alla similarità rispetto a un
embedding di query. Le righe vengono restituite partendo dalle più vicine, ciascuna con un campo `_distance`. La
distanza costituisce l'ordinamento: un'eventuale clausola `orderBy` sulla stessa query viene ignorata. Senza un
`limit`, una ricerca vettoriale restituisce 10 righe anziché le 50 predefinite di un elenco.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` sulla stessa query funge da filtro per determinare quali righe siano candidate:
restituisce le righe più vicine che soddisfano anche il filtro, non le righe più vicine
filtrate a posteriori. Con l'indice HNSW questo è valido a partire da pgvector 0.8.0 (vedi
[Filtri su un indice approssimato](/docs/backend/vector-search/#filters-on-an-approximate-index));
su una versione precedente di pgvector, un filtro superato da poche delle righe più vicine restituisce una
pagina ridotta. La generazione di `queryVector` è a tuo carico: Rebase memorizza e cerca
gli embedding, non li calcola.

L'SDK invia una
ricerca vettoriale come `POST /api/data/<table>/query`, con l'embedding nel
corpo della richiesta: nell'URL, 768 dimensioni corrispondono a circa 17 KB, oltre quanto consentito da Node (16 KB) e dalla
maggior parte dei proxy (nginx: 8 KB). Anche `count()` con una ricerca vettoriale segue la stessa modalità,
come `POST /api/data/<table>/count`. Con un server precedente alla versione 0.24,
che non dispone di tale route, entrambe le chiamate ripiegano su `GET` — dove un embedding lungo
può comunque essere rifiutato con un errore 431 o 414.

Con una `threshold`,
il risultato non include `meta.total`: il conteggio delle righe entro una data distanza comporterebbe il calcolo
per ogni riga della tabella. Per la paginazione, usa `meta.hasMore`, che rimane accurato.

### Cosa devi fornire

- **pgvector.** Una proprietà `vector` compila in una colonna `VECTOR(n)`, e quel
  tipo proviene dall'estensione `vector`. Rebase la installerà per te, ma
  solo dove autorizzato:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Quella riga rappresenta un'autorizzazione più che una richiesta: Rebase esegue
  `CREATE EXTENSION IF NOT EXISTS vector` solo quando qualcosa nel tuo schema
  lo richiede. È opt-in perché l'installazione di un'estensione dipende da fattori
  che Rebase non può verificare dall'interno della connessione: l'immagine deve includere
  la libreria (l'immagine di scaffolding `pgvector/pgvector:pg18` la include, un `postgres:18`
  standard no), il ruolo deve avere i permessi per installarla e un provider gestito
  deve averla inclusa in una allow-list.

  Se non specifichi nulla, Rebase non installerà nulla: potrai invece installarla manualmente una sola volta.
  In entrambi i casi la colonna viene creata, e Postgres la rifiuta con
  `type "vector" does not exist` su un database che non dispone di nessuna delle due opzioni,
  indicando entrambe le vie d'uscita.

La colonna, il suo indice ANN e tale `CREATE EXTENSION` vengono generati in
`.rebase/sql/vector.sql`, accanto a `schema.sql` e `policies.sql`, e `rebase db
push` li applica per te. Hanno un file dedicato perché Atlas — il
motore alla base di `db push` — calcola le differenze materializzando `schema.sql` in un
database temporaneo azzerato all'inizio di ogni esecuzione, quindi un `VECTOR(n)` al suo
interno verrebbe risolto rispetto a un database che non può mai avere pgvector.

`rebase db generate` accoda quel file alla migrazione che scrive, cosicché una
migrazione rieseguita su un database vuoto crea anche la colonna. Una modifica alla sola
proprietà vettoriale non produce alcuna migrazione, poiché lo schema confrontato da Atlas
rimane invariato — `db generate` lo segnala quando si verifica.

### L'indice

Ogni colonna vettoriale riceve un indice HNSW per la distanza del coseno (cosine distance), creato con la
tabella e segnalato all'avvio. Coseno perché è la metrica con cui misura `vectorSearch`
a meno che non si passi `distance` — un indice serve esattamente un solo operatore, quindi una
query `l2` su un indice di tipo coseno tornerà silenziosamente a eseguire una scansione completa.

Configuralo, o disattivalo, sulla proprietà:

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

`index: false` mantiene intenzionalmente la scansione esatta. Oltre le 2000 dimensioni pgvector
non può creare nessuno dei due tipi di indice, quindi la colonna viene creata e lasciata non indicizzata, e
l'avvio lo segnala — `vectorSearch` risponde comunque, eseguendo una scansione esatta.

`vectorSearch` è una query, non una sottoscrizione: invocare `.listen()` su di essa viene
rifiutato anziché essere servito come semplice elenco, poiché nulla ricalcola le distanze in fase
di scrittura.

## Passaggi successivi

- [Interrogazione dei dati](/docs/sdk/querying/) — il query builder su cui si basano queste operazioni
- [Ricerca](/docs/backend/search/) — come sono configurate la ricerca full-text e vettoriale nel backend
- [API REST](/docs/backend/api/) — le stesse query tramite HTTP
