---
sourceHash: 512b1a9970d23a5b
title: Realtime & WebSocket
sidebar_label: Realtime
description: Sincronizzazione dei dati in tempo reale, canali di broadcast e tracciamento della presenza tramite WebSocket.
---

Rebase include un motore realtime integrato che invia le modifiche ai dati ai client connessi tramite WebSocket.
Quando un record viene creato, aggiornato o eliminato, ogni sottoscrittore che osserva quella tabella o entità riceve l'aggiornamento istantaneamente, senza bisogno di polling.

## Come funziona

La pipeline realtime si compone di tre fasi:

1. **Trigger del database** — Una mutazione raggiunge il database PostgreSQL (tramite API REST, SDK o Studio).
2. **Fan-out del server** — Il server Rebase rileva la modifica e la distribuisce (fan-out) a ogni sottoscrizione WebSocket attiva corrispondente alla tabella o entità interessata.
3. **Callback del client** — L'SDK tipizzato esegue la tua callback `onUpdate` con i nuovi dati.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Per i deployment multi-istanza, Rebase utilizza `LISTEN/NOTIFY` di PostgreSQL per propagare le modifiche tra le varie istanze del server. Questa operazione viene gestita automaticamente. Con l'[acquisizione delle modifiche a livello di database (CDC)](/docs/backend/realtime-cdc/) abilitata (impostazione predefinita ovunque il ruolo del database possa creare trigger), ogni istanza ascolta sul canale `rebase_cdc` su cui pubblicano i trigger di acquisizione, garantendo che una scrittura venga rilevata indipendentemente dal processo o dallo strumento che l'ha eseguita. Senza acquisizione, ogni istanza annuncia le proprie scritture sul canale `rebase_entity_changes`, e una connessione dedicata su ogni altra istanza le inoltra ai propri sottoscrittori locali.

### Configurazione zero

Il supporto Realtime è abilitato out of the box. Non c'è alcun flag da attivare né alcun servizio da avviare: se il server Rebase è in esecuzione, l'endpoint WebSocket è disponibile.

### A quale percorso risponde il socket

Il socket risponde alle richieste di upgrade su un unico percorso: il percorso di base dell'API senza il `/api` finale, quindi `/` per un'API che si trova su `/api`. È qui che si connette l'SDK: si collega al suo `baseUrl`, mentre le sue richieste HTTP vanno su `${baseUrl}/api`. Una richiesta di upgrade verso qualsiasi altro percorso viene lasciata agli altri listener `upgrade` del server, consentendo all'app di eseguire il proprio server WebSocket sullo stesso `http.Server`. In assenza di altri listener, a tale upgrade viene risposto con un `404`.

