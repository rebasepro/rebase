---
name: rebase-cron-jobs
description: Guide for scheduling recurring background tasks with Rebase's built-in cron job system. Use this skill when the user needs background jobs, data cleanup, report generation, external API syncing, or any scheduled task.
---

# Rebase Cron Jobs

> **IMPORTANT FOR AGENTS**: Rebase has a **built-in cron scheduler** — do NOT install external libraries (`node-cron`, `agenda`, `bull`) or set up separate worker processes. Drop a TypeScript file in the `crons/` directory.

> **IMPORTANT FOR AGENTS**: Every cron handler receives `ctx.rebase` — the server-side Rebase singleton, the same object `import { rebase } from "@rebasepro/server"` returns. `ctx.rebase.dataAsAdmin` is **THE** primary way cron jobs read/write data. Always use it in examples, never raw SQL or direct DB imports. `ctx.client` was the old name for the same object and has been removed — a handler that destructures `client` no longer compiles.

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

Enable cron jobs by adding `cronsDir` to your backend config:

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ... other config
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

### Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cronsDir` | `string` | — | Absolute path to the directory containing cron job files. Required to enable cron jobs. |
| `cronPersistence` | `boolean` | `true` | Enable/disable database persistence for execution logs. When `false`, logs are kept in-memory only. |

```typescript no-verify
const backend = await initializeRebaseBackend({
    cronsDir: path.resolve(__dirname, "../crons"),
    cronPersistence: false,  // disable DB persistence (in-memory only)
});
```

### What Happens on Startup

Rebase will:
1. Scan the directory for `.ts` / `.js` files
2. **Validate** each job's cron schedule — invalid schedules are rejected with an error and the job is NOT registered
3. Register each default export as a cron job
4. If a **duplicate job ID** is found, the previous job is overwritten with a warning
5. Auto-create the `rebase.cron_logs` table in PostgreSQL (unless `cronPersistence: false`)
6. Mount admin REST routes at `/api/cron` (protected by `requireAuth` + `requireAdmin`)
7. Seed in-memory counters (`totalRuns`, `totalFailures`, `lastRunAt`) from the database
8. Start the scheduler

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
    name: string;               // Human-readable name for Studio
    description?: string;       // Optional description
    enabled?: boolean;          // Start enabled? (default: true)
    timeoutSeconds?: number;    // Max execution time (default: 300)
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `schedule` | `string` | — | Standard 5-field cron expression. **Validated on registration** — invalid expressions are rejected. |
| `name` | `string` | — | Human-readable name shown in Studio UI and API responses. |
| `description` | `string?` | `undefined` | Optional description shown in Studio. |
| `enabled` | `boolean?` | `true` | Whether the job starts enabled. Can be toggled at runtime via the Admin API. |
| `timeoutSeconds` | `number?` | `300` | Maximum seconds the handler may run before being timed out. |
| `handler` | `(ctx) => Promise<unknown> \| unknown` | — | The function executed on each tick. May return JSON-serialisable data stored in the log. |

## CronJobContext (Handler Argument)

> **IMPORTANT FOR AGENTS**: `ctx.rebase` **is** the server singleton, not a copy of it. Its data plane (`dataAsAdmin`) is backed by the native DataDriver — no JSON serialization, no HTTP dispatch, no middleware — while the control plane (`auth`, `admin`, `cron`, `functions`, `storage`) still routes through Hono's internal request handler. Use `rebase.dataAsAdmin` for all data operations inside cron handlers.

```typescript
interface CronJobContext {
    /** The job's unique ID (derived from filename). */
    jobId: string;

    /** The current scheduled tick timestamp. */
    scheduledAt: Date;

    /** A simple logger scoped to this job run — output captured in the execution log. */
    log: (...args: unknown[]) => void;

    /** The server-side Rebase singleton — data, email, storage, raw SQL. */
    rebase: RebaseServerClient;

}
```

