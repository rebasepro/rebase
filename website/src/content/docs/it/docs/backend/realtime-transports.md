---
sourceHash: 1b7c64b3c001f57d
title: Realtime su più istanze
sidebar_label: Realtime su più istanze
description: "Come i canali broadcast e la presence sopravvivono a più di un processo server: il bus LISTEN/NOTIFY, cosa appartiene a ciascuna istanza e come scrivere il proprio transport."
---

## Broadcasting tra istanze e architettura LISTEN/NOTIFY

Per gli ambienti cluster multi-istanza (ad es. in esecuzione all'interno di container Kubernetes o Docker dietro un load balancer), Rebase si affida a PostgreSQL `LISTEN/NOTIFY` per sincronizzare le **modifiche alle righe** tra le istanze. Le sottoscrizioni a tabelle ed entità si estendono quindi su più istanze senza alcuna configurazione — questo è ciò che descrive questa sezione.

**I canali broadcast e la presence sono separati** e sono specifici per istanza finché non si attiva un channel bus. Consulta [Canali e presence su più istanze](#canali-e-presence-su-più-istanze) di seguito.

### Bypassare i pool di pgBouncer

Poiché i connection pooler come **pgBouncer** non supportano il modello di connessione persistente richiesto per sessioni SQL `LISTEN` di lunga durata, il supervisore real-time apre un client Postgres dedicato e senza pooling (`PgClient`) direttamente verso il database. Questa connessione diretta utilizza la variabile d'ambiente `DATABASE_DIRECT_URL` se configurata, garantendo stabilità e prevenendo l'esaurimento del pool o interruzioni improvvise.

### Meccaniche di notifica e struttura del payload

Con il [database change capture](/docs/backend/realtime-cdc/) attivo — l'impostazione predefinita ovunque il ruolo del database possa creare trigger — ogni istanza riceve ogni commit sul canale `rebase_cdc` e nulla di quanto segue viene inviato. Senza di esso, quando un record viene modificato sull'Istanza A, trasmette una notifica sul canale `rebase_entity_changes`. Per ridurre al minimo l'overhead del database e la larghezza di banda di rete, il payload della notifica viene mantenuto estremamente compatto:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Nota: `sid` rappresenta l'ID istanza univoco e casuale del server generato all'avvio, `p` è lo slug (percorso) della tabella ed `eid` è l'ID dell'entità di destinazione.*

Le modifiche effettuate nello stesso momento — un salvataggio massivo (bulk save) annuncia ogni riga scritta — vengono inviate insieme, nel minor numero possibile di notifiche che rientrano nel limite NOTIFY di 8000 byte di Postgres, ciascuna elencando le proprie modifiche come terne `[p, eid, db]`:

```json
{
  "sid": "inst_7a9c1b",
  "c": [["posts", "45", null], ["posts", "46", null]]
}
```

Una singola modifica mantiene la struttura sopra indicata, in modo che un'istanza più vecchia possa comunque leggerla durante un rolling deploy.

- **Self-filtering**: Alla ricezione di un messaggio, ciascuna istanza legge il `sid`. Se corrisponde al proprio ID istanza, il server scarta la notifica per evitare loop infiniti di routing.
- **Relay e Fan-out**: Se la notifica proviene da un'altra istanza, il server pianifica un refetch con debounce per i suoi sottoscrittori connessi localmente per ciascuna modifica. Non legge nulla alla ricezione: ogni frame è un refetch nell'ambito (scope) specifico del proprio sottoscrittore.
- **Loop di riconnessione del supervisore**: Se la connessione al database cade, un supervisore della connessione in background monitora lo stato e attiva una sequenza di riconnessione automatica dopo un ritardo fisso di **3 secondi**, ripristinando il loop `LISTEN` senza influire sul ciclo di vita dell'applicazione Hono principale. Viene quindi eseguito nuovamente il refetch di ogni sottoscrizione attiva sull'istanza, poiché qualsiasi cosa pubblicata mentre la connessione era inattiva non ha raggiunto nessuno. Se il database non è raggiungibile all'avvio, la connessione viene ritentata nello stesso modo.
- **Heartbeat**: Una connessione `LISTEN` è inattiva per natura e un timeout di inattività su un load balancer o un NAT può interromperla senza alcun errore da entrambe le parti (una connessione half-open). Per questo motivo viene eseguita con TCP keepalive e deve rispondere a un `SELECT 1` ogni 30 secondi entro 10 secondi. Una connessione che lo manca viene sostituita come descritto sopra. Mentre la connessione è inattiva, `/health` la elenca come `cross-instance` e, una volta rimasta inattiva per 60 secondi, il controllo fallisce.

## Canali e presence su più istanze

Le modifiche alle righe si propagano autonomamente tra le istanze (sopra). I canali broadcast e la presence **no**: per impostazione predefinita eseguono il fan-out solo verso i client connessi all'istanza che li ha ricevuti.

Su una singola istanza questo comportamento è perfetto e non comporta costi. Dietro un load balancer si tratta di un bug che non vedrai durante lo sviluppo: due collaboratori finiscono su repliche diverse, entrano nello stesso canale e vedono una stanza vuota pur trasmettendo tra loro senza problemi. Non si verifica alcun errore.

La soluzione è un **channel bus** — un transport opzionale che trasferisce i frame di canale e la presence tra le istanze:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres" }
    }
})
```

| Bus          | Quando usarlo                                                                                          |
|--------------|--------------------------------------------------------------------------------------------------------|
| `memory`     | **Predefinito.** Singola istanza. Nessuna consegna tra istanze, nessun overhead.                       |
| `postgres`   | Due o più istanze. Utilizza `LISTEN/NOTIFY` sul database già esistente — nessun nuovo servizio da distribuire. |

Il transport può anche essere impostato per deployment con
`REALTIME_CHANNEL_BUS=memory|postgres`, in modo da poter essere modificato senza ricompilare.
Esegue l'override di un transport integrato **nominato** (`bus: { type: "memory" }`), ed è
deliberatamente **ignorato** quando a `realtime.bus` è stata passata un'*istanza*
`ChannelBus` costruita — la variabile può solo nominare i transport che questo pacchetto
sa come creare, quindi rispettarla in questo caso significherebbe scartare silenziosamente
l'oggetto fornito dall'applicazione. In tale situazione viene registrato un warning che indica entrambi,
e un valore non riconosciuto torna a ciò che era stato configurato anziché a memory.

### Perché non c'è un'opzione Redis inclusa

Rebase viene distribuito come Postgres + backend + frontend. Un bus che richiedesse un message broker inserirebbe un secondo servizio stateful in ogni `docker-compose.yml` generato dalla CLI, per una funzionalità che la maggior parte delle applicazioni non usa mai — quindi il criterio per aggiungerne uno è che il database non sia realmente in grado di sostenere il carico.

E invece può. Misurato su due istanze di backend collegate a un singolo container Postgres, il bus Postgres ha distribuito **~10.000 messaggi al secondo tra le istanze senza perdite**, ed è rimasto costante fino a **otto istanze** (14.000 consegne, nessuna perdita). Venti persone che muovono cursori a 60 fps generano circa 1.200 messaggi al secondo — circa un ottavo di quel valore.

Il limite da monitorare non è la capacità, bensì il fatto che ogni notifica è una query sul database primario, in competizione con le query reali dell'applicazione. Il bus Postgres esegue quindi il **coalescing** dei frame in uscita (vedere sotto), ed è questo che mantiene tale costo proporzionale al tempo trascorso anziché al conteggio dei messaggi.

Per ogni client, il socket accetta fino a **7.200 frame di canale al minuto** (120/s — 60 fps di broadcast dei cursori più l'aggiornamento della presence trasportato da ciascuno), conteggiati separatamente dal budget condiviso da query e sottoscrizioni. I frame che superano questo limite vengono rifiutati con un errore `RATE_LIMITED` invece di essere messi in coda.

Il rifiuto arriva su `channel.onError()`, non come un `broadcast()` respinto — vedi [Quando un frame di canale viene rifiutato](/docs/backend/realtime#when-a-channel-frame-is-refused).

Se le richieste continuano a essere elevate, applica un throttle agli eventi dei cursori sul client (lo stato last-write-wins non necessita di 60 aggiornamenti al secondo) e valuta di instradare i collaboratori di un documento verso la stessa istanza tramite [`affinity`](/docs/sdk/realtime#keeping-a-group-on-one-instance) — lo sticky routing riduce il traffico tra istanze quasi a zero indipendentemente dal numero di utenti. Solo oltre questo punto conviene adottare un altro transport, e in tal caso la soluzione è un pacchetto transport, non un fork. Consulta [Scrivere il proprio transport](#scrivere-il-proprio-transport).

### Monitorare l'attività del bus

Con `REBASE_METRICS=true`, ciascuna istanza riporta ciò che sta gestendo su `/metrics`:

| Metrica | Tipo | Significato |
|---------|------|-------------|
| `rebase_realtime_sockets` | gauge | Socket aperti su questa istanza |
| `rebase_realtime_channels` | gauge | Canali con un membro su questa istanza |
| `rebase_realtime_bus_frames_published_total` | counter | Frame inviati da questa istanza al bus, per `kind`: `broadcast`, `broadcast_ref`, `presence_diff` e `channels` (le istanze che si comunicano ciò che gestiscono) |
| `rebase_realtime_bus_frames_skipped_total` | counter | Broadcast e modifiche di presence non inviati perché nessun'altra istanza aveva membri nel canale |

I contatori partono da zero all'avvio dell'istanza e conteggiano i frame, dei quali il bus può raggrupparne diversi in una singola notifica. I messaggi conservati (retained) viaggiano sempre, quindi non vengono mai ignorati. Sul bus `memory` predefinito entrambi rimangono a zero.

Esegui lo scraping di ogni istanza anziché di un load balancer posto davanti a esse: i numeri sono per processo. Un gruppo che rimane su una sola istanza si traduce in una crescita di `skipped` mentre `broadcast` e `presence_diff` rimangono invariati, con i socket distribuiti tra le istanze. I broadcast che aumentano su ogni istanza indicano che i canali le attraversano entrambe o tutte. Su Rebase Cloud, `rebase cloud metrics` mostra gli stessi conteggi per istanza.

### Coalescing

I frame pubblicati mentre una breve finestra temporale è aperta partono insieme in un'unica notifica. La finestra è a **fronte iniziale (leading-edge)**: un frame che arriva quando nessuna finestra è aperta viene inviato immediatamente, così un canale inattivo non subisce alcuna latenza aggiuntiva e solo un flusso continuo viene raggruppato in batch.

Misurato su due istanze, 3.000 broadcast, tutti consegnati in ogni caso:

| Profilo di traffico | Coalescing disattivato | Coalescing attivato | Riduzione |
|---|---|---|---|
| Burst (il più veloce possibile) | 3.000 query | 68 query | **44×** |
| Cadenzato (~500 msg/s, distribuito) | 3.000 query | 240 query | **12,5×** |

Il caso a raffica (burst) è terminato anche ~11 volte più velocemente in termini di tempo reale (wall-clock), poiché i round-trip del database rappresentavano il collo di bottiglia anziché l'elaborazione effettiva.

La finestra è impostata in modo predefinito su 10 ms e non è un'impostazione critica — 5 ms, 10 ms e 20 ms hanno prodotto conteggi di query identici in entrambi i profili, poiché un batch è limitato dal tetto del payload di 8 KB o dalla conformazione naturale del traffico ben prima che il timer diventi rilevante. Modificalo solo se hai un motivo valido:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 disables coalescing
}
```

