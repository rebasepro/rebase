---
sourceHash: 1030bf24935489a6
slug: it/docs/troubleshooting
title: Risoluzione dei problemi
description: Gli errori che impediscono l'avvio o il funzionamento di un backend Rebase — un database irraggiungibile, credenziali errate, un'estensione mancante, un rifiuto RLS, schema drift, una porta occupata, una funzione che non si carica — e come si presenta ciascuno di essi.
---

Gli errori che impediscono a un backend Rebase di avviarsi o gestire richieste, come appare ciascuno di essi sullo schermo e cosa fare per risolverlo.

L'avvio fallisce in modo evidente e totale. Se il database non è raggiungibile, le credenziali sono errate o lo schema della collection non può essere applicato, `initializeRebaseBackend` genera un'eccezione, non viene servita alcuna richiesta e il processo termina con codice di uscita `1`. Non esiste una modalità degradata: un server che si avvia rispondendo al login mentre ogni route `/api/data/*` fallisce è più difficile da diagnosticare rispetto a uno che non si avvia affatto.

Quindi il primo punto in cui guardare è sempre l'ultima riga del log prima dell'uscita.

## Leggere un errore di avvio

Ogni errore del database visualizzato è un wrapper. Drizzle rilancia i fallimenti delle query come `Failed query: …` con uno stack trace attraverso i propri elementi interni, e la frase che spiega cosa non va si trova al di sotto, in `.cause` — oppure all'interno di un `AggregateError` quando un host dual-stack ha tentato diversi indirizzi.

Il runtime lo scompatta per te. Un fallimento all'avvio registra nei log:

- una **diagnosi riquadrata** che indica l'host, la porta e la soluzione, e
- righe `caused by:` che riportano la catena, terminando con il motivo fornito dal sistema operativo o da Postgres.

Se stai leggendo i log in formato JSON (`NODE_ENV=production`), la stessa catena si trova sotto `error.cause`, con `code`, `address` e `port` su ciascun collegamento.

### `Failed query: [redacted]`

Non si tratta di una riga di log troncata. Drizzle costruisce ogni errore di query come `Failed query: <sql>` seguito dai valori associati, quindi l'istruzione e i suoi parametri — un indirizzo email, un hash della password — viaggiano all'interno del messaggio e dello stack trace di qualsiasi cosa il driver rilanci. Il logger rimuove quella sezione da ogni riga che scrive e stampa `[redacted]` al suo posto.

L'istruzione SQL è comunque raramente la risposta: il motivo si trova nelle righe `caused by:` sottostanti. Quando ne hai bisogno, imposta `REBASE_LOG_RAW_QUERIES=true` in fase di sviluppo e l'SQL verrà stampato. Questa variabile viene ignorata al di fuori dell'ambiente di sviluppo, quindi una variabile propagata per errore in produzione non potrà mostrare dati oscurati.

## Il database non è in esecuzione

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌  Cannot connect to PostgreSQL at 127.0.0.1:5432
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  The driver said: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)
```

Nessun servizio è in ascolto su quell'indirizzo. Avvia il database:

```bash
docker compose up -d db       # the service a Rebase scaffold ships
brew services start postgresql@18
```

Oppure esegui `rebase dev` senza alcun `DATABASE_URL`, che avvierà per te un database PGlite gestito senza richiedere alcuna installazione.

Se l'host e la porta nel riquadro non sono quelli previsti, `DATABASE_URL` in `.env` non è quello letto dal processo — controlla la presenza di un secondo file `.env`, una variabile di shell già esportata o un container avviato prima della modifica.

## La password o il nome del database sono errati

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` indica una password errata, `28000` un ruolo che non può connettersi da qui e `3D000` un database inesistente. Tutti e tre sono fatti certi riguardanti la stringa di connessione: riprovare produrrà la stessa risposta, quindi l'avvio fallisce immediatamente invece di segnalare un pool che "potrebbe ripristinarsi".

Controlla le credenziali in `DATABASE_URL`. Una password contenente `@`, `/`, `?` o `#` deve essere codificata in percent-encoding — una password non codificata rimodella silenziosamente l'URL e l'host a cui tenterai di connetterti non sarà quello specificato.

## `type "vector" does not exist`

pgvector è un'estensione del server, quindi Rebase la installa solo dove il progetto lo autorizza esplicitamente. Dichiarala in `config/resources.ts`:

```ts
database({ extensions: ["vector"] })
```

Il database richiede inoltre un'immagine che includa la libreria. L'immagine di scaffolding `pgvector/pgvector:pg18` la include; una standard `postgres:18` no. Se l'installazione stessa viene rifiutata (`extension "vector" is not available` o un errore di autorizzazione), la configurazione è già corretta e ciò che manca è la libreria sul server oppure un ruolo autorizzato a eseguire `CREATE EXTENSION vector;`.

## Il database ha rifiutato l'istruzione

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Può indicare due problemi distinti, e il messaggio li differenzia:

- **Una policy di row-level security (RLS) ha rifiutato la riga.** Il sistema di controllo accessi sta funzionando; il chiamante ha richiesto qualcosa che le sue policy non consentono. Controlla le `securityRules` della collection ed esegui `npx @rebasepro/rls-check` per un controllo in sola lettura di ciò che il database applicherà effettivamente.
- **Al ruolo manca un `GRANT`.** Nulla nella richiesta potrà risolvere il problema — il ruolo di connessione non può interagire affatto con la tabella. Questo è un problema di deployment.

Una lettura esclusa da RLS non è un errore: le righe vengono filtrate e si ottiene una pagina vuota. Se una collection risulta vuota per un utente autenticato che dovrebbe visualizzare le righe, il punto da verificare è la policy, non la query.

## `SCHEMA_DRIFT` — una tabella o una colonna non esiste

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

Il codice e il database non concordano. In fase di sviluppo:

```bash
rebase db push        # apply the collections to the database
rebase doctor         # the full three-way drift report
```

Su un tenant Cloud gestito, `db push` non può raggiungere il database — il runtime applica invece lo schema all'avvio, quindi esegui un nuovo deployment anziché il push.

Se una tabella esiste ma una colonna no, la causa abituale è un file di collection modificato senza essere rigenerato: esegui `rebase schema generate` e fai nuovamente il push.

## La porta è già in uso

```
Port 3001 is in use — trying 3002.
```

In dev viene associata la porta libera successiva con una notifica. Il messaggio è importante perché tutto il resto — il `VITE_API_URL` del frontend, un segnalibro, un comando `curl` — punta ancora alla vecchia porta. La causa più frequente è un'istanza precedente di `rebase dev` che occupa ancora il socket.

Passa `--port` per fissarne una, oppure arresta l'altro processo. In produzione non vengono effettuati tentativi successivi: la porta configurata è vincolante ed `EADDRINUSE` è un errore fatale.

## Il backend è andato in crash e `rebase dev` è rimasto in esecuzione

Un backend che genera un'eccezione all'avvio non arresta il watcher: stampa lo stack trace e attende una modifica ai file. `rebase dev` segnala questo:

```
  ✗ The backend crashed on startup.
    Fix the error above; the watcher restarts it on the next change.
```

L'errore sovrastante è quello effettivo. Le cause più comuni sono un errore di sintassi in un file di collection, un'importazione non risolta e un `DATABASE_URL` che punta a una risorsa inesistente.

## Una custom function non viene servita

Le funzioni vengono caricate da `backend/functions` all'avvio e un file che non si carica viene **ignorato, non è fatale** — il server si avvia senza di esso. Il sintomo è quindi un errore 404 su una route appena scritta, e la spiegazione si trova due righe prima nel log di avvio:

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

Le cause abituali: una dipendenza importata ma non presente in `package.json`, un'importazione relativa priva di estensione (`./util` anziché `./util.js` — il progetto è ESM, quindi l'estensione è obbligatoria) e un file che esporta qualcosa di diverso da un'app Hono. Scrivi le funzioni con `defineFunction(...)` da `@rebasepro/server/functions` per rilevare quest'ultimo caso come errore di compilazione — usa quel sottopercorso, non la root del pacchetto, affinché la funzione rimanga portabile.

Le sottodirectory non vengono scansionate. `functions/admin/users.ts` viene segnalato come elemento ignorato anziché essere servito.

Una volta avviato il server, una funzione che genera un'eccezione al momento della richiesta risponde con l'envelope JSON di errore e registra il motivo nei log; una funzione che non risponde mai viene interrotta dopo `REBASE_FUNCTIONS_TIMEOUT_MS` e restituisce `504 FUNCTION_TIMEOUT`.

## Il servizio è attivo? `/livez` e `/health`

| Percorso | Accede al database | Risposta |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` mentre il processo è in esecuzione. Utilizzalo per una liveness probe. |
| `/health` | Sì, ogni data source | `200 {"status":"ok"}` quando ogni data source configurato risponde; `503 {"status":"degraded"}` quando uno non risponde. Utilizzalo per una readiness probe. |

Non impostare una liveness probe su `/health`: un problema temporaneo del database indurrebbe l'orchestratore a terminare un processo altrimenti integro, trasformando un breve disservizio in un ciclo continuo di riavvii.

L'endpoint `/health` non richiede autenticazione, quindi al di fuori dello sviluppo restituisce solo l'esito e quale data source risulta degradato, e nient'altro. Il testo dell'errore generato dal driver — che include host, porta, nome del database e ruolo — viene inviato ai log.

## Errori successivi all'avvio

Ogni errore dell'API restituisce lo stesso envelope e include un `code`. Il [riferimento ai codici di errore](/docs/backend/errors/) elenca tutti i codici con il relativo stato e la soluzione.

## Passaggi successivi

- [Codici di errore](/docs/backend/errors/) — ogni `code` che l'API può restituire, con lo stato e la soluzione.
- [Ambiente e configurazione](/docs/getting-started/configuration/) — ogni variabile letta dal runtime e quelle senza le quali l'ambiente di produzione rifiuta l'avvio.
- [Panoramica del backend](/docs/backend/) — cosa esegue l'avvio, in ordine, e a quale domanda risponde ciascuna probe.

---
