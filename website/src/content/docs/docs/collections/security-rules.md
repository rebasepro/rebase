---
title: Security Rules (RLS)
sidebar_label: Security Rules
description: Define Row Level Security policies for your collections using convenience shortcuts or raw SQL expressions.
---

## Overview

Security rules let you define **Row Level Security (RLS)** policies for your PostgreSQL tables directly in your collection definitions. When the Drizzle schema is generated, Rebase creates the corresponding `CREATE POLICY` statements.

```typescript
import { defineCollection } from "@rebasepro/admin-types";
const postsCollection = defineCollection({
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: { /* ... */ },
    securityRules: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], ownerField: "author_id" }
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

Allow any authenticated user:

```typescript
securityRules: [
    { operation: "select", access: "authenticated" }
]
```

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
{ operations: ["insert", "update", "delete"], ownerField: "author_id" }
```

## Full SecurityRule Interface

```typescript
interface SecurityRule {
    name?: string;              // Human-readable policy name
    operation?: SecurityOperation;   // Single operation
    operations?: SecurityOperation[]; // Multiple operations
    mode?: "permissive" | "restrictive"; // Default: "permissive"
    access?: "public" | "authenticated";
    ownerField?: string;        // Column containing the owner user ID
    roles?: string[];           // App roles that this policy applies to
    using?: string;             // Raw SQL USING expression
    withCheck?: string;         // Raw SQL WITH CHECK expression
}
```

## Examples

### Blog Platform

```typescript
securityRules: [
    // Anyone can read published posts
    { operation: "select", using: "{status} = 'published'" },
    // Authors can see their own drafts
    { operation: "select", ownerField: "author_id" },
    // Authors can create and edit their own posts
    { operations: ["insert", "update"], ownerField: "author_id" },
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
- `access: "authenticated"` policies fail because they check for a real user ID
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
