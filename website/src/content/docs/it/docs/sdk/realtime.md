---
sourceHash: a82dd911da9d58ef
title: Sottoscrizioni in tempo reale
sidebar_label: Tempo reale
description: Sottoscrivi le modifiche ai dati in diretta con l'SDK Client di Rebase usando listener in tempo reale basati su WebSocket.
---

## Panoramica

L'SDK Client di Rebase fornisce sottoscrizioni ai dati in tempo reale tramite WebSocket. Quando i record cambiano sul server, i callback sottoscritti si attivano immediatamente con i dati aggiornati.

La connessione WebSocket viene stabilita automaticamente quando è disponibile una `websocketUrl` (derivata da `baseUrl` per impostazione predefinita). La riconnessione e l'aggiornamento dei token sono gestiti in modo trasparente.

## Sottoscrivere una collezione

Usa `listen()` per sottoscrivere una query su una collezione. Il callback si attiva ogni volta che il set di dati corrispondente cambia:

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

Il metodo `listen()` accetta gli stessi `FindParams` di `find()` — puoi filtrare, ordinare e paginare la tua sottoscrizione:

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

`FindResult<M>` è la stessa forma restituita da `find()`: righe piatte in `data` e
`{ total, limit, offset, hasMore }` in `meta`.

### Una emissione per ogni cambiamento

Ogni push del server richiama la tua callback **una volta**, con metadati che descrivono
le righe che li accompagnano. Non c'è una prima emissione separata né alcun flag da
controllare:

- Prima dell'emissione viene eseguito un `count()` per la query, quindi `meta.total` e
  `meta.hasMore` sono autorevoli.
- Se un push arriva mentre quel conteggio è ancora in corso, l'emissione più vecchia
  viene scartata: non ricevi mai una callback con un totale appartenente a una pagina
  precedente.
- Se il conteggio **fallisce**, viene riusato l'ultimo totale realmente restituito da un
  conteggio. Un conteggio fallito non dice nulla sulla dimensione della collezione, e
  quindi non può sovrascrivere una risposta vera. Non è un errore di sottoscrizione, e
  `onError` non viene chiamata.
- Se nessun conteggio è mai riuscito per questa sottoscrizione, `meta.total` è un
  **limite inferiore** — le righe di questa pagina più quelle saltate per arrivarci — e
  `meta.hasMore` è `true` quando la pagina è tornata piena.

```typescript
client.data.products.listen(
    { where: { active: ["==", true] }, limit: 50 },
    (result) => {
        renderProducts(result.data);
        renderPager({ total: result.meta.total, hasMore: result.meta.hasMore });
    }
);
```

## Sottoscrivere una singola entità

Usa `listenById()` per osservare un record specifico tramite il suo ID:

