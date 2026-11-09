---
sourceHash: 0d3cfd360fdde126
title: "Acquisizione delle modifiche a livello di database (CDC)"
sidebar_label: "Acquisizione delle modifiche a livello di database (CDC)"
description: "Eventi realtime per ogni scrittura sottoposta a commit, comunque sia stata eseguita: i trigger di acquisizione, l'impostazione REALTIME_CDC e ciò di cui hanno bisogno."
---

**Change Data Capture è attivo per impostazione predefinita.** Rebase acquisisce le modifiche a livello di database ed emette eventi realtime per **ogni scrittura sottoposta a commit, indipendentemente da come è stata eseguita** — REST, SDK, Studio, `psql`, un cron job in un altro servizio, Drizzle/SQL raw o l'**editor SQL** di Studio. È lo stesso modello adottato da Supabase Realtime per analizzare il write-ahead log.

Nessuna configurazione richiesta. Su una connessione al database che lo supporta, CDC si auto-inizializza all'avvio; su quelle che non lo supportano (ad es. un ruolo con privilegi limitati che non può creare trigger), Rebase ricorre silenziosamente al realtime a livello applicativo — niente da abilitare, nulla che si interrompa.

## Configurazione

CDC è controllato dalla variabile d'ambiente `REALTIME_CDC`:

| Valore | Comportamento |
| --- | --- |
| `auto` *(predefinito)* | Abilita l'acquisizione a livello di database se la connessione lo supporta; effettua un **fallback silenzioso** al realtime a livello applicativo in caso contrario. Zero configurazione. |
| `trigger` | Forza l'acquisizione basata su trigger. Funziona su qualsiasi istanza PostgreSQL, incluse le istanze gestite prive di replica logica. Emette un avviso (invece del fallback silenzioso) se non è possibile effettuare il provisioning. |
| `wal` | Legge le modifiche dal write-ahead log tramite replica logica invece che con i trigger, così una scrittura non esegue alcun trigger e non invia alcun `NOTIFY`. Richiede `wal_level=logical` e un ruolo autorizzato a replicare; se uno dei due manca, degrada a `trigger` con un avviso. Vedere [Acquisizione dal WAL](#acquisizione-dal-wal). |
| `off` | Solo realtime a livello applicativo. Usalo per evitare l'overhead dei trigger per ogni scrittura su carichi di lavoro ad alta intensità di scrittura. Un boot con `off` che possiede lo schema **rimuove** anche i trigger e le funzioni di cattura che un boot precedente aveva installato, e registra quanti ne ha tolti; rimuovi l'impostazione e il boot successivo li installa di nuovo. |

La stessa impostazione è
l'opzione `realtime.cdc` dell'adattatore Postgres, per un server che la configura nel
codice. `REALTIME_CDC`, se impostata, prevale.

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

## Come funziona

1. **Auto-provisioning** — All'avvio (nel contesto server/owner), Rebase installa trigger idempotenti `AFTER INSERT/UPDATE/DELETE/TRUNCATE` su ciascuna tabella gestita. Scattano una volta per istruzione ed emettono notifiche di modifica sul canale `rebase_cdc` che identificano le righe modificate tramite la loro chiave — la chiave primaria, più le due colonne id per una tabella di giunzione many-to-many — e non trasportano **nessun'altra colonna**. Un'istruzione che ha modificato molte righe le nomina in lotti di circa mille chiavi, quindi un `UPDATE` su 1M di righe invia circa 1.000 notifiche anziché un milione; un'istruzione che ha modificato una riga invia una notifica, e una che non ne ha modificate nessuna non invia nulla. Un `TRUNCATE` viene annunciato come una modifica a ogni riga della collection. Una tabella partizionata mantiene un trigger per riga, perché PostgreSQL copia un trigger di riga su ogni partizione e una scrittura fatta direttamente su una partizione viene comunque vista. PostgreSQL non impone alcun privilegio su `LISTEN`, quindi qualsiasi ruolo in grado di connettersi al database può leggere questo canale; apprende quali chiavi sono cambiate, mai cosa contengono. Una chiave troppo grande per il limite di 8&nbsp;KB del comando `NOTIFY` di PostgreSQL viene inviata come nessuna chiave (una modifica all'intera collection, che ogni sottoscrizione a elenco e a singola riga su di essa rilegge), impedendo così a CDC di interrompere la scrittura che ha generato l'evento. Le funzioni vengono sostituite a ogni avvio che esegue il provisioning, quindi un database strumentato da una versione precedente — il cui trigger inviava righe intere — viene aggiornato al boot successivo; un boot con `REALTIME_CDC=off` le rimuove invece.

   **Aggiornamento.** Un database strumentato da una versione precedente al batching ha un trigger per riga; il primo avvio di una versione più recente lo sostituisce con i trigger per istruzione. Per le 24 ore successive, i nuovi trigger inviano ancora una notifica per riga, come facevano i vecchi, così le istanze della versione precedente ancora in esecuzione durante un deploy progressivo (o dopo un rollback) sentono ogni riga. Dopo la finestra, fanno il batching. Ogni versione che fa il batching legge entrambe le forme.
2. **Acquisizione** — Un client `LISTEN` dedicato e non condiviso (unpooled) per istanza consuma `rebase_cdc`, mappa la tabella modificata sulla rispettiva collezione e inserisce la modifica nella stessa pipeline di `RealtimeService` utilizzata dalle mutazioni API. Come il listener tra istanze, predilige `DATABASE_DIRECT_URL` e si riconnette automaticamente.
3. **Recapito sicuro con RLS** — La riga grezza proveniente dal flusso di modifiche non viene **mai** inoltrata ai sottoscrittori. La modifica viene contrassegnata come invalidata e ciascuna sottoscrizione rilegge la riga con il **proprio** contesto di autenticazione. Il filtraggio avviene quindi per sottoscrittore, mai per publisher: un client riceve unicamente le righe consentite dalle proprie policy RLS.
4. **Tra istanze (Cross-instance)** — Poiché ogni istanza osserva ogni commit attraverso il flusso di modifiche, CDC funge anche da canale cross-instance; il broadcast legacy `rebase_entity_changes` per mutazione non viene utilizzato quando CDC è attivo.
5. **Deduplicazione** — Una mutazione effettuata tramite l'API di Rebase pianifica un refetch per i sottoscrittori locali nell'istante in cui viene eseguito il commit e viene anche rimandata indietro come eco attraverso il flusso di modifiche. L'istanza di origine sopprime un'eco che arriva entro la finestra di debounce del refetch (un record a vita breve delle proprie emissioni), quindi una scrittura API normalmente produce un solo frame. Un'eco che arriva più tardi innesca un ulteriore refetch, che consegna di nuovo le stesse righe: innocuo, ma un sottoscrittore può vedere due volte un frame identico.

## Acquisizione dal WAL

`REALTIME_CDC=wal` legge le modifiche dal write-ahead log di PostgreSQL tramite replica logica (il plugin integrato `pgoutput`) invece che con i trigger. Una scrittura allora non esegue alcun trigger e non invia alcun `NOTIFY`, e questo conta appena le scritture sono concorrenti: una transazione che ha chiamato `NOTIFY` prende al commit un lock per l'intero server e lo tiene per tutta la scrittura su disco, quindi con l'acquisizione tramite trigger quei commit avvengono uno alla volta. Misurata su PostgreSQL 18 con 32 scrittori concorrenti e un flush su disco di 1&nbsp;ms, l'acquisizione tramite trigger ha limitato gli insert a circa un decimo del ritmo raggiunto dall'acquisizione dal WAL.

Requisiti:

- `wal_level = logical` sul server, che richiede un riavvio. Su Amazon RDS impostare `rds.logical_replication = 1`; su Cloud SQL, `cloudsql.logical_decoding = on`.
- Un ruolo autorizzato a replicare: `ALTER ROLE <role> REPLICATION`, o l'equivalente del provider (su RDS, l'appartenenza a `rds_replication`).
- Uno slot di replica e un WAL sender liberi per ogni istanza del server (`max_replication_slots` e `max_wal_senders`, entrambi 10 per impostazione predefinita).
- Una connessione diretta (`DATABASE_DIRECT_URL`): un pooler non trasporta il protocollo di replica.

Se manca uno di questi, l'avvio registra il motivo e usa l'acquisizione tramite trigger.

Cosa fa un avvio:

- Crea una pubblicazione chiamata `rebase_cdc` e vi aggiunge la tabella di ogni collection e ogni tabella di giunzione di una relazione many-to-many. Le tabelle vengono solo aggiunte, così una versione precedente ancora in esecuzione durante un rolling deploy non può toglierne la tabella di una collection più recente.
- Una tabella senza chiave primaria, o con `REPLICA IDENTITY NOTHING`, resta fuori con un avviso: PostgreSQL rifiuta `UPDATE` e `DELETE` su una tabella pubblicata che non sa dire quale riga è cambiata. Le scritture su di essa fatte fuori da Rebase non vengono acquisite.
- Ogni istanza legge la pubblicazione tramite il proprio slot di replica **temporaneo**, che PostgreSQL elimina alla chiusura della connessione: un'istanza che va in crash non può quindi lasciare uno slot che trattiene WAL fino a riempire il disco. Una riconnessione apre un nuovo slot e ogni sottoscrizione ricarica i dati, perché ciò che è stato confermato durante l'interruzione non viene riprodotto.
- Una volta aperto il suo flusso, un avvio che esegue sia il provisioning sia il consumo rimuove i trigger di acquisizione, come fa `off`. Durante un rolling deploy che abbandona l'acquisizione tramite trigger, le istanze che la usano ancora smettono di ricevere le scritture fatte altrove finché non vengono sostituite; le loro scritture continuano ad arrivare ai loro sottoscrittori. Un processo che esegue solo il provisioning, come il job di migrazione di un [deployment suddiviso](/docs/deployment/split-processes/), mantiene i trigger per i consumatori che non possono leggere il flusso e ripiegano su di essi.

Gli scrittori mantengono tutta la loro velocità durante un picco, ma un solo WAL sender decodifica ogni slot, quindi oltre alcune migliaia di scritture al secondo sostenute gli eventi possono arrivare in ritardo. Un ruolo con `REPLICATION` può leggere ogni riga di una tabella pubblicata tramite un proprio slot; il flusso resta all'interno del server e i sottoscrittori continuano a rileggere ogni riga con il proprio RLS.

## Requisiti e note

- CDC richiede una stringa di connessione diretta (`DATABASE_DIRECT_URL`, la `directConnectionString` dell'adattatore o la connessione primaria) per il client `LISTEN` — i connection pooler in modalità transazione non supportano sessioni `LISTEN` persistenti.
- I trigger vengono installati solo su tabelle collegate a una collezione registrata, e sulle tabelle di giunzione delle sue relazioni many-to-many. Le scritture su tabelle non mappate vengono ignorate.
- Una collezione la cui tabella non è ancora stata migrata viene ignorata con un avviso invece di bloccare CDC per il resto.

## Passaggi successivi

- [Realtime & WebSocket](/docs/backend/realtime) — sottoscrizioni, canali e presenza, che questi eventi alimentano.
- [Realtime su più istanze](/docs/backend/realtime-transports) — il bus che trasporta le modifiche tra i processi del server.
