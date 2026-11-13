---
sourceHash: dc15b1a8aff0e700
title: Cron Job
sidebar_label: Cron Job
description: Pianifica attività in background ricorrenti con il sistema integrato di cron job di Rebase. Definisci i job come file TypeScript, monitorali in Studio e gestiscili tramite l'API REST.
---

## Panoramica

Rebase include uno **scheduler di cron job integrato** per l'esecuzione di attività in background ricorrenti: pulizia dei dati, generazione di report, controlli di integrità (health check), sincronizzazioni con API esterne e molto altro.

I cron job seguono lo stesso pattern di **rilevamento basato su file** delle funzioni personalizzate: inserisci un file TypeScript nella directory `crons/` e Rebase lo registrerà e pianificherà automaticamente.

- **Zero dipendenze** — Nessuna libreria esterna di pianificazione richiesta
- **API di amministrazione** — Endpoint REST per elencare, attivare, abilitare/disabilitare e visualizzare i log
- **Dashboard di Studio** — Monitora tutti i job, visualizza la cronologia delle esecuzioni e avviali manualmente
- **Persistenza su database** — I log di esecuzione sono memorizzati in PostgreSQL, sopravvivendo ai riavvii
- **Cache in memoria** — Veloce buffer circolare (ultime 50 esecuzioni) per la dashboard, supportato dal DB

## Definizione di un Cron Job

Crea un file nella directory `backend/crons/` che esporti come default una definizione di cron. Usa l'helper `defineCron` da `@rebasepro/server` per l'inferenza dei tipi e l'autocompletamento:

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

`rebase dev` monitora la directory dei cron, quindi un job aggiunto mentre è in esecuzione viene registrato al successivo ricaricamento, senza riavviare. (Deve essere notificato: la directory viene scansionata anziché importata, quindi il watcher non può dedurlo da solo.)

:::note
`defineCron` è una funzione di identità: restituisce lo stesso oggetto che riceve in input. Un semplice oggetto `CronJobDefinition` esportato come default funziona esattamente allo stesso modo; `defineCron` fornisce semplicemente il controllo dei tipi in fase di compilazione e l'autocompletamento nell'editor.
:::

Il **nome del file** (senza estensione) diventa l'ID univoco del job, ad esempio `health-check`.


## Configurazione

:::note[Dove posizionare le opzioni]
**Runtime gestito** — inserisci i file in `backend/crons/`; il runtime rileva autonomamente quella directory, e `entry.crons` in `rebase.json` è necessario solo se l'hai spostata. `REBASE_CRON_SCHEDULER` in `.env` stabilisce se *questo* processo esegue i timer.

**Espulso (Ejected)** — usa `cronsDir` in `initializeRebaseBackend({ … })`, come mostrato di seguito, oppure `crons` con i job specificati come valori.

