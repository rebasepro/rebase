---
sourceHash: 40fb3fc8ab6a79a5
title: Sottoscrizioni Realtime
sidebar_label: Realtime
description: Iscriviti alle modifiche dei dati in tempo reale con l'SDK tipizzato di Rebase utilizzando listener realtime basati su WebSocket.
---

## Panoramica

L'SDK tipizzato di Rebase fornisce sottoscrizioni ai dati in tempo reale tramite WebSocket. Quando i record cambiano sul server, i callback sottoscritti vengono attivati immediatamente con i dati aggiornati.

La connessione WebSocket viene stabilita automaticamente quando è disponibile un `websocketUrl` (derivato da `baseUrl` per impostazione predefinita). La riconnessione e l'aggiornamento del token vengono gestiti automaticamente. Un'interruzione che dura più di circa 15 secondi viene segnalata una sola volta a ogni `onError` della sottoscrizione come `CONNECTION_LOST` — vedi [Autenticazione e riconnessione](#autenticazione-e-riconnessione).

## Sottoscrizione a una Collection

Usa `listen()` per sottoscriverti alla query di una collection. Il callback viene attivato ogni volta che il set di dati corrispondente cambia:

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

`FindResult<M>` ha la stessa forma restituita da `find()`: righe piatte in `data`, e `{ total, limit, offset, hasMore, nextCursor }` in `meta`.

### `listen()` accetta ciò che accetta `find()`

`params` è un `FindParams` completo. Una sottoscrizione è la stessa query del `find()` corrispondente, quindi accetta gli stessi criteri di restrizione — `where`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, **`include`** e **`fields`**:

```typescript
client.data.posts.listen(
    { where: { status: ["==", "published"] }, include: ["author"], limit: 20 },
    (result) => render(result.data)   // each row carries its author
);
```

Questo è più importante di quanto sembri. In passato `include` e `fields` venivano ignorati silenziosamente qui, quindi la stessa query rispondeva con una struttura tramite `find()` e con un'altra tramite `listen()` — e un componente che renderizzava entrambi vedeva le proprie righe cambiare struttura nel momento in cui veniva effettuata una scrittura. Ora passano attraverso la stessa identica pipeline di lettura, quindi `find({ q })` e `listen({ q })` restituiscono righe identiche campo per campo.

L'eccezione è `vectorSearch`, che viene **rifiutato** anziché ignorato: una sottoscrizione viene rieseguita a ogni scrittura corrispondente e lì nulla calcola le distanze. Usa `.vectorSearch(…).find()` per la query e sottoscriviti senza di esso.

### Un'emissione per modifica

Ogni push del server invoca il tuo callback **una sola volta**, con metadati che descrivono le righe corrispondenti. Non c'è un'emissione separata al primo rendering e nessun flag da controllare.

I metadati arrivano **nello stesso frame delle righe**: il server conteggia la query all'interno della stessa transazione vincolata alla row-level security che le ha lette, quindi `meta.total`, `meta.hasMore` e `meta.nextCursor` descrivono esattamente le righe affiancate. (In passato ogni push era seguito da un `GET /count` da parte del client — un round trip extra per scrittura, per ogni subscriber, e una finestra temporale in cui il conteggio e le righe descrivevano stati diversi della collection).

Due fallback, nessuno dei quali costituisce un errore di sottoscrizione né chiama `onError`:

- Se il **conteggio del server fallisce**, il frame non trasporta alcun totale e viene riutilizzato l'ultimo arrivato. Un conteggio fallito non dice nulla sulla dimensione della collection, quindi non deve sovrascrivere una risposta reale.
- Se non è mai arrivato alcun totale per questa sottoscrizione — un server più vecchio che non invia alcun metadato — il client lo richiede una volta, al primo push. Se anche questa richiesta fallisce, `meta.total` è un **limite inferiore (lower bound)**: le righe in questa pagina più quelle già impaginate per raggiungerle.

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

Usa `listenById()` per osservare un record specifico in base al suo ID:

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

Il callback riceve una riga piatta — non un'`Entity`, quindi non c'è `.values` — e `undefined` quando il record viene eliminato.

Ogni frame contiene le relazioni indicate da `options.include`, caricate nello stesso modo in cui `find({ include })` le carica in ogni riga di un elenco. Una relazione to-many non specificata lì è assente dalla riga, non vuota:

```typescript
client.data.posts.listenById(1, (post) => {
    console.log(post?.tags); // the post's tags, on every update
}, undefined, { include: ["tags"] });
```

**Limiti.** Viene inviato un frame quando la riga stessa cambia, e ogni frame ricarica le sue relazioni incluse. Una modifica a una riga correlata da sola non invia alcun frame: la modifica del nome di un tag non aggiorna un post ascoltato con `include: ["tags"]` finché non cambia anche il post. Per seguire le righe correlate, ascolta anche la loro collection.

## Monitoraggio di un conteggio

`listenCount()` mantiene aggiornato un conteggio: il totale di ciò che corrisponde al filtro di un elenco, utile per una toolbar o un'opzione "seleziona tutti gli N" che non deve diventare obsoleta mentre altri utenti aggiungono e rimuovono righe. Il callback viene eseguito con il totale non appena è noto, e di nuovo ogni volta che una scrittura lo modifica.

```typescript
const stop = client.data.orders.listenCount(
    { where: { status: ["==", "open"] } },
    (total) => console.log(`${total} open orders`),
    (error) => console.error(error)
);
```

Viene conteggiato solo il filtro — `where`, `logical` e `searchString`; un `limit`, un `offset` o un ordinamento vengono ignorati. Il server non legge alcuna riga per questo, solo il conteggio, sotto l'identità del subscriber come qualsiasi altro frame. Un server precedente alla versione 0.25 non riconosce la richiesta; risponde con una riga e lo stesso totale, e l'SDK legge il totale da lì. Su un client privo di socket, `listenCount()` è uno stub che lancia un'eccezione, esattamente come `listen()`. Con il [supporto offline](/docs/sdk/offline/) attivo, il conteggio è quello del server: le scritture in coda non ne fanno parte finché non vengono rieseguite (replay).

## Fluent Query Builder

Puoi anche sottoscriverti tramite il fluent query builder. Questo equivale a chiamare `listen()` con i parametri, ma ti consente di concatenare `.where()`, `.orderBy()`, ecc.:

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

Una sottoscrizione accetta un ordinamento su più colonne come qualsiasi altra query — sia con `orderBy: [["category", "asc"], ["createdAt", "desc"]]` nei parametri, sia con una seconda chiamata `.orderBy()`, che aggiunge un criterio di spareggio anziché sostituire il primo. Vedi [Ordinamento](/docs/sdk/querying#sorting).

Il server controlla la *forma* dell'`orderBy` di una sottoscrizione all'arrivo e ne rifiuta una non valida con un frame di errore anziché effettuare la sottoscrizione. Altrimenti, un ordinamento non interpretabile invierebbe le righe senza alcun ordine senza segnalare errori — e poiché un frame `collection_update` trasporta righe e nient'altro, un subscriber non avrebbe modo di accorgersene.

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

- Al **login** o al **refresh del token**, un socket già aperto acquisisce le nuove credenziali. Un refresh, o un accesso con lo stesso account già attivo, invia il token in un messaggio `authenticate`; un accesso con un account diverso — compreso un visitatore che effettua il login — ricrea il socket, che si autentica con quell'account e reinvia ogni sottoscrizione e canale attivo. Se nessun socket è aperto, non succede nulla — l'accesso non è una richiesta di realtime, e un socket aperto successivamente si autenticherà da solo.
- Al **logout**, la connessione WebSocket viene disconnessa. Il client rimane utilizzabile; una sottoscrizione successiva si riconnetterà in modo anonimo.
- Se la connessione cade, il client **si riconnette automaticamente** e ristabilisce tutte le sottoscrizioni attive. Non smette mai di tentare finché esiste una sottoscrizione o un canale a cui si è uniti; l'intervallo tra i tentativi cresce fino a un massimo di 30 secondi.
- Se il server termina la sessione del socket — l'utente si è disconnesso ovunque, questa sessione è stata revocata, l'account è stato eliminato o il token è scaduto prima che un refresh raggiungesse il socket — chiude il socket con il codice `4001`. Il client si riconnette come dopo qualsiasi caduta di connessione, autenticandosi con la sessione posseduta in quel momento (aggiornata se possibile) o in modo anonimo se non ce n'è alcuna. La revoca di un ruolo non chiude il socket: si applica a partire dal frame successivo. Vedi [Autenticazione & RLS](/docs/backend/realtime/#authentication--rls).
- Se la connessione rimane interrotta per più di circa 15 secondi, l'`onError` di ogni sottoscrizione (e l'`onError` di ogni canale a cui si è uniti) viene chiamato **una sola volta** con un `RebaseApiError` il cui `code` è `CONNECTION_LOST`. La sottoscrizione non viene terminata: continua a mostrare ciò che hai, contrassegnalo come possibilmente obsoleto (stale) e attendi. Quando il socket torna attivo, il successivo `onUpdate` della sottoscrizione trasporterà tutto ciò che è stato scritto nel frattempo.
- `client.ws.state` rappresenta lo stato della connessione — `idle`, `connecting`, `connected`, `reconnecting`, `disconnected` o `closed` — e `client.ws.onStateChange(listener)` viene notificato a ogni cambiamento. `disconnected` è lo stato in cui è stato segnalato `CONNECTION_LOST`.
- Le richieste inviate tramite il socket sono **at-most-once** (al massimo una volta). Una richiesta inviata nel momento in cui la connessione è caduta fallisce con `CONNECTION_LOST` e non viene mai reinviata, poiché il server potrebbe averla già eseguita. Una richiesta ancora in attesa di un socket dopo 30 secondi fallisce con `REQUEST_TIMEOUT` senza essere inviata.

Tutto ciò che nell'elenco segue il logout è stato introdotto nella versione 0.24.

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

Il socket si autentica con lo stesso token che trasporterebbe una richiesta HTTP. Si tratta innanzitutto del getter installato con `client.setAuthTokenGetter()`; quando non è presente, risponde `null` o lancia un errore, viene usato il token posseduto dal client: quello della sua sessione, uno impostato con `client.setToken()` o l'opzione `token`. Con il modulo integrato `client.auth` non c'è nulla da configurare.

Per un provider di autenticazione esterno (Clerk, Firebase Auth, una sessione personalizzata), installa il getter una sola volta. Copre sia HTTP che il socket:

```typescript
client.setAuthTokenGetter(() => provider.getToken());

// Optional: let the provider recover a refused token, on HTTP and the socket alike.
client.setOnUnauthorized(async () => {
    await provider.refresh();
    return true; // retry with the token resolved again
});
```

- `client.setOnUnauthorized(handler)` gestisce un token rifiutato su entrambi: un 401 su HTTP e un errore di autenticazione sul socket. Restituisci `true` per riprovare risolvendo nuovamente il token. Sostituisce il refresh della sessione nativo del client.
- L'installazione di un getter, o la chiamata a `client.setToken()`, ricrea un socket aperto: il nuovo socket si autentica con le nuove credenziali e reinvia ogni sottoscrizione e canale attivo con tale identità, e nulla di quanto apparteneva all'identità precedente viene mantenuto. Se non ci sono socket aperti, il successivo si autenticherà da solo.
- `client.ws.setAuthTokenGetter()` è deprecato. Funziona ancora, sostituendo solo il getter del socket, ed emette un avviso una sola volta. Usa `client.setAuthTokenGetter()`.

Vedi [Il tuo provider di autenticazione](/docs/sdk/your-own-auth-provider/).

### La connessione è lazy

La creazione di un client **non** apre alcun WebSocket. Viene stabilito solo alla prima operazione che ne ha effettivamente bisogno — una sottoscrizione `listen()` / `listenById()`, o un'operazione di canale come `join()`, `track()` o `broadcast()`. Ottenere un canale non significa usarlo.

```typescript
const client = createRebaseClient({ baseUrl });   // no socket
const channel = client.realtime.channel("doc:1"); // still no socket
await channel.join();                             // socket opens here
```

Questo è importante per le applicazioni con un traffico significativo di utenti non autenticati — pagine di marketing, viste pubbliche in sola lettura, strumenti anonymous-first — che in precedenza pagavano il costo di una connessione a ogni caricamento di pagina semplicemente per avere il realtime a disposizione.

Due comportamenti correlati:

- `realtime: false` rimane una disattivazione esplicita e totale: nessun socket in assoluto, e `client.realtime.channel()` lancia un'eccezione. Lo stesso vale per `listen()` e `listenById()` — sono sempre disponibili per essere chiamati, e su un client senza socket lanciano un `RebaseClientError` indicando l'opzione che li abiliterebbe. `observe()` invece non lo fa: degrada a una singola fetch.
- `client.close()` è definitivo. Rilascia il socket e il relativo timer di riconnessione, e nulla di quanto accodato successivamente tenterà una nuova connessione. In Node, un socket aperto mantiene attivo l'event loop, quindi uno script che non lo chiama mai non terminerà da solo.

### Mantenere un gruppo su una singola istanza

In presenza di più istanze del server, i membri di un canale possono finire su istanze diverse, e ogni messaggio scambiato tra loro deve quindi [attraversare il channel bus](/docs/backend/realtime-transports/#channels-and-presence-across-instances). `affinity` specifica il gruppo a cui appartiene un socket, come una stanza o un documento, consentendo alla piattaforma di indirizzare l'intero gruppo alla stessa istanza:

```typescript
const client = createRebaseClient({
    baseUrl,
    realtime: { affinity: roomCode }
});
```

Quando la chiave è nota solo in seguito, impostala prima dell'apertura del socket:

```typescript
const client = createRebaseClient({ baseUrl });

client.realtime.setAffinity(roomCode);          // no socket yet
await client.realtime.channel(roomCode).join(); // opens with the key
```

La chiave viene aggiunta all'indirizzo del socket come `?affinity=` e sostituisce quella eventualmente già presente su un `websocketUrl` configurato. `setAffinity(null)` la rimuove.

- **È un'ottimizzazione.** Rebase Cloud instrada in base ad essa quando un progetto esegue più di un'istanza. Negli ambienti self-hosted o dietro un proxy che non ne effettua l'hashing, non fa nulla e i canali funzionano allo stesso modo: il bus trasporta comunque tutto ciò che attraversa le istanze, compreso un gruppo suddiviso a seguito di uno scale-up.
- **Ha effetto quando il socket si connette.** Un socket già aperto rimane dove si trova e userà la nuova chiave alla connessione successiva. Per spostare un client già connesso, creane uno nuovo oppure imposta la chiave prima della sua prima chiamata a `join()` o `listen()`.
- **Determina dove atterra un socket, non a cosa può unirsi.** L'accesso a un canale non dipende da esso e l'indirizzo finisce nei log di accesso, quindi usa un codice anziché un segreto o qualsiasi dato personale.

Per verificare se funziona, confronta ciò che ogni istanza pubblica e ignora: vedi [Vedere cosa fa il bus](/docs/backend/realtime-transports/#seeing-what-the-bus-does).

## Canali di broadcast

I canali di broadcast ti consentono di inviare messaggi arbitrari tra client connessi — ideali per chat, notifiche o funzionalità collaborative:

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

I canali sono leggeri ed effimeri — esistono finché almeno un client è sottoscritto. Chiamate ripetute a `channel()` con lo stesso nome restituiscono lo **stesso** oggetto, consentendo a due componenti di associare gestori in modo indipendente senza che l'uscita di uno escluda l'altro.

I frame di canale e di presenza non richiedono un account: i visitatori anonimi possono unirsi ai canali pubblici.

:::caution[I canali non hanno ancora regole di accesso]
L'unico controllo applicato dal server è l'**appartenenza (membership)**: per trasmettere in broadcast in un canale, leggere il relativo elenco delle presenze (roster) o riprodurne la cronologia, un client deve prima essersi unito a quel canale. L'unione in sé è aperta — qualsiasi client in grado di specificare il nome di un canale può unirsi, indipendentemente dal fatto che abbia effettuato l'accesso o meno.

Di conseguenza, il nome di un canale non è un segreto e non rappresenta un permesso. Non inserire nulla in un canale (inclusi lo storico conservato e lo stato di presenza) che non possa essere visto da ogni utente della tua app, e non derivare il nome di un canale da dati che non condivideresti pubblicamente. Le regole di autorizzazione per canale non sono ancora implementate; se ne hai bisogno oggi, mantieni la parte sensibile dello scambio su `client.data`, dove viene applicata la row-level security.
:::

> **Per impostazione predefinita, i broadcast non vengono riprodotti (replayed).** Raggiungono solo i membri attualmente connessi. Questo è il comportamento desiderato per le notifiche che si auto-correggono — un avviso "qualcuno ha salvato" viene superato dal salvataggio successivo — e non ha alcun costo. Per un flusso di operazioni (operation stream), in cui un gap silenzioso provoca divergenze, abilita la [cronologia dei messaggi](#cronologia-dei-messaggi-e-catch-up) sul canale.

## Cronologia dei messaggi e catch-up

Un canale può essere configurato per conservare i propri broadcast, in modo che un client che si riconnette possa recuperare ciò che ha perso anziché risincronizzarsi da zero. Questo è ciò che rende i canali utilizzabili come meccanismo di trasporto per l'editing collaborativo.

La retention (conservazione) viene configurata **sul server**, per pattern di canale — vedi [Realtime Backend](/docs/backend/realtime#channel-retention). Un client non può abilitarla autonomamente, perché un canale viene creato da chiunque ne indichi il nome, e una profondità di cronologia scelta dal client consentirebbe a qualunque visitatore di vincolare il tuo backend a uno storage illimitato.

Su un canale con retention, passa `{ history: true }` e l'SDK farà il resto:

```typescript
const channel = client.realtime.channel("doc:42", { history: true });

// Handlers receive replayed messages exactly like live ones, in order.
channel.onBroadcast("op", (payload) => {
    applyOperation(payload);
});

await channel.join();
```

Su `join()` e dopo ogni riconnessione, l'SDK richiede al server tutto ciò che segue l'ultimo numero di sequenza visto, consegnando il risultato attraverso gli stessi handler. Non serve scrivere un secondo percorso di codice: un handler che applica correttamente un'operazione in tempo reale la applicherà correttamente anche durante il catch-up.

### Numeri di sequenza

Ogni broadcast su un canale con retention include un `seq` — specifico per canale, senza interruzioni (gapless) e incrementale. È il punto di ripristino per il client.

```typescript
channel.onBroadcast((event) => {
    console.log(event.seq);       // 1, 2, 3, …
    console.log(event.replayed);  // true when delivered by catch-up
});

console.log(channel.sequence); // highest seq delivered so far
```

Persisti `channel.sequence` se desideri che il catch-up sopravviva a un ricaricamento di pagina oltre che a una riconnessione, e passalo nuovamente tramite `history({ sinceSeq })`.

### Recuperare la cronologia in modo esplicito

```typescript
const { messages, retained, latestSeq } = await channel.history({
    sinceSeq: 0,
    limit: 100
});
```

`retained: false` indica che il canale non conserva alcuna cronologia e non lo farà mai — una risposta esplicita, che ti consente di distinguere "non hai perso nulla" da "questo canale non ha una regola di retention". Nel secondo caso, un client che ha bisogno di convergere deve ripiegare su una risincronizzazione completa.

`latestSeq` è il numero di sequenza più alto conservato dal server, indipendentemente dal fatto che questo batch lo abbia raggiunto o meno. Se è molto più avanti del tuo ultimo `seq` ricevuto, sei indietro di più di una pagina e risincronizzare potrebbe risultare più economico che paginare.

:::note[I replay possono sovrapporsi, ed è normale]
Il server non può sapere con esattezza quali messaggi ti abbiano raggiunto prima della caduta del socket, quindi un intervallo di catch-up potrebbe includerne alcuni che hai già applicato. L'SDK scarta qualsiasi elemento con sequenza pari o inferiore a quella già consegnata, garantendo che gli handler non vedano mai un messaggio due volte.

I tuoi messaggi vengono filtrati da un replay, esattamente come avviene in tempo reale, compresi quelli inviati prima che una riconnessione assegnasse al socket un nuovo client id: il canale ricorda gli ID da cui ha trasmesso. Un nuovo oggetto channel — ad esempio dopo il ricaricamento della pagina — non ne ricorda alcuno, quindi in quel caso il catch-up consegnerà i tuoi messaggi precedenti come quelli di chiunque altro, che è proprio ciò che serve per ricostruire lo stato dalla cronologia.
:::

## Tracciamento della presenza (Presence)

Presence consente di tracciare quali utenti sono online e sincronizzare lo stato condiviso tra tutti i partecipanti:

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

L'SDK gestisce il roster per te, quindi `presences` è sempre completo e non dovrai mai ricomporlo a partire dai diff.

Gestisce inoltre due dettagli di protocollo che è facile sbagliare quando si lavora direttamente con il WebSocket raw:

- **Il roster non viene inviato automaticamente al join.** Il primo `presence_diff` ricevuto da un client che si unisce contiene solo se stesso; il roster esistente deve essere richiesto esplicitamente. `join()` lo fa per te.
- **La presenza scade dopo 30 secondi.** `track()` non è una registrazione permanente — senza un reinvio periodico scompariresti silenziosamente dal roster di tutti gli altri pur rimanendo connesso e sulla pagina. L'SDK invia un heartbeat ogni 20 secondi e si arresta con `untrack()` / `leave()`.

Una riconnessione azzera inoltre l'appartenenza al canale e la presenza sul lato server; l'SDK esegue nuovamente il join, richiede di nuovo il roster e ripristina il tracking in modo automatico.

## Quando usare Realtime

| Caso d'uso | Metodo |
|----------|--------|
| Dashboard con dati in tempo reale | `listen()` con filtri |
| Chat o messaggistica | `channel.broadcast()` |
| Editing collaborativo / flussi di operazioni | `channel(name, { history: true })` |
| Indicatori di digitazione / stato online | `channel.track()` + `channel.onPresence()` |
| Pagina di dettaglio con aggiornamenti in tempo reale | `listenById()` |
| Monitoraggio nel pannello di amministrazione | `listen()` con `orderBy` e `limit` |
| Un elenco che deve resistere a una disconnessione | `observe()` con [offline](/docs/sdk/offline) abilitato |

> **Suggerimento:** Per il recupero di dati una tantum, usa invece `find()` o `findById()`. Le sottoscrizioni sono ideali per dati che cambiano frequentemente e devono riflettersi immediatamente nell'interfaccia utente.

## `listen()` vs `observe()`

Entrambi mantengono aggiornata una query ed entrambi restituiscono una funzione di annullamento della sottoscrizione — ma rispondono a esigenze diverse.

`listen()` è il socket: consegna ciò che il server invia tramite push e non fornisce nulla quando il socket è disconnesso.

`observe()` è la query: con la modalità [offline](/docs/sdk/offline) abilitata, emette prima dal database locale — prima di qualsiasi richiesta — e riemette alle scritture locali, alle scritture in coda che raggiungono il server, ai rollback e agli eventi realtime, a cui si iscrive autonomamente a meno che non si passi `{ realtime: false }`. Ogni risultato indica se proviene dalla cache e se contiene scritture non ancora accettate dal server.

```typescript
const unsubscribe = client.data.products.observe(
    { where: { active: ["==", true] } },
    (result) => {
        render(result.data);
        setSaving(result.hasPendingWrites);
    }
);
```

Senza la modalità offline abilitata, `observe()` corrisponde a `find()` più `listen()` in un'unica chiamata, con tali flag sempre impostati su `false`.

## Prossimi passi

- **[Querying dei dati](/docs/sdk/querying)** — Operazioni CRUD e query builder
- **[Offline & sincronizzazione local-first](/docs/sdk/offline)** — Query in tempo reale che resistono a una disconnessione
- **[Autenticazione](/docs/sdk/authentication)** — Accesso e gestione delle sessioni
- **[Backend Realtime](/docs/backend/realtime)** — Configurazione WebSocket lato server
