---
sourceHash: a04d0760ffb715cb
title: Acquisizione delle modifiche al database (CDC)
sidebar_label: Acquisizione delle modifiche al database
description: "Eventi in tempo reale per ogni scrittura confermata, indipendentemente da come è stata eseguita: i trigger di acquisizione, l'impostazione REALTIME_CDC e i relativi requisiti."
---

**Il Change Data Capture è attivo per impostazione predefinita.** Rebase acquisisce le modifiche a livello di database ed emette eventi in tempo reale per **ogni scrittura confermata, indipendentemente da come è stata eseguita** — REST, SDK, Studio, `psql`, un cron job in un altro servizio, Drizzle/SQL non elaborato o l'**editor SQL** di Studio. Si tratta dello stesso modello di Supabase Realtime che effettua il tailing del write-ahead log.

Non è richiesta alcuna configurazione. Su una connessione al database che lo supporta, il CDC si autoconfigura all'avvio; su una che non lo supporta (ad es. un ruolo con privilegi limitati che non può creare trigger), Rebase utilizza silenziosamente il realtime a livello di applicazione — niente da attivare, niente che si rompa.

## Configurazione

Il CDC è controllato dalla variabile d'ambiente `REALTIME_CDC`:

| Valore | Comportamento |
| --- | --- |
| `auto` *(predefinito)* | Legge le modifiche dal WAL dove il database lo consente, altrimenti usa i trigger di acquisizione, altrimenti ripiega sul realtime a livello di applicazione. Ogni fallback produce una riga di log informativa, non un avviso. Zero configurazione. Consulta [Acquisizione dal WAL](#acquisizione-dal-wal). |
| `trigger` | Forza l'acquisizione basata su trigger. Funziona su qualsiasi PostgreSQL, comprese le istanze gestite senza replica logica. Emette un avviso (invece di eseguire un fallback silenzioso) se non riesce a effettuare il provisioning. |
| `wal` | Legge le modifiche dal write-ahead log tramite replica logica invece dei trigger, in modo che una scrittura non esegua alcun trigger e non invii alcun `NOTIFY`. Richiede `wal_level=logical` e un ruolo abilitato alla replica; ripiega su `trigger`, con un avviso, quando manca uno dei due requisiti. Consulta [Acquisizione dal WAL](#acquisizione-dal-wal). |
| `off` | Solo realtime a livello di applicazione. Utilizzalo per evitare l'overhead dei trigger per singola scrittura su carichi di lavoro ad alta intensità di scrittura. Un avvio con `off` che possiede lo schema **rimuove** anche i trigger di acquisizione e le funzioni installati da un avvio precedente, registrando quanti ne ha eliminati; disattivando l'impostazione, l'avvio successivo li installerà nuovamente. |

La stessa configurazione corrisponde
all'opzione `realtime.cdc` dell'adapter Postgres, per un server che la configura da
codice. `REALTIME_CDC`, se impostata, ha la precedenza.

All'avvio vedrai una riga di log indicante la modalità attiva, ad es.:

```
📡 [CDC] Realtime source = database-level change capture (mode: trigger).
   All writes now emit realtime events regardless of origin.
```

Se la connessione non è in grado di supportarlo, `auto` registra invece una riga informativa e continua con il realtime a livello di applicazione:

```
ℹ️ [CDC] Database-level change capture unavailable (likely insufficient
   privileges to create triggers…) — using app-level realtime.
```

## Come funziona

1. **Autoprovisioning** — All'avvio (contesto server/owner), Rebase installa trigger idempotenti `AFTER INSERT/UPDATE/DELETE/TRUNCATE` su ciascuna tabella gestita. Questi scattano una volta per istruzione ed emettono notifiche di modifica sul canale `rebase_cdc` che identificano le righe modificate tramite la loro chiave — la chiave primaria, oltre alle due colonne id per una tabella di giunzione molti-a-molti — e non trasportano **nessun'altra colonna**. Un'istruzione che ha modificato molte righe le elenca in batch di circa mille chiavi, in modo che un `UPDATE` di 1 milione di righe invii circa 1.000 notifiche anziché un milione; un'istruzione che ha modificato una riga invia una notifica, e una che non ne ha modificata nessuna non invia nulla. Un'operazione di `TRUNCATE` viene notificata come una modifica a ogni riga della tabella. Una tabella partizionata mantiene un trigger per riga, poiché PostgreSQL copia un trigger di riga su ogni partizione e una scrittura effettuata direttamente su una partizione viene comunque intercettata. PostgreSQL non impone alcun privilegio per `LISTEN`, quindi qualsiasi ruolo che può connettersi al database può leggere questo canale; viene a conoscenza di quali chiavi sono cambiate, mai del loro contenuto. Una chiave troppo grande per il limite di 8&nbsp;KB del `NOTIFY` di PostgreSQL viene inviata senza chiave (una modifica all'intera tabella, che ogni sottoscrizione di elenchi e di singole righe su di essa recupera nuovamente), impedendo al CDC di interrompere la scrittura scatenante. Le funzioni vengono sostituite a ogni avvio che esegue il provisioning, quindi un database instrumentato da una versione precedente — il cui trigger inviava righe intere — viene aggiornato al successivo avvio; un avvio con `REALTIME_CDC=off` le rimuove del tutto.

   **Aggiornamento.** Un database instrumentato da una versione precedente all'introduzione del batching presenta un trigger per riga; il primo avvio di una versione più recente lo sostituisce con i trigger per istruzione. Per 24 ore successive, i nuovi trigger continuano a inviare una notifica per riga, come facevano i vecchi, in modo che le istanze della versione precedente ancora in esecuzione durante un deployment progressivo (rolling deploy) o dopo un rollback ricevano ogni riga. Trascorso questo intervallo, passano alla modalità batch. Tutte le versioni che supportano il batching sono in grado di interpretare entrambi i formati.
2. **Acquisizione** — Un client `LISTEN` dedicato e non condiviso (unpooled) per istanza consuma `rebase_cdc`, mappa la tabella modificata sulla rispettiva tabella servita e inoltra la modifica alla stessa pipeline di `RealtimeService` utilizzata dalle mutazioni API. Come il listener cross-istanza, preferisce `DATABASE_DIRECT_URL` e si riconnette automaticamente.
3. **Consegna compatibile con RLS** — La riga non elaborata proveniente dallo stream delle modifiche non viene **mai** inoltrata ai sottoscrittori. La modifica viene contrassegnata come invalidata e ogni sottoscrizione rilegge la riga con il **proprio** contesto di autenticazione. Il filtraggio avviene quindi per singolo sottoscrittore, mai per publisher: un client riceve solo ed esclusivamente le righe consentite dalle sue policy RLS.
4. **Cross-istanza** — Poiché ogni istanza osserva ogni commit attraverso il flusso delle modifiche, il CDC funge anche da canale cross-istanza; il broadcast legacy per mutazione `rebase_entity_changes` non viene utilizzato quando il CDC è attivo.
5. **Deduplicazione** — Una mutazione effettuata tramite l'API di Rebase pianifica un nuovo recupero (refetch) per i sottoscrittori locali nell'istante stesso in cui viene confermata (commit) e viene anche re-inviata tramite lo stream delle modifiche. L'istanza di origine sopprime l'eco che arriva all'interno della finestra di debounce del refetch (un registro a breve termine delle proprie emissioni), per cui una scrittura da API produce normalmente un singolo frame. Un'eco che arriva più tardi rispetto a tale finestra attiva un ulteriore refetch, che distribuisce nuovamente le stesse righe: un comportamento innocuo, ma un sottoscrittore potrebbe visualizzare due volte un frame identico.

## Acquisizione dal WAL

`REALTIME_CDC=wal`, così come `auto` laddove il database lo consenta, legge le modifiche dal write-ahead log di PostgreSQL tramite la replica logica (il plugin integrato `pgoutput`) anziché usare i trigger. Di conseguenza, una scrittura non esegue alcun trigger e non invia alcun `NOTIFY`, un aspetto cruciale in presenza di scritture concorrenti: una transazione che ha richiamato `NOTIFY` acquisisce un blocco per l'intero server al commit e lo mantiene per tutta la durata del flush su disco; pertanto, con l'acquisizione tramite trigger, tali commit avvengono uno alla volta. Nei test effettuati su PostgreSQL 18 con 32 writer concorrenti e un flush su disco di 1&nbsp;ms, l'acquisizione tramite trigger ha limitato gli inserimenti a circa un decimo della frequenza raggiunta dall'acquisizione da WAL.

Requisiti:

- `wal_level = logical` sul server, operazione che richiede un riavvio. Su Amazon RDS impostare `rds.logical_replication = 1`; su Cloud SQL, `cloudsql.logical_decoding = on`.
- Un ruolo abilitato alla replica: `ALTER ROLE <role> REPLICATION`, o l'equivalente della piattaforma host (su RDS, l'appartenenza a `rds_replication`).
- Uno slot di replica e un WAL sender liberi per ogni istanza del server (`max_replication_slots` e `max_wal_senders`, entrambi impostati a 10 per impostazione predefinita).
- Una connessione diretta (`DATABASE_DIRECT_URL`): un pooler di connessioni non supporta il protocollo di replica.

