---
sourceHash: 3cf0b5bcc258e52f
title: Aggregati e ricerca
sidebar_label: Aggregati & ricerca
description: "Conta, somma e raggruppa con l'SDK, filtra all'interno delle colonne JSON ed esegui ricerche full-text e vettoriali dal client."
---

## Aggregati

`count`, `sum`, `avg`, `min`, `max` e le funzioni qui sotto sulle righe selezionate da un
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

| `select` | SDK | Chiave del risultato | Cos'è |
|---|---|---|---|
| `countDistinct(sid)` | `{ fn: "countDistinct", field: "sid" }` | `count_distinct_sid` | Valori distinti non nulli |
| `mode(lang)` | `{ fn: "mode", field: "lang" }` | `mode_lang` | Il valore più frequente |
| `percentile(price,0.95)` | `{ fn: "percentile", field: "price", p: 0.95 }` | `p95_price` | Percentile continuo, `p` da 0 a 1 (`0.5` è la mediana) |
| `distinct(lang)` | `{ fn: "distinct", field: "lang" }` | `distinct_lang` | I valori distinti non nulli, ordinati, come array |
| `fingerprint()` | `{ fn: "fingerprint" }` | `fingerprint` | Una stringa che cambia ogni volta che cambia una riga coperta |

### Aggregati filtrati e nomi

Un aggregato può contare solo alcune righe: dagli un `where` proprio
(il `FILTER (WHERE …)` di SQL). Più aggregati sono un'unica query sulle righe scelte dal
`where` esterno, quindi una dashboard di otto conteggi è una sola scansione. Dai un nome a ciascuno
con `as`, necessario a due aggregati della stessa funzione:

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

Un nome usato due volte, o la chiave di una colonna di `groupBy`, viene rifiutato
(`INVALID_AGGREGATE_SELECT`) anziché sovrascrivere un valore. Via HTTP un nome
si scrive alla maniera di PostgREST, `select=live:count()`; un aggregato con un `where`
proprio si invia come array JSON — `select=[{"fn":"count","as":"live","where":{"tags":["!=",[]]}}]`.

Il `field` di un aggregato può essere un percorso JSON, `props->>players`: `sum`, `avg` e
`percentile` leggono lì il valore come numero e escludono quello che non lo è, gli
altri lo leggono come testo. Un percorso JSON è anche una voce di `groupBy`, indicizzata dal percorso
così com'è scritto:

```ts
await client.data.events.aggregate({
    select: [{ fn: "count" }, { fn: "avg", field: "props->>players", as: "players" }],
    groupBy: ["props->>music"]
});
// [{ "props->>music": "80s", count: 412, players: 3.4 }, …]
```

### Raggruppare per un'espressione

Una voce di `groupBy` può trasformare la propria colonna. Via HTTP si scrive come
una funzione, nell'SDK come `{ field, transform }`, e torna con il nome
`<transform>_<field>` — che è anche il nome usato da `orderBy`:

| Trasformazione | Raggruppa per |
|---|---|
| `lower(name)`, `upper(name)` | La colonna come testo in minuscolo o in maiuscolo |
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

### Qualcosa è cambiato? `fingerprint()`

`fingerprint()` risponde alla domanda "questa collezione è cambiata dall'ultima volta che
l'ho guardata?" senza leggere le righe: conserva la stringa, richiedila più tardi e
ricalcola ciò che hai derivato dalle righe solo quando è diversa. Qualsiasi inserimento,
aggiornamento o eliminazione di una riga che copre la cambia; anche una scrittura che non
cambia nulla (impostare una colonna al suo stesso valore) può cambiarla, ed eliminare una
riga appena aggiunta la riporta al valore precedente. Copre ciò che il chiamante può vedere
e ciò che i filtri selezionano, e può essere raggruppata, quindi `groupBy=lang` dà un
fingerprint per lingua.

```ts
let lastFingerprint: string | undefined;

async function catalogueChanged(): Promise<boolean> {
    const [{ fingerprint }] = await client.data.songs.aggregate({ select: [{ fn: "fingerprint" }] });
    const changed = fingerprint !== lastFingerprint;
    lastFingerprint = String(fingerprint);
    return changed;
}
```

Viene calcolato dalle versioni delle righe che Postgres conserva, non dai valori, quindi
costa una scansione della tabella e non un hash di ogni riga: su 30.000 righe, 4 ms
contro i 56 di `md5(string_agg(...))` sulle righe. Non è disponibile su una vista
semplice, che non memorizza righe; una vista materializzata ne ha una.

