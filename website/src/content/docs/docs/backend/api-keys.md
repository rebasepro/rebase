---
title: API keys
sidebar_label: API keys
description: "Long-lived keys for scripts, CI, agents and integrations: service keys and personal keys, the scopes they hold, how they compose with row-level security, and the routes that manage them."
---

## API Keys

An API key is a long-lived bearer credential, `rk_live_…`, for a caller that is
not a person in a browser: a script, a CI job, an agent, an MCP client, another
service. What a key may do is a list of [scopes](/docs/backend/roles-and-scopes/),
such as `data:read:orders` or `cron:write`.

There are two kinds:

- A **service key** is the project's own machine identity. It acts as
  `api-key:<id>`, not as a person. Anyone holding `keys:write` manages them, under
  `/api/admin/api-keys`.
- A **personal key** acts as the account that created it. Each account manages its
  own, under `/api/auth/keys`, when the app turns them on.

### Using a key

Send it as a bearer token, like an access token. `$API_URL` is your backend's
address: whatever `rebase dev` printed, or your deployment's URL.

```bash
curl "$API_URL/api/data/orders" \
  -H "Authorization: Bearer rk_live_abc123..."
```

The same key works on the REST API, storage, custom functions, the admin
surfaces its scopes reach, the realtime WebSocket and the [`/mcp` endpoint](/docs/ai/mcp/#the-remote-endpoint).

## Service keys

### Creating one

A service key needs a name and at least one scope.

```bash
# CLI: talks to the backend with the service key from .env
rebase api-keys create --name "Order sync" --scopes data:read:orders,data:write:orders

# REST: needs keys:write
curl -X POST "$API_URL/api/admin/api-keys" \
  -H "Authorization: Bearer $REBASE_SERVICE_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Order sync",
    "scopes": ["data:read:orders", "data:write:orders"]
  }'
```

Or with the client SDK:

```ts
const { key } = await client.apiKeys.createKey({
    name: "Order sync",
    scopes: ["data:read:orders", "data:write:orders"],
    expires_at: "2027-01-01T00:00:00.000Z"
});
console.log(key.key); // the only time the plaintext is returned
```

The response includes the full plaintext key (`rk_live_...`) **exactly once**.
Store it immediately.

| Field | Type | Description |
|---|---|---|
| `name` | `string` | A label for people |
| `scopes` | `string[]` | What the key may do. At least one |
| `roles` | `string[]` | RLS roles the key runs as, beside `service`. Optional |
| `rate_limit` | `number \| null` | Requests per 15-minute window. `null` or absent uses the server's API-key default, 1000. See [Rate limit](#rate-limit) |
| `expires_at` | `string \| null` | ISO-8601 expiry. Absent means it never expires |

### Scopes and RLS: two independent gates

A request made with a key passes two checks, and both must allow it:

1. **The key's scopes**, checked by the route: `data:write:orders` lets the key
   write `orders` and nothing else.
2. **Row-level security**, checked by the database. A key never bypasses it. A
   service key runs as `uid: "api-key:<id>"` with the role `service`, plus any
   `roles` it was given. Owner-style rules (`owner_id = rebase.uid()`) never
   match it.

So a key holding `data:read` can still get empty results. That is RLS working,
not a bug. Grant the `service` role in the collection's security rules, or give
the key the `admin` role.

#### A service key reads zero rows until a rule grants `service`

This is the step that makes a correctly scoped key look broken. The RLS policy
Rebase adds to every collection by default compiles to:

```sql
rebase.uid() IS NULL OR (string_to_array(rebase.roles(), ',') && ARRAY['admin'])
```

That is the server context, or an admin. A service key with no `admin` role
matches neither arm. On a collection with no `securityRules` the request succeeds
with an empty result and no error explaining why. Grant the role explicitly:

```ts
securityRules: [
    { operation: "select", roles: ["service"], using: "true" }
]
```

Because `rebase.uid()` carries the key's id, a rule can also scope rows to one
key:

```ts
securityRules: [
    {
        operation: "select",
        condition: policy.compare(policy.authUid(), "eq", policy.literal("api-key:<id>"))
    }
]
```

#### The `admin` role

`roles: ["admin"]` (`--roles admin` on the CLI) makes the key run as the `admin`
RLS role too, so it clears the default admin policies of every collection that
keeps them. Those policies cover `SELECT`, `INSERT`, `UPDATE` and `DELETE`, so
row-level security does not limit the key's reads, writes or deletes: it can
read, change and delete every row its scopes reach. The role also passes the
admin checks outside the database: `requireAdmin` in
[custom functions](/docs/backend/custom-functions/), and the writes storage
leaves to admins. It grants no scope: the key still reaches only what its
`scopes` list.

A creator can give a key only roles they hold themselves, unless they are an
admin.

### Full access, for CI and migrations

`--full-access` gives the key every scope its creator holds, less `keys:read` and
`keys:write`, which no key may hold. Through the CLI, which uses the service key,
that is every data-plane and admin-plane scope. Add `--roles admin` and
row-level security no longer limits which rows it reads, changes or deletes:

```bash
rebase api-keys create -n "CI" --full-access --roles admin --expires-in 90
```

That is the right shape for CI, migrations and trusted first-party tooling. It is
not the right shape for an agent.

### Rate limit

A key's `rate_limit` is how many requests it may make in a 15-minute
window, and every door counts against it in one bucket, `api-key:<id>`:

- its HTTP requests to the data, storage and functions APIs;
- its data frames on the realtime socket: fetches, counts, saves and deletes;
- its requests to [`/mcp`](/docs/ai/mcp/#the-remote-endpoint).

Without a `rate_limit` the bucket holds the server's API-key default, 1000. A
personal key has no `rate_limit` of its own, and counts in its own bucket at that
default. Past the limit an HTTP request answers `429` and a socket frame
`RATE_LIMITED`.

The admin routes under `/api/admin`, and the socket's admin messages such as the
SQL editor's, are not rate limited.

## Personal keys

A personal key acts **as its owner**: their uid, and their roles as they are at
each request. Owner-style rules match it, so it reads exactly what its owner
would, narrowed by its scopes. It suits a person's own scripts, a CLI on their
laptop, or a tool they connect to their own account.

They are off by default, because each one is a long-lived credential for an
account. Turn them on in the users collection's auth block:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: { enabled: true, personalKeys: true },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

Then a signed-in account manages its own keys:

```ts
const { key } = await client.personalKeys.createKey({
    name: "My laptop",
    scopes: ["data:read", "functions:invoke:export"]
});
console.log(key.key); // shown once

const { keys } = await client.personalKeys.listKeys();
await client.personalKeys.revokeKey(keys[0].id);
```

The same over REST. `$ACCESS_TOKEN` is the account's own access token, from
signing in:

```bash
curl -X POST "$API_URL/api/auth/keys" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "name": "My laptop", "scopes": ["data:read"] }'
```

A personal key takes `name`, `scopes` and `expires_at`. It carries no `roles`,
because it runs as its owner's, and no `rate_limit`. Sending either is a
`400 INVALID_INPUT`.

What a personal key holds is its scopes, cut down to what its owner holds **now**.
Remove a role from the owner and every key they made shrinks with it. Delete the
account and its keys stop working. Turn `personalKeys` off and every personal key
stops working too.

Only an account can have personal keys. An API key, the service key and a guest
session are refused: `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN` for a key,
`403 PERSONAL_KEY_NEEDS_ACCOUNT` for the other two. With the feature off, every
route answers `403 PERSONAL_KEYS_DISABLED`.

## What each scope reaches

### Data

`data:read`, `data:write` and `data:delete`, plain or narrowed to one collection
(`data:read:posts`). The operation comes from the HTTP method: `GET`, `HEAD`
and `OPTIONS` read, `POST`, `PUT` and `PATCH` write, `DELETE` deletes.
`POST /api/data/:slug/bulk/delete` counts as a delete, although it is a `POST`.

On a nested path, the operation is checked against the collection the path ends
at, and each collection it passes through needs `data:read`. A key holding
`data:read:posts` alone is refused `/api/data/authors/1/posts` until it can also
read `authors`.

### Storage

`storage:read` lists and downloads. `storage:write` uploads and creates folders,
and covers every step of a resumable (TUS) upload, including the offset check
and the cancel. `storage:delete` deletes. The target is a storage source id. The
default source's id is `(default)`, so `storage:read:(default)` reads the default
source only, and `storage:write:avatars` writes a source named `avatars`.
After the scope check, [`storageAuthorize`](/docs/backend/storage/#per-object-authorization)
still runs, with the key's identity.

### Functions

`functions:invoke` calls every custom function. `functions:invoke:<name>` calls
one. Listing the functions at `GET /api/functions` needs the plain scope.

Don't give `functions:invoke` to a key you mean to be read-only. A function is
code, and it can write. Inside a function, `getScopes(c)` and `hasScope(c, …)`
read what the key holds, and an app can declare its own scopes for a function
to check. See [Custom Functions](/docs/backend/custom-functions/#scopes-and-app-scopes).

### Admin surfaces

An admin-plane scope on a key reaches that surface. A scheduler that triggers
cron jobs needs `cron:write`. A log shipper needs `logs:read`. A backup job needs
`backups:read`. The [endpoint index](/docs/backend/endpoints/#admin) lists the
scope each route needs.

`keys:read` and `keys:write` can never go on a key. A key that could manage keys
could mint its own successor, or widen itself. Any request to the key routes
made with a key is refused with `403 API_KEY_SELF_MANAGEMENT_FORBIDDEN`. Manage
keys as a person holding `keys:write`, or with the service key.

### Realtime

A key authenticates the WebSocket too: send it in the `AUTHENTICATE` message.
Fetches and subscriptions need `data:read` on their collection, saves
`data:write`, deletes `data:delete`. A subscription to a nested path needs the
plain scope. Channels (broadcast and presence) are refused for keys. The SQL
editor and branch messages need `database:read` or `database:write`.

## Agents and MCP servers

An agent wants the *narrowest* key that does its job. Start scoped, and give it
an expiry:

```bash
rebase api-keys create -n "My Agent" --scopes data:read:articles --expires-in 30
```

Leave out `data:delete` when the agent may edit but should not remove.
`delete` is separate from `write` for exactly this reason.

## Minting rules

Every key is checked against whoever creates it, the same way on both routes:

| Refusal | When |
|---|---|
| `400 INVALID_SCOPES` | A scope is malformed, unknown, or carries a target it does not take. `details.validScopes` lists every valid one |
| `400 UNKNOWN_SCOPE_TARGET` | A target names a collection, storage source or function this backend does not serve |
| `400 KEY_MANAGEMENT_SCOPE` | `keys:read` or `keys:write` was asked for |
| `403 SCOPE_EXCEEDS_CREATOR` | A scope the creator does not hold. A key never holds more than the account that made it |
| `403 ROLE_EXCEEDS_CREATOR` | A service-key role the creator does not hold, when the creator is not an admin |

A request the key itself lacks a scope for answers `403 SCOPE_MISSING`, with the
scope in `details.requiredScope`. See [Error codes](/docs/backend/errors/#authentication-and-accounts).

## Managing keys

| Method | Path | Needs |
|---|---|---|
| `GET` | `/api/admin/api-keys` | `keys:read` |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` |
| `POST` | `/api/admin/api-keys` | `keys:write` |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write`. Changes `name`, `scopes`, `roles`, `rate_limit` or `expires_at`, under the same rules as creating |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write`. Revokes |
| `GET` | `/api/auth/keys` | An account: its own personal keys |
| `POST` | `/api/auth/keys` | An account, with `personalKeys` on |
| `DELETE` | `/api/auth/keys/:id` | An account: revokes one of its own |

Every route returns keys masked: `key_prefix`, never the hash. Each key reports
its `kind` (`service` or `personal`), its `scopes`, its `roles` and, for a
personal key, its `owner_uid`.

The CLI covers service keys: `rebase api-keys list`, `get`, `create`, `revoke`,
and `scopes`, which lists every scope the backend knows. See the
[CLI reference](/docs/cli/#rebase-api-keys).

## Keys made before scopes

Keys created before scopes existed carry a `permissions` list and an `admin`
flag. At boot, the store gives each one the scopes it now holds. Nothing widens;
where an old grant has no exact match, it narrows:

| Old grant | Scopes now |
|---|---|
| `{ "collection": "posts", "operations": ["read", "write"] }` | `data:read:posts`, `data:write:posts` |
| `"*"` | `data:<op>` and `storage:<op>` for each operation, plus `functions:invoke` if it had `write` |
| `"storage"` | `storage:<op>` for each operation |
| `"functions"` | `functions:invoke`, only if it had `write` |
| `"functions/<name>"` | `functions:invoke:<name>`, only if it had `write` |
| `admin: true` | the `admin` role, plus `users:read`, `users:write`, `schema:read`, `schema:write`, `backups:read`, `cron:read`, `cron:write`, `logs:read` |

The secret does not change, so an integration keeps working. Two grants narrow:

- A function grant without `write` becomes nothing. A `GET` used to count as a
  read, but a function is code, and calling one is not a read.
- An admin key gets no `database:*`, which it could never reach before, and no
  `keys:*`, which no key may hold.

The old `permissions` and `admin` columns are left in place, so a rollback to an
older runtime still reads its keys. A request that sends `permissions` or
`admin` instead of `scopes` is refused with `400 INVALID_INPUT`.

## Next Steps

- [Roles and scopes](/docs/backend/roles-and-scopes/): every scope, and how roles hold them
- [Endpoint index](/docs/backend/endpoints/): the scope each route needs
- [Security Rules (RLS)](/docs/collections/security-rules/): what the database enforces on top of a key's scopes
