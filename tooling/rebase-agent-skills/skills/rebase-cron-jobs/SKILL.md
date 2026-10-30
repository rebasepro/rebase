---
name: rebase-cron-jobs
description: Guide for scheduling recurring background tasks with Rebase's built-in cron job system. Use this skill when the user needs background jobs, data cleanup, report generation, external API syncing, or any scheduled task.
---

# Rebase Cron Jobs

> **IMPORTANT FOR AGENTS**: Rebase has a **built-in cron scheduler** — do NOT install external libraries (`node-cron`, `agenda`, `bull`) or set up separate worker processes. Drop a TypeScript file in the `backend/crons/` directory.

> **IMPORTANT FOR AGENTS**: Every cron handler receives `ctx.rebase` — the server-side Rebase singleton, the same object `import { rebase } from "@rebasepro/server"` returns inside the run: the backend running the job (0.25+; with several backends in one process, each job sees its own). `ctx.rebase.dataAsAdmin` is **THE** primary way cron jobs read/write data. Always use it in examples, never raw SQL or direct DB imports. `ctx.client` was the old name for the same object and has been removed — a handler that destructures `client` no longer compiles.

## Overview

Rebase includes a built-in cron job scheduler for running recurring background tasks. Cron jobs follow the **file-based discovery** pattern — drop a TypeScript file in `crons/`, and it's automatically registered and scheduled.

- **Zero dependencies** — No external scheduler libraries needed
- **`ctx.rebase`** — the server-side Rebase singleton: `dataAsAdmin` for CRUD, plus `email`, `storage`, `sql`, …
- **Concurrency guard** — A job that's still running is skipped, never double-executed
- **Timeout enforcement** — Handlers are raced against a configurable timeout
- **Studio dashboard** — Monitor all jobs, view execution history, trigger manually
- **Admin REST API** — List, trigger, enable/disable, and view logs
- **Database persistence** — Execution logs stored in `rebase.cron_logs` (PostgreSQL)

## Setup

**Nothing to enable in a scaffolded project.** Create `backend/crons/` and drop a file in it: `rebase dev`, `rebase build` and the runtime discover that directory on their own, and the backend app's `crons` key in `rebase.json` moves it if you need to. There is no `backend/src/index.ts` to edit.

Only an **ejected** project, or a server you wire yourself, hands the jobs to
the backend — as values, or as a directory:

```typescript
import path from "node:path";
import { defineCron, initializeRebaseBackend, loadCrons } from "@rebasepro/server";
import { createPostgresAdapter, createPostgresDatabaseConnection } from "@rebasepro/server-postgres";

const { db, connectionString } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);

const nightlyReport = defineCron({
    schedule: "0 3 * * *",
    async handler(ctx) {
        const { data } = await ctx.rebase.dataAsAdmin.collection("orders").find({ limit: 100 });
        return { orders: data.length };
    }
});

await initializeRebaseBackend({
    app,
    server,
    database: createPostgresAdapter({ connection: db, connectionString }),
    // Values (new in 0.25): the key is the job id.
    crons: { "nightly-report": nightlyReport },
    // Or every file in a directory, read into that same { id: definition } shape:
    //     crons: await loadCrons(path.resolve("backend/crons")),
    // Or the directory itself, which works on every version:
    //     cronsDir: path.resolve("backend/crons"),
    cronPersistence: false   // keep run logs in memory only
});
```

### Configuration Options (ejected / custom server)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `crons` | `Record<string, CronJobDefinition>` | — | New in 0.25. Jobs as values, keyed by job id. `await loadCrons(dir)` returns this shape. |
| `cronsDir` | `string` | — | Absolute path to the directory containing cron job files. The same as `crons: await loadCrons(dir)`. The runtime sets it from `rebase.json`; pass it yourself only on a hand-wired server. Passing both `crons` and `cronsDir` is refused at boot. |
| `cronPersistence` | `boolean` | `true` | Enable/disable database persistence for execution logs. When `false`, logs are kept in-memory only. |

**Building the backend registers the jobs; `start()` schedules them.**
`initializeRebaseBackend` calls `start()` for you. A backend built with
`createRebaseBackend` (0.25+) runs no job until you call `backend.start()` —
leave it out on a process that should serve requests but not run the schedule.

**Loading declares nothing** (0.25+). `loadCrons(dir)` returns the definitions
as written. To record them in the project's resource graph — what
`rebase resources` lists — call `declareCrons(crons)` on them:

```typescript
import { declareCrons, loadCrons } from "@rebasepro/server";

const problems: string[] = [];
declareCrons(await loadCrons("backend/crons", { onSkip: (problem) => problems.push(problem) }));
```

`loadCronJobsFromDirectory` and `loadCronJobsWithDiagnostics` are deprecated:
they still work (and still declare, as before), warn once per process, and
`loadCrons` with `declareCrons` replaces them.

### What Happens on Startup

Rebase will:
1. Scan the directory for `.ts` / `.js` files (or take the `crons` values as given)
2. **Validate** each job's cron schedule, `timezone` and `timeoutSeconds` — a job that fails is rejected with an error log, NOT registered, and listed under `rejected` on `GET /api/admin/cron`
3. Register each default export as a cron job
4. Use the filename as the job id — so two files with one name and different extensions (`x.ts`, `x.js`) are one job, not two; keep one
5. Auto-create the `rebase.cron_logs`, `rebase.cron_claims` and `rebase.cron_job_state` tables in PostgreSQL (unless `cronPersistence: false`, or the backend was built with `provision: false`)
6. Mount admin REST routes at `/api/admin/cron` (reads need the `cron:read` scope, trigger/pause need `cron:write`)
7. Seed in-memory counters (`totalRuns`, `totalFailures`, `lastRunAt`) from the database
8. Start the scheduler — `backend.start()`, which `initializeRebaseBackend` calls for you

## Defining a Cron Job

Create a file in your `backend/crons/` directory that default-exports a `CronJobDefinition`:

```typescript
// backend/crons/cleanup-sessions.ts
import type { CronJobDefinition } from "@rebasepro/types";

const job: CronJobDefinition = {
    schedule: "0 3 * * *",         // daily at 3 AM
    name: "Cleanup Expired Sessions",
    description: "Removes sessions older than 30 days",
    timeoutSeconds: 60,            // max execution time (default: 300)

    async handler(ctx) {
        ctx.log("Starting session cleanup...");

        // ✅ Use ctx.rebase.dataAsAdmin to interact with your data
        const { data: oldSessions } = await ctx.rebase.dataAsAdmin
            .collection<{ id: string; createdAt: string }>("sessions")
            .find({
                where: { createdAt: ["<", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()] },
                limit: 500,
            });

        for (const session of oldSessions) {
            await ctx.rebase.dataAsAdmin.collection<Record<string, unknown>>("sessions").delete(session.id);
        }

        ctx.log(`Cleaned up ${oldSessions.length} expired sessions`);

        // Return value is stored in the log and shown in Studio
        return { deletedSessions: oldSessions.length };
    },
};

export default job;
```

The **filename** (without extension) becomes the job's unique ID — e.g., `cleanup-sessions`.

### More Examples

#### Sync Data from an External API

```typescript
// backend/crons/sync-exchange-rates.ts
import type { CronJobDefinition } from "@rebasepro/types";

const job: CronJobDefinition = {
    schedule: "0 */6 * * *",       // every 6 hours
    name: "Sync Exchange Rates",
    description: "Pulls latest rates from Open Exchange Rates API",
    timeoutSeconds: 30,

    async handler(ctx) {
        const res = await fetch("https://api.exchangerate.host/latest");
        const data = await res.json();

        ctx.log("Fetched rates for", Object.keys(data.rates).length, "currencies");

        // Upsert into your collection using ctx.rebase.dataAsAdmin
        for (const [currency, rate] of Object.entries(data.rates)) {
            const existing = await ctx.rebase.dataAsAdmin
                .collection<{ id: string; currency: string; rate: number }>("exchange_rates")
                .find({
                    where: { currency: ["==", currency] },
                    limit: 1,
                });

            if (existing.data.length > 0) {
                await ctx.rebase.dataAsAdmin.collection<Record<string, unknown>>("exchange_rates").update(existing.data[0].id, {
                    rate: rate as number,
                    updatedAt: new Date().toISOString(),
                });
            } else {
                await ctx.rebase.dataAsAdmin.collection<Record<string, unknown>>("exchange_rates").create({
                    currency,
                    rate: rate as number,
                });
            }
        }

        return { currenciesUpdated: Object.keys(data.rates).length };
    },
};

export default job;
```

#### Send Daily Digest Emails