I gruppi vengono paginati come le righe di un elenco. `limit` li delimita, `offset` (o `page`)
li salta, e `orderBy` li ordina in base a un campo di `groupBy` o a una chiave di risultato.
L'ordinamento termina sempre sulle chiavi di gruppo, quindi ogni limite di pagina ricade nello
stesso punto. Un aggregato raggruppato senza `limit` viene tagliato al valore predefinito
dell'elenco (50 gruppi), proprio come un listato. Con un `limit` — incluso quello
predefinito — la risposta indica se ce ne sono altri, e il metodo `aggregate()` dell'SDK
lo restituisce come `meta` sul risultato:

```bash
GET /api/data/orders/aggregate?select=count()&groupBy=customer&orderBy=count:desc&limit=20&offset=20
```

```json
{ "data": [ … ], "meta": { "limit": 20, "offset": 20, "hasMore": true } }
```

`offset`, `page` o `orderBy` senza un `groupBy`, oppure un cursore su qualsiasi aggregato,
restituisce un `400 INVALID_AGGREGATE_WINDOW`: un aggregato non raggruppato ha una sola riga,
e un gruppo non è una riga dopo la quale un cursore possa continuare.

Un aggregato legge i valori memorizzati e non esegue mai `afterRead`. Quindi, su una
collezione che un callback `afterRead` riscrive — a livello globale, di collezione o di proprietà —
vengono serviti solo `count()` e `fingerprint()` senza `groupBy`, sia tramite HTTP che in-process; qualsiasi altra
operazione restituisce un `400 AGGREGATE_MASKED_BY_AFTER_READ`, poiché una somma, un
massimo o un gruppo leggerebbero i valori che il callback nasconde.

Dall'SDK, `aggregate()` accetta lo stesso `orderBy` di un `find()` — una tupla
`[key, "asc" | "desc"]` o un elenco di esse — dove la chiave è una colonna di `groupBy`
o una chiave di risultato. Entrambe sono tipizzate: su un modello generato, una chiave che non
è nessuna delle due non compila. In-process (`rebase.data`), i gruppi vengono restituiti
nello stesso ordine che via HTTP.

```ts
const topCustomers = await client.data.orders.aggregate({
    select: [{ fn: "count" }, { fn: "sum", field: "total" }],
    groupBy: ["customer"],
    orderBy: ["sum_total", "desc"],
    limit: 10
});
```

Accetta gli stessi filtri dell'endpoint di elenco, quindi un aggregato può essere ristretto
nello stesso modo in cui si filtra un elenco:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**La Row-level security si applica alle righe che vengono aggregate.** Un aggregato è un
modo efficiente per ricavare informazioni su righe che non si possono leggere, pertanto viene
eseguito con le policy del chiamante: chi non può selezionare nulla non conta nulla.
:::

Gli aggregati richiedono un driver che li implementi. Con uno che non lo fa, l'endpoint
risponde con `501` invece di restituire un risultato vuoto: a una dashboard non dovrebbe essere
detto "nessuna corrispondenza" quando la verità è "non supportato".

## Filtrare all'interno del JSON

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

I segmenti del percorso vengono sempre inviati come parametri associati, mai concatenati nell'SQL.

### Come vengono confrontati i valori

