---
sourceHash: b9f712f58936dac9
title: Sottoscrizioni Realtime
sidebar_label: Realtime
description: Sottoscrivi le modifiche ai dati in tempo reale con l'SDK tipizzato di Rebase utilizzando listener realtime basati su WebSocket.
---

## Panoramica

L'SDK tipizzato di Rebase fornisce sottoscrizioni ai dati in tempo reale tramite WebSocket. Quando i record cambiano sul server, i callback a cui sei sottoscritto vengono attivati immediatamente con i dati aggiornati.

La connessione WebSocket viene stabilita automaticamente quando è disponibile un `websocketUrl` (derivato da `baseUrl` per impostazione predefinita). La riconnessione e il refresh del token vengono gestiti automaticamente. Un'interruzione che dura più di circa 15 secondi viene segnalata una volta, all'`onError` di ciascuna sottoscrizione, come `CONNECTION_LOST` — vedi [Autenticazione e riconnessione](#autenticazione-e-riconnessione).

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

Il metodo `listen()` accetta gli stessi `FindParams` di `find()`: puoi filtrare, ordinare e paginare la tua sottoscrizione:

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

`FindResult<M>` ha la stessa forma restituita da `find()`: righe piatte in `data`, e `{ total, limit, offset, hasMore, nextCursor }` in `meta`.

### `listen()` accetta ciò che accetta `find()`

`params` è un `FindParams` completo. Una sottoscrizione è la stessa query del `find()` adiacente, quindi accetta le stesse restrizioni — `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** e **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Questo conta più di quanto sembri. In precedenza `include` e `fields` venivano ignorati silenziosamente in questo contesto, quindi la stessa query rispondeva con una struttura tramite `find()` e con un'altra tramite `listen()` — e un componente che le renderizzava entrambe vedeva le proprie righe cambiare forma nel momento in cui veniva eseguita una scrittura. Ora attraversano la stessa identica pipeline di lettura, quindi `find({ q })` e `listen({ q })` restituiscono righe identiche campo per campo.

L'eccezione è `vectorSearch`, che viene **rifiutata** anziché ignorata: una sottoscrizione viene rieseguita a ogni scrittura corrispondente e nulla in questo contesto calcola le distanze. Usa `.vectorSearch(…).find()` per la query ed esegui la sottoscrizione senza di essa.

### Un'emissione per modifica

Ogni push del server chiama il tuo callback **una sola volta**, con metadati che descrivono le righe corrispondenti. Non c'è un'emissione separata per il rendering iniziale e nessun flag da controllare.

I metadati arrivano **nello stesso frame delle righe**: il server esegue il conteggio della query all'interno della stessa transazione vincolata alla row-level security che le ha lette, quindi `meta.total`, `meta.hasMore` e `meta.nextCursor` descrivono esattamente le righe adiacenti. (In passato, ogni push era seguito da un `GET /count` da parte del client — un round trip extra per ogni scrittura, per ogni subscriber, e una finestra temporale in cui il conteggio e le righe descrivevano stati diversi della collection.)

Due fallback, nessuno dei quali è un errore di sottoscrizione né attiva `onError`:

- Se il **conteggio del server fallisce**, il frame non trasporta alcun totale e viene riutilizzato l'ultimo arrivato. Un conteggio fallito non dice nulla sulle dimensioni della collection, quindi non deve sovrascrivere una risposta valida.
- Se non è mai arrivato alcun totale per questa sottoscrizione — un server più datato che non invia alcun metadato — il client lo richiede una sola volta, al primo push. Se fallisce anche questo, `meta.total` rappresenta un **limite inferiore**: le righe in questa pagina più quelle oltrepassate per raggiungerle.

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

Usa `listenById()` per osservare un record specifico tramite il suo ID:

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
    onError?: (error: Error) => void,
    options?: { include?: IncludeSpec }
): () => void   // returns unsubscribe function
```

Il callback riceve una riga piatta — non un'`Entity`, quindi non esiste `.values` — e `undefined` quando il record viene eliminato.

Ogni frame trasporta le relazioni specificate in `options.include`, caricate nello stesso modo in cui `find({ include })` le carica in ogni riga di un elenco. Una relazione to-many non specificata lì è assente dalla riga, non vuota:

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Limiti.** Viene inviato un frame quando la riga stessa cambia, e ogni frame ricarica le sue relazioni incluse. Una modifica a una riga correlata da sola non invia alcun frame: modificare il nome di un tag non aggiorna un post ascoltato con `include: ["tags"]` finché non cambia anche il post stesso. Per seguire le righe correlate, sottoscrivi anche la loro collection.

## Monitorare un conteggio

`listenCount()` mantiene aggiornato un conteggio: il totale degli elementi che corrispondono al filtro di un elenco, utile per una toolbar o un'opzione "seleziona tutti gli N" che non dovrebbe diventare obsoleta mentre altri utenti aggiungono e rimuovono righe. Il callback viene eseguito con il totale non appena questo è noto, e di nuovo ogni volta che una scrittura lo modifica.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Conta solo il filtro — `where`, `logical` e `searchString`; `limit`, `offset` o l'ordinamento vengono ignorati. Il server non legge alcuna riga, solo il conteggio, sotto l'identità del subscriber come qualsiasi altro frame. Un server precedente alla versione 0.25 non riconosce la richiesta; risponde con una riga e lo stesso totale, e l'SDK legge il totale da lì. Su un client privo di socket, `listenCount()` è uno stub che genera un errore (throw), esattamente come `listen()`. Con il [supporto offline](/docs/sdk/offline/) abilitato, il conteggio è quello del server: le scritture in coda non ne fanno parte finché non vengono riprodotte.

## Query Builder Fluent

Puoi anche effettuare la sottoscrizione tramite il query builder fluent. Questo equivale a chiamare `listen()` con i parametri, ma ti consente di concatenare `.where()`, `.orderBy()`, ecc.:

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

Una sottoscrizione supporta l'ordinamento su più colonne come qualsiasi altra query — sia tramite `orderBy: [["category", "asc"], ["createdAt", "desc"]]` nei parametri, sia tramite una seconda chiamata a `.orderBy()`, che aggiunge un criterio secondario anziché sostituire il primo. Vedi [Ordinamento](/docs/sdk/querying#sorting).

All'arrivo, il server controlla la *forma* dell'`orderBy` di una sottoscrizione e ne rifiuta una non valida con un frame di errore anziché sottoscrivere. Un ordinamento non leggibile altrimenti trasmetterebbe in streaming le righe senza alcun ordine senza segnalare errori — e un frame `collection_update` trasporta solo le righe e nient'altro, quindi un subscriber non avrebbe modo di accorgersene.

## Annullare la sottoscrizione

Ogni sottoscrizione restituisce una funzione `unsubscribe`. Chiamala per interrompere la ricezione degli aggiornamenti e ripulire il listener WebSocket:

```typescript
const unsubscribe = client.data.products.listen(
    undefined,
    (response) => { /* ... */ }
);

// Later, when the component unmounts or you no longer need updates:
unsubscribe();
```

In React, usa il cleanup di `useEffect`:

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

- Al **sign-in** o al **refresh del token**, un socket già aperto adotta la nuova credenziale. Un refresh, o un sign-in con l'account già presente, invia il token in un messaggio `authenticate`; un sign-in come account diverso — incluso un visitatore che effettua l'accesso — ricrea il socket, che si autentica con quell'account e reinvia ogni sottoscrizione e canale attivo. Se non ce n'è alcuno aperto, non accade nulla: l'accesso non è una richiesta di realtime, e un socket aperto in seguito si autentica autonomamente.
- Al **sign-out**, la connessione WebSocket viene chiusa. Il client rimane utilizzabile; una sottoscrizione successiva si riconnette in modo anonimo.
- Se la connessione cade, il client **si riconnette automaticamente** e ristabilisce tutte le sottoscrizioni attive. Non smette mai di tentare finché esiste una sottoscrizione o un canale a cui si è uniti; il ritardo tra i tentativi cresce fino a un massimo di 30 secondi.
- Se il server termina la sessione del socket — l'utente si è disconnesso ovunque, questa sessione è stata revocata, l'account è stato eliminato o il token è scaduto prima che un refresh raggiungesse il socket — chiude il socket con il codice `4001`. Il client si riconnette come dopo qualsiasi caduta di connessione, autenticandosi con la sessione posseduta in quel momento (aggiornata se possibile), o in modo anonimo se non ce n'è nessuna. Un ruolo revocato non chiude il socket: si applica a partire dal frame successivo. Vedi [Autenticazione & RLS](/docs/backend/realtime/#authentication--rls).
- Se la connessione rimane interrotta per più di circa 15 secondi, l'`onError` di ogni sottoscrizione (e l'`onError` di ogni canale a cui si è uniti) viene chiamato **una volta** con un `RebaseApiError` il cui `code` è `CONNECTION_LOST`. La sottoscrizione non viene terminata: continua a mostrare i dati correnti, contrassegnali come potenzialmente obsoleti e attendi. Quando il socket si ripristina, il successivo `onUpdate` della sottoscrizione trasporterà tutto ciò che è stato scritto nel frattempo.
- `client.ws.state` rappresenta lo stato della connessione — `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` o `closed` — e `client.ws.onStateChange(listener)` viene notificato a ogni cambiamento. `disconnected` è lo stato in cui è stato segnalato `CONNECTION_LOST`.
- Le richieste inviate tramite il socket sono di tipo **at-most-once** (al massimo una volta). Una richiesta inviata quando la connessione è caduta fallisce con `CONNECTION_LOST` e non viene mai reinviata, poiché il server potrebbe averla già eseguita. Una richiesta ancora in attesa di un socket dopo 30 secondi fallisce con `REQUEST_TIMEOUT` senza essere inviata.

