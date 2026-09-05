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

:::note
`defineCron` is an identity function — it returns the same object you pass in. A plain default-exported `CronJobDefinition` object works identically; `defineCron` simply provides compile-time type checking and editor autocomplete.
:::

The **filename** (without extension) becomes the job's unique ID — e.g., `health-check`.


## Configuration

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
3. Auto-create the `rebase.cron_logs` table in PostgreSQL (if the driver supports SQL)
4. Start the scheduler and seed counters from existing DB logs
5. Mount admin REST routes at `/api/cron`

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

## CronJobDefinition Reference

```typescript
interface CronJobDefinition {
    // Cron schedule expression (5-field format)
    schedule: string;

    // Human-readable name shown in Studio
    name: string;

    // Optional description shown in Studio
    description?: string;

    // Whether the job starts enabled (default: true)
    enabled?: boolean;

    // Max execution time in seconds (default: 300)
    timeoutSeconds?: number;

    // How far back to look on startup for a slot that elapsed while no
    // instance was ticking (default: off). See "Recovering Missed Slots".
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

    // Logger — captured lines appear in Studio and the logs API
    log: (...args: unknown[]) => void;

    // The server-side Rebase singleton — the same object `import { rebase }
    // from "@rebasepro/server"` returns, and the same one `defineFunction`
    // hands its callback.
    rebase: RebaseServerClient;
}
```

Use `ctx.log()` to emit structured output. These lines are captured in the execution log and visible in Studio and via the REST API.

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

All cron routes require **admin authentication** (`requireAuth` + `requireAdmin`).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/cron` | List all registered cron jobs |
| `GET` | `/api/cron/:id` | Get a single job's status |
| `POST` | `/api/cron/:id/trigger` | Manually trigger a job |
| `GET` | `/api/cron/:id/logs` | Get execution history (`?limit=N`) |
| `PUT` | `/api/cron/:id` | Enable/disable a job (`{ "enabled": true }`) |

### Example: List All Jobs

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:3001/api/cron
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

### Example: Trigger a Job Manually

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    http://localhost:3001/api/cron/health-check/trigger
```

## Client SDK

The Rebase client SDK exposes a `cron` namespace for all operations:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: "http://localhost:3001" });

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

## Studio Dashboard

When cron jobs are configured, a **Cron Jobs** tool appears in Rebase Studio under **Compute**, beside the JS console. The dashboard provides:

- **Job list** — All registered jobs with live status indicators
- **Detail panel** — Schedule, next/last run, duration, and error information
- **Execution history** — Expandable log entries with captured output and results
- **Manual trigger** — Run any job on demand with one click
- **Enable/disable** — Pause and resume jobs without restarting the server

The dashboard auto-refreshes every 15 seconds.

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

## Recovering Missed Slots

Because the scheduler computes the next slot from *now* on every boot, a slot only fires if some instance was alive and ticking when it came round. Anything that replaces the process during a slot — a rolling deploy, a crash, a platform recycling the container — drops that run, and the replacement schedules the slot *after* it. Nothing errors; the run simply never happens.

This is **not** only a scale-to-zero problem. A service pinned to a warm instance still loses runs, because a platform is free to retire the instance holding the timer and start a fresh one.

Set `catchUpWindowSeconds` to a window comfortably wider than a restart, and startup will run a slot it finds unclaimed inside that window:

```typescript
export default defineCron({
    schedule: "0 6 * * *",       // daily at 06:00
    name: "Scrape Listings",
    catchUpWindowSeconds: 3600,  // tolerate an hour of downtime around 06:00
    handler: async (ctx) => { /* … */ }
});
```

Three things to know:

- **Off by default.** Without `catchUpWindowSeconds`, behaviour is unchanged.
- **Only the most recent missed slot runs.** Booting after a six-hour outage catches an hourly job up once, not six times. Catch-up stops a run going missing; it does not replay history.
- **A claims-capable store is required.** Catch-up claims the slot through the same `(job_id, slot)` key the scheduled path uses, which is the only thing distinguishing "this slot never ran" from "this slot already ran on the instance being replaced". With no store attached, catch-up is skipped and a warning is logged — otherwise an instance recycled every 30 minutes would re-run the same hourly job every time it booted.

In the ordinary case — a restart minutes after a slot ran normally — the most recent slot is already claimed, so catch-up costs one claim check per job per boot and does nothing.

A recovered run is a normal entry in `cron_logs` (`manual` is `false`), with a first log line recording the slot it recovered and how late it was:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Concurrency Guarding

To ensure stability when executing resource-heavy operations, Rebase implements a strict **single-concurrency execution lock** per job ID:
- **Scheduled Overlaps**: If a job's scheduled tick fires while the previous execution is still running, the scheduler skips the tick, logs a warning, and immediately schedules the next candidate run.
- **Manual Trigger Collisions**: If an operator manually triggers a running job via Rebase Studio or the REST API, the request returns immediately with a skipped payload, protecting the active worker:
  ```json
  {
    "jobId": "expire-users",
    "success": true,
    "result": { "skipped": true, "reason": "already_executing" },
    "logs": ["Skipped: job is already running"]
  }
  ```

---

## Timeouts & Error Isolation

- **Forced Timeout Race**: Execution blocks are wrapped in a `Promise.race` against a timeout timer derived from `timeoutSeconds` (default: `300` seconds / 5 minutes). If the handler hangs past this threshold, the promise is rejected, throwing:
  `Error: Cron job "<id>" timed out after <N>ms`
- **Fail-Safe Try/Catch**: Each job handler runs inside an isolated wrapper. Any uncaught exceptions are intercepted, formatting the error traceback into a string, setting the job status to `"error"`, and updating the `rebase.cron_logs` failure counters. A crash inside a single cron task will never crash the scheduler loop or the primary Hono HTTP web server.
- **In-Memory Ring Buffer**: The scheduler maintains a ring buffer containing the last **50 runs** per job. This buffer is kept in memory to allow near-instant reads from the Rebase Studio UI.

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

CREATE INDEX IF NOT EXISTS idx_cron_logs_job ON rebase.cron_logs(job_id, started_at DESC);
```

On startup, the scheduler reads stats from this table via aggregate queries (`COUNT(*)`, `SUM(CASE WHEN success = false THEN 1 ELSE 0 END)`) to populate `totalRuns` and `totalFailures` history. Log insertions are executed in a non-blocking asynchronous sweep; if a database flush fails, the scheduler logs the error and continues normal execution using the in-memory ring buffer as a fallback.

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

        // Use the rebase singleton for admin-level database access
        // const { data: expired } = await rebase.data.findMany("sessions", { ... });
        const count = Math.floor(Math.random() * 50); // placeholder

        ctx.log(`Cleaned up ${count} expired sessions`);

        return { deletedSessions: count };
    },
};

export default job;
```

## Next Steps

- **[Backend Overview](/docs/backend)** — Full backend configuration reference
- **[Entity Callbacks](/docs/collections/callbacks)** — Run logic on data changes
- **[Webhook Integration](/docs/recipes/webhooks)** — Send notifications on events
