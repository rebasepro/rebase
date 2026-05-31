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

Create a file in your `backend/crons/` directory that default-exports a `CronJobDefinition`:

```typescript
// backend/crons/health-check.ts
import type { CronJobDefinition } from "@rebasepro/types";

const job: CronJobDefinition = {
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
};

export default job;
```

The **filename** (without extension) becomes the job's unique ID — e.g., `health-check`.

## Configuration

Enable cron jobs by adding `cronsDir` to your backend config:

```typescript
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

    // The function to run on each tick
    handler: (ctx: CronJobContext) => Promise<unknown> | unknown;
}
```

## Handler Context

Each handler receives a `CronJobContext` containing utility methods and the Rebase Client instance:

```typescript
interface CronJobContext {
    // The job's unique ID (derived from filename)
    jobId: string;

    // The scheduled tick timestamp
    scheduledAt: Date;

    // Logger — captured lines appear in Studio and the logs API
    log: (...args: unknown[]) => void;

    // Backing RebaseClient instance running with full admin privileges
    client: RebaseClient;
}
```

Use `ctx.log()` to emit structured output. These lines are captured in the execution log and visible in Studio and via the REST API.

### Interacting with Database & Services via `ctx.client`

The `ctx.client` parameter provides direct, server-side access to all Rebase services under administrative privileges. This means database operations run with bypass of Row-Level Security (RLS) policies:

```typescript
// backend/crons/expire-users.ts
import type { CronJobDefinition } from "@rebasepro/types";

const job: CronJobDefinition = {
    schedule: "0 0 * * *", // Daily at midnight
    name: "Expire Inactive Accounts",
    
    async handler(ctx) {
        ctx.log("Checking for expired trial users...");

        // Fetch using the pre-initialized data driver
        const { data: trials } = await ctx.client.data.users.find({
            where: {
                trial_status: "active",
                trial_ends_at: ["<", new Date().toISOString()]
            }
        });

        ctx.log(`Found ${trials.length} users with expired trials.`);

        for (const user of trials) {
            await ctx.client.data.users.update(user.id, {
                trial_status: "expired",
                status: "disabled"
            });
            
            // Send email notification using Rebase email service
            if (ctx.client.email) {
                await ctx.client.email.send({
                    to: user.values.email,
                    subject: "Your trial has expired",
                    html: "<p>Please upgrade your subscription to continue.</p>"
                });
            }
        }
    }
};

export default job;
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

When cron jobs are configured, a **Cron Jobs** tool appears in Rebase Studio under the **Automation** section. The dashboard provides:

- **Job list** — All registered jobs with live status indicators
- **Detail panel** — Schedule, next/last run, duration, and error information
- **Execution history** — Expandable log entries with captured output and results
- **Manual trigger** — Run any job on demand with one click
- **Enable/disable** — Pause and resume jobs without restarting the server

The dashboard auto-refreshes every 15 seconds.

## Persistence

When the database driver supports SQL (e.g. PostgreSQL), execution logs are **automatically persisted** to a `rebase.cron_logs` table. This means:

- Execution history **survives server restarts** and deployments
- `totalRuns` and `totalFailures` counters are **seeded from the database** on startup
- The `/api/cron/:id/logs` endpoint queries the database, not just in-memory
- Multiple server instances share the same execution history

The table is auto-created on first startup — no migrations needed.

:::tip
Persistence is non-blocking. If a database write fails, the scheduler continues running and the in-memory log buffer is still available as a fallback.
:::

## Schedule Validation

At server initialization, Rebase parses and validates all registered cron schedules. 
- Validation verifies that the expression contains exactly 5 whitespace-separated fields.
- It checks that all ranges, steps, and lists produce values within the standard bounds (e.g., minutes 0–59, hours 0–23).
- If any cron expression is invalid, Rebase logs a clear error to the terminal at startup and rejects the job so the server doesn't execute malformed schedules.

## Concurrency Guarding

To ensure stability under heavy workloads, Rebase implements a strict **concurrency guard** per cron job:
- **No overlapping executions**: If a job's scheduled tick fires (or is manually triggered) while the previous run of the same job is still active, Rebase will skip the execution.
- **Manual trigger fallback**: When a job is triggered via the API/Studio while already running, the execution is skipped and the API returns a skipped indicator: `result: { skipped: true, reason: "already_executing" }`.
- **Timer unref**: Timers use `unref()` internally to prevent scheduled jobs from blocking the Node.js event loop during graceful process shutdown.

## Timeouts & Error Handling

- **Automatic Timeout**: If a job execution exceeds its configured `timeoutSeconds` (defaults to `300` seconds / 5 minutes), the run is forcibly aborted and logged as a failure with a timeout error.
- **Fail-safe isolation**: If a handler throws an error, the scheduler captures the exception stack, updates the job state to `"error"`, and schedules the next run normally. A crash in a single job will never crash the scheduler thread or the main HTTP server.
- **In-Memory Ring Buffer**: Rebase holds the last `50` execution logs per job in an in-memory ring buffer for instant retrieval, while writing all logs asynchronously to the PostgreSQL database if persistence is enabled.
- **Robust Persistence**: Database log writes are fully asynchronous and fail-safe; if the database connection drops temporarily, the scheduler continues executing normally and uses the in-memory buffer as a fallback.

## Example: Daily Cleanup Job

```typescript
// backend/crons/cleanup-sessions.ts
import type { CronJobDefinition } from "@rebasepro/types";
import { rebase } from "@rebasepro/server-core";

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
