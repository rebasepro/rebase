---
sourceHash: 8b0308f7ee06d77a
title: Realtime su più istanze
sidebar_label: Realtime su più istanze
description:"\"Come i canali di broadcast e la presence sopravvivono a più di un processo server: il bus LISTEN/NOTIFY, cosa appartiene a ciascuna istanza e come scrivere un transport personalizzato.\""
---

## Broadcasting tra istanze e architettura LISTEN/NOTIFY

Per ambienti cluster multi-istanza (ad es. in esecuzione all'interno di container Kubernetes o Docker dietro un load balancer), Rebase si affida a PostgreSQL `LISTEN/NOTIFY` per sincronizzare le **modifiche alle righe** tra le istanze. Le sottoscrizioni a collection ed entità si estendono quindi su più istanze senza alcuna configurazione: questo è ciò che descrive questa sezione.

**I canali di broadcast e la presence sono separati** e sono specifici per istanza finché non si attiva un channel bus. Vedi [Canali e presence tra istanze](#channels-and-presence-across-instances) di seguito.

### Bypass dei pool pgBouncer

Poiché i connection pooler come **pgBouncer** non supportano il modello di connessione persistente richiesto per sessioni SQL `LISTEN` di lunga durata, il supervisore real-time apre un client Postgres dedicato e non pooled (`PgClient`) direttamente verso il database. Questa connessione diretta utilizza la variabile d'ambiente `DATABASE_DIRECT_URL` se configurata, garantendo stabilità e prevenendo l'esaurimento del pool o interruzioni improvvise.

### Meccanica delle notifiche e struttura del payload

Quando un record viene modificato sull'Istanza A, trasmette una notifica sul canale `rebase_entity_changes`. Per ridurre al minimo l'overhead del database e la larghezza di banda di rete, il payload della notifica è mantenuto estremamente compatto:

```json
{
  "sid": "inst_7a9c1b",
  "p": "posts",
  "eid": "45",
  "db": null
}
```

*Nota: `sid` rappresenta l'ID istanza casuale univoco del server generato all'avvio, `p` è lo slug (path) della collection ed `eid` è l'ID dell'entità di destinazione.*

- **Auto-filtraggio**: Alla ricezione di un messaggio, ciascuna istanza legge il `sid`. Se corrisponde al proprio ID istanza, il server scarta la notifica per evitare loop infiniti di routing.
- **Relay e Fan-out**: Se la notifica proviene da un'altra istanza, il server pianifica un refetch con debounce e trasmette l'aggiornamento ai suoi sottoscrittori WebSocket connessi localmente.
- **Ciclo di riconnessione del supervisore**: Se la connessione al database si interrompe, un supervisore della connessione in background monitora lo stato e attiva una sequenza di riconnessione automatica dopo un ritardo fisso di **3 secondi**, ripristinando il loop di `LISTEN` senza influire sul ciclo di vita dell'applicazione Hono principale.

## Canali e presence tra istanze

Le modifiche alle righe attraversano le istanze autonomamente (vedi sopra). I canali di broadcast e la presence **no**: per impostazione predefinita, effettuano il fan-out solo verso i client connessi all'istanza che li ha ricevuti.

Su una singola istanza questo è esattamente il comportamento corretto e non ha alcun costo. Dietro un load balancer è un bug che non vedrai in fase di sviluppo: due collaboratori finiscono su repliche diverse, entrano nello stesso canale e vedono una stanza vuota pur trasmettendo tra loro perfettamente. Nessun errore viene generato.

La soluzione è un **channel bus**: un transport opzionale che veicola i frame di canale e la presence tra le istanze:

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
| `memory`     | **Predefinito.** Singola istanza. Nessuna consegna tra istanze, nessun overhead.                        |
| `postgres`   | Due o più istanze. Utilizza `LISTEN/NOTIFY` sul database già esistente — nessun nuovo servizio da distribuire. |

Il transport può essere impostato anche per singola distribuzione con
`REALTIME_CHANNEL_BUS=memory|postgres`, potendo così essere modificato senza una ricompilazione.
Esegue l'override di un'opzione integrata **nominata** (`bus: { type: "memory" }`), ed è
deliberatamente **ignorato** quando a `realtime.bus` è stata passata un'*istanza*
`ChannelBus` già costruita — la variabile può solo nominare i transport che questo pacchetto
sa come creare, pertanto rispettarla in quel caso significherebbe scartare silenziosamente
l'oggetto fornito dall'applicazione. Tale caso registra un warning che nomina entrambi, e un
valore non riconosciuto fa fallback su qualsiasi cosa fosse configurata anziché su memory.

### Perché non c'è un'opzione Redis inclusa

Rebase viene distribuito come Postgres + backend + frontend. Un bus che richiedesse un message broker inserirebbe un secondo servizio con stato (stateful) in ogni `docker-compose.yml` generato dalla CLI, per una funzionalità che la maggior parte delle applicazioni non usa mai — quindi il criterio per aggiungerne uno è che il database non riesca davvero a sostenere il carico.

Ma ci riesce. Misurato su due istanze di backend a fronte di un singolo container Postgres, il bus Postgres ha distribuito **~10.000 messaggi tra istanze al secondo senza perdite**, e le prestazioni sono rimaste costanti fino a **otto istanze** (14.000 consegne, nessuna perdita). Venti persone che trascinano cursori a 60 fps generano circa 1.200 messaggi al secondo — circa un ottavo di quel valore.

Il limite da monitorare non è la capacità, bensì il fatto che ogni notifica è una query sul database primario, in competizione con le vere query dell'applicazione. Il bus Postgres quindi **raggruppa (coalesces)** i frame in uscita (vedi sotto), il che mantiene tale costo proporzionale al tempo trascorso anziché al numero di messaggi.

Per ogni client, il socket accetta fino a **7.200 frame di canale al minuto** (120/s — 60 fps di broadcast del cursore più l'aggiornamento di presence veicolato da ciascuno), conteggiati separatamente dal budget condiviso tra query e sottoscrizioni. I frame che superano questo limite vengono rifiutati con un errore `RATE_LIMITED` anziché accodati.

Il rifiuto arriva su `channel.onError()`, non come una `broadcast()` respinta — vedi [Quando un frame di canale viene rifiutato](#when-a-channel-frame-is-refused).

Se dopo questo continui a spingere sui limiti, applica il throttling agli eventi di tipo cursore sul client (uno stato last-write-wins non necessita di 60 aggiornamenti al secondo) e prendi in considerazione l'instradamento dei collaboratori di un documento verso la stessa istanza — lo sticky routing riduce il traffico tra istanze quasi a zero, indipendentemente dal numero di utenti. Solo oltre tale soglia ha senso adottare un altro transport, e in quel caso la soluzione è un pacchetto transport, non un fork. Vedi [Scrivere un transport personalizzato](#writing-your-own-transport).

### Coalescing

I frame pubblicati mentre una breve finestra temporale è aperta partono insieme in un'unica notifica. La finestra è di tipo **leading-edge**: un frame che arriva quando nessuna finestra è aperta viene inviato immediatamente, così un canale inattivo non subisce alcuna latenza aggiuntiva e solo un flusso continuo viene raggruppato in batch.

Misurato su due istanze, 3.000 broadcast, tutti consegnati in ogni scenario:

| Profilo di traffico | Coalescing disattivato | Coalescing attivato | Riduzione |
|---|---|---|---|
| Burst (il più veloce possibile) | 3.000 query | 68 query | **44×** |
| Scaglionato (~500 msg/s, distribuito) | 3.000 query | 240 query | **12,5×** |

Il caso di tipo burst si è concluso anche circa 11 volte più velocemente in termini di tempo reale (wall-clock), perché i round-trip del database costituivano il collo di bottiglia anziché l'elaborazione effettiva.

La finestra è impostata in modo predefinito a 10 ms e non è un'impostazione critica — 5 ms, 10 ms e 20 ms hanno prodotto conteggi di query identici in entrambi i profili, poiché un batch è limitato dal tetto massimo del payload di 8 KB o dalla conformazione naturale del traffico ben prima che il timer diventi rilevante. Modificalo solo se hai un motivo specifico:

```typescript
realtime: {
    bus: { type: "postgres", batchWindowMs: 20 }   // 0 disables coalescing
}
```

Una nota sul deployment: un batch viaggia in un formato su rete (wire shape) diverso rispetto a un singolo frame, e un'istanza che esegue una build precedente non lo comprende. I singoli frame vengono sempre inviati non incapsulati, quindi un rolling deploy rischia la perdita di frame solo se il cluster si trova sotto carico continuo *durante* il riavvio — e i canali con retention si riparano comunque da soli tramite il replay della cronologia.

## Scrivere un transport personalizzato

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

Passa l'istanza dove andrebbe il nome di un'opzione integrata:

```typescript
database: createPostgresAdapter({
    connection: db,
    schema: { tables, enums, relations },
    realtime: { bus: new MyChannelBus(process.env.MY_TRANSPORT_URL!) }
})
```

**Cosa deve garantire la tua implementazione:** `start()` rifiuta (reject) la promise quando il transport è inutilizzabile; `publish()` raggiunge ogni altra istanza o rifiuta; `stop()` è idempotente; e un messaggio malformato viene scartato e registrato nei log anziché sollevare un'eccezione, in modo che un singolo frame errato non possa interrompere il listener.

**Cosa non deve garantire:** l'ordinamento (i canali con retention includono `seq` e l'SDK ordina in base a quello), la durabilità (un frame perso è un aggiornamento live mancato, recuperato tramite il replay della cronologia del client) o la consegna exactly-once (i frame con retention vengono deduplicati tramite `seq`; i diff di presence sono idempotenti).

`maxFrameBytes` è il modo in cui il framework sa se inviare un messaggio di grandi dimensioni con retention inline o come puntatore. Restituisci `Infinity` quando il tuo transport non ha un limite massimo rilevante, in modo che il percorso con puntatore non venga mai intrapreso inutilmente.

La consegna ai client locali non è una tua responsabilità — il servizio realtime gestisce quali sottoscrittori ricevono un frame. Un transport sposta unicamente i frame tra le istanze.

### Il limite di 8 KB sul bus Postgres

`pg_notify` rifiuta un payload di 8000 byte o più. I cursori e la presence ci rientrano comodamente; uno snapshot di un documento no. Rebase gestisce questo problema nello stesso modo in cui gestisce le modifiche a entità di grandi dimensioni — inviando un indirizzo anziché un corpo:

- **Su un canale con retention** (vedi [Channel Retention](#channel-retention)) il messaggio è già memorizzato con un numero di sequenza, quindi la notifica trasporta solo `(channel, seq)` e ciascuna istanza ricevente rilegge il corpo. Non c'è alcun limite di dimensione.
- **Su un canale effimero** non c'è nulla a cui puntare. Il broadcast viene consegnato localmente, il mittente riceve un errore `CHANNEL_BUS_PAYLOAD_TOO_LARGE` su `channel.onError()` e un avviso indica il nome del canale — evitando che il messaggio raggiunga silenziosamente solo metà del cluster.

Se trasmetti messaggi di grandi dimensioni in broadcast, assegna a quel canale una regola di retention. La soluzione è tutta qui.

### La presence è uno stato condiviso, non solo fan-out

`presence_state` deve rispondere alla domanda "chi si trova in questo canale?" per l'intero cluster, cosa che la memoria per singola istanza non può fare. Quando un bus è attivo, Rebase mantiene il roster in `rebase.channel_presence` (creato automaticamente) e risponde alle richieste relative al roster attingendo da esso.

| Colonna       | Contenuto                                      |
|---------------|------------------------------------------------|
| `channel`     | Nome del canale                                |
| `client_id`   | Il client tracciato                            |
| `instance_id` | A quale istanza backend è connesso             |
| `state`       | Lo stato di presence del client                |
| `last_seen`   | Aggiornato dall'heartbeat di presence dell'SDK |

L'SDK invia l'heartbeat della presence ogni ~20 secondi rispetto a un timeout di 30 secondi. Le righe che smettono di essere aggiornate vengono eliminate (reaped) e le disconnessioni annunciate a ogni istanza — il che funge anche da ripristino post-crash: un pod che si arresta in modo anomalo lascia dietro di sé righe che appaiono, dopo una finestra di timeout, esattamente come qualsiasi altro client diventato inattivo. Uno spegnimento controllato (graceful shutdown) cancella immediatamente le proprie righe, in modo che un rolling deploy non mostri una finestra temporale con "fantasmi".

:::caution[La connessione LISTEN deve bypassare il pooler]
`LISTEN` costituisce uno stato di sessione, quindi il bus Postgres necessita di una connessione diretta — non di pgBouncer o di qualsiasi pooler in modalità transazione. Rebase utilizza `DATABASE_DIRECT_URL` quando impostata; dietro un pooler, puntala direttamente al servizio di database stesso. Senza una URL diretta utilizzabile, il bus registra un warning e rimane in modalità memoria.
:::

## Prossimi passi

- [Realtime & WebSocket](/docs/backend/realtime/) — sottoscrizioni, canali e presence su una singola istanza
- [Split Processes](/docs/deployment/split-processes/) — la tipologia di architettura di deployment per cui questo è rilevante
- [Self-hosting](/docs/deployment/self-hosting/) — eseguire il runtime in autonomia

---
