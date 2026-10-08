---
title: Roles and scopes
sidebar_label: Roles and scopes
description: "What a caller may do: the data plane every person holds, the admin plane that roles grant, the scopes an app declares for itself, and how each credential carries them."
---

Every request to a Rebase backend asks one question: may this caller do this?
The answer is a **scope**, a string named `resource:action`: `data:read`,
`users:write`, `cron:read`. A person's session, an API key, an MCP token and a
role all hold scopes, and they all use the same strings. A grant reads the same
on a key, on a role and on a consent screen.

## Two planes

Scopes come in two planes, and a person holds them differently.

**The data plane** is `data:*`, `storage:*` and `functions:invoke`. Every
signed-in person holds all of it. What a person may do with a row is decided by
the collection's [security rules](/docs/collections/security-rules/), row by row,
and what they may do with a file by the [storage policies](/docs/backend/storage/#per-object-authorization).
A scope never decides that for a person. On a key or a token, data-plane scopes
narrow: a key that holds only `data:read:posts` reads `posts` and nothing else,
whatever the rules would allow.

**The admin plane** is everything else: users, schema, the database, backups,
cron, logs and keys. Nobody holds it implicitly. The built-in `admin` role holds
all of it. Any other role holds what the app declares for it.

## The scopes

| Scope | Plane | Target | What it allows |
|---|---|---|---|
| `data:read` | data | collection | Read rows, through the caller's row-level security |
| `data:write` | data | collection | Create and update rows, through the caller's row-level security |
| `data:delete` | data | collection | Delete rows, through the caller's row-level security |
| `storage:read` | data | storage source | List and download files |
| `storage:write` | data | storage source | Upload files and create folders |
| `storage:delete` | data | storage source | Delete files |
| `functions:invoke` | data | function | Call custom functions. A function can do anything its code does |
| `users:read` | admin | — | List accounts and their roles |
| `users:write` | admin | — | Create, edit and delete accounts, reset passwords and second factors, assign roles up to the holder's own |
| `schema:read` | admin | — | Read the collection schema, plan schema changes, run the RLS audit, read the private API docs |
| `schema:write` | admin | — | Apply schema changes: edits collection files and alters the database |
| `database:read` | admin | — | List databases, tables, Postgres roles and branches |
| `database:write` | admin | — | Run SQL as the database owner, outside row-level security, and create or delete branches |
| `backups:read` | admin | — | List and download backups: every row, outside row-level security |
| `cron:read` | admin | — | List cron jobs and read their run history |
| `cron:write` | admin | — | Trigger cron jobs and switch them on or off |
| `logs:read` | admin | — | Read the server's logs |
| `keys:read` | admin | — | List the project's service keys. Never grantable to a key |
| `keys:write` | admin | — | Create, change and revoke service keys. Never grantable to a key |

`GET /api/auth/scopes` returns this list for the running backend, with the app's
own scopes added, plus the scopes the caller holds. Any signed-in caller may read
it:

```ts
const { scopes, held } = await client.personalKeys.listScopes();
// scopes: [{ scope: "data:read", label: "Read data", plane: "data", target: "collection", … }, …]
// held:   ["data:read", "data:write", …]
```

## Targets

A data-plane scope can be narrowed to one target, after a second colon:

- `data:read:posts` reads the `posts` collection only. The target is a collection slug.
- `storage:write:avatars` uploads to the `avatars` storage source only. The
  default source's id is `(default)`: `storage:read:(default)`.
- `functions:invoke:export` calls the `export` function only.

The plain scope covers every target. A narrowed scope covers its own target and
nothing else. It never answers a question about all targets: a key holding
`data:read:posts` cannot list every collection.

Admin-plane scopes take no target. An app scope takes one when it declares a
`target`, as below.

## Declaring roles

Roles are declared on the users collection, under `auth.roles`. A role is a name
the database sees, which RLS policies can match, plus a list of admin-plane and
app scopes.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        roles: {
            support: {
                name: "Support",
                description: "Helps people back into their accounts.",
                scopes: ["users:read", "users:write", "logs:read"]
            },
            developer: {
                name: "Developer",
                scopes: ["schema:read", "database:read", "logs:read", "cron:read"]
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" },
        roles: {
            name: "Roles",
            type: "array",
            columnType: "text[]",
            of: {
                name: "Role",
                type: "string",
                enum: { admin: "Admin", support: "Support", developer: "Developer", editor: "Editor" }
            }
        }
    }
});
```

A person holds a role when their `roles` column lists it. Assign it in the admin
panel, or with `PUT /api/admin/users/:uid`.

The boot refuses a declaration that would read as a grant it is not:

- **`admin` cannot be declared.** It is built in and holds every scope.
- **A role may not list a data-plane scope.** Every person already holds the data
  plane. `data:write` on a role would grant nothing and look like it granted
  something. What a role may do with rows belongs in the collection's `securityRules`.
- **Every scope must exist.** An unknown name fails the boot and lists the valid ones.

A role you do not declare is still a role. `editor` above has no entry, so it
holds no admin-plane scope, and an RLS policy can still match it.

`defaultRole`, the role every new registrant gets, may not be `admin` or a
declared role that holds any admin-plane scope. A stranger who signs up should
hold nothing that manages the project. The boot refuses it.

:::note[`schema-admin` is gone]
Older versions treated a role named `schema-admin` as a second admin. It now
means nothing on its own. If your project used it, declare it with the scopes
you meant, for example
`"schema-admin": { scopes: ["schema:read", "schema:write", "database:read", "database:write"] }`.
:::

`GET /api/admin/roles` lists `admin` and every declared role with its scopes. It
needs `users:read`:

```ts
const { roles } = await client.admin.listRoles();
// [{ id: "admin", name: "Admin", scopes: [...], builtIn: true },
//  { id: "support", name: "Support", scopes: ["users:read", "users:write", "logs:read"], builtIn: false }, …]
```

## App scopes

An app can name its own operations as scopes, under `auth.scopes`:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

export const usersCollection = defineCollection({
    slug: "users",
    name: "Users",
    table: "users",
    auth: {
        enabled: true,
        scopes: {
            "project:deploy": {
                label: "Deploy projects",
                description: "Starts a deploy of one project.",
                target: "project"
            }
        }
    },
    properties: {
        email: { name: "Email", type: "string" }
    }
});
```

