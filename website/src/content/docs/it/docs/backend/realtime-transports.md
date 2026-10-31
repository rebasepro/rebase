---
sourceHash: 18c4ff1205a910b2
title: Realtime tra istanze
sidebar_label: Realtime tra istanze
description:"\"Come i canali di broadcast e la presence sopravvivono a più di un processo server: il bus LISTEN/NOTIFY, la gestione delle istanze e come scrivere un transport personalizzato.\""
---

## Broadcasting cross-istanza e architettura LISTEN/NOTIFY

Per gli ambienti cluster multi-istanza (ad es. in esecuzione all'interno di container Kubernetes o Docker dietro un load balancer), Rebase si affida a PostgreSQL `LISTEN/NOTIFY` per sincronizzare le **modifiche alle righe** tra le istanze. Le sottoscrizioni a collection ed entità si estendono quindi su più istanze senza alcuna configurazione — questo è ciò che descrive questa sezione.

**I canali di broadcast e la presence sono separati**, e rimangono limitati alla singola istanza finché non si attiva un bus di canale. Consulta [Canali e presence tra istanze](#canali-e-presence-tra-istanze) di seguito.

### Bypass dei pool di pgBouncer

Poiché i connection pooler come **pgBouncer** non supportano il modello di connessione persistente richiesto per le sessioni SQL `LISTEN` a lunga durata, il supervisore real-time apre un client Postgres dedicato e non inserito nel pool (`PgClient`) direttamente verso il database. Questa connessione diretta utilizza la variabile d'ambiente `DATABASE_DIRECT_URL` se configurata, garantendo stabilità e prevenendo l'esaurimento del pool o interruzioni improvvise.

### Meccanica delle notifiche e layout del payload

Con il [database change capture](/docs/backend/realtime-cdc/) attivo — il comportamento predefinito ovunque il ruolo del database possa creare trigger — ogni istanza riceve ogni commit sul canale `rebase_cdc`, e nulla di quanto segue viene inviato. Senza di esso, quando un record viene modificato sull'Istanza A, trasmette una notifica sul canale `rebase_entity_changes`. Per ridurre al minimo l'overhead del database e la larghezza di banda di rete, il payload di notifica è mantenuto estremamente compatto:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Nota: `sid` rappresenta l'ID univoco casuale dell'istanza del server generato all'avvio, `p` è lo slug (percorso) della collection ed `eid` è l'ID dell'entità di destinazione.*

Le modifiche apportate nello stesso istante — un salvataggio in blocco (bulk save) annuncia ogni riga scritta — vengono inviate insieme, nel minor numero di notifiche possibile entro il limite NOTIFY di 8000 byte di Postgres, ciascuna elencando le proprie modifiche come triple `[p, eid, db]`:

```json
{
  "sid": "inst_7a9c1b",
  "c": [["posts", "45", null], ["posts", "46", null]]
}
```

Una singola modifica mantiene la struttura sopra descritta, così un'istanza precedente può comunque leggerla durante un rolling deploy.

- **Autofiltraggio**: Alla ricezione di un messaggio, ogni istanza legge il `sid`. Se corrisponde al proprio ID istanza, il server scarta la notifica per evitare loop infiniti di routing.
- **Relay e Fan-out**: Se la notifica proviene da un'altra istanza, il server programma un refetch con debounce per i suoi sottoscrittori connessi localmente a ciascuna modifica. Non legge nulla alla ricezione: ogni frame è un refetch nell'ambito (scope) specifico del proprio sottoscrittore.
- **Ciclo di riconnessione del supervisore**: Se la connessione al database si interrompe, un supervisore di connessione in background monitora lo stato e attiva una sequenza di riconnessione automatica dopo un ritardo fisso di **3 secondi**, ripristinando il loop `LISTEN` senza influire sul ciclo di vita principale dell'applicazione Hono. Ogni sottoscrizione attiva sull'istanza viene quindi rieseguita (refetch), poiché qualsiasi cosa pubblicata mentre la connessione era interrotta non ha raggiunto nessuno. Se il database non è raggiungibile all'avvio, la connessione viene ritentata nello stesso modo.
- **Heartbeat**: Una connessione `LISTEN` è inattiva (idle) per natura, e un timeout di idle-flow su un load balancer o NAT può interromperla senza alcun errore su entrambi i lati (una connessione half-open). Per questo motivo, viene eseguita con TCP keepalive e deve rispondere a un `SELECT 1` ogni 30 secondi entro 10 secondi. Se non risponde, viene sostituita come descritto sopra. Mentre la connessione è inattiva, `/health` la segnala come `cross-instance`, e dopo 60 secondi di inattività il check fallisce.

## Canali e presence tra istanze

Le modifiche alle righe si propagano tra le istanze in modo autonomo (come descritto sopra). I canali di broadcast e la presence **no**: per impostazione predefinita eseguono il fan-out solo verso i client connessi all'istanza che li ha ricevuti.

Su una singola istanza questo è esattamente il comportamento desiderato e non comporta costi. Dietro un load balancer, tuttavia, è un bug che non si noterà in sviluppo: due collaboratori finiscono su repliche diverse, entrano nello stesso canale e vedono una stanza vuota pur trasmettendo l'uno all'altro senza problemi. Nessun errore viene generato.

La soluzione è un **channel bus** — un transport opzionale che trasferisce i frame del canale e la presence tra le istanze:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: {
        bus: { type: "postgres" }
    }
})
```

| Bus          | Quando utilizzarlo                                                                                   |
|--------------|--------------------------------------------------------------------------------------------------------|
| `memory`     | **Predefinito.** Singola istanza. Nessuna consegna cross-istanza, nessun overhead.                      |
| `postgres`   | Due o più istanze. Utilizza `LISTEN/NOTIFY` sul database già esistente — nessun nuovo servizio da distribuire. |

Il transport può anche essere configurato per ciascun deployment con
`REALTIME_CHANNEL_BUS=memory|postgres`, in modo da poter essere modificato senza una ricompilazione (rebuild).
Sovrascrive una configurazione predefinita **con nome** (`bus: { type: "memory" }`), e viene
deliberatamente **ignorato** quando a `realtime.bus` è stata passata un'*istanza* già costruita di
`ChannelBus` — la variabile può solo specificare transport che questo pacchetto
sa come istanziare, quindi rispettarla in quel caso significherebbe scartare silenziosamente
l'oggetto fornito dall'applicazione. In tale eventualità viene registrato un warning che indica entrambi, e un
valore non riconosciuto esegue il fallback su qualsiasi cosa sia stata configurata anziché su memory.

### Perché non è presente un'opzione Redis integrata

Rebase viene distribuito come Postgres + backend + frontend. Un bus che richiedesse un message broker introdurrebbe un secondo servizio stateful in ogni `docker-compose.yml` generato dalla CLI, per una funzionalità che la maggior parte delle applicazioni non usa mai — di conseguenza, il requisito per aggiungerne uno è che il database non riesca davvero a sostenere il carico.

Ed è in grado di farlo. Misurato su due istanze di backend connesse a un singolo container Postgres, il bus Postgres ha consegnato **~10.000 messaggi cross-istanza al secondo senza alcuna perdita**, e ha mantenuto prestazioni costanti fino a **otto istanze** (14.000 consegne, nessuna perdita). Venti persone che muovono cursori a 60 fps generano circa 1.200 messaggi al secondo — all'incirca un ottavo di tale valore.

Il limite a cui prestare attenzione non è la capacità, ma il fatto che ogni notifica è una query sul database primario, che compete con le query reali dell'applicazione. Il bus Postgres, pertanto, **combina (coalesces)** i frame in uscita (vedi sotto), mantenendo tale costo proporzionale al tempo trascorso piuttosto che al numero di messaggi.

Per ogni client, il socket accetta fino a **7.200 frame di canale al minuto** (120/s — 60 fps di broadcast dei cursori più l'aggiornamento di presence trasportato da ciascuno), conteggiati separatamente dal budget condiviso da query e sottoscrizioni. I frame oltre tale limite vengono rifiutati con un errore `RATE_LIMITED` anziché essere accodati.

Il rifiuto viene notificato tramite `channel.onError()`, non come un `broadcast()` rifiutato — consulta [Quando un frame di canale viene rifiutato](/docs/backend/realtime#when-a-channel-frame-is-refused).

Se si superano comunque questi limiti, è opportuno limitare (throttle) gli eventi relativi ai cursori sul client (lo stato last-write-wins non necessita di 60 aggiornamenti al secondo) e considerare l'instradamento dei collaboratori di un documento verso la stessa istanza tramite [`affinity`](/docs/sdk/realtime#keeping-a-group-on-one-instance) — lo sticky routing riduce il traffico cross-istanza quasi a zero, indipendentemente dal numero di utenti. Solo oltre questo punto conviene adottare un altro transport, e in tal caso la soluzione è un pacchetto transport dedicato, non un fork. Consulta [Scrivere un proprio transport](#scrivere-un-proprio-transport).

### Monitorare l'attività del bus

Con `REBASE_METRICS=true`, ogni istanza riporta i dati gestiti su `/metrics`:

| Metrica | Tipo | Significato |
|---------|------|-------------|
| `rebase_realtime_sockets` | gauge | Socket aperti su questa istanza |
| `rebase_realtime_channels` | gauge | Canali con almeno un membro su questa istanza |
| `rebase_realtime_bus_frames_published_total` | counter | Frame inviati da questa istanza al bus, per `kind`: `broadcast`, `broadcast_ref`, `presence_diff` e `channels` (le istanze si comunicano a vicenda ciò che gestiscono) |
| `rebase_realtime_bus_frames_skipped_total` | counter | Broadcast e modifiche di presence non inviati perché nessun'altra istanza aveva membri nel canale |

I contatori partono da zero all'avvio dell'istanza e contano i frame, dei quali il bus può raggrupparne diversi in un'unica notifica. I messaggi conservati (retained) viaggiano sempre, quindi non vengono mai saltati. Con il bus predefinito `memory`, entrambi rimangono a zero.

Esegui lo scraping di ciascuna istanza anziché di un load balancer posto davanti a esse: i valori sono per processo. Un gruppo che rimane su una sola istanza si manifesterà con il valore `skipped` in aumento mentre `broadcast` e `presence_diff` rimangono invariati, con i socket distribuiti tra le istanze. I broadcast che aumentano su ogni istanza indicano che i canali le attraversano entrambe o tutte. Su Rebase Cloud, `rebase cloud metrics` mostra gli stessi conteggi per istanza.

### Coalescing

I frame pubblicati mentre è aperta una breve finestra temporale partono insieme in un'unica notifica. La finestra è di tipo **leading-edge**: un frame che arriva quando nessuna finestra è aperta viene inviato immediatamente, cosicché un canale inattivo non subisce latenza aggiuntiva e solo un flusso continuo viene raggruppato in batch.

Misurato su due istanze, 3.000 broadcast, tutti consegnati in ogni caso:

| Profilo di traffico | Coalescing disattivato | Coalescing attivato | Riduzione |
|---|---|---|---|
| Burst (il più veloce possibile) | 3.000 query | 68 query | **44×** |
| Regolare (~500 msg/s, distribuito) | 3.000 query | 240 query | **12,5×** |

Il caso burst è risultato anche circa 11 volte più veloce in termini di tempo reale (wall-clock), poiché i round-trip verso il database rappresentavano il collo di bottiglia anziché il lavoro effettivo.

La finestra predefinita è di 10 ms e non è un'impostazione critica — 5 ms, 10 ms e 20 ms hanno prodotto conteggi di query identici in entrambi i profili, poiché un batch è limitato dal tetto di payload di 8 KB o dalla conformazione naturale del traffico ben prima che il timer diventi rilevante. Modificala solo se hai un motivo valido:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 disables coalescing
}
```

