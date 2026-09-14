---
sourceHash: da709fdddc946e75
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
3. **Callback del client** — L'SDK del client attiva il callback `onUpdate` con i nuovi dati.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Per i deployment multi-istanza, Rebase utilizza `LISTEN/NOTIFY` di PostgreSQL per trasmettere le modifiche tra le istanze del server. Questo processo è gestito automaticamente: una connessione PostgreSQL dedicata è in ascolto sul canale `rebase_entity_changes` e ritrasmette gli aggiornamenti ai sottoscrittori locali.

### Zero configurazione

Il realtime è abilitato per impostazione predefinita. Non ci sono flag da attivare o servizi da avviare: se il server Rebase è in esecuzione, l'endpoint WebSocket è disponibile.

> Per impostazione predefinita, Rebase emette anche eventi realtime per le scritture effettuate **all'esterno** dell'API (tramite `psql`, un altro servizio o l'editor SQL di Studio) ogni volta che la connessione al database lo supporta — consulta [acquisizione delle modifiche a livello di database (CDC)](#acquisizione-delle-modifiche-a-livello-di-database-cdc).

## Sottoscrizioni dell'SDK client

L'SDK client di Rebase espone due metodi di sottoscrizione su ciascun accessor di collezione:

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
  (entity) => {
    if (entity) {
      console.log("Product updated:", entity.values);
    } else {
      console.log("Product was deleted");
    }
  },
  (error) => {
    console.error("Subscription error:", error);
  }
);
```

Il callback riceve `Entity<M> | undefined`. Un valore `undefined` indica che l'entità è stata eliminata.

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

2. **Refetch RLS con debounce.** Dopo **300ms** (`REFETCH_DEBOUNCE_MS`), il server riesegue il fetch della collezione con i filtri e l'ordinamento originali. La query viene eseguita all'interno di una transazione che imposta `app.user_id` e `app.user_roles` a livello di transazione in base al `SubscriptionAuthContext` del sottoscrittore, in modo che Postgres valuti la Row-Level Security sotto l'identità di quel client e solo le righe che è autorizzato a visualizzare vengano inviate nel `collection_update`. Il debounce unifica inoltre una raffica di scritture in un'unica query.

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

Quando il conteggio stesso fallisce, il frame contiene `partial: true` e nessun `total`; questo non costituisce un errore di sottoscrizione, e il client dovrebbe mantenere l'ultimo totale effettivo anziché sostituirlo con la lunghezza della pagina.

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

- **Ordinato.** I numeri di sequenza sono allocati per canale e l'ordine di recapito corrisponde all'ordine di sequenza.
- **Persistente prima del recapito.** Un messaggio che non può essere salvato non viene recapitato a nessuno, e il mittente viene notificato. Recapitarlo lo mostrerebbe ai sottoscrittori connessi escludendolo da qualsiasi replay futuro, e nessun messaggio successivo potrebbe sanare tale vuoto.
- **At-least-once durante il recupero.** Un intervallo di replay può sovrapporsi a messaggi che un client ha già ricevuto; l'SDK scarta quelli già recapitati.

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

Quando un client invia `presence_track`, il server lo unisce automaticamente al canale (senza necessità di una chiamata separata a `join_channel`) e trasmette in broadcast un `presence_diff` a tutti i membri del canale.

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

L'SDK client si riconnette automaticamente in caso di caduta della connessione WebSocket:

- **Backoff esponenziale** — I ritardi di riconnessione partono da 1 secondo e raddoppiano a ogni tentativo, fino a un massimo di 30 secondi.
- **Massimo 5 tentativi** — Dopo 5 tentativi di riconnessione non riusciti, il client smette di riprovare.
- **Risottoscrizione automatica** — In caso di riconnessione riuscita, tutte le sottoscrizioni attive vengono nuovamente registrate sul server. Non è richiesto alcun intervento manuale.
- **Accodamento dei messaggi** — I messaggi inviati mentre si è disconnessi vengono accodati e recapitati dopo la riconnessione.

È possibile ascoltare gli eventi del ciclo di vita della connessione:

```typescript
// `ws` is undefined on a client built without realtime, so narrow it once.
const ws = client.ws;
if (ws) {
    ws.on("connect", () => console.log("Connected"));
    ws.on("disconnect", () => console.log("Disconnected"));
    ws.on("reconnect", () => console.log("Reconnected"));
    ws.on("error", (error) => console.error("Error:", error));
}
```

## Autenticazione e RLS

Le sottoscrizioni WebSocket rispettano automaticamente i criteri di Row-Level Security (RLS). Quando il client è autenticato:

1. La connessione WebSocket si autentica utilizzando lo stesso token JWT dell'API REST.
2. Ogni refetch della sottoscrizione viene eseguito all'interno di una transazione PostgreSQL con `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)` — garantendo l'applicazione delle policy RLS.
3. Il token viene verificato una sola volta, all'autenticazione del socket, e il server non lo controlla più per l'intera durata della connessione. Un token di accesso che scade, una sessione revocata o un ruolo rimosso non modificano ciò che un socket aperto può leggere fino a quando non si riautentica o si riconnette. L'SDK riautentica il proprio socket ogni volta che aggiorna il token e lo disconnette al logout; un client che implementa direttamente il protocollo mantiene l'identità con cui è stato aperto finché non si riconnette.

Ciò significa che ogni socket riceve aggiornamenti solo per i record che la sua identità autenticata ha il permesso di visualizzare.

L'esecuzione di più istanze — il bus LISTEN/NOTIFY, il comportamento della presence tra processi e la scrittura di un transport personalizzato — è descritta in una pagina dedicata:
[Realtime tra istanze](/docs/backend/realtime-transports/).

## Acquisizione delle modifiche a livello di database (CDC)

**Change Data Capture è attivo per impostazione predefinita.** Rebase acquisisce le modifiche a livello di database ed emette eventi realtime per **ogni scrittura sottoposta a commit, indipendentemente da come è stata eseguita** — REST, SDK, Studio, `psql`, un cron job in un altro servizio, Drizzle/SQL raw o l'**editor SQL** di Studio. È lo stesso modello adottato da Supabase Realtime per analizzare il write-ahead log.

Nessuna configurazione richiesta. Su una connessione al database che lo supporta, CDC si auto-inizializza all'avvio; su quelle che non lo supportano (ad es. un ruolo con privilegi limitati che non può creare trigger), Rebase ricorre silenziosamente al realtime a livello applicativo — niente da abilitare, nulla che si interrompa.

### Configurazione

CDC è controllato dalla variabile d'ambiente `REALTIME_CDC`:

| Valore | Comportamento |
| --- | --- |
| `auto` *(predefinito)* | Abilita l'acquisizione a livello di database se la connessione lo supporta; effettua un **fallback silenzioso** al realtime a livello applicativo in caso contrario. Zero configurazione. |
| `trigger` | Forza l'acquisizione basata su trigger. Funziona su qualsiasi istanza PostgreSQL, incluse le istanze gestite prive di replica logica. Emette un avviso (invece del fallback silenzioso) se non è possibile effettuare il provisioning. |
| `wal` | Predilige la replica logica WAL. Non ancora integrata — degrada a `trigger` e registra nei log la modalità attiva. |
| `off` | Solo realtime a livello applicativo. Usalo per evitare l'overhead dei trigger per ogni scrittura su carichi di lavoro ad alta intensità di scrittura. |

All'avvio vedrai una riga di log che indica la modalità attiva, ad esempio:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Se la connessione non lo supporta, `auto` registra invece una riga informativa e prosegue con il realtime a livello applicativo:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Come funziona

1. **Auto-provisioning** — All'avvio (nel contesto server/owner), Rebase installa un trigger idempotente `AFTER INSERT/UPDATE/DELETE` su ciascuna tabella gestita. Il trigger emette una notifica di modifica compatta sul canale `rebase_cdc`. Un payload che supererebbe il limite di 8&nbsp;KB del comando `NOTIFY` di PostgreSQL effettua un fallback a un messaggio contenente solo l'identità, impedendo così a CDC di interrompere la scrittura che ha generato l'evento.
2. **Acquisizione** — Un client `LISTEN` dedicato e non condiviso (unpooled) per istanza consuma `rebase_cdc`, mappa la tabella modificata sulla rispettiva collezione e inserisce la modifica nella stessa pipeline di `RealtimeService` utilizzata dalle mutazioni API. Come il listener tra istanze, predilige `DATABASE_DIRECT_URL` e si riconnette automaticamente.
3. **Recapito sicuro con RLS** — La riga grezza proveniente dal flusso di modifiche non viene **mai** inoltrata ai sottoscrittori. La modifica viene contrassegnata come invalidata e ciascuna sottoscrizione rilegge la riga con il **proprio** contesto di autenticazione. Il filtraggio avviene quindi per sottoscrittore, mai per publisher: un client riceve unicamente le righe consentite dalle proprie policy RLS.
4. **Tra istanze (Cross-instance)** — Poiché ogni istanza osserva ogni commit attraverso il flusso di modifiche, CDC funge anche da canale cross-instance; il broadcast legacy `rebase_entity_changes` per mutazione non viene utilizzato quando CDC è attivo.
5. **Deduplicazione** — Una mutazione effettuata tramite l'API di Rebase viene recapitata localmente nell'istante in cui viene eseguito il commit e viene anche rimandata indietro come eco attraverso il flusso di modifiche. L'istanza di origine sopprime quell'eco (un record a vita breve delle proprie emissioni), evitando che i sottoscrittori ricevano due volte una scrittura API.

### Requisiti e note

- CDC richiede una stringa di connessione diretta (`DATABASE_DIRECT_URL` o la connessione primaria) per il client `LISTEN` — i connection pooler in modalità transazione non supportano sessioni `LISTEN` persistenti.
- I trigger vengono installati solo su tabelle collegate a una collezione registrata. Le scritture su tabelle non mappate vengono ignorate.
- Una collezione la cui tabella non è ancora stata migrata viene ignorata con un avviso invece di bloccare CDC per il resto.
- Lo streaming di replica logica WAL nativo (`wal2json`/`pgoutput`) è pianificato; attualmente `REALTIME_CDC=wal` degrada al percorso basato su trigger, che garantisce una copertura equivalente a livello di database.

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
| `RATE_LIMITED` | Superato il budget di frame del canale indicato sopra |
| `CHANNEL_HISTORY_WRITE_FAILED` | Un broadcast conservato non ha potuto essere salvato, quindi è stato scartato |
| `CHANNEL_HISTORY_READ_FAILED` | Impossibile soddisfare una richiesta di recupero (catch-up) |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Il broadcast ha raggiunto solo questa istanza — consulta [Il limite di 8 KB sul bus Postgres](/docs/backend/realtime-transports/#the-8-kb-limit-on-the-postgres-bus) |

Senza alcun gestore collegato, questi errori vengono registrati nei log come avvisi (warning). In precedenza venivano scartati del tutto: non c'era alcuna promise da rifiutare né un canale a cui recapitarli, per cui un broadcast vietato era indistinguibile da uno recapitato con successo.

## Passaggi successivi

- [Client SDK](/docs/sdk) — Documentazione completa dell'SDK inclusi gli accessor tipizzati per le collezioni.
- [Authentication](/docs/backend/authentication) — Configura l'autenticazione JWT e i criteri RLS.
- [Backend Architecture](/docs/backend) — Panoramica dell'architettura del server Rebase.
