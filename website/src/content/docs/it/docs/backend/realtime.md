---
sourceHash: 8cfa91fb2859caf0
title: Realtime & WebSocket
sidebar_label: Realtime
description: Sincronizzazione dei dati in tempo reale, canali di trasmissione (broadcast) e tracciamento della presenza tramite WebSocket.
---

Rebase include un motore realtime integrato che invia le modifiche ai dati ai client connessi tramite WebSocket.
Quando un record viene creato, aggiornato o eliminato, ogni sottoscrittore che osserva quella tabella o entità riceve l'aggiornamento istantaneamente — senza richiedere alcun polling.

## Come funziona

La pipeline realtime si articola in tre fasi:

1. **Trigger del database** — Una mutazione raggiunge il database PostgreSQL (tramite REST API, SDK o Studio).
2. **Fan-out del server** — Il server Rebase rileva la modifica e la distribuisce a ogni sottoscrizione WebSocket attiva che corrisponde alla tabella o all'entità interessata.
3. **Callback del client** — L'SDK tipizzato attiva la tua callback `onUpdate` con i dati aggiornati.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Per le distribuzioni multi-istanza, Rebase utilizza `LISTEN/NOTIFY` di PostgreSQL per propagare le modifiche tra le diverse istanze del server. Questo processo è gestito automaticamente. Con la [change capture a livello di database](/docs/backend/realtime-cdc/) abilitata (l'impostazione predefinita ovunque il ruolo del database possa creare trigger), ogni istanza rimane in ascolto sul canale `rebase_cdc` su cui i trigger di acquisizione pubblicano, garantendo che una scrittura venga intercettata indipendentemente dal processo o dallo strumento che l'ha generata. Senza acquisizione, ogni istanza notifica le proprie scritture sul canale `rebase_entity_changes`, e una connessione dedicata su ogni altra istanza le inoltra ai propri sottoscrittori locali.

### Configurazione zero

Il realtime è abilitato nativamente. Non c'è alcun flag da impostare o servizio da avviare — se il server Rebase è in esecuzione, l'endpoint WebSocket è disponibile.

### Quale percorso risponde al socket

Il socket risponde alle richieste di upgrade su un unico percorso: il percorso di base dell'API con la parte finale `/api` rimossa, quindi `/` per un'API su `/api`. È qui che l'SDK si connette: effettua il dial al suo `baseUrl`, mentre le sue richieste HTTP sono indirizzate a `${baseUrl}/api`. Una richiesta di upgrade verso qualsiasi altro percorso viene lasciata agli altri listener `upgrade` del server, consentendo alla tua applicazione di eseguire il proprio server WebSocket sullo stesso `http.Server`. In assenza di altri listener, a tale upgrade viene risposto con un `404`.

In un [custom server](/docs/backend/custom-server/), `backend.attachRealtime(server, { path })` imposta il percorso, e la voce `realtime.path` dell'adapter Postgres sovrascrive quanto ricavato dal server.

