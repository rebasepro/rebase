---
sourceHash: 6774e2ad2b2e95b0
title: Aggregazioni e ricerca
sidebar_label: Aggregazioni e ricerca
description: "Conta, somma e raggruppa con l'SDK, filtra all'interno delle colonne JSON ed esegui ricerche full-text e vettoriali dal client."
---

## Aggregazioni

`count`, `sum`, `avg`, `min` e `max` sulle righe selezionate da un filtro, senza
doverle recuperare:

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

I risultati sono indicizzati per funzione e campo — `count()` diventa `count`,
`sum(total)` diventa `sum_total`.

Accetta gli stessi filtri dell'endpoint di elenco, quindi un'aggregazione può essere
ristretta nello stesso modo in cui si filtra un elenco:

```bash
GET /api/data/orders/aggregate?select=sum(total)&status=eq.paid&createdAt=gte.2026-01-01
```

:::note
**La sicurezza a livello di riga (RLS) si applica alle righe aggregate.** Un'aggregazione è un
modo efficiente per ricavare informazioni su righe che non puoi leggere, quindi viene eseguita con
le policy del chiamante: chi non può selezionare nulla, conta nulla.
:::

Le aggregazioni richiedono un driver che le implementi. In caso contrario, l'endpoint
risponde con `501` invece di un risultato vuoto — una dashboard non dovrebbe
mostrare "nessun risultato" quando in realtà è "non supportato".

## Filtrare all'interno del JSON

Una colonna `json` o `jsonb` può essere filtrata per percorso (path), usando la sintassi a freccia
di Postgres:

```typescript
// Ordini i cui metadati indicano che il paese è US
const { data } = await client.data.orders
    .where("metadata->>country", "==", "US")
    .find();

// I percorsi nidificati si navigano con -> e si estrae il valore foglia con ->>
await client.data.orders.where("metadata->address->>city", "==", "Berlin").find();
```

Tramite REST:

```bash
GET /api/data/orders?metadata->>country=eq.US
```

I segmenti del percorso vengono sempre inviati come parametri associati (bound parameters), mai inseriti direttamente nel codice SQL.

### Come vengono confrontati i valori

`->>` restituisce **testo**, quindi i confronti sono confronti testuali — tranne quando a un
operatore di ordinamento (`>`, `>=`, `<`, `<=`) viene passato un **numero**, nel qual caso esegue il cast a numerico:

```typescript
await client.data.orders.where("metadata->>score", ">", 100).find();     // numerico: 9 < 100
await client.data.orders.where("metadata->>version", ">", "1.2").find(); // testo
```

Le righe il cui valore in quel percorso non è un numero vengono escluse dal
confronto numerico invece di far fallire la query. I booleani vengono confrontati come `"true"` /
`"false"`, che è il modo in cui `->>` li restituisce.

:::note
`array-contains` e gli altri operatori che agiscono sull'intera colonna non sono disponibili su un
singolo percorso — pongono una condizione sull'intero documento, quindi vanno usati direttamente sulla colonna.
:::

## Ricerca di testo

```typescript
// Tramite parametri find
const { data } = await client.data.products.find({
    searchString: "wireless headphones"
});

// Stile fluent
const { data } = await client.data.products
    .search("wireless headphones")
    .limit(10)
    .find();
```

Per impostazione predefinita, si tratta di una **ricerca per sottostringa senza distinzione tra maiuscole e minuscole (case-insensitive)** tra le
proprietà `string` di primo livello della collezione. Non è una ricerca full-text: non
agisce all'interno delle proprietà `map` o `array`, non esegue lo stemming né il ranking, e non può
utilizzare un indice.

Una collezione Postgres può abilitare una vera ricerca full-text dichiarando un
blocco `search`, che rende inoltre i risultati ordinabili per `_score`. Consulta
[Search](/docs/backend/search).

## Ricerca vettoriale

Per le collezioni con una proprietà `vector`, ordina le righe per similarità rispetto a un
embedding di query. Le righe vengono restituite a partire dalle più vicine, ciascuna corredata da una `_distance`.

```typescript
const { data } = await client.data.docs
    .vectorSearch("embedding", queryVector, { threshold: 0.35 })
    .where("status", "==", "published")
    .limit(10)
    .find();
```