La mappa completa si trova in [Panoramica del Backend](/docs/backend/#where-each-option-lives).
:::

Abilita i cron job aggiungendo `cronsDir` alla configurazione del tuo backend:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Questo è tutto. Rebase provvederà a:

1. Scansionare la directory alla ricerca di file `.ts` / `.js`
2. Registrare ogni export di default come cron job
3. Creare automaticamente le tabelle `rebase.cron_logs`, `rebase.cron_claims` e `rebase.cron_job_state` in PostgreSQL (se il driver supporta SQL)
4. Avviare lo scheduler e inizializzare i contatori partendo dai log esistenti nel DB
5. Montare le route REST di amministrazione su `/api/admin/cron`

### Cron job come valori

`crons` accetta i job come record dall'ID del job alla definizione, accanto a `tables`. L'uso di una directory è uno dei modi per costruirlo: `loadCrons(dir)` ne legge una strutturandola esattamente in questo formato.

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

Fornisci `crons` o `cronsDir`, non entrambi: l'avvio rifiuta la presenza di entrambi. La compilazione del backend registra i job; ciò che avvia i loro timer è `start()`, che `initializeRebaseBackend` chiama per te. Con [`createRebaseBackend`](/docs/backend/custom-server/) lo chiami tu stesso, nel processo che dovrebbe eseguirli. `loadCronJobsFromDirectory` e `loadCronJobsWithDiagnostics` funzionano ancora, ma sono deprecati ed emettono un avviso una sola volta.

## Sintassi di Pianificazione

Le espressioni cron utilizzano il formato standard a **5 campi**:

```
┌───────────── minuto (0–59)
│ ┌─────────── ora (0–23)
│ │ ┌───────── giorno del mese (1–31)
│ │ │ ┌─────── mese (1–12)
│ │ │ │ ┌───── giorno della settimana (0–6, domenica = 0)
│ │ │ │ │
* * * * *
```

| Espressione | Significato |
|-------------|-------------|
| `* * * * *` | Ogni minuto |
| `0 * * * *` | Ogni ora |
| `0 3 * * *` | Giornaliero alle 03:00 |
| `0 0 * * 1` | Ogni lunedì a mezzanotte |
| `0 9 1 * *` | Il primo giorno di ogni mese alle 09:00 |
| `0,30 * * * *` | Ogni 30 minuti (ai minuti :00 e :30) |
| `0 9-17 * * 1-5` | Ogni ora, dalle 09:00 alle 17:00, solo nei giorni feriali |

I valori di intervallo (`*/n`), gli intervalli (`a-b`) e gli elenchi (`a,b,c`) sono tutti supportati.

Quando sia il giorno del mese che il giorno della settimana sono limitati, viene considerato valido un giorno che corrisponde a uno qualsiasi dei due, come nel cron standard: `0 9 1 * 1` viene eseguito il 1° di ogni mese e ogni lunedì. Quando uno dei due campi inizia con `*`, il giorno deve soddisfare entrambi i criteri.

Una pianificazione viene confrontata con l'orologio locale del suo fuso orario. Nel passaggio all'ora solare/legale, ciò significa che un job a orario fisso che cade nell'ora ripetuta (`30 2 * * *` dove gli orologi tornano indietro alle 03:00) viene eseguito in entrambi i passaggi di quell'ora; un job che cade nell'ora saltata, quando gli orologi avanzano, non verrà eseguito quel giorno.

## Riferimento `CronJobDefinition`

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

Usa `ctx.log()` per generare output strutturato. Queste righe vengono catturate nel log di esecuzione e risultano visibili in Studio e tramite l'API REST. Ogni riga viene anche scritta nel log del server a livello `info` con un campo `cron` contenente l'ID del job, in modo che compaia ovunque vengano raccolti gli output del tuo container, inclusi i log di debug di Rebase Cloud. Tale copia viene oscurata (redacted) come le normali righe di log del server: i valori di chiavi come `password` o `apiKey`, così come il codice SQL e i parametri di una query non riuscita, vengono mascherati. Il log di esecuzione memorizza invece la riga senza tale oscuramento.

Il log di esecuzione mantiene le prime 500 righe di un'esecuzione o 64 KB di testo, a seconda di quale limite viene raggiunto per primo, e in seguito una riga che indica quante altre righe sono state omesse: `… 9500 more lines not kept — see the server log`. Il log del server riceve invece ogni singola riga. Un job che registra una riga per ogni elemento elaborato deve mettere in conto che la sua cronologia mostrerà solo la parte iniziale dell'esecuzione.

### `ctx.signal` — interrompi il lavoro all'arresto dell'esecuzione

Il timeout conclude l'*esecuzione*: lo scheduler smette di attendere e registra un fallimento. Non termina però l'handler. Passa `ctx.signal` a qualsiasi funzione che ne accetti uno, e il lavoro si interromperà di conseguenza:

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

Senza di esso, un job il cui timeout coincide con il suo intervallo perderà una richiesta abbandonata a ogni ciclo — un problema invisibile, poiché ogni esecuzione risulta già registrata come fallita.

:::note[`ctx.client` è stato rimosso]
Era un nome alternativo per `ctx.rebase`, e il suo tipo riproponeva `client.data` — l'alias che `RebaseServerClient` omette deliberatamente affinché il piano privilegiato abbia un solo e unico nome. Chi imparava a usare `client.data` qui finiva per portarlo in un hook di tabella, dove `context.data` rappresenta invece il piano *con ambito utente*: stessa dicitura, privilegi opposti. Usa `ctx.rebase.dataAsAdmin`.
:::

### Interagire con il database e i servizi tramite `ctx.rebase`

`ctx.rebase.dataAsAdmin` è il data plane con privilegi di amministratore. Un cron non ha un utente associato a una richiesta, quindi non esiste un'alternativa con ambito utente: dovrai filtrare manualmente l'ambito di ogni query.

:::caution[L'ambito amministratore non aggira la RLS]
`dataAsAdmin` ha un ambito definito una volta all'avvio come `{ uid: "service", roles: ["admin"] }`. Ogni lettura e scrittura viene comunque eseguita in una transazione con `SET LOCAL ROLE rebase_user` e `app.uid = 'service'`, e **le tue policy vengono valutate** a fronte di tale identità. Soddisfa le policy predefinite integrate tramite il loro controllo `rolesOverlap(['admin'])`, motivo per cui la differenza si nota raramente. La differenza emerge quando scrivi le tue policy: `policy.serverContext()` compila in `rebase.uid() IS NULL` e risulta quindi **false** in questo contesto; perciò una tabella con `disableDefaultPolicies: true` la cui unica regola è `serverContext()` rifiuterà queste scritture e restituirà zero righe — HTTP 200, vuoto — per queste letture.

`rebase.sql()` è invece un bypass incondizionato: connessione come proprietario, nessuna policy applicata.
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
L'handler può restituire qualsiasi valore serializzabile in JSON. Verrà archiviato nella voce di log come `result` e mostrato nella cronologia delle esecuzioni di Studio.
:::

## API REST

La consultazione, l'attivazione, la messa in pausa e la ripresa dei job tramite HTTP, insieme al metodo `client.cron` dell'SDK tipizzato, sono descritti nella [API Cron Jobs](/docs/backend/cron-jobs-api/).

## Dashboard di Studio

Quando i cron job sono configurati, lo strumento **Cron Jobs** appare in Rebase Studio sotto la sezione **Compute**, accanto alla console JS. La dashboard offre:

- **Elenco dei job** — Tutti i job registrati con indicatori di stato in tempo reale
- **Pannello dei dettagli** — Pianificazione, prossima/ultima esecuzione, durata e informazioni sugli errori
- **Cronologia delle esecuzioni** — Voci di log espandibili con output catturati e risultati
- **Attivazione manuale** — Esegui qualsiasi job su richiesta con un solo clic. Il pannello attende il completamento dell'esecuzione e ne mostra l'esito: se fallita, ne mostra l'errore
- **Abilitazione/disabilitazione** — Metti in pausa e riprendi i job senza riavviare il server, per tutti i processi contemporaneamente; la pausa persiste tra riavvii e nuovi deploy
- **Job non disponibili** — Ogni job rifiutato dallo scheduler, con la relativa pianificazione, il motivo del rifiuto e il conteggio dei file di cron che non sono stati caricati. Nessuno di essi viene pianificato; vedi [Job non disponibili](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

La dashboard si aggiorna automaticamente ogni 15 secondi.

Il pannello mostra le stesse informazioni indipendentemente dal processo che lo serve. Un job in esecuzione su un altro processo risulterà in esecuzione. Su ogni processo dotato di uno store, il conteggio delle esecuzioni, quello dei fallimenti e l'ultima esecuzione vengono letti dal database, dove vengono aggregate le esecuzioni di tutti i processi. I contatori specifici di un processo contengono solo le esecuzioni da esso effettuate: il ruolo `api` affiancato a un worker non esegue nulla e, tra due repliche che eseguono entrambe la pianificazione, nessuna vede gli slot rivendicati dall'altra. Solo nel caso in cui il database non sia accessibile la scheda ripiega sui contatori locali di questo processo, emettendo un avviso nel log del server.

I conteggi sono globali per l'intero periodo di attività; la cronologia copre gli ultimi 30 giorni. La riga di ciascuna esecuzione in `rebase.cron_logs` viene eliminata 30 giorni dopo il suo avvio tramite una pulizia oraria, mentre i contatori delle esecuzioni e dei fallimenti continuano a conteggiarla. Un'esecuzione saltata conta come un'esecuzione a tutti gli effetti, come sempre: costituisce una riga della cronologia.

## Convalida della Pianificazione e Parsing dell'AST

Durante l'inizializzazione del backend, Rebase analizza tutte le pianificazioni cron registrate utilizzando un parser cron in JS senza dipendenze:
- **Controllo Sintattico**: Verifica che la stringa contenga esattamente 5 campi separati da spazi (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Espansione degli Intervalli**: Scompone i passi (`*/15`), gli intervalli (`9-17`) e gli elenchi separati da virgole (`0,30`) in array espliciti di interi validi mappati sui rispettivi limiti (es. minuti `0-59`, ore `0-23`, mesi `1-12`).
- **Token Interi**: Ogni numero, limite di intervallo e passo deve essere un numero intero: `5abc`, `*/5x` e `1.5` vengono rifiutati, così come un intervallo invertito (`5-1`).
- Se una qualsiasi espressione cron non supera la convalida, Rebase rifiuta la definizione, registra un errore di avvio e rifiuta la registrazione del job per prevenire errori di esecuzione a runtime.

---

## Dietro le Quinte: Correzione del Clock Drift

Gli scheduler standard basati su intervalli (come `setInterval`) subiscono derive temporali (drift) nel tempo e provocano picchi di CPU significativi dovuti ai ritardi di pianificazione dell'event loop a livello di sistema operativo. Per garantire la precisione di esecuzione, Rebase implementa un **ciclo dinamico di calcolo dell'orario target**:
1. **Calcolo del Candidato**: Al completamento di un job o all'avvio dello scheduler, Rebase calcola il timestamp esatto del *prossimo* minuto candidato corrispondente.
2. **Sospensione Dinamica**: Calcola la differenza in millisecondi (`nextRun.getTime() - now.getTime()`) e pianifica un singolo `setTimeout`.
3. **Soglia di Sicurezza per il Drift**: Viene applicato un buffer minimo di sospensione (`MIN_SCHEDULE_INTERVAL_MS`) pari a **5.000 ms**. Se un ciclo dello scheduler si completa in modo estremamente rapido, questa soglia impedisce una doppia esecuzione quasi istantanea.
4. **Terminazione Pulita**: I puntatori ai timer vengono esplicitamente scollegati dall'event loop di Node.js tramite `timer.unref()`, assicurando che gli scheduler dei cron in background non blocchino la chiusura corretta dei processi durante i deploy.

---

## Più di un Processo

Ogni processo con lo scheduler attivo arma gli stessi timer; è il database a stabilire quale di essi eseguirà ciascuno slot. Come uno slot viene eseguito una sola volta, come viene recuperato uno slot perso a causa di un riavvio, come una pausa si propaga a ogni replica e perché un trigger manuale non viene mai eseguito contemporaneamente a una pianificazione sono argomenti trattati in [Cron tra più istanze](/docs/backend/cron-across-instances).

---

## Timeout e Isolamento degli Errori

- **Forced Timeout Race**: I blocchi di esecuzione sono incapsulati in un `Promise.race` con un timer di timeout derivato da `timeoutSeconds` (valore predefinito: `300` secondi / 5 minuti; `Infinity` per nessun timeout). Se l'handler rimane bloccato oltre questa soglia, `ctx.signal` viene interrotto e la promise viene rifiutata generando:
  `Error: Cron job "<id>" timed out after <N>ms`
  L'interruzione (abort) è la parte che ferma il *lavoro*; il rifiuto della promise interrompe solo l'attesa da parte dello scheduler. Un handler che ignora `ctx.signal` continuerà a essere eseguito oltre il termine della propria esecuzione.
- **Spegnimento (Shutdown)**: `backend.shutdown()` attende il completamento di un'esecuzione in corso, entro lo stesso limite di tempo riservato alla coda dei job (due terzi del timeout di arresto). Un'esecuzione ancora attiva allo scadere del tempo vede il proprio `ctx.signal` interrotto e viene registrata come fallita, con la relativa motivazione. Il suo slot rimane contrassegnato come occupato, quindi nessun'altra istanza la eseguirà nuovamente.
- **Try/Catch Fail-Safe**: Ogni handler viene eseguito all'interno di un wrapper isolato. Qualsiasi eccezione non gestita viene intercettata, registrando il messaggio di errore (mascherato/redacted) sotto forma di stringa, impostando lo stato del job su `"error"` e aggiornando il contatore dei fallimenti del job. Un arresto anomalo all'interno di una singola attività cron non bloccherà mai il ciclo dello scheduler né il server web HTTP Hono principale.
- **Buffer Circolare in Memoria**: Lo scheduler mantiene un buffer circolare contenente le ultime **50 esecuzioni** per ciascun job. Questo buffer è conservato in memoria per consentire letture pressoché istantanee da Rebase Studio.

---

## Schema di Persistenza su Database

Quando sono attivi adattatori di database che supportano SQL (es. PostgreSQL), Rebase predispone la tabella `rebase.cron_logs`:

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

Ciascuna tabella viene creata all'avvio qualora risulti mancante; in questo modo, un database preesistente la acquisirà al deploy successivo. Nessuna di esse è una tabella dichiarata, e il ruolo dell'utente finale `rebase_user` non ha alcun privilegio su di esse: una tabella `cron_job_state` accessibile in scrittura permetterebbe a un utente autenticato di mettere in pausa un job per tutti, o di trattenerne il lease impedendo a chiunque altro di eseguirlo.

La riga di un'esecuzione e il relativo conteggio vengono registrati in una singola operazione: l'inserimento in `cron_logs` e un upsert dei contatori del job su `cron_job_state`. La richiesta di elenco legge una riga di `cron_job_state` per ogni job, indipendentemente dall'estensione della cronologia; lo stesso fa lo scheduler quando inizializza `totalRuns` e `totalFailures` all'avvio. La scrittura dei log non blocca l'esecuzione: se una scrittura non va a buon fine, lo scheduler registra l'errore e prosegue, mantenendo comunque l'esecuzione nel buffer circolare in memoria.

Una volta all'ora, e ad ogni avvio, lo scheduler elimina le righe della cronologia più vecchie di 30 giorni e conteggia le esecuzioni non ancora incluse, entrambe le operazioni in batch da 5.000 righe. La cronologia registrata prima della versione 0.24 viene conteggiata dalla prima di queste sessioni di pulizia, al di fuori del processo di avvio. Fino al termine di tale operazione, l'elenco aggiunge ai contatori le esecuzioni non ancora conteggiate, evitando variazioni nei numeri a seguito dell'aggiornamento. Lo stesso avviene per le esecuzioni registrate da un server precedente durante un rolling deployment.

## Esempio: Job Giornaliero di Pulizia

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

## I Cron nel Grafico delle Risorse

Ogni file di cron rappresenta anche una dichiarazione. Il comando `rebase resources` lo elenca con il nome del file — lo stesso ID con cui lo scheduler lo esegue e con cui Studio lo visualizza — insieme alla sua pianificazione e al fuso orario, consentendo all'host di leggere le pianificazioni di un progetto prima di avviare qualsiasi cosa. Un cron non si collega ad alcuna variabile d'ambiente; `rebase status` lo mostra in verde senza nulla da configurare.

Leggere la pianificazione richiede l'importazione del file, e `rebase resources` è un passaggio di compilazione: niente `.env`, niente segreti. Di conseguenza, mantieni l'**ambito del modulo** di un cron privo di codice che legga configurazioni all'importazione — come un client di database istanziato in cima a un helper, o un file `env.ts` che valida `DATABASE_URL`. Importa tali operazioni direttamente all'interno dell'handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

L'handler viene eseguito nel deployment, dove quelle variabili sono presenti. Un import a livello superiore del medesimo modulo renderebbe il grafico calcolabile solo su una macchina provvista di file `.env` — e caricherebbe l'intera dipendenza in qualsiasi avvio che si limiti a registrare il job.

Il semplice caricamento di un cron non dichiara nulla. Una procedura di build personalizzata che necessita dei cron nel grafico può dichiararli tramite `declareCrons`:

```ts
import { declareCrons, loadCrons } from "@rebasepro/server";

declareCrons(await loadCrons("./crons", { onSkip: (problem) => console.warn(problem) }));
```

## Passaggi Successivi

- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Hook di Tabella](/docs/collections/callbacks)** — Esegui logica sulle modifiche ai dati
- **[Integrazione Webhook](/docs/recipes/webhooks)** — Invia notifiche al verificarsi di eventi
- **[Cron tra più istanze](/docs/backend/cron-across-instances)** — Una sola esecuzione per slot, slot mancati, sospensione globale ed esecuzioni sovrapposte
