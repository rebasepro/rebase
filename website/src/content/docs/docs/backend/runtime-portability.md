---
title: Runtime portability
sidebar_label: Runtime portability
description: What a custom function imports decides whether it could run outside a Node process — what is portable, what is Node-only, and how rebase build and rebase doctor report it.
---

A custom function is a Hono app, and Hono runs on every JavaScript server runtime. Whether *your* function could run somewhere other than a Node process therefore comes down to what its own file imports and touches.

Nothing here is a restriction on what you may write today. Every Rebase deployment is a Node process, a function that reads a file or opens a socket is a perfectly good function, and no build or deploy fails because of any of this. It is written down so the answer is knowable now rather than discovered per-file later.

**Portable — works on any runtime:**

- Everything exported from `@rebasepro/server/functions`
- `getDriver(c)` and `rebase.dataAsAdmin` — both go over the same wire wherever they run
- `rebase.auth`, `rebase.storage`, `rebase.email`
- `fetch`, `Request`/`Response`, `URL`, `crypto.subtle`, `TextEncoder` — the web platform
- Any dependency that does not need Node

**Node-only:**

- `rebase.sql()` — the database owner connection is a TCP socket
- A directly imported Drizzle or `pg` client, for the same reason
- Node built-ins: `fs`, `path`, `crypto` (the Node module — `globalThis.crypto` is portable), `child_process`, …
- Packages built on them: `jsonwebtoken`, `nodemailer`, `sharp`, `bcrypt`, …

**Latent bugs on every runtime** — these are worth fixing regardless:

- `process.env` read at module scope (see [Configuration and Secrets](/docs/backend/custom-functions/#configuration-and-secrets))
- Fire-and-forget promises instead of [`waitUntil`](/docs/backend/custom-functions/#background-work)
- Relying on a handler continuing to run after its request timed out. On Node it does; that is a property of the process, not a promise the framework makes

## Checking your own functions

`rebase build` prints a line per actionable finding and records the verdict per function in the bundle manifest:

```json
{
  "functions": [
    { "name": "hello", "file": "backend/functions/hello.js", "portable": true },
    { "name": "reports", "file": "backend/functions/reports.js", "portable": false,
      "requires": ["imports the Node built-in \"fs\""] }
  ]
}
```

`rebase doctor` reports the same thing without building.

## If you need a runtime-specific path

`runtimeKey()` returns `"node"`, `"workerd"`, `"deno"`, `"bun"`, `"edge-light"`, `"fastly"` or `"other"`; `isNodeRuntime()` is the common check. Use them to degrade, not to fork an implementation — a function that needs two implementations is two functions.

```typescript
import { defineFunction, isNodeRuntime } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/stats", async (c) => {
        if (!isNodeRuntime()) return c.json({ error: "Not available here" }, 501);
        const rows = await rebase.sql("SELECT count(*) AS total FROM jobs");
        return c.json({ totalJobs: Number(rows[0]?.total ?? 0) });
    });
});
```