`where` e `orderBy` sulla stessa query agiscono come filtri applicati *prima*
dell'ordinamento — questo restituisce le righe più vicine che soddisfano anche i criteri, non le righe più vicine
filtrate a posteriori. Generare `queryVector` è compito tuo: Rebase memorizza e
cerca gli embedding, non li calcola.

### Cosa devi fornire

- **pgvector.** Una proprietà `vector` viene compilata in una colonna `VECTOR(n)`, e quel
  tipo proviene dall'estensione `vector`. Rebase la installerà per te, ma
  solo dove indichi che è consentito farlo:

  ```ts
  // config/resources.ts
  export const main = database({ extensions: ["vector"] });
  ```

  Quella riga è un permesso piuttosto che una richiesta — Rebase esegue
  `CREATE EXTENSION IF NOT EXISTS vector` solo quando qualcosa nel tuo schema
  ne ha bisogno. È un'opzione esplicita (opt-in) perché l'installazione di un'estensione dipende da fattori
  che Rebase non può verificare dall'interno della connessione: l'immagine deve includere
  la libreria (l'immagine di scaffold `pgvector/pgvector:pg18` la include, una standard `postgres:18`
  no), il ruolo deve avere i permessi per installarla, e un provider gestito
  deve averla inclusa nella allow-list.

  Se non specifichi nulla, Rebase non installerà niente — puoi in alternativa installarla una volta manualmente.
  In entrambi i casi la colonna viene creata, e Postgres la rifiuterà con
  `type "vector" does not exist` su un database privo dell'estensione, indicando entrambe
  le soluzioni possibili.

La colonna, il suo indice ANN e quel `CREATE EXTENSION` vengono generati all'interno di
`drizzle/vector.sql`, accanto a `schema.sql` e `policies.sql`, e `rebase db
push` li applica automaticamente. Risiedono in un file separato perché Atlas — il
motore alla base di `db push` — calcola il proprio diff materializzando `schema.sql` in un
database temporaneo (scratch) che viene cancellato all'inizio di ogni esecuzione, quindi un `VECTOR(n)` lì dentro
verrebbe risolto a fronte di un database che non può mai avere pgvector.

`rebase db generate` aggiunge quel file alla migrazione che genera, così una
migrazione rieseguita su un database pulito creerà anche la colonna. Una modifica limitata
alla sola proprietà vettoriale non produce alcuna migrazione, poiché lo schema di cui Atlas calcola il diff
rimane invariato — `db generate` lo segnala quando accade.

### L'indice

Ogni colonna vettoriale riceve un indice HNSW per la distanza del coseno, creato insieme alla
tabella e riportato all'avvio. La distanza del coseno viene usata perché è la metrica che `vectorSearch` utilizza
a meno che non venga specificato `distance` — un indice supporta esattamente un operatore, quindi una
query `l2` eseguita su un indice coseno torna silenziosamente a una scansione sequenziale.

Puoi configurarlo, o disattivarlo, direttamente sulla proprietà:

```ts
embedding: {
    type: "vector",
    dimensions: 1536,
    // Valori predefiniti: un indice HNSW, cosine. Ognuno di questi parametri può essere omesso.
    index: {
        method: "hnsw",              // o "ivfflat"
        distance: ["cosine", "l2"],  // un indice per ciascuno
        m: 24,                       // hnsw
        efConstruction: 128          // hnsw
    }
}
```

`index: false` mantiene intenzionalmente la scansione esatta. Al di sopra di 2000 dimensioni pgvector
non è in grado di creare nessuno dei due tipi di indice, quindi la colonna viene creata e lasciata non indicizzata,
e il log di avvio lo segnala — `vectorSearch` risponde comunque, tramite una scansione esatta.

`vectorSearch` è una query, non una sottoscrizione: invocare `.listen()` su di essa viene
rifiutato invece di essere gestito come un normale elenco, perché nulla ricalcola le distanze a ogni
operazione di scrittura.

## Passaggi successivi

- [Interrogare i dati](/docs/sdk/querying/) — il query builder su cui queste funzionalità si basano
- [Ricerca](/docs/backend/search/) — come vengono configurate la ricerca full-text e vettoriale sul backend
- [API REST](/docs/backend/api/) — le stesse query tramite HTTP

---