```typescript
// backend/crons/daily-digest.ts
import type { CronJobDefinition } from "@rebasepro/types";

const job: CronJobDefinition = {
    schedule: "0 8 * * 1-5",      // 8 AM weekdays
    name: "Daily Digest",
    description: "Sends a summary email to all users with unread notifications",
    timeoutSeconds: 120,

    async handler(ctx) {
        const { data: users } = await ctx.rebase.dataAsAdmin
            .collection<{ id: string; email: string; digestEnabled: boolean }>("users")
            .find({
                where: { digestEnabled: ["==", true] },
            });

        let sent = 0;
        for (const user of users) {
            const { data: notifications } = await ctx.rebase.dataAsAdmin
                .collection<Record<string, unknown>>("notifications")
                .find({
                    where: { userId: ["==", user.id], read: ["==", false] },
                });

            if (notifications.length > 0) {
                ctx.log(`Sending digest to ${user.email} (${notifications.length} unread)`);
                // Send email via your preferred method
                sent++;
            }
        }

        return { emailsSent: sent, usersChecked: users.length };
    },
};

export default job;
```

## CronJobDefinition Interface

```typescript
interface CronJobDefinition {
    schedule: string;           // Cron expression (5-field)
    timezone?: string;          // IANA zone the schedule is read in (default: the process's own zone)
    name?: string;              // Human-readable name for Studio (default: the job id)
    description?: string;       // Optional description
    enabled?: boolean;          // Start enabled? (default: true)
    timeoutSeconds?: number;    // Max execution time (default: 300; Infinity for none)
    catchUpWindowSeconds?: number; // Run a slot missed while no instance was ticking (default: off)
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `schedule` | `string` | — | Standard 5-field cron expression. **Validated on registration** — invalid expressions are rejected. |
| `timezone` | `string?` | process zone | IANA zone, e.g. `"Europe/Madrid"`. Without it the schedule is read in the host's zone — UTC in nearly every container. An unknown zone is rejected when the job loads. |
| `name` | `string?` | the job id | Human-readable name shown in Studio UI and API responses. |
| `description` | `string?` | `undefined` | Optional description shown in Studio. |
| `enabled` | `boolean?` | `true` | Whether the job starts enabled. A pause or resume from Studio or the Admin API overrides it, for every process, until reset with `{ "enabled": null }`. |
| `timeoutSeconds` | `number?` | `300` | Maximum seconds the handler may run before being timed out. `Infinity` means no timeout; `0`, a negative number or `NaN` is rejected when the job loads. |
| `catchUpWindowSeconds` | `number?` | off | On startup, run the most recent slot inside this window that no instance claimed. Needs a claims-capable store (PostgreSQL with `cronPersistence` on). |
| `handler` | `(ctx) => Promise<unknown> \| unknown` | — | The function executed on each tick. May return JSON-serialisable data stored in the log. |

## CronJobContext (Handler Argument)

> **IMPORTANT FOR AGENTS**: `ctx.rebase` **is** the server singleton, not a copy of it. Its data plane (`dataAsAdmin`) is backed by the native DataDriver — no JSON serialization, no HTTP dispatch, no middleware — while the control plane (`auth`, `admin`, `cron`, `functions`) reaches the backend's own routes in-process, with no HTTP server involved; `storage` and `email` call their controllers directly. Use `rebase.dataAsAdmin` for all data operations inside cron handlers.

```typescript
interface CronJobContext {
    /** The job's unique ID (derived from filename). */
    jobId: string;

    /** The slot this run fires for (a catch-up: the slot it missed; a manual trigger: when it started). */
    scheduledAt: Date;

    /** A simple logger scoped to this job run — output captured in the execution log and written to the server log. */
    log: (...args: unknown[]) => void;

    /** Aborted when the run exceeds `timeoutSeconds`. Pass it to `fetch` and friends. */
    signal: AbortSignal;