> Per impostazione predefinita, Rebase emette eventi realtime anche per le scritture effettuate **all'esterno** dell'API (tramite `psql`, un altro servizio o l'editor SQL di Studio) ogni volta che la connessione al database lo supporta — consulta [change capture a livello di database](/docs/backend/realtime-cdc/).

## Sottoscrizioni tramite SDK tipizzato

L'SDK tipizzato di Rebase espone due metodi di sottoscrizione su ciascun accessor di tabella:

- **`listen()`** — Sottoscrive un'intera tabella (con filtri opzionali).
- **`listenById()`** — Sottoscrive una singola entità tramite il suo ID.

Entrambi i metodi restituiscono una **funzione di annullamento della sottoscrizione (unsubscribe)** da invocare per interrompere la ricezione degli aggiornamenti.

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

La callback riceve un oggetto `FindResult<M>` contenente:
- `data` — Le righe, in formato piatto, così come restituite da `find()` (`row.name`, non `row.values.name`).
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

Usa `listenById()` per monitorare uno specifico record:

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

La callback riceve la riga, in formato piatto, così come restituita da `findById()` (`row.name`, non `row.values.name`), oppure `undefined` una volta che la riga è stata eliminata.

**Ogni frame trasporta la versione della riga.** `etagOf(row)` è l'identificatore `ETag` restituito da una `GET` della riga, pertanto una modifica effettuata rispetto a ciò che mostrava un frame può essere salvata con `ifMatch: etagOf(row)` e verrà rifiutata con `412` se la riga nel frattempo è cambiata (consulta [Scritture condizionali](/docs/backend/writes/)). A livello di rete, il comando `subscribe_one` dell'SDK richiede `etag: true`, e ciascun frame `single_update` per una riga esistente include `"etag"` accanto a `"row"`. Un server precedente ignora questa richiesta e non invia alcun tag, mentre un client che non lo richiede riceverà frame sprovvisti di tag.

### Annullare la sottoscrizione

Sia `listen()` che `listenById()` restituiscono una funzione di annullamento. Invocala per interrompere la ricezione degli aggiornamenti e liberare le risorse lato server:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Invoca sempre la funzione di annullamento quando un componente viene smontato o si naviga via da una pagina. Questo previene perdite di memoria (memory leak) e lavoro superfluo sul server.
:::

## Query Builder `.listen()`

Anche il query builder supporta le sottoscrizioni in tempo reale. Concatena i filtri, quindi invoca `.listen()` invece di `.find()`:

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
`.listen()` — sia sul query builder che sull'accessor della tabella — richiede il WebSocket del client. Il client ricava il proprio URL da `baseUrl`, a meno che non sia specificato `websocketUrl`. Su un client istanziato con `realtime: false`, o su uno che non è riuscito a ricavare alcun URL, la chiamata a `.listen()` genera un errore.
:::

## Distribuzione degli aggiornamenti: Patch istantanea + Refetch di correttezza

Una modifica non viaggia mai verso un sottoscrittore come dato grezzo. Viaggia come notifica del fatto che
qualcosa è cambiato; a ciascun sottoscrittore viene poi comunicato ciò che *può* effettivamente vedere tramite una
query eseguita con la propria identità:

1. **Invalidazione.** Quando un'entità cambia (creata, aggiornata, eliminata), il
   server contrassegna i percorsi interessati. La riga appena scritta non viene inoltrata direttamente —
   è stata letta con l'autorizzazione di chi ha scritto, che non dice nulla su ciò che
   un qualsiasi sottoscrittore ha il permesso di vedere.

2. **Refetch con debounce ed RLS.** Dopo **300ms** (`REFETCH_DEBOUNCE_MS`), il server
   esegue nuovamente il fetch della tabella con i tuoi filtri originali e l'ordinamento configurato. La query
   viene eseguita all'interno di una transazione che imposta a livello locale `app.user_id` e
   `app.user_roles` estraendoli dal `SubscriptionAuthContext` del sottoscrittore; in questo modo Postgres
   valuta la Row-Level Security sotto l'identità di quel client e solo le righe che
   è autorizzato a visualizzare vengono inviate nel `collection_update`. Il debounce
   inoltre raggruppa una raffica di scritture in un'unica query. Attende 300 ms senza
   ulteriori modifiche, ma mai più di **1 s** (`REFETCH_MAX_WAIT_MS`) dopo
   la prima modifica, garantendo che una tabella soggetta a scritture multiple al secondo invii comunque
   ai suoi sottoscrittori un frame almeno una volta al secondo. Puoi configurare questo limite con `REALTIME_REFETCH_MAX_WAIT_MS` (o `realtime.refetchMaxWaitMs`): valori più alti eseguono il refetch di una tabella attiva meno spesso, valori più bassi inviano frame più aggiornati.

   Un refetch che legge esattamente ciò che era già stato inviato al sottoscrittore non gli invia
   nulla: una scrittura alla riga 9.000 di un elenco che mostra le prime 50 costa
   la lettura, non l'invio di un frame a ogni osservatore. Dopo un frame di errore, le righe
   successive vengono inviate nuovamente anche se identiche.

Le versioni precedenti inviavano un `collection_patch` immediato contenente la riga scritta
prima di questo refetch, per un feedback istantaneo tra schede diverse. Quella riga era stata
letta nell'ambito dei permessi di chi scriveva, quindi poteva — ed accadeva — raggiungere sottoscrittori le cui
policy l'avrebbero invece negata; inoltre, il filtro `where` della sottoscrizione non
veniva applicato ad essa. La patch è stata rimossa: la latenza percepita per un
aggiornamento coincide ora con la finestra di debounce.

### Il refetch è la lettura REST

Il refetch esegue la stessa pipeline di `GET /api/data/<collection>`, con la
stessa gestione di `include`. È questo che permette a `find({ q })` e `listen({ q })`
di restituire righe identiche campo per campo.

In passato veniva utilizzato un metodo differente — che nidificava ogni relazione sotto
un involucro `{ "__type": "relation" }` e, poiché una sottoscrizione non poteva includere parametri
`include`, caricava in modo eager **tutte** le relazioni dichiarate dalla tabella. Di conseguenza, la stessa
query rispondeva con una struttura via HTTP e un'altra via socket, portando un client
che le renderizzava entrambe a vedere le righe mutare struttura non appena avveniva una scrittura.

Un frame di sottoscrizione accetta quindi gli stessi parametri di una richiesta di elenco: `filter`,
`logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` e
`fields`. `vectorSearch` fa eccezione ed è **rifiutato** con
`VECTOR_SEARCH_NOT_LIVE` — una sottoscrizione viene rieseguita a ogni scrittura corrispondente e
non è prevista alcuna elaborazione per il calcolo delle distanze.

### `collection_update` trasporta i propri metadati

Il frame è composto da `{ rows, pks, meta }`:

```json
{
    "type": "collection_update",
    "subscriptionId": "…",
    "rows": [ { "id": 1, "title": "Widget" } ],
    "pks": [ { "fieldName": "id", "type": "number" } ],
    "meta": { "total": 150, "limit": 20, "offset": 0, "hasMore": true, "nextCursor": "eyJ…" }
}
```

`meta` viene calcolato all'interno della stessa transazione soggetta a RLS che ha letto le righe, quindi
descrive esattamente le righe che lo affiancano. Senza di esso, un client che necessitava di un totale
doveva eseguire una chiamata `GET /count` **per ogni push** — un round-trip aggiuntivo per ogni scrittura, per ogni
sottoscrittore, con una finestra temporale in cui il conteggio e le righe descrivevano
stati differenti della tabella.

Se il conteggio stesso fallisce, il frame include `partial: true` e nessun valore `total`;
questo non è considerato un errore di sottoscrizione, e il client dovrebbe preservare l'ultimo totale reale
piuttosto che sostituirlo con la lunghezza della pagina. Su tabelle di grandi dimensioni, il conteggio rappresenta la maggior parte del costo di un frame. Impostando `REALTIME_RECOUNT_INTERVAL_MS`, un elenco il cui ultimo totale era di almeno `REALTIME_RECOUNT_MIN_ROWS` (100.000 per impostazione predefinita) riutilizza quel totale per l'intervallo specificato invece di ricalcolarlo a ogni scrittura; in tal caso il frame include `meta.totalAsOf`, che indica quando il conteggio è stato rilevato. Al termine dell'intervallo, un elenco il cui ultimo frame ha riutilizzato il totale viene conteggiato nuovamente e riceve il nuovo totale, indipendentemente dal fatto che ci siano state scritture nel frattempo. Se non impostato (comportamento predefinito), il conteggio avviene ad ogni frame.

### Il costo di una scrittura e i limiti

Poiché ogni frame è una query eseguita con l'identità del proprio sottoscrittore, il costo di una scrittura cresce
con il numero di **interrogazioni distinte poste da entità (principal) distinte**
sulla tabella interessata — non con il numero di socket aperti:

- Le sottoscrizioni che pongono la stessa interrogazione (stesso percorso, filtri, ordinamento, pagina,
  `include`, `fields`, ricerca) come la medesima entità (stesso user id, ruoli,
  flag ospite e claim) condividono un unico refetch. Una scrittura su un elenco costa **una
  sola transazione per tale gruppo** — la lettura e il relativo conteggio — a prescindere da quanti socket
  la trattengano; ogni membro riceve comunque un frame generato da righe lette sotto quell'identità.
  Una prima pagina che restituisce meno elementi del proprio `limit` rappresenta già l'intero
  set, pertanto non viene conteggiata affatto.
- Una sottoscrizione a un singolo record viene interrogata solo quando il proprio record cambia.
- Entità diverse non condividono mai una lettura — è questo che impedisce a un frame
  di trasportare una riga che il lettore non ha il permesso di vedere. Un elenco visualizzato da mille
  utenti autenticati diversi comporta mille letture e mille conteggi a ogni
  scrittura su di esso, suddivisi in mille transazioni.

Valori misurati su un portatile a fronte di un'istanza PostgreSQL locale con un pool di 20 connessioni, per una singola
scrittura su un elenco:

| Sottoscrittori | Transazioni per la scrittura | Ultimo frame dopo la scrittura |
|---|---|---|
| 1.000, un solo principal | 2 | ~310 ms |
| 1.000, ciascuno un principal diverso | ~1.000 | ~600 ms |

300 ms di ciascun test sono dovuti al debounce. La seconda riga rappresenta il limite massimo da considerare nella pianificazione. I
refetch vengono eseguiti sullo stesso pool del traffico REST, ma occupano al massimo un quarto delle
sue connessioni contemporaneamente (5 sulle 20 predefinite, mai meno di 2); le altre
attendono il proprio turno all'interno del server, in modo che il fan-out di una scrittura ritardi i propri frame
piuttosto che le richieste HTTP. Una tabella su cui si scrive più volte al secondo mentre
**centinaia di utenti diversi** visualizzano lo stesso elenco è lo scenario in cui questi frame
possono iniziare ad accumulare ritardo. Al di sopra di tale soglia, è consigliabile optare per sottoscrizioni più ristrette (una pagina, un filtro sulle
righe appartenenti all'utente) oppure per un [canale di broadcast](#canali-broadcast) che veicoli la
modifica per consentire ai client di effettuare il refetch secondo le proprie tempistiche.

**Un singolo socket può contenere al massimo 1.000 sottoscrizioni.** La successiva viene rifiutata con un frame di errore con codice `TOO_MANY_SUBSCRIPTIONS`; sottoscrivere nuovamente con un ID già registrato dal socket sostituisce la sottoscrizione precedente e non incrementa il conteggio. L'SDK condivide sottoscrizioni identiche sullo stesso socket, pertanto questo limite conta gli elenchi e i record distinti aperti da una singola pagina. Questo valore può essere modificato con `REALTIME_MAX_SUBSCRIPTIONS_PER_SOCKET` o `realtime.maxSubscriptionsPerSocket` sull'adapter Postgres (la variabile d'ambiente ha la precedenza); un valore diverso da un numero intero positivo impedisce l'avvio del server. **È possibile limitare anche i socket detenuti da un singolo utente**, per istanza di server: impostando `REALTIME_MAX_SOCKETS_PER_USER` (o `realtime.maxSocketsPerUser`), un accesso che supera tale soglia viene rifiutato con `TOO_MANY_SOCKETS` e il socket viene chiuso con codice 4002. I socket autenticati tramite chiave API concorrono al conteggio di quella specifica chiave, ciascuna singolarmente, e non dell'account che l'ha generata; la service key è considerata un'unica credenziale, quindi tutti i suoi socket concorrono insieme. I socket di un amministratore che effettua l'impersonificazione di un utente vengono conteggiati a carico dell'amministratore (assieme agli altri suoi socket), e non dell'utente impersonato. L'SDK notifica istantaneamente ogni sottoscrizione attiva e il callback `onConnectionLost`, mediante un errore `CONNECTION_LOST` il cui campo `details.reason` è `TOO_MANY_SOCKETS`, continuando a tentare la riconnessione con intervalli incrementali fino a 30 s, permettendo alla scheda di accedere non appena un altro socket viene chiuso. Se non impostato (comportamento predefinito), non vi è alcun limite.

L'ID di una sottoscrizione appartiene al rispettivo socket: due client che denominano entrambi una sottoscrizione `"sub-1"` mantengono ciascuno la propria, e un'operazione di `unsubscribe` interrompe unicamente quella del mittente.

**L'atto di sottoscrizione concorre al rate limit dei dati.** Il primo frame di una sottoscrizione è una lettura, eseguita con l'identità del sottoscrittore, esattamente come una richiesta della cronologia di un canale. Pertanto `subscribe_collection`, `subscribe_one` e `channel_history` vengono conteggiate come richieste dati nel bucket di rate-limit del chiamante (lo stesso condiviso dalle sue richieste HTTP e dagli altri suoi socket) una volta esaurita la soglia assegnata al socket. Ciascun socket può inviarne 1.000 senza che vengano conteggiate, o un numero pari al proprio limite massimo di sottoscrizioni se superiore, e la soglia si rigenera nell'arco di 15 minuti. Questo copre tutto ciò che un socket può mantenere, garantendo che la risottoscrizione successiva a una riconnessione non venga mai rifiutata e non intacchi il budget dell'utente. Oltre tale soglia, un frame che eccede il limite viene rifiutato con un frame di errore con codice `RATE_LIMITED`, che l'SDK inoltra all'`onError` di quella sottoscrizione o del canale.

### Socket che non rispondono

Un client può disconnettersi senza chiudere esplicitamente il proprio socket: un telefono perde
il segnale, un portatile entra in sospensione, un router NAT perde traccia della connessione. Nessun frame di chiusura
viene ricevuto, quindi il server non riceve alcuna notifica. Il server invia pertanto un ping a ogni socket
ogni 30 secondi e chiude le connessioni che non hanno risposto entro il ping successivo, facendo sì che
un client non più raggiungibile venga disconnesso entro un minuto. I browser e l'SDK rispondono
ai ping automaticamente; un client che implementa il protocollo direttamente deve rispondere
ad essi a sua volta, come previsto dalla maggior parte delle librerie WebSocket.

**Lato browser.** Un browser non può inviare un ping o intercettarne uno, quindi un socket half-open gli apparirà connesso all'infinito. L'SDK apre il socket con `?rebase_caps=heartbeat,channel_seq,cancel_sql`; un server compatibile risponde con `{"type":"hello","capabilities":[…],"heartbeatMs":30000}`, elencando le funzionalità supportate (`cancel_sql`: accetta il frame `CANCEL_SQL` della console SQL), e trasmette `{"type":"heartbeat"}` ogni 30 secondi; l'SDK termina il socket ed effettua una [riconnessione](#auto-riconnessione) dopo due heartbeat consecutivi mancati. A un client che non richiede nulla non viene inviato nessuno dei due messaggi, e un server meno recente ignorerà il parametro, garantendo che un SDK che comunica con esso mantenga il comportamento pregresso.

Un socket viene terminato anche se accumula oltre 16&nbsp;MiB di frame inviati e non ancora
letti. Questo identifica un client che non legge i dati ricevuti, oppure uno talmente
lento che ciò che andrebbe a leggere risulterebbe ormai obsoleto. Inoltre, quando i socket di un server trattengono
complessivamente più di 256&nbsp;MiB non letti (o un quarto del limite di memoria
dell'istanza del server, se inferiore), le connessioni con il maggior volume di dati non letti vengono terminate
per prime, fino al rientro nei parametri previsti.

Un socket terminato viene ripulito come un socket chiuso regolarmente. Le sue sottoscrizioni decadono,
abbandona i propri canali e la sua presenza viene rimossa, notificando l'uscita
agli altri membri. Un client che è ancora online noterà la caduta della connessione,
e l'SDK gestirà la [riconnessione](#auto-riconnessione) e la successiva sottoscrizione.

## Canali broadcast

I canali broadcast permettono ai client di scambiarsi messaggi arbitrari in tempo reale — utili per funzionalità come indicatori di digitazione, posizioni del cursore o notifiche personalizzate.

Il broadcast è gestito a livello di protocollo WebSocket. Il server supporta questi tipi di messaggi:

| Tipo di messaggio | Direzione | Descrizione |
|---|---|---|
| `join_channel` | Client → Server | Unisciti a un canale specifico |
| `leave_channel` | Client → Server | Abbandona un canale |
| `broadcast` | Client → Server | Invia un messaggio a tutti i membri del canale |
| `broadcast` | Server → Client | Ricevi un messaggio da un altro membro |
| `channel_history` | Client → Server | Richiedi i messaggi conservati a partire da una sequenza |
| `channel_history` | Server → Client | I messaggi conservati che il client ha perso |

Quando un client invia un messaggio `broadcast`, il server lo inoltra a **tutti gli altri membri** di quel canale (il mittente non riceve la copia del proprio messaggio).

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

## Retention dei canali

Per impostazione predefinita, un broadcast raggiunge i membri attualmente connessi e poi svanisce. È il compromesso ideale per notifiche e cursori, e non comporta alcun costo.

Per un flusso di operazioni — scrittura collaborativa, o qualunque contesto in cui una perdita silenziosa provochi disallineamenti — un canale può essere configurato per **trattenere (retain)** i propri messaggi. Ai broadcast trattenuti viene assegnato un numero di sequenza per canale e vengono archiviati, consentendo a un client che si riconnette di richiedere tutti i messaggi successivi all'ultimo visualizzato.

:::caution[Dove configurare questa opzione]
**Runtime gestito: da nessuna parte.** La retention del canale e `realtime.bus` fanno parte
dell'adapter del database che il runtime gestito costruisce internamente, e nessuno dei due prevede
una variabile d'ambiente. Effettua l'eject per configurarli.
**Ejected:** `createPostgresAdapter({ realtime })` in `backend/src/index.ts`.
:::

La retention è una funzionalità opzionale (opt-in) e va configurata sul server:

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

| Campo | Descrizione |
|---|---|
| `match` | Nome esatto del canale (`"doc:42"`) o prefisso con carattere jolly finale `*` (`"doc:*"`) |
| `limit` | Mantieni al massimo questo numero di messaggi più recenti per canale |
| `ttl` | Mantieni i messaggi per questo intervallo di tempo massimo — `"30s"`, `"15m"`, `"24h"`, `"7d"`, o millisecondi |

Una regola deve specificare almeno uno tra `limit` e `ttl`. Una regola priva di entrambi viene ignorata e registrata nei log, poiché una retention illimitata non è quasi mai auspicabile e non può essere revocata facilmente una volta che la tabella si è espansa.

:::note[Perché non lasciare che siano i client a richiedere la cronologia?]
Un canale viene creato da chiunque ne indichi il nome. Se un client potesse decidere la profondità della propria cronologia, qualunque visitatore potrebbe vincolare il tuo backend a uno spazio di archiviazione indefinito. Configurare l'opzione in questa sede fa sì inoltre che i canali di presenza e notifica — la stragrande maggioranza — non abbiano costi aggiuntivi: in assenza di regole configurate, nessuna tabella viene creata e il broadcast segue lo stesso percorso sincrono consueto.
:::

### Archiviazione

I canali con retention si appoggiano a due tabelle nello schema `rebase`, create automaticamente all'avvio se è presente almeno una regola configurata:

| Tabella | Contenuto |
|---|---|
| `rebase.channel_messages` | I messaggi archiviati, indicizzati da `(channel, seq)` |
| `rebase.channel_cursors` | Il valore di sequenza più alto assegnato per canale |

L'eliminazione dei messaggi obsoleti (pruning) avviene man mano che arrivano nuovi messaggi, con frequenza regolata per canale in modo che il costo sia legato al trascorrere del tempo anziché al volume di scrittura. Questa procedura rimuove unicamente righe da `channel_messages` — i cursori vengono mantenuti a tempo indefinito (costituiscono un'unica piccola riga per canale), poiché azzerare la sequenza di un canale altererebbe il punto di ripristino memorizzato da un client.

### Garanzie di consegna

- **Ordinate.** I numeri di sequenza sono allocati per canale e l'ordine di consegna corrisponde a quello di sequenza — su una singola istanza così come tra istanze sul bus `postgres`, in cui l'istruzione che assegna il numero a un messaggio è la stessa che ne invia la notifica; così ciascuna istanza (compresa quella mittente) riceve le notifiche rispettando l'ordine di sequenza. Un bus fornito manualmente trasmette i frame nell'ordine in cui li recapita.
- **Durevolezza prima della consegna.** Un messaggio che non può essere memorizzato non viene recapitato a nessuno, e il mittente ne viene informato. Consegnarlo lo esporrebbe ai sottoscrittori connessi escludendolo però da qualunque riproduzione (replay) futura, e nessun messaggio successivo potrebbe sanare quel vuoto.
- **At-least-once durante il recupero.** Un intervallo di riproduzione può sovrapporsi a messaggi che un client ha già ricevuto; l'SDK provvede a scartare quelli già consegnati.
- **Nessuna lacuna (No holes).** Un messaggio trattenuto raggiunge ogni membro: al mittente, al quale non viene mai rimandato il proprio messaggio, viene inviato `{"type":"broadcast_ack","channel","seq"}` a condizione che abbia abilitato l'opzione `channel_seq`. In questo modo un messaggio con sequenza superiore a `lastSeq + 1` indica che uno o più messaggi intermedi sono andati persi; l'SDK lo trattiene, richiede la cronologia mancante e li consegna tutti ordinatamente. Verso un server che non supporta `channel_seq`, i salti di sequenza vengono recapitati non appena ricevuti.

:::caution[La cronologia eredita lo stesso modello di accesso del canale]
Un client che si è unito a un canale può riprodurre i suoi messaggi archiviati, inclusi quelli trasmessi prima del suo ingresso — l'appartenenza al canale è l'unico controllo eseguito, e l'accesso è consentito a qualsiasi client conosca il nome del canale. Poiché la retention si attiva in base a criteri di corrispondenza sui canali, abilitarla rende il passato di quel canale leggibile a chiunque ne indovini il nome. Nei canali con retention queste informazioni diventano persistenti anziché effimere: considera il contenuto di un canale con retention come pubblicamente accessibile a tutti i tuoi utenti.
:::

## Tracciamento della presenza

La presenza tiene traccia di quali utenti sono attualmente online all'interno di un canale e consente a ciascuno di condividere uno stato personalizzato (es. posizione del cursore, disponibilità).

| Tipo di messaggio | Direzione | Descrizione |
|---|---|---|
| `presence_track` | Client → Server | Avvia il tracciamento della presenza con uno stato personalizzato |
| `presence_untrack` | Client → Server | Interrompi il tracciamento della presenza |
| `presence_state` | Client → Server | Richiedi lo stato di presenza completo per un canale |
| `presence_state` | Server → Client | Tutte le presenze nel canale, nella loro totalità |
| `presence_diff` | Server → Client | Aggiornamento incrementale (ingressi e uscite) |

Quando un client invia `presence_track`, il server lo associa automaticamente al canale (senza bisogno di una chiamata distinta a `join_channel`) e invia un `presence_diff` a tutti i membri del canale. L'SDK invia nuovamente il proprio stato ogni circa 20 secondi sotto forma di heartbeat; un heartbeat il cui stato è rimasto inalterato aggiorna solo il timeout del client senza emettere alcun `presence_diff`.

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

Le presenze inattive vengono rimosse automaticamente dopo 30 secondi di assenza di riscontri.

## Auto-riconnessione

L'SDK tipizzato gestisce automaticamente la riconnessione quando la connessione WebSocket cade:

- **Backoff esponenziale** — Ogni nuovo tentativo attende un intervallo che parte da 2 secondi e raddoppia progressivamente, fino a un massimo di 30 secondi. L'attesa effettiva include una variazione casuale calcolata sull'intero intervallo, ma non scende mai al di sotto di 250 millisecondi; in questo modo i client disconnessi simultaneamente da un rilascio (deploy) non si riconnettono nello stesso istante, distribuendosi uniformemente nell'intervallo.
- **Nessuna interruzione finché ci sono risorse attive** — Fintanto che esiste una sottoscrizione o un canale a cui si è uniti, il client prosegue i tentativi di connessione a intervalli massimi di 30 secondi per l'intera durata del disservizio. Qualora non vi siano elementi registrati, si arresta dopo 5 tentativi falliti, e la successiva sottoscrizione avvierà nuovamente la connessione. All'interno del browser, l'evento `online` e il ritorno della scheda visibile in primo piano provocano entrambi una riconnessione immediata senza attendere il backoff.
- **I disservizi vengono notificati una sola volta** — Quando la connessione risulta assente per 14 secondi consecutivi, a prescindere dal numero di tentativi effettuati, l'`onError` di ciascuna sottoscrizione attiva e l'`onError` di ciascun canale registrato ricevono un errore `RebaseApiError` con codice `CONNECTION_LOST`. La sottoscrizione **rimane attiva**: l'errore segnala che i dati non si stanno aggiornando, non che la sottoscrizione sia stata revocata.
- **Risottoscrizione automatica** — In seguito a una riconnessione riuscita, tutte le sottoscrizioni attive vengono nuovamente registrate sul server, e la successiva invocazione di `onUpdate` per ciascuna conterrà le modifiche scritte durante il periodo di disconnessione del client. Questo aggiornamento funge da segnale di avvenuto ripristino. Non è richiesto alcun intervento manuale.
- **Le richieste sono at-most-once** — Una richiesta formulata mentre il socket è disconnesso attende la riconnessione fino a un massimo di 30 secondi dalla chiamata, per poi fallire con `REQUEST_TIMEOUT` senza mai essere trasmessa. Una richiesta già inviata nel momento in cui la connessione si interrompe fallisce con `CONNECTION_LOST` e **non** viene reinviata: il server potrebbe averla già eseguita o meno, e solo il chiamante ha gli elementi per determinare se una seconda esecuzione sia sicura.

L'attributo `client.ws.state` descrive la condizione corrente della connessione, e l'evento `onStateChange` ne notifica ciascuna variazione:

| Stato | Significato |
|---|---|
| `idle` | Nessun socket presente né attualmente richiesto (la connessione è di tipo lazy), oppure disconnesso in seguito a un sign-out. |
| `connecting` | Connessione in corso, senza alcuna interruzione pregressa rilevata. |
| `connected` | Il socket è aperto e operativo. |
| `reconnecting` | Il socket è caduto e il client sta tentando la riconnessione. Nessun problema prolungato è stato ancora segnalato. |
| `disconnected` | La disconnessione si protrae da 14 o più secondi. È stato notificato `CONNECTION_LOST` e il client prosegue con i tentativi. |
| `closed` | È stato invocato `client.close()`. Stato terminale. |

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

Il pannello di amministrazione di Rebase mostra un banner informativo dedicato fintanto che lo stato permane su `disconnected`, mantenendo le righe e i record già visibili a schermo invece di rimpiazzarli con un messaggio di errore.

## Autenticazione & RLS

Le sottoscrizioni WebSocket rispettano nativamente i criteri di Row-Level Security (RLS). Quando il client è autenticato:

1. La connessione WebSocket si autentica impiegando il medesimo token JWT dell'API REST.
2. Ogni operazione di refetch legata a una sottoscrizione viene eseguita all'interno di una transazione PostgreSQL che include `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)`, assicurando che le policy RLS siano applicate.
3. L'identità viene verificata con continuità per l'intera durata di apertura del socket, non unicamente al momento dell'autenticazione iniziale. Prima dell'elaborazione di ciascun frame il server esegue gli stessi controlli previsti per una richiesta HTTP: verifica che il token sia tuttora valido, che la sessione non sia stata chiusa o revocata, che l'account esista ancora e quali ruoli ricopra al momento. I frame relativi ai canali vengono verificati al massimo una volta al secondo. I frame che pervengono su un socket mentre la relativa verifica è ancora in corso — come nel caso di un client che trasmette nuovamente le proprie sottoscrizioni dopo una riconnessione — condividono la medesima verifica anziché ripeterla singolarmente; il frame immediatamente successivo alla conclusione del controllo avvierà una nuova verifica. Un socket impiegato esclusivamente per l'ascolto viene verificato almeno ogni 30 secondi, e il token cessa di essere valido nell'istante esatto della sua scadenza. La revoca di un ruolo diventa effettiva a partire dal frame successivo (o, nel caso di un frame che condivideva una verifica già in corso, da quello immediatamente seguente), applicandosi indistintamente a letture, scritture e sottoscrizioni aperte. Un socket la cui identità risulti decaduta riceve un frame di tipo `AUTH_ERROR` e viene chiuso con il codice `4001`. Utilizzando il sistema di autenticazione integrato, il codice del frame ne specifica il motivo in maniera analoga alle rotte HTTP: `SESSION_REVOKED` (logout, revoca o eliminazione dell'account), `ACCOUNT_DISABLED` oppure `TOKEN_EXPIRED`; con un adapter di autenticazione esterno il codice sarà `SESSION_ENDED`. Una richiesta di `AUTHENTICATE` per una sessione revocata o un account disabilitato viene rifiutata con `SESSION_REVOKED` o `ACCOUNT_DISABLED` (un token non verificabile o scaduto genererà `INVALID_TOKEN`). L'SDK non effettua ulteriori tentativi con il medesimo token, inoltrando il rifiuto, comprensivo di codice, all'`onError` dell'operazione che richiedeva l'account. L'SDK provvede ad autenticare nuovamente il socket a ogni rinnovo del token; un nuovo token associato alla medesima identità (stesso user id, ruoli, flag ospite e claim) mantiene inalterate le sottoscrizioni in essere, mentre un token riconducibile a un'identità diversa comporterà l'esecuzione di un nuovo fetch per ciascuna di esse in base al nuovo profilo. In seguito alla ricezione di un codice `4001`, la riconnessione avverrà con la sessione al momento disponibile, o in assenza di essa. I client che comunicano direttamente tramite protocollo sono tenuti a inviare un token rinnovato tramite il messaggio `AUTHENTICATE` prima della scadenza del precedente.

Ciò assicura che ciascun socket riceva unicamente gli aggiornamenti relativi ai record che l'identità autenticata ha titolo di visualizzare.

Anche una [chiave API](/docs/backend/api-keys/) consente l'autenticazione del socket: è sufficiente passare
la chiave `rk_…` al posto dell'access token. Il socket verificherà ogni frame
a fronte degli [scope](/docs/backend/roles-and-scopes/) associati alla chiave: una fetch, un conteggio o una
sottoscrizione richiedono `data:read` sulla tabella interessata, un salvataggio `data:write`, una cancellazione
`data:delete`. I percorsi nidificati richiedono lo scope generico. I canali (broadcast e
presenza) non sono utilizzabili con una chiave API, in quanto nessuno scope ne contempla l'autorizzazione. I messaggi dell'editor SQL e
delle branch richiedono `database:read` o `database:write`, indifferentemente per una chiave o per un
utente autenticato.

La gestione di più istanze in contemporanea — il bus LISTEN/NOTIFY, il funzionamento della presenza
tra diversi processi e l'implementazione di un transport dedicato — è approfondita in un documento dedicato:
[Realtime su più istanze](/docs/backend/realtime-transports/).

## Change Capture a livello di database (CDC)

Ogni scrittura confermata (committed) genera eventi in tempo reale, indipendentemente dal canale utilizzato: REST,
SDK, Studio, `psql` o un cron job in un servizio terzo. Il funzionamento della change capture,
il parametro `REALTIME_CDC` e i requisiti necessari sono descritti in: [Database change capture](/docs/backend/realtime-cdc/).

## Timeout delle richieste pendenti

Per impedire che le richieste inviate dai client rimangano bloccate indefinitamente, tutte le operazioni WebSocket in attesa di un riscontro dal server (come i fetch una tantum su tabelle `FETCH_COLLECTION`, i fetch su singole entità `FETCH_ONE`, le creazioni o aggiornamenti `SAVE`, le eliminazioni `DELETE`, i conteggi `COUNT` e le verifiche di unicità `CHECK_UNIQUE_FIELD`) presentano un timeout predefinito di 30 secondi.

Qualora il server non fornisca risposta entro questa finestra di 30 secondi, il client cancella automaticamente la richiesta in sospeso e rigetta la promise restituendo un errore `RebaseApiError` contraddistinto dal codice `REQUEST_TIMEOUT`.

I messaggi monodirezionali che non prevedono una risposta esplicita (tra cui `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack`, `presence_state` e `channel_history`) si risolvono immediatamente all'atto dell'invio e non sono soggetti a questo timeout. Se il primo frame di una sottoscrizione non perviene entro 30 secondi dall'invio della richiesta iniziale, la sottoscrizione fallisce generando l'errore `SUBSCRIPTION_TIMEOUT` sul proprio handler `onError`.

### Quando un frame del canale viene rifiutato

I frame indirizzati a un canale funzionano secondo una logica fire-and-forget: l'istruzione `await channel.broadcast(...)` si risolve non appena
il frame è stato inviato al socket, **non** all'atto dell'effettiva accettazione da parte del server. Questa
scelta è intenzionale: un'applicazione collaborativa può trasmettere la posizione del cursore sessanta volte al
secondo, e attendere una ricevuta per ciascun invio trasformerebbe ogni singola operazione in un
round trip completo.

Di conseguenza, un eventuale rifiuto non può assumere la forma di una promise rigettata. Verrà invece notificato all'`onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Codice | Significato |
|---|---|
| `CHANNEL_FORBIDDEN` | Non sei un membro del canale — unisciti al canale prima di trasmettere o leggerne la cronologia |
| `RATE_LIMITED` | Superamento del limite di frame del canale (7.200 frame al minuto per socket) o, per le richieste di cronologia, del [rate limit dei dati](#il-costo-di-una-scrittura-e-i-limiti) |
| `CHANNEL_HISTORY_WRITE_FAILED` | Impossibile persistere un broadcast trattenuto (retained), pertanto è stato scartato |
| `CHANNEL_HISTORY_READ_FAILED` | Impossibile elaborare la richiesta di allineamento (catch-up) della cronologia |
| `CHANNEL_HISTORY_GAP` | Segnalato dal client: la sincronizzazione ha rilevato che il server non conserva più i messaggi che il client non ha mai ricevuto. `details` contiene `{ from, to }`, ovvero i numeri di sequenza mancanti. Risincronizza lo stato del canale dalla sua fonte di verità |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Il broadcast ha raggiunto unicamente questa istanza — consulta [Il limite di 8 KB sul bus Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

In assenza di un gestore esplicitamente configurato, queste occorrenze vengono registrate nei log come avvisi (warning). In passato venivano
semplicemente ignorate: non essendovi alcuna promise da rigettare né un'istanza di canale cui notificare l'accaduto,
una trasmissione non autorizzata risultava del tutto indistinguibile da una andata a buon fine.

## Prossimi passi

- [Typed SDK](/docs/sdk) — Documentazione completa dell'SDK inclusi gli accessor tipizzati per le tabelle.
- [Autenticazione](/docs/backend/authentication) — Configura l'autenticazione JWT e le policy RLS.
- [Architettura del backend](/docs/backend) — Panoramica sull'architettura del server Rebase.
