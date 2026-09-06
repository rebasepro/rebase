---
sourceHash: 4f7a93fd3a8e67c8
title: Tempo reale e WebSocket
sidebar_label: Tempo reale
description: Sincronizzazione dei dati in tempo reale, canali di broadcast e tracciamento della presenza tramite WebSocket.
---

Rebase include un motore in tempo reale integrato che invia le modifiche ai dati ai client connessi tramite WebSocket.
Quando un record viene creato, aggiornato o eliminato, ogni sottoscrittore che osserva quella collezione o entità riceve l'aggiornamento istantaneamente — nessun polling richiesto.

## Come Funziona

La pipeline in tempo reale ha tre fasi:

1. **Trigger del database** — Una mutazione raggiunge il database PostgreSQL (tramite API REST, SDK o Studio).
2. **Fan-out del server** — Il server Rebase rileva la modifica e la distribuisce a ogni sottoscrizione WebSocket attiva che corrisponde alla collezione o entità interessata.
3. **Callback del client** — L'SDK client attiva il tuo callback `onUpdate` con i dati aggiornati.

```
┌──────────────┐      ┌────────────────────┐      ┌──────────────┐
│  PostgreSQL   │─────▶│  Rebase Server     │─────▶│  Client SDK  │
│  LISTEN/NOTIFY│      │  RealtimeService   │      │  WebSocket   │
└──────────────┘      └────────────────────┘      └──────────────┘
```

Per i deployment multi-istanza, Rebase usa `LISTEN/NOTIFY` di PostgreSQL per diffondere le modifiche tra le istanze del server. Questo viene gestito automaticamente — una connessione PostgreSQL dedicata ascolta sul canale `rebase_entity_changes` e ritrasmette gli aggiornamenti ai sottoscrittori locali.

### Zero Configurazione

Il tempo reale è abilitato di default. Non c'è alcun flag da attivare né servizio da avviare — se il tuo server Rebase è in esecuzione, l'endpoint WebSocket è disponibile.

