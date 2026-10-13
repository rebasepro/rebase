---
title: Cron Jobs
sidebar_label: Cron Jobs
description: Schedule recurring background tasks with Rebase's built-in cron job system. Define jobs as TypeScript files, monitor them in Studio, and manage them via the REST API.
---

## Overview

Rebase includes a built-in **cron job scheduler** for running recurring background tasks — data cleanup, report generation, health checks, external API syncs, and more.

Cron jobs follow the same **file-based discovery** pattern as custom functions: drop a TypeScript file in your `crons/` directory, and Rebase automatically registers and schedules it.

- **Zero dependencies** — No external scheduler libraries required
- **Admin API** — REST endpoints to list, trigger, enable/disable, and view logs
- **Studio dashboard** — Monitor all jobs, view execution history, and trigger runs manually
- **Database persistence** — Execution logs stored in PostgreSQL, surviving restarts
- **In-memory cache** — Fast ring buffer (last 50 runs) for the dashboard, backed by the DB

## Defining a Cron Job

Create a file in your `backend/crons/` directory that default-exports a cron definition. Use the `defineCron` helper from `@rebasepro/server` for type inference and autocomplete:

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

`rebase dev` watches the crons directory, so a job added while it is running is
registered on the next reload — no restart. (It has to be told: the directory is
scanned rather than imported, so the watcher cannot infer it.)

:::note
`defineCron` is an identity function — it returns the same object you pass in. A plain default-exported `CronJobDefinition` object works identically; `defineCron` simply provides compile-time type checking and editor autocomplete.
:::

The **filename** (without extension) becomes the job's unique ID — e.g., `health-check`.


## Configuration

:::note[Where this goes]
**Managed runtime** — put the files in `backend/crons/`; the runtime discovers that directory on its own, and `entry.crons` in `rebase.json` is only needed if you moved it. `REBASE_CRON_SCHEDULER` in `.env` decides whether *this* process runs the timers.

**Ejected** — `cronsDir` on `initializeRebaseBackend({ … })`, as below.