Una nota sul deployment: un batch viaggia con una struttura di rete (wire shape) diversa rispetto a un singolo frame, e un'istanza che esegue una build precedente non è in grado di comprenderla. I frame singoli vengono sempre inviati senza incapsulamento (unwrapped), quindi un rolling deploy rischia la perdita di frame solo se il cluster è sotto carico prolungato *durante* il riavvio — e i canali con retention si riparano comunque da soli tramite il replay della cronologia.

## Scrivere il proprio transport

`realtime.bus` accetta qualsiasi oggetto che implementi l'interfaccia `ChannelBus`, consentendo a un transport di essere distribuito come pacchetto a sé stante — `@rebasepro/types` dichiara il contratto e non è richiesto nient'altro per implementarlo:

```typescript
import type { ChannelBus, ChannelBusFrame, ChannelBusHandler } from "@rebasepro/types";

export class MyChannelBus implements ChannelBus {
    readonly kind = "my-transport";
    readonly maxFrameBytes = Infinity;

    async start(handler: ChannelBusHandler): Promise<void> {
        // Connect. Reject if you cannot — the caller falls back to in-process
        // delivery, which is far better than a cluster that believes it is
        // connected and silently is not.
    }

    async publish(frame: ChannelBusFrame): Promise<void> {
        // Reach every other instance, or reject.
    }

    async stop(): Promise<void> {
        // Idempotent; release anything holding the event loop open.
    }
}
```