    /** The server-side Rebase singleton — data, email, storage, raw SQL. */
    rebase: RebaseServerClient;

}
```

| Property | Type | Description |
|----------|------|-------------|
| `jobId` | `string` | Derived from the filename (e.g. `cleanup-sessions`). |
| `scheduledAt` | `Date` | The slot this run fires for: a catch-up run gets the slot it missed, a manual trigger the moment it started. |
| `log` | `(...args: unknown[]) => void` | Logger whose output is captured in `CronJobLogEntry.logs`. Use like `console.log`. |
| `signal` | `AbortSignal` | Aborted when the run exceeds `timeoutSeconds`. The timeout stops the scheduler waiting; only this stops the work. Pass it to `fetch`. |
| `rebase` | `RebaseServerClient` | The server singleton. `rebase.dataAsAdmin` for CRUD, `rebase.email`, `rebase.storage`, `rebase.sql`. |

> **IMPORTANT FOR AGENTS:** `ctx.rebase.dataAsAdmin` is scoped as the **service identity** (`uid: "service"`, `roles: ["admin"]`). Callbacks live in the driver, not in the route layer, so DataHooks and Collection Callbacks still run on this path even though the HTTP loop is skipped. This means:
> - Collection Callbacks will see `context.user.uid === "service"` and `context.user.roles` containing `"admin"`
> - If your callbacks implement PII masking or role-based filtering, they should check for admin/service roles and skip masking for server-internal reads
> - The service identity does **not** bypass RLS policies. The driver is scoped with `withAuth({ uid: "service", roles: ["admin"] })`, so statements run as the restricted `rebase_user` role and your policies are evaluated against that identity — it clears the default policies through their `rolesOverlap(['admin'])` arm, and `policy.serverContext()` (`rebase.uid() IS NULL`) is **false** for it. `rebase.sql()` is the real bypass: owner connection, no policies.

### Using `ctx.rebase`

`ctx.rebase` is the server singleton. Its data plane is `dataAsAdmin`:

```typescript
async handler(ctx) {
    // Collection CRUD
    const { data } = await ctx.rebase.dataAsAdmin.collection("orders").find({ limit: 100 });
    await ctx.rebase.dataAsAdmin.collection("orders").update(id, { status: "archived" });
    await ctx.rebase.dataAsAdmin.collection("orders").delete(id);
    await ctx.rebase.dataAsAdmin.collection("metrics").create({ key: "daily_total", value: 42 });

    // Filtering and sorting — `where` takes [operator, value] tuples, and the key is
    // `orderBy`, not `sort`.
    const { data: stale } = await ctx.rebase.dataAsAdmin.collection("tokens").find({
        where: { expiresAt: ["<", new Date().toISOString()] },
        orderBy: ["createdAt", "desc"],
        limit: 500,
    });

    // Logging
    ctx.log("Processed", data.length, "records");
}
```

## Schedule Syntax (Cron Expressions)

Standard 5-field cron format: `minute hour day-of-month month day-of-week`

| Expression | Meaning |
|------------|---------|
| `* * * * *` | Every minute |
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Every hour |
| `0 3 * * *` | Daily at 3:00 AM |
| `0 0 * * 1` | Every Monday at midnight |
| `0 9 1 * *` | First of each month at 9 AM |
| `0 9-17 * * 1-5` | Hourly, 9 AM–5 PM, weekdays |

### Supported Field Syntax

| Syntax | Example | Meaning |
|--------|---------|---------|
| `*` | `* * * * *` | Every value in the field's range |
| `N` | `30 * * * *` | Exact value |
| `N-M` | `9-17` | Range (inclusive) |
| `*/S` | `*/5` | Every S values starting from the field minimum |
| `N/S` | `10/15` | Every S values starting from N |
| `N-M/S` | `0-30/5` | Every S values within range N–M |
| `A,B,C` | `0,15,30,45` | Comma-separated list (combinable with above) |

When both day-of-month and day-of-week are restricted, a day matching **either** matches, as in standard cron: `0 9 1 * 1` runs on every 1st and every Monday. When either field starts with `*` (`*/2` included), a day must match both.

### Schedule Validation

Schedules are **validated on registration**. Invalid expressions are rejected with an error log and the job is **not** registered; it is listed under `rejected` on `GET /api/admin/cron`, with the reason (most often `Expected 5 fields, got 6`). Validation checks:

- Exactly 5 fields (minute, hour, day-of-month, month, day-of-week)
- All values within valid ranges: minute `0–59`, hour `0–23`, dom `1–31`, month `1–12`, dow `0–6`
- No unparseable tokens: every number, range bound and step is a whole number (`5abc`, `*/5x`, `1.5` are refused), and no range runs backwards (`5-1`)

### Minimum Schedule Interval

A **5-second minimum delay** is enforced between scheduled executions. Even if a cron expression would produce a sub-5-second gap (due to event loop jitter or clock drift), the scheduler clamps the delay to at least 5000ms. This prevents tight re-execution loops.

## Concurrency Guard

> **WARNING FOR AGENTS**: A cron job **never** runs two instances concurrently — on this process or, through the run lease on `rebase.cron_job_state`, on any other. If a scheduled tick fires while the previous run is still executing, it is **skipped** (not queued) and the skip is recorded in the run history. The scheduler re-schedules for the next tick.

This also applies to **manual triggers** via `POST /api/admin/cron/:id/trigger`. If the job is currently executing, the API answers `409` with the code `CRON_JOB_ALREADY_EXECUTING`; `error.details.log` carries the recorded skip:

```json
{
  "error": {
    "message": "Cron job \"my-job\" is already executing — try again when that run has finished",
    "code": "CRON_JOB_ALREADY_EXECUTING",
    "details": {
      "log": {
        "jobId": "my-job",
        "durationMs": 0,
        "success": true,
        "result": { "skipped": true, "reason": "already_executing" },
        "logs": ["Skipped: the previous run has not finished"],
        "manual": true
      }
    }
  }
}
```

## Timeout Behavior

Each handler invocation is **raced** against a timeout: when it fires, `ctx.signal` is aborted and the race rejects.

```typescript
const timeout = (job.timeoutSeconds ?? 300) * 1000;
const result = await Promise.race([handlerPromise, abortedPromise]);
```

- Default timeout: **300 seconds** (5 minutes); `timeoutSeconds: Infinity` means none
- If the timeout fires first, the job is marked as **failed** with error `Cron job "<id>" timed out after <N>ms`. The handler itself keeps running unless it honours `ctx.signal`
- The timeout timer is always cleaned up via `clearTimeout`, even on success or error
- The `executing` flag is always cleared in a `finally` block, so the concurrency guard recovers correctly

## Persistence

### Database Persistence (`rebase.cron_logs`)

When `cronPersistence` is `true` (default) and the data driver supports SQL, Rebase automatically creates and uses a `rebase.cron_logs` table:

```sql
CREATE TABLE rebase.cron_logs (
    id           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    job_id       TEXT NOT NULL,
    started_at   TIMESTAMPTZ NOT NULL,
    finished_at  TIMESTAMPTZ NOT NULL,
    duration_ms  INTEGER NOT NULL,
    success      BOOLEAN NOT NULL DEFAULT true,
    error        TEXT,
    result       JSONB,
    logs         JSONB,
    manual       BOOLEAN NOT NULL DEFAULT false
);

