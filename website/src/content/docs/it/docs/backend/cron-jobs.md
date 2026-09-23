---
sourceHash: bd5ebbaf6bff7eb9
title: Cron Jobs
sidebar_label: Cron Jobs
description: Pianifica attività ricorrenti in background con il sistema di cron job integrato di Rebase. Definisci i job come file TypeScript, monitorali in Studio e gestiscili tramite l'API REST.
---

## Panoramica

Rebase include uno **scheduler di cron job** integrato per l'esecuzione di attività ricorrenti in background: pulizia dei dati, generazione di report, controlli dello stato (health check), sincronizzazioni con API esterne e altro ancora.

I cron job seguono lo stesso pattern di **rilevamento basato su file** delle funzioni personalizzate: inserisci un file TypeScript nella cartella `crons/` e Rebase lo registra e pianifica automaticamente.

- **Zero dipendenze** — Nessuna libreria di scheduling esterna richiesta
- **Admin API** — Endpoint REST per elencare, avviare, abilitare/disabilitare e visualizzare i log
- **Dashboard di Studio** — Monitora tutti i job, visualizza la cronologia delle esecuzioni e avvia le esecuzioni manualmente
- **Persistenza su database** — Log di esecuzione archiviati in PostgreSQL, preservati anche dopo i riavvii
- **Cache in memoria** — Veloce ring buffer (ultime 50 esecuzioni) per la dashboard, supportato dal DB

## Definizione di un Cron Job

Crea un file nella tua directory `backend/crons/` che esporti come default una definizione di cron. Usa l'helper `defineCron` di `@rebasepro/server` per l'inferenza dei tipi e il completamento automatico:

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

`rebase dev` monitora la directory dei cron, quindi un job aggiunto durante l'esecuzione viene registrato al reload successivo — senza riavvio. (È necessario specificarlo: la directory viene scansionata anziché importata, quindi il watcher non può dedurlo autonomamente.)

:::note
`defineCron` è una funzione identità: restituisce lo stesso oggetto passato in input. Un semplice oggetto `CronJobDefinition` esportato come default funziona in modo identico; `defineCron` fornisce semplicemente il controllo dei tipi a tempo di compilazione e il completamento automatico nell'editor.
:::

Il **nome del file** (senza estensione) diventa l'ID univoco del job — ad es., `health-check`.


## Configurazione

:::note[Dove inserirlo]
**Runtime gestito** — inserisci i file in `backend/crons/`; il runtime rileva quella directory autonomamente, e `entry.crons` in `rebase.json` è necessario solo se l'hai spostata. `REBASE_CRON_SCHEDULER` in `.env` determina se *questo* processo debba eseguire i timer.

**Ejected** — `cronsDir` in `initializeRebaseBackend({ … })`, come mostrato di seguito.

