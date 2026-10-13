# The `rebase` singleton

Once `initializeRebaseBackend()` has completed — and inside every request, cron
run and job a backend serves — a server-side singleton is available. Which
backend it is depends on where it is read (0.25+): inside a request, cron run or
job, the backend serving it; anywhere else, the **process default**, which
`initializeRebaseBackend` sets to its backend and `setDefaultBackend(backend)`
sets to one built with `createRebaseBackend` (which sets nothing itself):

```typescript
import { rebase } from "@rebasepro/server";
```

> **WARNING FOR AGENTS:** The singleton is a **lazy proxy** — accessing it at module import time (top-level) will throw. Only use it inside request handlers, cron jobs, hooks, or functions that run after the server has started.

### How It Works

The singleton is a JavaScript `Proxy` object. Any property access on `rebase.*` is intercepted:
- Inside a request, cron run or job a backend serves, the access is forwarded to that backend's in-process client — the object it exposes as `backend.rebase`. `ctx.rebase` in a function or cron is the same object. Two backends in one process each see themselves (0.25+).
- Anywhere else it is forwarded to the process default's client (`setDefaultBackend`, or `initializeRebaseBackend`).
- If there is neither, a descriptive error is thrown: `"rebase.<prop>: server not initialized yet"`. A script that built a backend with `createRebaseBackend` either calls `setDefaultBackend(backend)` or uses `backend.rebase` directly.
- The proxy is **read-only** — attempting to assign `rebase.anything = value` throws.

The singleton has **two planes**, and they do not work the same way:

- **Data** (`rebase.dataAsAdmin`) is backed by the native DataDriver — no JSON
  serialization, no HTTP dispatch, no middleware. It is scoped once, at boot, as
  `{ uid: "service", roles: ["admin"] }`: **admin-scoped, not RLS-bypassing**.
- **Control plane** (`rebase.auth`, `rebase.admin`, `rebase.cron`,
  `rebase.functions`) reaches the backend's own routes in-process — no network
  hop, and wherever (or whether) the application mounted them — with an internal
  per-boot service key. Middleware your application added to its own Hono app
  does not run on these calls (0.25+; in 0.24 they went through the
  application's app). `rebase.storage` and `rebase.email` call their
  controllers directly.

`rebase.sql()` is the one unconditional bypass: owner connection, no policies.

### What It Exposes

The `rebase` singleton implements `RebaseServerClient` — `RebaseClient` narrowed
to the guarantees that always hold on a server, and with `data` **gone** so the
privileged plane has exactly one name. It is not there at runtime either:
`rebase.data` is `undefined`, in TypeScript and in plain JavaScript alike.

| Property | Type | Description |
|----------|------|-------------|
| `rebase.dataAsAdmin` | `RebaseData` | Admin-level data access — scoped as `{ uid: "service", roles: ["admin"] }`, so RLS is **evaluated against that identity, not bypassed**. Use `rebase.dataAsAdmin.<slug>.find()`, `.findOne()`, `.create()`, `.update()`, `.delete()` |
| `rebase.auth` | `AuthClient` | Authentication operations |
| `rebase.storage` | `StorageSource \| undefined` | File storage operations |
| `rebase.email` | `EmailService` | Send emails. **Always present** — without SMTP, `send()` throws a message naming what to set, so ask `rebase.email.isConfigured()` rather than testing for the property |
| `rebase.admin` | `AdminAPI \| undefined` | User management API |
| `rebase.sql` | `(query, options?) => Promise<Record[]>` | Raw SQL. Always present server-side on SQL engines. Pass values via `options.params` and reference them as `$1`, `$2`, … Runs on the owner connection — this, not `dataAsAdmin`, is the unconditional RLS bypass |
| `rebase.baseUrl` | `string \| undefined` | The base HTTP URL of the backend |

### Usage Examples

```typescript
import { rebase } from "@rebasepro/server";

// In a cron job, custom function, or hook:

// Data operations (admin-level: RLS applies, evaluated as the `admin` role)
const { data: posts } = await rebase.dataAsAdmin.collection<Record<string, unknown>>("posts").find({ limit: 10 });
await rebase.dataAsAdmin.collection<Record<string, unknown>>("orders").create({ status: "pending", total: 99.99 });

// Send an email
await rebase.email.send({
    to: "admin@company.com",
    subject: "Daily Report",
    html: "<p>Today's summary...</p>",
});

// Execute raw SQL
if (rebase.sql) {
    const rows = await rebase.sql("SELECT count(*) FROM orders WHERE status = 'pending'");
}
```

### Testing

```typescript no-verify
import { _setRebaseMock, _resetRebaseMock } from "@rebasepro/server";

// Only works when NODE_ENV=test
beforeEach(() => {
    _setRebaseMock({
        dataAsAdmin: mockDataLayer,   // the server singleton has no `data` key
        email: mockEmailService,
    });
});
afterEach(() => _resetRebaseMock());
```

> **IMPORTANT FOR AGENTS:** `_setRebaseMock()` and `_resetRebaseMock()` throw if `NODE_ENV !== "test"`. This prevents accidental use in production.