-- Index for efficient per-job log queries
CREATE INDEX idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
```

Two more tables are created beside it: `rebase.cron_claims` (one row per job and slot, so one instance runs each slot) and `rebase.cron_job_state` (the pause override, the run lease and the counters). The end-user role `rebase_user` has no privilege on any of them.

Log persistence is **non-blocking** — if the database insert fails, the error is logged but the scheduler continues normally.

The history keeps **30 days**: an hourly sweep deletes older rows in batches. The run and failure counts are all-time — they live on `rebase.cron_job_state` (`total_runs`, `total_failures`, `last_run_at`, …), written in the same statement as each run's row, and a listing reads one row per job.

### In-Memory Ring Buffer

Regardless of database persistence, the scheduler keeps an **in-memory ring buffer** of the last **50 log entries per job**. The REST API reads it when no store is attached (no SQL, or `cronPersistence: false`). With a store, a history read that fails answers `503` rather than this process's buffer.

### Fallback Behavior

| Driver | Persistence | Behavior |
|--------|-------------|----------|
| PostgreSQL | ✅ DB + memory | Logs written to `rebase.cron_logs` and in-memory buffer |
| PostgreSQL (`cronPersistence: false`) | ❌ Memory only | Logs kept in-memory ring buffer only |
| Non-SQL (e.g. MongoDB) | ❌ Memory only | Warning logged; no DB persistence |

### Startup Seeding

On startup, the scheduler seeds `totalRuns`, `totalFailures`, and `lastRunAt` counters from the counters on `rebase.cron_job_state`. This is **non-blocking** — the scheduler starts immediately and counters are updated asynchronously.

## REST API

<!-- docs-verify: ignore -->
All routes are mounted at `/api/admin/cron`. `GET` routes need the **`cron:read`** scope; `POST /:id/trigger` and `PUT /:id` need **`cron:write`**. `/api/cron` is kept alive as a legacy alias and answers with a `Deprecation` header; write the `/api/admin` path.

> **IMPORTANT FOR AGENTS**: The caller needs the scope, whoever it is: an admin (holds every scope), a person whose role declares `cron:read`/`cron:write` under `auth.roles` on the users collection, the service key, or an API key minted with them — the right credential for an external scheduler: `rebase api-keys create --name "Scheduler" --scopes cron:read,cron:write`. Unauthenticated requests get 401; a caller without the scope gets `403 SCOPE_MISSING` with `details.requiredScope`.

### List All Jobs

```
GET /api/admin/cron
```

**Response:** `200 OK`

```json
{
  "jobs": [
    {
      "id": "cleanup-sessions",
      "name": "Cleanup Expired Sessions",
      "description": "Removes sessions older than 30 days",
      "schedule": "0 3 * * *",
      "enabled": true,
      "state": "idle",
      "lastRunAt": "2025-01-15T03:00:00.000Z",
      "nextRunAt": "2025-01-16T03:00:00.000Z",
      "lastDurationMs": 1234,
      "totalRuns": 42,
      "totalFailures": 1
    }
  ]
}
```

A job the scheduler refused (bad schedule, unknown `timezone`, invalid `timeoutSeconds`) is not in `jobs`. When there are any, or cron files failed to load, the listing adds `skipped` (the count), `rejected` (`[{ id, name, schedule, reason }]`) and a `note`.

### Get Single Job

```
GET /api/admin/cron/:id
```

**Response:** `200 OK`

```json
{
  "job": {
    "id": "cleanup-sessions",
    "name": "Cleanup Expired Sessions",
    "description": "Removes sessions older than 30 days",
    "schedule": "0 3 * * *",
    "enabled": true,
    "state": "idle",
    "lastRunAt": "2025-01-15T03:00:00.000Z",
    "nextRunAt": "2025-01-16T03:00:00.000Z",
    "lastDurationMs": 1234,
    "totalRuns": 42,
    "totalFailures": 1
  }
}
```

**Error:** `404 Not Found`

```json
{
  "error": { "message": "Cron job \"unknown-id\" not found", "code": "NOT_FOUND" }
}
```

### Trigger Job Manually

```
POST /api/admin/cron/:id/trigger
```

**Response:** `200 OK`

```json
{
  "log": {
    "jobId": "cleanup-sessions",
    "startedAt": "2025-01-15T12:00:00.000Z",
    "finishedAt": "2025-01-15T12:00:01.234Z",
    "durationMs": 1234,
    "success": true,
    "result": { "deletedSessions": 15 },
    "logs": ["Starting session cleanup...", "Cleaned up 15 expired sessions"],
    "manual": true
  },
  "job": { /* updated CronJobStatus */ }
}
```

> If the job is already executing — here or on any other process — the answer is `409` with the code `CRON_JOB_ALREADY_EXECUTING`.

The call waits for the run to finish. For a job longer than a proxy in front of the server holds a request, add `?async=1`: the answer is `202` with `{ "accepted": true, "startedAt": "…", "job": { … } }` once the run has started, and the outcome lands in the logs as the entry with `"manual": true` and that `startedAt`. `?async` takes `1`, `true`, `0` or `false`; any other value is a `400`.

### Get Job Logs

```
GET /api/admin/cron/:id/logs?limit=10
```

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| `limit` | `number?` | `50` | Maximum number of log entries to return. A non-numeric value is a `400` |

**Response:** `200 OK`

```json
{
  "logs": [
    {
      "jobId": "cleanup-sessions",
      "startedAt": "2025-01-15T03:00:00.000Z",
      "finishedAt": "2025-01-15T03:00:01.234Z",
      "durationMs": 1234,
      "success": true,
      "result": { "deletedSessions": 15 },
      "logs": ["Starting session cleanup...", "Cleaned up 15 expired sessions"],
      "manual": false
    }
  ]
}
```

Logs are returned **newest first**, the last 30 days of them. When a database store is available, logs are fetched from the database — and a read that fails answers `503`, not an empty list; otherwise, the in-memory ring buffer is used as fallback.

### Enable/Disable a Job

```
PUT /api/admin/cron/:id
Content-Type: application/json

