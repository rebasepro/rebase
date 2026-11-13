---
sourceHash: ff162864c3d1600b
slug: it/docs/troubleshooting
title: Risoluzione dei problemi
description: Gli errori che impediscono a un backend Rebase di avviarsi o gestire le richieste — un database irraggiungibile, credenziali errate, un'estensione mancante, un rifiuto RLS, disallineamento dello schema, una porta occupata, una funzione che non si carica — e come si presenta ciascuno di essi.
---

Gli errori che impediscono a un backend Rebase di avviarsi o gestire le richieste, come si
presenta ciascuno di essi sullo schermo e cosa fare per risolverlo.

L'avvio fallisce in modo evidente e totale. Se il database non è raggiungibile, le
credenziali sono errate, o lo schema non può essere compilato o applicato,
`initializeRebaseBackend` genera un'eccezione, non viene gestita alcuna richiesta e il processo termina con codice di uscita `1`.
Non esiste una modalità degradata: un server che si avvia rispondendo all'autenticazione mentre ogni
rotta `/api/data/*` fallisce è più difficile da diagnosticare rispetto a uno che non si avvia affatto.

Quindi, il primo punto da controllare è sempre l'ultima voce nel log prima dell'uscita.

## Leggere un errore di avvio

Ogni errore del database visualizzato è un wrapper. Drizzle rilancia i fallimenti delle query come
`Failed query: …` con uno stack trace che attraversa i propri componenti interni, e la frase che
spiega il problema si trova al di sotto, in `.cause` — oppure all'interno di un `AggregateError`
quando un host dual-stack ha tentato diversi indirizzi.

Il runtime lo spacchetta per te. Un errore di avvio registra:

- una **diagnosi riquadrata** che indica l'host, la porta e la soluzione, e
- righe `caused by:` che riportano la catena, terminando con il motivo fornito dal
  sistema operativo o da Postgres.

Se stai leggendo log in formato JSON (`NODE_ENV=production`), la stessa catena si trova sotto
`error.cause`, con `code`, `address` e `port` su ciascun passaggio.

### `Failed query: [redacted]`

Non si tratta di una riga di log troncata. Drizzle compone ogni errore di query come
`Failed query: <sql>` seguito dai valori associati, quindi l'istruzione e i suoi
parametri — un indirizzo email, un hash della password — viaggiano all'interno del messaggio e
dello stack di qualsiasi cosa il driver rilanci. Il logger rimuove quella sezione da
ogni riga che scrive e stampa `[redacted]` al suo posto.

L'istruzione raramente rappresenta la soluzione: il motivo si trova nelle
righe `caused by:` sottostanti. Quando ne hai effettivo bisogno, imposta `REBASE_LOG_RAW_QUERIES=true` in
ambiente di sviluppo e l'SQL verrà stampato. Questa variabile viene ignorata al di fuori dell'ambiente di sviluppo,
quindi una variabile che trapela in un ambiente di produzione non potrà rendere visibile
nulla in quel contesto.

## Il database non è in esecuzione

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌  Cannot connect to PostgreSQL at 127.0.0.1:5432
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  The driver said: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)
```

Non c'è nulla in ascolto su quell'indirizzo. Avvia il database:

```bash
docker compose up -d db       # the service a Rebase scaffold ships
brew services start postgresql@18
```

Oppure esegui `rebase dev` senza alcun `DATABASE_URL`, che avvierà un database PGlite
gestito al posto tuo e non richiede nulla di installato.

Se l'host e la porta nel riquadro non sono quelli previsti, `DATABASE_URL` in
`.env` non è quello letto dal processo — controlla se è presente un secondo file `.env`, una variabile
di shell già esportata o un container avviato prima della modifica.

## La password o il nome del database sono errati

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` indica una password errata, `28000` un ruolo a cui non è consentito connettersi da qui, e
`3D000` un database inesistente. Tutti e tre sono fatti accertati riguardanti la
stringa di connessione: riprovare genera la stessa risposta, quindi l'avvio fallisce immediatamente
piuttosto che segnalare un pool che "potrebbe ripristinarsi".

Verifica le credenziali in `DATABASE_URL`. Una password contenente `@`, `/`, `?` o
`#` deve essere codificata in formato percentuale (percent-encoded) — un carattere non codificato altera
silenziosamente l'URL e l'host a cui finisci per connetterti non sarà quello scritto.

## `SchemaDefinitionError` — lo schema non compila

<span class="since-badge" data-since="0.31">Since 0.31</span>

