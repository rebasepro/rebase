---
sourceHash: d47ac3d32c961db1
title: Cron Job
sidebar_label: Cron Job
description: Pianifica attività in background ricorrenti con il sistema di cron job integrato di Rebase. Definisci i job come file TypeScript, monitorali in Studio e gestiscili tramite l'API REST.
---

## Panoramica

Rebase include uno **scheduler di cron job** integrato per l'esecuzione di attività ricorrenti in background: pulizia dei dati, generazione di report, controlli dello stato di integrità (health check), sincronizzazioni con API esterne e altro ancora.

I cron job seguono lo stesso pattern di **rilevamento basato su file** (file-based discovery) delle funzioni personalizzate: inserisci un file TypeScript nella tua directory `crons/`, e Rebase lo registra e lo pianifica automaticamente.

- **Zero dipendenze** — Nessuna libreria di scheduling esterna richiesta
- **API di amministrazione** — Endpoint REST per elencare, avviare, abilitare/disabilitare e visualizzare i log
- **Dashboard di Studio** — Monitora tutti i job, visualizza la cronologia delle esecuzioni e avvia le esecuzioni manualmente
- **Persistenza su database** — Log di esecuzione salvati in PostgreSQL, preservati anche dopo i riavvii
- **Cache in memoria** — Veloce buffer circolare (ring buffer con le ultime 50 esecuzioni) per la dashboard, supportato dal DB

## Definire un Cron Job

Crea un file nella tua directory `backend/crons/` che esporti come default una definizione di cron. Usa l'helper `defineCron` da `@rebasepro/server` per l'inferenza dei tipi e l'autocompletamento:

```typescript
// backend/crons/health-check.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "*/5 * * * *",     // every 5 minutes
    name: "System Health Check",
    description: "Monitors uptime and memory usage",

    async handler(ctx) {
        ctx.log("Running health check...");

        const uptime = process.uptime();
        const mem = process.memoryUsage();

        ctx.log(`Uptime: ${Math.round(uptime)}s`);
        ctx.log(`Heap: ${Math.round(mem.heapUsed / 1024 / 1024)}MB`);

        return {
            uptimeSeconds: Math.round(uptime),
            heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
        };
    },
});
```

`rebase dev` monitora la directory crons, quindi un job aggiunto mentre è in esecuzione viene registrato al reload successivo — senza riavvio. (Va precisato: la directory viene scansionata anziché importata, quindi il watcher non può dedurlo automaticamente).

:::note
`defineCron` è una funzione identità — restituisce lo stesso oggetto che le viene passato. Un normale oggetto `CronJobDefinition` esportato come default funziona in modo identico; `defineCron` fornisce semplicemente il controllo dei tipi a livello di compilazione e l'autocompletamento nell'editor.
:::

Il **nome del file** (senza estensione) diventa l'ID univoco del job — ad es., `health-check`.


## Configurazione

:::note[Dove va inserito]
**Runtime gestito** — inserisci i file in `backend/crons/`; il runtime rileva automaticamente tale directory, e `entry.crons` in `rebase.json` è necessario solo se l'hai spostata. `REBASE_CRON_SCHEDULER` in `.env` stabilisce se *questo* processo esegue i timer.

**Espulso (Ejected)** — `cronsDir` su `initializeRebaseBackend({ … })`, come mostrato sotto, oppure `crons` con i job come valori.