{ "enabled": false }
```

**Response:** `200 OK`

```json
{
  "job": {
    "id": "cleanup-sessions",
    "enabled": false,
    "state": "disabled",
    /* ... rest of CronJobStatus */
  }
}
```

The pause applies to every process and survives restarts and redeploys (it is stored on `rebase.cron_job_state`). `{ "enabled": null }` hands the job back to the `enabled` its file declares.

**Error:** `400 Bad Request` (`enabled` missing, or not `true`, `false` or `null`)

```json
{
  "error": { "message": "Missing 'enabled' in body: true or false to override the job's code, or null to follow it again", "code": "BAD_REQUEST" }
}
```

A change the store could not save answers `503` and changes no process.

### API Summary Table

| Method | Path | Request Body | Response Shape |
|--------|------|-------------|----------------|
| `GET` | `/api/admin/cron` | — | `CronJobListing` (`{ jobs: CronJobStatus[], skipped?, rejected?, note? }`) |
| `GET` | `/api/admin/cron/:id` | — | `{ job: CronJobStatus }` |
| `POST` | `/api/admin/cron/:id/trigger` | — | `{ log: CronJobLogEntry, job: CronJobStatus }`; `?async=1` → `202` `CronJobStarted`; `409` while running |
| `GET` | `/api/admin/cron/:id/logs` | — | `{ logs: CronJobLogEntry[] }` |
| `PUT` | `/api/admin/cron/:id` | `{ enabled: boolean \| null }` | `{ job: CronJobStatus }` |

## Type Reference

### `CronJobStatus`

Returned by all status endpoints. Represents the full runtime state of a registered cron job.

```typescript
type CronJobRunState = "idle" | "running" | "success" | "error" | "disabled";