Una nota sul deployment: un batch viaggia con un formato wire diverso rispetto a un singolo frame, e un'istanza che esegue una build precedente non è in grado di interpretarlo. I frame singoli vengono sempre inviati senza incapsulamento (unwrapped), quindi un rolling deploy rischia la perdita di frame solo se il cluster è sottoposto a carico continuo *durante* il riavvio — e i canali retained si ripristinano comunque da soli tramite il replay della cronologia.

## Scrivere un proprio transport

`realtime.bus` accetta qualsiasi oggetto che implementi l'interfaccia `ChannelBus`, quindi un transport può essere distribuito come pacchetto autonomo — `@rebasepro/types` dichiara il contratto e non è richiesto nient'altro per implementarlo:

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

**Cosa deve garantire la tua implementazione:** `start()` rigetta se il transport non è utilizzabile; `publish()` raggiunge ogni altra istanza o rigetta; `stop()` è idempotente; e un messaggio non valido viene scartato e registrato nei log anziché sollevare un'eccezione, in modo che un singolo frame anomalo non possa bloccare il listener.

**Cosa non deve necessariamente garantire:** l'ordinamento (i canali retained includono `seq` e l'SDK ordina in base ad esso), la persistenza/durabilità (un frame perso è un aggiornamento live mancato, recuperato tramite il replay della cronologia del client) o la consegna exactly-once (i frame retained sono deduplicati tramite `seq`; i diff di presence sono idempotenti).