La mappatura completa si trova in [Panoramica del Backend](/docs/backend/#where-each-option-lives).
:::

Abilita i cron job aggiungendo `cronsDir` alla configurazione del tuo backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Tutto qui. Rebase provvederà a:

1. Scansionare la directory alla ricerca di file `.ts` / `.js`
2. Registrare ogni export di default come cron job
3. Creare automaticamente le tabelle `rebase.cron_logs`, `rebase.cron_claims` e `rebase.cron_job_state` in PostgreSQL (se il driver supporta SQL)
4. Avviare lo scheduler e inizializzare i contatori a partire dai log esistenti nel DB
5. Montare le route REST di amministrazione su `/api/admin/cron`

### I cron job come valori

`crons` accetta i job come record dall'ID del job alla definizione, accanto a `collections`. Una directory è un modo per costruirlo: `loadCrons(dir)` ne legge una esattamente in quella forma.

```typescript
import path from "path";
import { defineCron, initializeRebaseBackend, loadCrons } from "@rebasepro/server";

const nightlyReport = defineCron({
    schedule: "0 3 * * *",
    async handler({ log }) {
        log("building the report");
    }
});

await initializeRebaseBackend({ app, server, crons: { "nightly-report": nightlyReport } });
// the same as cronsDir:
await initializeRebaseBackend({ app, server, crons: await loadCrons(path.resolve(__dirname, "../crons")) });
```

Fornisci `crons` o `cronsDir`, non entrambi: l'avvio rifiuta la coppia. La compilazione del backend registra i job; ciò che avvia i loro timer è `start()`, che `initializeRebaseBackend` richiama automaticamente per te. Con [`createRebaseBackend`](/docs/backend/custom-server/) lo chiami tu stesso, nel processo che dovrebbe eseguirli. `loadCronJobsFromDirectory` e `loadCronJobsWithDiagnostics` funzionano ancora, sono deprecati e generano un unico avviso.

## Sintassi della schedulazione

Le espressioni cron utilizzano il formato standard a **5 campi**:

```
┌───────────── minute (0–59)
│ ┌─────────── hour (0–23)
│ │ ┌───────── day of month (1–31)
│ │ │ ┌─────── month (1–12)
│ │ │ │ ┌───── day of week (0–6, Sunday = 0)
│ │ │ │ │
* * * * *
```

| Espressione | Significato |
|------------|---------|
| `* * * * *` | Ogni minuto |
| `0 * * * *` | Ogni ora |
| `0 3 * * *` | Ogni giorno alle 3:00 |
| `0 0 * * 1` | Ogni lunedì a mezzanotte |
| `0 9 1 * *` | Il primo giorno di ogni mese alle 9:00 |
| `0,30 * * * *` | Ogni 30 minuti (al minuto :00 e :30) |
| `0 9-17 * * 1-5` | Ogni ora, 9:00–17:00, solo nei giorni feriali |

Valori di intervallo/passo (`*/n`), intervalli (`a-b`) ed elenchi (`a,b,c`) sono tutti supportati.

Quando sia il giorno del mese che il giorno della settimana sono vincolati, un giorno che corrisponde a uno dei due è considerato valido, come nel cron standard: `0 9 1 * 1` viene eseguito il 1° di ogni mese e ogni lunedì. Quando uno dei due campi inizia con `*`, il giorno deve soddisfare entrambi i criteri.

Una schedulazione viene confrontata con l'orologio locale del proprio fuso orario. Durante il passaggio all'ora solare o legale, ciò significa che un job a orario fisso all'interno dell'ora ripetuta (`30 2 * * *` quando gli orologi tornano indietro alle 03:00) viene eseguito in entrambi i passaggi di quell'ora, mentre uno all'interno dell'ora saltata, quando gli orologi avanzano, non viene eseguito quel giorno.

## Riferimento di CronJobDefinition

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // IANA zone the schedule is read in, e.g. "Europe/Madrid". Without it the
    // schedule is read in the host's own zone — UTC in nearly every container,
    // yours on a laptop — so name it. An unknown zone is refused when the job
    // loads rather than read as local time.
    timezone?: string;

    // Human-readable name shown in Studio (default: the job id, the file's name)
    name?: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job runs (default: true). A pause or a resume from Studio
    // or the admin API overrides it, for every process, until reset.
    enabled?: boolean;

    // Max execution time in seconds (default: 300). Infinity means no
    // timeout; 0, a negative number or NaN is refused when the job loads.
    timeoutSeconds?: number;

    // How far back to look on startup for a slot that elapsed while no
    // instance was ticking (default: off). See "Cron across instances".
    catchUpWindowSeconds?: number;

    // The function to run on each tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Contesto dell'Handler

Ogni handler riceve un `CronJobContext` contenente metodi di utilità e l'istanza del client Rebase:

```typescript no-verify
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The slot this run fires for: a catch-up run gets the slot it
    // missed, a manual trigger the moment it started
    scheduledAt: Date;

    // Logger — lines appear in Studio, the logs API and the server log
    log: (...args: unknown[]) => void;

    // Aborted when the run exceeds `timeoutSeconds`, or when a shutdown's
    // wait for it runs out
    signal: AbortSignal;

    // The server-side Rebase singleton — the same object `import { rebase }
    // from "@rebasepro/server"` returns, and the same one `defineFunction`
    // hands its callback.
    rebase: RebaseServerClient;
}
```

Usa `ctx.log()` per emettere output strutturato. Queste righe vengono acquisite nel log di esecuzione e risultano visibili in Studio e tramite l'API REST. Ogni riga viene inoltre scritta nel log del server al livello `info` con un campo `cron` contenente l'ID del job, comparendo ovunque venga raccolto l'output del container, inclusi i log di debug di Rebase Cloud. Tale copia viene oscurata (redacted) come avviene per le righe di log del server stesso: i valori di chiavi quali `password` o `apiKey`, così come l'SQL e i parametri di una query non riuscita, vengono sostituiti. Il log di esecuzione memorizza invece la riga senza tale oscuramento.

Il log di esecuzione conserva le prime 500 righe di un'esecuzione o fino a 64 KB, a seconda di quale limite venga raggiunto per primo, aggiungendo poi una riga che indica quante altre righe erano presenti: `… 9500 more lines not kept — see the server log`. Il log del server riceve invece tutte le righe. Un job che registra una riga per ogni elemento elaborato deve mettere in conto che la sua cronologia mostrerà solo l'inizio dell'esecuzione.

### `ctx.signal` — interrompere il lavoro quando l'esecuzione si ferma

Il timeout interrompe l'*esecuzione*: lo scheduler smette di attendere e registra un fallimento. Non interrompe però l'handler. Passa `ctx.signal` a qualsiasi funzione che ne accetti uno, e il lavoro si interromperà di conseguenza:

```typescript no-verify
export default defineCron({
    name: "Sync inventory",
    schedule: "*/15 * * * *",
    timeoutSeconds: 60,
    async handler({ signal, log }) {
        const res = await fetch("https://supplier.example.com/stock", { signal });
        log(`fetched ${res.status}`);
    }
});
```

Senza di esso, un job il cui timeout coincide con il suo intervallo perde una richiesta abbandonata per ogni tick — in modo invisibile, poiché ogni esecuzione risulta già registrata come fallita.

:::note[`ctx.client` è stato rimosso]
Era un nome alternativo per `ctx.rebase`, e il suo tipo riesponeva `client.data` — l'alias che `RebaseServerClient` omette deliberatamente affinché il piano con privilegi abbia un unico nome. Un lettore che avesse appreso `client.data` qui l'avrebbe poi portato in un callback di collection, dove `context.data` è il piano con *ambito utente* (user-scoped): stessa denominazione, privilegi opposti. Usa invece `ctx.rebase.dataAsAdmin`.
:::

### Interagire con il database e i servizi tramite `ctx.rebase`

`ctx.rebase.dataAsAdmin` è il data plane con ambito amministrativo (admin-scoped). Un cron non ha un utente associato alla richiesta, quindi qui non esiste un'alternativa con ambito utente — definisci autonomamente i filtri di ogni query.

:::caution[L'ambito admin non bypassa le policy RLS]
`dataAsAdmin` viene configurato una volta sola, all'avvio, come `{ uid: "service", roles: ["admin"] }`. Ogni lettura e scrittura viene comunque eseguita all'interno di una transazione che ha eseguito `SET LOCAL ROLE rebase_user` con `app.uid = 'service'`, e **le tue policy vengono valutate** — a fronte di tale identità. Soddisfa le policy predefinite integrate tramite il loro ramo `rolesOverlap(['admin'])`, ed è per questo che la differenza si nota raramente. Diventa evidente quando scrivi policy personalizzate: `policy.serverContext()` compila in `rebase.uid() IS NULL` ed è quindi **false** in questo contesto; pertanto, una collection con `disableDefaultPolicies: true` la cui unica regola è `serverContext()` rifiuterà queste scritture e restituirà zero righe — HTTP 200, vuoto — per queste letture.

`rebase.sql()` costituisce *effettivamente* un bypass incondizionato: connessione come proprietario (owner), nessuna policy applicata.
:::

```typescript
// backend/crons/expire-users.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver. `table<Row>(slug)`
        // gives the query builder the row type — `where` keys are checked
        // against it. Every filter is an `[operator, value]` tuple; a bare
        // value is passed straight through and builds a malformed query.
        const users = ctx.rebase.dataAsAdmin.table<{
            id: string;
            email: string;
            trial_status: string;
            trial_ends_at: string;
            status: string;
        }>("users");

        const { data: trials } = await users.find({
            where: {
                trial_status: ["==", "active"],
                trial_ends_at: ["<", new Date().toISOString()]
            }
        });

        ctx.log(`Found ${trials.length} users with expired trials.`);

        for (const user of trials) {
            await users.update(user.id, {
                trial_status: "expired",
                status: "disabled"
            });
            
            // Send email notification using the Rebase email service
            await ctx.rebase.email.send({
                to: user.email,
                subject: "Your trial has expired",
                html: "<p>Please upgrade your subscription to continue.</p>"
            });
        }
    }
});
```

:::tip
L'handler può restituire qualsiasi valore serializzabile in JSON. Verrà memorizzato nella voce di log come `result` e visualizzato nella cronologia delle esecuzioni di Studio.
:::

## API REST

L'elenco, l'avvio, la messa in pausa e la ripresa dei job tramite HTTP, nonché `client.cron` dell'SDK tipizzato, sono descritti in [API dei Cron Job](/docs/backend/cron-jobs-api/).

## Dashboard di Studio

Quando i cron job sono configurati, lo strumento **Cron Jobs** compare in Rebase Studio sotto **Compute**, accanto alla console JS. La dashboard offre:

- **Elenco dei job** — Tutti i job registrati con indicatori di stato in tempo reale
- **Pannello dei dettagli** — Schedulazione, esecuzione successiva/precedente, durata e informazioni sugli errori
- **Cronologia delle esecuzioni** — Voci di log espandibili con output acquisito e risultati
- **Avvio manuale** — Esegui qualsiasi job su richiesta con un solo clic. Il pannello attende il completamento dell'esecuzione e ne mostra l'esito: un'esecuzione fallita ne mostra l'errore
- **Abilita/disabilita** — Metti in pausa e riprendi i job senza riavviare il server, per tutti i processi contemporaneamente; la pausa persiste tra riavvii e distribuzioni
- **Job non disponibili** — ogni job rifiutato dallo scheduler, con la relativa schedulazione e motivazione, e quanti file di cron non sono stati caricati. Nessuno di essi viene pianificato; vedi [Job non disponibili](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

La dashboard si aggiorna automaticamente ogni 15 secondi.

Il pannello mostra le stesse informazioni indipendentemente da quale processo lo serva. Un job in esecuzione su un altro processo viene mostrato come in esecuzione.
Su ogni processo dotato di store, il conteggio delle esecuzioni, il conteggio dei fallimenti e l'ultima esecuzione vengono letti dal database, in cui vengono conteggiate le esecuzioni di tutti i processi. I contatori interni di un processo contengono solo le esecuzioni da esso effettuate: il ruolo `api` accanto a un worker non esegue nulla, e di due repliche che effettuano entrambe la schedulazione, nessuna delle due vede gli slot reclamati dall'altra. Solo quando il database non è leggibile la scheda ricorre come fallback ai contatori interni di questo processo, con un avviso nel log del server.

I conteggi sono globali (all-time); la cronologia copre gli ultimi 30 giorni. La riga di ciascuna esecuzione in `rebase.cron_logs` viene eliminata 30 giorni dopo il suo avvio tramite una pulizia oraria, mentre i conteggi di esecuzioni e fallimenti continuano a tenerne traccia. Un'esecuzione saltata conta come un'esecuzione, come sempre: costituisce una riga della cronologia.

## Validazione della schedulazione e parsing dell'AST

All'inizializzazione del backend, Rebase analizza tutte le schedulazioni cron registrate utilizzando un espansore cron basato su JS privo di dipendenze esterne:
- **Controllo della sintassi**: Verifica che la stringa contenga esattamente 5 campi separati da spazi (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Espansione degli intervalli**: Scompone i passi (`*/15`), gli intervalli (`9-17`) e gli elenchi separati da virgole (`0,30`) in array espliciti di interi validi mappati sui rispettivi limiti (ad es., minuti `0-59`, ore `0-23`, mesi `1-12`).
- **Token interi**: Ogni numero, limite di intervallo e passo deve essere un numero intero: `5abc`, `*/5x` e `1.5` vengono rifiutati, così come un intervallo al contrario (`5-1`).
- Se una qualsiasi espressione cron non supera la validazione, Rebase rifiuta la definizione, registra un errore all'avvio e non registra il job per prevenire errori di esecuzione a runtime.

---

## Dietro le quinte: correzione del Clock-Drift

Gli scheduler standard basati su intervalli (come `setInterval`) subiscono slittamenti nel tempo (drift) e causano picchi significativi di CPU a causa dei ritardi di scheduling dell'event loop a livello di sistema operativo. Per garantire la precisione dell'esecuzione, Rebase implementa un **loop dinamico di calcolo dell'orario target**:
1. **Calcolo dei candidati**: Al completamento di un job o all'avvio dello scheduler, Rebase calcola il timestamp esatto del minuto candidato corrispondente *successivo*.
2. **Sleep dinamico**: Calcola la differenza in millisecondi (`nextRun.getTime() - now.getTime()`) e pianifica un singolo `setTimeout`.
3. **Soglia di sicurezza contro il drift**: Viene applicato un buffer minimo di sleep (`MIN_SCHEDULE_INTERVAL_MS`) di **5.000 ms**. Se un tick dello scheduler si conclude in modo estremamente rapido, questa soglia impedisce una doppia attivazione quasi istantanea.
4. **Supporto per lo shutdown controllato**: Gli handle dei timer vengono esplicitamente scollegati dall'event loop di Node.js tramite `timer.unref()`, assicurando che gli scheduler di cron in background non blocchino la corretta terminazione dei processi durante i deployment.

---

## Più di un processo

Ogni processo il cui scheduler è attivo arma gli stessi timer; il database decide quale di essi eseguirà ciascuno slot. Come uno slot venga eseguito una sola volta, come venga recuperato uno slot perso a causa di un riavvio, come una pausa raggiunga ogni replica e perché un avvio manuale non venga mai eseguito contemporaneamente a una schedulata sono approfonditi in [Cron su più istanze](/docs/backend/cron-across-instances).

---

## Timeout e isolamento degli errori

- **Competizione forzata del timeout (Timeout Race)**: I blocchi di esecuzione sono racchiusi in un `Promise.race` con un timer di timeout derivato da `timeoutSeconds` (valore predefinito: `300` secondi / 5 minuti; `Infinity` per nessun timeout). Se l'handler si blocca oltre questa soglia, `ctx.signal` viene interrotto (aborted) e la promise viene rifiutata, generando l'errore:
  `Error: Cron job "<id>" timed out after <N>ms`
  L'abort è la parte che interrompe il *lavoro*; il rifiuto interrompe solo l'attesa da parte dello scheduler. Un handler che ignora `ctx.signal` continuerà a essere eseguito oltre il termine della propria esecuzione.
- **Shutdown**: `backend.shutdown()` attende il completamento di un'esecuzione in corso, entro lo stesso limite di tempo previsto per la coda dei job (due terzi del timeout di arresto). Per un'esecuzione ancora in corso allo scadere del tempo, viene chiamato l'abort su `ctx.signal` e l'esecuzione viene registrata come fallita, con la relativa motivazione. Il suo slot rimane assegnato (claimed), in modo che nessun'altra istanza lo riesegua.
- **Try/Catch a prova di errore**: Ogni job handler viene eseguito all'interno di un wrapper isolato. Eventuali eccezioni non rilevate vengono intercettate, registrando il messaggio dell'errore (oscurato) come stringa, impostando lo stato del job su `"error"` e aggiornando il contatore dei fallimenti del job. Un crash all'interno di un singolo task cron non manderà mai in crash il loop dello scheduler né il server web HTTP primario basato su Hono.
- **Buffer circolare in memoria**: Lo scheduler mantiene un ring buffer contenente le ultime **50 esecuzioni** per ciascun job. Questo buffer è conservato in memoria per consentire letture quasi istantanee da Rebase Studio.

---

## Schema di persistenza sul database

Quando sono attivi adapter di database che supportano SQL (ad es. PostgreSQL), Rebase predispone la tabella `rebase.cron_logs`:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.cron_logs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL,
    duration_ms  INTEGER NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT true,
    error        TEXT,                                 -- The error's message, redacted
    result       JSONB,                                -- Return value of handler
    logs         JSONB,                                -- Ring buffer array of ctx.log outputs
    manual       BOOLEAN NOT NULL DEFAULT false        -- True if triggered from Studio/REST
);

ALTER TABLE rebase.cron_logs ADD COLUMN IF NOT EXISTS counted BOOLEAN;  -- the run is in the counters below

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_started ON rebase.cron_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_cron_logs_uncounted ON rebase.cron_logs(job_id, started_at DESC) WHERE counted IS NULL;

CREATE TABLE IF NOT EXISTS rebase.cron_job_state (
    job_id            TEXT PRIMARY KEY,
    enabled           BOOLEAN,       -- NULL: follow the job's own `enabled`
    updated_at        TIMESTAMPTZ,   -- when `enabled` was last set, and by whom
    updated_by        TEXT,
    running_until     TIMESTAMPTZ,   -- the run lease: live while in the future
    running_by        TEXT,
    total_runs        BIGINT NOT NULL DEFAULT 0,   -- all-time, skips included
    total_failures    BIGINT NOT NULL DEFAULT 0,
    last_run_at       TIMESTAMPTZ,                 -- the most recently started run
    last_duration_ms  INTEGER,
    last_success      BOOLEAN,
    last_error        TEXT
);
```