L'avvio, `rebase db generate`, `db push`, `generate-sdk` e `doctor` compilano
le tabelle esportate da `backend/schema/index.ts` prima di qualsiasi altra operazione, e si arrestano quando una qualsiasi
tabella non compila — assenza di `rls`, `"inherit"` senza `defaultRls`, una relazione
verso una tabella non esportata dall'index, un `defineTable` in un file adiacente che
l'index tralascia — indicando ogni tabella, chiave e problema contemporaneamente. Correggi ciascuno di essi;
`rebase verify` segnala lo stesso elenco senza avviare nulla.

## `config/collections` viene rifiutato

<span class="since-badge" data-since="0.31">Since 0.31</span>

Un progetto precedente alla versione 0.31 mantiene il proprio modello dati in `config/collections`, che
non viene più letto da nulla: il runtime, ogni comando CLI e un bundle format-2
vengono rifiutati mostrando `rebase migrate collections-to-tables` nel messaggio. Esegui il comando
su un albero git pulito; riscriverà il progetto come `backend/schema` e
`frontend/src/cms`, verificherà che l'SQL generato sia invariato e mostrerà i passaggi
rimanenti da eseguire. Consulta [Upgrading 0.30 to 0.31](https://rebase.pro/docs/upgrading/0-30-to-0-31/).

## `type "vector" does not exist`

pgvector è un'estensione del server, pertanto Rebase la installa solo se un progetto dichiara
che è consentito farlo. Dichiarala in `backend/resources.ts`:

```ts
database({ extensions: ["vector"] })
```

Il database richiede inoltre un'immagine che includa la libreria. Quella dello scaffold
`pgvector/pgvector:pg18` la include; una versione standard `postgres:18` no. Se l'installazione
stessa viene rifiutata (`extension "vector" is not available`, o un errore di permessi),
la configurazione è già corretta e ciò che manca è la libreria sul
server oppure un ruolo autorizzato a eseguire `CREATE EXTENSION vector;`.

## Il database ha rifiutato l'istruzione

<span class="since-badge" data-since="0.31">Since 0.31</span>

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Due problemi differenti si manifestano con questo codice, e il messaggio
li distingue:

- **Una policy di sicurezza a livello di riga (RLS) ha rifiutato la riga** — il messaggio sopra. Il
  sistema di controllo degli accessi funziona regolarmente; il chiamante ha richiesto qualcosa non
  consentito dalle sue policy. Controlla la proprietà `rls` della tabella in `backend/schema`, ed esegui
  `npx @rebasepro/rls-check` per un audit in sola lettura di ciò che il database
  effettivamente applicherà.
- **Il ruolo non dispone di un `GRANT`.** Il messaggio indica invece l'oggetto:

  ```
  DB_PERMISSION_DENIED — Permission denied by the database: the role this request
  runs as has no privilege on schema "rebase". That is a missing GRANT to that
  role, not a row-level security policy.
  ```

  Nessuna modifica alla richiesta sarà d'aiuto — il ruolo con cui vengono eseguite le richieste non può toccare
  minimamente quell'oggetto. Il server assegna i permessi al proprio ruolo di richiesta sugli schemi che
  predispone all'avvio; un oggetto creato al di fuori di esso (da un altro ruolo, o in uno
  schema non dichiarato da alcuna tabella) necessita di un proprio `GRANT`. Questo è un
  problema di deployment.

Una lettura esclusa da RLS non è un errore: le righe vengono filtrate e si ottiene una
pagina vuota. Se una tabella risulta vuota per un utente autenticato che dovrebbe visualizzare
delle righe, il punto da verificare è la policy, non la query.

## `SCHEMA_DRIFT` — una tabella o una colonna non esiste

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

Il codice e il database non sono allineati. In ambiente di sviluppo:

```bash
rebase db push        # apply the tables to the database
rebase doctor         # the full three-way drift report
```

Su un tenant Cloud gestito, `db push` non può raggiungere il database — il runtime
applica lo schema all'avvio, quindi esegui un nuovo deployment anziché il comando push.

Se una tabella esiste ma una colonna no, la causa abituale è un file di tabella
modificato senza rigenerare: esegui `rebase schema generate` e nuovamente il push.

## `Error: EOF` da `db push` sul database gestito

```
Error: EOF
✗ atlas schema apply --to file://.rebase/sql/schema.sql --dry-run failed.
```

Il database di sviluppo gestito accetta poche connessioni per volta, e un'istanza attiva di
`rebase dev` ne trattiene alcune. Atlas, che pianifica il push, ne apre altre
due, e una è stata chiusa durante l'operazione. Non è stato applicato nulla, quindi il comando può essere
eseguito nuovamente in sicurezza; il server dev chiude le connessioni inattive dopo 30 secondi. Se continua
a fallire, arresta `rebase dev` mentre esegui il push.