interface CronJobStatus {
    id: string;               // Unique ID from filename
    name: string;             // Human-readable name
    description?: string;     // Optional description
    schedule: string;         // Cron expression
    enabled: boolean;         // Currently enabled?
    state: CronJobRunState;   // Current run state
    lastRunAt?: string;       // ISO timestamp of last execution start
    nextRunAt?: string;       // ISO timestamp of next scheduled execution
    lastDurationMs?: number;  // Duration of last run in ms
    lastError?: string;       // Error message from last failed run
    totalRuns: number;        // All-time executions, every process's (read from the DB)
    totalFailures: number;    // How many of totalRuns failed
}
```

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Derived from filename, e.g. `cleanup-sessions`. |
| `name` | `string` | Human-readable name from the definition. |
| `description` | `string?` | Description from the definition. |
| `schedule` | `string` | The cron schedule expression. |
| `enabled` | `boolean` | Whether the job is currently enabled. |
| `state` | `CronJobRunState` | One of: `idle`, `running`, `success`, `error`, `disabled`. |
| `lastRunAt` | `string?` | ISO timestamp of the last execution start. |
| `nextRunAt` | `string?` | ISO timestamp of the next scheduled execution. |
| `lastDurationMs` | `number?` | Duration of the last run in milliseconds. |
| `lastError` | `string?` | Error message from the last failed run. |
| `totalRuns` | `number` | All-time executions, skips included — every process's, read from `rebase.cron_job_state` where runs are persisted, this process's own otherwise. |
| `totalFailures` | `number` | How many of `totalRuns` failed. |

### `CronJobRunState`

```typescript
type CronJobRunState = "idle" | "running" | "success" | "error" | "disabled";
```

| State | Meaning |
|-------|---------|
| `idle` | Enabled and waiting for next scheduled tick |
| `running` | Handler is currently executing — on this process or another |
| `success` | In the type, but the scheduler never reports it: a successful run returns the job to `idle` |
| `error` | Last run failed (stays until next successful run) |
| `disabled` | Job is disabled via API or `enabled: false` in definition |

### `CronJobLogEntry`

A single execution log entry, stored in DB and/or in-memory ring buffer.

```typescript
interface CronJobLogEntry {
    jobId: string;            // The job ID this log belongs to
    startedAt: string;        // ISO timestamp when execution started
    finishedAt: string;       // ISO timestamp when execution finished
    durationMs: number;       // Duration in milliseconds
    success: boolean;         // Whether this run succeeded
    error?: string;           // Error message if the run failed
    result?: unknown;         // Arbitrary data returned by the handler
    logs: string[];           // Captured log lines from ctx.log() — the first 500 or 64 KB, then a line counting the rest
    manual?: boolean;         // Whether this was a manual trigger
}
```

| Field | Type | Description |
|-------|------|-------------|
| `jobId` | `string` | The job ID this log belongs to. |
| `startedAt` | `string` | ISO timestamp when execution started. |
| `finishedAt` | `string` | ISO timestamp when execution finished. |
| `durationMs` | `number` | Duration in milliseconds. |
| `success` | `boolean` | Whether this run succeeded. |
| `error` | `string?` | Error message if the run failed (timeout, exception, etc.). |
| `result` | `unknown?` | JSON-serialisable data returned by the handler. |
| `logs` | `string[]` | Captured log lines from `ctx.log()`. |
| `manual` | `boolean?` | `true` if triggered via `POST /api/admin/cron/:id/trigger`. |

## Client SDK

The Rebase client SDK provides typed methods for all cron operations. Reads need the `cron:read` scope; `triggerJob` and `toggleJob` need `cron:write`.

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({
    baseUrl: "http://localhost:3001",
    token: "your-admin-jwt-or-service-key",
});
```