```typescript
const unsubscribe = client.data.products.listenById(
    42,
    (entity) => {
        if (entity) {
            console.log("Product changed:", entity.values.name);
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

```typescript
listenById(
    id: string | number,
    onUpdate: (row: M | undefined) => void,
    onError?: (error: Error) => void
): () => void   // returns unsubscribe function
```

La callback riceve una riga piatta — non una `Entity`, quindi senza `.values` — e
`undefined` quando il record viene eliminato.

## Query Builder fluido

Puoi anche sottoscrivere tramite il query builder fluido. È equivalente a chiamare `listen()` con parametri, ma consente di concatenare `.where()`, `.orderBy()`, ecc.:

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

## Annullare la sottoscrizione

Ogni sottoscrizione restituisce una funzione `unsubscribe`. Chiamala per smettere di ricevere aggiornamenti e ripulire il listener WebSocket:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

In React, usa la pulizia di `useEffect`:

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

- All'**accesso** o all'**aggiornamento del token**, il nuovo token viene inviato al server WebSocket tramite un messaggio `authenticate`.
- Alla **disconnessione**, la connessione WebSocket viene chiusa.
- Se la connessione cade, il client **si riconnette automaticamente** e ristabilisce tutte le sottoscrizioni attive.

Non è necessaria alcuna gestione manuale dei token — l'integrazione tra `client.auth` e il livello WebSocket è gestita internamente.

## Canali di Broadcast

I canali di broadcast ti permettono di inviare messaggi arbitrari tra client connessi — ideali per chat, notifiche o funzionalità collaborative:

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

I canali sono leggeri ed effimeri — esistono finché almeno un client è sottoscritto.

> **Per impostazione predefinita, i broadcast non vengono ritrasmessi.** Raggiungono solo i membri connessi in quel momento. È ciò che serve per le notifiche che si autocorreggono — un avviso «qualcuno ha salvato» è superato dal salvataggio successivo — e non costa nulla. Per un flusso di operazioni, dove un vuoto silenzioso causa divergenza, abilita la [cronologia dei messaggi](#cronologia-dei-messaggi-e-recupero) sul canale.

## Cronologia dei Messaggi e Recupero

Un canale può essere configurato per conservare i suoi broadcast, così che un client che si riconnette recuperi ciò che ha perso invece di risincronizzarsi da zero. È questo che rende i canali utilizzabili come trasporto per l'editing collaborativo.

La conservazione si configura **sul server**, per pattern di canale — vedi [Backend Realtime](/it/docs/backend/realtime#conservazione-dei-canali). Un client non può attivarla da sé, perché un canale è creato da chi lo nomina, e una profondità di cronologia scelta dal client permetterebbe a qualsiasi visitatore di impegnare il tuo backend in uno storage illimitato.

Su un canale con conservazione, passa `{ history: true }` e il SDK fa il resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Al `join()` e dopo ogni riconnessione, il SDK chiede al server tutto ciò che segue l'ultimo numero di sequenza visto, e consegna il risultato agli stessi handler. Non c'è un secondo percorso di codice da scrivere: un handler che applica correttamente un'operazione dal vivo la applica correttamente anche in recupero.

### Numeri di sequenza

Ogni broadcast su un canale con conservazione porta un `seq` — per canale, senza vuoti e crescente. È il punto di ripresa del client.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Salva `channel.sequence` se vuoi che il recupero sopravviva anche a un ricaricamento di pagina, e restituiscilo tramite `history({ sinceSeq })`.

### Recuperare la cronologia esplicitamente

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` significa che il canale non conserva cronologia e non lo farà mai — una risposta esplicita, così puoi distinguere «non hai perso nulla» da «questo canale non ha una regola di conservazione». Nel secondo caso un client che deve convergere deve ripiegare su una risincronizzazione completa.

`latestSeq` è la sequenza più alta che il server possiede, che questo lotto l'abbia raggiunta o no. Se è molto oltre il tuo ultimo `seq` consegnato, sei indietro più di una pagina e risincronizzare può costare meno che paginare.

:::note[Le ritrasmissioni possono sovrapporsi, ed è normale]
Il server non può sapere esattamente quali messaggi ti sono arrivati prima della caduta della connessione, quindi un intervallo di recupero può includerne alcuni già applicati. Il SDK scarta tutto ciò che è pari o inferiore alla sequenza già consegnata, così gli handler non vedono mai due volte lo stesso messaggio.

I tuoi messaggi **non** vengono filtrati da una ritrasmissione: una riconnessione assegna un nuovo id client, quindi il caso stesso per cui esiste il recupero è quello in cui quel filtro fallirebbe. Rendi le operazioni idempotenti se riapplicare le tue fosse un problema.
:::
## Tracciamento della Presenza

La presenza ti permette di tracciare quali utenti sono online e di sincronizzare lo stato condiviso tra tutti i partecipanti:

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

La presenza è costruita sui canali di broadcast con un diff automatico dello stato — vengono trasmessi solo i cambiamenti.

## Quando usare il tempo reale

| Caso d'uso | Metodo |
|----------|--------|
| Dashboard con dati in diretta | `listen()` con filtri |
| Chat o messaggistica | `channel.broadcast()` |
| Editing collaborativo / flussi di operazioni | `channel(name, { history: true })` |
| Indicatori di digitazione / stato online | `channel.track()` + `channel.onPresence()` |
| Pagina di dettaglio con aggiornamenti in diretta | `listenById()` |
| Monitoraggio del pannello di amministrazione | `listen()` con `orderBy` e `limit` |

> **Suggerimento:** Per recuperi di dati una tantum, usa invece `find()` o `findById()`. Le sottoscrizioni sono ideali per dati che cambiano di frequente e devono essere riflessi immediatamente nell'interfaccia.

## Prossimi passi

- **[Interrogare i dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Autenticazione](/docs/sdk/authentication)** — Accesso e gestione delle sessioni
- **[Tempo reale nel Backend](/docs/backend/realtime)** — Configurazione WebSocket lato server
