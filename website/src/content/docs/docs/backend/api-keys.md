---
title: API keys
sidebar_label: API keys
description: "Scoped, revocable keys for machine callers: what a key can reach, how scopes compose with row-level security, and the admin endpoints that manage them."
---

## API Keys

API keys provide machine-to-machine authentication for agents, MCP servers, CI pipelines, and external integrations. They support per-collection permission scoping and optional full admin access.

### Creating an API Key

```bash
# Via CLI
rebase api-keys create --name "My Integration" \
  --permissions '[{"collection":"orders","operations":["read","write"]}]'

# Via REST (requires admin auth)
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My Integration",
    "permissions": [{ "collection": "orders", "operations": ["read", "write"] }]
  }'
```

The response includes the full plaintext key (`rk_live_...`) **exactly once** — store it immediately.

### Using an API Key

```bash
curl http://localhost:3000/api/data/orders \
  -H "Authorization: Bearer rk_live_abc123..."
```

### Permissions and RLS: two independent gates

An API key's request passes through **two** authorization checks, and both must allow it:

1. **The key's permission list** — collection × operation, checked at the route layer.
2. **Row-Level Security** — API keys do *not* bypass RLS. A key runs as
   `uid: "api-key:<id>"` with the `service` role (plus `admin` when
   `admin: true`). Admin keys pass via the built-in admin policies; a
   non-admin key only sees rows that a security rule explicitly grants to
   the `service` role or to the public. Owner-style rules
   (`owner_id = rebase.uid()`) never match an API key.

So a non-admin key with `"*"` permissions can still get empty results — that's
RLS working, not a bug. Either grant the `service` role in the relevant
collections' security rules, or use an admin key.

### Custom Functions

Function invocations are scoped like collections, under the `functions`
namespace: `{"collection": "functions", "operations": ["write"]}` grants every
function, `"functions/<name>"` grants one, and the global `"*"` wildcard grants
all. A key without such an entry cannot invoke functions at all.

### Storage

Storage works the same way, under the `storage` namespace:
`{"collection": "storage", "operations": ["read", "write"]}` lets the key
download/list (`read`), upload and create folders (`write`), and delete files
(`delete`). The global `"*"` wildcard also grants storage. A key without such
an entry cannot touch storage. TUS resumable-upload routes count as `write`
for every step (including the offset check and cancel), so a write-scoped key
can complete an upload on its own.

### Agents and MCP Servers

An agent wants the *narrowest* key that does its job, not an admin one. Start
scoped, and give it an expiry:

```bash
rebase api-keys create -n "My Agent" \
  --permissions '[{"collection":"articles","operations":["read"]}]' \
  --expires 30d
```

Operations are `read`, `write` and `delete`, derived from the HTTP method:
`GET`/`HEAD`/`OPTIONS` → `read`, `POST`/`PUT`/`PATCH` → `write`, `DELETE` →
`delete`.

#### A scoped key reads zero rows until a rule grants `service`

This is the step that makes a correctly scoped key look broken. A non-admin key
runs as `uid: "api-key:<id>"` with the roles `["service"]`, and the RLS policy
injected into every collection by default compiles to:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

— the server context, or an admin. A non-admin key matches neither arm, so on a
collection with no `securityRules` the request succeeds with an empty result set
and no error explaining why. Grant the role explicitly:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Because `rebase.uid()` carries the key's id, a rule can also scope rows to one
specific key:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### Don't use `"*"` for a read-only key

The `"*"` wildcard is not "every collection" — it also matches the `functions`
namespace and `storage`. A `GET` counts as `read`, and a custom function's
handler is arbitrary code that can write, so a wildcard "read-only" key can
mutate through a function. Naming collections explicitly gives the key no
function access at all.

#### `--admin --full-access`: CI, migrations, first-party tooling

`"admin": true` grants the key the admin role — `/api/admin/*` routes for schema
management, user management, and more, plus cron, backups, and logs. Combined
with `--full-access` (`{"collection": "*", "operations": ["read", "write",
"delete"]}`) the key holds every collection plus all storage and every custom
function. That is the right shape for CI, migrations, and trusted first-party
tooling — not for agents.

```bash
# CLI
rebase api-keys create -n "CI" --admin --full-access

# REST
curl -X POST http://localhost:3000/api/admin/api-keys \
  -H "Authorization: Bearer <service-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CI",
    "admin": true,
    "permissions": [{ "collection": "*", "operations": ["read", "write", "delete"] }]
  }'
```

#### No realtime over API keys

The realtime WebSocket does not parse `rk_` tokens — it accepts user JWTs and
the service key only. An agent authenticated with an API key polls the REST
endpoints instead of subscribing.

### Key Options

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Human-readable label |
| `permissions` | `ApiKeyPermission[]` | Per-collection access (`"*"` = everything; `"functions/<name>"` = one function; `"storage"` = file storage) |
| `admin` | `boolean` | Grant admin role — admin routes + RLS admin policies |
| `rate_limit` | `number \| null` | Requests per 15-min window (`null` = the server default, 1000) |
| `expires_at` | `string \| null` | ISO-8601 expiration timestamp |

The CLI requires an explicit scope: pass `--permissions '<json>'` or opt into
`--full-access` — there is no silent full-access default.

Keys can be listed, updated, and revoked via `/api/admin/api-keys` or the
`rebase api-keys` CLI commands — but not by an API key. Any request to
`/api/admin/api-keys` authenticated with an `rk_` key is refused with `403
API_KEY_SELF_MANAGEMENT_FORBIDDEN`, whatever its `admin` flag. Key management
requires an admin user's session or the service key.

## Next Steps

- [REST API](/docs/backend/api/) — the endpoints a key calls
- [Endpoint index](/docs/backend/endpoints/) — the gate on every route, keys included
- [Security Rules (RLS)](/docs/collections/security-rules/) — what the database enforces on top of a key's scopes