Quando manca uno di questi requisiti, l'avvio registra il motivo e utilizza l'acquisizione tramite trigger: con un avviso nel caso di `wal`, con una riga informativa nel caso di `auto`, dato che la maggior parte dei database non è configurata per il logical decoding e questo è il risultato previsto in tali contesti.

Cosa fa un avvio:

- Crea una pubblicazione denominata `rebase_cdc` e vi aggiunge ogni tabella servita e ogni tabella di giunzione molti-a-molti. Le tabelle vengono solo aggiunte, pertanto una versione precedente ancora in esecuzione durante un rolling deploy non può rimuovere la tabella di una versione più recente.
- Una tabella priva di chiave primaria, o con `REPLICA IDENTITY NOTHING`, viene esclusa con un avviso: PostgreSQL rifiuta le operazioni di `UPDATE` e `DELETE` su una tabella pubblicata che non è in grado di indicare quale riga sia cambiata. Le scritture effettuate su di essa al di fuori di Rebase non vengono acquisite.
- Ciascuna istanza riceve lo stream della pubblicazione tramite il proprio slot di replica **temporaneo**, che PostgreSQL elimina alla chiusura della connessione, in modo che un'istanza che si arresta in modo anomalo non possa lasciare uno slot residuo a trattenere i file WAL fino all'esaurimento del disco. Una riconnessione avvia un nuovo slot e ogni sottoscrizione esegue un refetch, poiché ciò che è stato confermato nell'intervallo non viene replicato.
- Una volta aperto lo stream, un avvio che esegue sia il provisioning che il consumo rimuove i trigger di acquisizione, analogamente a quanto fa `off`, ma solo quando nessun'altra istanza è ancora in ascolto su di essi. Un'istanza che è ricorsa all'acquisizione tramite trigger (ad esempio perché non ha trovato slot di replica liberi) o una versione precedente ancora attiva durante un rolling deploy smetterebbe altrimenti di rilevare le scritture effettuate altrove. Ciascuna connessione realtime si identifica tramite `application_name` (`rebase-realtime:<instance>:cdc`, `:wal` o `:entity`), consentendo all'avvio di leggere `pg_stat_activity` per verificare chi è ancora in ascolto. La connessione di una versione precedente, priva di suffisso, viene considerata in ascolto. Finché qualcuno è in ascolto, o qualora non sia possibile eseguire la verifica, i trigger rimangono e vengono mantenuti aggiornati. Ogni cinque minuti l'istanza controlla di nuovo e li rimuove quando non risulta più nessuno in ascolto. Un processo che esegue unicamente il provisioning, come il job di migrazione di un [deployment separato](/docs/deployment/split-processes/), mantiene i trigger a beneficio dei consumer che non possono effettuare lo streaming e ripiegano su di essi.

