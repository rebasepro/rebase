---
sourceHash: 0804be5779f90bbb
title: Realtime e WebSocket
sidebar_label: Realtime
description: Sincronizzazione dei dati in tempo reale, canali di broadcast e tracciamento della presenza tramite WebSocket.
---

Rebase include un motore realtime integrato che invia le modifiche ai dati ai client connessi tramite WebSocket.
Quando un record viene creato, aggiornato o eliminato, ogni sottoscrittore che osserva quella tabella o entità riceve l'aggiornamento istantaneamente — senza necessità di polling.

## Come funziona

La pipeline realtime si articola in tre fasi:

1. **Trigger del database** — Una mutazione raggiunge il database PostgreSQL (tramite API REST, SDK o Studio).
2. **Fan-out del server** — Il server Rebase rileva la modifica e la distribuisce a ogni sottoscrizione WebSocket attiva corrispondente alla tabella o all'entità interessata.
3. **Callback del client** — L'SDK tipizzato esegue la tua callback `onUpdate` con i nuovi dati.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Per i deployment multi-istanza, Rebase utilizza `LISTEN/NOTIFY` di PostgreSQL per propagare le modifiche tra le varie istanze del server. Questo viene gestito automaticamente. Con la [change capture a livello di database](/docs/backend/realtime-cdc/) attiva (l'impostazione predefinita ovunque il ruolo del database possa creare trigger), ogni istanza rimane in ascolto sul canale `rebase_cdc` su cui pubblicano i trigger di cattura, così che una scrittura venga intercettata a prescindere dal processo o dallo strumento che l'ha effettuata. Senza capture, ogni istanza annuncia le proprie scritture sul canale `rebase_entity_changes`, e una connessione dedicata su ogni altra istanza le ritrasmette ai propri sottoscrittori locali.

### Zero configurazione

La funzionalità realtime è abilitata out of the box. Non c'è alcun flag da attivare o servizio da avviare: se il server Rebase è in esecuzione, l'endpoint WebSocket è disponibile.

### Su quale path risponde il socket

Il socket risponde agli upgrade su un unico path: il path di base dell'API privo del suffisso `/api`, quindi `/` per un'API su `/api`. È lì che l'SDK si connette: si collega al suo `baseUrl`, mentre le sue richieste HTTP vanno su `${baseUrl}/api`. Una richiesta di upgrade verso qualsiasi altro path viene lasciata agli altri listener di `upgrade` del server, consentendo alla tua applicazione di eseguire il proprio server WebSocket sullo stesso `http.Server`. In assenza di altri listener, a tale upgrade viene risposto con un `404`.

