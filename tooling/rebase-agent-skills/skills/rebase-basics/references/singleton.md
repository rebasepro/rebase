# The `rebase` singleton

After `initializeRebaseBackend()` completes, a server-side singleton is available:

```typescript
import { rebase } from "@rebasepro/server";
```

> **WARNING FOR AGENTS:** The singleton is a **lazy proxy** — accessing it at module import time (top-level) will throw. Only use it inside request handlers, cron jobs, hooks, or functions that run after the server has started.

### How It Works

The singleton is a JavaScript `Proxy` object. Any property access on `rebase.*` is intercepted:
- If the server **has** been initialized (`_initRebase()` called by `initializeRebaseBackend()`), the access is forwarded to the internal `RebaseClient` instance.
- If the server **has not** been initialized yet, a descriptive error is thrown: `"rebase.<prop>: server not initialized yet"`.
- The proxy is **read-only** — attempting to assign `rebase.anything = value` throws.

The singleton has **two planes**, and they do not work the same way:

- **Data** (`rebase.dataAsAdmin`) is backed by the native DataDriver — no JSON
  serialization, no HTTP dispatch, no middleware. It is scoped once, at boot, as
  `{ uid: "service", roles: ["admin"] }`: **admin-scoped, not RLS-bypassing**.
- **Control plane** (`rebase.auth`, `rebase.admin`, `rebase.cron`,
  `rebase.storage`, …) routes through the Hono app's internal request handler
  (`app.request()`, so no network hop) with an internal per-boot service key.

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
        data: mockDataLayer,
        email: mockEmailService,
    });
});
afterEach(() => _resetRebaseMock());
```

> **IMPORTANT FOR AGENTS:** `_setRebaseMock()` and `_resetRebaseMock()` throw if `NODE_ENV !== "test"`. This prevents accidental use in production.