Tutto ciò che compare nell'elenco dopo il sign-out è stato introdotto nella versione 0.24. Nella versione 0.23 il client si arrende dopo cinque tentativi di riconnessione falliti, accoda le richieste effettuate durante la disconnessione e le invia alla riconnessione, non ha `client.ws.state`, e il server non chiude mai un socket la cui sessione è terminata.

```typescript
import { RebaseApiError } from "@rebasepro/client";

const unsubscribe = client.data.orders.listen(
    { where: { status: ["==", "open"] } },
    (response) => {
        setOrders(response.data);
        setStale(false);
    },
    (error) => {
        if (error instanceof RebaseApiError && error.code === "CONNECTION_LOST") {
            setStale(true); // keep the rows; the next update clears it
            return;
        }
        setError(error);
    }
);
```

### Quale token invia il socket

Nella versione 0.24 il socket utilizza solo la sessione del client e l'opzione `token`: un getter installato con `client.setAuthTokenGetter()` non lo raggiunge mai, quindi un host che utilizza il proprio provider di autenticazione ottiene un socket anonimo.

Il socket si autentica con lo stesso token che trasporterebbe una richiesta HTTP. In primo luogo si tratta del getter installato con `client.setAuthTokenGetter()`; quando non è presente, risponde `null` o genera un'eccezione, viene usato il token posseduto dal client: quello della sua sessione, uno impostato con `client.setToken()` o l'opzione `token`. Con il sistema integrato `client.auth` non occorre configurare nulla.

