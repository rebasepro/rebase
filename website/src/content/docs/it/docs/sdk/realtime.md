---
sourceHash: f49369700dcdc098
title: Sottoscrizioni Realtime
sidebar_label: Realtime
description: Sottoscrivi le modifiche ai dati in tempo reale con l'SDK Rebase Client utilizzando listener realtime basati su WebSocket.
---

## Panoramica

L'SDK Rebase Client fornisce sottoscrizioni ai dati in tempo reale tramite WebSocket. Quando i record cambiano sul server, i callback a cui ti sei iscritto vengono eseguiti immediatamente con i dati aggiornati.

La connessione WebSocket viene stabilita automaticamente quando è disponibile un `websocketUrl` (derivato da `baseUrl` per impostazione predefinita). La riconnessione e l'aggiornamento del token vengono gestiti in modo trasparente.

## Sottoscrizione a una collection

Usa `listen()` per sottoscrivere una query su una collection. Il callback viene attivato ogni volta che il set di dati corrispondente cambia:

```typescript
const unsubscribe = client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (response) => {
        console.log("Products updated:", response.data);
        console.log("Total:", response.meta.total);
    }
);

// Stop listening when done
unsubscribe();
```

Il metodo `listen()` accetta gli stessi `FindParams` di `find()` — puoi filtrare, ordinare e impaginare la tua sottoscrizione:

```typescript
const unsubscribe = client.data.orders.listen(
    {
        where: { status: ["==", "pending"] },
        orderBy: ["createdAt", "desc"],
        limit: 20
    },
    (response) => {
        renderOrders(response.data);
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### Firma

```typescript no-verify
listen(
    params: FindParams<M> | undefined,
    onUpdate: (result: FindResult<M>) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

`FindResult<M>` ha la stessa struttura restituita da `find()`: righe piatte in `data`, e `{ total, limit, offset, hasMore, nextCursor }` in `meta`.

### `listen()` accetta ciò che accetta `find()`

`params` è un `FindParams` completo. Una sottoscrizione è la stessa query del `find()` corrispondente, quindi accetta gli stessi criteri di restrizione — `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** e **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Questo è più importante di quanto sembri. In precedenza, `include` e `fields` venivano ignorati silenziosamente in questo punto, quindi la stessa query restituiva una struttura tramite `find()` e un'altra tramite `listen()` — e un componente che eseguiva il rendering di entrambi vedeva la struttura delle proprie righe cambiare non appena avveniva una scrittura. Ora passano attraverso la stessa pipeline di lettura, quindi `find({ q })` e `listen({ q })` restituiscono righe identiche campo per campo.

L'eccezione è `vectorSearch`, che viene **rifiutata** anziché ignorata: una sottoscrizione viene rieseguita a ogni scrittura corrispondente e lì nulla calcola le distanze. Usa `.vectorSearch(…).find()` per la query e sottoscrivi senza di essa.

### Un'emissione per modifica

Ogni push del server chiama il tuo callback **una sola volta**, con metadati che descrivono le righe associate. Non c'è un'emissione separata per il primo rendering e nessun flag da controllare.

I metadati arrivano **nello stesso frame delle righe**: il server conteggia la query all'interno della stessa transazione vincolata alla sicurezza a livello di riga (RLS) che le ha lette, quindi `meta.total`, `meta.hasMore` e `meta.nextCursor` descrivono esattamente le righe adiacenti. (In passato ogni push era seguito da una `GET /count` dal client — un round trip aggiuntivo per scrittura, per sottoscrittore, e una finestra temporale in cui il conteggio e le righe descrivevano stati diversi della collection).

Due fallback, nessuno dei quali costituisce un errore di sottoscrizione né chiama `onError`:

- Se il **conteggio del server non è riuscito**, il frame non trasporta alcun totale e viene riutilizzato l'ultimo arrivato. Un conteggio fallito non dice nulla sulla dimensione della collection, quindi non deve sovrascrivere una risposta valida.
- Se non è mai arrivato alcun totale per questa sottoscrizione — un server meno recente che non invia alcun metadato — il client lo richiede una volta, al primo push. Se anche questa richiesta fallisce, `meta.total` è un **limite inferiore**: le righe su questa pagina più quelle già impaginate per raggiungerle.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Sottoscrizione a una singola entità

Usa `listenById()` per monitorare un record specifico in base al suo ID:

```typescript
// The SDK hands back a flat row, not an `Entity` — there is no `.values`.
const unsubscribe = client.data
    .collection<{ id: number; name: string }>("products")
    .listenById(
    42,
    (product) => {
        if (product) {
            console.log("Product changed:", product.name);
        } else {
            console.log("Product was deleted");
        }
    },
    (error) => {
        console.error("Subscription error:", error);
    }
);
```

### Firma

```typescript no-verify
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

Il callback riceve una riga piatta — non un'`Entity`, quindi non c'è `.values` — e `undefined` quando il record viene eliminato.

## Query builder fluent

Puoi anche sottoscrivere tramite il query builder fluent. Questo equivale a chiamare `listen()` con parametri, ma ti consente di concatenare `.where()`, `.orderBy()`, ecc.:

```typescript
const unsubscribe = client.data.products
    .where("active", "==", true)
    .orderBy("createdAt", "desc")
    .limit(20)
    .listen(
        (response) => console.log("Updated:", response.data),
        (error) => console.error("Error:", error)
    );
```

Una sottoscrizione accetta un ordinamento su più colonne come qualsiasi altra query — tramite `orderBy: [["category", "asc"], ["createdAt", "desc"]]` nei parametri, oppure con una seconda chiamata `.orderBy()`, che aggiunge un criterio di spareggio anziché sostituire il primo. Consulta [Ordinamento](/docs/sdk/querying#sorting).

All'arrivo, il server controlla la *forma* dell'`orderBy` di una sottoscrizione e ne rifiuta una malformata con un frame di errore anziché effettuare la sottoscrizione. Un ordinamento non interpretabile trasmetterebbe altrimenti le righe senza alcun ordine pur non segnalando alcun errore — e un frame `collection_update` trasporta solo le righe e nient'altro, quindi un sottoscrittore non avrebbe modo di accorgersene.

## Annullamento della sottoscrizione

Ogni sottoscrizione restituisce una funzione `unsubscribe`. Chiamala per interrompere la ricezione degli aggiornamenti e ripulire il listener WebSocket:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

In React, usa la funzione di pulizia di `useEffect`:

```tsx
useEffect(() => {
    const unsubscribe = client.data.products.listen(
        { where: { active: ["==", true] } },
        (response) => setProducts(response.data)
    );
    return () => unsubscribe();
}, []);
```

## Autenticazione e riconnessione

Il client WebSocket gestisce l'autenticazione automaticamente:

- Al **login** o al **refresh del token**, il nuovo token viene inviato a un socket già aperto tramite un messaggio `authenticate`. Se non c'è alcun socket aperto, non accade nulla — l'accesso non è una richiesta per il realtime, e un socket aperto successivamente si autentica da solo.
- Al **logout**, la connessione WebSocket viene disconnessa. Il client rimane utilizzabile; una sottoscrizione successiva si riconnette in modo anonimo.
- Se la connessione cade, il client **si riconnette automaticamente** e ristabilisce tutte le sottoscrizioni attive.

Non è richiesta alcuna gestione manuale dei token — l'integrazione tra `client.auth` e il layer WebSocket viene gestita internamente.

### La connessione è lazy

La creazione di un client **non** apre alcun WebSocket. Viene stabilito alla prima operazione che ne ha effettivamente bisogno — una sottoscrizione `listen()` / `listenById()`, o un'operazione di canale come `join()`, `track()` o `broadcast()`. Ottenere un canale non equivale a usarlo.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Questo è importante per le app con una quantità significativa di traffico non autenticato — pagine di marketing, viste pubbliche di sola lettura, strumenti basati sull'anonimato — che in precedenza pagavano il costo di una connessione a ogni caricamento di pagina solo per avere il realtime a disposizione.

Due comportamenti correlati:

- `realtime: false` rimane un'esclusione rigorosa (opt-out): nessun socket viene mai aperto, e `client.realtime.channel()` genera un'eccezione. Lo stesso vale per `listen()` e `listenById()` — sono sempre disponibili per essere chiamati, e su un client senza socket generano un errore `RebaseClientError` che indica l'opzione necessaria per abilitarli. `observe()` non lo fa: degrada a una singola fetch.
- `client.close()` è definitivo. Rilascia il socket e il relativo timer di riconnessione, e nulla di quanto accodato successivamente effettuerà una nuova connessione. In Node, un socket aperto mantiene attivo l'event loop, quindi uno script che non lo chiama mai non terminerà da solo.

## Canali di broadcast

I canali di broadcast consentono di inviare messaggi arbitrari tra client connessi — ideali per chat, notifiche o funzionalità collaborative:

```typescript
// Obtain a channel. This alone opens no connection.
const channel = client.realtime.channel("chat-room");

// Listen for broadcasts. Pass an event name to filter, or omit it for all.
channel.onBroadcast("message", (payload) => {
    console.log("New message:", payload);
});

// Send to every other member — the sender never receives its own message.
await channel.broadcast("message", {
    text: "Hello, world!",
    userId: currentUser.id
});

// Leave, releasing handlers and timers.
await channel.leave();
```

I canali sono leggeri ed effimeri — esistono finché almeno un client è sottoscritto. Chiamate ripetute a `channel()` con lo stesso nome restituiscono lo **stesso** oggetto, in modo che due componenti possano associare gestori in modo indipendente senza che l'uscita di uno escluda l'altro.

I frame di canale e di presenza non richiedono un account: i visitatori anonimi possono unirsi ai canali pubblici.

:::caution[I canali non hanno ancora regole di accesso]
L'unico controllo applicato dal server è l'**appartenenza**: per trasmettere in broadcast in un canale, leggere il suo elenco di presenza o riprodurne la cronologia, un client deve prima essersi unito a quel canale. L'azione di unirsi è di per sé aperta — qualsiasi client in grado di nominare un canale può unirvisi, indipendentemente dal fatto che sia autenticato o meno.

Pertanto, il nome di un canale non è un segreto né un permesso. Non inserire in un canale nulla (inclusi cronologia persistita e stato di presenza) che ogni utente della tua app non possa vedere, e non derivare il nome di un canale da dati che non condivideresti pubblicamente. Le regole di autorizzazione per canale non sono ancora implementate; se ne hai bisogno oggi, mantieni la parte sensibile dello scambio su `client.data`, dove si applica la sicurezza a livello di riga (RLS).
:::

> **Per impostazione predefinita, i broadcast non vengono riprodotti.** Raggiungono solo i membri attualmente connessi. Questo è il comportamento desiderato per le notifiche che si autocorregono — un avviso "qualcuno ha salvato" viene superato dal salvataggio successivo — e non ha alcun costo. Per un flusso di operazioni, in cui un'interruzione silenziosa provoca divergenze, abilita la [cronologia dei messaggi](#message-history-and-catch-up) sul canale.

## Cronologia dei messaggi e catch-up

Un canale può essere configurato per conservare i propri broadcast, in modo che un client che si riconnette recuperi ciò che ha perso invece di risincronizzarsi da zero. Questo è ciò che rende i canali utilizzabili come meccanismo di trasporto per l'editing collaborativo.

La conservazione (retention) è configurata **sul server**, per pattern di canale — vedi [Backend Realtime](/docs/backend/realtime#channel-retention). Un client non può attivarla autonomamente, poiché un canale viene creato da chiunque ne specifichi il nome, e una profondità di cronologia scelta dal client consentirebbe a qualsiasi visitatore di vincolare il backend a uno spazio di archiviazione illimitato.

Su un canale con retention attiva, passa `{ history: true }` e l'SDK farà il resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Su `join()` e dopo ogni riconnessione, l'SDK richiede al server tutto ciò che segue l'ultimo numero di sequenza rilevato, e consegna il risultato attraverso gli stessi gestori. Non c'è un secondo percorso di codice da scrivere: un handler che applica correttamente un'operazione dal vivo la applica correttamente anche durante il catch-up.

### Numeri di sequenza

Ogni broadcast su un canale con conservazione include un `seq` — specifico per canale, continuo e crescente. Rappresenta il punto di ripresa per il client.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Salva in modo persistente `channel.sequence` se desideri che il recupero sopravviva sia alla ricarica della pagina sia a una riconnessione, e inoltralo tramite `history({ sinceSeq })`.

### Recupero esplicito della cronologia

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` indica che il canale non conserva alcuna cronologia e non lo farà mai — una risposta esplicita che consente di distinguere "non hai perso nulla" da "questo canale non ha regole di retention". Nel secondo caso, un client che deve convergere deve ricorrere a una risincronizzazione completa.

`latestSeq` è la sequenza più alta presente sul server, indipendentemente dal fatto che questo batch l'abbia raggiunta o meno. Se è molto oltre il tuo ultimo `seq` consegnato, sei indietro di più di una pagina e risincronizzare potrebbe essere più conveniente che impaginare.

:::note[Le riproduzioni possono sovrapporsi, ed è normale]
Il server non può sapere con precisione quali messaggi ti abbiano raggiunto prima dell'interruzione del socket, quindi un intervallo di catch-up potrebbe includere messaggi che hai già applicato. L'SDK scarta qualsiasi elemento pari o inferiore alla sequenza già consegnata, così i gestori non vedranno mai un messaggio due volte.

I tuoi messaggi personali **non** vengono esclusi da un replay: una riconnessione assegna un nuovo ID client, quindi il caso esatto per cui esiste il catch-up è proprio quello in cui tale filtro fallirebbe. Rendi le operazioni idempotenti se riapplicare le tue creerebbe problemi.
:::

## Tracciamento della presenza

La presenza ti consente di monitorare quali utenti sono online e sincronizzare lo stato condiviso tra tutti i partecipanti:

```typescript
const channel = client.realtime.channel("editors");

// Publish your presence. This is also what opens the connection.
await channel.track({
    userId: currentUser.id,
    status: "editing",
    cursor: { x: 100, y: 200 }
});

// One handler for every change. `presences` is always the full roster;
// `diff` is what changed, when you only care about the delta.
channel.onPresence((presences, diff) => {
    console.log("Online users:", Object.keys(presences));
    if (diff) {
        console.log("joined:", Object.keys(diff.joins));
        console.log("left:", Object.keys(diff.leaves));
    }
});

// Calling track() again replaces your state — this is how you publish a
// moving cursor.
await channel.track({ userId: currentUser.id, status: "idle" });

// Stop publishing without leaving the channel.
await channel.untrack();
```

L'SDK mantiene l'elenco dei presenti (roster) per te, quindi `presences` è sempre completo e non dovrai mai ricomporlo a partire dai diff.

Gestisce inoltre due dettagli di protocollo che è facile sbagliare quando si lavora direttamente con i WebSocket grezzi:

- **Il roster non viene inviato all'ingresso.** Il primo `presence_diff` di un client che entra contiene solo se stesso; l'elenco esistente deve essere richiesto esplicitamente. `join()` esegue questa operazione per te.
- **La presenza scade dopo 30 secondi.** `track()` non è una registrazione permanente — senza un nuovo invio periodico scomparirai silenziosamente dal roster di tutti gli altri pur rimanendo connesso e sulla pagina. L'SDK invia un heartbeat ogni 20 secondi e si interrompe su `untrack()` / `leave()`.

Una riconnessione azzera anche l'appartenenza al canale e la presenza sul lato server; l'SDK si unisce nuovamente, richiede di nuovo il roster ed esegue nuovamente il tracking in modo automatico.

## Quando usare Realtime

| Caso d'uso | Metodo |
|----------|--------|
| Dashboard con dati in tempo reale | `listen()` con filtri |
| Chat o messaggistica | `channel.broadcast()` |
| Editing collaborativo / flussi di operazioni | `channel(name, { history: true })` |
| Indicatori di digitazione / stato online | `channel.track()` + `channel.onPresence()` |
| Pagina di dettaglio con aggiornamenti in tempo reale | `listenById()` |
| Monitoraggio del pannello di amministrazione | `listen()` con `orderBy` e `limit` |
| Un elenco che deve persistere anche in caso di disconnessione | `observe()` con [offline](/docs/sdk/offline) abilitato |

> **Suggerimento:** Per recuperare i dati una sola volta, usa invece `find()` o `findById()`. Le sottoscrizioni sono ideali per i dati che cambiano frequentemente e devono essere aggiornati nell'interfaccia utente all'istante.

## `listen()` vs `observe()`

Entrambi mantengono una query aggiornata ed entrambi restituiscono una funzione di disiscrizione (unsubscribe) — ma rispondono a esigenze diverse.

`listen()` rappresenta il socket: fornisce ciò che il server invia tramite push e non restituisce nulla quando il socket è inattivo.

`observe()` rappresenta la query: con la modalità [offline](/docs/sdk/offline) abilitata, emette prima dal database locale — prima di qualsiasi richiesta — e riemette su scritture locali, su scritture in coda che raggiungono il server, su rollback e su eventi realtime, a cui si iscrive autonomamente a meno che non si passi `{ realtime: false }`. Ciascun risultato specifica se proviene dalla cache e se contiene scritture non ancora accettate dal server.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Senza la modalità offline abilitata, `observe()` equivale a `find()` più `listen()` in un'unica chiamata, con tali flag impostati sempre su `false`.

## Passaggi successivi

- **[Interrogare i dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Offline e sincronizzazione local-first](/docs/sdk/offline)** — Query in tempo reale che persistono a una perdita di connessione
- **[Autenticazione](/docs/sdk/authentication)** — Accesso e gestione delle sessioni
- **[Backend Realtime](/docs/backend/realtime)** — Configurazione WebSocket lato server

---