`->>` produce **testo**, quindi i confronti sono confronti testuali — tranne per il fatto che un
operatore di ordinamento (`>`, `>=`, `<`, `<=`) a cui viene fornito un **numero** esegue il cast a numerico:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numeric: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // text
```

Le righe il cui valore in quel percorso non è un numero vengono escluse da un confronto numerico
anziché causare il fallimento della query. I booleani vengono confrontati come `"true"` /
`"false"`, ovvero il modo in cui `->>` li restituisce.

:::note
`array-contains` e gli altri operatori a livello di intera colonna non sono disponibili su un
percorso: pongono una condizione sull'intero documento, pertanto vanno usati sulla colonna stessa.
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

Per impostazione predefinita si tratta di una corrispondenza **a sottostringa senza distinzione tra maiuscole e minuscole**
tra le proprietà `string` di primo livello della collezione. Non è una ricerca full-text: non accede
all'interno delle proprietà `map` o `array`, non esegue lo stemming o il ranking e non può
utilizzare un indice.

Una collezione Postgres può abilitare una vera ricerca full-text dichiarando un blocco
`search`, che rende inoltre i risultati ordinabili per pertinenza tramite `_score`. Consulta
[Ricerca](/docs/backend/search).

## Ricerca vettoriale

Per le collezioni con una proprietà `vector`, ordina le righe in base alla similarità con un embedding
di query. Le righe vengono restituite a partire dalla più vicina, ciascuna con un `_distance`. La
distanza determina l'ordine: un `orderBy` sulla stessa query viene ignorato. Senza un
`limit`, una ricerca vettoriale restituisce 10 righe, invece delle 50 di un elenco.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` sulla stessa query funge da filtro su quali righe siano candidate: questo
restituisce le righe più vicine che soddisfano anche i criteri, non le righe più vicine filtrate
successivamente. Sull'indice HNSW questo vale a partire da pgvector 0.8.0 (vedi
[Filtri su un indice approssimato](/docs/backend/vector-search/#filters-on-an-approximate-index));
su una versione precedente di pgvector, un filtro superato da poche delle righe più vicine restituisce una
pagina breve. Generare `queryVector` è compito tuo: Rebase memorizza e cerca gli
embedding, non li calcola.

L'SDK invia una
ricerca vettoriale come `POST /api/data/<collection>/query`, con l'embedding nel
body: nell'URL, 768 dimensioni occupano circa 17 KB, oltre quanto Node (16 KB) e la maggior parte
dei proxy (nginx: 8 KB) accettano. Anche `count()` con una ricerca vettoriale segue lo stesso approccio,
come `POST /api/data/<collection>/count`. Con un server precedente alla versione 0.24, che non
dispone di tale route, entrambi ricorrono a `GET` — e un embedding lungo può comunque
essere rifiutato con un errore 431 o 414.

Con un `threshold`,
il risultato non ha `meta.total` — contare le righe entro una certa distanza richiede di calcolarla
per ogni riga della tabella. Esegui la paginazione con `meta.hasMore`, che rimane esatto.

### Cosa devi fornire

- **pgvector.** Una proprietà `vector` compila in una colonna `VECTOR(n)`, e quel
  tipo proviene dall'estensione `vector`. Rebase la installerà per te, ma
  solo dove specifichi che può farlo:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Quella riga rappresenta un'autorizzazione piuttosto che una richiesta: Rebase esegue
  `CREATE EXTENSION IF NOT EXISTS vector` solo quando qualcosa nel tuo schema
  ne ha bisogno. È un'opzione opt-in perché l'installazione di un'estensione dipende da fattori
  che Rebase non può verificare dall'interno della connessione: l'immagine deve includere la
  libreria (quella dello scaffold, `pgvector/pgvector:pg18`, lo fa; una `postgres:18` standard
  no), il ruolo deve avere i permessi per installarla e un provider gestito
  deve averla in allow-list.

  Se non specifichi nulla, Rebase non installa nulla: installala invece manualmente una volta.
  In entrambi i casi la colonna viene creata, e Postgres la rifiuta con
  `type "vector" does not exist` su un database che non ha nessuna delle due soluzioni,
  indicando entrambe le vie d'uscita.

La colonna, il suo indice ANN e quel `CREATE EXTENSION` vengono generati in
`.rebase/sql/vector.sql`, accanto a `schema.sql` e `policies.sql`, e `rebase db
push` li applica per te. Hanno un file dedicato perché Atlas — il
motore alla base di `db push` — calcola il proprio diff materializzando `schema.sql` in un
database temporaneo che viene azzerato all'inizio di ogni esecuzione, quindi un `VECTOR(n)` al suo
interno verrebbe risolto rispetto a un database che non può mai avere pgvector.

`rebase db generate` aggiunge quel file alla migrazione che scrive, quindi una
migrazione rieseguita su un database pulito crea anche la colonna. Una modifica alla
sola proprietà vector non produce alcuna migrazione, poiché lo schema su cui Atlas calcola il diff
è invariato — `db generate` lo segnala quando accade.

### L'indice

Ogni colonna vettoriale ottiene un indice HNSW per la distanza del coseno, creato con la
tabella e segnalato all'avvio. Coseno perché è ciò con cui misura `vectorSearch`
a meno che non si passi `distance`: un indice serve esattamente un solo operatore, quindi una
query `l2` eseguita su un indice coseno torna silenziosamente a una scansione sequenziale.

Regolalo, o disattivalo, sulla proprietà:

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

`index: false` mantiene intenzionalmente la scansione esatta. Sopra le 2000 dimensioni pgvector
non può creare nessuno dei due tipi di indice, quindi la colonna viene creata e lasciata non indicizzata,
e l'avvio lo segnala — `vectorSearch` risponde comunque, tramite scansione esatta.

`vectorSearch` è una query, non una sottoscrizione: `.listen()` su di essa viene rifiutato
invece di essere gestito come un semplice elenco, perché nulla ricalcola le distanze in fase
di scrittura.

## Prossimi passi

- [Interrogare i dati](/docs/sdk/querying/) — il query builder su cui si basano
- [Ricerca](/docs/backend/search/) — come sono configurate le ricerche full-text e vettoriali sul backend
- [API REST](/docs/backend/api/) — le stesse query tramite HTTP
