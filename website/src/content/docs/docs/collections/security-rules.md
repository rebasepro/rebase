---
title: Security Rules (RLS)
sidebar_label: Security Rules
description: Define Row Level Security policies for your collections using convenience shortcuts or raw SQL expressions.
---

## Overview

Security rules let you define **Row Level Security (RLS)** policies for your PostgreSQL tables directly in your collection definitions. When the Drizzle schema is generated, Rebase creates the corresponding `CREATE POLICY` statements.

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "authorId" }
    ]
});
```

## How It Works

1. You define `securityRules` on a collection
2. `rebase schema generate` creates Drizzle schema with RLS enabled
3. `rebase db push` or `rebase db migrate` applies the policies to PostgreSQL
4. Every query is filtered by the current user's context automatically

The authenticated user's identity is available in SQL via:

| Function | Returns |
|----------|---------|
| `rebase.uid()` | The current user's ID |
| `rebase.roles()` | Comma-separated app role IDs |
| `rebase.jwt()` | Full JWT claims as JSONB |

These are set automatically per-transaction by the Rebase backend.

## Convenience Shortcuts

### Owner-based Access

The simplest pattern — users can only access rows they own:

```typescript
securityRules: [
    { operation: "all", ownerField: "user_id" }
]
```

This generates: `USING (user_id = rebase.uid())`

### Public Access

Allow anyone (including unauthenticated users) to read:

```typescript
securityRules: [
    { operation: "select", access: "public" }
]
```

This generates: `USING (true)`

### Authenticated Access

Allow any signed-in user. This one is a `condition` rather than an `access`
shortcut — `access` has exactly one value, `"public"` — because "signed in" is a
test against the caller, and the builder is where tests against the caller live:

```typescript
import { policy } from "@rebasepro/types";

securityRules: [
    { operation: "select", condition: policy.authenticated() }
]
```

`policy.authenticated()` is true for anonymous *sign-in* too, which mints a real
user row and a real session. Use `policy.registered()` <span class="since-badge" data-since="0.18">Since 0.18</span> where a guest should not
qualify — writing a review, joining an organization, spending money.

### Role-based Access

Restrict operations to specific roles:

```typescript
securityRules: [
    { operation: "all", roles: ["admin"] },
    { operation: "select", roles: ["editor", "viewer"] }
]
```

### Membership / Relational Access

To scope access by membership in a *related* collection — e.g. "only rows whose
team the caller belongs to" — use the structured `condition` with
`policy.existsIn`. It compiles to a single correlated `EXISTS` subquery (no
per-row lookups), and is the safe, first-class alternative to hand-writing the
raw SQL shown below.

```typescript
import { policy } from "@rebasepro/types";

// documents visible only to members of the document's team:
securityRules: [
    {
        operation: "select",
        condition: policy.existsIn({
            collection: "team_members",         // the join / membership collection
            where: policy.and(
                // correlate to the row being checked:
                policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
                // …and to the caller:
                policy.compare(policy.field("user_id"), "eq", policy.authUid()),
            ),
        }),
    },
]
```

Inside `where`, `policy.field(...)` refers to a column of the joined collection
(`team_members`), while `policy.outerField(...)` refers to a column of the row
being checked (`documents`). Combine with `policy.authUid()` to scope to the
current user. Because it is enforced by the database, the admin UI treats it as
server-authoritative.

#### The `policy` builder, in full

Imported from `@rebasepro/types`. Expressions compose; operands are the leaves.

| Expression | Compiles to |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` | conjunction / disjunction |
| `policy.not(e)` | negation |
| `policy.compare(left, op, right)` | a comparison between two operands |
| `policy.rolesOverlap(roles)` | the caller has **any** of these app roles |
| `policy.rolesContain(roles)` | the caller has **all** of these app roles |
| `policy.authenticated()` | signed in — `rebase.uid()` is set **and is not an anonymous sentinel**. `IS NOT NULL` alone would be a tautology, since an anonymous request sets a sentinel rather than leaving it unset |
| `policy.registered()` <span class="since-badge" data-since="0.18">Since 0.18</span> | signed in **with an account** — `authenticated()` and not a guest. See below |
| `policy.serverContext()` | `rebase.uid() IS NULL` — see the caution below |
| `policy.existsIn({ collection, where })` | a correlated `EXISTS` subquery |
| `policy.raw(sql)` | an escape hatch, inserted verbatim |

