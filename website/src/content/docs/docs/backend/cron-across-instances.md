---
title: Cron across instances
sidebar_label: Cron across instances
description: "How cron jobs behave with more than one server process: one run per slot, a slot a restart dropped, a pause every replica honours, and runs that never overlap."
---

[Cron jobs](/docs/backend/cron-jobs) run in every process whose scheduler is on:
every replica by default, or only the worker on a
[split deployment](/docs/deployment/split-processes/). Each of those processes
arms the same timers, and the database is what keeps them from stepping on each
other — a claim per `(job, slot)`, so a slot runs once; a catch-up for a slot a
restart dropped; and one row per job in `rebase.cron_job_state`, holding the
pause every replica reads and the lease a run holds while it runs.

All of it needs a SQL database; the tables are listed under
[Database Persistence Schema](/docs/backend/cron-jobs/#database-persistence-schema).
On MongoDB, or with `cronPersistence: false`, nothing coordinates the processes:
each one runs every job, so turn the scheduler on in only one of them
(`REBASE_CRON_SCHEDULER`).

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

Boot deletes claims older than seven days, but always keeps each job's latest one, whatever its age. That claim is the record that the slot already ran, so a monthly job with a month-wide catch-up window is not re-run by a deploy on the 10th.

A recovered run is a normal entry in `cron_logs` (`manual` is `false`), with a first log line recording the slot it recovered and how late it was:

```
⏰ Catch-up run for missed slot 2026-07-29T06:00:00.000Z (612s late)
```

---

## Pausing a job across every process

<span class="since-badge" data-since="0.23">Since 0.23</span> A pause is stored
in `rebase.cron_job_state`, not in the memory of the process that served it, so
it reaches every replica — and, on a [split deployment](/docs/deployment/split-processes/),
the worker, when the request was served by an `api` process that runs no timers.
It also survives restarts and redeploys: a job paused in Studio stays paused.

`$TOKEN` is an admin access token and `$API_URL` the address `rebase dev`
printed — see the [REST API](/docs/backend/cron-jobs/#rest-api).

```bash
# Pause, for every process, until someone resumes it
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": false }' "$API_URL/api/admin/cron/health-check"

# Stop overriding: follow the `enabled` the job's file declares again
curl -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d '{ "enabled": null }' "$API_URL/api/admin/cron/health-check"
```

`true` and `false` override the `enabled` in the job's file; `null` removes the
override. The row records who made the change and when.

Every scheduler reads the state when a slot comes due, before it claims the
slot — one query per fire — so a paused job does not spend its slot, and a job
resumed on one replica runs at its next slot on whichever replica claims it.
Catch-up at boot reads it too.

If the state cannot be read — the table missing, the database briefly
unreachable — the scheduler falls back to the `enabled` in the job's file and
logs a warning. That is deliberate: a scheduled run fails open, as it does when
the claims table cannot answer, because a broken table must not silently stop
every job. If the change itself cannot be saved, the `PUT` answers `503` and no
process is changed.

Without a SQL database (MongoDB) or with `cronPersistence: false` there is
nowhere to keep the state: a pause applies to the process that served it and
is gone on restart.

---

## Concurrency Guarding

To ensure stability when executing resource-heavy operations, Rebase implements a strict **single-concurrency execution lock** per job ID:
- **Scheduled Overlaps**: If a job's scheduled tick fires while the previous execution is still running, the scheduler skips the tick and immediately schedules the next candidate run.
- **Manual Trigger Collisions**: If an operator manually triggers a running job via Rebase Studio or the REST API, the request answers `409` with the code `CRON_JOB_ALREADY_EXECUTING`, protecting the active worker. `details.log` is the skip entry described below.

Either way a row is written to `rebase.cron_logs`, so the skip is in the run
history rather than only in the process log:

```json
{
  "jobId": "expire-users",
  "success": true,
  "result": { "skipped": true, "reason": "already_executing" },
  "logs": ["Skipped: the previous run has not finished"]
}
```

`success: true` because nothing failed — `result.skipped` is what marks it. A
run of these in a row is the signature of a job that has outgrown its schedule,
and that is a pattern you can only see if the skips are recorded.

<span class="since-badge" data-since="0.23">Since 0.23</span> The lock holds
across processes, not only inside one. Every run — scheduled, manual or a
catch-up — takes a **run lease** in `rebase.cron_job_state` before its handler
starts, and releases it when the run ends. So a manual trigger from the `api`
process while the worker is running the job answers `409`, and a slot that comes
due while a manual run holds the lease on another process is skipped. The skip's
log line names the process holding the lease.

A lease lasts the job's `timeoutSeconds` plus 30 seconds, which is also what
frees a job whose process crashed mid-run. A job with `timeoutSeconds: Infinity`
holds it for at most an hour: a crash then blocks the job for an hour rather
than forever, and a run still going after an hour no longer keeps another
process from starting the job. A job that legitimately runs for hours should
give a finite `timeoutSeconds`, which its lease then follows. If the lease cannot
be taken because the database cannot answer, the run goes ahead with a warning,
as a scheduled run does when its claim cannot be read.
