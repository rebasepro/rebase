---
title: Cron Jobs API
sidebar_label: Cron Jobs API
description: "List, trigger, pause and resume cron jobs over the REST API, or with the typed SDK's client.cron."
---

## REST API

Reading needs the `cron:read` scope. Triggering, pausing and resuming need
`cron:write`. An admin holds both. So does a person whose role declares them, and
an API key created with them, which is what an external scheduler should carry:

```bash
rebase api-keys create -n "Scheduler" --scopes cron:read,cron:write
```

See [Roles and scopes](/docs/backend/roles-and-scopes/).

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/admin/cron` | List all registered cron jobs |
| `GET` | `/api/admin/cron/:id` | Get a single job's status |
| `POST` | `/api/admin/cron/:id/trigger` | Manually trigger a job — `409` while it is already running. `?async=1` answers `202` once the run has started |
| `GET` | `/api/admin/cron/:id/logs` | Get execution history (`?limit=N`), the last 30 days of it. `503` when `rebase.cron_logs` cannot be read, rather than an empty history |
| `PUT` | `/api/admin/cron/:id` | Pause or resume a job everywhere (`{ "enabled": false }`); `null` follows the code again |

### Example: List All Jobs

`$TOKEN` is an access token for an account holding `cron:read`: sign in and use
the `accessToken` the login response returns. An API key holding the scope works
the same way. `$API_URL` is whatever `rebase dev` printed — the port is derived from the
project's path, so there is no fixed one.

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

### Jobs that are not there

A job that never fires is not in `jobs` — nothing registered it — so "my cron is
missing" and "my cron will never run" look identical from this endpoint unless it
says otherwise. It does:

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
    "note": "1 cron file(s) failed to load and 1 job(s) were refused — NOT scheduled. See `rejected` for the reason; the server log has the rest."
}
```

`rejected` names the job and the reason. A file that failed to *load* has only a
count: the failure happened before there was a job to name, so the reason is in
the server log.

The commonest entry here is the one above — six fields, from an expression
copied out of a tool that supports seconds. Rebase takes five; drop the leading
field. A `timeoutSeconds` of zero, a negative number or `NaN` is listed here too.

### Example: Trigger a Job Manually

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/health-check/trigger"
```

While the job is running — here or on any other process — the answer is `409`
with the code `CRON_JOB_ALREADY_EXECUTING`; see [Concurrency Guarding](/docs/backend/cron-across-instances/#concurrency-guarding).

The call waits for the run to finish and answers `200` with its log. For a job that runs
longer than a proxy in front of the server holds a request (many stop at 60 seconds), add
`?async=1`. The answer is then `202` as soon as the run has started:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
    "$API_URL/api/admin/cron/nightly-report/trigger?async=1"
```

```json
{
    "accepted": true,
    "startedAt": "2026-04-24T08:21:04.512Z",
    "job": { "id": "nightly-report", "state": "running" }
}
```

The run carries on after the answer. Its outcome is in `GET /api/admin/cron/:id/logs`, as the
entry with `"manual": true` and the same `startedAt`. A run that cannot start still answers
`409`. `?async` takes `1`, `true`, `0` or `false`; any other value is a `400`.

### Pausing a job

A pause from Studio or
`PUT /api/admin/cron/:id` applies to every process and stays in place across
restarts and redeploys; `{ "enabled": null }` hands the job back to the
`enabled` its file declares. How every replica reads it, and what happens when
one cannot, is on [Cron across instances](/docs/backend/cron-across-instances/#pausing-a-job-across-every-process).

## Typed SDK

The Rebase typed SDK exposes a `cron` namespace for all operations:

```typescript
import { createRebaseClient } from "@rebasepro/client";

const client = createRebaseClient({ baseUrl: import.meta.env.VITE_API_URL });

// List all jobs, and the ones that did not register
const { jobs, rejected } = await client.cron.listJobs();

// Get a single job
const { job } = await client.cron.getJob("health-check");

// Trigger manually, and wait for the run
const { log, job: updated } = await client.cron.triggerJob("health-check");

// Trigger manually, and answer once the run has started
const { startedAt } = await client.cron.triggerJob("nightly-report", { async: true });

// View execution history
const { logs } = await client.cron.getJobLogs("health-check", { limit: 10 });

// Enable or disable
await client.cron.toggleJob("health-check", false); // pause
await client.cron.toggleJob("health-check", true);  // resume
```

`triggerJob()` waits for the run to finish and answers with its log. A proxy in front of the
server may cut a long job's answer short (many stop at 60 seconds) while the run itself
carries on. For such a job pass `{ async: true }`: the call answers once the run has started,
and `getJobLogs()` has the outcome, as the entry with `manual: true` and the returned `startedAt`.

`listJobs()` is typed `CronJobListing`: `jobs`, plus the `skipped`,
`rejected` and `note` fields described under [Jobs that are not there](#jobs-that-are-not-there).
