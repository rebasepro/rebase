---
title: Background Jobs
sidebar_label: Background Jobs
description: A durable, Postgres-backed job queue — work that survives a restart, retried with backoff, with failures kept rather than dropped.
---

## Overview

A job is a row in `rebase.jobs`. It is claimed by exactly one worker, retried
with a widening delay if its handler throws, and left in the table when it
finally gives up so somebody can look at it.

There is nothing to install and nothing to run alongside Postgres. A job
enqueued inside a transaction that rolls back was never enqueued.

Use it for work that must not be lost and must not happen inside a request:
sending mail, calling a third party, generating a file, reconciling with an
external system.

| | Runs | Survives a restart |
|---|---|---|
| [Cron](/docs/backend/cron-jobs) | On a schedule | Yes — the schedule is in code |
| **Jobs** | Once, as soon as a worker is free | **Yes — the job is a row** |
| A `setTimeout` in a callback | Once, in this process | No |

## Enabling

:::note[Where this goes]
**Managed runtime** — nowhere. `jobs` takes handler *functions*, which no
environment variable and no `config/index.ts` export can carry, so a scaffolded
project cannot enable the queue. Run `rebase eject` (or write a
[custom server](/docs/backend/custom-server/)) to reach it. `REBASE_JOB_WORKERS`
in `.env` only decides whether an already-enabled queue's workers run in *this*
process.

**Ejected** — the `jobs` block on `initializeRebaseBackend({ … })`, as below.

