---
sourceHash: 0a56c2d3dea31616
title: Realtime & WebSocket
sidebar_label: Realtime
description: Sincronizzazione dei dati in tempo reale, canali di broadcast e tracciamento della presenza tramite WebSocket.
---

Rebase include un motore realtime integrato che invia le modifiche ai dati ai client connessi tramite WebSocket.
Quando un record viene creato, aggiornato o eliminato, ogni sottoscrittore che osserva quella collezione o entità riceve l'aggiornamento istantaneamente — senza necessità di polling.

## Come funziona

La pipeline realtime si articola in tre fasi:

1. **Trigger del database** — Una mutazione raggiunge il database PostgreSQL (tramite API REST, SDK o Studio).
2. **Fan-out del server** — Il server Rebase rileva la modifica e la distribuisce (fan-out) a ogni sottoscrizione WebSocket attiva corrispondente alla collezione o entità interessata.
3. **Callback del client** — L'SDK tipizzato attiva il callback `onUpdate` con i nuovi dati.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Per i deployment multi-istanza, Rebase utilizza `LISTEN/NOTIFY` di PostgreSQL per trasmettere le modifiche tra le istanze del server. Questo processo è gestito automaticamente. Con la [change capture a livello di database](/docs/backend/realtime-cdc/) attiva (l'impostazione predefinita ovunque il ruolo del database possa creare trigger), ogni istanza è in ascolto sul canale `rebase_cdc` su cui pubblicano i trigger di acquisizione, così una scrittura viene sentita da qualunque processo o strumento l'abbia fatta. Senza acquisizione, ogni istanza annuncia le proprie scritture sul canale `rebase_entity_changes`, e una connessione dedicata su ogni altra istanza le ritrasmette ai propri sottoscrittori locali.

### Zero configurazione

Il realtime è abilitato per impostazione predefinita. Non ci sono flag da attivare o servizi da avviare: se il server Rebase è in esecuzione, l'endpoint WebSocket è disponibile.

### Quale percorso risponde al socket

Su 0.24 il socket accetta ogni upgrade WebSocket del server, qualunque sia il suo percorso.

Il socket risponde agli upgrade su un solo percorso: il percorso base dell'API privato di un eventuale `/api` finale, quindi `/` per un'API su `/api`. È lì che si connette l'SDK: si collega al proprio `baseUrl`, mentre le sue richieste HTTP vanno a `${baseUrl}/api`. Un upgrade verso qualsiasi altro percorso viene lasciato agli altri listener `upgrade` del server, così la tua app può eseguire un proprio server WebSocket sullo stesso `http.Server`. Se non c'è nessun altro listener, un upgrade del genere riceve come risposta `404`.