In un [server personalizzato](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` imposta il percorso, e l'opzione `realtime.path` dell'adapter Postgres sovrascrive quanto ricavato dal server.

> Per impostazione predefinita, Rebase emette eventi realtime anche per le scritture effettuate **all'esterno** dell'API (tramite `psql`, un altro servizio o l'editor SQL di Studio) ogni volta che la connessione al database lo supporta: consulta [acquisizione delle modifiche a livello di database (CDC)](/docs/backend/realtime-cdc/).

## Sottoscrizioni con l'SDK tipizzato

L'SDK tipizzato di Rebase espone due metodi di sottoscrizione su ogni accessor di tabella:

- **`listen()`** — Sottoscrivi un'intera tabella (con filtri opzionali).
- **`listenById()`** — Sottoscrivi una singola entità tramite il suo ID.

Entrambi i metodi restituiscono una **funzione di annullamento della sottoscrizione (unsubscribe)** da chiamare per interrompere la ricezione degli aggiornamenti.

### Sottoscrivere una tabella

Usa `listen()` per ricevere aggiornamenti ogni volta che i record in una tabella cambiano:

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
- `data` — Le righe, in formato flat, come restituite da `find()` (`row.name`, non `row.values.name`).
- `meta` — Informazioni di paginazione (`total`, `limit`, `offset`, `hasMore`).

### Sottoscrivere una tabella con filtri

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

La callback riceve la riga, in formato flat, come restituita da `findById()` (`row.name`, non `row.values.name`), oppure `undefined` una volta che la riga viene eliminata.

**Ogni frame trasporta la versione della riga.** `etagOf(row)` è l'`ETag` restituito da una `GET` della riga, quindi una modifica effettuata rispetto a quanto mostrato da un frame può essere salvata con `ifMatch: etagOf(row)` e viene rifiutata con `412` se la riga nel frattempo è cambiata (vedere [Scritture condizionali](/docs/backend/writes/)). A livello di rete, `subscribe_one` dell'SDK richiede con `etag: true`, e ogni frame `single_update` per una riga esistente include `"etag"` accanto a `"row"`. Un server precedente a questa funzionalità ignora la richiesta e non invia alcun tag, e un client che non lo richiede riceve frame sprovvisti di tag.

### Annullamento della sottoscrizione

Sia `listen()` che `listenById()` restituiscono una funzione di annullamento della sottoscrizione. Chiamala per interrompere la ricezione degli aggiornamenti e liberare le risorse lato server:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Chiama sempre la funzione di annullamento quando un componente viene smontato (unmount) o quando si cambia pagina. Ciò previene memory leak e lavoro non necessario lato server.
:::

## Query Builder `.listen()`

Anche il query builder supporta le sottoscrizioni in tempo reale. Concatena i filtri e chiama `.listen()` invece di `.find()`:

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
`.listen()` — sia sul query builder che sull'accessor della tabella — richiede il WebSocket del client. Il client ricava il relativo URL da `baseUrl`, a meno che non venga fornito `websocketUrl`. Su un client creato con `realtime: false`, o su uno che non è riuscito a ricavare alcun URL, la chiamata a `.listen()` genera un errore.
:::

## Consegna degli aggiornamenti: Patch istantanea + Refetch di correttezza

Una modifica non viaggia mai verso un sottoscrittore sotto forma di dati. Viaggia come notifica del fatto che qualcosa è cambiato, e a ogni sottoscrittore viene poi mostrato ciò che *lui* può vedere tramite una query eseguita con la sua identità:

1. **Invalidazione.** Quando un'entità cambia (creata, aggiornata, eliminata), il server contrassegna i percorsi interessati. La riga scritta non viene inoltrata: è stata letta con l'autorizzazione di chi ha scritto, il che non garantisce ciò che un sottoscrittore è autorizzato a vedere.

2. **Refetch RLS con debounce.** Dopo **300 ms** (`REFETCH_DEBOUNCE_MS`), il server riesegue il fetch della tabella con i tuoi filtri e ordinamento originali. La query viene eseguita all'interno di una transazione che imposta le variabili locali di transazione `app.user_id` e `app.user_roles` ricavate dal `SubscriptionAuthContext` del sottoscrittore; in questo modo Postgres valuta la Row-Level Security con l'identità di quel client e solo le righe che è autorizzato a vedere vengono inviate nel `collection_update`. Il debounce raggruppa inoltre una raffica di scritture in un'unica query. Attende 300 ms senza ulteriori modifiche, ma mai più di **1 s** (`REFETCH_MAX_WAIT_MS`) dopo la prima, garantendo che una tabella modificata più volte al secondo invii comunque un frame ai propri sottoscrittori almeno una volta al secondo. Questo limite si imposta con `REALTIME_REFETCH_MAX_WAIT_MS` (o `realtime.refetchMaxWaitMs`): un valore più alto riesegue il fetch di una tabella occupata con minore frequenza, un valore più basso invia frame più aggiornati.

   Un refetch che legge esattamente ciò che era già stato inviato in precedenza a un sottoscrittore non gli invia nulla: una scrittura alla riga 9.000 di un elenco che mostra le prime 50 costa solo la lettura, non un frame per ogni spettatore. Dopo un frame di errore, le righe successive vengono inviate nuovamente anche se identiche.

Le versioni precedenti inviavano un `collection_patch` immediato contenente la riga scritta prima di questo refetch, per offrire un feedback tra schede (cross-tab) sub-millisecondo. Quella riga era stata letta nell'ambito dei permessi di chi scriveva, quindi poteva raggiungere — ed è successo — sottoscrittori le cui policy l'avrebbero vietata, e neppure il filtro `where` della sottoscrizione veniva applicato ad essa. Questa patch è stata rimossa: la latenza percepita per un aggiornamento corrisponde ora alla finestra di debounce.

### Il refetch corrisponde alla lettura REST

Il refetch esegue la stessa pipeline di `GET /api/data/<table>`, con la medesima gestione di `include`. È questo che garantisce che `find({ q })` e `listen({ q })` restituiscano righe identiche campo per campo.

In precedenza si trattava di un metodo differente, che annidava ogni relazione all'interno di un wrapper `{ "__type": "relation" }` e, poiché una sottoscrizione non poteva contenere `include`, caricava in modo eager **ogni** relazione dichiarata dalla tabella. Di conseguenza, la medesima query rispondeva con un formato via HTTP e con un altro tramite socket, e un client che renderizzava entrambi vedeva la struttura delle righe cambiare nell'istante in cui veniva effettuata una scrittura.

Un frame di sottoscrizione accetta quindi gli stessi parametri di una richiesta di elenco: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` e `fields`. `vectorSearch` fa eccezione e viene **rifiutata** con `VECTOR_SEARCH_NOT_LIVE`: una sottoscrizione viene rieseguita a ogni scrittura corrispondente e lì nulla calcola le distanze.

### `collection_update` trasporta i propri metadati

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

`meta` viene calcolato all'interno della stessa transazione vincolata da RLS che ha letto le righe, descrivendo quindi con esattezza le righe corrispondenti. Senza di esso, un client che necessitava di un totale doveva inviare una `GET /count` **per ogni push**: un round trip in più per scrittura, per ogni sottoscrittore, creando una finestra temporale in cui il conteggio e le righe descrivevano stati differenti della tabella.

Quando il conteggio stesso fallisce, il frame include `partial: true` e nessun `total`; questo non costituisce un errore di sottoscrizione, e il client dovrebbe mantenere l'ultimo totale reale invece di sostituirlo con la lunghezza della pagina. Su tabelle di grandi dimensioni, il conteggio rappresenta la maggior parte del costo di un frame. Se `REALTIME_RECOUNT_INTERVAL_MS` è impostato, un elenco il cui ultimo totale era di almeno `REALTIME_RECOUNT_MIN_ROWS` (100.000 per impostazione predefinita) riutilizza quel totale per l'intervallo specificato invece di effettuare il conteggio a ogni scrittura; in tal caso, il frame include `meta.totalAsOf`, che indica quando è stato calcolato il totale. Trascorso l'intervallo, per l'elenco il cui ultimo frame ha riutilizzato il totale viene rieseguito il conteggio e inviato il nuovo totale, indipendentemente dal fatto che ci siano state scritture nel frattempo. Se non impostato, come da default, ogni frame esegue il conteggio.

### Quanto costa una scrittura e limiti

Poiché ogni frame è una query eseguita con l'identità del proprio sottoscrittore, il costo di una scrittura cresce in base al numero di **interrogazioni distinte effettuate da principal distinti** sulla tabella interessata, non in base al numero di socket aperti:

- Le sottoscrizioni che pongono la stessa interrogazione (stesso percorso, filtri, ordinamento, pagina, `include`, `fields`, ricerca) come stesso principal (stesso id utente, ruoli, flag guest e claim) condividono un unico refetch. Una scrittura su un elenco costa **una transazione per tale gruppo** (la lettura e il rispettivo conteggio), a prescindere da quanti socket lo mantengano aperto; ogni membro riceve comunque un frame creato da righe lette sotto quell'identità. Una prima pagina che restituisce meno elementi del suo `limit` rappresenta l'intero set, quindi non viene conteggiata affatto.
- Una sottoscrizione a un singolo record viene interpellata solo quando cambia il suo record specifico.
- Un elenco filtrato con `==` o `in` su una colonna della tabella viene interpellato solo quando la scrittura può interessarlo: quando la riga corrispondeva al filtro prima della scrittura o vi corrisponde dopo. Un `listen({ where: { owner: ["==", me] } })` gestito da cinquemila utenti costa una sola lettura quando uno di loro scrive una propria riga, non cinquemila. Questo determina solo *chi* esegue il refetch, mai ciò che ciascuno riceve: ogni elenco interpellato legge comunque all'interno dell'ambito del proprio sottoscrittore, quindi un elenco che richiede le righe di qualcun altro viene interpellato e non trova nulla di ciò che la sua policy nasconde.
- Principal differenti non condividono mai una lettura: è questo che impedisce a un frame di trasportare una riga che il lettore non è autorizzato a vedere. Un elenco ristretto unicamente da RLS (lo stesso elenco non filtrato, osservato da mille utenti autenticati differenti) comporta mille letture per ogni scrittura su di esso, in mille transazioni.

Il pre-filtro interpella ogni elenco della tabella, come in precedenza, ogni volta che non può garantire con certezza che un elenco non sia interessato:

- Valuta `==` e `in` su colonne di tipo text, `varchar`, uuid, enum, integer e boolean. Le altre condizioni (intervalli, pattern, percorsi JSON, relazioni, gruppi `or(...)`, ricerca) vengono tralasciate, il che amplia semplicemente ciò che viene ammesso. Un elenco che carica relazioni (`include`), una tabella con un hook `afterRead` e una colonna con un hook a livello di campo non vengono mai pre-filtrati.
- Richiede i valori della riga prima e dopo la scrittura. Una scrittura tramite l'API li fornisce per un'operazione di creazione e per un aggiornamento che ha prima letto la riga (come fanno tutti gli update REST). Una modifica letta dal WAL (`REALTIME_CDC=wal`, o `auto` dove il WAL è disponibile) fornisce l'intera nuova riga, ma la vecchia solo come chiave primaria a meno che la tabella non abbia `REPLICA IDENTITY FULL`; pertanto, un `UPDATE` o `DELETE` esterno di una colonna non chiave interpella ogni elenco. Il trigger di acquisizione (`REALTIME_CDC=trigger`) invia unicamente la chiave, potendo quindi escludere solo elenchi filtrati sulla chiave. Un'eliminazione tramite API e una chiave troppo grande per la notifica interpellano ogni elenco.

Misurato su un laptop rispetto a PostgreSQL 18 in Docker, con un pool di 20 connessioni (`tooling/scripts/bench-realtime-fanout.mts`), una scrittura su una tabella la cui policy mostra a ciascun utente solo le proprie righe:

| Sottoscrittori sulla tabella | Transazioni per la scrittura | Fan-out completato dopo la scrittura |
|--------------------------|----------------------------|------------------------------|
| 5.000 utenti, ciascuno con `where owner == me`, scrittura tramite API | 1 | ~305 ms |
| 5.000 utenti, ciascuno con `where owner == me`, SQL non elaborato letto dal WAL | 1 | ~307 ms |
| 5.000 socket di un utente, un unico elenco | 1 | ~311 ms |
| 1.000 utenti, lo stesso elenco non filtrato | 1.000 | ~780 ms |
| 5.000 utenti, lo stesso elenco non filtrato | 5.000 | ~2,6 s |

Di questi, 300 ms corrispondono al debounce. Le ultime due righe rappresentano il limite massimo da considerare: un elenco ristretto solo da RLS comporta una lettura per ogni utente distinto a ogni scrittura. I refetch vengono eseguiti sullo stesso pool del traffico REST, ma occupano al massimo un quarto delle sue connessioni alla volta (5 delle 20 predefinite, mai meno di 2); le altre attendono il proprio turno nel server, di modo che il fan-out di una scrittura ritardi i propri frame anziché le richieste generali. Una tabella scritta più volte al secondo mentre **migliaia di utenti diversi** osservano lo stesso elenco non filtrato è la situazione in cui questi frame iniziano ad accumulare ritardo. Filtrando la sottoscrizione sulla colonna letta dalla tua policy (`where owner == me` accanto a `owner = app.uid`), il costo torna a essere di una sola lettura; in alternativa, utilizza un [canale di broadcast](#canali-di-broadcast) per trasportare la modifica e consentire ai client di rieseguire il fetch secondo la propria pianificazione.

**Un socket può mantenere al massimo 1.000 sottoscrizioni.** La successiva viene rifiutata con un frame di errore con codice `TOO_MANY_SUBSCRIPTIONS`; una nuova sottoscrizione con un ID già registrato sul socket sostituisce tale sottoscrizione e non viene conteggiata due volte. L'SDK condivide le sottoscrizioni identiche su un socket, quindi questo valore conteggia gli elenchi e i record distinti aperti da una pagina. È possibile modificarlo tramite `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` o `realtime.maxSubscriptionsPerSocket` sull'adapter Postgres (la variabile d'ambiente ha la precedenza); un valore diverso da un numero intero positivo arresta l'avvio del server. **Anche i socket aperti da un singolo utente possono essere limitati**, per singola istanza del server: impostando `REALTIME_MAX_SOCKETS_PER_USER` (o `realtime.maxSocketsPerUser`), un accesso che supera tale limite viene rifiutato con `TOO_MANY_SOCKETS` e il socket viene chiuso con codice 4002. I socket autenticati tramite chiave API vengono conteggiati rispetto a tale chiave, ciascuna singolarmente, e non rispetto all'account che l'ha creata; la chiave di servizio costituisce una credenziale singola, quindi tutti i suoi socket vengono conteggiati insieme. I socket di un amministratore che impersona un utente vengono conteggiati a carico dell'amministratore, insieme ai suoi socket, e non dell'utente di cui fa le veci. L'SDK notifica istantaneamente ogni sottoscrizione attiva e `onConnectionLost` con un errore `CONNECTION_LOST` il cui `details.reason` è `TOO_MANY_SOCKETS`, continuando a riprovare con attese crescenti fino a 30 s, permettendo alla scheda di connettersi non appena un altro socket si chiude. Se non impostato, come da default, non esiste alcun limite massimo.

L'ID di una sottoscrizione appartiene al socket: due client che denominano entrambi una sottoscrizione `"sub-1"` mantengono ciascuno la propria, e un `unsubscribe` termina unicamente quella del mittente.

**La sottoscrizione viene conteggiata ai fini del rate limit dei dati.** Il primo frame di una sottoscrizione è una lettura, eseguita con l'identità del sottoscrittore, così come la richiesta della cronologia di un canale. Pertanto, `subscribe_collection`, `subscribe_one` e `channel_history` vengono conteggiati come richieste di dati nel bucket di rate limit del chiamante (lo stesso condiviso dalle sue richieste HTTP e dagli altri suoi socket) una volta esaurita la quota riservata del socket. Ogni socket può inviarne 1.000 senza che vengano conteggiate, o tante quante il limite massimo di sottoscrizioni se superiore, e la quota si rigenera nell'arco di 15 minuti. Questo copre tutto ciò che un socket può contenere, garantendo che la risottoscrizione dopo una riconnessione non venga mai rifiutata né intacchi il budget dell'utente. Oltre tale quota, un frame che supera il limite viene rifiutato con un frame di errore con codice `RATE_LIMITED`, che l'SDK inoltra all'`onError` della sottoscrizione o a quello del canale.

### Socket che smettono di rispondere

Un client può scomparire senza chiudere il proprio socket: un telefono perde il segnale, un laptop va in sospensione, un NAT dimentica la connessione. Non arrivando alcun frame di chiusura, nulla avvisa il server. Di conseguenza, il server invia un ping a ogni socket ogni 30 secondi e termina quelli che non hanno risposto entro il ping successivo, rilasciando così un client scomparso entro un minuto. I browser e l'SDK rispondono ai ping in autonomia; anche un client che interagisce direttamente con il protocollo deve rispondere, come fa la maggior parte delle librerie WebSocket.

**Lato browser.** Un browser non può inviare un ping né rilevarne uno, quindi un socket semiaperto gli apparirà connesso all'infinito. L'SDK apre il socket con `?rebase_caps=heartbeat,channel_seq,cancel_sql`; un server che li riconosce risponde con `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, elencando le funzionalità supportate (`cancel_sql`: accetta il frame `CANCEL_SQL` della console SQL), e invia `{"type":"heartbeat"}` ogni 30 secondi; l'SDK chiude il socket e [si riconnette](#riconnessione-automatica) dopo due heartbeat mancati. A un client che non specifica nulla non viene inviato nessuno dei due, e un server precedente ignora il parametro, quindi un SDK che comunica con esso si comporta come prima.

Un socket viene terminato anche quando più di 16&nbsp;MiB di frame inviati risultano ancora non letti. Questo accade con un client che non legge ciò che riceve, o che è talmente in ritardo che quanto leggerebbe sarebbe ormai obsoleto. Inoltre, quando i socket del server accumulano complessivamente più di 256&nbsp;MiB non letti (o un quarto del limite di memoria con cui opera il server, se inferiore), i socket con la maggiore quantità di dati non letti vengono terminati per primi, finché i restanti non rientrano nei limiti.

Un socket terminato viene ripulito come un socket chiuso: le sue sottoscrizioni terminano, lascia i suoi canali e la sua presenza viene rimossa, notificando l'uscita agli altri membri. Un client ancora attivo vede cadere la connessione, e l'SDK [si riconnette](#riconnessione-automatica) e si sottoscrive nuovamente.

## Canali di Broadcast

I canali di broadcast consentono ai client di scambiarsi messaggi arbitrari in tempo reale, utili per funzionalità come indicatori di digitazione, posizioni del cursore o notifiche personalizzate.

Il broadcast viene gestito a livello di protocollo WebSocket. Il server supporta i seguenti tipi di messaggio:

| Tipo di Messaggio | Direzione       | Descrizione                              |
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

Per impostazione predefinita, un broadcast raggiunge i membri attualmente connessi e poi scompare. Questo è il compromesso ideale per notifiche e cursori, e non costa nulla.

Per un flusso di operazioni (editing collaborativo o qualsiasi contesto in cui un'interruzione silenziosa provochi divergenze), un canale può essere configurato per **conservare** (retain) i propri messaggi. Ai broadcast conservati viene assegnato un numero di sequenza univoco per canale e vengono archiviati, consentendo a un client che si riconnette di richiedere tutti i messaggi successivi all'ultimo visualizzato.

:::caution[Dove va configurato]
**Runtime gestito: da nessuna parte.** La conservazione nei canali e `realtime.bus` fanno parte dell'adapter di database che il runtime gestito costruisce autonomamente, e nessuno dei due dispone di una variabile d'ambiente. Esegui l'eject per configurarli.
**Ejected:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
:::

La conservazione è facoltativa (opt-in) e si configura qui, sul server:

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
| `limit` | Mantieni al massimo questo numero dei messaggi più recenti per canale       |
| `ttl`   | Mantieni i messaggi al massimo per questa durata: `"30s"`, `"15m"`, `"24h"`, `"7d"` o millisecondi |

Una regola richiede almeno uno tra `limit` o `ttl`. Una regola priva di entrambi viene ignorata e registrata nei log, poiché una conservazione illimitata non è quasi mai desiderata e non può essere revocata facilmente una volta che la tabella è cresciuta.

:::note[Perché non consentire ai client di richiedere la cronologia?]
Un canale viene creato da chiunque ne specifichi il nome. Se un client potesse scegliere la profondità della propria cronologia, qualsiasi visitatore potrebbe costringere il backend a un'archiviazione incontrollata. La configurazione a questo livello fa sì che i canali di presenza e notifica (la stragrande maggioranza) non abbiano costi aggiuntivi: senza regole configurate non viene creata alcuna tabella e il broadcast segue lo stesso percorso sincrono di sempre.
:::

### Archiviazione

I canali con conservazione utilizzano due tabelle nello schema `rebase`, create automaticamente all'avvio quando è configurata almeno una regola:

| Tabella                   | Contenuto                                                      |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | I messaggi conservati, indicizzati da `(channel, seq)`          |
| `rebase.channel_cursors`  | La sequenza più alta emessa per ciascun canale                  |

L'eliminazione dei vecchi messaggi (pruning) avviene man mano che arrivano nuovi messaggi, con una frequenza limitata (throttled) per canale, in modo che il costo dipenda dal tempo trascorso anziché dal volume di scrittura. Vengono rimosse solo le righe da `channel_messages`; i cursori vengono mantenuti a tempo indeterminato (costituiscono una singola piccola riga per canale), poiché azzerare la sequenza di un canale altererebbe il significato del punto di ripristino salvato dal client.

### Garanzie di recapito

- **Ordinato.** I numeri di sequenza sono assegnati per canale e l'ordine di recapito corrisponde all'ordine di sequenza: su una singola istanza e tra istanze sul bus `postgres`, dove l'istruzione che numera un messaggio lo annuncia contemporaneamente, garantendo che ogni istanza (inclusa quella del mittente) riceva gli annunci nell'ordine di sequenza. Un bus fornito dall'utente trasporta i frame nell'ordine in cui li consegna.
- **Persistente prima del recapito.** Un messaggio che non può essere memorizzato non viene recapitato a nessuno e il mittente viene informato. Recapitarlo lo mostrerebbe ai sottoscrittori attivi escludendolo però da ogni riproduzione futura, e nessun messaggio successivo potrebbe sanare questa lacuna.
- **At-least-once durante il recupero.** L'intervallo di riproduzione può sovrapporsi a messaggi che un client ha già ricevuto; l'SDK scarta quelli che ha già consegnato.
- **Nessuna lacuna (No holes).** Un messaggio conservato raggiunge ogni membro: al mittente, al quale non viene mai recapitato il proprio messaggio, viene invece inviato `{"type":"broadcast_ack","channel","seq"}` qualora abbia abilitato `channel_seq`. Pertanto, un messaggio con sequenza superiore a `lastSeq + 1` indica che ne è andato perso uno; l'SDK lo trattiene temporaneamente, richiede la cronologia intermedia e consegna tutti i messaggi nell'ordine corretto. Rispetto a un server privo di `channel_seq`, un salto di sequenza viene consegnato non appena arriva.

:::caution[La cronologia ha lo stesso modello di accesso del canale]
Un client che si è unito a un canale può riprodurre i messaggi conservati, inclusi quelli trasmessi prima del suo ingresso: l'appartenenza al canale è l'unico controllo e l'adesione è aperta a qualsiasi client in grado di specificarne il nome. La conservazione è facoltativa in base al pattern del canale, quindi abilitarla rende lo storico di quel canale leggibile a qualunque visitatore ne indovini il nome. Nei canali conservati questo aspetto diventa persistente anziché temporaneo: considera quindi i contenuti di un canale con conservazione come pubblici per i tuoi utenti.
:::

## Tracciamento della presenza (Presence Tracking)

La presenza tiene traccia di quali utenti sono attualmente online in un canale e consente a ciascun utente di condividere uno stato personalizzato (ad es. posizione del cursore, stato).

| Tipo di Messaggio | Direzione       | Descrizione                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Inizia a tracciare la presenza con stato personalizzato |
| `presence_untrack`| Client → Server | Interrompi il tracciamento della presenza            |
| `presence_state`  | Client → Server | Richiedi lo stato di presenza completo per un canale |
| `presence_state`  | Server → Client | Tutte le presenze nel canale, complete               |
| `presence_diff`   | Server → Client | Aggiornamento incrementale (ingressi e uscite)       |

Quando un client invia `presence_track`, il server lo unisce automaticamente al canale (senza bisogno di un `join_channel` separato) e trasmette un `presence_diff` a tutti i membri del canale. L'SDK invia nuovamente il proprio stato ogni circa 20 secondi come heartbeat; un heartbeat il cui stato non è cambiato aggiorna semplicemente il timeout del client e non invia alcun `presence_diff`.

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

Le presenze inattive vengono ripulite automaticamente dopo 30 secondi di inattività.

## Riconnessione automatica

L'SDK tipizzato si riconnette automaticamente in caso di caduta della connessione WebSocket:

- **Backoff esponenziale** — Ogni tentativo di riconnessione attende un intervallo che parte da 2 secondi e raddoppia a ogni tentativo, fino a 30 secondi. Il ritardo viene calcolato in modo casuale all'interno di tale intervallo, ma mai inferiore a un quarto di secondo, così che i client disconnessi contemporaneamente a seguito di un deploy si riconnettano scaglionati nell'arco dell'intero intervallo anziché all'unisono.
- **Nessuna interruzione finché ci sono risorse attive** — Finché esiste una sottoscrizione o un canale a cui si è uniti, il client continua a tentare la riconnessione al limite massimo di 30 secondi per tutta la durata del disservizio. In assenza di elementi registrati si interrompe dopo 5 tentativi falliti, e la successiva sottoscrizione riavvia i tentativi. In un browser, l'evento `online` e il ritorno della scheda in primo piano avviano entrambi immediatamente la riconnessione senza attendere il backoff.
- **I disservizi vengono segnalati una sola volta** — Quando la connessione è interrotta da 14 secondi, a prescindere dal numero di tentativi effettuati, l'`onError` di ogni sottoscrizione attiva e di ogni canale connesso riceve un `RebaseApiError` con codice `CONNECTION_LOST`. La sottoscrizione viene **mantenuta**: l'errore segnala che i dati non si stanno aggiornando, non che la sottoscrizione sia terminata.
- **Risottoscrizione automatica** — In seguito a una riconnessione riuscita, tutte le sottoscrizioni attive vengono registrate nuovamente sul server e il successivo `onUpdate` di ciascuna conterrà qualsiasi dato scritto durante l'assenza del client. Tale aggiornamento costituisce il segnale di ripristino. Non è richiesto alcun intervento manuale.
- **Le richieste sono at-most-once** — Una richiesta effettuata mentre il socket è inattivo attende la riconnessione per un massimo di 30 secondi dalla chiamata, per poi fallire con `REQUEST_TIMEOUT` senza venire mai inviata. Una richiesta già inviata nel momento in cui la connessione è caduta fallisce con `CONNECTION_LOST` e **non** viene inviata nuovamente: il server potrebbe averla già eseguita o meno, e solo il chiamante può sapere se sia sicuro rieseguirla.

`client.ws.state` indica lo stato della connessione e `onStateChange` viene notificato a ogni modifica:

| Stato | Significato |
|---|---|
| `idle` | Nessun socket presente e nessuno attualmente richiesto (la connessione è lazy), oppure un sign-out l'ha chiusa. |
| `connecting` | Connessione in corso, senza alcuna interruzione pregressa. |
| `connected` | Il socket è aperto. |
| `reconnecting` | Il socket è caduto e il client sta tentando la riconnessione. Nessun problema è stato ancora segnalato. |
| `disconnected` | L'interruzione dura da 14 secondi o più. È stato segnalato `CONNECTION_LOST` e il client continua a tentare la riconnessione. |
| `closed` | È stato chiamato `client.close()`. Stato definitivo. |

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

L'interfaccia di amministrazione di Rebase mostra un proprio banner quando lo stato è `disconnected`, mantenendo a schermo le righe e i record già presenti anziché sostituirli con un errore.

## Autenticazione e RLS

Le sottoscrizioni WebSocket rispettano automaticamente le policy di Row-Level Security (RLS). Quando il client è autenticato:

1. La connessione WebSocket si autentica utilizzando lo stesso token JWT dell'API REST.
2. Ogni refetch della sottoscrizione viene eseguito all'interno di una transazione PostgreSQL con `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)`, garantendo l'applicazione delle policy RLS.
3. L'identità viene verificata continuamente per tutta la durata di apertura del socket, non solo al momento dell'autenticazione iniziale. Prima di ciascun frame, il server effettua gli stessi controlli di una richiesta HTTP: il token è ancora valido? La sessione è stata chiusa o revocata? L'account esiste ancora e quali ruoli possiede attualmente? Per i frame dei canali questo controllo avviene al massimo una volta al secondo. I frame che arrivano su un socket mentre la verifica è ancora in corso — come un client che reinvia le proprie sottoscrizioni dopo una riconnessione — condividono tale controllo anziché ripeterlo singolarmente; il frame successivo alla conclusione del controllo effettuerà una nuova verifica. Un socket di solo ascolto viene verificato almeno ogni 30 secondi e un token cessa di essere valido nell'istante esatto in cui scade. La revoca di un ruolo si applica a partire dal frame successivo (o da quello dopo ancora, per un frame che ha condiviso una verifica già in corso), sia per le letture che per le scritture e le sottoscrizioni aperte. Un socket la cui identità non è più valida riceve un frame `AUTH_ERROR` e viene chiuso con codice `4001`. Con l'autenticazione integrata, il codice del frame ne specifica il motivo in modo analogo alle route HTTP: `SESSION_REVOKED` (disconnesso, revocato o account eliminato), `ACCOUNT_DISABLED` o `TOKEN_EXPIRED`; per un adapter di autenticazione di terze parti il codice è `SESSION_ENDED`. Una richiesta `AUTHENTICATE` per una sessione revocata o un account disabilitato viene rifiutata con `SESSION_REVOKED` o `ACCOUNT_DISABLED` (un token non valido o scaduto con `INVALID_TOKEN`). L'SDK non riprova con lo stesso token e trasmette il rifiuto, codice incluso, all'`onError` dell'operazione che richiedeva l'account. L'SDK autentica nuovamente il socket a ogni aggiornamento (refresh) del token; un nuovo token per la medesima identità (stesso user id, ruoli, flag guest e claim) mantiene inalterate le sottoscrizioni aperte, mentre un token per un'identità diversa riesegue il fetch di ciascuna di esse con la nuova identità. Dopo un errore `4001`, il client si riconnette con la sessione attualmente valida, oppure senza alcuna sessione. Un client che interagisce direttamente con il protocollo deve inviare un nuovo token tramite `AUTHENTICATE` prima della scadenza di quello precedente.

Ciò significa che ogni socket riceve unicamente gli aggiornamenti per i record che la sua identità autenticata è autorizzata a visualizzare.

Anche una [chiave API](/docs/backend/api-keys/) può autenticare il socket: invia la chiave `rk_…` al posto dell'access token. Il socket verificherà quindi ogni frame rispetto agli [scope](/docs/backend/roles-and-scopes/) della chiave: un fetch, un conteggio o una sottoscrizione richiedono `data:read` sulla rispettiva tabella, un salvataggio richiede `data:write`, un'eliminazione `data:delete`. Un percorso annidato necessita del relativo scope base. I canali (broadcast e presenza) vengono rifiutati per le chiavi API, poiché nessuno scope li copre. L'editor SQL e i messaggi dei branch richiedono `database:read` o `database:write`, indifferentemente per una chiave API o per un utente.

L'esecuzione di più istanze — il bus LISTEN/NOTIFY, il funzionamento della presenza tra processi e la creazione di un trasporto personalizzato — è descritta in una pagina dedicata: [Realtime tra istanze](/docs/backend/realtime-transports/).

## Acquisizione delle modifiche a livello di database (CDC)

Ogni scrittura sottoposta a commit emette eventi realtime, indipendentemente da come è stata eseguita: REST, SDK, Studio, `psql`, un cron job in un altro servizio. Il funzionamento dell'acquisizione, l'impostazione `REALTIME_CDC` e i relativi requisiti sono disponibili in: [Acquisizione delle modifiche del database](/docs/backend/realtime-cdc/).

## Timeout delle richieste in sospeso

Per evitare che le richieste dei client rimangano bloccate all'infinito, tutte le operazioni WebSocket in sospeso che attendono una risposta dal server (come i fetch di tabelle one-shot `FETCH_COLLECTION`, i fetch di singole entità `FETCH_ONE`, la creazione/aggiornamento `SAVE`, le eliminazioni `DELETE`, i conteggi `COUNT` e i controlli di univocità `CHECK_UNIQUE_FIELD`) presentano un timeout predefinito di 30 secondi.

Se il server non risponde entro questa finestra di 30 secondi, il client elimina automaticamente la richiesta in sospeso e rifiuta la promise con un `RebaseApiError` con codice `REQUEST_TIMEOUT`.

I messaggi unidirezionali che non attendono una risposta (come `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` e `channel_history`) si risolvono immediatamente all'invio e non attivano questo timeout. Una sottoscrizione il cui primo frame non sia arrivato entro 30 secondi dall'invio della richiesta di sottoscrizione fallisce invece con `SUBSCRIPTION_TIMEOUT` sul proprio `onError`.

### Quando un frame di canale viene rifiutato

Un frame di canale è di tipo fire-and-forget: `await channel.broadcast(...)` si risolve quando il frame viene scritto sul socket, **non** quando il server lo ha accettato. Questa scelta è intenzionale: un'applicazione collaborativa trasmette la posizione del cursore sessanta volte al secondo, e attendere una conferma per ciascuna trasmissione trasformerebbe ogni operazione in un round trip completo.

Pertanto, un rifiuto non può presentarsi come una promise rigettata. Viene invece notificato su `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Codice | Significato |
|------|-------|
| `CHANNEL_FORBIDDEN` | Non fai parte del canale — unisciti prima di trasmettere o leggere la sua cronologia |
| `RATE_LIMITED` | Budget di frame di canale superato (7.200 frame di canale al minuto per socket) o, per una richiesta di cronologia, superamento del [rate limit dei dati](#quanto-costa-una-scrittura-e-limiti) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Impossibile rendere persistente un broadcast conservato, pertanto è stato scartato |
| `CHANNEL_HISTORY_READ_FAILED` | Impossibile soddisfare una richiesta di recupero cronologia (catch-up) |
| `CHANNEL_HISTORY_GAP` | Generato dal client: un recupero ha rilevato che il server non conserva più i messaggi che questo client non ha mai ricevuto. `details` è `{ from, to }`, ovvero i numeri di sequenza persi. Risincronizza lo stato del canale dalla sua fonte di verità (source of truth) |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Il broadcast ha raggiunto unicamente questa istanza — consulta [Il limite di 8 KB sul bus Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

In assenza di un gestore collegato, questi errori vengono registrati nei log come warning. In precedenza venivano scartati del tutto: non c'era alcuna promise da rifiutare né alcun canale a cui recapitarli, rendendo un broadcast vietato indistinguibile da uno regolarmente consegnato.

## Passaggi successivi

- [Typed SDK](/docs/sdk) — Documentazione completa dell'SDK, inclusi gli accessor tipizzati per le tabelle.
- [Authentication](/docs/backend/authentication) — Configurazione dell'autenticazione JWT e delle policy RLS.
- [Backend Architecture](/docs/backend) — Panoramica dell'architettura del server Rebase.