I writer mantengono la loro massima velocità durante i picchi, ma un singolo WAL sender decodifica ogni slot; di conseguenza, superate continuativamente diverse migliaia di scritture al secondo, gli eventi potrebbero arrivare in ritardo. Un ruolo con privilegi di `REPLICATION` può leggere ogni riga di una tabella pubblicata tramite un proprio slot; lo stream rimane confinato all'interno del server e i sottoscrittori continuano a rileggere ciascuna riga in base al proprio RLS.

## Requisiti e note

- Il CDC richiede una stringa di connessione diretta (`DATABASE_DIRECT_URL`, l'opzione `directConnectionString` dell'adapter o la connessione primaria) per il client `LISTEN`: i pooler di connessioni in transaction mode non supportano sessioni `LISTEN` persistenti.
- I trigger vengono installati solo sulle tabelle servite dal backend e sulle tabelle di giunzione delle rispettive relazioni molti-a-molti. Le scritture su tabelle non mappate vengono ignorate.
- Una tabella servita che non è stata ancora creata viene ignorata con un avviso, senza bloccare il CDC per le altre.

## Passaggi successivi

- [Realtime & WebSocket](/docs/backend/realtime) — sottoscrizioni, canali e presence, alimentati da questi eventi.
- [Realtime tra istanze](/docs/backend/realtime-transports) — il bus che propaga le modifiche tra i processi del server.
