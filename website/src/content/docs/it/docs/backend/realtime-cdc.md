---
sourceHash: 5f05a6b3c8a0e4b3
title: Acquisizione delle modifiche al database
sidebar_label: Acquisizione delle modifiche al database
description: "Eventi in tempo reale per ogni scrittura confermata, indipendentemente da come è stata eseguita: i trigger di acquisizione, l'impostazione REALTIME_CDC e i relativi requisiti."
---

**Il Change Data Capture è attivo per impostazione predefinita.** Rebase acquisisce le modifiche a livello di database ed emette eventi in tempo reale per **ogni scrittura confermata, indipendentemente da come è stata eseguita** — REST, SDK, Studio, `psql`, un cron job in un altro servizio, Drizzle/SQL non elaborato o l'**editor SQL** di Studio. È lo stesso modello di Supabase Realtime che effettua il tailing del write-ahead log.

Nessuna configurazione richiesta. Su una connessione al database che lo supporta, il CDC si autoconfigura all'avvio; su una che non lo supporta (ad es. un ruolo con restrizioni che non può creare trigger), Rebase passa silenziosamente al realtime a livello di applicazione — niente da attivare, niente che si rompa.

## Configurazione

Il CDC è controllato dalla variabile d'ambiente `REALTIME_CDC`:

| Valore | Comportamento |
| --- | --- |
| `auto` *(predefinito)* | Abilita l'acquisizione a livello di database dove la connessione lo supporta; **ricorre silenziosamente** al realtime a livello di applicazione in caso contrario. Zero-config. |
| `trigger` | Forza l'acquisizione basata su trigger. Funziona su qualsiasi PostgreSQL, comprese le istanze gestite senza replica logica. Emette un avviso (anziché ricorrere silenziosamente al fallback) se non riesce a configurarsi. |
| `wal` | Legge le modifiche dal write-ahead log tramite replica logica anziché usare i trigger, così una scrittura non esegue trigger e non invia `NOTIFY`. Richiede `wal_level=logical` e un ruolo abilitato alla replica; ricorre a `trigger`, con un avviso, se uno dei due requisiti è assente. Consulta [Acquisizione dal WAL](#acquisizione-dal-wal). |
| `off` | Solo realtime a livello di applicazione. Utilizzalo per evitare l'overhead dei trigger per ogni scrittura su carichi di lavoro intensivi in scrittura. Un avvio con `off` che possiede lo schema **rimuove** inoltre i trigger e le funzioni di acquisizione installati da un avvio precedente e registra quanti ne ha rimossi; rimuovendo l'impostazione, l'avvio successivo li installerà nuovamente. |

La stessa impostazione corrisponde all'opzione `realtime.cdc` dell'adapter Postgres, per un server che la configura tramite codice. Se impostata, la variabile `REALTIME_CDC` ha la precedenza.

All'avvio vedrai una riga di log che indica la modalità attiva, ad esempio:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Se la connessione non lo supporta, `auto` registra invece una riga informativa e prosegue con il realtime a livello di applicazione:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Come funziona

1. **Autoconfigurazione** — All'avvio (contesto server/owner), Rebase installa trigger idempotenti `AFTER INSERT/UPDATE/DELETE/TRUNCATE` su ciascuna tabella gestita. Questi si attivano una volta per istruzione ed emettono notifiche di modifica sul canale `rebase_cdc` che identificano le righe modificate tramite la loro chiave — la chiave primaria, oltre alle due colonne ID per una tabella di giunzione many-to-many — e **nessun'altra colonna**. Un'istruzione che modifica molte righe le raggruppa in batch di circa mille chiavi, quindi un `UPDATE` di 1 milione di righe invia circa 1.000 notifiche anziché un milione; un'istruzione che modifica una sola riga invia una notifica e una che non ne modifica nessuna non invia nulla. Un'operazione di `TRUNCATE` viene notificata come una modifica a ogni riga della tabella. Una tabella partizionata mantiene un trigger per riga, poiché PostgreSQL copia un trigger di riga su ogni partizione e una scrittura eseguita direttamente su una partizione viene comunque rilevata. PostgreSQL non impone permessi speciali su `LISTEN`, quindi qualsiasi ruolo in grado di connettersi al database può leggere questo canale; apprende quali chiavi sono cambiate, ma mai il loro contenuto. Una chiave troppo grande per il limite di 8&nbsp;KB di `NOTIFY` di PostgreSQL viene inviata come nessuna chiave (una modifica all'intera tabella, che forza il recupero dei dati per ogni sottoscrizione a elenco o a singola riga su di essa), pertanto il CDC non può mai causare l'annullamento della scrittura scatenante. Le funzioni vengono sostituite a ogni avvio che effettua il provisioning, quindi un database configurato con una versione precedente — il cui trigger inviava righe complete — viene aggiornato all'avvio successivo; un avvio con `REALTIME_CDC=off` le rimuove.

   **Aggiornamento.** Un database configurato con una versione precedente all'introduzione del batching possiede un trigger per riga; il primo avvio di una versione più recente lo sostituisce con i trigger per istruzione. Per le 24 ore successive, i nuovi trigger continuano a inviare una notifica per riga, come facevano i precedenti, in modo che le istanze della versione precedente ancora in esecuzione durante un deployment progressivo (o dopo un rollback) ricevano ogni riga. Trascorso questo intervallo, passano al batching. Tutte le versioni che supportano il batching sono in grado di leggere entrambi i formati.
