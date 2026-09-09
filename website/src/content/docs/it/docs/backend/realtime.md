---
sourceHash: 05f7e05823faa1cf
title: Realtime e WebSocket
sidebar_label: Realtime
description: Sincronizzazione dei dati in tempo reale, canali di broadcast e tracciamento della presenza tramite WebSocket.
---

Rebase include un motore realtime integrato che invia le modifiche ai dati ai client connessi tramite WebSocket.
Quando un record viene creato, aggiornato o eliminato, ogni sottoscrittore che osserva quella collection o entità riceve l'aggiornamento all'istante, senza dover ricorrere al polling.

## Come funziona

La pipeline realtime si articola in tre fasi:

1. **Trigger del database** — Una mutazione raggiunge il database PostgreSQL (tramite API REST, SDK o Studio).
2. **Fan-out del server** — Il server Rebase rileva la modifica e la distribuisce (fan-out) a ogni sottoscrizione WebSocket attiva corrispondente alla collection o entità interessata.
3. **Callback del client** — L'SDK del client attiva la tua callback `onUpdate` con i dati aggiornati.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Per i deployment multi-istanza, Rebase utilizza `LISTEN/NOTIFY` di PostgreSQL per trasmettere le modifiche tra le diverse istanze del server. Questa operazione viene gestita automaticamente: una connessione PostgreSQL dedicata ascolta sul canale `rebase_entity_changes` e inoltra gli aggiornamenti ai sottoscrittori locali.

### Configurazione zero

Il realtime è abilitato di default. Non c'è alcun flag da attivare né alcun servizio da avviare: se il tuo server Rebase è in esecuzione, l'endpoint WebSocket è disponibile.

