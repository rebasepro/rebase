---
title: Logging
sidebar_label: Logging
description: "What a Rebase backend writes to its log, how to write your own lines from functions and crons, and where to read them: Studio, the CLI, and agents through MCP."
---

A Rebase backend writes one line per event to stdout. In production (`NODE_ENV=production`, which Rebase Cloud sets) each line is a JSON object; in development it is a readable line in the terminal. `LOG_LEVEL` (`debug`, `info`, `warn`, `error`; default `info`) sets the lowest level written; see [Configuration](/docs/getting-started/configuration/).

## The shape of a line

<span class="since-badge" data-since="0.38">Since 0.38</span>

Every production line has the same three keys first, then its fields:

```json
{"severity":"WARNING","message":"request","timestamp":"2026-11-24T16:19:39.685Z","component":"http","method":"GET","path":"/api/data/rooms/RCTF","route":"/api/data/:table/:id","status":404,"latencyMs":16,"requestId":"36ed94d2-…","uid":"9de7e4bd-…","errorCode":"NOT_FOUND"}
```

- `severity` is `DEBUG`, `INFO`, `WARNING` or `ERROR`.
- `component` names the part of the runtime the line is about: `http` for requests, `cron`, `schema`, `auth`, `cors`, `boot`, `entrypoint`, `websocket`, `channelbus`, `cdc`, `security-audit` and others. Messages carry no `[Tag]` prefix and no emoji, so a filter reads the field, not the text.
- A field never overwrites the line's own keys: one named `message`, `severity` or `timestamp` is written as `data_message` and so on.

Some lines worth knowing:

| Line | Fields |
|---|---|
| `request` (one per request) | `method`, `path`, `route` (the pattern that answered), `status`, `latencyMs`, `requestId`, `uid`, `collection`, `errorCode`, `errorMessage` |
| `Rebase runtime listening on port …` | `runtimeVersion`, `builtAgainst`, `contract`, `node`, `instance`, and `deploymentId` on Rebase Cloud |
| `Cron job "x" completed in …ms` / `failed …` | `cron`, `outcome`, `durationMs`, `manual`, `scheduledAt`, and `result` when it is small |
| `Loaded cron job: x (…)` | `cron`, `schedule`, `timezone` |
| Boot warnings (driver version skew, schema drift) | the facts as fields, and `fix`: what to run or change |

A 5xx request is logged at `ERROR`, a 4xx at `WARNING` unless the answer is routine (a visitor with no session), the rest at `INFO`.

## Writing your own lines

In a [custom function](/docs/backend/custom-functions/), import `logger` and pass the facts as fields, not inside the text:

```typescript
// backend/functions/charge.ts
import { defineFunction, logger } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/", async (c) => {
        logger.info("charged", { component: "billing", orderId: "o_42", amountCents: 1999 });
        return c.json({ ok: true });
    });
});
```

A line written while a request runs carries that request's `requestId` and the caller's `uid` without being passed them, so it joins the request's own line. A `console.log` is plain text with neither, and a severity filter cannot see it. Values under secret-looking keys (`password`, `token`, `apiKey`, …) are redacted.

In a [cron job](/docs/backend/cron-jobs/), `ctx.log` writes to the same log with the job's id. Text followed by one object writes the object's keys as fields:

```typescript
// backend/crons/score.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    schedule: "0 * * * *",
    async handler(ctx) {
        ctx.log("scored", { leads: 3 });
        return { leads: 3 };
    },
});
```

## Reading the log

- **Studio**, *Logs*: the running process's recent lines, live. Pick a level ("warn and above") and a source, search messages and field values, and open a line to see its fields. A request reads as `GET /path 404 · 16 ms`.
- **Rebase Cloud console**, *Container logs*: every pod's output, with level counts, search and the same readable rows.
- **CLI**: `rebase cloud logs --runtime` prints each record as one readable line (`14:30:32.126 WARN  [boot] Driver version skew …  fix="…"`); `--level warn`, `--grep`, `--since`, `-f` and `--raw` are on [the CLI page](/docs/cli/cloud/#logs). `rebase logs` reads one local process the same way.
- **Agents**: the Rebase Cloud MCP `logs` tool takes `level`, `grep`, `sinceTime` and `previous`, and returns one compact line per record; pass its `nextSinceTime` back as `sinceTime` to read on from where it stopped.

A pod's log lives as long as the pod: a redeploy starts a new one. The cron history (`rebase cron logs`, Studio's *Cron jobs*) is kept in the database.