| Property | Type | Description |
|----------|------|-------------|
| `jobId` | `string` | Derived from the filename (e.g. `cleanup-sessions`). |
| `scheduledAt` | `Date` | The timestamp when this execution was scheduled to start. |
| `log` | `(...args: unknown[]) => void` | Logger whose output is captured in `CronJobLogEntry.logs`. Use like `console.log`. |
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

### Schedule Validation

Schedules are **validated on registration**. Invalid expressions are rejected with a warning log and the job is **not** registered. Validation checks:

- Exactly 5 fields (minute, hour, day-of-month, month, day-of-week)
- All values within valid ranges: minute `0–59`, hour `0–23`, dom `1–31`, month `1–12`, dow `0–6`
- No unparseable tokens

### Minimum Schedule Interval

A **5-second minimum delay** is enforced between scheduled executions. Even if a cron expression would produce a sub-5-second gap (due to event loop jitter or clock drift), the scheduler clamps the delay to at least 5000ms. This prevents tight re-execution loops.

## Concurrency Guard

> **WARNING FOR AGENTS**: A cron job **never** runs two instances concurrently. If a scheduled tick fires while the previous run is still executing, it is **skipped** (not queued). The scheduler re-schedules for the next tick.

This also applies to **manual triggers** via `POST /api/cron/:id/trigger`. If the job is currently executing, the API returns immediately with a log entry containing:

```json
{
  "log": {
    "jobId": "my-job",
    "durationMs": 0,
    "success": true,
    "result": { "skipped": true, "reason": "already_executing" },
    "logs": ["Skipped: job is already running"],
    "manual": true
  }
}
```

## Timeout Behavior

Each handler invocation is **raced** against a timeout:

```typescript
const timeout = (job.timeoutSeconds ?? 300) * 1000;
const result = await Promise.race([handlerPromise, timeoutPromise]);
```

- Default timeout: **300 seconds** (5 minutes)
- If the timeout fires first, the job is marked as **failed** with error `Cron job "<id>" timed out after <N>ms`
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

Log persistence is **non-blocking** — if the database insert fails, the error is logged but the scheduler continues normally.

### In-Memory Ring Buffer

Regardless of database persistence, the scheduler keeps an **in-memory ring buffer** of the last **50 log entries per job**. The REST API falls back to this buffer when database persistence is unavailable.

### Fallback Behavior

| Driver | Persistence | Behavior |
|--------|-------------|----------|
| PostgreSQL | ✅ DB + memory | Logs written to `rebase.cron_logs` and in-memory buffer |
| PostgreSQL (`cronPersistence: false`) | ❌ Memory only | Logs kept in-memory ring buffer only |
| Non-SQL (e.g. MongoDB) | ❌ Memory only | Warning logged; no DB persistence |

### Startup Seeding

On startup, the scheduler seeds `totalRuns`, `totalFailures`, and `lastRunAt` counters from the database. This is **non-blocking** — the scheduler starts immediately and counters are updated asynchronously.

## REST API

All routes are mounted at `/api/admin/cron` and **require admin authentication** (`requireAuth` + `requireAdmin` middleware). `/api/cron` is kept alive as a legacy alias and answers with a `Deprecation` header; write the `/api/admin` path.

> **IMPORTANT FOR AGENTS**: All cron REST endpoints require an admin JWT or service key in the `Authorization` header. Unauthenticated requests will receive 401/403.

### List All Jobs

```
GET /api/cron
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

### Get Single Job

```
GET /api/cron/:id
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
POST /api/cron/:id/trigger
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

> If the job is already executing, the response returns immediately with `result: { skipped: true, reason: "already_executing" }`.

### Get Job Logs

```
GET /api/cron/:id/logs?limit=10
```

| Query Param | Type | Default | Description |
|-------------|------|---------|-------------|
| `limit` | `number?` | `50` | Maximum number of log entries to return |

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

Logs are returned **newest first**. When a database store is available, logs are fetched from the database; otherwise, the in-memory ring buffer is used as fallback.

### Enable/Disable a Job