> Per impostazione predefinita, Rebase emette anche eventi realtime per le scritture effettuate **al di fuori** dell'API (tramite `psql`, un altro servizio o l'editor SQL di Studio) ogni volta che la connessione al database lo supporta — vedi [acquisizione delle modifiche a livello di database (CDC)](#database-level-change-capture-cdc).

## Sottoscrizioni dell'SDK Client

L'SDK client di Rebase espone due metodi di sottoscrizione su ogni accessor di collection:

- **`listen()`** — Sottoscrivi un'intera collection (con filtri opzionali).
- **`listenById()`** — Sottoscrivi una singola entità tramite il suo ID.

Entrambi i metodi restituiscono una **funzione di annullamento della sottoscrizione (unsubscribe)** da chiamare per interrompere la ricezione degli aggiornamenti.

### Sottoscrivere una collection

Usa `listen()` per ricevere aggiornamenti ogni volta che i record in una collection cambiano:

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

La callback riceve un `FindResponse<M>` contenente:
- `data` — Array di oggetti `Entity<M>`.
- `meta` — Informazioni di paginazione (`total`, `limit`, `offset`, `hasMore`).

### Sottoscrivere una collection con filtri

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

Il server rispetta questi filtri: solo i record corrispondenti sono inclusi negli aggiornamenti.

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

La callback riceve `Entity<M> | undefined`. Un valore pari a `undefined` indica che l'entità è stata eliminata.

### Annullamento della sottoscrizione (Unsubscribing)

Sia `listen()` che `listenById()` restituiscono una funzione di annullamento. Chiamala per interrompere la ricezione degli aggiornamenti e liberare le risorse lato server:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Chiama sempre la funzione di annullamento quando un componente viene smontato (unmount) o quando si cambia pagina. Ciò previene perdite di memoria (memory leak) e carico inutile lato server.
:::

## `.listen()` nel Query Builder

Anche il query builder supporta le sottoscrizioni realtime. Concatena i tuoi filtri e chiama `.listen()` anziché `.find()`:

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

## Recapito degli aggiornamenti: Instant Patch + Correctness Refetch

Una modifica non viaggia mai verso un sottoscrittore sotto forma di dati grezzi. Viaggia come notifica del fatto che qualcosa è cambiato, e a ogni sottoscrittore viene poi comunicato ciò che *può* vedere tramite una query eseguita con la sua identità:

1. **Invalidazione.** Quando un'entità cambia (creata, aggiornata, eliminata), il server contrassegna i percorsi interessati. La riga scritta non viene inoltrata direttamente — è stata letta con l'autorizzazione di chi ha scritto, che non dice nulla su cosa ciascun sottoscrittore sia autorizzato a vedere.

2. **Refetch RLS con debounce.** Dopo **300ms** (`REFETCH_DEBOUNCE_MS`), il server riesegue il fetch della collection con i filtri e l'ordinamento originali. La query viene eseguita all'interno di una transazione che imposta i parametri locali di transazione `app.user_id` e `app.user_roles` derivati dal `SubscriptionAuthContext` del sottoscrittore, in modo che Postgres valuti la Row-Level Security con l'identità di quel client e solo le righe che è autorizzato a vedere vengano inviate nel `collection_update`. Il debounce raggruppa inoltre una raffica di scritture in un'unica query.

Le versioni precedenti inviavano un `collection_patch` immediato contenente la riga scritta prima di questo refetch, per un feedback cross-tab sotto il millisecondo. Quella riga era stata letta nell'ambito dei permessi di chi scriveva, quindi poteva — ed è successo — raggiungere sottoscrittori le cui policy l'avrebbero negata, e anche il filtro `where` della sottoscrizione non veniva applicato. La patch è stata rimossa: la latenza percepita per un aggiornamento è ora la finestra di debounce.

### Il refetch è la lettura REST

Il refetch esegue la stessa pipeline eseguita da `GET /api/data/<collection>`, con la medesima gestione di `include`. È questo che garantisce che `find({ q })` e `listen({ q })` restituiscano righe identiche campo per campo.

In precedenza si trattava di un metodo differente, che annidava ogni relazione in un wrapper `{ "__type": "relation" }` e, poiché una sottoscrizione non poteva includere parametri `include`, caricava in modo eager **ogni** relazione dichiarata dalla collection. Di conseguenza, la stessa query rispondeva con una struttura via HTTP e un'altra via socket, e un client che renderizzava entrambe vedeva la struttura delle righe cambiare nel momento in cui avveniva una scrittura.

Un frame di sottoscrizione accetta quindi gli stessi parametri di una richiesta di elenco: `filter`, `logical`, `orderBy`, `limit`, `offset`/`page`, `searchString`, `include` e `fields`. `vectorSearch` fa eccezione ed è **rifiutato** con `VECTOR_SEARCH_NOT_LIVE` — una sottoscrizione viene rieseguita a ogni scrittura corrispondente e lì nulla calcola le distanze.

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

`meta` viene conteggiato all'interno della stessa transazione vincolata da RLS che ha letto le righe, descrivendo quindi esattamente le righe adiacenti. Senza di esso, un client che necessitava di un totale doveva inviare una `GET /count` **per ogni push** — un round trip aggiuntivo per ogni scrittura e per ogni sottoscrittore, oltre a una finestra temporale in cui il conteggio e le righe descrivevano stati diversi della collection.

Quando il conteggio stesso fallisce, il frame contiene `partial: true` e nessun `total`; questo non costituisce un errore di sottoscrizione e il client dovrebbe mantenere l'ultimo totale reale anziché sostituirlo con la lunghezza della pagina.

## Canali di broadcast

I canali di broadcast consentono ai client di inviarsi messaggi arbitrari in tempo reale, utili per funzionalità come indicatori di digitazione, posizioni del cursore o notifiche personalizzate.

Il broadcast è gestito a livello di protocollo WebSocket. Il server supporta questi tipi di messaggio:

| Tipo di messaggio | Direzione       | Descrizione                              |
|-------------------|-----------------|------------------------------------------|
| `join_channel`    | Client → Server | Unisciti a un canale con nome            |
| `leave_channel`   | Client → Server | Lascia un canale                         |
| `broadcast`       | Client → Server | Invia un messaggio a tutti i membri del canale |
| `broadcast`       | Server → Client | Ricevi un messaggio da un altro membro   |
| `channel_history` | Client → Server | Richiedi i messaggi conservati dopo una determinata sequenza |
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

## Conservazione dei canali (Channel Retention)

Per impostazione predefinita, un broadcast raggiunge i membri attualmente connessi e poi scompare. È il compromesso ideale per notifiche e cursori, e non ha alcun costo.

Per uno stream di operazioni — editing collaborativo o qualsiasi situazione in cui un'interruzione silenziosa causi divergenze — un canale può essere configurato per **conservare** (retain) i propri messaggi. Ai broadcast conservati viene assegnato un numero progressivo di sequenza per canale e vengono archiviati, in modo che un client che si riconnette possa richiedere tutti i messaggi successivi all'ultimo visualizzato.

:::caution[Dove va configurato]
**Managed runtime: da nessuna parte.** La conservazione dei canali e `realtime.bus` fanno parte dell'adattatore del database che il runtime gestito costruisce autonomamente, e nessuno dei due ha una configurazione tramite variabili d'ambiente. Esegui l'eject per configurarli.
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
| `match` | Nome esatto del canale (`"doc:42"`) o prefisso con terminazione `*` (`"doc:*"`) |
| `limit` | Mantieni al massimo questo numero di messaggi più recenti per canale        |
| `ttl`   | Mantieni i messaggi per un tempo massimo pari a — `"30s"`, `"15m"`, `"24h"`, `"7d"` o millisecondi |

Una regola richiede almeno uno tra `limit` o `ttl`. Una regola senza nessuno dei due viene ignorata e registrata nei log, poiché una conservazione illimitata non è quasi mai voluta e non può essere annullata una volta che la tabella è cresciuta.

:::note[Perché non consentire ai client di richiedere la cronologia?]
Un canale viene creato da chiunque ne definisca il nome. Se un client potesse scegliere la profondità della propria cronologia, qualsiasi visitatore potrebbe impegnare il tuo backend con uno spazio di archiviazione illimitato. Configurarlo qui significa anche che i canali di presenza e notifica — la stragrande maggioranza — non hanno costi: senza regole configurate, non viene creata alcuna tabella e il broadcast segue lo stesso percorso sincrono di sempre.
:::

### Archiviazione

I canali con conservazione utilizzano due tabelle nello schema `rebase`, create automaticamente all'avvio quando è configurata almeno una regola:

| Tabella                   | Contenuto                                                       |
|---------------------------|-----------------------------------------------------------------|
| `rebase.channel_messages` | I messaggi conservati, indicizzati da `(channel, seq)`          |
| `rebase.channel_cursors`  | La sequenza più alta emessa per canale                          |

L'epurazione (pruning) avviene all'arrivo dei messaggi, limitata (throttled) per canale in modo che il costo segua il tempo trascorso anziché il volume di scrittura. Rimuove esclusivamente righe da `channel_messages` — i cursori vengono mantenuti indefinitamente (sono una singola piccola riga per canale), poiché il ripristino della sequenza di un canale altererebbe il significato del punto di ripristino salvato da un client.

### Garanzie di recapito

- **Ordinato.** I numeri di sequenza sono allocati per canale e l'ordine di consegna corrisponde all'ordine di sequenza.
- **Durevole prima della consegna.** Un messaggio che non può essere memorizzato non viene recapitato a nessuno e il mittente viene informato. Recapitarlo lo mostrerebbe ai sottoscrittori attivi escludendolo da ogni replay futuro, e nessun messaggio successivo potrebbe colmare tale divario.
- **At-least-once durante il recupero (catch-up).** Un intervallo di replay può sovrapporsi a messaggi già ricevuti dal client; l'SDK scarta quelli già consegnati.

:::caution[La cronologia ha lo stesso modello di accesso del canale]
Un client che si è unito a un canale può riprodurre i messaggi conservati, compresi quelli trasmessi prima del suo arrivo: l'appartenenza al canale è l'unico controllo e l'accesso è aperto a qualsiasi client che ne conosca il nome. La conservazione è facoltativa per pattern di canale, quindi abilitarla rende il passato di quel canale leggibile a qualsiasi visitatore che ne indovini il nome. I canali con conservazione rendono questa visibilità duratura anziché momentanea, pertanto considera il contenuto di un canale conservato come pubblico per i tuoi utenti.
:::

## Tracciamento della presenza (Presence Tracking)

La funzionalità di presenza monitora quali utenti sono attualmente online in un canale e consente a ciascun utente di condividere uno stato personalizzato (es. posizione del cursore, stato).

| Tipo di messaggio  | Direzione       | Descrizione                                          |
|--------------------|-----------------|------------------------------------------------------|
| `presence_track`   | Client → Server | Avvia il tracciamento della presenza con uno stato personalizzato |
| `presence_untrack` | Client → Server | Interrompi il tracciamento della presenza            |
| `presence_state`   | Client → Server | Richiedi lo stato completo della presenza per un canale |
| `presence_state`   | Server → Client | Entità completa di tutte le presenze in un canale    |
| `presence_diff`    | Server → Client | Aggiornamento incrementale (accessi e uscite)        |

Quando un client invia `presence_track`, il server lo unisce automaticamente al canale (non è necessario un `join_channel` separato) e trasmette un `presence_diff` a tutti i membri del canale.

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
- **Massimo 5 tentativi** — Dopo 5 tentativi falliti di riconnessione, il client smette di riprovare.
- **Risottoscrizione automatica** — In caso di riconnessione riuscita, tutte le sottoscrizioni attive vengono nuovamente registrate sul server. Nessun intervento manuale necessario.
- **Accodamento dei messaggi** — I messaggi inviati durante la disconnessione vengono accodati e recapitati dopo la riconnessione.

Puoi ascoltare gli eventi del ciclo di vita della connessione:

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

Le sottoscrizioni WebSocket rispettano automaticamente le policy di Row-Level Security (RLS). Quando il client è autenticato:

1. La connessione WebSocket si autentica utilizzando lo stesso token JWT dell'API REST.
2. Ogni refetch della sottoscrizione viene eseguito all'interno di una transazione PostgreSQL con `set_config('app.user_id', ...)` e `set_config('app.user_roles', ...)`, garantendo l'applicazione delle policy RLS.
3. Se un token scade durante una sessione attiva, il client si riautentica e si risottoscrive automaticamente.

Ciò significa che ogni utente riceve aggiornamenti solo per i record che ha il permesso di visualizzare.

L'esecuzione di più istanze — il bus LISTEN/NOTIFY, la gestione della presenza tra processi e la scrittura di un transport personalizzato — è descritta in una pagina dedicata:
[Realtime tra istanze](/docs/backend/realtime-transports/).

## Acquisizione delle modifiche a livello di database (CDC)

**Change Data Capture è attivo per impostazione predefinita.** Rebase acquisisce le modifiche a livello di database ed emette eventi realtime per **ogni scrittura sottoposta a commit, indipendentemente da come è stata eseguita** — REST, SDK, Studio, `psql`, un cron job in un altro servizio, Drizzle/SQL raw o l'**editor SQL** di Studio. È lo stesso modello utilizzato da Supabase Realtime che esegue il tail del write-ahead log.

Non è richiesta alcuna configurazione. Su una connessione di database che lo supporta, il CDC si autoconfigura all'avvio; su una che non lo supporta (ad esempio un ruolo limitato che non può creare trigger), Rebase passa silenziosamente all'uso del realtime a livello applicativo: nulla da attivare, nulla che si rompa.

### Configurazione

Il CDC è controllato dalla variabile d'ambiente `REALTIME_CDC`:

| Valore | Comportamento |
| --- | --- |
| `auto` *(default)* | Abilita l'acquisizione a livello di database dove la connessione lo supporta; in caso contrario, **effettua un fallback trasparente** al realtime a livello applicativo. Configurazione zero. |
| `trigger` | Forza l'acquisizione basata su trigger. Funziona su qualsiasi PostgreSQL, comprese le istanze gestite prive di replica logica. Mostra un avviso (invece di eseguire un fallback trasparente) se non riesce a configurarsi. |
| `wal` | Predilige la replica logica WAL. Non ancora integrata — degrada a `trigger` e registra la modalità attiva nei log. |
| `off` | Solo realtime a livello applicativo. Utilizzalo per evitare il sovraccarico dei trigger per ogni scrittura su carichi di lavoro intensivi in scrittura. |

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

1. **Autoconfigurazione** — All'avvio (nel contesto server/owner), Rebase installa un trigger idempotente `AFTER INSERT/UPDATE/DELETE` su ciascuna tabella gestita. Il trigger emette una notifica di modifica compatta sul canale `rebase_cdc`. Un payload che supererebbe il limite di 8&nbsp;KB di `NOTIFY` di PostgreSQL effettua il fallback a un messaggio contenente solo l'identificatore, garantendo che il CDC non possa mai causare l'abort della scrittura che ha scatenato il trigger.
2. **Acquisizione** — Un client `LISTEN` dedicato e non in pool per istanza consuma `rebase_cdc`, mappa la tabella modificata alla relativa collection e convoglia la modifica nella stessa pipeline `RealtimeService` usata dalle mutazioni API. Come il listener cross-istanza, predilige `DATABASE_DIRECT_URL` e si riconnette automaticamente.
3. **Consegna sicura per RLS** — La riga grezza proveniente dal flusso di modifiche non viene **mai** inoltrata ai sottoscrittori. La modifica viene contrassegnata come invalidata e ogni sottoscrizione rilegge la riga con il **proprio** contesto di autenticazione. Il filtraggio avviene quindi per sottoscrittore, mai per autore della modifica: un client riceve solo ed esclusivamente le righe consentite dalle sue policy RLS.
4. **Cross-istanza** — Poiché ogni istanza osserva ogni commit attraverso il flusso delle modifiche, il CDC funge anche *da* canale cross-istanza; la trasmissione legacy `rebase_entity_changes` per singola mutazione non viene utilizzata quando il CDC è attivo.
5. **Deduplicazione** — Una mutazione eseguita tramite l'API Rebase viene recapitata localmente nell'istante del commit e viene anche rimandata indietro come eco attraverso il flusso di modifiche. L'istanza di origine sopprime tale eco (un record a breve termine delle proprie emissioni), evitando che i sottoscrittori vedano una scrittura API due volte.

### Requisiti e note

- Il CDC richiede una stringa di connessione diretta (`DATABASE_DIRECT_URL` o la connessione primaria) per il client `LISTEN` — i pooler di connessioni in modalità transazione non supportano sessioni `LISTEN` persistenti.
- I trigger vengono installati solo sulle tabelle associate a una collection registrata. Le scritture su tabelle non mappate vengono ignorate.
- Una collection la cui tabella non è ancora stata migrata viene ignorata con un avviso, anziché bloccare il CDC per il resto.
- Lo streaming nativo della replica logica WAL (`wal2json`/`pgoutput`) è pianificato; attualmente `REALTIME_CDC=wal` degrada al percorso basato su trigger, che fornisce una copertura equivalente a livello di database.

## Timeout delle richieste in sospeso

Per evitare che le richieste del client rimangano bloccate indefinitamente, tutte le operazioni WebSocket in sospeso che prevedono una risposta dal server (come il recupero one-shot di collection `FETCH_COLLECTION`, il recupero di singole entità `FETCH_ONE`, creazione/aggiornamento `SAVE`, eliminazioni `DELETE`, conteggi `COUNT` e verifiche di unicità `CHECK_UNIQUE_FIELD`) hanno un timeout predefinito di 30 secondi.

Se il server non risponde entro questa finestra di 30 secondi, il client elimina automaticamente la richiesta in sospeso e rifiuta la promise con un `ApiError` con il messaggio `"Request timed out"`.

I messaggi unidirezionali che non attendono una risposta (come `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` e `presence_state`) si risolvono immediatamente al momento dell'invio e non attivano timeout.

### Quando un frame di canale viene rifiutato

Un frame di canale è di tipo fire-and-forget: `await channel.broadcast(...)` si risolve quando il frame viene scritto sul socket, **non** quando il server lo ha accettato. Ciò è intenzionale: un'applicazione collaborativa trasmette la posizione del cursore sessanta volte al secondo, e attendere una conferma per ciascuna trasformerebbe ogni invio in un round trip.

Pertanto, un rifiuto non può essere una promise rigettata. Viene recapitato tramite `onError`:

```typescript
const channel = client.realtime.channel("doc:42");

channel.onError((error) => {
    if (error.code === "CHANNEL_FORBIDDEN") showReadOnlyBanner();
    if (error.code === "RATE_LIMITED") throttleCursorUpdates();
});
```

| Codice | Significato |
|--------|-------------|
| `CHANNEL_FORBIDDEN` | Non sei un membro del canale — unisciti prima di trasmettere o leggerne la cronologia |
| `RATE_LIMITED` | Superato il budget di frame del canale indicato sopra |
| `CHANNEL_HISTORY_WRITE_FAILED` | Impossibile salvare un broadcast conservato, pertanto è stato scartato |
| `CHANNEL_HISTORY_READ_FAILED` | Impossibile soddisfare una richiesta di catch-up |
| `CHANNEL_BUS_PAYLOAD_TOO_LARGE` | Il broadcast ha raggiunto solo questa istanza — vedi [Il limite di 8 KB sul bus Postgres](#the-8-kb-limit-on-the-postgres-bus) |

Senza un gestore collegato, questi errori vengono registrati come warning nei log. In precedenza venivano scartati del tutto: non c'era alcuna promise da rigettare né alcun canale a cui recapitare l'errore, quindi un broadcast non autorizzato era indistinguibile da uno recapitato con successo.

## Prossimi passi

- [Client SDK](/docs/sdk) — Riferimento completo dell'SDK inclusi gli accessor tipizzati delle collection.
- [Autenticazione](/docs/backend/authentication) — Configura l'autenticazione JWT e le policy RLS.
- [Architettura Backend](/docs/backend) — Panoramica dell'architettura del server Rebase.

---