Ciascuna di esse viene creata all'avvio se assente, pertanto un database preesistente la acquisirà alla distribuzione successiva. Nessuna di esse è una collection e il ruolo dell'utente finale `rebase_user` non ha alcun privilegio su di esse: una tabella `cron_job_state` scrivibile permetterebbe a un utente autenticato di mettere in pausa un job per chiunque, oppure di trattenerne il lease impedendone l'esecuzione.

La riga di un'esecuzione e il relativo conteggio vengono scritti in un'unica istruzione: l'inserimento in `cron_logs` e un upsert dei contatori del job in `cron_job_state`. L'elenco legge una sola riga di `cron_job_state` per job, a prescindere dall'estensione della cronologia, e lo stesso fa lo scheduler quando inizializza `totalRuns` e `totalFailures` all'avvio. La scrittura dei log non blocca l'esecuzione; se una fallisce, lo scheduler registra l'errore e prosegue, mantenendo comunque l'esecuzione nel ring buffer in memoria.

Una volta ogni ora e all'avvio, lo scheduler elimina le righe della cronologia più vecchie di 30 giorni e conteggia le esecuzioni non ancora conteggiate, entrambe in batch da 5.000 righe. Una cronologia scritta prima della versione 0.24 viene conteggiata dalla prima di queste operazioni di pulizia, al di fuori del percorso di avvio. Fino al termine dell'operazione, la visualizzazione dell'elenco aggiunge ai contatori le esecuzioni non ancora conteggiate, evitando così discrepanze nei numeri durante l'aggiornamento. Lo stesso vale per un'esecuzione registrata da un server precedente durante un rolling deploy.