`maxFrameBytes` è il parametro con cui il framework stabilisce se inviare un messaggio retained di grandi dimensioni inline o sotto forma di puntatore. Restituisci `Infinity` quando il tuo transport non ha un limite significativo, in modo da non imboccare inutilmente il percorso con puntatore.

La consegna ai client locali non è di competenza del transport — il servizio realtime gestisce quali sottoscrittori ricevono un frame. Un transport si occupa unicamente di trasferire i frame tra le istanze.

### Il limite di 8 KB sul bus Postgres

`pg_notify` rifiuta un payload di 8000 byte o superiore. Cursori e presence rientrano ampiamente nei limiti; uno snapshot di un documento no. Rebase gestisce questo aspetto nello stesso modo in cui gestisce le modifiche di entità di grandi dimensioni — inviando un indirizzo anziché il body:

- **Su un canale retained** (consulta [Channel Retention](/docs/backend/realtime#channel-retention)), il messaggio è già memorizzato con un numero di sequenza, quindi la notifica trasporta solo `(channel, seq)` e ciascuna istanza ricevente legge il body a ritroso. Non c'è alcun limite di dimensione. Questo vale per ogni messaggio retained, piccolo o grande: qualsiasi login al database può eseguire `LISTEN`, quindi il body non viaggia mai nella notifica. Ciò comporta una lettura tramite primary-key per messaggio su ciascuna istanza che ha un membro nel canale.
- **I broadcast effimeri e la presence** viaggiano ancora all'interno della notifica stessa, quindi qualsiasi login al database può leggerli. Qualsiasi informazione che non debba essere leggibile in questo modo va inserita in un canale retained.
- **Su un canale effimero** non c'è nulla a cui puntare. Il broadcast viene consegnato localmente, il mittente riceve un errore `CHANNEL_BUS_PAYLOAD_TOO_LARGE` su `channel.onError()`, e un warning indica il canale — evitando che il messaggio raggiunga silenziosamente solo metà del cluster.

Se trasmetti messaggi di grandi dimensioni, imposta una regola di retention per quel canale. Questa è l'unica modifica necessaria.

### La presence è uno stato condiviso, non solo fan-out

`presence_state` deve rispondere alla domanda "chi è presente in questo canale?" per l'intero cluster, cosa che la memoria per singola istanza non può fare. Quando un bus è attivo, Rebase mantiene l'elenco dei presenti (roster) in `rebase.channel_presence` (creata automaticamente) e risponde alle richieste del roster consultando tale tabella.

| Colonna       | Contenuto                                      |
|---------------|------------------------------------------------|
| `channel`     | Nome del canale                                |
| `client_id`   | Il client tracciato                            |
| `instance_id` | A quale istanza di backend è connesso          |
| `state`       | Lo stato di presence del client                |
| `last_seen`   | Aggiornato dall'heartbeat di presence dell'SDK |

L'SDK invia l'heartbeat di presence ogni circa 20 secondi con un timeout di 30 secondi. Le righe che smettono di essere aggiornate vengono eliminate (reaped) e le disconnessioni vengono annunciate a ogni istanza — funzionando anche come meccanismo di crash recovery: un pod che si interrompe in modo anomalo lascia righe che, dopo una finestra di timeout, appaiono esattamente come quelle di qualsiasi altro client inattivo. Uno spegnimento controllato (graceful shutdown) ripulisce immediatamente le proprie righe, in modo che un rolling deploy non mostri utenti "fantasma" temporanei.

:::caution[La connessione LISTEN deve bypassare il pooler]
`LISTEN` è uno stato di sessione, quindi il bus Postgres necessita di una connessione diretta — non pgBouncer o altri pooler in modalità transazione. Rebase utilizza `DATABASE_DIRECT_URL` quando impostata; dietro un pooler, indirizzala direttamente al servizio del database. In assenza di un URL diretto utilizzabile, il bus registra un warning e rimane in modalità memory.
:::

## Prossimi passi

- [Realtime & WebSocket](/docs/backend/realtime/) — sottoscrizioni, canali e presence su una singola istanza
- [Split Processes](/docs/deployment/split-processes/) — l'architettura di deployment per cui questo è rilevante
- [Self-hosting](/docs/deployment/self-hosting/) — eseguire il runtime in autonomia