Per un provider di autenticazione esterno (Clerk, Firebase Auth, una sessione proprietaria), installa il getter una volta sola. Copre sia HTTP che il socket:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` risponde a un token rifiutato su entrambi: un 401 via HTTP e un errore di autenticazione sul socket. Risolvi con `true` per riprovare con il token risolto nuovamente. Sostituisce il refresh della sessione nativo del client.
- L'installazione di un getter, o la chiamata a `client.setToken()`, ricrea un socket aperto: il nuovo socket si autentica con la nuova credenziale e reinvia ogni sottoscrizione e canale attivo con essa, e nulla di quanto apparteneva all'identità precedente viene mantenuto. Se non c'è alcun socket aperto, il successivo si autenticherà da solo.
- `client.ws.setAuthTokenGetter()` è deprecato. Funziona ancora, sostituendo solo il getter del socket, ed emette un avviso una volta sola. Usa `client.setAuthTokenGetter()`.

Vedi [Utilizzo del proprio provider di autenticazione](/docs/sdk/authentication#using-your-own-auth-provider).

### La connessione è lazy

La creazione di un client **non** apre alcun WebSocket. Viene stabilito alla prima operazione che ne ha effettivamente bisogno — una sottoscrizione con `listen()` / `listenById()`, oppure un'operazione di canale come `join()`, `track()` o `broadcast()`. Ottenere un canale non equivale a usarlo.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Questo è importante per le applicazioni con un traffico significativo di utenti non autenticati — pagine di marketing, viste pubbliche in sola lettura, strumenti prevalentemente anonimi — che in precedenza pagavano il costo di una connessione a ogni caricamento di pagina semplicemente per avere il realtime a disposizione.

Due comportamenti correlati:

- `realtime: false` rimane una disattivazione forzata: nessun socket in assoluto, e `client.realtime.channel()` genera un errore. Lo stesso vale per `listen()` e `listenById()` — sono sempre disponibili per essere chiamati, e su un client senza socket generano un `RebaseClientError` indicando l'opzione che li abiliterebbe. `observe()` non lo fa: degrada a una singola fetch.
- `client.close()` è definitivo. Rilascia il socket e il suo timer di riconnessione, e nulla di quanto accodato successivamente tenterà di ristabilire la connessione. In Node, un socket aperto mantiene attivo l'event loop, quindi uno script che non lo chiama mai non terminerà da solo.

### Mantenere un gruppo su una singola istanza

Con più di un'istanza server, i membri di un canale possono trovarsi su istanze diverse, e ogni messaggio tra di loro deve quindi [attraversare il channel bus](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` indica il gruppo a cui appartiene un socket, ad esempio una stanza o un documento, consentendo a una piattaforma di instradare l'intero gruppo sulla stessa istanza:

```typescript
const client = createRebaseClient({
    baseUrl,
    realtime: { affinity: roomCode }
});
```

Quando la chiave è nota solo in seguito, impostala prima che il socket si apra:

```typescript
const client = createRebaseClient({ baseUrl });

client.realtime.setAffinity(roomCode);          // no socket yet
await client.realtime.channel(roomCode).join(); // opens with the key
```

La chiave viene aggiunta all'indirizzo del socket come `?affinity=`, e sostituisce quella già presente su un eventuale `websocketUrl` configurato. `setAffinity(null)` la rimuove.

- **È un'ottimizzazione.** Rebase Cloud esegue il routing in base a questo parametro quando un progetto esegue più di un'istanza. Negli ambienti self-hosted, o dietro un proxy che non esegue l'hashing su di esso, non fa nulla e i canali funzionano allo stesso modo: il bus trasporta comunque tutto ciò che attraversa le istanze, compreso un gruppo suddiviso a seguito di uno scale-up.
- **Ha effetto quando il socket si connette.** Un socket già aperto rimane dove si trova e utilizzerà la nuova chiave alla connessione successiva. Per spostare un client connesso, creane uno nuovo o imposta la chiave prima del suo primo `join()` o `listen()`.
- **Determina dove atterra un socket, non a cosa può unirsi.** L'accesso a un canale non dipende da esso e l'indirizzo finisce nei log di accesso, quindi usa un codice anziché un segreto o qualsiasi dato personale.