## Esempio: Job di pulizia giornaliera

```typescript
// backend/crons/cleanup-sessions.ts
import type { CronJobDefinition } from "@rebasepro/types";
import { rebase } from "@rebasepro/server";

const job: CronJobDefinition = {
    schedule: "0 3 * * *",  // daily at 3 AM
    name: "Cleanup Expired Sessions",
    description: "Removes user sessions older than 30 days",

    async handler(ctx) {
        ctx.log("Starting session cleanup...");

        // Admin-scoped data access — see `ctx.rebase` above.
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
        const expired = await ctx.rebase.dataAsAdmin.sessions.findAll({
            where: { last_seen_at: ["<", cutoff] }
        });
        for (const session of expired) {
            await ctx.rebase.dataAsAdmin.sessions.delete(session.id as string);
        }

        ctx.log(`Cleaned up ${expired.length} expired sessions`);

        return { deletedSessions: expired.length };
    },
};

export default job;
```

## I cron nel grafo delle risorse

Ogni file di cron è anche una dichiarazione. `rebase resources` lo elenca sotto il nome del file — lo stesso ID con cui lo scheduler lo esegue e che viene mostrato in Studio — insieme alla relativa schedulazione e fuso orario, consentendo all'host di leggere le schedulazioni di un progetto prima di eseguire qualsiasi cosa. Un cron non si collega ad alcuna variabile d'ambiente; `rebase status` lo mostra verde, senza nulla da configurare.