2. **Acquisizione** — Un client `LISTEN` dedicato e senza pooling per ogni istanza consuma `rebase_cdc`, rimappa la tabella modificata sulla rispettiva tabella servita e inoltra la modifica alla stessa pipeline `RealtimeService` utilizzata dalle mutazioni API. Come il listener cross-istanza, preferisce `DATABASE_DIRECT_URL` e si riconnette automaticamente.
3. **Distribuzione sicura rispetto a RLS** — La riga non elaborata proveniente dallo stream di modifiche non viene **mai** inoltrata ai sottoscrittori. La modifica viene contrassegnata come invalidata e ogni sottoscrizione rilegge la riga con il **proprio** contesto di autenticazione. Il filtraggio avviene quindi per sottoscrittore, mai per publisher: un client riceve solo ed esclusivamente le righe consentite dalle sue policy RLS.
4. **Cross-istanza** — Poiché ogni istanza osserva ogni commit tramite lo stream di modifiche, il CDC funge *anche* da canale tra le istanze; il broadcast legacy per mutazione `rebase_entity_changes` non viene utilizzato quando il CDC è attivo.
5. **Deduplicazione** — Una mutazione eseguita tramite l'API di Rebase pianifica un nuovo recupero (refetch) per i sottoscrittori locali nell'istante in cui viene confermata ed è anche rimandata indietro attraverso lo stream di modifiche. L'istanza di origine sopprime un'eco che arriva entro la finestra di debounce del refetch (un registro temporaneo delle proprie emissioni), perciò una scrittura API produce normalmente un solo frame. Un'eco che arriva dopo tale finestra attiva un ulteriore refetch, che distribuisce nuovamente le stesse righe: un comportamento innocuo, sebbene un sottoscrittore possa ricevere due volte lo stesso frame.

## Acquisizione dal WAL

`REALTIME_CDC=wal` legge le modifiche dal write-ahead log di PostgreSQL tramite la replica logica (il plugin integrato `pgoutput`) anziché usare i trigger. In questo modo, una scrittura non attiva alcun trigger e non invia alcun `NOTIFY`, il che diventa cruciale in presenza di scritture concorrenti: una transazione che ha chiamato `NOTIFY` acquisisce un lock per l'intero server al momento del commit e lo mantiene durante il flush su disco; di conseguenza, con l'acquisizione basata su trigger, tali commit avvengono uno alla volta. Dai test condotti su PostgreSQL 18 con 32 writer concorrenti e un flush su disco di 1&nbsp;ms, l'acquisizione tramite trigger ha mantenuto gli inserimenti a circa un decimo del throughput raggiunto dall'acquisizione tramite WAL.

Richiede:

- `wal_level = logical` sul server, che richiede un riavvio. Su Amazon RDS imposta `rds.logical_replication = 1`; su Cloud SQL, `cloudsql.logical_decoding = on`.
- Un ruolo abilitato alla replica: `ALTER ROLE <role> REPLICATION`, o l'equivalente per l'host utilizzato (su RDS, l'appartenenza a `rds_replication`).
- Un replication slot e un WAL sender liberi per ciascuna istanza del server (`max_replication_slots` e `max_wal_senders`, entrambi impostati a 10 per impostazione predefinita).
- Una connessione diretta (`DATABASE_DIRECT_URL`): i pooler di connessione non supportano il protocollo di replica.

Se uno qualsiasi di questi requisiti non è soddisfatto, l'avvio registra la motivazione nei log e usa invece l'acquisizione basata su trigger.

Cosa fa la procedura di avvio:

- Crea una pubblicazione denominata `rebase_cdc` e vi aggiunge ogni tabella gestita e ogni tabella di giunzione many-to-many. Le tabelle vengono sempre e solo aggiunte, pertanto una versione precedente ancora in esecuzione durante un deployment progressivo non può rimuovere la tabella di una versione più recente.
- Una tabella senza chiave primaria o con `REPLICA IDENTITY NOTHING` viene esclusa con un avviso: PostgreSQL rifiuta le operazioni di `UPDATE` e `DELETE` su una tabella pubblicata che non è in grado di specificare quale riga sia cambiata. Le scritture su di essa effettuate al di fuori di Rebase non vengono acquisite.
- Ciascuna istanza trasmette in streaming la pubblicazione tramite il proprio replication slot **temporaneo**, che PostgreSQL elimina alla chiusura della connessione; in questo modo, un'istanza che si arresta in modo anomalo non rischia di lasciare un slot attivo che trattiene il WAL fino a riempire il disco. Una riconnessione crea un nuovo slot e ogni sottoscrizione esegue un nuovo refetch, poiché i commit avvenuti durante l'intervallo di disconnessione non vengono riprodotti.
- Una volta aperto lo stream, un avvio che effettua sia il provisioning sia il consumo rimuove i trigger di acquisizione, esattamente come farebbe `off`. Durante un deployment progressivo per abbandonare l'acquisizione tramite trigger, le istanze che continuano a eseguirla smettono di ricevere le scritture effettuate altrove fino a quando non vengono sostituite; le loro scritture raggiungono comunque i rispettivi sottoscrittori. Un processo che esegue esclusivamente il provisioning, come il job di migrazione di un [split deployment](/docs/deployment/split-processes/), mantiene i trigger per i consumer che non possono utilizzare lo streaming e devono ripiegare su di essi.

I processi di scrittura mantengono la loro piena velocità durante i picchi di carico, ma ogni slot viene decodificato da un solo WAL sender; pertanto, oltre diverse migliaia di scritture continue al secondo, gli eventi potrebbero arrivare con ritardo. Un ruolo dotato di `REPLICATION` può leggere ogni riga di una tabella pubblicata attraverso un proprio slot; lo stream rimane all'interno del server e i sottoscrittori continuano a rileggere ciascuna riga nel rispetto delle proprie policy RLS.

## Requisiti e note

- Il CDC richiede una stringa di connessione diretta (`DATABASE_DIRECT_URL`, l'opzione `directConnectionString` dell'adapter o la connessione primaria) per il client `LISTEN` — i connection pooler in modalità transazione non supportano sessioni `LISTEN` persistenti.
- I trigger vengono installati solo sulle tabelle gestite dal backend e sulle tabelle di giunzione delle loro relazioni many-to-many. Le scritture su tabelle non mappate vengono ignorate.
- Una tabella gestita non ancora creata viene ignorata emettendo un avviso, invece di bloccare il CDC per le restanti tabelle.

## Passaggi successivi

- [Realtime & WebSocket](/docs/backend/realtime) — sottoscrizioni, canali e presenza, alimentati da questi eventi.
- [Realtime across instances](/docs/backend/realtime-transports) — il bus che trasmette le modifiche tra i processi del server.
