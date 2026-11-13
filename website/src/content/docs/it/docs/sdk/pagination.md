---
sourceHash: e658ebda47d3942e
title: Paginazione
sidebar_label: Paginazione
description: Impagina una tabella con limit/offset, numeri di pagina o un cursore keyset — e quando ciascuno smette di essere corretto.
---

Tre modi per scorrere una tabella: un offset, un numero di pagina e un cursore. I
primi due sono posizionali e il terzo non lo è, ed è qui che risiede l'intera differenza:
una pagina posizionale rilegge contando dall'inizio, quindi le righe scritte durante
l'impaginazione alterano il significato di "riga 20".

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

Usa l'uno o l'altro. Insieme, `page` e `offset` descrivono la stessa finestra
due volte, e la lettura viene rifiutata con `PAGE_WITH_OFFSET` invece di applicare
silenziosamente `page`. L'SDK la rifiuta prima di qualsiasi richiesta, su HTTP, in-process
e offline; il server risponde con un 400 a una richiesta raw che invia entrambi.

`limit` deve essere un numero intero compreso tra 1 e 1000. Un valore più grande —
oppure pari a zero, negativo o frazionario — viene rifiutato con un 400 `INVALID_LIMIT`
anziché essere limitato (clamped), perché una pagina silenziosamente più piccola non si
distinguerebbe dall'ultima. Per leggere oltre tale limite, scorri le pagine con `iterate()` o `findAll()`.

#### Paginazione basata su cursore

Ogni risposta di tipo elenco contiene un `meta.nextCursor` finché c'è un'altra pagina.
Rinvialo come `after` e la pagina successiva riprenderà **strettamente dopo l'ultima riga
servita**, invece che a un *conteggio* di righe già alterato da scritture concorrenti:

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

`nextCursor` è assente nell'ultima pagina e in una pagina che nessun cursore può descrivere:
una ricerca ordinata per pertinenza (`_score`), una ricerca vettoriale e una proiezione `fields`
che omette uno dei campi di `orderBy` — il cursore viene costruito a partire dai valori di
ordinamento dell'ultima riga, e quella riga non li contiene. In tal caso `meta.hasMore` può essere
`true` senza alcun `nextCursor`, e il ciclo sopra si interrompe prematuramente: aggiungi i campi di
ordinamento a `fields`, oppure pagina tramite `offset`. `iterate()` a cui viene fornito un `cursor`
rifiuta tale elenco con `cursor-missing` invece di fermarsi. Un ordinamento per
[aggregato su una relazione](/docs/sdk/relations/) pagina invece tramite cursore.

Il cursore è **opaco**. Codifica le chiavi di ordinamento *e* i relativi valori dell'ultima riga,
quindi può solo continuare l'elenco da cui proviene: mantieni `orderBy` identico tra le pagine,
altrimenti la richiesta verrà rifiutata con `CURSOR_ORDER_MISMATCH` invece di effettuare il
posizionamento secondo un ordine non richiesto. Una richiesta che non specifica alcun `orderBy`
adotta quello del cursore, consentendoti di reinviarlo direttamente senza dover ridefinire l'ordinamento.

Non analizzarlo e non crearne uno: la codifica è soggetta a modifiche, e
qualsiasi altra cosa è `INVALID_CURSOR`.

Dalla natura di un cursore derivano quattro conseguenze:

- **`after` non può essere combinato con `offset` o `page`** (400
  `CURSOR_WITH_OFFSET`). Entrambi indicano dove inizia la pagina, e rispettare
  entrambi comporterebbe il salto di righe.
