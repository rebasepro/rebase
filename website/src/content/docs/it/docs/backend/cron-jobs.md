---
sourceHash: 571b6448756b487e
title: Cron Job
sidebar_label: Cron Job
description: Pianifica attività ricorrenti in background con il sistema di cron job integrato di Rebase. Definisci i job come file TypeScript, monitorali in Studio e gestiscili tramite l'API REST.
---

## Panoramica

Rebase include uno **scheduler di cron job** integrato per l'esecuzione di attività in background ricorrenti: pulizia dei dati, generazione di report, controlli dello stato (health check), sincronizzazioni con API esterne e altro ancora.

I cron job seguono lo stesso pattern di **file-based discovery** delle funzioni personalizzate: inserisci un file TypeScript nella directory `crons/` e Rebase lo registra e lo pianifica automaticamente.

- **Zero dipendenze** — Nessuna libreria di scheduling esterna richiesta
- **API di amministrazione** — Endpoint REST per elencare, avviare, abilitare/disabilitare e visualizzare i log
- **Dashboard di Studio** — Monitora tutti i job, visualizza la cronologia delle esecuzioni e avvia esecuzioni manuali
- **Persistenza su database** — Log di esecuzione archiviati in PostgreSQL, persistenti ai riavvii
- **Cache in memoria** — Ring buffer veloce (ultime 50 esecuzioni) per la dashboard, supportato dal DB

## Definizione di un Cron Job

Crea un file nella directory `backend/crons/` che esporti come default una definizione di cron. Usa l'helper `defineCron` di `@rebasepro/server` per l'inferenza dei tipi e l'autocompletamento:

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

`rebase dev` monitora la directory dei cron, quindi un job aggiunto mentre è in esecuzione viene registrato al successivo ricaricamento, senza alcun riavvio. (Va specificato: la directory viene scansionata anziché importata, quindi il watcher non può dedurlo autonomamente).

:::note
`defineCron` è una funzione identità: restituisce lo stesso oggetto che viene passato. Un semplice oggetto `CronJobDefinition` esportato come default funziona in modo identico; `defineCron` fornisce semplicemente il controllo dei tipi a livello di compilazione e l'autocompletamento nell'editor.
:::

Il **nome del file** (senza estensione) diventa l'ID univoco del job, ad es. `health-check`.


## Configurazione

:::note[Dove va configurato]
**Runtime gestito** — inserisci i file in `backend/crons/`; il runtime rileva autonomamente tale directory, e `entry.crons` in `rebase.json` è necessario solo se è stata spostata. `REBASE_CRON_SCHEDULER` in `.env` stabilisce se *questo* processo debba eseguire i timer.

**Ejected** — `cronsDir` su `initializeRebaseBackend({ … })`, come indicato di seguito, oppure `crons` con i job come valori.