The name is `resource:action`, lower case, with no target. It may not reuse a
built-in resource: `data`, `storage`, `functions`, `users`, `schema`,
`database`, `backups`, `cron`, `logs` and `keys` are taken. `label` is required,
because it is what a person reads when they grant the scope. `target` names what
a target means, so a key can hold `project:deploy:p1`.

Every signed-in person holds every app scope. Like the data plane, the code
behind the scope decides whether this person may act. The scope exists so that
a key can be narrowed to that one action. A role may list app scopes too.

Check one in a [custom function](/docs/backend/custom-functions/) with `requireScope`:

```typescript
import { defineFunction, requireAuth, requireScope, getUserId } from "@rebasepro/server/functions";

export default defineFunction((app) => {
    app.post(
        "/:project",
        requireAuth,
        requireScope("project:deploy", c => c.req.param("project")),
        async (c) => {
            // A person always passes requireScope. Decide here whether
            // this person may deploy this project.
            return c.json({ project: c.req.param("project"), by: getUserId(c) });
        }
    );
});
```

A key holding `project:deploy:p1` passes for `p1` and gets `403 SCOPE_MISSING`
for any other project. It also needs `functions:invoke`, or
`functions:invoke:<name>` for this function, to reach the function at all.
`hasScope(c, scope, target)` and `getScopes(c)` answer the same question inside a
handler.

## What admin means

`admin` is the one built-in role, and it is more than a list of scopes:

- It holds every admin-plane scope, `keys:*` included.
- It is a role the database sees. The default policies Rebase adds to each
  collection admit it, so an admin reads and writes every row of a collection
  that keeps them. A collection with `disableDefaultPolicies: true` drops them.
- Only an admin can grant `admin`. A role that lists every admin-plane scope is
  still not `admin`: it cannot hand `admin` out, and the default policies do not
  admit it.

`requireAdmin` checks for the role. Prefer `requireScope` for anything a narrower
role or a key should be able to do.

## Nobody grants more than they hold

One rule covers every door that hands out access: **nothing is granted with more
than its grantor holds.**

For keys:

- A key's scopes must be within its creator's own. Otherwise `403 SCOPE_EXCEEDS_CREATOR`.
- A service key's RLS roles must be roles its creator holds, unless the creator
  is an admin. Otherwise `403 ROLE_EXCEEDS_CREATOR`.
- `keys:read` and `keys:write` never go on a key. A key that manages keys could
  mint its own successor. `400 KEY_MANAGEMENT_SCOPE`.

For accounts, a holder of `users:write`:

- cannot edit, reset or delete an account that holds a role or scope they do not:
  `403 ACCOUNT_OUTRANKS_CALLER`. Without this, a support role could reset an
  admin's password and sign in as them.
- cannot grant roles that hold more than they do: `403 ROLE_EXCEEDS_CALLER`.

## How each credential holds scopes

| Credential | Acts as | Holds |
|---|---|---|
| A person's session | the person | the data plane, every app scope, and their roles' scopes. An admin holds everything |
| [Service key](/docs/backend/api-keys/#service-keys) `rk_live_…` | `api-key:<id>`, with the RLS roles `service` plus its own `roles` | exactly its scopes |
| [Personal key](/docs/backend/api-keys/#personal-keys) `rk_live_…` | its owner, with the owner's roles as they are at each request | its scopes, cut down to what the owner holds now |
| [MCP token](/docs/ai/mcp/#the-remote-endpoint) | the person who connected it | `data:read`, `data:write`, `data:delete` as granted, optionally per collection |
| `REBASE_SERVICE_KEY` | `service`, with the `admin` role | everything |

A key or a token never bypasses row-level security. Its scopes are one ceiling,
and the database's policies for the identity it acts as are another.

## When a scope is missing

The answer is `403 SCOPE_MISSING`, and `details.requiredScope` names the scope,
with its target when there is one:

```json
{
  "error": {
    "message": "This API key does not hold the \"cron:write\" scope. Create a key that includes it.",
    "code": "SCOPE_MISSING",
    "details": { "requiredScope": "cron:write" }
  }
}
```

For a person, the fix is a role that lists the scope. For a key, it is a new key
that holds it.

## Next steps

- [API keys](/docs/backend/api-keys/): service keys, personal keys, and the minting rules
- [Security Rules (RLS)](/docs/collections/security-rules/): what a person may do with each row
- [Endpoint index](/docs/backend/endpoints/): the scope each route needs
- [Error codes](/docs/backend/errors/#authentication-and-accounts): every refusal above