In un [server personalizzato](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` imposta il path, e l'opzione `realtime.path` dell'adapter Postgres sovrascrive ciò che il server ha dedotto.

> Per impostazione predefinita, Rebase emette eventi realtime anche per le scritture effettuate **all'esterno** dell'API (tramite `psql`, un altro servizio o l'editor SQL di Studio) ogni volta che la connessione al database lo supporta — consulta [change capture a livello di database](/docs/backend/realtime-cdc/).

## Sottoscrizioni tramite SDK tipizzato

L'SDK tipizzato di Rebase espone due metodi di sottoscrizione su ciascun accessor di tabella:

- **`listen()`** — Si sottoscrive a un'intera tabella (con filtri opzionali).
- **`listenById()`** — Si sottoscrive a una singola entità tramite il suo ID.

Entrambi i metodi restituiscono una **funzione di annullamento della sottoscrizione** (unsubscribe) da chiamare per interrompere la ricezione degli aggiornamenti.

### Sottoscrizione a una tabella

Usa `listen()` per ricevere aggiornamenti ogni volta che cambiano i record in una tabella:

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

La callback riceve un `FindResult<M>` contenente:
- `data` — Le righe, in formato piatto, esattamente come le restituisce `find()` (`row.name`, non `row.values.name`).
- `meta` — Informazioni di paginazione (`total`, `limit`, `offset`, `hasMore`).

### Sottoscrizione a una tabella con filtri

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

Il server rispetta questi filtri — negli aggiornamenti vengono inclusi solo i record corrispondenti.

### Sottoscrizione a una singola entità

Usa `listenById()` per monitorare un record specifico:

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

La callback riceve la riga, in formato piatto, così come la restituisce `findById()` (`row.name`, non `row.values.name`), oppure `undefined` una volta eliminata la riga.

**Ogni frame trasporta la versione della riga.** `etagOf(row)` è l'`ETag` restituito da una `GET` della riga, consentendo di salvare una modifica effettuata su ciò che un frame mostrava tramite `ifMatch: etagOf(row)`, la quale verrà rifiutata con `412` se la riga nel frattempo è cambiata (vedi [Scritture condizionali](/docs/backend/writes/)). Sul canale di comunicazione, il metodo `subscribe_one` dell'SDK effettua la richiesta con `etag: true`, e ogni frame `single_update` per una riga esistente include `"etag"` accanto a `"row"`. Un server precedente a questa funzionalità ignora la richiesta e non invia alcun tag, mentre un client che non lo richiede riceverà i frame sprovvisti di tag.

### Annullamento della sottoscrizione

Sia `listen()` che `listenById()` restituiscono una funzione di unsubscribe. Chiamala per interrompere la ricezione degli aggiornamenti e liberare le risorse lato server:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Chiama sempre la funzione di unsubscribe quando un componente viene smontato o si naviga verso un'altra pagina. Questo previene memory leak e lavoro superfluo sul server.
:::

## Query Builder `.listen()`

Anche il fluent query builder supporta le sottoscrizioni realtime. Concatena i tuoi filtri, quindi chiama `.listen()` invece di `.find()`:

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
`.listen()` — sia sul query builder che sull'accessor di tabella — necessita del WebSocket del client. Il client deduce il suo URL da `baseUrl`, a meno che non venga specificato `websocketUrl`. Su un client creato con `realtime: false`, o su uno che non è riuscito a dedurre alcun URL, la chiamata a `.listen()` genererà un errore.
:::

## Distribuzione degli aggiornamenti: Instant Patch + Refetch di correttezza

Una modifica non viaggia mai verso un sottoscrittore sotto forma di dati grezzi. Viaggia come notifica del fatto che qualcosa è cambiato, e a ciascun sottoscrittore viene poi comunicato ciò che *può* vedere mediante una query eseguita con la sua identità:

1. **Invalidazione.** Quando un'entità cambia (creata, aggiornata, eliminata), il server contrassegna i percorsi interessati. La riga che è stata scritta non viene inoltrata: è stata letta con l'autorizzazione di chi ha scritto, la quale non dice nulla su cosa ciascun sottoscrittore sia autorizzato a vedere.

2. **Refetch RLS con debounce.** Dopo **300ms** (`REFETCH_DEBOUNCE_MS`), il server esegue nuovamente il fetch della tabella con i tuoi filtri e ordinamento originali. La query viene eseguita all'interno di una transazione che imposta a livello transazionale le variabili `app.user_id` e `app.user_roles` dal `SubscriptionAuthContext` del sottoscrittore, in modo che Postgres valuti la Row-Level Security sotto l'identità di quel client e solo le righe che è autorizzato a vedere vengano inviate nel `collection_update`. Il debounce raggruppa inoltre una raffica di scritture in un'unica query. Attende 300 ms senza ulteriori modifiche, ma mai più di **1 s** (`REFETCH_MAX_WAIT_MS`) dalla prima, cosicché una tabella soggetta a scritture multiple al secondo invii comunque ai suoi sottoscrittori un frame almeno una volta al secondo. Questo limite si imposta con `REALTIME_REFETCH_MAX_WAIT_MS` (o `realtime.refetchMaxWaitMs`): un valore più alto riesegue il fetch di una tabella trafficata meno spesso, un valore più basso invia frame più aggiornati.

   Un refetch che legge esattamente ciò che era stato inviato per ultimo a un sottoscrittore non invia nulla a quest'ultimo: una scrittura alla riga 9.000 di un elenco che mostra le prime 50 costa solo la lettura, non un frame inviato a ogni osservatore. Dopo un frame di errore, le righe successive vengono inviate nuovamente anche se identiche.

Le versioni precedenti inviavano un `collection_patch` immediato contenente la riga scritta prima di questo refetch, per un feedback cross-tab al di sotto del millisecondo. Quella riga era stata letta nell'ambito dei permessi di chi scriveva, quindi poteva — e di fatto lo faceva — raggiungere sottoscrittori le cui policy l'avrebbero negata, e nemmeno il filtro `where` della sottoscrizione le veniva applicato. La patch è stata rimossa: la latenza percepita per un aggiornamento corrisponde ora alla finestra di debounce.

### Il refetch equivale alla lettura REST

Il refetch esegue la stessa pipeline di `GET /api/data/<table>`, con la medesima gestione di `include`. È questo che fa sì che `find({ q })` e `listen({ q })` restituiscano righe identiche campo per campo.

In precedenza si trattava di un metodo diverso — che annidava ciascuna relazione sotto un involucro `{ "__type": "relation" }` e, poiché una sottoscrizione non poteva includere parametri `include`, caricava in modo eager **ogni** relazione dichiarata dalla tabella. Di conseguenza, la medesima query rispondeva con una struttura via HTTP e un'altra via socket, e un client che renderizzava entrambe vedeva le proprie righe mutare struttura non appena arrivava una scrittura.

Un frame di sottoscrizione accetta quindi gli stessi parametri di una richiesta di elenco: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` e `fields`. `vectorSearch` fa eccezione e viene **rifiutata** con `VECTOR_SEARCH_NOT_LIVE` — una sottoscrizione viene rieseguita a ogni scrittura corrispondente e nulla in quel contesto calcola distanze.

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

`meta` viene conteggiato all'interno della stessa transazione soggetta a RLS che ha letto le righe, descrivendo così esattamente le righe che lo affiancano. Senza di esso, un client che necessitava del totale avrebbe dovuto eseguire una `GET /count` **per ogni push** — un round-trip extra per scrittura, per ogni sottoscrittore, oltre a una finestra temporale in cui il conteggio e le righe descrivevano stati differenti della tabella.

Quando il conteggio stesso fallisce, il frame contiene `partial: true` e nessun `total`; questo non costituisce un errore di sottoscrizione, e il client dovrebbe mantenere l'ultimo totale reale piuttosto che sostituirlo con la lunghezza della pagina. Su tabelle di grandi dimensioni, il conteggio rappresenta la maggior parte del costo di un frame. Impostando `REALTIME_RECOUNT_INTERVAL_MS`, un elenco il cui ultimo totale era di almeno `REALTIME_RECOUNT_MIN_ROWS` (100.000 per impostazione predefinita) riutilizza quel totale per la durata dell'intervallo invece di ricalcolarlo a ogni scrittura; in tal caso, il frame include `meta.totalAsOf`, che indica quando è stato calcolato il totale. Trascorso l'intervallo, un elenco il cui ultimo frame ha riutilizzato il totale viene conteggiato nuovamente e gli viene inviato il nuovo totale, indipendentemente dal fatto che ci siano state nuove scritture nel frattempo. Se non impostato, come da default, ogni frame effettua il conteggio.

### Quanto costa una scrittura e i relativi limiti

Poiché ogni frame è una query eseguita per conto del rispettivo sottoscrittore, il costo di una scrittura cresce con il numero di **interrogazioni distinte effettuate da principal distinti** sulla tabella interessata — non con il numero di socket aperti:

- Le sottoscrizioni che pongono la stessa interrogazione (stesso path, filtri, ordinamento, pagina, `include`, `fields`, ricerca) con lo stesso principal (stesso user id, ruoli, flag guest e claim) condividono un unico refetch. Una scrittura su un elenco costa **una transazione per ciascun gruppo di questo tipo** — la lettura e il relativo conteggio — indipendentemente da quanti socket lo mantengano aperto; ogni membro riceve comunque un frame generato da righe lette sotto quell'identità. Una prima pagina restituita con meno elementi rispetto al suo `limit` rappresenta l'intero set, quindi non viene conteggiata affatto.
- Una sottoscrizione a un singolo record viene interrogata solo quando il proprio record subisce modifiche.
- Principal differenti non condividono mai una lettura — è questo che impedisce a un frame di trasportare una riga che il destinatario non ha il permesso di vedere. Un elenco osservato da mille utenti autenticati diversi comporta mille letture e mille conteggi a ogni scrittura su di esso, suddivisi in mille transazioni.

Misurato su un laptop con un'istanza locale di PostgreSQL e un pool di 20 connessioni, una singola scrittura su un elenco:

| Sottoscrittori | Transazioni per la scrittura | Ultimo frame dopo la scrittura |
|---|---|---|
| 1.000, un unico principal | 2 | ~310 ms |
| 1.000, ciascuno con un principal differente | ~1.000 | ~600 ms |

In entrambi i casi, 300 ms sono dovuti al debounce. La seconda riga rappresenta il limite massimo da considerare nella pianificazione. I refetch girano sullo stesso pool del traffico REST, ma impegnano al massimo un quarto delle sue connessioni per volta (5 sulle 20 predefinite, mai meno di 2); le altre attendono il proprio turno sul server, facendo sì che il fan-out di una scrittura ritardi i propri frame anziché le richieste generali. Una tabella modificata più volte al secondo mentre **centinaia di utenti diversi** osservano lo stesso elenco è la situazione in cui tali frame iniziano ad accumulare ritardo. Oltre tale soglia, è consigliabile optare per sottoscrizioni più circoscritte (una pagina, un filtro sulle righe dell'utente stesso) o per un [canale di broadcast](#canali-di-broadcast) che veicoli la modifica affinché i client eseguano il re-fetch secondo la propria pianificazione.

**Un socket può contenere al massimo 1.000 sottoscrizioni.** Quella successiva viene rifiutata con un frame di errore con codice `TOO_MANY_SUBSCRIPTIONS`; sottoscriversi nuovamente con un id già detenuto dal socket sostituisce quella sottoscrizione e non viene conteggiato due volte. L'SDK condivide sottoscrizioni identiche su un socket, quindi questo limite calcola gli elenchi e i record distinti che una pagina tiene aperti. È possibile modificarlo con `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` o `realtime.maxSubscriptionsPerSocket` sull'adapter Postgres (la variabile d'ambiente ha la precedenza); un valore che non sia un numero intero positivo arresta il server all'avvio. **Anche i socket aperti da un singolo utente possono essere limitati**, per istanza del server: impostando `REALTIME_MAX_SOCKETS_PER_USER` (o `realtime.maxSocketsPerUser`), un accesso che supera tale limite viene rifiutato con `TOO_MANY_SOCKETS` e il socket viene chiuso con codice 4002. I socket autenticati tramite API key vengono conteggiati a carico di quella specifica chiave, ciascuna singolarmente, non a carico dell'account che l'ha creata; la service key costituisce una singola credenziale, quindi tutti i suoi socket vengono conteggiati insieme. I socket di un amministratore che impersona un utente vengono conteggiati a carico dell'amministratore, insieme ai suoi socket personali, non a carico dell'utente che impersona. L'SDK notifica contemporaneamente ogni sottoscrizione attiva e `onConnectionLost`, con un errore `CONNECTION_LOST` il cui `details.reason` è `TOO_MANY_SOCKETS`, e continua a tentare la riconnessione, aumentando l'attesa fino a 30 s, in modo che la scheda possa accedere non appena un altro socket si chiude. Se non impostato, come da default, non vi è alcun limite.

L'id di una sottoscrizione appartiene al socket: due client che denominano entrambi una sottoscrizione `"sub-1"` mantengono ciascuno la propria, e un `unsubscribe` interrompe solo quella del mittente.

**La sottoscrizione concorre al rate limit dei dati.** Il primo frame di una sottoscrizione è una lettura, eseguita per conto del sottoscrittore, così come la richiesta della cronologia di un canale. Pertanto, `subscribe_collection`, `subscribe_one` e `channel_history` vengono conteggiati come richieste di dati nel bucket del rate-limit del chiamante (quello condiviso dalle sue richieste HTTP e dagli altri suoi socket) una volta esaurita la quota riservata al socket. Ciascun socket può inviarne 1.000 senza che vengano conteggiate, o tante quante il suo limite massimo di sottoscrizioni se superiore, e tale quota si rigenera nell'arco di 15 minuti. Questo copre tutto ciò che un socket può contenere, cosicché la re-sottoscrizione dopo una riconnessione non venga mai rifiutata né consumi il budget dell'utente. Superata la quota, un frame oltre il limite viene respinto con un frame di errore con codice `RATE_LIMITED`, che l'SDK inoltra all'`onError` di quella sottoscrizione o del canale.

### Socket che smettono di rispondere

Un client può sparire senza chiudere il proprio socket: un telefono perde il segnale, un portatile va in sospensione, un NAT dimentica la connessione. Non arrivando alcun frame di chiusura, nulla avvisa il server. Il server quindi invia un ping a ogni socket ogni 30 secondi e chiude quelli che non hanno risposto entro il ping successivo, liberando così un client scomparso entro un minuto. I browser e l'SDK rispondono ai ping autonomamente; un client che comunica direttamente tramite il protocollo deve rispondere a sua volta, come del resto fa la maggior parte delle librerie WebSocket.

**Il lato browser.** Un browser non può inviare un ping né vederne uno, quindi un socket half-open gli appare connesso all'infinito. L'SDK apre il socket con `?rebase_caps=heartbeat,channel_seq,cancel_sql`; un server che riconosce questi parametri risponde con `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, elencando le funzionalità supportate (`cancel_sql`: accetta il frame `CANCEL_SQL` della console SQL), e invia un `{"type":"heartbeat"}` ogni 30 secondi; l'SDK chiude il socket e [si riconnette](#riconnessione-automatica) dopo due heartbeat mancati. A un client che non specifica nulla non viene inviato nessuno dei due, e un server meno recente ignora il parametro, pertanto un SDK che comunica con esso si comporta come in precedenza.

Un socket viene terminato anche quando più di 16&nbsp;MiB di frame inviati risultano ancora non letti. Questo accade quando un client non legge ciò che gli viene inviato, oppure è rimasto così indietro che ciò che andrebbe a leggere risulterebbe obsoleto. Inoltre, quando i socket del server accumulano complessivamente più di 256&nbsp;MiB non letti (o un quarto del limite di memoria con cui il server viene eseguito, se inferiore), quelli con il maggior quantitativo di dati non letti vengono terminati per primi, fino a rientrare nella soglia.

Un socket terminato viene ripulito esattamente come uno chiuso. Le sue sottoscrizioni terminano, abbandona i canali e la sua presence viene rimossa, annunciando l'uscita agli altri membri. Un client ancora attivo vede cadere la connessione, dopodiché l'SDK [si riconnette](#riconnessione-automatica) e si sottoscrive nuovamente.

## Canali di broadcast

I canali di broadcast permettono ai client di scambiarsi messaggi arbitrari in tempo reale — utili per funzionalità come indicatori di digitazione, posizioni dei cursori o notifiche personalizzate.

Il broadcast viene gestito a livello di protocollo WebSocket. Il server supporta questi tipi di messaggi:

| Message Type     | Direction       | Description                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Unisciti a un canale con nome            |
| `leave_channel`   | Client → Server | Lascia un canale                         |
| `broadcast`       | Client → Server | Invia un messaggio a tutti i membri del canale |
| `broadcast`       | Server → Client | Ricevi un messaggio da un altro membro   |
| `channel_history` | Client → Server | Richiedi i messaggi conservati successivi a una sequenza |
| `channel_history` | Server → Client | I messaggi conservati che un client ha perso |

Quando un client invia un messaggio `broadcast`, il server lo inoltra a **tutti gli altri membri** di quel canale (il mittente non riceve il proprio messaggio).

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

## Conservazione nei canali (Channel Retention)

Per impostazione predefinita, un broadcast raggiunge i membri attualmente connessi e poi svanisce. Questo è il giusto compromesso per notifiche e cursori, e non costa nulla.

Per un flusso di operazioni — editing collaborativo o qualsiasi contesto in cui un'interruzione non rilevata causi disallineamenti — un canale può essere configurato per **conservare** i propri messaggi. Ai broadcast conservati viene assegnato un numero di sequenza univoco per canale e vengono archiviati, così che un client che si riconnette possa richiedere tutti i messaggi successivi all'ultimo visualizzato.

:::caution[Dove va configurato]
**Runtime gestito: da nessuna parte.** La conservazione dei canali e `realtime.bus` fanno parte dell'adapter del database che il runtime gestito costruisce autonomamente, e nessuno dei due dispone di una variabile d'ambiente. Effettua l'eject per configurarli.
**Ejected:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
:::

La conservazione è opzionale e va configurata qui, sul server:

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
| `match` | Nome esatto del canale (`"doc:42"`) o prefisso che termina con `*` (`"doc:*"`) |
| `limit` | Mantieni al massimo questo numero di messaggi più recenti per canale        |
| `ttl`   | Mantieni i messaggi al massimo per questa durata — `"30s"`, `"15m"`, `"24h"`, `"7d"` o millisecondi |

Una regola richiede almeno uno tra `limit` o `ttl`. Una regola priva di entrambi viene ignorata e registrata nei log, poiché una conservazione illimitata non è quasi mai desiderata e non può essere revocata facilmente una volta che la tabella è cresciuta.

:::note[Perché non consentire ai client di richiedere la cronologia?]
Un canale viene creato da chiunque ne specifichi il nome. Se un client potesse decidere la profondità della propria cronologia, qualsiasi visitatore potrebbe costringere il tuo backend a un'archiviazione smisurata. Configurarlo qui garantisce inoltre che i canali di presenza e notifica — la stragrande maggioranza — non abbiano costi aggiuntivi: in assenza di regole configurate, non viene creata alcuna tabella e il broadcast segue lo stesso percorso sincrono di sempre.
:::

### Archiviazione

I canali con conservazione utilizzano due tabelle nello schema `rebase`, create automaticamente all'avvio quando è configurata almeno una regola:

| Tabella                   | Contenuto                                                       |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | I messaggi conservati, indicizzati da `(channel, seq)`          |
| `rebase.channel_cursors`  | La sequenza più alta emessa per canale                          |

L'epurazione (pruning) avviene man mano che arrivano i messaggi, regolata per canale in modo che il costo segua il tempo trascorso anziché il volume di scrittura. Rimuove esclusivamente righe da `channel_messages` — i cursori vengono mantenuti a tempo indefinito (costituiscono una singola piccola riga per canale), poiché riavviare la sequenza di un canale altererebbe il significato del punto di ripristino salvato da un client.

### Garanzie di recapito

- **Ordinato.** I numeri di sequenza sono assegnati per canale e l'ordine di recapito corrisponde all'ordine della sequenza — su una singola istanza e tra istanze sul bus `postgres`, dove l'istruzione che assegna il numero a un messaggio lo notifica anche, così che ogni istanza (compresa quella del mittente) riceva gli annunci nell'ordine di sequenza. Un bus fornito personalmente trasmette i frame nell'ordine in cui li recapita.
- **Durevole prima della consegna.** Un messaggio che non può essere memorizzato non viene recapitato a nessuno, e il mittente ne viene informato. Recapitarlo significherebbe mostrarlo ai sottoscrittori in tempo reale escludendolo però da ogni futuro replay, e nessun messaggio successivo potrebbe colmare quel divario.
- **At-least-once durante il recupero.** L'intervallo di un replay può sovrapporsi a messaggi che il client ha già ricevuto; l'SDK scarta quelli già recapitati.
- **Nessun vuoto (No holes).** Un messaggio conservato raggiunge tutti i membri: al mittente, al quale non viene mai rispedito il proprio messaggio, viene invece inviato `{"type":"broadcast_ack","channel","seq"}` qualora abbia abilitato `channel_seq`. Di conseguenza, un messaggio successivo a `lastSeq + 1` indica che ne è stato saltato uno: l'SDK lo trattiene, richiede la cronologia intermedia e li consegna tutti in ordine. A fronte di un server sprovvisto di `channel_seq`, un salto viene recapitato nel momento in cui arriva.

:::caution[La cronologia segue lo stesso modello di accesso del canale]
Un client che si è unito a un canale può riprodurre i messaggi conservati, inclusi quelli trasmessi prima del suo ingresso — l'appartenenza è l'unico controllo previsto, e l'accesso è consentito a qualsiasi client conosca il nome del canale. La conservazione è opzionale per pattern di canale, pertanto la sua abilitazione rende la cronologia del canale consultabile da qualsiasi visitatore ne indovini il nome. Nei canali conservati questo aspetto assume carattere permanente anziché temporaneo: considera quindi i contenuti di un canale conservato come pubblici per i tuoi utenti.
:::

## Tracciamento della presenza (Presence)

La Presence tiene traccia di quali utenti sono attualmente online in un canale e consente a ciascun utente di condividere uno stato personalizzato (ad es. posizione del cursore, stato).

| Message Type       | Direction       | Description                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Avvia il tracciamento della presenza con stato personalizzato |
| `presence_untrack`| Client → Server | Interrompi il tracciamento della presenza            |
| `presence_state`  | Client → Server | Richiedi lo stato completo della presenza per un canale |
| `presence_state`  | Server → Client | Tutte le presenze nel canale, al completo            |
| `presence_diff`   | Server → Client | Aggiornamento incrementale (ingressi e uscite)       |

Quando un client invia `presence_track`, il server lo aggiunge automaticamente al canale (senza necessità di un `join_channel` separato) e invia un `presence_diff` in broadcast a tutti i membri del canale. L'SDK invia nuovamente il proprio stato ogni circa 20 secondi come heartbeat; un heartbeat il cui stato non è mutato si limita ad aggiornare il timeout del client senza inviare alcun `presence_diff`.

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

Le presenze non aggiornate (stale) vengono ripulite automaticamente dopo 30 secondi di inattività.

## Riconnessione automatica

L'SDK tipizzato si riconnette automaticamente in caso di caduta della connessione WebSocket:

- **Backoff esponenziale** — Ogni tentativo di riconnessione attende un intervallo che parte da 2 secondi e raddoppia ogni volta, fino a un massimo di 30 secondi. Il ritardo viene calcolato casualmente all'interno di tale intervallo, ma mai inferiore a un quarto di secondo, così che i client disconnessi contemporaneamente a seguito di un deploy si riconnettano scaglionati nell'arco dell'intervallo anziché nello stesso istante.
- **Nessuna interruzione finché ci sono risorse attive** — Finché esiste una sottoscrizione o un canale a cui si è uniti, il client continua i tentativi di riconnessione con frequenza massima di 30 secondi per tutta la durata del disservizio. In assenza di elementi registrati si ferma dopo 5 tentativi falliti, e la sottoscrizione successiva avvia nuovamente la connessione. In un browser, sia l'evento `online` che il ritorno della scheda in primo piano attivano immediatamente un nuovo tentativo di connessione senza attendere il backoff.
- **I disservizi vengono segnalati una sola volta** — Quando la connessione rimane interrotta per 14 secondi, a prescindere dal numero di tentativi effettuati, l'`onError` di ogni sottoscrizione attiva e di ogni canale a cui si è uniti riceve un `RebaseApiError` con codice `CONNECTION_LOST`. La sottoscrizione viene **mantenuta**: l'errore segnala che i dati non si stanno aggiornando, non che la sottoscrizione è terminata.
- **Risottoscrizione automatica** — In caso di riconnessione riuscita, tutte le sottoscrizioni attive vengono registrate nuovamente sul server, e il successivo `onUpdate` di ciascuna include tutto ciò che è stato scritto durante l'assenza del client. Tale aggiornamento funge da segnale di ripristino. Non è richiesto alcun intervento manuale.
- **Le richieste sono at-most-once** — Una richiesta effettuata mentre il socket è inattivo rimane in attesa per un massimo di 30 secondi dalla chiamata, per poi fallire con `REQUEST_TIMEOUT` senza mai essere inviata. Una richiesta che era già stata inviata al momento della caduta della connessione fallisce con `CONNECTION_LOST` e **non** viene reinviata: il server potrebbe averla eseguita o meno, e solo il chiamante può sapere se eseguirla una seconda volta sia sicuro.

`client.ws.state` indica lo stato della connessione, e `onStateChange` viene notificato a ogni variazione:

| State | Meaning |
|---|---|
| `idle` | Nessun socket, e nessuno ancora richiesto (la connessione è lazy), oppure un sign-out l'ha chiusa. |
| `connecting` | Connessione in corso, senza disservizi in atto. |
| `connected` | Il socket è aperto. |
| `reconnecting` | Il socket è caduto e il client sta tentando la riconnessione. Nessun errore è stato ancora segnalato. |
| `disconnected` | Il disservizio dura da 14 secondi o più. È stato segnalato `CONNECTION_LOST`, e il client continua a ritentare la connessione. |
| `closed` | È stato chiamato `client.close()`. Definitivo. |

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

Il pannello di amministrazione di Rebase mostra un banner proprio mentre lo stato è `disconnected`, e mantiene a schermo le righe e i record già visualizzati invece di sostituirli con un errore.

## Autenticazione e RLS

Le sottoscrizioni WebSocket rispettano automaticamente le policy di Row-Level Security (RLS). Quando il client è autenticato:

1. La connessione WebSocket si autentica utilizzando lo stesso token JWT dell'API REST.
2. Ogni refetch della sottoscrizione viene eseguito all'interno di una transazione PostgreSQL con `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)`, garantendo l'applicazione delle policy RLS.
3. L'identità viene verificata continuamente per tutto il tempo in cui il socket resta aperto, non solo al momento dell'autenticazione. Prima di ciascun frame, il server effettua gli stessi controlli previsti per una richiesta HTTP: il token è ancora valido, la sessione è stata terminata o revocata, l'account esiste ancora e quali ruoli ricopre attualmente. Per i frame dei canali questo controllo viene effettuato al massimo una volta al secondo. I frame che arrivano su un socket mentre la sua verifica è ancora in corso — come un client che reinvia le proprie sottoscrizioni dopo una riconnessione — condividono tale controllo invece di ripeterlo singolarmente; il frame successivo alla risoluzione effettuerà una nuova verifica. Un socket di solo ascolto viene verificato almeno ogni 30 secondi, e un token cessa di essere accettato nell'istante esatto in cui scade. La revoca di un ruolo viene applicata a partire dal frame successivo (o da quello dopo ancora, per un frame che condivideva una verifica già in corso), sia per le letture che per le scritture e le sottoscrizioni aperte. Un socket la cui identità non è più valida riceve un frame `AUTH_ERROR` e viene chiuso con codice `4001`. Con l'autenticazione integrata, il codice del frame ne specifica il motivo in modo analogo alle route HTTP: `SESSION_REVOKED` (disconnesso, revocato o account eliminato), `ACCOUNT_DISABLED` o `TOKEN_EXPIRED`; per un adapter di autenticazione di terze parti il codice è `SESSION_ENDED`. Una richiesta `AUTHENTICATE` per una sessione revocata o un account disabilitato viene rifiutata con `SESSION_REVOKED` o `ACCOUNT_DISABLED` (un token che non supera la verifica, o scaduto, con `INVALID_TOKEN`). L'SDK non riprova con lo stesso token e trasmette il rifiuto, codice incluso, all'`onError` dell'operazione che richiedeva l'account. L'SDK autentica nuovamente il socket a ogni aggiornamento (refresh) del token; un nuovo token per la medesima identità (stesso user id, ruoli, flag guest e claim) mantiene inalterate le sottoscrizioni aperte, mentre uno per un'identità differente riesegue il refetch di ciascuna di esse con la nuova identità. Dopo un errore `4001`, l'SDK si riconnette con la sessione disponibile in quel momento, o senza alcuna sessione. Un client che interagisce direttamente con il protocollo deve inviare un nuovo token nel messaggio `AUTHENTICATE` prima della scadenza di quello precedente.

Ciò significa che ogni socket riceve solo aggiornamenti relativi a record che la sua identità autenticata ha il permesso di visualizzare.

Anche una [chiave API](/docs/backend/api-keys/) può autenticare il socket: invia la chiave `rk_…` al posto dell'access token. Il socket verificherà quindi ogni frame rispetto agli [scope](/docs/backend/roles-and-scopes/) della chiave: un fetch, un count o una sottoscrizione richiedono `data:read` sulla tabella, un salvataggio richiede `data:write`, una cancellazione `data:delete`. Un percorso annidato richiede lo scope standard. I canali (broadcast e presence) vengono negati a una chiave, poiché nessuno scope li copre. I messaggi dell'editor SQL e dei branch richiedono `database:read` o `database:write`, indifferentemente per una chiave o per un utente.

L'esecuzione di più istanze — il bus LISTEN/NOTIFY, la gestione della presenza tra processi diversi e la scrittura di un transport personalizzato — è trattata in una pagina dedicata: [Realtime tra più istanze](/docs/backend/realtime-transports/).

## Change Capture a livello di database (CDC)

Ogni scrittura con commit emette eventi realtime, indipendentemente da come è stata eseguita: REST, SDK, Studio, `psql`, un cron job in un altro servizio. Per scoprire come funziona la cattura, l'impostazione `REALTIME_CDC` e i suoi requisiti: [Change capture del database](/docs/backend/realtime-cdc/).

## Timeout per richieste in sospeso (Pending Request Timeout)

Per evitare che le richieste del client rimangano bloccate indefinitamente, tutte le operazioni WebSocket in sospeso che attendono una risposta dal server (come il fetch occasionale di tabelle `FETCH_COLLECTION`, il fetch di singole entità `FETCH_ONE`, creazione/aggiornamento `SAVE`, eliminazioni `DELETE`, conteggi `COUNT` e verifiche di univocità `CHECK_UNIQUE_FIELD`) prevedono un timeout predefinito di 30 secondi.

Se il server non risponde entro questa finestra di 30 secondi, il client elimina automaticamente la richiesta in sospeso e rigetta la promise con un `RebaseApiError` con codice `REQUEST_TIMEOUT`.

I messaggi unidirezionali che non attendono risposta (come `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` e `channel_history`) si risolvono immediatamente dopo la trasmissione e non attivano questo timeout. Una sottoscrizione il cui primo frame non è pervenuto entro 30 secondi dall'invio della richiesta di sottoscrizione fallisce invece con `SUBSCRIPTION_TIMEOUT` sul proprio `onError`.

### Quando un frame di un canale viene rifiutato

Un frame di un canale è fire-and-forget: `await channel.broadcast(...)` si risolve quando il frame viene scritto sul socket, **non** quando il server lo ha accettato. Questo è voluto: un'applicazione collaborativa trasmette la posizione del cursore sessanta volte al secondo, e attendere una conferma per ciascuna trasformerebbe ogni trasmissione in un round-trip.

Pertanto, un rifiuto non può presentarsi come una promise rigettata, ma viene recapitato su `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Codice | Significato |
|---|---|
| `CHANNEL_FORBIDDEN` | Non sei un membro del canale — unisciti prima di trasmettere in broadcast o leggerne la cronologia |
| `RATE_LIMITED` | Superato il budget di frame del canale (7.200 frame di canale al minuto per socket) o, per una richiesta di cronologia, superato il [rate limit dei dati](#quanto-costa-una-scrittura-e-i-relativi-limiti) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Impossibile salvare un broadcast con retention, pertanto è stato scartato |
| `CHANNEL_HISTORY_READ_FAILED` | Impossibile soddisfare una richiesta di catch-up |
| `CHANNEL_HISTORY_GAP` | Sollevato dal client: un'operazione di catch-up ha rilevato che il server non conserva più i messaggi che questo client non ha mai ricevuto. `details` è `{ from, to }`, i numeri di sequenza persi. Risincronizza lo stato del canale dalla sua fonte di verità |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Il broadcast ha raggiunto solo questa istanza — consulta [Il limite di 8 KB sul bus Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Se non viene associato alcun gestore, questi errori vengono registrati come avviso nei log. In precedenza venivano scartati del tutto: non essendoci una promise da rigettare né un canale a cui inviarli, un broadcast proibito era indistinguibile da uno recapitato con successo.

## Prossimi passi

- [SDK tipizzato](/docs/sdk) — Documentazione completa dell'SDK inclusi gli accessor tipizzati per le tabelle.
- [Autenticazione](/docs/backend/authentication) — Configura l'autenticazione JWT e le policy RLS.
- [Architettura backend](/docs/backend) — Panoramica dell'architettura del server Rebase.