La panoramica completa è disponibile in [Panoramica del Backend](/docs/backend/#where-each-option-lives).
:::

Abilita i cron job aggiungendo `cronsDir` alla configurazione del tuo backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Tutto qui. Rebase si occuperà di:

1. Scansionare la directory alla ricerca di file `.ts` / `.js`
2. Registrare ogni esportazione di default come cron job
3. Creare automaticamente le tabelle `rebase.cron_logs`, `rebase.cron_claims` e `rebase.cron_job_state` in PostgreSQL (se il driver supporta SQL)
4. Avviare lo scheduler e inizializzare i contatori a partire dai log esistenti nel DB
5. Registrare le route REST di amministrazione su `/api/admin/cron`

### Cron job come valori

`crons` accetta i job come record da id del job alla definizione, accanto a `tables`. L'utilizzo di una directory è uno dei modi per costruirlo: `loadCrons(dir)` ne legge una esattamente in quel formato.

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

Fornisci `crons` o `cronsDir`, non entrambi: all'avvio la combinazione viene rifiutata. La compilazione del backend registra i job; ciò che avvia i loro timer è `start()`, che `initializeRebaseBackend` richiama automaticamente. Con [`createRebaseBackend`](/docs/backend/custom-server/) lo chiami tu stesso, nel processo designato alla loro esecuzione. `loadCronJobsFromDirectory` e `loadCronJobsWithDiagnostics` funzionano ancora, ma sono deprecate ed emettono un avviso una sola volta.

## Sintassi di pianificazione

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
|-------------|-------------|
| `* * * * *` | Ogni minuto |
| `0 * * * *` | Ogni ora |
| `0 3 * * *` | Giornalmente alle 03:00 |
| `0 0 * * 1` | Ogni lunedì a mezzanotte |
| `0 9 1 * *` | Il primo giorno di ogni mese alle 09:00 |
| `0,30 * * * *` | Ogni 30 minuti (ai minuti :00 e :30) |
| `0 9-17 * * 1-5` | Ogni ora, dalle 09:00 alle 17:00, solo nei giorni feriali |

I valori di intervallo (step, `*/n`), i range (`a-b`) e gli elenchi (`a,b,c`) sono tutti supportati.

Quando sia il giorno del mese sia il giorno della settimana sono vincolati, un giorno che corrisponde a uno dei due è valido, come nel cron standard: `0 9 1 * 1` viene eseguito il 1° di ogni mese e ogni lunedì. Se uno dei due campi inizia con `*`, il giorno deve soddisfare entrambi i criteri.

Una pianificazione viene confrontata con l'orologio locale (wall clock) del suo fuso orario. Durante il passaggio all'ora solare o legale, ciò significa che un job a orario fisso all'interno dell'ora ripetuta (`30 2 * * *` dove gli orologi vengono spostati indietro alle 03:00) viene eseguito in entrambi i passaggi di quell'ora, mentre uno all'interno dell'ora saltata, quando gli orologi vengono spostati avanti, non viene eseguito in quel giorno.

## Riferimento CronJobDefinition

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

Usa `ctx.log()` per generare output strutturato. Queste righe vengono acquisite nel log di esecuzione e sono visibili in Studio e tramite l'API REST. Ogni riga viene inoltre registrata nel log del server a livello `info` con un campo `cron` contenente l'ID del job, mostrandosi ovunque venga raccolto l'output del container, inclusi i log di debug di Rebase Cloud. Tale copia viene oscurata (redacted) come avviene per le righe di log del server stesso: i valori di chiavi come `password` o `apiKey`, così come l'SQL e i parametri di una query non riuscita, vengono mascherati. Il log di esecuzione archivia invece la riga senza tale oscuramento.

Il log di esecuzione conserva le prime 500 righe di un'esecuzione o fino a 64 KB, a seconda di quale soglia venga raggiunta per prima, e inserisce una riga che indica quante ulteriori righe erano presenti: `… 9500 more lines not kept — see the server log`. Il log del server riceve tutte le righe. Un job che registra una riga per ogni elemento elaborato deve aspettarsi che la cronologia mostri l'inizio dell'esecuzione.

### `ctx.signal` — interrompere il lavoro all'arresto dell'esecuzione

Il timeout interrompe l'*esecuzione*: lo scheduler smette di attendere e registra un fallimento. Tuttavia, non termina l'handler. Passa `ctx.signal` a qualsiasi operazione che accetti un segnale di abort, e il lavoro si interromperà di conseguenza:

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

Senza di esso, un job il cui timeout coincide con il suo intervallo genera una richiesta orfana a ogni tick — cosa invisibile, poiché ogni esecuzione viene già registrata come fallita.

:::note[`ctx.client` è stato rimosso]
Era un secondo nome per `ctx.rebase` e il suo tipo riesponeva `client.data` — l'alias che `RebaseServerClient` omette intenzionalmente affinché il piano con privilegi abbia un unico nome. Chi apprendeva l'uso di `client.data` qui tendeva a riutilizzarlo negli hook di tabella, dove `context.data` rappresenta il piano con *ambito utente* (user-scoped): stessa grafia, privilegi opposti. Usa `ctx.rebase.dataAsAdmin`.
:::

### Interazione con il database e i servizi tramite `ctx.rebase`

`ctx.rebase.dataAsAdmin` è il data plane con ambito di amministrazione. Un cron job non ha un utente associato alla richiesta, quindi qui non è disponibile alcuna alternativa con ambito utente: imposta manualmente i filtri di ogni query.

:::caution[L'ambito admin non bypassa le RLS]
`dataAsAdmin` viene configurato una volta sola, all'avvio, come `{ uid: "service", roles: ["admin"] }`. Ogni lettura e scrittura viene comunque eseguita in una transazione con `SET LOCAL ROLE rebase_user` e `app.uid = 'service'`, e **le tue policy vengono valutate** rispetto a tale identità. Soddisfa le policy predefinite integrate tramite il ramo `rolesOverlap(['admin'])`, motivo per cui la differenza si nota raramente. Emerge invece quando scrivi policy personalizzate: `policy.serverContext()` compila in `rebase.uid() IS NULL` ed è quindi **false** in questo caso; pertanto, una tabella con `defaultPolicies: false` la cui unica regola è `serverContext()` negherà queste scritture e restituirà zero righe — HTTP 200, vuoto — per queste letture.

`rebase.sql()` *è* un bypass incondizionato: connessione come owner, nessuna policy.
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
L'handler può restituire qualsiasi valore serializzabile in JSON. Verrà memorizzato nella voce di log come `result` e mostrato nella cronologia delle esecuzioni di Studio.
:::

## API REST

La consultazione, l'attivazione, la sospensione e la ripresa dei job tramite HTTP, insieme a `client.cron` nell'SDK tipizzato, sono descritte nella sezione [API dei Cron Job](/docs/backend/cron-jobs-api/).

## Dashboard di Studio

Quando i cron job sono configurati, lo strumento **Processi pianificati** appare in Rebase Studio sotto la voce **Elaborazione**, accanto alla console JS. La dashboard fornisce:

- **Elenco dei job** — Tutti i job registrati con indicatori di stato in tempo reale
- **Pannello dei dettagli** — Pianificazione, esecuzione successiva/precedente, durata e informazioni sugli errori
- **Cronologia delle esecuzioni** — Voci di log espandibili con output acquisito e risultati
- **Avvio manuale** — Esegui qualsiasi job on demand con un clic. Il pannello attende il termine dell'esecuzione e ne segnala l'esito: un'esecuzione fallita mostrerà il relativo errore
- **Abilita/disabilita** — Metti in pausa e riprendi i job senza riavviare il server, per tutti i processi contemporaneamente; una pausa rimane valida anche dopo riavvii e deploy
- **Job non presenti** — ogni job rifiutato dallo scheduler, con la relativa pianificazione e il motivo, e il numero di file cron non caricati. Nessuno di essi viene pianificato; vedi [Job non presenti](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

La dashboard si aggiorna automaticamente ogni 15 secondi.

Il pannello mostra le stesse informazioni indipendentemente da quale processo risponde alla richiesta. Un job in esecuzione su un altro processo viene mostrato come in esecuzione.
Su ogni processo dotato di uno store, il conteggio delle esecuzioni, il conteggio dei fallimenti e l'ultima esecuzione vengono letti dal database, in cui sono conteggiate le esecuzioni di tutti i processi. I contatori locali di un processo tengono traccia solo delle esecuzioni effettuate da esso stesso: il ruolo `api` accanto a un worker non esegue nulla e, tra due repliche che eseguono entrambe lo scheduling, nessuna delle due vede gli slot rivendicati dall'altra. Solo quando il database non può essere letto la scheda ripiega sui contatori locali di questo processo, emettendo un avviso nel log del server.

I conteggi sono complessivi (all-time); la cronologia copre gli ultimi 30 giorni. La riga di ogni esecuzione in `rebase.cron_logs` viene eliminata 30 giorni dopo il suo avvio tramite una pulizia oraria, mentre i conteggi delle esecuzioni e dei fallimenti continuano a includerla. Un'esecuzione saltata conta come un'esecuzione, come sempre avvenuto: costituisce una riga della cronologia.

## Validazione della pianificazione e parsing dell'AST

All'inizializzazione del backend, Rebase analizza tutte le pianificazioni cron registrate utilizzando un expander cron in JS privo di dipendenze esterne:
- **Controllo sintattico**: Verifica che la stringa contenga esattamente 5 campi separati da spazi (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Espansione dei range**: Scompone passi (`*/15`), intervalli (`9-17`) ed elenchi separati da virgole (`0,30`) in array espliciti di interi validi mappati sui rispettivi limiti (ad es. minuti `0-59`, ore `0-23`, mesi `1-12`).
- **Token interi**: Ogni numero, limite di intervallo e passo deve essere un numero intero: `5abc`, `*/5x` e `1.5` vengono rifiutati, così come un intervallo invertito (`5-1`).
- Se un'espressione cron non supera la validazione, Rebase rifiuta la definizione, registra un errore di avvio e non registra il job per prevenire errori di esecuzione a runtime.

---

## Dietro le quinte: correzione del Clock-Drift

Gli scheduler standard basati su intervalli (come `setInterval`) tendono a deviare nel tempo (drift) e causano picchi di CPU significativi a causa dei ritardi di scheduling dell'event loop a livello di sistema operativo. Per garantire la precisione di esecuzione, Rebase implementa un **ciclo dinamico di calcolo dell'orario target**:
1. **Calcolo del candidato**: Al completamento di un job o all'avvio dello scheduler, Rebase calcola l'esatto timestamp del minuto candidato *successivo* corrispondente.
2. **Sleep dinamico**: Calcola la differenza in millisecondi (`nextRun.getTime() - now.getTime()`) e pianifica un singolo `setTimeout`.
3. **Soglia di sicurezza per il drift**: Viene applicato un buffer di sleep minimo (`MIN_SCHEDULE_INTERVAL_MS`) di **5.000 ms**. Se un ciclo dello scheduler si conclude in tempi estremamente rapidi, questa soglia impedisce doppie attivazioni quasi istantanee.
4. **Gestione dell'arresto pulito**: I riferimenti dei timer vengono esplicitamente scollegati dall'event loop di Node.js tramite `timer.unref()`, garantendo che gli scheduler cron in background non blocchino la corretta chiusura dei processi durante i deploy.

---

## Più di un processo

Ogni processo con lo scheduler attivo arma gli stessi timer; il database stabilisce quale di essi debba eseguire ciascuno slot. Come uno slot viene eseguito una sola volta, come viene recuperato uno slot perso a causa di un riavvio, come una pausa si propaga a tutte le repliche e perché un avvio manuale non viene mai eseguito contemporaneamente a una pianificazione programmata sono descritti in [Cron tra istanze](/docs/backend/cron-across-instances).

---

## Timeout e isolamento degli errori

- **Corsa al timeout forzato (Forced Timeout Race)**: I blocchi di esecuzione sono incapsulati in un `Promise.race` con un timer di timeout ricavato da `timeoutSeconds` (predefinito: `300` secondi / 5 minuti; `Infinity` per disattivarlo). Se l'handler rimane bloccato oltre questa soglia, `ctx.signal` viene interrotto (aborted) e la promise viene rigettata, generando l'errore:
  `Error: Cron job "<id>" timed out after <N>ms`
  L'abort è la parte che ferma il *lavoro*; la rejection impedisce solo che lo scheduler rimanga in attesa. Un handler che ignora `ctx.signal` continuerà a essere eseguito oltre la durata della propria esecuzione.
- **Arresto (Shutdown)**: `backend.shutdown()` attende il completamento delle esecuzioni in corso, entro lo stesso limite di tempo riservato alla coda dei job (due terzi del timeout di arresto). Un'esecuzione ancora attiva allo scadere di questo tempo vede `ctx.signal` interrotto e viene registrata come fallita, con il relativo motivo. Il suo slot rimane rivendicato (claimed), impedendo che un'altra istanza lo riesegua.
- **Try/Catch di sicurezza (Fail-Safe)**: Ogni handler viene eseguito all'interno di un wrapper isolato. Eventuali eccezioni non gestite vengono intercettate, registrando il messaggio di errore (oscurato) come stringa, impostando lo stato del job su `"error"` e aggiornando il contatore dei fallimenti del job. Un arresto anomalo all'interno di un singolo task cron non interromperà mai il ciclo dello scheduler né il server web HTTP primario Hono.
- **Ring buffer in memoria**: Lo scheduler mantiene un ring buffer contenente le ultime **50 esecuzioni** per ciascun job. Questo buffer viene conservato in memoria per consentire letture quasi istantanee da Rebase Studio.

---

## Schema di persistenza nel database

Quando sono attivi gli adapter di database che supportano SQL (ad es. PostgreSQL), Rebase effettua il provisioning della tabella `rebase.cron_logs`:

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

Ciascuna di esse viene creata all'avvio se assente, quindi un database precedente ne acquisirà la struttura al deploy successivo. Nessuna di esse è una tabella dichiarata e il ruolo utente finale `rebase_user` non ha alcun privilegio su di esse: una tabella `cron_job_state` accessibile in scrittura consentirebbe a un utente autenticato di sospendere un job per tutti, oppure di occuparne il lease impedendo a chiunque di eseguirlo.

La riga dell'esecuzione e il relativo conteggio vengono scritti in un'unica istruzione: l'inserimento in `cron_logs` e un upsert dei contatori del job su `cron_job_state`. L'elenco legge una sola riga di `cron_job_state` per job, indipendentemente dalla lunghezza della cronologia, così come fa lo scheduler quando inizializza `totalRuns` e `totalFailures` all'avvio. Le scritture dei log non bloccano l'esecuzione; se una scrittura fallisce, lo scheduler registra l'errore e prosegue, mantenendo comunque l'esecuzione nel ring buffer in memoria.

Una volta ogni ora e al suo avvio, lo scheduler elimina le righe della cronologia più vecchie di 30 giorni e conteggia le esecuzioni non ancora conteggiate, entrambe le operazioni in batch di 5.000 righe. Una cronologia scritta prima della versione 0.24 viene conteggiata dalla prima di queste scansioni di pulizia, al di fuori del percorso di boot. Fino al suo completamento, l'elenco somma ai contatori le esecuzioni non ancora conteggiate, garantendo che i numeri non subiscano variazioni durante l'aggiornamento. Lo stesso vale per le esecuzioni registrate da un server precedente durante un rolling deploy.

## Esempio: Job di pulizia giornaliero

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

## I Cron nel grafo delle risorse

Ogni file cron è anche una dichiarazione. `rebase resources` lo elenca con il nome del file — lo stesso ID con cui lo scheduler lo esegue e che viene mostrato in Studio — insieme alla sua pianificazione e al fuso orario, consentendo all'host di leggere le pianificazioni di un progetto prima di eseguire qualsiasi cosa. Un cron non si collega ad alcuna variabile d'ambiente; `rebase status` lo mostra in verde senza nulla da configurare.

Leggere la pianificazione richiede l'importazione del file, e `rebase resources` è una fase di build: nessun `.env`, nessun segreto. Pertanto, mantieni il **module scope** di un cron privo di qualsiasi elemento che legga configurazioni al momento dell'importazione — come un client di database inizializzato all'inizio di un helper o un file `env.ts` che valida `DATABASE_URL`. Importa invece tali operazioni all'interno dell'handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

L'handler viene eseguito nel deployment, dove tali variabili sono presenti. Un'importazione di primo livello dello stesso modulo renderebbe il grafo calcolabile solo su una macchina provvista casualmente di un file `.env` — e caricherebbe l'intera dipendenza in ogni fase di avvio che si limita a registrare il job.

Il semplice caricamento di un cron non dichiara nulla. Una tua fase di build personalizzata che necessita dei cron nel grafo deve specificarlo tramite `declareCrons`:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Passaggi successivi

- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Hook di tabella](/docs/collections/callbacks)** — Esegui logica sulle modifiche ai dati
- **[Integrazione Webhook](/docs/recipes/webhooks)** — Invia notifiche in corrispondenza degli eventi
- **[Cron tra istanze](/docs/backend/cron-across-instances)** — Una sola esecuzione per slot, slot persi, sospensione globale ed esecuzioni sovrapposte
