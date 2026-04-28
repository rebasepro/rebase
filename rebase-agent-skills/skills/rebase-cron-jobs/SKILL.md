---
name: rebase-cron-jobs
description: Guide for scheduling recurring background tasks with Rebase's built-in cron job system. Use this skill when the user needs background jobs, data cleanup, report generation, external API syncing, or any scheduled task.
---

# Rebase Cron Jobs

> **IMPORTANT FOR AGENTS**: Rebase has a **built-in cron scheduler** — do NOT install external libraries (`node-cron`, `agenda`, `bull`) or set up separate worker processes. Drop a TypeScript file in the `crons/` directory.

## Overview

Rebase includes a built-in cron job scheduler for running recurring background tasks. Cron jobs follow the **file-based discovery** pattern — drop a TypeScript file in `crons/`, and it's automatically registered and scheduled.

- **Zero dependencies** — No external scheduler libraries needed
- **Studio dashboard** — Monitor all jobs, view execution history, trigger manually
- **Admin REST API** — List, trigger, enable/disable, and view logs
- **Database persistence** — Execution logs stored in PostgreSQL

## Setup

Enable cron jobs by adding `cronsDir` to your backend config:

```typescript
const backend = await initializeRebaseBackend({
    // ... other config
    cronsDir: path.resolve(__dirname, "../crons"),  // ← add this
});
```

Rebase will:
1. Scan the directory for `.ts` / `.js` files
2. Register each default export as a cron job
3. Auto-create the `rebase.cron_logs` table in PostgreSQL
4. Mount admin REST routes at `/api/cron`

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

        // Your cleanup logic here
        const deletedCount = 42;
        ctx.log(`Cleaned up ${deletedCount} expired sessions`);

        // Return value is stored in the log and shown in Studio
        return { deletedSessions: deletedCount };
    },
};

export default job;
```

The **filename** (without extension) becomes the job's unique ID — e.g., `cleanup-sessions`.

## Schedule Syntax (Cron Expressions)

Standard 5-field cron format:

| Expression | Meaning |
|------------|---------|
| `* * * * *` | Every minute |
| `*/5 * * * *` | Every 5 minutes |
| `0 * * * *` | Every hour |
| `0 3 * * *` | Daily at 3:00 AM |
| `0 0 * * 1` | Every Monday at midnight |
| `0 9 1 * *` | First of each month at 9 AM |
| `0 9-17 * * 1-5` | Hourly, 9 AM–5 PM, weekdays |

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

interface CronJobContext {
    jobId: string;              // Derived from filename
    scheduledAt: Date;          // The tick timestamp
    log: (...args: unknown[]) => void;  // Captured in execution log
}
```

## REST API

All routes require admin authentication:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/cron` | List all registered cron jobs |
| `GET` | `/api/cron/:id` | Get a single job's status |
| `POST` | `/api/cron/:id/trigger` | Manually trigger a job |
| `GET` | `/api/cron/:id/logs` | Get execution history |
| `PUT` | `/api/cron/:id` | Enable/disable a job |

## Client SDK

```typescript
const client = createRebaseClient({ baseUrl: "http://localhost:3001" });

const { jobs } = await client.cron.listJobs();
const { log } = await client.cron.triggerJob("cleanup-sessions");
const { logs } = await client.cron.getJobLogs("cleanup-sessions", { limit: 10 });
await client.cron.toggleJob("cleanup-sessions", false); // pause
```

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