Leggere la schedulazione richiede l'importazione del file, e `rebase resources` è una fase di build: niente `.env`, niente secret. Pertanto, mantieni il **module scope** di un cron privo di qualsiasi elemento che legga la configurazione al momento dell'importazione — ad esempio un client di database istanziato in cima a un helper o un `env.ts` che valida `DATABASE_URL`. Importa invece tale logica all'interno dell'handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

L'handler viene eseguito nel deployment, dove tali variabili sono presenti. Un'importazione di primo livello dello stesso modulo renderebbe il grafo ricavabile unicamente su una macchina provvista casualmente di un file `.env` — e caricherebbe l'intera dipendenza a ogni avvio che si limita a registrare il job.

Il caricamento di un cron non dichiara nulla. Una fase di build personalizzata che necessita dei cron nel grafo lo dichiara esplicitamente tramite `declareCrons`:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Prossimi passi

- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Hook di tabella](/docs/collections/callbacks)** — Esegui logica sui cambiamenti dei dati
- **[Integrazione dei Webhook](/docs/recipes/webhooks)** — Invia notifiche in corrispondenza degli eventi
- **[Cron su più istanze](/docs/backend/cron-across-instances)** — Una sola esecuzione per slot, slot mancati, sospensione globale ed esecuzioni sovrapposte
