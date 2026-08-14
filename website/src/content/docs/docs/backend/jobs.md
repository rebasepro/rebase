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

Off unless you ask for it: a worker polls the database forever, which is not a
default anyone chose. It needs a driver that can run SQL — on one that cannot
(MongoDB), the queue is unavailable and you are told at boot rather than at the
first enqueue.

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

```sql
SELECT task, attempts, last_error, updated_at
FROM rebase.jobs WHERE status = 'failed'
ORDER BY updated_at DESC;
```

Failed rows are kept 30 days; successful ones 3.

## What happens when a worker dies

A process killed mid-job cannot release its claim, so nothing but a timeout will
free the row. Jobs claimed for longer than `visibilityTimeoutMs` (default 5
minutes) are reclaimed — back to `pending` if they have attempts left, otherwise
dead-lettered with an error saying what happened.

This is also why the timeout must exceed your slowest handler: past it, a second
worker may start a job the first is still running.

```typescript no-verify
jobs: {
    enabled: true,
    concurrency: 5,              // jobs at once, per instance
    pollIntervalMs: 2_000,       // when the last look found nothing
    visibilityTimeoutMs: 300_000 // must exceed the slowest handler
}
```

## Several instances

Safe by construction. Workers claim with `SELECT … FOR UPDATE SKIP LOCKED`, so
each job goes to exactly one of them and the others move on to the next row
rather than queueing behind it. Nothing needs to be elected leader.

During a rolling deploy an instance running older code will be handed jobs whose
task it does not implement. Those are returned to the queue rather than failed,
so they run as soon as an updated peer picks them up.

## Durable webhooks

[`WebhookDispatcher`](/docs/recipes/webhooks) queues its deliveries in memory by
default, which means a crash or a deploy between the change and the delivery
drops the event. Hand it the queue and each delivery becomes a row:

```typescript no-verify
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "@rebasepro/server";

const { jobQueue } = await initializeRebaseBackend({ jobs: { enabled: true } });

const dispatcher = new WebhookDispatcher({ jobQueue });
dispatcher.setWebhooks(myWebhooks);

jobQueue?.register(WEBHOOK_DELIVERY_TASK, ctx => dispatcher.deliverQueuedJob(ctx.payload as never));
```

Only the webhook's **id** is stored on the job, never the webhook itself — its
signing secret would otherwise sit in `rebase.jobs` in cleartext for as long as
retention keeps the row, and a webhook edited between the enqueue and the
delivery should go out as it is now.

## Shutdown

`shutdown()` stops the worker claiming new jobs and waits for the ones in
flight, so a deploy does not run the tail of a batch twice. Anything still
running when the process goes keeps its claim and is recovered by the visibility
timeout.

## Next Steps

- **[Cron Jobs](/docs/backend/cron-jobs)** — work on a schedule
- **[Webhooks](/docs/recipes/webhooks)** — notify other systems on a change
