---
title: Rate limits in functions
sidebar_label: Rate limits in functions
description: "rateLimit and checkRateLimit for custom functions: 429s with Retry-After, counted in the backend's own store so replicas share one allowance."
---

For a route that costs something per call (a paid API, an email, a notification), `rateLimit` is middleware that answers `429` with `Retry-After`, and `checkRateLimit` decides inside a handler, keyed by anything:

```typescript
import { defineFunction, rateLimit, checkRateLimit } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post("/invite", rateLimit({ name: "invite", limit: 40, windowMs: 3_600_000 }), (c) => c.json({ ok: true }));
    app.post("/speak", async (c) => {
        const { allowed } = await checkRateLimit(c, { name: "speak", limit: 200, windowMs: 86_400_000, key: c.req.query("room") });
        return allowed ? c.json({ ok: true }) : c.json({ error: "limit reached" }, 429);
    });
});
```

Counts live where the backend keeps its own: per process by default, shared across replicas with `REBASE_RATE_LIMIT_STORE=sql` (see [Configuration](/docs/getting-started/configuration/) and [Running multiple instances](/docs/deployment/multiple-instances/)). A `Map` in module scope only ever counts per process. The default key, `clientAddress(c)`, follows `TRUSTED_PROXY_HOPS`, never a header the caller wrote.

For the rest of what a function can do, see [Custom Functions](/docs/backend/custom-functions/).
