---
sourceHash: f040abfe0eee948c
title: Paginazione
sidebar_label: Paginazione
description: Esegui la paginazione di una collezione con limit/offset, numeri di pagina o un cursore keyset — e scopri quando ciascuno smette di essere corretto.
---

Ci sono tre modi per scorrere una collezione: un offset, un numero di pagina e un cursore. I
primi due sono posizionali e il terzo non lo è, ed è qui che risiede l'intera differenza:
una pagina posizionale rilegge contando dall'inizio, quindi le righe scritte durante
la paginazione modificano il significato di "riga 20".

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

`limit` deve essere un numero intero compreso tra 1 e 1000. Un valore maggiore — o pari a zero,
negativo o frazionario — viene rifiutato con un 400 `INVALID_LIMIT` invece di essere
bloccato a un valore limite (clamped), perché una pagina silenziosamente più piccola non può essere distinta dall'ultima.
Per leggere oltre questa soglia, scorri le pagine con `iterate()` o `findAll()`.

#### Paginazione con cursore

Ogni risposta di elenco contiene un `meta.nextCursor` quando è presente un'altra pagina.
Rinvialo come `after` e la pagina successiva ripartirà **strettamente dopo l'ultima riga
restituita**, invece che a un *conteggio* di righe che scritture concorrenti
potrebbero aver già modificato:

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

Il cursore è **opaco**. Codifica le chiavi di ordinamento *e* i valori dell'ultima riga
per esse, quindi può solo continuare l'elenco da cui proviene: mantieni `orderBy`
identico tra le pagine, altrimenti la richiesta verrà rifiutata con
`CURSOR_ORDER_MISMATCH` invece di eseguire una ricerca in un ordine non richiesto. Una
richiesta che non specifica alcun `orderBy` adotta quello del cursore, permettendo di
passarlo direttamente senza dover ribadire l'ordinamento.

Non analizzarlo (parse) e non costruirne uno: la codifica esiste per essere modificata e
qualsiasi altra cosa produrrà `INVALID_CURSOR`.

Dalla natura del cursore derivano tre conseguenze:

- **`after` non può essere combinato con `offset` o `page`** (400
  `CURSOR_WITH_OFFSET`). Entrambi indicano dove inizia la pagina, e rispettarli
  entrambi comporterebbe il salto di alcune righe.
- **Gli ordinamenti a più chiavi e le chiavi nullable funzionano entrambi.** Il confronto viene costruito su
  ciascuna chiave nell'ordine specificato, con il [posizionamento di NULL](#where-nulls-sort) dichiarato
  dall'ordinamento — non un singolo `>` su una colonna.
- **La rilevanza non può essere un cursore.** Un valore `_score` viene calcolato per query e non viene memorizzato
  da nessuna parte, e due query con stringhe di ricerca diverse producono punteggi che non sono
  sulla stessa scala. Un tale elenco semplicemente non include un `nextCursor`; paginalo
  con `offset`.

Su HTTP si tratta di un solo parametro:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Quali letture sono incapsulate e quali no

Due strutture e una regola: **una finestra è incapsulata, una risposta completa no.**

| Metodo | Restituisce | Perché |
|--------|-------------|--------|
| `find()`, `listen()` | `{ data, meta }` | Una pagina. `meta.total` / `meta.hasMore` sono l'unico modo per sapere se c'è dell'altro |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Non resta nulla da segnalare: lo scorrimento è terminato, o il batch *è* l'insieme delle righe |
| `iterate()` | una riga alla volta | Nulla viene materializzato in memoria |
| `findById()`, `get()`, `create()`, `update()` | una riga | Non è una lista |

`data` non è un wrapper che l'SDK a volte aggiunge e a volte dimentica. È
il luogo in cui risiedono i metadati di paginazione, ed è presente esattamente quando ce ne sono.

#### Leggere tutto: `iterate()` e `findAll()`

`iterate()` trasmette in streaming ogni riga corrispondente a una query, una alla volta, recuperando una pagina
alla volta dietro le quinte. Nulla si accumula, quindi è il metodo da utilizzare per una
collezione che non puoi mantenere in memoria:

```typescript
for await (const order of client.data.orders.iterate({
    where: { status: ["==", "pending"] }
})) {
    await handleOrder(order);
}
```

`findAll()` è lo stesso scorrimento raccolto in un array:

```typescript
const stale = await client.data.sessions.findAll({
    where: { expiresAt: ["<", cutoff] }
});
```

Entrambi sono disponibili anche sul fluent builder, dove `.limit()` diventa la **dimensione della pagina**
piuttosto che un totale:

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Tre opzioni configurano lo scorrimento:

| Opzione | Predefinito | Cosa fa |
|---------|-------------|---------|
| `pageSize` | 200 | Righe per richiesta. |
| `cursor` | — | Cerca su una colonna invece di paginare tramite offset. Vedi sotto. |
| `maxPages` | 10 000 | Limite massimo di richieste, per evitare che un server che restituisce continuamente `hasMore` rimanga bloccato in un ciclo infinito. |
| `maxRows` | 10 000 | Solo per `findAll()`. Il superamento del limite **genera un errore** invece di restituire un array troncato come se fosse la risposta completa. Passa `Infinity` per disattivarlo, oppure usa `iterate()`. |

**Preferisci `cursor` ogni volta che la collezione ha una colonna univoca e ordinabile.**
La paginazione basata su offset ricalcola le righe a ogni richiesta, quindi una riga inserita o eliminata
*durante l'esecuzione dello scorrimento* sposta la finestra e lo scorrimento salta o ripete
silenziosamente delle righe. La ricerca richiede righe strettamente successive all'ultima visualizzata,
che le scritture concorrenti precedenti al cursore non possono spostare:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

In questo contesto, `cursor` significa "cerca invece di paginare tramite offset" e specifica la colonna in base alla quale
ordinare quando la query non lo dichiara già. La ricerca stessa è
[il cursore del server](#cursor-pagination): lo scorrimento restituisce `meta.nextCursor` come
`after` e non costruisce alcun confronto autonomamente, motivo per cui funziona anche un ordinamento
a più chiavi —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— e per cui funziona anche una chiave di ordinamento nullable.

L'ordinamento deve comunque essere **totale**, il che in pratica significa univoco: l'ID di riga
risolve l'eventuale parità finale, quindi qualsiasi colonna funziona come criterio di spareggio, ma uno scorrimento il cui
cursore smette di avanzare genera l'errore `cursor-stalled` invece di andare in loop infinito. Una
query che nessun cursore può descrivere (rilevanza) genera `cursor-missing`; rimuovi `cursor`
e pagina tramite offset.

## Vedi anche

- [Interrogare i dati](/docs/sdk/querying/) — filtri, fluent builder, ordinamento.
- [Aggregazioni e ricerca](/docs/sdk/aggregates-and-search/) — perché la rilevanza non può fungere da chiave per un cursore.

---