| Operand | Means |
|---|---|
| `policy.field(name)` | a column of the collection being checked — or, inside `existsIn`, of the joined one |
| `policy.outerField(name)` | inside `existsIn`, a column of the outer row |
| `policy.literal(value)` | a string, number, boolean or `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | `rebase.roles()` |

### `authenticated()` and `registered()`

<span class="since-badge" data-since="0.18">Since 0.18</span>

Two different things are called anonymous, and it is worth being precise about
which one a rule means.

An **unauthenticated** request carries no session at all. It is given a sentinel
id so that `rebase.uid()` is never `NULL` on the user path, and
`policy.authenticated()` excludes it — that is what makes it mean "signed in"
rather than "anyone".

A **guest** is the other thing: a session with nobody behind it.
`POST /auth/anonymous` mints a real user row with a real uid, so a guest passes
every test that looks at the id. That is the point of the feature — a cart
before checkout, a draft before signup — and it means `authenticated()` is true
for anybody who pressed *Continue as guest*, which asks for no email, no
password and no agreement to anything.

`policy.registered()` is `authenticated()` plus "not a guest". Reach for it
wherever a rule is about a person who could be held responsible for something:
writing a review, joining an organization, spending money. Reach for
`authenticated()` where a guest is genuinely welcome.

```ts
// Anyone with a session, guests included — a draft cart.
{ operation: "insert", check: policy.authenticated() }