Passa l'istanza dove andrebbe il nome integrato:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**Cosa deve garantire la tua implementazione:** `start()` va in reject quando il transport è inutilizzabile; `publish()` raggiunge ogni altra istanza o va in reject; `stop()` è idempotente; un messaggio non valido viene scartato e registrato nei log anziché lanciare un'eccezione, evitando che un singolo frame difettoso interrompa il listener.

**Cosa non deve garantire:** ordinamento (i canali retained includono `seq` e l'SDK ordina in base a esso), durabilità (un frame perso è un aggiornamento live mancato, riparato dal replay della cronologia del client) o consegna exactly-once (i frame con retention vengono deduplicati tramite `seq`; i diff di presence sono idempotenti).

`maxFrameBytes` è il parametro con cui il framework stabilisce se inviare un messaggio retained di grandi dimensioni inline o come puntatore. Restituisci `Infinity` quando il tuo transport non ha un limite significativo, in modo che il percorso basato su puntatore non venga mai intrapreso inutilmente.

La consegna ai client locali non è di tua competenza — il servizio realtime gestisce quali sottoscrittori ricevono un frame. Un transport si occupa unicamente di spostare i frame tra le istanze.

### Il limite di 8 KB sul bus Postgres

`pg_notify` rifiuta un payload pari o superiore a 8000 byte. Cursori e presence rientrano ampiamente nei limiti; un'istantanea (snapshot) di un documento no. Rebase gestisce questa situazione nello stesso modo in cui gestisce le modifiche a entità di grandi dimensioni — inviando un indirizzo anziché un corpo:

- **Su un canale con retention** (vedi [Channel Retention](/docs/backend/realtime#channel-retention)) il messaggio è già memorizzato con un numero di sequenza, quindi la notifica contiene solo `(channel, seq)` e ogni istanza ricevente rilegge il corpo. Non vi è alcun limite di dimensione. Questo vale per ogni messaggio con retention, piccolo o grande: qualsiasi login al database può eseguire `LISTEN`, quindi il corpo non viaggia mai nella notifica. Ciò costa una lettura per chiave primaria per messaggio su ciascuna istanza con un membro nel canale.
- **I broadcast temporanei (ephemeral) e la presence** viaggiano ancora all'interno della notifica stessa, quindi qualsiasi account connesso al database può leggerli. Inserisci qualsiasi dato che non debba essere leggibile in questo modo su un canale con retention.
- **Su un canale temporaneo (ephemeral)** non c'è nulla a cui puntare. Il broadcast viene recapitato localmente, il mittente riceve un errore `CHANNEL_BUS_PAYLOAD_TOO_LARGE` su `channel.onError()` e un warning indica il canale — evitando che il messaggio raggiunga silenziosamente solo metà del cluster.

Se trasmetti messaggi di grandi dimensioni, definisci una regola di retention per quel canale. Questa è l'intera soluzione.

### La presence è uno stato condiviso, non solo fan-out

`presence_state` deve rispondere alla domanda "chi è presente in questo canale?" per l'intero cluster, cosa che la memoria per singola istanza non può fare. Quando un bus è attivo, Rebase mantiene l'elenco (roster) in `rebase.channel_presence` (creato automaticamente) e risponde alle richieste del roster attingendo da lì.

| Colonna       | Contenuto                                      |
|---------------|------------------------------------------------|
| `channel`     | Nome del canale                                |
| `client_id`   | Il client tracciato                            |
| `instance_id` | L'istanza di backend a cui è connesso          |
| `state`       | Lo stato di presence del client                |
| `last_seen`   | Aggiornato dall'heartbeat di presence dell'SDK |

L'SDK invia un heartbeat di presence ogni ~20 secondi rispetto a un timeout di 30 secondi. Le righe che non vengono più aggiornate vengono eliminate (reaped) e le disconnessioni vengono annunciate a ogni istanza — fungendo al contempo da ripristino in caso di crash: un pod che si interrompe lascia righe che, dopo una finestra di timeout, appaiono esattamente come qualsiasi altro client diventato inattivo. Uno spegnimento controllato (graceful shutdown) cancella immediatamente le proprie righe, evitando che durante un rolling deploy compaia una finestra di "fantasmi".

:::caution[La connessione LISTEN deve bypassare il pooler]
`LISTEN` è uno stato di sessione, quindi il bus Postgres necessita di una connessione diretta — non di pgBouncer o di qualsiasi pooler in modalità transazione. Rebase utilizza `DATABASE_DIRECT_URL` quando impostato; dietro a un pooler, puntalo direttamente al servizio database stesso. Senza un URL diretto utilizzabile, il bus registra un warning e rimane in modalità memory.
:::

## Prossimi passi

- [Realtime & WebSocket](/docs/backend/realtime/) — sottoscrizioni, canali e presence su una singola istanza
- [Processi separati (Split Processes)](/docs/deployment/split-processes/) — la tipologia di deployment a cui si applica
- [Self-hosting](/docs/deployment/self-hosting/) — eseguire il runtime in autonomia