```
PUT /api/cron/:id
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

**Error:** `400 Bad Request` (missing `enabled` field)

```json
{
  "error": { "message": "Missing 'enabled' boolean in body", "code": "BAD_REQUEST" }
}
```

### API Summary Table

| Method | Path | Request Body | Response Shape |
|--------|------|-------------|----------------|
| `GET` | `/api/cron` | — | `{ jobs: CronJobStatus[] }` |
| `GET` | `/api/cron/:id` | — | `{ job: CronJobStatus }` |
| `POST` | `/api/cron/:id/trigger` | — | `{ log: CronJobLogEntry, job: CronJobStatus }` |
| `GET` | `/api/cron/:id/logs` | — | `{ logs: CronJobLogEntry[] }` |
| `PUT` | `/api/cron/:id` | `{ enabled: boolean }` | `{ job: CronJobStatus }` |

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
    totalRuns: number;        // Total executions since server start (seeded from DB)
    totalFailures: number;    // Total failures since server start (seeded from DB)
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
| `totalRuns` | `number` | Total number of executions (seeded from DB on startup). |
| `totalFailures` | `number` | Total number of failed executions (seeded from DB on startup). |

### `CronJobRunState`

```typescript
type CronJobRunState = "idle" | "running" | "success" | "error" | "disabled";
```

| State | Meaning |
|-------|---------|
| `idle` | Enabled and waiting for next scheduled tick |
| `running` | Handler is currently executing |
| `success` | Last run completed successfully (transitional — becomes `idle`) |
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
    logs: string[];           // Captured log lines from ctx.log()
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
| `manual` | `boolean?` | `true` if triggered via `POST /api/cron/:id/trigger`. |

## Client SDK

The Rebase client SDK provides typed methods for all cron operations. All methods require admin authentication.

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
| `client.cron.listJobs()` | `Promise<{ jobs: CronJobStatus[] }>` | List all registered cron jobs |
| `client.cron.getJob(jobId)` | `Promise<{ job: CronJobStatus }>` | Get a single job's status |
| `client.cron.triggerJob(jobId)` | `Promise<{ log: CronJobLogEntry, job: CronJobStatus }>` | Manually trigger a job |
| `client.cron.getJobLogs(jobId, options?)` | `Promise<{ logs: CronJobLogEntry[] }>` | Get execution history |
| `client.cron.toggleJob(jobId, enabled)` | `Promise<{ job: CronJobStatus }>` | Enable or disable a job |

### Usage Examples

```typescript
// List all jobs
const { jobs } = await client.cron.listJobs();
console.log(jobs.map(j => `${j.id}: ${j.state}`));

// Get a specific job
const { job } = await client.cron.getJob("cleanup-sessions");
console.log(`Next run: ${job.nextRunAt}`);

// Trigger a job manually
const { log, job: updatedJob } = await client.cron.triggerJob("cleanup-sessions");
// `result` is whatever the handler returned, so it arrives as `unknown` — narrow it.
if ((log.result as { skipped?: boolean } | undefined)?.skipped) {
    console.log("Job was already running — skipped");
} else {
    console.log(`Completed in ${log.durationMs}ms`, log.result);
}

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
| **Invalid cron expression** | Job is rejected at registration with a warning log. Not registered. |
| **Duplicate job ID** (same filename in crons dir) | Previous job is stopped and overwritten with a warning log. |
| **Job still running when next tick fires** | Scheduled tick is skipped; scheduler re-schedules for the next tick. |
| **Manual trigger while running** | Returns immediately with `{ skipped: true, reason: "already_executing" }`. |
| **Handler throws an exception** | Marked as failed; `error` field populated; `totalFailures` incremented; `executing` flag cleared. |
| **Handler exceeds timeout** | `Promise.race` rejects with timeout error; marked as failed. Timeout timer is always cleaned up. |
| **Scheduler stopped while handler runs** | Handler runs to completion (it's async), but no further scheduling occurs. |
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