The full map is in [Backend Overview](/docs/backend/#where-each-option-lives).
:::

```typescript no-verify
await initializeRebaseBackend({
    jobs: {
        enabled: true,
        tasks: {
            "send-welcome": async ({ payload }) => {
                await sendEmail((payload as { email: string }).email);
            }
        }
    }
});
```

Off unless you ask for it: a worker keeps looking for work for as long as the
process lives, which is not a default anyone chose. It needs a driver that can
run SQL — on one that cannot (MongoDB), the queue is unavailable and you are
told at boot rather than at the first enqueue.

An idle worker does not poll every two seconds. Each enqueue sends a
`NOTIFY` on the `rebase_jobs` channel when it commits, and a worker holding a
`LISTEN` on it claims at once — a job enqueued by another process (the `api`
role, another replica) starts within milliseconds, and a delayed one when it
comes due. Behind that it looks every 30 seconds anyway. A job this process
enqueues, a retry it scheduled and a job it reclaimed wake it without a
notification.

The `LISTEN` needs a connection of its own, found the way realtime finds one:
`DATABASE_DIRECT_URL` when set, else `DATABASE_URL`. Behind a transaction-mode
pooler such as PgBouncer, set `DATABASE_DIRECT_URL`: a pooler does not keep a
`LISTEN`, and jobs from other processes would then wait for the 30-second look.
Where there is no such connection at all (the in-process development database),
an idle worker backs off instead: it looks after `pollIntervalMs` (2 seconds),
then twice as long after each look that found nothing, up to 30 seconds, and
starts over whenever it finds work. An idle worker makes about 2,900 claims a
day instead of 43,200.

## Enqueueing

```typescript no-verify
const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true, tasks } });

await jobQueue?.enqueue("send-welcome", { email: "ada@example.com" });
```

### Options

```typescript no-verify
await jobQueue?.enqueue("send-digest", { userId: "u7" }, {
    delayMs: 60_000,               // not before a minute from now
    maxAttempts: 5,                // default 3
    idempotencyKey: "digest:u7"    // at most one *unfinished* job with this key
});
```

`idempotencyKey` collapses a double-click, a retried request, and two instances
reacting to the same event into a single job. It is scoped to unfinished work,
so the key becomes reusable once the job completes — otherwise "the nightly
digest for user 7" would be sendable exactly once, ever. A duplicate enqueue
resolves to `null` rather than throwing: the work you asked for is queued, which
is the outcome you wanted.

## Failure

A handler fails by throwing. There is no `return false` — a boolean would be
silently ignored by every handler that forgot to return one, and failure has to
be what you get by default.

- **Attempts left** → back to `pending`, with `run_at` pushed out by the backoff
  (1s, 5s, 25s … capped at an hour; override with `backoff`).
- **Out of attempts** → `failed`, and the row *stays*. A queue that silently
  drops what it could not deliver is indistinguishable from one with nothing to
  do.
- **A failure no retry can change** → throw `PermanentJobError`, from
  `@rebasepro/server`: the job goes to `failed` on this attempt, with the
  message as its `last_error`, instead of spending its remaining attempts.

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Failed rows are kept 30 days; successful ones 3. Each worker deletes the
expired rows when it starts and then every hour, in batches, off the request
path.

## What happens when a worker dies

A process killed mid-job cannot release its claim, so nothing but a timeout will
free the row. While a handler runs, its worker renews the claim every third of
`visibilityTimeoutMs` (default 5 minutes). A claim that has gone that long
without being renewed is reclaimed — back to `pending` if the job has attempts
left, otherwise dead-lettered with an error saying what happened.

So a slow handler on a live worker keeps its job, however long it takes, and the
timeout only decides how soon a dead worker's jobs come back. An attempt that
lost its claim cannot overwrite the job's outcome either: its success or failure
is logged and dropped, and whichever attempt holds the claim decides.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // the first wait after a look that found nothing; it doubles up to 30 s
    visibilityTimeoutMs: 300_000 // how long an unrenewed claim holds
}
```

### A handler that never finishes

The flip side: a handler awaiting a `fetch` that never answers holds its worker
slot, and its claim, for as long as the process lives — five of them and the
worker runs nothing else, while `/health` stays green.
`timeoutMs`
bounds one attempt. At the deadline the attempt fails — retried while attempts
remain, like any throw — its slot is freed, and the handler's `signal` is
aborted. Pass the signal on, so the work stops too; a handler that ignores it
keeps running in the background with nothing recording its outcome.

Left out, it is 15 minutes (`900_000`), and the worker says so in one log line
when it starts. A job that legitimately runs longer sets its own value, and
`timeoutMs: 0` removes the limit.

```typescript no-verify
jobs: {
    enabled: true,
    timeoutMs: 120_000,          // one attempt; 15 minutes when left out, 0 for no limit
    tasks: {
        "sync-crm": async ({ payload, signal }) => {
            await fetch(crmUrl, { method: "POST", body: JSON.stringify(payload), signal });
        }
    }
}
```

Queue handlers and topic subscriptions get the same `signal` in their context.

## Several instances

Safe by construction. Workers claim with `SELECT … FOR UPDATE SKIP LOCKED`, so
each job goes to exactly one of them and the others move on to the next row
rather than queueing behind it. Nothing needs to be elected leader.

An instance claims only the tasks it has a handler for. During a rolling deploy,
an instance running older code leaves alone the jobs whose task only the newer
code implements: they stay `pending`, their attempts untouched, until an updated
peer claims them. A task that no instance implements stays `pending` too, rather
than being dead-lettered.

## Storage orphan scans

`rebase storage orphans` runs on this queue when it is on: each scan, and each
delete from a scan, is a `storage.orphans` job, with one attempt. The backend
registers the handler itself, in every process with storage configured, and
only processes whose job workers are on run it. A scan is bound by
`timeoutMs` like any job, so a source too big to scan in 15 minutes needs a
higher `timeoutMs`, or 0. Without the queue, the server runs the scan inside
its own process instead. See [the CLI](/docs/cli/#rebase-storage).

## Durable webhooks

[`WebhookDispatcher`](/docs/recipes/webhooks) queues its deliveries in memory by
default, which means a crash or a deploy between the change and the delivery
drops the event. Hand it the queue and each delivery becomes a row:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never, ctx));
```

Only the webhook's **id** is stored on the job, never the webhook itself — its
signing secret would otherwise sit in `rebase.jobs` in cleartext for as long as
retention keeps the row, and a webhook edited between the enqueue and the
delivery should go out as it is now. Passing `ctx` as the second argument makes
each attempt send its own `X-Webhook-Attempt`; every attempt at one delivery sends
the same `X-Webhook-Delivery`, so a receiver can deduplicate the retries.

A delivery the dispatcher refuses to send (a loopback, link-local, private or
non-`http(s)` destination), or one the receiver answers with a redirect, fails
the same way every time. It is dead-lettered after one attempt, with the reason
in `last_error`. Any other failure is retried like any job.

## Shutdown

`shutdown()` stops the worker claiming new jobs and waits for the ones in
flight, so a deploy does not run the tail of a batch twice. The wait is capped
at two-thirds of the shutdown timeout (10 seconds of the default 15), so one
handler that never settles cannot hold the shutdown. A job still running after
that keeps its claim and is recovered by the visibility timeout.

## Next Steps

- **[Cron Jobs](/docs/backend/cron-jobs)** — work on a schedule
- **[Webhooks](/docs/recipes/webhooks)** — notify other systems on a change