> Per impostazione predefinita, Rebase emette eventi in tempo reale anche per le scritture effettuate **al di fuori** dell'API (tramite `psql`, un altro servizio o l'editor SQL di Studio) ogni volta che la connessione al database lo supporta — vedi [cattura delle modifiche a livello di database](#cattura-delle-modifiche-a-livello-di-database-cdc).

## Sottoscrizioni dell'SDK Client

L'SDK client di Rebase espone due metodi di sottoscrizione su ogni accessor di collezione:

- **`listen()`** — Sottoscrivere un'intera collezione (con filtri opzionali).
- **`listenById()`** — Sottoscrivere una singola entità tramite il suo ID.

Entrambi i metodi restituiscono una **funzione di annullamento della sottoscrizione** che chiami per smettere di ricevere aggiornamenti.

### Sottoscrivere una Collezione

Usa `listen()` per ricevere aggiornamenti ogni volta che i record di una collezione cambiano:

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

### Sottoscrivere una Collezione con Filtri

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

Il server rispetta questi filtri — solo i record corrispondenti vengono inclusi negli aggiornamenti.

### Sottoscrivere una Singola Entità

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

Il callback riceve `Entity<M> | undefined`. Un valore `undefined` significa che l'entità è stata eliminata.

### Annullare la Sottoscrizione

Sia `listen()` che `listenById()` restituiscono una funzione di annullamento. Chiamala per smettere di ricevere aggiornamenti e ripulire le risorse lato server:

```typescript
const unsubscribe = client.data.products.listen(undefined, (response) => {
  // handle updates
});

// Later, when you no longer need updates:
unsubscribe();
```

:::tip
Chiama sempre la funzione di annullamento quando un componente viene smontato o quando si abbandona una pagina. Questo previene perdite di memoria e lavoro non necessario lato server.
:::

## `.listen()` del Query Builder

Il query builder fluido supporta anche le sottoscrizioni in tempo reale. Concatena i tuoi filtri, poi chiama `.listen()` invece di `.find()`:

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
Il metodo `.listen()` del query builder è disponibile solo quando il `RebaseClient` è configurato con una `websocketUrl`. Se la connessione WebSocket non è configurata, chiamare `.listen()` genererà un errore.
:::

## Consegna degli Aggiornamenti: Patch Istantanea + Refetch di Correttezza

Rebase usa una strategia di aggiornamento in due fasi per le sottoscrizioni di collezione, per combinare velocità estrema e correttezza assoluta:

1. **Fase 1 — Patch dell'entità istantanea:** Quando una singola entità cambia (creata, aggiornata, eliminata), il server invia immediatamente un messaggio leggero `collection_patch` contenente i valori modificati dell'entità direttamente ai sottoscrittori. Il client lo unisce ai suoi dati di collezione in cache per un feedback tra schede quasi istantaneo — bypassando completamente il database per aggiornamenti percepiti in meno di un millisecondo.

2. **Fase 2 — Refetch RLS con debounce:** Dopo un breve ritardo di **300 ms** (`REFETCH_DEBOUNCE_MS`), il server esegue un refetch autorevole dal database della collezione corrispondente ai tuoi filtri e all'ordinamento originali. Questo è fondamentale perché le mutazioni dei campi potrebbero alterare la visibilità dell'entità (ad es. se il suo stato è cambiato e non corrisponde più a un filtro `where`).

   Per mantenere confini di sicurezza rigorosi, questa query di refetch viene eseguita all'interno di una transazione che imposta le variabili locali alla transazione `app.userId` e `app.user_roles` derivate dal `SubscriptionAuthContext` del sottoscrittore. Questo garantisce che i vincoli di sicurezza a livello di riga (RLS) di PostgreSQL vengano valutati correttamente sotto la sessione di autenticazione del client, e solo i record che l'utente è autorizzato a vedere vengono inviati nel `collection_update` finale.

Questo approccio garantisce che i filtri di elenco e le politiche di accesso rimangano perfettamente coerenti mantenendo al contempo un'elevata reattività dell'interfaccia.

## Canali di Broadcast

I canali di broadcast permettono ai client di inviarsi a vicenda messaggi arbitrari in tempo reale — utile per funzionalità come indicatori di digitazione, posizioni del cursore o notifiche personalizzate.

Il broadcast è gestito a livello del protocollo WebSocket. Il server supporta questi tipi di messaggi:

| Tipo di Messaggio | Direzione        | Descrizione                              |
|-----------------|-----------------|------------------------------------------|
| `join_channel`  | Client → Server | Unirsi a un canale con nome              |
| `leave_channel` | Client → Server | Lasciare un canale                       |
| `broadcast`     | Client → Server | Inviare un messaggio a tutti i membri del canale |
| `broadcast`     | Server → Client | Ricevere un messaggio da un altro membro |
| `channel_history` | Client → Server | Richiedere i messaggi conservati dopo una sequenza |
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

## Conservazione dei Canali

Per impostazione predefinita un broadcast raggiunge i membri connessi in quel momento e poi sparisce. È il compromesso giusto per notifiche e cursori, e non costa nulla.

Per un flusso di operazioni — editing collaborativo, qualsiasi cosa in cui un vuoto silenzioso causi divergenza — un canale può essere configurato per **conservare** i suoi messaggi. I broadcast conservati ricevono un numero di sequenza per canale e vengono memorizzati, così un client che si riconnette può chiedere tutto ciò che segue l'ultimo che ha visto.

La conservazione è opzionale e si configura qui, sul server:

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
|-------|-------------|
| `match` | Nome esatto del canale (`"doc:42"`) o un prefisso con `*` finale (`"doc:*"`) |
| `limit` | Conservare al massimo questo numero di messaggi più recenti per canale |
| `ttl` | Conservare i messaggi al massimo per questo tempo — `"30s"`, `"15m"`, `"24h"`, `"7d"`, o millisecondi |

Una regola richiede almeno `limit` o `ttl`. Una che non abbia nessuno dei due viene ignorata e registrata, perché la conservazione illimitata non è quasi mai intenzionale e non si può tornare indietro una volta che la tabella è cresciuta.

:::note[Perché non lasciare che siano i client a chiedere la cronologia?]
Un canale è creato da chi lo nomina. Se un client potesse scegliere la propria profondità di cronologia, qualsiasi visitatore potrebbe impegnare il tuo backend in uno storage illimitato. Configurarlo qui significa anche che i canali di presenza e notifica — la stragrande maggioranza — non pagano nulla: senza regole configurate non viene creata alcuna tabella e il broadcast segue lo stesso percorso sincrono di sempre.
:::

### Archiviazione

I canali con conservazione usano due tabelle nello schema `rebase`, create automaticamente all'avvio quando è configurata almeno una regola:

| Tabella | Contenuto |
|-------|-----------|
| `rebase.channel_messages` | I messaggi conservati, indicizzati per `(channel, seq)` |
| `rebase.channel_cursors` | La sequenza più alta emessa per canale |

La potatura avviene man mano che arrivano i messaggi, limitata per canale così che il costo dipenda dal tempo trascorso e non dal volume di scrittura. Rimuove righe solo da `channel_messages` — i cursori sono mantenuti a tempo indeterminato (una piccola riga per canale), perché riavviare la sequenza di un canale cambierebbe il significato del punto di ripresa salvato da un client.

### Garanzie di consegna

- **Ordinato.** I numeri di sequenza sono assegnati per canale, e l'ordine di consegna coincide con l'ordine di sequenza.
- **Durevole prima che consegnato.** Un messaggio che non può essere memorizzato non viene consegnato a nessuno, e il mittente viene avvisato. Consegnarlo lo metterebbe davanti ai sottoscrittori dal vivo lasciandolo fuori da ogni ritrasmissione futura, e nessun messaggio successivo potrebbe riparare quel vuoto.
- **Almeno una volta in recupero.** Un intervallo di ritrasmissione può sovrapporsi a messaggi già ricevuti dal client; il SDK scarta quelli già consegnati.

:::caution[La cronologia ha lo stesso modello di accesso del canale]
Chiunque possa unirsi a un canale può ritrasmettere i suoi messaggi conservati, compresi quelli diffusi prima del suo arrivo. La conservazione è opzionale per pattern di canale, quindi considera che abilitarla su un canale ad accesso pubblico rende leggibile il passato di quel canale a qualsiasi visitatore.
:::
## Tracciamento della Presenza

La presenza traccia quali utenti sono attualmente online in un canale e permette a ciascun utente di condividere uno stato personalizzato (ad es. posizione del cursore, stato).

| Tipo di Messaggio  | Direzione        | Descrizione                                          |
|-------------------|-----------------|------------------------------------------------------|
| `presence_track`  | Client → Server | Iniziare a tracciare la presenza con stato personalizzato |
| `presence_untrack`| Client → Server | Smettere di tracciare la presenza                    |
| `presence_state`  | Client → Server | Richiedere lo stato di presenza completo di un canale |
| `presence_state`  | Server → Client | Stato completo di tutte le presenze in un canale     |
| `presence_diff`   | Server → Client | Aggiornamento incrementale (ingressi e uscite)       |

Quando un client invia `presence_track`, il server lo unisce automaticamente al canale (nessun `join_channel` separato necessario) e diffonde un `presence_diff` a tutti i membri del canale.

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

Le presenze obsolete vengono ripulite automaticamente dopo 30 secondi di inattività.

## Riconnessione Automatica

L'SDK client si riconnette automaticamente quando la connessione WebSocket cade:

- **Backoff esponenziale** — I ritardi di riconnessione iniziano da 1 secondo e raddoppiano a ogni tentativo, con un limite massimo di 30 secondi.
- **Massimo 5 tentativi** — Dopo 5 tentativi di riconnessione falliti, il client smette di provare.
- **Ri-sottoscrizione automatica** — Alla riconnessione riuscita, tutte le sottoscrizioni attive vengono nuovamente registrate presso il server. Nessun intervento manuale necessario.
- **Accodamento dei messaggi** — I messaggi inviati mentre si è disconnessi vengono accodati e consegnati dopo la riconnessione.

Puoi ascoltare gli eventi del ciclo di vita della connessione:

```typescript
const ws = client.ws; // Access the WebSocket client

ws.on("connect", () => console.log("Connected"));
ws.on("disconnect", () => console.log("Disconnected"));
ws.on("reconnect", () => console.log("Reconnected"));
ws.on("error", (error) => console.error("Error:", error));
```

## Autenticazione & RLS

Le sottoscrizioni WebSocket rispettano automaticamente le politiche di sicurezza a livello di riga (RLS). Quando il client è autenticato:

1. La connessione WebSocket si autentica usando lo stesso token JWT dell'API REST.
2. Ogni refetch di sottoscrizione viene eseguito all'interno di una transazione PostgreSQL con `set_config('app.userId', ...)` e `set_config('app.user_roles', ...)` — garantendo l'applicazione delle politiche RLS.
3. Se un token scade durante una sessione attiva, il client si riautentica e si risottoscrive automaticamente.

Ciò significa che ogni utente riceve aggiornamenti solo per i record che ha il permesso di vedere.

## Broadcasting Tra Istanze & Architettura LISTEN/NOTIFY

Per ambienti cluster multi-istanza (ad es. in esecuzione all'interno di container Kubernetes o Docker dietro un bilanciatore di carico), Rebase si affida a `LISTEN/NOTIFY` di PostgreSQL per sincronizzare le operazioni di mutazione e lo stato in tempo reale tra le istanze.

### Aggirare i Pool di pgBouncer

Poiché i pooler di connessioni come **pgBouncer** non supportano il modello di connessione persistente richiesto per le sessioni SQL `LISTEN` di lunga durata, il supervisore in tempo reale apre un client Postgres dedicato e non poolato (`PgClient`) direttamente al database. Questa connessione diretta utilizza la variabile d'ambiente `DATABASE_DIRECT_URL` se configurata, garantendo stabilità e prevenendo l'esaurimento del pool o interruzioni improvvise.

### Meccanica delle Notifiche & Layout del Payload

Quando un'entità viene modificata sull'Istanza A, questa diffonde una notifica sul canale `rebase_entity_changes`. Per ridurre al minimo il sovraccarico del database e la larghezza di banda di rete, il payload della notifica viene mantenuto estremamente compatto:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Nota: `sid` rappresenta l'ID istanza casuale e univoco del server generato all'avvio, `p` è lo slug (percorso) della collezione e `eid` è l'ID dell'entità target.*

- **Auto-filtraggio**: Alla ricezione di un messaggio, ogni istanza legge il `sid`. Se corrisponde al proprio ID istanza, il server scarta la notifica per prevenire loop di routing infiniti.
- **Relay e fan-out**: Se la notifica proviene da un'altra istanza, il server pianifica un refetch con debounce e ritrasmette l'aggiornamento ai suoi sottoscrittori WebSocket connessi localmente.
- **Loop di riconnessione del supervisore**: Se la connessione al database cade, un supervisore di connessione in background monitora lo stato e attiva una sequenza di riconnessione automatica dopo un ritardo fisso di **3 secondi**, ripristinando il loop `LISTEN` senza influenzare il ciclo di vita principale dell'applicazione Hono.

## Cattura delle Modifiche a Livello di Database (CDC)

**La Change Data Capture è attiva per impostazione predefinita.** Rebase cattura le modifiche a livello di database ed emette eventi in tempo reale per **ogni scrittura confermata, indipendentemente da come è stata effettuata** — REST, SDK, Studio, `psql`, un cron job in un altro servizio, Drizzle/SQL grezzo o l'**editor SQL** di Studio. Questo è lo stesso modello di Supabase Realtime che segue il write-ahead log (WAL).

Non è richiesta alcuna configurazione. Su una connessione al database che lo supporta, CDC si auto-provisiona all'avvio; su una che non lo supporta (ad es. un ruolo con restrizioni che non può creare trigger), Rebase usa silenziosamente il tempo reale a livello di applicazione — niente da attivare, niente che si rompa.

### Configurazione

CDC è controllato dalla variabile d'ambiente `REALTIME_CDC`:

| Valore | Comportamento |
| --- | --- |
| `auto` *(predefinito)* | Abilita la cattura a livello di database dove la connessione lo supporta; **ricade silenziosamente** sul tempo reale a livello di applicazione altrimenti. Zero configurazione. |
| `trigger` | Forza la cattura basata su trigger. Funziona su qualsiasi PostgreSQL, incluse le istanze gestite senza replica logica. Avvisa (invece di ricadere silenziosamente) se non può effettuare il provisioning. |
| `wal` | Preferisce la replica logica WAL. Non ancora inclusa — degrada a `trigger` e registra la modalità attiva. |
| `off` | Solo tempo reale a livello di applicazione. Usalo per evitare il sovraccarico del trigger per scrittura su carichi di lavoro con molte scritture. |

All'avvio vedrai una riga di log che indica la modalità attiva, ad es.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Se la connessione non può supportarlo, `auto` registra invece una riga informativa e continua con il tempo reale a livello di applicazione:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

### Come Funziona

1. **Auto-provisioning** — All'avvio (contesto server/proprietario), Rebase installa un trigger idempotente `AFTER INSERT/UPDATE/DELETE` su ogni tabella gestita. Il trigger emette una notifica di modifica compatta sul canale `rebase_cdc`. Un payload che supererebbe il limite di 8&nbsp;KB di `NOTIFY` di PostgreSQL ricade su un messaggio di sola identità, così CDC non può mai interrompere la scrittura che lo ha attivato.
2. **Cattura** — Un client `LISTEN` dedicato e non poolato per istanza consuma `rebase_cdc`, rimappa la tabella modificata alla sua collezione e alimenta la modifica nella stessa pipeline `RealtimeService` usata dalle mutazioni dell'API. Come il listener tra istanze, preferisce `DATABASE_DIRECT_URL` e si riconnette automaticamente.
3. **Consegna sicura per RLS** — La riga grezza dal flusso di modifiche non viene **mai** inoltrata ai sottoscrittori. La modifica viene contrassegnata come invalidata, e ogni sottoscrizione rilegge la riga sotto il **proprio** contesto di autenticazione. Il filtraggio è quindi per sottoscrittore, mai per publisher: un client riceve solo le righe consentite dalle sue politiche RLS.
4. **Tra istanze** — Poiché ogni istanza osserva ogni commit attraverso il flusso di modifiche, CDC *è* anche il canale tra istanze; il broadcast legacy `rebase_entity_changes` per mutazione non viene usato mentre CDC è attivo.
5. **De-duplicazione** — Una mutazione effettuata tramite l'API di Rebase viene consegnata localmente nell'istante in cui viene confermata ed è anche riflessa attraverso il flusso di modifiche. L'istanza di origine sopprime tale eco (un record effimero delle proprie emissioni), così i sottoscrittori non vedono mai una scrittura dell'API due volte.

### Requisiti & Note

- CDC richiede una stringa di connessione diretta (`DATABASE_DIRECT_URL` o la connessione primaria) per il client `LISTEN` — i pooler di connessioni in modalità transazione non supportano sessioni `LISTEN` di lunga durata.
- I trigger vengono installati solo sulle tabelle supportate da una collezione registrata. Le scritture su tabelle non mappate vengono ignorate.
- Una collezione la cui tabella non è stata ancora migrata viene saltata con un avviso invece di bloccare CDC per le altre.
- Lo streaming nativo della replica logica WAL (`wal2json`/`pgoutput`) è pianificato; oggi `REALTIME_CDC=wal` degrada al percorso basato su trigger, che fornisce una copertura equivalente a livello di database.

## Timeout delle Richieste in Sospeso

Per evitare che le richieste del client rimangano bloccate indefinitamente, tutte le operazioni WebSocket in sospeso che si aspettano una risposta dal server (come i recuperi una tantum di collezione `FETCH_COLLECTION`, i recuperi di singola entità `FETCH_ONE`, la creazione/aggiornamento `SAVE`, le eliminazioni `DELETE`, i conteggi `COUNT` e i controlli di unicità `CHECK_UNIQUE_FIELD`) hanno un timeout predefinito di 30 secondi.

Se il server non risponde entro questa finestra di 30 secondi, il client elimina automaticamente la richiesta in sospeso e rifiuta la promise con un `ApiError` con il messaggio `"Request timed out"`.

I messaggi unidirezionali che non si aspettano una risposta (come `subscribe_collection`, `subscribe_one`, `unsubscribe`, `join_channel`, `leave_channel`, `broadcast`, `presence_track`, `presence_untrack` e `presence_state`) si risolvono immediatamente alla trasmissione e non attivano timeout.

## Prossimi Passi

- [SDK Client](/docs/sdk) — Riferimento completo dell'SDK inclusi gli accessor di collezione tipizzati.
- [Autenticazione](/docs/backend/authentication) — Configurare l'autenticazione JWT e le politiche RLS.
- [Architettura del Backend](/docs/backend) — Panoramica dell'architettura del server Rebase.