// Someone with an account.
{ operation: "insert", check: policy.registered() }
```

Under the hood the guest flag travels with the session — it is in the access
token and reaches the database as `rebase.is_anonymous()` — so a policy can ask
the question without a lookup. A database served by a server too old to set it
reads every session as an account, which is the behaviour that deployment
already had.

:::caution[`serverContext()` is not satisfied by the server singleton]
It compiles to `rebase.uid() IS NULL`, and `rebase.dataAsAdmin` runs as
`uid: "service"` — so it is **false** for the accessor most people mean by "the
server". A collection with `disableDefaultPolicies: true` whose only rule is
`serverContext()` denies those writes (`42501`) and returns zero rows — HTTP 200,
empty — for those reads. `rebase.sql()` is the accessor that genuinely bypasses
policies.
:::

## Raw SQL Expressions

For complex logic, use `using` and `withCheck`:

```typescript
securityRules: [
    {
        operation: "select",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

- **`using`** — Filters which existing rows are visible (applies to SELECT, UPDATE, DELETE)
- **`withCheck`** — Validates new row values (applies to INSERT, UPDATE)

Column references use `{column_name}` syntax which gets resolved to the full table-qualified column.

## Combining Shortcuts and SQL

Mix convenience shortcuts with raw SQL:

```typescript
securityRules: [
    // Admins can do anything
    { operation: "all", roles: ["admin"], using: "true" },
    // Regular users can only see their own rows
    { operation: "select", ownerField: "user_id" },
    // Users can insert, but only for themselves
    { operation: "insert", withCheck: "{user_id} = rebase.uid()" },
    // Locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false" }
]
```

## Permissive vs Restrictive

PostgreSQL has two policy modes:

- **Permissive** (default) — Multiple permissive policies are **OR'd** together. If any one passes, access is granted.
- **Restrictive** — Restrictive policies are **AND'd** together. All must pass.

```typescript
securityRules: [
    // Permissive: owners can access their rows
    { operation: "all", ownerField: "user_id" },
    // Restrictive: but locked rows cannot be updated
    { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" }
]
```

## Operations

| Operation | SQL Equivalent | Description |
|-----------|---------------|-------------|
| `"select"` | `SELECT` | Read rows |
| `"insert"` | `INSERT` | Create new rows |
| `"update"` | `UPDATE` | Modify existing rows |
| `"delete"` | `DELETE` | Remove rows |
| `"all"` | All of the above | Shorthand for all operations |

You can also use `operations` (plural) to apply one rule to multiple operations:

```typescript
{ operations: ["insert", "update", "delete"], ownerField: "authorId" }
```

## Full SecurityRule Interface

`SecurityRule` is a **union**, not one open object: a rule picks exactly one way
of expressing its predicate, and the others are typed `never` so mixing them is a
compile error rather than a policy that silently ignores half of what you wrote.

```typescript no-verify
// Shared by every variant
interface SecurityRuleBase {
    name?: string;                        // Policy name. Omit it and one is derived
    operation?: SecurityOperation;        // "select" | "insert" | "update" | "delete" | "all"
    operations?: SecurityOperation[];     // …or several at once
    mode?: "permissive" | "restrictive";  // Default: "permissive"
    roles?: string[];                     // App roles, via rebase.roles()
    pgRoles?: string[];                   // Native Postgres roles — the CREATE POLICY `TO` clause.
                                          // NOT the same as `roles`. Default: ["public"]
}

// …plus exactly one of:
{ ownerField: string }                        // <column> = rebase.uid()
{ access: "public" }                          // the one shortcut — "no row filter"
{ condition: PolicyExpression;                // the structured builder — `policy.*`
  check?: PolicyExpression }                  // defaults to `condition`, as Postgres does
{ using?: string; withCheck?: string }        // raw SQL
```

`roles` and `pgRoles` are the two that get confused. `roles` is an application
role, enforced *inside* the `USING` / `WITH CHECK` clause through
`rebase.roles()`. `pgRoles` is a database role, and controls which connections
the policy is attached to at all. Almost every project wants `roles`.

## Examples

### Blog Platform

```typescript
securityRules: [
    // Anyone can read published posts
    { operation: "select", using: "{status} = 'published'" },
    // Authors can see their own drafts
    { operation: "select", ownerField: "authorId" },
    // Authors can create and edit their own posts
    { operations: ["insert", "update"], ownerField: "authorId" },
    // Only admins can delete
    { operation: "delete", roles: ["admin"] }
]
```

### Multi-Tenant SaaS

```typescript
securityRules: [
    {
        operation: "all",
        using: "EXISTS (SELECT 1 FROM org_members WHERE org_members.org_id = {org_id} AND org_members.user_id = rebase.uid())"
    }
]
```

## Anonymous Access (Public Inserts)

A common need is allowing **unauthenticated users** to submit data — contact forms, newsletter signups, public applications. Rebase provides a clean pattern for this.

### Recommended: a raw `withCheck` rule

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const contactMessagesCollection: PostgresCollectionConfig = {
    slug: "contact_messages",
    name: "Contact Messages",
    table: "contact_messages",
    securityRules: [
        // Anyone can submit a contact message
        {
            operation: "insert",
            // A raw rule carries `using` (which rows are visible) and `withCheck`
            // (what a write must satisfy); an insert only exercises the latter.
            using: "true",
            withCheck: "true"
        },
        // Only admins can read, update, or delete messages
        { operations: ["select", "update", "delete"], roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
};
```

The `access: "public"` shortcut generates a policy that allows the operation without requiring authentication.

### For Lead Capture / Signups

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const leadSignupsCollection: PostgresCollectionConfig = {
    slug: "lead_magnet_signups",
    name: "Lead Magnet Signups",
    table: "lead_magnet_signups",
    securityRules: [
        // Allow anonymous inserts
        { operation: "insert", using: "true", withCheck: "true" },
        // Admins can view all signups
        { operation: "select", roles: ["admin"] }
    ],
    properties: {
        email: { name: "Email", type: "string" }
    }
};
```

### How Anonymous Requests Work

When a request arrives without a JWT token, the Rebase backend sets the PostgreSQL session variables to:

| Variable | Value |
|----------|-------|
| `app.user_id` | `'anonymous'` |
| `app.user_roles` | `''` (empty) |

This means:

- `rebase.uid()` returns `'anonymous'`
- `rebase.roles()` returns an empty string
- `access: "public"` policies pass because they generate `USING (true)` / `WITH CHECK (true)`
- `policy.authenticated()` conditions fail because they check for a real user ID
- `ownerField` policies fail because no row will have `user_id = 'anonymous'` (unless explicitly set)

### Advanced: Raw SQL for Anonymous

If you need more granular control, use raw SQL:

```typescript
securityRules: [
    {
        operation: "insert",
        withCheck: "rebase.uid() = 'anonymous' OR rebase.uid() IS NOT NULL"
    }
]
```

:::tip
Avoid the legacy pattern of checking `string_to_array(rebase.roles(), ',')` for anonymous access. The `access: "public"` shortcut is simpler and generates the correct policy automatically.
:::

## Next Steps

- **[Relations](/docs/collections/relations)** — Foreign keys and joins
- **[Entity Callbacks](/docs/collections/callbacks)** — Lifecycle hooks
- **[Custom Functions](/docs/backend/custom-functions)** — Custom API endpoints