La mappa completa è disponibile in [Backend Overview](/docs/backend/#where-each-option-lives).
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

1. Eseguire la scansione della directory per cercare file `.ts` / `.js`
2. Registrare ogni export di default come cron job
3. Creare automaticamente le tabelle `rebase.cron_logs`, `rebase.cron_claims` e `rebase.cron_job_state` in PostgreSQL (se il driver supporta SQL)
4. Avviare lo scheduler e inizializzare i contatori dai log esistenti nel DB
5. Montare le route REST di amministrazione su `/api/admin/cron`

## Sintassi di Pianificazione

Le espressioni cron utilizzano il **formato standard a 5 campi**:

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
| `0 3 * * *` | Ogni giorno alle 03:00 |
| `0 0 * * 1` | Ogni lunedì a mezzanotte |
| `0 9 1 * *` | Il primo giorno di ogni mese alle 09:00 |
| `0,30 * * * *` | Ogni 30 minuti (al minuto :00 e :30) |
| `0 9-17 * * 1-5` | Ogni ora, dalle 09:00 alle 17:00, solo nei giorni feriali |

I valori di step (`*/n`), gli intervalli (`a-b`) e gli elenchi (`a,b,c`) sono tutti supportati.

Una pianificazione viene confrontata con l'ora locale del suo fuso. Durante un cambio dell'ora legale, questo significa che un job a orario fisso nell'ora ripetuta (`30 2 * * *` dove gli orologi tornano indietro alle 03:00) viene eseguito in entrambi i passaggi di quell'ora, mentre uno nell'ora saltata, quando gli orologi vanno avanti, quel giorno non viene eseguito.

## Riferimento a CronJobDefinition

`timezone` è una novità: nella versione 0.17.3 una pianificazione viene sempre interpretata nel fuso orario dell'host. Tutto il resto in questa interfaccia è già rilasciato.

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // IANA zone the schedule is read in, e.g. "Europe/Madrid". Without it the
    // schedule is read in the host's own zone — UTC in nearly every container,
    // yours on a laptop — so name it. An unknown zone is refused when the job
    // loads rather than read as local time.
    timezone?: string;

    // Human-readable name shown in Studio
    name: string;

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

    // The scheduled tick timestamp
    scheduledAt: Date;

    // Logger — captured lines appear in Studio and the logs API
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

Usa `ctx.log()` per emettere output strutturato. Queste righe vengono acquisite nel log di esecuzione e sono visibili in Studio e tramite l'API REST.

### `ctx.signal` — interrompere il lavoro quando l'esecuzione si ferma

Il timeout interrompe l'*esecuzione*: lo scheduler smette di attendere e registra un fallimento. Non interrompe però l'handler. Passa `ctx.signal` a qualsiasi operazione che lo accetti, e il lavoro si interromperà di conseguenza:

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

Senza di esso, un job il cui timeout corrisponde al suo intervallo disperde una richiesta abbandonata a ogni tick — in modo invisibile, poiché ogni esecuzione viene già registrata come fallita.

:::note[`ctx.client` è stato rimosso]
Era un nome alternativo per `ctx.rebase`, e il suo tipo riproponeva `client.data` — l'alias che `RebaseServerClient` omette deliberatamente affinché il piano con privilegi abbia un solo nome. Chi imparava a usare `client.data` qui finiva per portarlo nei callback delle collection, dove `context.data` rappresenta il piano *con ambito utente* (user-scoped): stessa grafia, privilegi opposti. Usa `ctx.rebase.dataAsAdmin`.
:::

### Interagire con il database e i servizi tramite `ctx.rebase`

`ctx.rebase.dataAsAdmin` è il data plane con ambito di amministrazione. Un cron job non ha un utente associato a una richiesta, quindi non esiste un'alternativa con ambito utente: definisci tu stesso i filtri di ciascuna query.

:::caution[L'ambito admin non esclude l'RLS]
`dataAsAdmin` ha un ambito impostato una volta sola, all'avvio, come `{ uid: "service", roles: ["admin"] }`. Ogni lettura e scrittura viene comunque eseguita in una transazione che ha eseguito `SET LOCAL ROLE rebase_user` con `app.uid = 'service'`, e **le tue policy vengono valutate** — rispetto a tale identità. Soddisfa le policy predefinite integrate tramite il ramo `rolesOverlap(['admin'])`, motivo per cui la differenza si nota raramente. Si nota invece quando scrivi policy personalizzate: `policy.serverContext()` viene compilato in `rebase.uid() IS NULL` ed è quindi **false** in questo contesto; pertanto, una collection con `disableDefaultPolicies: true` la cui unica regola è `serverContext()` rifiuterà queste scritture e restituirà zero righe — HTTP 200, vuoto — per queste letture.

`rebase.sql()` *è* invece un bypass incondizionato: connessione owner, nessuna policy.
:::

```typescript
// backend/crons/expire-users.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver. `collection<Row>(slug)`
        // gives the query builder the row type — `where` keys are checked
        // against it. Every filter is an `[operator, value]` tuple; a bare
        // value is passed straight through and builds a malformed query.
        const users = ctx.rebase.dataAsAdmin.collection<{
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

Tutte le route di cron richiedono **l'autenticazione di amministratore** (`requireAuth` + `requireAdmin`).

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| `GET` | `/api/admin/cron` | Elenca tutti i cron job registrati |
| `GET` | `/api/admin/cron/:id` | Recupera lo stato di un singolo job |
| `POST` | `/api/admin/cron/:id/trigger` | Avvia manualmente un job — `409` mentre è già in esecuzione |
| `GET` | `/api/admin/cron/:id/logs` | Ottieni la cronologia delle esecuzioni (`?limit=N`) |
| `PUT` | `/api/admin/cron/:id` | Mette in pausa o riprende un job ovunque (`{ "enabled": false }`); `null` torna a seguire il codice |

### Esempio: Elencare tutti i job

`$TOKEN` è un token di accesso di amministratore: effettua il login e usa l'`accessToken` restituito dalla risposta di autenticazione. `$API_URL` corrisponde a quanto stampato da `rebase dev` — la porta viene calcolata in base al percorso del progetto, quindi non ce n'è una fissa.

```bash
curl -H "Authorization: Bearer $TOKEN" "$API_URL/api/admin/cron"
```

```json
{
    "jobs": [
        {
            "id": "health-check",
            "name": "System Health Check",
            "schedule": "*/5 * * * *",
            "enabled": true,
            "state": "idle",
            "totalRuns": 12,
            "totalFailures": 0,
            "lastRunAt": "2026-04-24T08:15:00.000Z",
            "nextRunAt": "2026-04-24T08:20:00.000Z",
            "lastDurationMs": 3
        }
    ]
}
```

### Job non presenti

Un job che non viene mai attivato non è presente in `jobs` — nulla lo ha registrato — quindi "il mio cron manca" e "il mio cron non verrà mai eseguito" appaiono identici da questo endpoint a meno che non indichi diversamente. Ed è così:

```json
{
    "jobs": [],
    "skipped": 2,
    "rejected": [
        {
            "id": "nightly-report",
            "name": "Nightly report",
            "schedule": "0 0 3 * * *",
            "reason": "Expected 5 fields, got 6"
        }
    ],
    "note": "1 cron file(s) failed to load and 1 job(s) have an invalid schedule — NOT scheduled. See `rejected` for the reason; the server log has the rest."
}
```

`rejected` riporta il nome del job e il motivo. Un file che non è stato possibile *caricare* ha solo un conteggio: l'errore si è verificato prima che ci fosse un job da nominare, quindi il motivo si trova nei log del server.

Il caso più comune è quello sopra indicato: sei campi, derivati da un'espressione copiata da uno strumento che supporta i secondi. Rebase ne accetta cinque; rimuovi il primo campo. Qui compare anche un `timeoutSeconds` pari a zero, negativo o `NaN`.

### Esempio: Avviare manualmente un job

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

Mentre il job è in esecuzione — qui o in qualsiasi altro processo —, la risposta
è `409` con il codice `CRON_JOB_ALREADY_EXECUTING`; vedi
[Protezione della concorrenza](/docs/backend/cron-across-instances/#concurrency-guarding).

### Mettere in pausa un job

<span class="since-badge" data-since="0.23">Since 0.23</span> Una pausa da Studio o tramite
`PUT /api/admin/cron/:id` vale per ogni processo e resta valida dopo riavvii e
nuovi deploy; `{ "enabled": null }` restituisce il job all'`enabled` dichiarato
nel suo file. Come ogni replica la legge, e cosa succede quando una non può, è
descritto in [Cron su più istanze](/docs/backend/cron-across-instances/#pausing-a-job-across-every-process).

## SDK Client

L'SDK client di Rebase espone un namespace `cron` per tutte le operazioni:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// List all jobs
const { jobs } = await client.cron.listJobs();

// Get a single job
const { job } = await client.cron.getJob("health-check");

// Trigger manually
const { log, job: updated } = await client.cron.triggerJob("health-check");

// View execution history
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Enable or disable
await client.cron.toggleJob("health-check", false); // pause
await client.cron.toggleJob("health-check", true);  // resume
```

## Dashboard di Studio

Quando i cron job sono configurati, lo strumento **Cron Jobs** compare in Rebase Studio sotto la voce **Compute**, accanto alla console JS. La dashboard offre:

- **Elenco dei job** — Tutti i job registrati con indicatori di stato in tempo reale
- **Pannello dettagli** — Pianificazione, esecuzione successiva/precedente, durata e informazioni sugli errori
- **Cronologia delle esecuzioni** — Voci di log espandibili con l'output acquisito e i risultati
- **Avvio manuale** — Esegui qualsiasi job su richiesta con un solo clic
- **Abilita/disabilita** — Metti in pausa e riprendi i job senza riavviare il server, per tutti i processi insieme; una pausa resta valida dopo riavvii e deploy

La dashboard si aggiorna automaticamente ogni 15 secondi.

Il pannello mostra la stessa cosa qualunque processo lo serva. Un job che un
altro processo sta eseguendo appare in esecuzione, e su un processo il cui
scheduler non è avviato — il ruolo `api` accanto a un worker — il numero di
esecuzioni, il numero di errori e l'ultima esecuzione vengono letti da
`rebase.cron_logs`, con una query limitata alle righe di ciascun job, anziché da
un processo che non esegue nulla.

## Validazione della pianificazione e parsing dell'AST

All'inizializzazione del backend, Rebase analizza tutte le pianificazioni cron registrate utilizzando un espansore cron basato su JS privo di dipendenze:
- **Controllo della sintassi**: verifica che la stringa contenga esattamente 5 campi separati da spazi (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Espansione degli intervalli**: scompone passi (`*/15`), intervalli (`9-17`) ed elenchi separati da virgole (`0,30`) in array espliciti di interi validi mappati sui rispettivi limiti (ad es. minuti `0-59`, ore `0-23`, mesi `1-12`).
- Se un'espressione cron non supera la validazione, Rebase rifiuta la definizione, registra un errore all'avvio e rifiuta di registrare il job per prevenire errori di esecuzione a runtime.

---

## Dietro le quinte: Correzione della deviazione dell'orologio (Clock Drift)

Gli scheduler standard basati su intervalli (come `setInterval`) tendono a deviare nel tempo e causano picchi significativi di CPU a causa dei ritardi di scheduling dell'event loop a livello di sistema operativo. Per garantire la precisione di esecuzione, Rebase implementa un **ciclo dinamico di calcolo dell'orario target**:
1. **Calcolo del candidato**: al completamento di un job o all'avvio dello scheduler, Rebase calcola il timestamp esatto del minuto candidato *successivo* corrispondente.
2. **Sleep dinamico**: calcola la differenza in millisecondi (`nextRun.getTime() - now.getTime()`) e pianifica un singolo `setTimeout`.
3. **Soglia di sicurezza per il drift**: viene applicato un buffer di attesa minimo (`MIN_SCHEDULE_INTERVAL_MS`) di **5.000 ms**. Se un tick dello scheduler si completa molto rapidamente, questa soglia impedisce una doppia esecuzione quasi istantanea.
4. **Facilità di arresto**: gli handle dei timer vengono esplicitamente scollegati dall'event loop di Node.js tramite `timer.unref()`, assicurando che gli scheduler cron in background non blocchino la chiusura pulita dei processi durante i deploy.

---

## Più di un processo

Ogni processo il cui scheduler è attivo arma gli stessi timer; il database decide
quale di essi esegue ciascuno slot. Come uno slot viene eseguito una sola volta,
come si recupera uno slot perso per un riavvio, come una pausa raggiunge ogni
replica e perché un avvio manuale non viene mai eseguito accanto a uno
pianificato è descritto in [Cron su più istanze](/docs/backend/cron-across-instances).

---

## Timeout e isolamento degli errori

- **Forced Timeout Race**: I blocchi di esecuzione sono racchiusi in una `Promise.race` con un timer di timeout derivato da `timeoutSeconds` (predefinito: `300` secondi / 5 minuti; `Infinity` per nessun timeout). Se l'handler si blocca oltre questa soglia, `ctx.signal` viene interrotto e la promise viene rifiutata, generando:
  `Error: Cron job "<id>" timed out after <N>ms`
  L'abort è la metà che interrompe il *lavoro*; il rifiuto interrompe solo l'attesa dello scheduler. Un handler che ignora `ctx.signal` continuerà a essere eseguito oltre la sua stessa esecuzione.
- **Arresto**: `backend.shutdown()` attende un'esecuzione in corso, entro lo stesso budget della coda dei job (due terzi del timeout di arresto). Se l'esecuzione è ancora in corso quando il budget si esaurisce, `ctx.signal` viene interrotto e l'esecuzione viene registrata come fallita, con il motivo. Il suo slot resta reclamato, quindi nessun'altra istanza la riesegue.
- **Try/Catch a prova di errore**: Ogni job handler viene eseguito all'interno di un wrapper isolato. Eventuali eccezioni non rilevate vengono intercettate, formattando il traceback dell'errore in una stringa, impostando lo stato del job su `"error"` e aggiornando i contatori dei fallimenti in `rebase.cron_logs`. Un arresto anomalo all'interno di un singolo cron task non causerà mai il crash del ciclo dello scheduler né del server web HTTP principale Hono.
- **Ring buffer in memoria**: Lo scheduler mantiene un ring buffer contenente le ultime **50 esecuzioni** per ogni job. Questo buffer viene conservato in memoria per consentire letture quasi istantanee da Rebase Studio.

---

## Schema di persistenza nel database

Quando sono attivi gli adapter del database con supporto SQL (ad es. PostgreSQL), Rebase esegue il provisioning della tabella `rebase.cron_logs`:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.cron_logs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL,
    duration_ms  INTEGER NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT true,
    error        TEXT,                                 -- Stack trace or error message
    result       JSONB,                                -- Return value of handler
    logs         JSONB,                                -- Ring buffer array of ctx.log outputs
    manual       BOOLEAN NOT NULL DEFAULT false        -- True if triggered from Studio/REST
);

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_logs_job_failures ON rebase.cron_logs(job_id) WHERE NOT success;

CREATE TABLE IF NOT EXISTS rebase.cron_job_state (
    job_id         TEXT PRIMARY KEY,
    enabled        BOOLEAN,       -- NULL: follow the job's own `enabled`
    updated_at     TIMESTAMPTZ,   -- when `enabled` was last set, and by whom
    updated_by     TEXT,
    running_until  TIMESTAMPTZ,   -- the run lease: live while in the future
    running_by     TEXT
);
```

Ognuna viene creata all'avvio se manca, così un database che la precede la
ottiene al deploy successivo. Nessuna è una collection, e il ruolo utente finale
`rebase_user` non ha alcun privilegio su di esse: un `cron_job_state` scrivibile
permetterebbe a un utente autenticato di mettere in pausa un job per tutti, o di
trattenerne il lease così che nulla lo esegua.

All'avvio, lo scheduler legge le statistiche da questa tabella tramite query aggregate (`COUNT(*)`, `SUM(CASE WHEN success = false THEN 1 ELSE 0 END)`) per popolare la cronologia di `totalRuns` e `totalFailures`. Gli inserimenti dei log vengono eseguiti tramite un passaggio asincrono non bloccante; se un flush nel database fallisce, lo scheduler registra l'errore e prosegue la normale esecuzione usando il ring buffer in memoria come fallback.

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

## I cron nel grafo delle risorse

Ogni file di cron è anche una dichiarazione. `rebase resources` lo elenca con il nome del file — lo stesso ID con cui lo esegue lo scheduler e con cui compare in Studio — insieme alla sua pianificazione e al fuso orario, consentendo all'host di leggere le pianificazioni del progetto prima di eseguire qualsiasi elemento. Un cron non si collega ad alcuna variabile d'ambiente; `rebase status` lo mostra verde, senza nulla da configurare.

Leggere la pianificazione significa importare il file, e `rebase resources` è un passaggio di build: nessun file `.env`, nessun secret. Mantieni quindi l'**ambito del modulo** (module scope) di un cron libero da qualsiasi operazione che legga la configurazione all'importazione — ad esempio un client di database istanziato all'inizio di un helper o un `env.ts` che valida `DATABASE_URL`. Importa invece tali operazioni all'interno dell'handler:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

L'handler viene eseguito nel deployment, dove tali variabili sono presenti. Un'importazione di livello superiore dello stesso modulo rende il grafo derivabile solo su una macchina che possiede casualmente un file `.env` — e carica l'intera dipendenza a ogni avvio anche solo per registrare il job.

## Passaggi successivi

- **[Panoramica del Backend](/docs/backend)** — Riferimento completo alla configurazione del backend
- **[Callback delle Entità](/docs/collections/callbacks)** — Esegui logica alle modifiche dei dati
- **[Integrazione Webhook](/docs/recipes/webhooks)** — Invia notifiche sugli eventi
- **[Cron su più istanze](/docs/backend/cron-across-instances)** — Un'esecuzione per slot, slot mancati, pausa ovunque ed esecuzioni sovrapposte