### SDK Methods

| Method | Return Type | Description |
|--------|------------|-------------|
| `client.cron.listJobs()` | `Promise<CronJobListing>` | List all registered cron jobs, plus `skipped` / `rejected` / `note` |
| `client.cron.getJob(jobId)` | `Promise<{ job: CronJobStatus }>` | Get a single job's status |
| `client.cron.triggerJob(jobId)` | `Promise<{ log: CronJobLogEntry, job: CronJobStatus }>` | Manually trigger a job and wait for it. `{ async: true }` → `Promise<CronJobStarted>`. Throws a `RebaseApiError` (`409`) while it is running |
| `client.cron.getJobLogs(jobId, options?)` | `Promise<{ logs: CronJobLogEntry[] }>` | Get execution history |
| `client.cron.toggleJob(jobId, enabled)` | `Promise<{ job: CronJobStatus }>` | Enable or disable a job |

### Usage Examples

```typescript
import { RebaseApiError } from "@rebasepro/client";

// List all jobs
const { jobs } = await client.cron.listJobs();
console.log(jobs.map(j => `${j.id}: ${j.state}`));

// Get a specific job
const { job } = await client.cron.getJob("cleanup-sessions");
console.log(`Next run: ${job.nextRunAt}`);

// Trigger a job manually — a run already in progress is a 409, thrown
try {
    const { log, job: updatedJob } = await client.cron.triggerJob("cleanup-sessions");
    console.log(`Completed in ${log.durationMs}ms`, log.result);
} catch (err) {
    if (err instanceof RebaseApiError && err.code === "CRON_JOB_ALREADY_EXECUTING") {
        console.log("Job was already running — skipped");
    } else {
        throw err;
    }
}

// Trigger a long job and answer once it has started
const { startedAt } = await client.cron.triggerJob("cleanup-sessions", { async: true });

// Get execution history (last 10 entries)
const { logs } = await client.cron.getJobLogs("cleanup-sessions", { limit: 10 });

// Pause a job
await client.cron.toggleJob("cleanup-sessions", false);

// Resume a job
await client.cron.toggleJob("cleanup-sessions", true);
```

## Edge Cases and Gotchas

| Scenario | Behavior |
|----------|----------|
| **Invalid cron expression, unknown `timezone`, or bad `timeoutSeconds`** | Job is rejected at registration with an error log. Not registered; listed under `rejected` on `GET /api/admin/cron`. |
| **Duplicate job ID** (`x.ts` and `x.js` in the crons dir) | One job: the directory is read into one record keyed by id, so the file read last wins. Keep one file per id. |
| **Job still running when next tick fires** | Scheduled tick is skipped; scheduler re-schedules for the next tick. |
| **Manual trigger while running** | Answers `409` `CRON_JOB_ALREADY_EXECUTING` immediately; the skip (`{ skipped: true, reason: "already_executing" }`) is in `error.details.log` and the run history. |
| **Handler throws an exception** | Marked as failed; `error` field populated; `totalFailures` incremented; `executing` flag cleared. |
| **Handler exceeds timeout** | `ctx.signal` is aborted and the race rejects with the timeout error; marked as failed. Timeout timer is always cleaned up. |
| **Scheduler stopped while handler runs** | No further scheduling occurs. `backend.shutdown()` waits for the run within its budget; a run still going then has `ctx.signal` aborted and is recorded as failed. |
| **Non-SQL driver (e.g. MongoDB)** | Warning logged; cron jobs run normally but logs are not persisted to DB (in-memory only). |
| **DB persistence insert fails** | Error logged; scheduler continues normally (non-blocking). |
| **`cronPersistence: false`** | No `rebase.cron_logs` table created; logs kept in-memory ring buffer (50 per job). |
| **Job registered after scheduler started** | Automatically scheduled — late-registered jobs don't sit idle. |

## Common Use Cases

- **Data cleanup** — Remove expired sessions, stale tokens, orphaned records
- **Report generation** — Build daily/weekly summaries, export analytics
- **External API sync** — Pull data from third-party APIs on a schedule
- **Health checks** — Monitor uptime, memory usage, database connectivity
- **Notification batching** — Send digest emails, aggregate alerts
- **Cache warming** — Pre-compute expensive queries during off-peak hours

## References

- **Documentation:** [rebase.pro/docs/backend/cron-jobs](https://rebase.pro/docs/backend/cron-jobs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