The full map is in [Backend Overview](/docs/backend/#where-each-option-lives).
:::

Enable cron jobs by adding `cronsDir` to your backend config:

```typescript no-verify
const instance = await initializeRebaseBackend({
    // ... other config
    functionsDir: path.resolve(__dirname, "../functions"),
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

That's it. Rebase will:

1. Scan the directory for `.ts` / `.js` files
2. Register each default export as a cron job
3. Auto-create the `rebase.cron_logs`, `rebase.cron_claims` and `rebase.cron_job_state` tables in PostgreSQL (if the driver supports SQL)
4. Start the scheduler and seed counters from existing DB logs
5. Mount admin REST routes at `/api/admin/cron`

## Schedule Syntax

Cron expressions use the standard **5-field format**:

```
┌───────────── minute (0–59)
│ ┌─────────── hour (0–23)
│ │ ┌───────── day of month (1–31)
│ │ │ ┌─────── month (1–12)
│ │ │ │ ┌───── day of week (0–6, Sunday = 0)
│ │ │ │ │
* * * * *
```

| Expression | Meaning |
|------------|---------|
| `* * * * *` | Every minute |
| `0 * * * *` | Every hour |
| `0 3 * * *` | Daily at 3:00 AM |
| `0 0 * * 1` | Every Monday at midnight |
| `0 9 1 * *` | First day of each month at 9:00 AM |
| `0,30 * * * *` | Every 30 minutes (on :00 and :30) |
| `0 9-17 * * 1-5` | Hourly, 9 AM–5 PM, weekdays only |

Step values (`*/n`), ranges (`a-b`), and lists (`a,b,c`) are all supported.

A schedule is matched against the wall clock of its zone. Across a
daylight-saving change that means a fixed-time job inside the repeated hour
(`30 2 * * *` where clocks fall back at 03:00) runs in both passes of that hour,
and one inside the skipped hour, when clocks spring forward, does not run that
day.

## CronJobDefinition Reference

`timezone` is new — on 0.17.3 a schedule is always read in the
host's own zone. Everything else on this interface has shipped.

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

## Handler Context

Each handler receives a `CronJobContext` containing utility methods and the Rebase Client instance:

```typescript no-verify
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The scheduled tick timestamp
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

Use `ctx.log()` to emit structured output. These lines are captured in the execution log and visible in Studio and via the REST API. Each line is also written to the server log at `info` level with a `cron` field holding the job ID, so it shows up wherever your container's output is collected, including Rebase Cloud's debug logs. That copy is redacted the way the server's own log lines are: the values of keys such as `password` or `apiKey`, and the SQL and parameters of a failed query, are replaced. The execution log stores the line without that redaction.

<span class="since-badge" data-since="0.25">Since 0.25</span> The execution log keeps a run's first 500 lines or 64 KB of them, whichever comes first, and then one line saying how many more there were: `… 9500 more lines not kept — see the server log`. The server log gets every line. A job that logs one line per item it processes should expect its history to show the start of the run.

### `ctx.signal` — stop the work when the run stops

The timeout ends the *run*: the scheduler stops waiting and records a failure.
It does not end the handler. Pass `ctx.signal` to anything that takes one, and
the work stops with it:

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

Without it, a job whose timeout matches its interval leaks one abandoned request
per tick — invisible, because every run is already recorded as failed.

:::note[`ctx.client` was removed]
It was a second name for `ctx.rebase`, and its type re-exposed `client.data` —
the alias `RebaseServerClient` deliberately omits so that the privileged plane
has exactly one name. A reader who learned `client.data` here carried it into a
collection callback, where `context.data` is the *user-scoped* plane: same
spelling, opposite privilege. Use `ctx.rebase.dataAsAdmin`.
:::

### Interacting with the database and services via `ctx.rebase`

`ctx.rebase.dataAsAdmin` is the admin-scoped data plane. A cron has no
per-request user, so there is no user-scoped alternative here — scope every
query's filters yourself.

:::caution[Admin-scoped is not RLS-bypassing]
`dataAsAdmin` is scoped once, at boot, as `{ uid: "service", roles: ["admin"] }`.
Every read and write still runs in a transaction that has done `SET LOCAL ROLE
rebase_user` with `app.uid = 'service'`, and **your policies are evaluated** —
against that identity. It clears the built-in default policies through their
`rolesOverlap(['admin'])` arm, which is why the difference rarely shows. It
shows when you write your own: `policy.serverContext()` compiles to
`rebase.uid() IS NULL` and is therefore **false** here, so a collection with
`disableDefaultPolicies: true` whose only rule is `serverContext()` denies these
writes and returns zero rows — HTTP 200, empty — for these reads.

`rebase.sql()` *is* an unconditional bypass: owner connection, no policies.
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
The handler can return any JSON-serializable value. It will be stored in the log entry as `result` and displayed in Studio's execution history.
:::

## REST API

Listing, triggering, pausing and resuming jobs over HTTP, and the typed SDK's `client.cron`, are on [Cron Jobs API](/docs/backend/cron-jobs-api/).

## Studio Dashboard

When cron jobs are configured, a **Cron Jobs** tool appears in Rebase Studio under **Compute**, beside the JS console. The dashboard provides:

- **Job list** — All registered jobs with live status indicators
- **Detail panel** — Schedule, next/last run, duration, and error information
- **Execution history** — Expandable log entries with captured output and results
- **Manual trigger** — Run any job on demand with one click. The panel waits for the run to end and says how it went: a run that failed shows its error
- **Enable/disable** — Pause and resume jobs without restarting the server, for every process at once; a pause stays in place across restarts and deploys
- **Jobs that are not there** — each job the scheduler refused, with its schedule and the reason, and how many cron files failed to load. None of them is scheduled; see [Jobs that are not there](/docs/backend/cron-jobs-api/#jobs-that-are-not-there)

The dashboard auto-refreshes every 15 seconds.

The panel shows the same thing whichever process serves it. A job another
process is running shows as running.
On every process that has a store, the run count, the failure count and the last run are read from the database, where every process's runs are counted. A process's own counters hold only the runs it made: the `api` role beside a worker runs nothing, and of two replicas that both schedule, neither sees the slots the other one claimed. Only when the database cannot be read does the card fall back to this process's own counters, with a warning in the server log.

<span class="since-badge" data-since="0.25">Since 0.25</span> The counts are all-time; the history is the last 30 days. Each run's row in `rebase.cron_logs` is deleted 30 days after it started, by an hourly sweep, while the run and failure counts keep counting it. A skipped run counts as a run, as it always has: it is a row of the history.

## Schedule Validation & AST Parsing

At backend initialization, Rebase parses all registered cron schedules using a zero-dependency JS-based cron expander:
- **Syntax Check**: Verifies that the string contains exactly 5 whitespace-separated fields (`minute`, `hour`, `day of month`, `month`, `day of week`).
- **Range Expansion**: Deconstructs steps (`*/15`), ranges (`9-17`), and comma-separated lists (`0,30`) into explicit arrays of valid integers mapped to their respective bounds (e.g., minutes `0-59`, hours `0-23`, months `1-12`).
- If any cron expression fails validation, Rebase rejects the definition, logs a startup error, and refuses to register the job to prevent runtime execution failures.

---

## Under the Hood: Clock-Drift Correction

Standard interval-based schedulers (such as `setInterval`) drift over time and cause significant CPU spikes due to OS-level event loop scheduling delays. To guarantee execution accuracy, Rebase implements a **dynamic target-time calculation loop**:
1. **Candidate Calculation**: Upon completing a job or starting the scheduler, Rebase calculates the exact timestamp of the *next* matching candidate minute.
2. **Dynamic Sleep**: It calculates the difference in milliseconds (`nextRun.getTime() - now.getTime()`) and schedules a single `setTimeout`.
3. **Drift Safety Threshold**: A minimum sleep buffer (`MIN_SCHEDULE_INTERVAL_MS`) of **5,000ms** is enforced. If a scheduler tick completes extremely quickly, this threshold prevents near-instant double-firing.
4. **Shutdown Friendliness**: Timer handles are explicitly detached from the Node.js event loop using `timer.unref()`, ensuring background cron schedulers do not block clean process terminations during deployments.

---

## More than one process

Every process whose scheduler is on arms the same timers; the database decides
which of them runs each slot. How a slot runs once, how a slot a restart dropped
is recovered, how a pause reaches every replica, and why a manual trigger never
runs beside a scheduled run are on [Cron across instances](/docs/backend/cron-across-instances).

---

## Timeouts & Error Isolation

- **Forced Timeout Race**: Execution blocks are wrapped in a `Promise.race` against a timeout timer derived from `timeoutSeconds` (default: `300` seconds / 5 minutes; `Infinity` for none). If the handler hangs past this threshold, `ctx.signal` is aborted and the promise is rejected, throwing:
  `Error: Cron job "<id>" timed out after <N>ms`
  The abort is the half that stops the *work*; the rejection only stops the scheduler waiting. A handler that ignores `ctx.signal` keeps running past its own run.
- **Shutdown**: `backend.shutdown()` waits for a run in flight, within the same budget as the job queue (two-thirds of the shutdown timeout). A run still going when it runs out has `ctx.signal` aborted and is recorded as failed, with the reason. Its slot stays claimed, so no other instance re-runs it.
- **Fail-Safe Try/Catch**: Each job handler runs inside an isolated wrapper. Any uncaught exceptions are intercepted, formatting the error traceback into a string, setting the job status to `"error"`, and updating the job's failure counter. A crash inside a single cron task will never crash the scheduler loop or the primary Hono HTTP web server.
- **In-Memory Ring Buffer**: The scheduler maintains a ring buffer containing the last **50 runs** per job. This buffer is kept in memory to allow near-instant reads from Rebase Studio.

---

## Database Persistence Schema

When database adapters supporting SQL (e.g. PostgreSQL) are active, Rebase provisions the `rebase.cron_logs` table:

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

Each is created on boot if it is missing, so a database that predates one gains
it on its next deploy. None of them is a collection, and the end-user role
`rebase_user` has no privilege on any of them: a writable `cron_job_state` would
let a signed-in user pause a job for everyone, or hold its lease so that nothing
runs it.

<span class="since-badge" data-since="0.25">Since 0.25</span> A run's row and its count are written in one statement: the insert into `cron_logs` and an upsert of the job's counters on `cron_job_state`. A listing reads one `cron_job_state` row per job, however long the history, and so does the scheduler when it seeds `totalRuns` and `totalFailures` on startup. Log writes do not hold up the run; if one fails, the scheduler logs the error and carries on, with the run still in the in-memory ring buffer.

Once an hour, and when it starts, the scheduler deletes the history rows older than 30 days and counts any run that is not counted yet, both in batches of 5,000 rows. A history written before 0.24 is counted by the first of these sweeps, off the boot path. Until it has finished, a listing adds the runs it has not counted yet to the counters, so the numbers do not change on upgrade. The same goes for a run an older server logs during a rolling deploy.

## Example: Daily Cleanup Job

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

## Crons in the resource graph

Every cron file is also a declaration. `rebase resources` lists it under the
name of the file — the same id the scheduler runs it as and the Studio shows —
with its schedule and zone, so a host reads a project's schedules before it
runs anything. A cron binds from no environment variable; `rebase status`
shows it green with nothing to configure.

Reading the schedule means importing the file, and `rebase resources` is a build
step: no `.env`, no secrets. So keep a cron's **module scope** free of anything
that reads configuration at import — a database client built at the top of a
helper, an `env.ts` that validates `DATABASE_URL`. Import that work inside the
handler instead:

```ts
async handler({ log }) {
    const { runSeed } = await import("../src/seed.js");
    await runSeed();
    log("done");
}
```

The handler runs in the deployment, where those variables exist. A top-level
import of the same module makes the graph derivable only on a machine that
happens to have a `.env` — and it loads the whole dependency into every boot
that merely registers the job.

## Next Steps

- **[Backend Overview](/docs/backend)** — Full backend configuration reference
- **[Entity Callbacks](/docs/collections/callbacks)** — Run logic on data changes
- **[Webhook Integration](/docs/recipes/webhooks)** — Send notifications on events
- **[Cron across instances](/docs/backend/cron-across-instances)** — One run per slot, missed slots, pausing everywhere, and overlapping runs