Per verificare se funziona, confronta ciò che ciascuna istanza pubblica e ignora: vedi [Verificare cosa fa il bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Canali di broadcast

I canali di broadcast consentono di inviare messaggi arbitrari tra i client connessi — ideali per chat, notifiche o funzionalità collaborative:

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

I canali sono leggeri ed effimeri — esistono finché almeno un client è sottoscritto. Chiamate ripetute a `channel()` con lo stesso nome restituiscono lo **stesso** oggetto, in modo che due componenti possano associare handler in modo indipendente senza che l'uscita di uno escluda l'altro.

I frame di canale e di presenza non richiedono un account: i visitatori anonimi possono unirsi ai canali pubblici.

:::caution[I canali non hanno ancora regole di accesso]
L'unico controllo applicato dal server è l'**appartenenza**: per inviare broadcast in un canale, leggere il registro delle presenze (roster) o riprodurne la cronologia, un client deve essersi prima unito a quel canale. L'accesso al canale stesso è aperto — qualsiasi client che conosca il nome di un canale può unirsi, sia esso autenticato o meno.

Di conseguenza, il nome di un canale non è un segreto e non rappresenta un permesso. Non inserire in un canale nulla (inclusa la cronologia conservata e lo stato di presenza) che non possa essere visto da tutti gli utenti della tua app, e non derivare il nome di un canale da dati che non divulgheresti. Le regole di autorizzazione per canale non sono implementate; se ne hai bisogno oggi, mantieni la parte sensibile dello scambio su `client.data`, dove si applica la row-level security.
:::

> **Per impostazione predefinita, i broadcast non vengono riprodotti.** Raggiungono solo i membri attualmente connessi. Questo è il comportamento desiderato per le notifiche che si autocorregono — un avviso "qualcuno ha salvato" viene sostituito dal salvataggio successivo — e non costa nulla. Per uno stream di operazioni, in cui un'interruzione silenziosa provoca divergenze, abilita la [cronologia dei messaggi](#cronologia-dei-messaggi-e-catch-up) sul canale.

## Cronologia dei messaggi e catch-up

Un canale può essere configurato per conservare i suoi broadcast, in modo che un client che si riconnette possa recuperare ciò che ha perso invece di risincronizzarsi da zero. Questo è ciò che rende i canali utilizzabili come trasporto per l'editing collaborativo.

La retention viene configurata **sul server**, per pattern di canale — vedi [Backend Realtime](/docs/backend/realtime#channel-retention). Un client non può attivarla autonomamente, poiché un canale viene creato da chiunque ne specifichi il nome, e una profondità di cronologia scelta dal client consentirebbe a qualsiasi visitatore di vincolare il tuo backend a uno storage illimitato.

Su un canale con retention, passa `{ history: true }` e l'SDK farà il resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

A ogni `join()` e dopo ciascuna riconnessione, l'SDK richiede al server tutto ciò che segue l'ultimo numero di sequenza visualizzato, e consegna il risultato tramite gli stessi handler. Non c'è un secondo percorso di codice da scrivere: un handler che applica correttamente un'operazione dal vivo la applica correttamente anche durante il catch-up.

### Numeri di sequenza

Ogni broadcast su un canale con retention include un `seq` — per canale, senza interruzioni e incrementale. Rappresenta il punto di ripresa del client.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Fai persistere `channel.sequence` se desideri che il catch-up sopravviva sia alla riconnessione che al ricaricamento della pagina, e passalo nuovamente tramite `history({ sinceSeq })`.

### Recuperare la cronologia esplicitamente

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` indica che il canale non conserva alcuna cronologia e non lo farà mai — una risposta esplicita, che permette di distinguere tra "non hai perso nulla" e "questo canale non ha una regola di retention". Nel secondo caso, un client che deve convergere deve ripiegare su una risincronizzazione completa.

`latestSeq` è il numero di sequenza più alto conservato dal server, indipendentemente dal fatto che questo batch lo abbia raggiunto o meno. Se è molto più avanti rispetto al tuo ultimo `seq` ricevuto, sei indietro di più di una pagina e la risincronizzazione potrebbe essere più economica della paginazione.

:::note[I replay possono sovrapporsi, ed è normale]
Il server non può sapere con esattezza quali messaggi ti abbiano raggiunto prima della caduta del socket, quindi un intervallo di catch-up potrebbe includere messaggi già applicati. L'SDK scarta qualsiasi elemento con sequenza pari o inferiore a quella già recapitata, garantendo che gli handler non vedano mai un messaggio due volte.

I tuoi messaggi vengono filtrati ed esclusi dal replay, così come accade in tempo reale, inclusi quelli inviati prima che una riconnessione assegnasse al socket un nuovo ID client: il canale ricorda gli ID da cui ha trasmesso. Un nuovo oggetto channel — ad esempio dopo un ricaricamento della pagina — non ne ricorda alcuno, quindi un catch-up in quel caso consegnerà i tuoi messaggi precedenti esattamente come quelli degli altri, il che è necessario per ricostruire lo stato dalla cronologia.
:::

## Tracciamento della presenza

La presenza consente di tracciare quali utenti sono online e sincronizzare lo stato condiviso tra tutti i partecipanti:

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

L'SDK gestisce il registro (roster) per te, quindi `presences` è sempre completo e non dovrai mai ricomporlo a partire dai diff.

Gestisce inoltre due dettagli di protocollo facili da sbagliare lavorando direttamente con il WebSocket grezzo:

- **Il roster non viene inviato automaticamente al join.** Il primo `presence_diff` di un client che si unisce contiene solo se stesso; il roster esistente deve essere richiesto esplicitamente. `join()` lo fa automaticamente per te.
- **La presenza scade dopo 30 secondi.** `track()` non è una registrazione permanente — senza un reinvio periodico scomparirai silenziosamente dal roster di tutti gli altri pur rimanendo connesso e sulla pagina. L'SDK invia un heartbeat ogni 20 secondi e si interrompe su `untrack()` / `leave()`.

Una riconnessione cancella anche l'appartenenza al canale e la presenza lato server; l'SDK esegue nuovamente il join, richiede di nuovo il roster e ripete il track in automatico.

## Quando utilizzare il Realtime

| Caso d'uso | Metodo |
|----------|--------|
| Dashboard con dati live | `listen()` con filtri |
| Chat o messaggistica | `channel.broadcast()` |
| Editing collaborativo / stream di operazioni | `channel(name, { history: true })` |
| Indicatori di digitazione / stato online | `channel.track()` + `channel.onPresence()` |
| Pagina di dettaglio con aggiornamenti live | `listenById()` |
| Monitoraggio pannello di amministrazione | `listen()` con `orderBy` e `limit` |
| Un elenco che deve sopravvivere a una connessione interrotta | `observe()` con [offline](/docs/sdk/offline) abilitato |

> **Suggerimento:** Per recuperi di dati una tantum, usa invece `find()` o `findById()`. Le sottoscrizioni sono ideali per i dati che cambiano frequentemente e devono riflettersi immediatamente nell'interfaccia utente.

## `listen()` vs `observe()`

Entrambi mantengono aggiornata una query ed entrambi restituiscono una funzione di unsubscribe — ma rispondono a esigenze diverse.

`listen()` rappresenta il socket: recapita ciò che il server invia tramite push, e non recapita nulla quando il socket è disconnesso.

`observe()` rappresenta la query: con il supporto [offline](/docs/sdk/offline) abilitato, emette prima dal database locale — prima di qualsiasi richiesta — e riemette a ogni scrittura locale, quando le scritture accodate raggiungono il server, in caso di rollback e su eventi realtime, a cui si sottoscrive autonomamente a meno che non si passi `{ realtime: false }`. Ogni risultato indica se proviene dalla cache e se contiene scritture non ancora accettate dal server.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Senza offline abilitato, `observe()` corrisponde a `find()` più `listen()` in un'unica chiamata, con tali flag sempre impostati su `false`.

## Passaggi successivi

- **[Interrogazione dei dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Offline & Sincronizzazione Local-First](/docs/sdk/offline)** — Query live che sopravvivono a una connessione interrotta
- **[Autenticazione](/docs/sdk/authentication)** — Accesso e gestione delle sessioni
- **[Backend Realtime](/docs/backend/realtime)** — Configurazione WebSocket lato server
