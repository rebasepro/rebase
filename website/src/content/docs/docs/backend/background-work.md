---
title: Background Work
sidebar_label: Background Work
description: "Run work after a custom function has answered: waitUntil, what the host does with it at shutdown, and what is lost without it."
---

Work that should outlive the response goes in `waitUntil`:

```typescript
import { defineFunction, requireAuth, waitUntil } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.post("/orders", requireAuth, async (c) => {
        const order = await c.req.json();
        // The caller does not wait for this, but shutdown does.
        waitUntil(c, rebase.email.send({
            to: "warehouse@example.com",
            subject: "New order",
            html: "<p>Pick and pack</p>"
        }));
        return c.json({ received: true });
    });
});
```

An un-awaited promise looks equivalent and is not. `waitUntil` buys two things:

- **On Node**, the promise is tracked, so a graceful shutdown waits for it instead of the process exiting out from under a half-sent webhook. A floating promise at `SIGTERM` is simply lost.
- **On an isolate-based host**, the host is told to keep the isolate alive until the promise settles. Without it, work is dropped the moment the response resolves — silently, with a clean 200 in the logs.

A rejection is logged rather than left to the unhandled-rejection handler, so a failure names the route it came from.

Code that runs outside any request has no `c` to pass: a module-level initialiser, a helper that routes and crons share, work a cron run starts and does not wait for. Hand `waitUntil` the work alone:

```typescript no-verify
import { waitUntil } from "@rebasepro/server/functions";

let ready: Promise<void> | undefined;

export function ensureCatalogue(): Promise<void> {
    ready ??= loadCatalogue().then(() => {
        // No request to attach it to, but shutdown still waits for it.
        waitUntil(rateNewSongs());
    });
    return ready;
}
```

The work is tracked for graceful shutdown and a rejection is logged, as with `c`. What it cannot do is keep an isolate alive, because that is the request's execution context: pass `c` whenever there is a request. Work that a cron run, a job or a queue handler can simply `await` should be awaited instead; the run is what shutdown waits for, and its outcome is recorded with it.

Shutdown waits at most 5 seconds for this work. Work that takes minutes belongs in a [cron job](/docs/backend/cron-jobs/) or a [job](/docs/backend/jobs/), which are recorded and restartable. A cron job also runs [one at a time across instances](/docs/backend/cron-across-instances/#concurrency-guarding), whether the schedule or a manual trigger started it.