Il push chiude le proprie
connessioni prima dell'avvio di Atlas, lasciando solitamente spazio sufficiente per Atlas,
e l'errore descrive l'accaduto.

## La porta è già in uso

```
Port 3001 is in use — trying 3002.
```

L'ambiente di sviluppo si collega alla prima porta libera successiva e lo notifica. Il messaggio è importante perché tutto
il resto — il parametro `VITE_API_URL` del frontend, un segnalibro, un comando `curl` — punta
ancora alla porta precedente. La causa abituale è un'istanza precedente di `rebase dev` che trattiene
ancora il socket.

Passa `--port` per fissarne una, oppure arresta l'altro processo. In produzione non sono previsti
nuovi tentativi: la porta configurata è vincolante ed `EADDRINUSE` è un errore fatale.

## Il backend è andato in crash e `rebase dev` è rimasto in esecuzione

<span class="since-badge" data-since="0.31">Since 0.31</span>

Un backend che genera un'eccezione all'avvio non arresta il watcher — stampa lo stack trace e
rimane in attesa di una modifica ai file. Quando il backend non segnala il proprio avvio entro
`REBASE_DEV_READY_TIMEOUT_MS` (30 secondi per impostazione predefinita), `rebase dev` segnala quanto segue:

```
  ✗ The backend has not started after 30s.
    Fix the error above; the watcher restarts it on the next change.
```

L'errore mostrato sopra è quello effettivo. Le cause più comuni sono un errore di sintassi in
un file all'interno di `backend/schema`, un import non risolto e un `DATABASE_URL` che
punta al nulla.

## Una funzione personalizzata non viene gestita

Le funzioni vengono caricate da `backend/functions` all'avvio, e un file che non riesce
a caricarsi viene **ignorato, senza causare errori fatali** — il server si avvia senza di esso. Di conseguenza, il sintomo è
un errore 404 su una rotta appena creata, e la spiegazione si trova due righe prima nel
log di avvio:

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

Le cause consuete: una dipendenza importata ma non presente in `package.json`, un import
relativo privo dell'estensione (`./util` anziché `./util.js` — il progetto utilizza
ESM, quindi l'estensione è obbligatoria), e un file che esporta qualcosa di diverso da
un'app Hono. Crea le funzioni con `defineFunction(...)` da `@rebasepro/server/functions`
per trasformare quest'ultimo caso in un errore di compilazione — utilizzando quel sotto-percorso, non la root del
pacchetto, affinché la funzione rimanga portabile.

Le sottodirectory non vengono scansionate. `functions/admin/users.ts` viene segnalato come
voce ignorata anziché essere reso disponibile.

Una volta avviato il server, una funzione che genera un'eccezione al momento della richiesta restituisce la busta
JSON di errore e registra il motivo; una funzione che non risponde mai viene interrotta allo scadere di
`REBASE_FUNCTIONS_TIMEOUT_MS` e restituisce `504 FUNCTION_TIMEOUT`.

## È attivo? `/livez` e `/health`

| Percorso | Interroga il database | Risponde |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` finché il processo è in esecuzione. Utilizzalo per una liveness probe. |
| `/health` | Sì, ogni origine dati | `200 {"status":"ok"}` quando ogni origine dati configurata risponde; `503 {"status":"degraded"}` quando una di esse non risponde. Utilizzalo per una readiness probe. |

Non associare una liveness probe a `/health`: un problema temporaneo del database indurrebbe
l'orchestratore a terminare un processo altrimenti integro, trasformando un breve disservizio in un
ciclo continuo di riavvii.

`/health` non è autenticato, pertanto al di fuori dell'ambiente di sviluppo restituisce unicamente l'esito e
quale origine dati risulta degradata, nient'altro. Il testo dell'errore originale del driver —
che cita host, porta, nome del database e ruolo — viene inviato ai log.

## Errori successivi all'avvio

Ogni errore dell'API risponde con la medesima struttura di payload e include un `code`. Il
[riferimento ai codici di errore](/docs/backend/errors/) elenca ciascuno di essi con lo stato
e la risoluzione.

## Approfondimenti

- [Codici di errore](/docs/backend/errors/) — ogni `code` che l'API può restituire, con lo stato e la correzione.
- [Ambiente e Configurazione](/docs/getting-started/configuration/) — tutte le variabili lette dal runtime e quelle senza le quali la produzione si rifiuta di avviarsi.
- [Panoramica del Backend](/docs/backend/) — le operazioni eseguite all'avvio, in ordine, e quale probe risponde a quale verifica.