- **Gli ordinamenti a più chiavi e le chiavi nullable funzionano entrambi.** Il confronto viene
  costruito su ciascuna chiave in ordine, con il [posizionamento dei NULL](/docs/sdk/querying#where-nulls-sort)
  dichiarato dall'ordinamento — non un semplice `>` su una singola colonna.
- **La pertinenza non può essere un cursore.** Un `_score` viene calcolato per query e non viene
  memorizzato da nessuna parte, e due query con stringhe di ricerca diverse producono punteggi che non
  sono sulla stessa scala. Un simile elenco semplicemente non contiene `nextCursor`; impaginalo
  con `offset`. Lo stesso vale per la distanza di una ricerca vettoriale, e un cursore inviato con
  essa viene rifiutato con `VECTOR_CURSOR_UNSUPPORTED`.
- **Una sottoscrizione non può proseguire da un cursore.** `listen()` riesegue la sua query a
  ogni scrittura e `after` fa riferimento a una posizione in una specifica esecuzione, pertanto `listen({ after })`
  viene rifiutata con `CURSOR_NOT_LIVE` prima che venga inviato qualsiasi dato. Usa `offset` o
  `page` per una finestra in tempo reale, oppure `find({ after })` per leggere la pagina una sola volta.

Su HTTP si tratta di un singolo parametro:

```
GET /api/data/orders?orderBy=createdAt:desc&limit=100
GET /api/data/orders?orderBy=createdAt:desc&limit=100&after=eyJrIjpbWyJ…
```

#### Omettere il conteggio

`meta.total` è un `COUNT(*)` su ogni riga corrispondente alla query, eseguito in parallelo alla
pagina — e su una tabella di grandi dimensioni costa più della pagina stessa. Una lettura che scorre
solo in avanti non ne ha mai bisogno, perché `meta.hasMore` non dipende da esso:
passa `count: "none"` e la lettura richiederà invece una riga in più oltre la pagina.

```typescript
const { data, meta } = await client.data.orders.find({ limit: 100, count: "none" });
meta.hasMore; // exact
```

Senza un conteggio non c'è alcun totale da riportare: su HTTP `meta.total` è assente,
mentre in-process corrisponde alle righe fino alla fine della pagina (`offset` più la
pagina). Su HTTP si usa `?count=none`; `?count=exact` è il valore predefinito e qualsiasi
altro valore genera un 400 `INVALID_COUNT`. `iterate()` e `findAll()` lo inviano automaticamente
su ogni pagina, poiché uno scorrimento completo non riporta alcun totale.

#### Quali letture sono incapsulate e quali no

Due forme e una sola regola: **una finestra è incapsulata, una risposta completa no.**

| Metodo | Restituisce | Motivo |
|--------|---------|-----|
| `find()`, `listen()` | `{ data, meta }` | Una pagina. `meta.total` / `meta.hasMore` sono l'unico modo per sapere se ce n'è ancora |
| `findAll()`, `createMany()`, `updateMany()` | `M[]` | Niente di residuo da segnalare: lo scorrimento è terminato, oppure il batch *è* l'insieme delle righe |
| `iterate()` | una riga alla volta | Nulla viene materializzato |
| `findById()`, `get()`, `create()`, `update()` | una riga | Non è un elenco |

`data` non è un wrapper che l'SDK a volte aggiunge e a volte dimentica. È il
contenitore in cui risiedono i metadati di paginazione, ed è presente esattamente quando ce ne sono.

#### Leggere tutto: `iterate()` e `findAll()`

`iterate()` trasmette in streaming ogni riga corrispondente alla query, una alla volta, recuperando una pagina alla
volta dietro le quinte. Nulla si accumula, quindi è la soluzione da usare per una
tabella che non può essere mantenuta in memoria:

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
anziché un totale:

```typescript
const rows = await client.data.orders
    .where("status", "==", "pending")
    .orderBy("createdAt", "asc")
    .limit(500)          // rows per request
    .findAll();
```

Quattro opzioni configurano lo scorrimento:

| Opzione | Predefinito | Cosa fa |
|--------|---------|--------------|
| `pageSize` | 200 | Righe per richiesta. |
| `cursor` | — | Richiede il seeking: genera un errore invece di ripiegare sull'offset. Vedi sotto. |
| `maxPages` | 10 000 | Limite massimo di richieste, per evitare che un server che continua a restituire `hasMore` vada in loop infinito. |
| `maxRows` | 10 000 | Solo per `findAll()`. Superarlo **genera un'eccezione** invece di restituire un array troncato come se fosse la risposta completa. Passa `Infinity` per disattivarlo, oppure usa `iterate()`. |

**Lo scorrimento effettua il seek autonomamente.** Dopo la prima pagina, rinvia
[il cursore del server](#paginazione-basata-su-cursore) — `meta.nextCursor` — come `after`,
così ogni richiesta richiede righe strettamente successive all'ultima visualizzata. Le scritture
concorrenti prima di quella riga non possono spostare la finestra e il database non deve mai
saltare righe tramite conteggio, che è ciò che rendeva lenti i lunghi scorrimenti basati su offset: ogni pagina costava
più di quella precedente.

Laddove il server non genera alcun cursore — una ricerca ordinata per pertinenza, una ricerca
vettoriale, una lettura con `distinct`, una proiezione `fields` che omette un campo di ordinamento — lo
scorrimento impagina invece per offset, e una riga inserita o eliminata *durante l'esecuzione dello scorrimento*
può causare il salto o la ripetizione di una riga. Passa `cursor` per rendere il posizionamento tramite cursore un requisito anziché una preferenza:

```typescript
for await (const job of client.data.jobs.iterate({ cursor: "id" })) { /* … */ }
```

`cursor` specifica la colonna in base a cui ordinare quando la query non lo definisce già, e
trasforma il ripiego sull'offset in un errore. Lo scorrimento non crea alcun confronto personalizzato,
motivo per cui un ordinamento a più chiavi funziona —

```typescript
for await (const job of client.data.jobs.iterate({
    cursor: "id",
    orderBy: [["priority", "desc"], ["createdAt", "asc"]]
})) { /* … */ }
```

— così come una chiave di ordinamento che ammette valori nulli (nullable).

L'ordinamento deve comunque essere **totale**, il che in pratica significa univoco: l'id della riga
risolve lo spareggio finale, quindi qualsiasi colonna funziona come criterio di spareggio. Con `cursor`, uno
scorrimento il cui cursore smette di avanzare genera `cursor-stalled` invece di andare in loop all'infinito,
e una query che nessun cursore può descrivere (pertinenza) genera `cursor-missing`; rimuovi `cursor` e
lo scorrimento impaginerà tali risultati tramite offset.

## Vedi anche

- [Interrogare i dati](/docs/sdk/querying/) — filtri, fluent builder, ordinamento.
- [Aggregati e ricerca](/docs/sdk/aggregates-and-search/) — perché la pertinenza non può essere la chiave di un cursore.
