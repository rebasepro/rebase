# RLS scoping and reserved identities

Rebase implements RLS by scoping the DataDriver via `withAuth()` before each request. This injects the authenticated user's identity into the database context.

### How RLS Scoping Works

1. Auth middleware verifies the JWT (or API key / service key).
2. The middleware calls `scopeDataDriver(driver, { uid, roles })`.
3. If the driver supports `withAuth()` (e.g. Postgres), it returns a scoped clone with Postgres session variables set:
   - `rebase.uid()` — the user's ID
   - `rebase.jwt()` — the JWT claims
   - `rebase.roles()` — the user's role IDs
4. All subsequent queries in that request use the scoped driver with RLS policies applied.

### Fail-Closed Security

> **IMPORTANT FOR AGENTS:** If `withAuth()` throws an error, the request is **rejected** with 500. The system never falls back to unscoped access. This is by design (fail-closed).

### Anonymous Users

When `requireAuth` is `false` and no token is provided, the driver is scoped with:
- `uid: "anon"`
- `roles: ["anon"]`

This allows Postgres RLS policies to handle public access explicitly.

### Service Key Scoping

Requests with the `serviceKey` are scoped as `uid: "service"`, `roles: ["admin"]`.
That is admin-scoped, **not** RLS-bypassing: the statements still run as
`rebase_user` with policies evaluated against that identity — the admin role
simply satisfies the built-in default policies. `policy.serverContext()`
(`rebase.uid() IS NULL`) is **false** for it, so a collection with
`disableDefaultPolicies: true` whose only rule is `serverContext()` denies these
writes and returns zero rows for these reads. `rebase.sql()` is the real bypass:
owner connection, no policies.

### API Key Scoping

A **service key** uses its own identity for RLS scoping: `uid: "api-key:{id}"`, `roles: ["service", ...key.roles]` — `["service", "admin"]` for a key created with `roles: ["admin"]`. It does not inherit the `created_by` user's identity. A **personal key** is the opposite: it runs as its owner — their uid and their roles as they are at each request — so owner-style rules match it. Either way the key's scopes are a second, independent ceiling on top of RLS.

### Reserved System Identities

The auth middleware assigns these reserved identities automatically. They are visible in `context.user` (global and collection callbacks) and `c.get("user")` (custom functions):

| Auth Method | `uid` | `roles` | When It Occurs |
|---|---|---|---|
| JWT (end-user) | Real user ID (e.g. `"abc123"`) | User's assigned roles (e.g. `["viewer"]`) | Normal authenticated requests |
| Service Key | `"service"` | `["admin"]` | Server-side `rebase.dataAsAdmin` calls, cron jobs, or any request with `Authorization: Bearer <serviceKey>` |
| Service API key | `"api-key:{id}"` | `["service"]` | Machine-to-machine API key requests |
| Service API key with `roles: ["admin"]` | `"api-key:{id}"` | `["service", "admin"]` | Keys meant to read every row (CI, migrations) |
| Personal API key | the owner's uid | the owner's current roles | A person's own scripts and tools |
| Anonymous | `"anonymous"` | `["anon"]` | Unauthenticated when `requireAuth: false` |
| No token + `requireAuth: true` | — | — | **Rejected (401)** |

> **IMPORTANT FOR AGENTS:** the server singleton's data plane is `rebase.dataAsAdmin` (used in cron jobs, custom functions and webhooks). It is backed by the **native DataDriver** — no JSON round trip through the REST API — and is scoped once, at boot, as `{ uid: "service", roles: ["admin"] }`. Callbacks live in the driver rather than the route layer, so global and collection callbacks still fire, seeing `uid: "service"` and `roles: ["admin"]`. That is how a callback distinguishes a server-internal read from an end-user one. `rebase.data` does not exist — not on the type and not at runtime — so the privileged plane has exactly one name.

---