In un [server personalizzato](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` imposta il percorso, e `realtime.path` dell'adattatore Postgres sostituisce quello che il server aveva derivato.

> Per impostazione predefinita, Rebase emette anche eventi realtime per le scritture effettuate **all'esterno** dell'API (tramite `psql`, un altro servizio o l'editor SQL di Studio) ogni volta che la connessione al database lo supporta — consulta [acquisizione delle modifiche a livello di database (CDC)](/docs/backend/realtime-cdc/).

## Sottoscrizioni dell'SDK tipizzato

L'SDK tipizzato di Rebase espone due metodi di sottoscrizione su ciascun accessor di collezione:

- **`listen()`** — Sottoscrive un'intera collezione (con filtri opzionali).
- **`listenById()`** — Sottoscrive una singola entità tramite il suo ID.

Entrambi i metodi restituiscono una **funzione di annullamento della sottoscrizione** (unsubscribe) da chiamare per interrompere la ricezione degli aggiornamenti.

### Sottoscrivere una collezione

Usa `listen()` per ricevere aggiornamenti ogni volta che i record in una collezione cambiano:

```typescript
const unsubscribe = client.data.products.listen(
  undefined, // FindParams — pass undefined for all records
  (response) => {
    console.log("Products updated:", response.data);
    console.log("Total:", response.meta.total);
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

Il callback riceve un `FindResponse<M>` contenente:
- `data` — Array di oggetti `Entity<M>`.
- `meta` — Informazioni di paginazione (`total`, `limit`, `offset`, `hasMore`).

### Sottoscrivere una collezione con filtri

Passa `FindParams` come primo argomento per filtrare la sottoscrizione:

```typescript
const unsubscribe = client.data.products.listen(
  {
    where: { status: ["==", "published"] },
    orderBy: ["createdAt", "desc"],
    limit: 50,
  },
  (response) => {
    console.log("Published products:", response.data);
  }
);
```

Il server rispetta questi filtri: solo i record corrispondenti vengono inclusi negli aggiornamenti.

### Sottoscrivere una singola entità

Usa `listenById()` per osservare un record specifico:

```typescript
const unsubscribe = client.data.products.listenById(
  "product-123",
  (row) => {
    if (row) {
      console.log("Product updated:", row.name);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

Il callback riceve la riga, piatta, come la restituisce `findById()` (`row.name`, non `row.values.name`), oppure `undefined` una volta eliminata la riga.

**Ogni frame porta la versione della riga.** `etagOf(row)` è l'`ETag` che risponde un `GET` della riga, quindi una modifica fatta su ciò che un frame mostrava può essere salvata con `ifMatch: etagOf(row)` e viene rifiutata con `412` se la riga nel frattempo è cambiata (vedi [Scritture condizionali](/docs/backend/writes/)). Sul wire, `subscribe_one` dell'SDK chiede con `etag: true`, e ogni frame `single_update` per una riga esistente porta `"etag"` accanto a `"row"`. Un server precedente ignora la richiesta e non invia alcun tag, e un client che non lo chiede riceve frame senza.

### Annullare la sottoscrizione

Sia `listen()` che `listenById()` restituiscono una funzione di disiscrizione. Chiamala per interrompere la ricezione degli aggiornamenti e liberare le risorse lato server:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Chiama sempre la funzione di annullamento della sottoscrizione quando un componente viene smontato (unmount) o si cambia pagina. Ciò previene memory leak e lavoro non necessario lato server.
:::

## Query Builder `.listen()`

Anche il query builder supporta le sottoscrizioni in tempo reale. Concatena i filtri e poi chiama `.listen()` invece di `.find()`:

```typescript
const unsubscribe = client.data.orders
  .where("status", "==", "pending")
  .orderBy("createdAt", "desc")
  .limit(20)
  .listen(
    (response) => {
      console.log("Pending orders:", response.data);
    },
    (error) => {
      console.error("Error:", error);
    }
  );
```

:::note
Il metodo `.listen()` sul query builder è disponibile solo quando `RebaseClient` è configurato con un `websocketUrl`. Se la connessione WebSocket non è configurata, la chiamata a `.listen()` genererà un errore.
:::

## Distribuzione degli aggiornamenti: Patch istantanea + Refetch di correttezza

Una modifica non viaggia mai verso un sottoscrittore sotto forma di dati. Viaggia come la notifica che qualcosa è cambiato, e a ogni sottoscrittore viene poi comunicato cosa *può* visualizzare tramite una query eseguita per suo conto:

1. **Invalidazione.** Quando un'entità cambia (creata, aggiornata, eliminata), il server contrassegna i percorsi interessati. La riga che è stata scritta non viene inoltrata — è stata letta con l'autorizzazione di chi scrive, che non dice nulla su ciò che un qualsiasi sottoscrittore è autorizzato a visualizzare.

2. **Refetch RLS con debounce.** Dopo **300ms** (`REFETCH_DEBOUNCE_MS`), il server riesegue il fetch della collezione con i filtri e l'ordinamento originali. La query viene eseguita all'interno di una transazione che imposta `app.user_id` e `app.user_roles` a livello di transazione in base al `SubscriptionAuthContext` del sottoscrittore, in modo che Postgres valuti la Row-Level Security sotto l'identità di quel client e solo le righe che è autorizzato a visualizzare vengano inviate nel `collection_update`. Il debounce unifica inoltre una raffica di scritture in un'unica query. Attende 300 ms senza ulteriori modifiche, ma mai più di **1 s** (`REFETCH_MAX_WAIT_MS`) dopo la prima, così una collection scritta più volte al secondo invia comunque ai suoi sottoscrittori un frame almeno una volta al secondo. Imposta questo limite con `REALTIME_REFETCH_MAX_WAIT_MS` (o `realtime.refetchMaxWaitMs`): più alto, una tabella molto scritta viene riletta meno spesso; più basso, i frame sono più freschi.

   Un refetch che legge esattamente ciò che a un sottoscrittore è stato inviato per ultimo non gli invia nulla: una scrittura sulla riga 9.000 di un elenco che mostra le prime 50 costa la lettura, non un frame a ogni spettatore. Dopo un frame di errore, le righe successive vengono inviate di nuovo anche se sono le stesse.

Le versioni precedenti inviavano un `collection_patch` immediato contenente la riga scritta prima di questo refetch, per un feedback cross-tab inferiore al millisecondo. Quella riga era stata letta nell'ambito dei permessi di chi scriveva, quindi poteva — ed è successo — raggiungere sottoscrittori le cui policy l'avrebbero vietata, e neanche il filtro `where` della sottoscrizione stessa veniva applicato ad essa. La patch è stata rimossa: la latenza percepita per un aggiornamento è ora la finestra di debounce.

### Il refetch è la lettura REST

Il refetch esegue la stessa pipeline eseguita da `GET /api/data/<collection>`, con la stessa gestione di `include`. È questo che garantisce che `find({ q })` e `listen({ q })` restituiscano righe identiche campo per campo.

In precedenza si trattava di un metodo differente — uno che annidava ogni relazione all'interno di una busta `{ "__type": "relation" }` e, poiché una sottoscrizione non poteva includere alcun `include`, caricava in modo eager **ogni** relazione dichiarata dalla collezione. Di conseguenza, la stessa query rispondeva con un formato via HTTP e con un altro tramite socket, e un client che renderizzava entrambi vedeva la struttura delle righe cambiare nel momento esatto in cui veniva effettuata una scrittura.

Un frame di sottoscrizione accetta quindi gli stessi parametri di una richiesta di elenco: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` e `fields`. `vectorSearch` fa eccezione e viene **rifiutato** con `VECTOR_SEARCH_NOT_LIVE` — una sottoscrizione viene rieseguita a ogni scrittura corrispondente e nulla in quel contesto calcola le distanze.

### `collection_update` include i propri metadati

Il frame è `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` viene calcolato all'interno della stessa transazione vincolata da RLS che ha letto le righe, descrivendo quindi con esattezza le righe adiacenti. Senza di esso, un client che necessitava di un totale doveva inviare un `GET /count` **per ogni push** — un round trip aggiuntivo per scrittura, per sottoscrittore, e una finestra temporale in cui il conteggio e le righe descrivevano stati differenti della collezione.

Quando il conteggio stesso fallisce, il frame contiene `partial: true` e nessun `total`; questo non costituisce un errore di sottoscrizione, e il client dovrebbe mantenere l'ultimo totale effettivo anziché sostituirlo con la lunghezza della pagina. Su una tabella grande il conteggio è la parte maggiore del costo di un frame. Con `REALTIME_RECOUNT_INTERVAL_MS` impostato, un elenco il cui ultimo totale era di almeno `REALTIME_RECOUNT_MIN_ROWS` (100.000 per impostazione predefinita) riutilizza quel totale per l'intervallo invece di contare a ogni scrittura, e un frame del genere porta `meta.totalAsOf`, il momento in cui il totale è stato calcolato. Se non è impostato, come per impostazione predefinita, ogni frame conta.

### Cosa costa una scrittura, e i limiti

Poiché ogni frame è una query eseguita come il suo sottoscrittore, il costo di
una scrittura cresce con il numero di **domande distinte poste da principal
distinti** sulla collection che ha toccato — non con il numero di socket
aperti:

- Le sottoscrizioni che pongono la stessa domanda (stesso percorso, filtri,
  ordinamento, pagina, `include`, `fields`, ricerca) come lo stesso principal
  (stesso id utente, ruoli, flag guest e claim) condividono un unico refetch.
  Una scrittura su un elenco costa **una transazione per ciascun gruppo di
  questo tipo** — la lettura e il suo conteggio — indipendentemente da quanti
  socket lo mantengano; ogni membro riceve comunque un frame costruito da righe
  lette sotto quella identità. Una prima pagina che torna più corta del proprio
  `limit` è l'intero insieme, quindi non viene conteggiata affatto.
- Una sottoscrizione a un singolo record viene interrogata solo quando il suo
  stesso record cambia.
- Principal diversi non condividono mai una lettura — è questo che impedisce
  a un frame di trasportare una riga che il suo lettore non può vedere. Un
  elenco osservato da mille utenti autenticati diversi corrisponde a mille
  letture e mille conteggi per ogni scrittura su di esso, in mille transazioni.

Misurato su un laptop rispetto a un PostgreSQL locale con un pool di 20
connessioni, una scrittura su un elenco:

| Sottoscrittori | Transazioni per la scrittura | Ultimo frame dopo la scrittura |
|-------------|----------------------------|----------------------------|
| 1.000, un solo principal | 2 | ~310 ms |
| 1.000, ciascuno un principal diverso | ~1.000 | ~600 ms |

300 ms di ciascuno sono il debounce. La seconda riga è il limite massimo da
pianificare. I refetch girano sullo stesso pool del tuo traffico REST, ma al
massimo su un quarto delle sue connessioni alla volta (5 delle 20 predefinite,
mai meno di 2); le altre attendono il proprio turno nel server, quindi il
fan-out di una scrittura ritarda i propri frame anziché le tue richieste. Una
collection scritta più volte al secondo mentre **centinaia di utenti diversi**
osservano lo stesso elenco è il punto in cui quei frame cominciano ad
accumulare ritardo. Oltre quella soglia, preferisci
sottoscrizioni più ristrette (una pagina, un filtro sulle righe proprie
dell'utente) oppure un [canale di broadcast](#canali-di-broadcast) che
trasporta la modifica, lasciando che i client eseguano il refetch secondo i
propri tempi.

**Un socket può mantenere al massimo 1.000 sottoscrizioni.** La successiva
viene rifiutata con un frame di errore con codice `TOO_MANY_SUBSCRIPTIONS`;
risottoscriversi con un id già posseduto dal socket sostituisce quella
sottoscrizione e non conta di nuovo. L'SDK condivide le sottoscrizioni
identiche su un socket, quindi questo conta gli elenchi e i record distinti
che una pagina ha aperti. Modificalo con
`REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` oppure
`realtime.maxSubscriptionsPerSocket` sull'adapter Postgres (la variabile
d'ambiente prevale); un valore che non è un numero intero positivo blocca
l'avvio del server. Sulla 0.23 le sottoscrizioni di un socket non sono
limitate. **Anche i socket di un singolo utente possono essere limitati**, per istanza del server: imposta `REALTIME_MAX_SOCKETS_PER_USER` (o `realtime.maxSocketsPerUser`), e un accesso oltre il limite viene rifiutato con `TOO_MANY_SOCKETS` e il socket chiuso con 4002. Se non è impostato, come per impostazione predefinita, non c'è alcun tetto.

Un id di sottoscrizione è proprio del socket: due client che nominano
entrambi una sottoscrizione `"sub-1"` mantengono ciascuno la propria, e un
`unsubscribe` termina solo quella del mittente.

**Sottoscriversi conta ai fini del rate limit dei dati.** Il primo frame di una sottoscrizione è una lettura, eseguita come il sottoscrittore, e lo è anche la richiesta di cronologia di un canale. Quindi `subscribe_collection`, `subscribe_one` e `channel_history` contano come richieste di dati nel bucket di rate limit del chiamante (quello che condividono le sue richieste HTTP e i suoi altri socket) una volta esaurita la quota propria del socket. Ogni socket può inviarne 1.000 senza che vengano contati, o tanti quanto il suo tetto di sottoscrizioni quando questo è più alto, e la quota si ripristina in 15 minuti. È tutto ciò che un socket può contenere, quindi la risottoscrizione dopo una riconnessione non viene mai rifiutata e non consuma mai il budget della persona. Oltre la quota, un frame oltre il limite viene rifiutato con un frame di errore con codice `RATE_LIMITED`, che l'SDK consegna all'`onError` di quella sottoscrizione, o a quello del canale. Sulla 0.23 questi frame contano solo rispetto al budget proprio del socket di 2.000 frame al minuto.

### Socket che smettono di rispondere

Un client può sparire senza chiudere il proprio socket: un
telefono perde il segnale, un portatile va in sospensione, un NAT dimentica la
connessione. Non arriva alcun frame di chiusura, quindi nessuno lo dice al
server. Per questo il server invia un ping a ogni socket ogni 30 secondi e
termina quello che non ha risposto entro il ping successivo, così un client
sparito viene rilasciato entro un minuto. I browser e l'SDK rispondono ai ping
da soli; un client che parla direttamente il protocollo deve rispondere anche
lui, come fa la maggior parte delle librerie WebSocket.

**Il lato browser.** Un browser non può inviare né vedere un ping, quindi un socket semiaperto gli sembra connesso per sempre. L'SDK apre il socket con `?rebase_caps=heartbeat,channel_seq,cancel_sql`; un server che le conosce risponde con `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, elencando quelle che onora (`cancel_sql`: accetta il frame `CANCEL_SQL` della console SQL), e invia `{"type":"heartbeat"}` ogni 30 secondi, e l'SDK abbandona il socket e [si riconnette](#riconnessione-automatica) dopo due mancati. Un client che non nomina nulla non riceve né l'uno né l'altro, e un server più vecchio ignora il parametro, quindi un SDK che parla con uno di essi si comporta come prima.

Un socket viene terminato anche quando più di 16&nbsp;MiB di frame inviati a lui
sono ancora da leggere. È un client che non legge ciò che gli viene inviato, o
uno così indietro che ciò che leggerebbe è ormai superato. E quando i socket di un
server insieme hanno più di 256&nbsp;MiB non letti (o un quarto del limite di
memoria con cui il server gira, quando è minore), vengono terminati per primi
quelli con più dati non letti, finché i restanti non ci stanno.

Un socket terminato viene ripulito come uno chiuso. Le sue sottoscrizioni
terminano, lascia i suoi canali e la sua presenza viene rimossa, con l'uscita
annunciata agli altri membri. Un client ancora presente vede cadere la
connessione, e l'SDK [si riconnette](#riconnessione-automatica) e sottoscrive di
nuovo. Nella 0.23 un socket del genere resta aperto finché il sistema operativo
non rinuncia alla connessione (circa due ore su Linux), e ogni scrittura in una
collezione a cui è sottoscritto continua a costare un refetch per lui.

## Canali di broadcast

I canali di broadcast consentono ai client di inviarsi messaggi arbitrari reciprocamente in tempo reale — utili per funzionalità come indicatori di digitazione, posizioni del cursore o notifiche personalizzate.

Il broadcast è gestito a livello di protocollo WebSocket. Il server supporta i seguenti tipi di messaggio:

| Tipo di messaggio | Direzione       | Descrizione                              |
|-------------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Unisciti a un canale con nome            |
| `leave_channel`   | Client → Server | Lascia un canale                         |
| `broadcast`       | Client → Server | Invia un messaggio a tutti i membri del canale |
| `broadcast`       | Server → Client | Ricevi un messaggio da un altro membro   |
| `channel_history` | Client → Server | Richiedi i messaggi conservati dopo una sequenza |
| `channel_history` | Server → Client | I messaggi conservati che un client ha perso |

Quando un client invia un messaggio `broadcast`, il server lo ritrasmette a **tutti gli altri membri** di quel canale (il mittente non riceve il proprio messaggio).

```typescript
// Broadcast message structure (sent by client)
{
  type: "broadcast",
  payload: {
    channel: "room-42",
    event: "typing",
    payload: { userId: "user-1", isTyping: true }
  }
}

// Received by other clients in the channel
{
  type: "broadcast",
  channel: "room-42",
  event: "typing",
  payload: { userId: "user-1", isTyping: true }
}
```

## Conservazione dei canali (Channel Retention)

Per impostazione predefinita, un broadcast raggiunge i membri attualmente connessi e poi scompare. Questo è il giusto compromesso per notifiche e cursori, e ha costo zero.

Per un flusso di operazioni — editing collaborativo, o qualsiasi situazione in cui un gap silenzioso causa divergenza — un canale può essere configurato per **conservare** i propri messaggi. Ai broadcast conservati viene assegnato un numero di sequenza per canale e vengono archiviati, in modo che un client che si riconnette possa richiedere tutti i messaggi successivi all'ultimo visualizzato.

:::caution[Dove configurarlo]
**Runtime gestito: da nessuna parte.** La conservazione dei canali e `realtime.bus` fanno parte dell'adattatore del database che il runtime gestito costruisce autonomamente, e nessuno dei due prevede variabili d'ambiente. Esegui l'eject per configurarli.
**Ejected:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
:::

La conservazione è opzionale (opt-in) e viene configurata qui, sul server:

```typescript
import { initializeRebaseBackend } from "@rebasepro/server";
import { createPostgresAdapter } from "@rebasepro/server-postgres";

await initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({
        connection: db,
        schema: { tables, enums, relations },
        realtime: {
            channels: [
                // Most specific first — the first match wins.
                { match: "doc:draft:*", limit: 100 },
                { match: "doc:*", limit: 500, ttl: "24h" }
            ]
        }
    })
});
```

| Campo   | Descrizione                                                                 |
|---------|-----------------------------------------------------------------------------|
| `match` | Nome esatto del canale (`"doc:42"`) o prefisso con `*` finale (`"doc:*"`)    |
| `limit` | Mantieni al massimo questo numero dei messaggi più recenti per canale       |
| `ttl`   | Mantieni i messaggi al massimo per questa durata — `"30s"`, `"15m"`, `"24h"`, `"7d"` o millisecondi |

Una regola richiede almeno uno tra `limit` e `ttl`. Una regola priva di entrambi viene ignorata e registrata nei log, poiché una conservazione illimitata non è quasi mai voluta e non può essere revocata facilmente una volta che la tabella è cresciuta.

:::note[Perché non permettere ai client di richiedere la cronologia?]
Un canale viene creato da chiunque ne specifichi il nome. Se un client potesse scegliere la profondità della propria cronologia, qualsiasi visitatore potrebbe costringere il tuo backend a un'archiviazione illimitata. Configurarlo qui garantisce inoltre che i canali di presenza e notifica — la stragrande maggioranza — abbiano costo zero: senza regole configurate, non viene creata alcuna tabella e il broadcast segue lo stesso percorso sincrono di sempre.
:::

### Archiviazione

I canali con conservazione utilizzano due tabelle nello schema `rebase`, create automaticamente all'avvio quando è configurata almeno una regola:

| Tabella                   | Contenuto                                                       |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | I messaggi conservati, indicizzati per `(channel, seq)`         |
| `rebase.channel_cursors`  | Il numero di sequenza più alto emesso per canale                |

Il pruning (eliminazione periodica) avviene all'arrivo dei messaggi, con throttling per canale in modo che il costo segua il tempo trascorso anziché il volume di scrittura. Rimuove esclusivamente righe da `channel_messages` — i cursori vengono mantenuti a tempo indeterminato (costituiscono una singola riga di dimensioni ridotte per canale), poiché azzerare la sequenza di un canale altererebbe il significato del punto di ripresa memorizzato dal client.

### Garanzie di recapito

- **Ordinato.** I numeri di sequenza sono allocati per canale e l'ordine di recapito corrisponde all'ordine di sequenza — su un'unica istanza, e tra più istanze sul bus `postgres`, dove l'istruzione che numera un messaggio lo annuncia anche, cosicché ogni istanza (compresa quella del mittente) riceve gli annunci in ordine di sequenza. Un bus fornito da te trasporta i frame nell'ordine in cui li recapita.
- **Persistente prima del recapito.** Un messaggio che non può essere salvato non viene recapitato a nessuno, e il mittente viene notificato. Recapitarlo lo mostrerebbe ai sottoscrittori connessi escludendolo da qualsiasi replay futuro, e nessun messaggio successivo potrebbe sanare tale vuoto.
- **At-least-once durante il recupero.** Un intervallo di replay può sovrapporsi a messaggi che un client ha già ricevuto; l'SDK scarta quelli già recapitati.
- **Nessun buco.** Un messaggio conservato raggiunge ogni membro: il mittente, a cui non viene mai inviato il proprio messaggio, riceve invece `{"type":"broadcast_ack","channel","seq"}` quando ha scelto `channel_seq`. Quindi un messaggio oltre `lastSeq + 1` significa che uno è stato perso, e l'SDK lo trattiene, chiede la cronologia intermedia e li consegna tutti in ordine. Con un server senza `channel_seq`, un salto viene consegnato così com'è arrivato.

:::caution[La cronologia adotta lo stesso modello di accesso del canale]
Un client che si è unito a un canale può riprodurre (replay) i suoi messaggi conservati, inclusi quelli inviati prima del suo arrivo — l'appartenenza è l'unico controllo, e l'accesso è consentito a qualsiasi client che conosca il nome del canale. La conservazione è opt-in per pattern di canale, quindi abilitarla rende lo storico del canale leggibile a qualsiasi visitatore che ne indovini il nome. Nei canali conservati questo aspetto diventa persistente anziché temporaneo: considera quindi i contenuti di un canale conservato come pubblici per i tuoi utenti.
:::

## Tracciamento della presenza (Presence)

La presence tiene traccia di quali utenti sono attualmente online in un canale e consente a ciascun utente di condividere uno stato personalizzato (es. posizione del cursore, stato).

| Tipo di messaggio | Direzione       | Descrizione                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Avvia il tracciamento della presenza con stato personalizzato |
| `presence_untrack`| Client → Server | Interrompi il tracciamento della presenza            |
| `presence_state`  | Client → Server | Richiedi lo stato completo della presenza per un canale |
| `presence_state`  | Server → Client | Entità completa di tutte le presenze in un canale    |
| `presence_diff`   | Server → Client | Aggiornamento incrementale (ingressi e uscite)       |

Quando un client invia `presence_track`, il server lo unisce automaticamente al canale (senza necessità di una chiamata separata a `join_channel`) e trasmette in broadcast un `presence_diff` a tutti i membri del canale. L'SDK rinvia il proprio stato ogni ~20 secondi come heartbeat; un heartbeat il cui stato è invariato aggiorna soltanto il timeout del client e non invia alcun `presence_diff`.

```typescript
// Track presence
{
  type: "presence_track",
  payload: {
    channel: "document-edit-42",
    state: { name: "Alice", cursor: { line: 10, col: 5 } }
  }
}

// Presence diff received by other clients
{
  type: "presence_diff",
  channel: "document-edit-42",
  joins: { "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } } },
  leaves: {}
}

// Full presence state response
{
  type: "presence_state",
  channel: "document-edit-42",
  presences: {
    "client-abc": { name: "Alice", cursor: { line: 10, col: 5 } },
    "client-def": { name: "Bob", cursor: { line: 22, col: 0 } }
  }
}
```

Le presenze inattive vengono eliminate automaticamente dopo 30 secondi di inattività.

## Riconnessione automatica

L'SDK tipizzato si riconnette automaticamente in caso di caduta della connessione WebSocket:

- **Backoff esponenziale** — Ogni ricomposizione attende un intervallo che parte da 2 secondi e raddoppia ogni volta, fino a 30 secondi. Il ritardo viene estratto a caso da qualunque punto dell'intervallo, ma mai sotto un quarto di secondo, in modo che i client caduti insieme a causa di un deploy tornino distribuiti sull'intero intervallo anziché nello stesso istante.
- **Nessuna resa finché qualcosa è attivo** — Mentre esiste una sottoscrizione o un canale cui si è aderito, il client continua a ricomporre al limite massimo di 30 secondi per tutta la durata dell'interruzione. Senza nulla registrato, si arresta dopo 5 tentativi falliti, e la sottoscrizione successiva richiama di nuovo. In un browser, l'evento `online` e la tab che torna visibile ricompongono entrambi immediatamente invece di attendere il backoff.
- **Le interruzioni vengono segnalate una sola volta** — Quando la connessione è inattiva da 14 secondi, quanti che siano i tentativi serviti, l'`onError` di ogni sottoscrizione attiva e l'`onError` di ogni canale cui si è aderito ricevono un `RebaseApiError` con codice `CONNECTION_LOST`. La sottoscrizione viene **mantenuta**: l'errore indica che i suoi dati non si stanno aggiornando, non che è terminata.
- **Risottoscrizione automatica** — In caso di riconnessione riuscita, tutte le sottoscrizioni attive vengono nuovamente registrate sul server, e il successivo `onUpdate` di ciascuna porta tutto ciò che è stato scritto mentre il client era assente. Quell'aggiornamento è il segnale di recupero. Non è richiesto alcun intervento manuale.
- **Le richieste sono at-most-once** — Una richiesta effettuata mentre il socket è inattivo attende che torni, per un massimo di 30 secondi dalla chiamata, e poi fallisce con `REQUEST_TIMEOUT` senza essere mai inviata. Una richiesta già inviata quando la connessione è caduta fallisce con `CONNECTION_LOST` e **non** viene inviata di nuovo: il server potrebbe averla eseguita o no, e solo il chiamante sa se eseguirla due volte è sicuro.

`client.ws.state` indica lo stato della connessione, e `onStateChange` viene
informato di ogni cambiamento. Sulla 0.23 nessuno dei due esiste, il client si
arresta dopo 5 tentativi falliti, e i messaggi inviati mentre si è
disconnessi vengono accodati e inviati dopo la riconnessione:

| Stato | Significato |
|---|---|
| `idle` | Nessun socket, e nessuno ancora desiderato (la connessione è lazy), oppure un logout lo ha chiuso. |
| `connecting` | In fase di chiamata, senza alcuna interruzione in corso. |
| `connected` | Il socket è aperto. |
| `reconnecting` | Il socket è caduto e il client sta ricomponendo. Non è stato ancora segnalato nulla. |
| `disconnected` | L'interruzione dura da circa 15 secondi o più. `CONNECTION_LOST` è stato segnalato, e il client continua a ricomporre. |
| `closed` | È stato chiamato `client.close()`. Definitivo. |

È possibile ascoltare gli eventi del ciclo di vita della connessione:

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
const ws = client.ws;
if (ws) {
    ws.onStateChange((state) => {
        showOfflineBanner(state === "disconnected");
    });
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

Il pannello di amministrazione di Rebase mostra un proprio banner mentre lo stato è `disconnected`, mantenendo sullo schermo le righe e i record già presenti invece di sostituirli con un errore.

## Autenticazione e RLS

Le sottoscrizioni WebSocket rispettano automaticamente i criteri di Row-Level Security (RLS). Quando il client è autenticato:

1. La connessione WebSocket si autentica utilizzando lo stesso token JWT dell'API REST.
2. Ogni refetch della sottoscrizione viene eseguito all'interno di una transazione PostgreSQL con `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)` — garantendo l'applicazione delle policy RLS.
3. L'identità viene controllata di nuovo per tutta la durata in cui il socket resta aperto, non solo quando si autentica. Prima di ogni frame il server si chiede ciò che chiederebbe una richiesta HTTP: il token è ancora valido, la sua sessione è stata disconnessa o revocata, l'account esiste ancora, e quali ruoli possiede ora. I frame di canale vengono interrogati al massimo una volta al secondo. I frame che arrivano su un socket mentre il suo controllo è ancora in corso — un client che reinvia le proprie sottoscrizioni dopo una riconnessione — condividono quel controllo anziché chiedere ciascuno di nuovo; il frame successivo al suo completamento chiede da capo. Un socket che si limita ad ascoltare viene interrogato almeno ogni 30 secondi, e un token smette di essere rispettato nell'istante in cui scade. Un ruolo rimosso si applica dal frame successivo (o, per un frame che ha condiviso un controllo già in corso, da quello dopo), sia alle letture che alle scritture e alle sottoscrizioni aperte. Un socket la cui identità è terminata riceve un frame `AUTH_ERROR` ed è chiuso con codice `4001`. Con l'autenticazione integrata il codice del frame dice il perché, come lo dicono le route HTTP: `SESSION_REVOKED` (disconnessa, revocata, o l'account eliminato), `ACCOUNT_DISABLED` o `TOKEN_EXPIRED`; quello di un altro adapter di autenticazione è `SESSION_ENDED`. Un `AUTHENTICATE` per una sessione revocata o un account disattivato viene rifiutato con `SESSION_REVOKED` o `ACCOUNT_DISABLED` (un token che non si verifica, o che è scaduto, con `INVALID_TOKEN`). L'SDK non chiede di nuovo con lo stesso token, e consegna il rifiuto, codice incluso, all'`onError` di ciò che aveva bisogno dell'account. L'SDK riautentica il proprio socket ogni volta che aggiorna il token; un nuovo token per la stessa identità (lo stesso id utente, ruoli, flag guest e claim) lascia le sottoscrizioni aperte così come sono, e uno per un'identità diversa le rilegge tutte come quella. Dopo un `4001` si riconnette con la sessione che possiede in quel momento, o con nessuna. Un client che implementa direttamente il protocollo deve inviare un token aggiornato tramite `AUTHENTICATE` prima che quello vecchio scada.

Ciò significa che ogni socket riceve aggiornamenti solo per i record che la sua identità autenticata ha il permesso di visualizzare.

Anche una [chiave API](/docs/backend/api-keys/) autentica il socket: invia la chiave
`rk_…` dove andrebbe l'access token. Il socket verifica quindi ogni frame
rispetto agli [scope](/docs/backend/roles-and-scopes/) della chiave: un fetch, un conteggio o una
sottoscrizione richiedono `data:read` sulla loro collezione, un salvataggio `data:write`, un'eliminazione
`data:delete`. Un percorso annidato richiede lo scope semplice. I canali (broadcast e
presence) sono rifiutati per una chiave, perché nessuno scope li copre. I messaggi dell'editor SQL e
dei branch richiedono `database:read` o `database:write`, sia per una chiave sia per una
persona.

L'esecuzione di più istanze — il bus LISTEN/NOTIFY, il comportamento della presence tra processi e la scrittura di un transport personalizzato — è descritta in una pagina dedicata:
[Realtime tra istanze](/docs/backend/realtime-transports/).

## Acquisizione delle modifiche a livello di database (CDC)

→ [Acquisizione delle modifiche a livello di database (CDC)](/docs/backend/realtime-cdc/)

## Timeout delle richieste in sospeso (Pending Request Timeout)

Per evitare che le richieste dei client rimangano bloccate a tempo indeterminato, tutte le operazioni WebSocket in sospeso che prevedono una risposta dal server (come il recupero occasionale di collezioni `FETCH_COLLECTION`, il recupero di singole entità `FETCH_ONE`, creazione/aggiornamento `SAVE`, eliminazioni `DELETE`, conteggi `COUNT` e controlli di univocità `CHECK_UNIQUE_FIELD`) hanno un timeout predefinito di 30 secondi.

Se il server non risponde entro questa finestra di 30 secondi, il client elimina automaticamente la richiesta in sospeso e rifiuta la promise con un `ApiError` contenente il messaggio `"Request timed out"`.

I messaggi unidirezionali che non prevedono una risposta (come `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` e `presence_state`) si risolvono immediatamente al momento dell'invio e non attivano timeout.

### Quando un frame di canale viene rifiutato

Un frame di canale è di tipo fire-and-forget: `await channel.broadcast(...)` si risolve quando il frame viene scritto sul socket, **non** quando il server lo ha accettato. Questa è una scelta deliberata: un'applicazione collaborativa trasmette in broadcast la posizione di un cursore sessanta volte al secondo, e attendere una conferma per ciascuna trasformerebbe ogni trasmissione in un round trip.

Pertanto un rifiuto non può essere una promise rigettata. Arriva invece tramite `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Codice | Significato |
|------|-------|
| `CHANNEL_FORBIDDEN` | Non sei un membro del canale — unisciti prima di trasmettere o leggerne la cronologia |
| `RATE_LIMITED` | Superato il budget di frame del canale indicato sopra o, per una richiesta di cronologia, il [rate limit dei dati](#cosa-costa-una-scrittura-e-i-limiti) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Un broadcast conservato non ha potuto essere salvato, quindi è stato scartato |
| `CHANNEL_HISTORY_READ_FAILED` | Impossibile soddisfare una richiesta di recupero (catch-up) |
| `CHANNEL_HISTORY_GAP` | Generato dal client: un recupero (catch-up) ha rilevato che il server non conserva più messaggi che questo client non ha mai ricevuto. `details` è `{ from, to }`, i numeri di sequenza persi. Risincronizza lo stato del canale dalla sua fonte di verità |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Il broadcast ha raggiunto solo questa istanza — consulta [Il limite di 8 KB sul bus Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Senza alcun gestore collegato, questi errori vengono registrati nei log come avvisi (warning). In precedenza venivano scartati del tutto: non c'era alcuna promise da rifiutare né un canale a cui recapitarli, per cui un broadcast vietato era indistinguibile da uno recapitato con successo.

## Passaggi successivi

- [SDK tipizzato](/docs/sdk) — Documentazione completa dell'SDK inclusi gli accessor tipizzati per le collezioni.
- [Authentication](/docs/backend/authentication) — Configura l'autenticazione JWT e i criteri RLS.
- [Backend Architecture](/docs/backend) — Panoramica dell'architettura del server Rebase.
