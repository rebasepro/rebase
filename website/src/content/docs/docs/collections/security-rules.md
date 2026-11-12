---
title: Row-level security
sidebar_label: Row-level security
description: "Every table declares its rls posture — admin-only, inherit or a list of rules — and Rebase compiles it to Postgres row-level security policies. Rule forms, shorthand conditions, defaultRls and what fails closed."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every table says who reaches its rows, in its `rls` key. Rebase compiles that
into Postgres row-level security: `ENABLE ROW LEVEL SECURITY` on the table and
one `CREATE POLICY` per rule and operation. Postgres then filters every
statement, on every route — REST, realtime, MCP, the CMS and SQL run as the
caller — because the rules are in the database, not in application code.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        status:   col.enum(["draft", "published"]).notNull().default("draft"),
        authorId: col.uuid().notNull().onCreateUser(),
    },
    rls: [
        // Anyone reads the published posts.
        { operation: "select", access: "public", condition: { status: "published" } },
        // Authors read and edit their own, drafts included.
        { operations: ["select", "insert", "update"], ownerField: "authorId" },
        // Editors may delete.
        { operation: "delete", roles: ["editor"] },
    ],
});
```

`rls` has no default. Leaving it out is a type error, and a table that reaches
the compiler without a usable posture is refused. See
[What fails closed](#what-fails-closed).

:::note[Coming from collections?]
`rls` replaces `securityRules`, and it is required. A rule written for
`securityRules` is a valid entry of `rls` as it is. The upgrade guide for this
release covers `defaultSecurityRules` and `disableDefaultPolicies`.
:::

## The three postures

<span class="since-badge" data-since="0.31">Since 0.31</span>

| `rls` | Means |
|---|---|
| `"admin-only"` | Row-level security on, and only the admin baseline policies: the `admin` role and the server's own code reach rows. Every other caller gets no rows, and their writes are refused. |
| `"inherit"` | The `defaultRls` exported from `backend/schema/index.ts`. Refused when there is none. |
| a list of rules | The policies to generate, one or more. `[]` is refused: write `"admin-only"` to lock a table to admins. |

`"admin-only"` is the posture to start a table with when you have not decided
who should see it yet. Nothing is exposed until you write the rules that expose
it.

### `defaultRls`

<span class="since-badge" data-since="0.31">Since 0.31</span>

`backend/schema/index.ts` may export one posture for the tables that say
`rls: "inherit"`:

```ts
// backend/schema/index.ts
import type { DefaultRls } from "@rebasepro/server/schema";

export { posts } from "./posts";
export { comments } from "./comments";

export const defaultRls: DefaultRls = [
    { operation: "select", access: "authenticated" },
    { operations: ["insert", "update", "delete"], roles: ["editor"] },
];
```

`defaultRls` is `"admin-only"` or a non-empty list of rules. It applies only to
tables that write `"inherit"`; a table with rules of its own takes none of
these, and the two lists are never merged. `rls: "inherit"` with no `defaultRls`
exported stops `rebase db generate`, `rebase db push` and boot with an error
that says to export one.

## Policies a table gets without writing them

<span class="since-badge" data-since="0.31">Since 0.31</span>

The policies on a table are more than its own rules:

- **The admin baseline.** Every table gets `<table>_default_admin_read` and
  `<table>_default_admin_write` policies for insert, update and delete. They are
  permissive and admit the server context and the `admin` role, so admins read
  and write every row. Permissive policies are ORed, so the baseline widens
  whatever your rules allow; it never narrows them.
- **The users table.** A table declared with
  [`defineAuthTable`](/docs/schema/auth-table/) also gets a policy letting a
  signed-in user read their own row, and a restrictive gate that lets only an
  admin write the privilege columns (`roles`), whatever its rules say.
- **Tenancy.** A table with [`tenant`](/docs/collections/tenancy/) gets a
  restrictive policy that confines every operation to the caller's tenant.
- **Junction tables.** The junction of a [`manyToMany`](/docs/collections/relations/#manytomany--through-a-junction)
  relation gets policies of its own.

`defaultPolicies: false` on a table removes the permissive admin baseline and
keeps the restrictive gates, so the table has exactly the rules you wrote. It
is refused together with `"admin-only"`, which is the baseline and nothing else:
the pair would leave a table no caller can reach, admins included.

The generated DDL marks every injected policy, and `rebase db push` restores one
dropped by hand.

## Rule forms

<span class="since-badge" data-since="0.31">Since 0.31</span>

A rule is one of these forms. Mixing two in one rule (an `ownerField` with raw
`using`, say) is a type error, never a policy that silently ignores half of
what was written.

| Form | Example | `USING` (which rows) | `WITH CHECK` (what may be written) |
|---|---|---|---|
| Owner | `{ ownerField: "authorId" }` | the column equals the caller's id | the same |
| Public | `{ access: "public" }` | every row | every row |
| Signed in | `{ access: "authenticated" }` | every row, for a signed-in caller | the same |
| Access with a condition | `{ access: "public", condition: { status: "published" } }` | the condition (and signed in, for `"authenticated"`) | `check`, else the condition, gated the same way |
| Access with a check | `{ access: "authenticated", check: { state: "open" } }` | the access test alone | the check, gated by the access test |
| Structured | `{ condition: policy.rolesOverlap(["moderator"]) }` | the condition | `check`, else the condition |
| Raw SQL | `{ using: "{published_at} > now() - interval '30 days'" }` | the SQL | `withCheck`, else `using` |
| Raw check only | `{ operation: "insert", withCheck: "{owner_id} = rebase.uid()" }` | no rows | the SQL |
| Roles only | `{ operation: "delete", roles: ["admin"] }` | every row, for the roles | the same |

Every form also takes the shared keys:

| Key | Default | What it does |
|---|---|---|
| `operation` | `"all"` | `"select"`, `"insert"`, `"update"`, `"delete"` or `"all"`. |
| `operations` | | Several operations at once; one policy is generated per operation. Takes precedence over `operation`. |
| `roles` | | Application roles; the rule applies only to a caller holding one of them. ANDed with the rest of the rule. |
| `mode` | `"permissive"` | `"restrictive"` makes the rule a gate that must also pass. See [Permissive and restrictive](#permissive-and-restrictive). |
| `name` | derived | The policy name. Without it, the name is derived from the table, the operation and a hash of the rule, so editing a rule renames its policy. |
| `pgRoles` | `["public"]` | Native Postgres roles: the `TO` clause of `CREATE POLICY`. Not the same as `roles`. |

`roles` are Rebase application roles, stored in the users table's `roles`
column and read inside a policy through `rebase.roles()`. They are not Postgres
roles: names like `anon` or `authenticated` belong to `pgRoles`, and in `roles`
they produce a condition no user meets. Almost every project wants `roles`.

### Owner

<span class="since-badge" data-since="0.31">Since 0.31</span>

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const notes = defineTable("notes", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        ownerId: col.uuid().notNull().onCreateUser(),
        body:    col.text(),
    },
    rls: [{ operation: "all", ownerField: "ownerId" }],
});
```

This generates `USING ((owner_id)::text = (SELECT rebase.uid()))`.
`ownerField` names a column key, a SQL column, or a `belongsTo` relation (its
foreign-key column). It compares the column with the caller's id; it does not
fill it. `.onCreateUser()` makes the server write the caller's id on create,
whatever the request sent, which is what makes the comparison mean something.

### Public access

<span class="since-badge" data-since="0.31">Since 0.31</span>

`{ operation: "select", access: "public" }` generates `USING (true)`: no row
filter on reads, so every caller the API lets in reads every row.

It widens which rows a caller sees, not who may call. By default the API still
answers 401 to a request with no token. Set `AUTH_REQUIRE=false`
(`auth.requireAuth: false`) to remove that gate and let the policies alone
decide; then an unauthenticated caller reads these rows too.

`{ access: "authenticated" }` is the same with a signed-in test: the caller has
a session. A guest created by anonymous sign-in has one; see
[`authenticated()` and `registered()`](#authenticated-and-registered).

### Conditions

<span class="since-badge" data-since="0.31">Since 0.31</span>

A `condition` says which existing rows a rule covers; a `check` says which new
or updated values it allows, and defaults to the condition. Both take the
shorthand object form or a structured expression.

The **shorthand** is a plain object of column keys and literal values. It holds
when each column equals its value, and a `null` value means `IS NULL`:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const reports = defineTable("reports", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        state:     col.enum(["open", "closed"]).notNull().default("open"),
        public:    col.boolean().notNull().default(false),
        deletedAt: col.timestamptz(),
    },
    rls: [
        // Anyone reads public reports that are not deleted.
        { operation: "select", access: "public", condition: { public: true, deletedAt: null } },
        // Signed-in callers may file a report, but only as an open one.
        { operation: "insert", access: "authenticated", check: { state: "open" } },
    ],
});
```

The shorthand needs at least one key, and no key may be named `kind` (that is
how a structured expression is recognized; compare a column called `kind` with
the longhand form). Its keys are checked against the table when the schema is
compiled: a key that names no column is refused, with the table and the key in
the error.

A **structured** condition is built with `policy`, imported from
`@rebasepro/types`. It compiles to SQL for the database and is evaluated in
JavaScript by the CMS, so the CMS never offers an action the database will
refuse:

```ts
import { defineTable, col } from "@rebasepro/server/schema";
import { policy } from "@rebasepro/types";

export const documents = defineTable("documents", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        teamId: col.uuid().notNull(),
        userId: col.uuid().notNull(),
    },
    rls: [
        // The owner, or anyone holding `moderator`.
        {
            operation: "update",
            condition: policy.or(
                policy.compare(policy.field("userId"), "eq", policy.authUid()),
                policy.rolesOverlap(["moderator"])
            ),
        },
        // Members of the document's team read it.
        {
            operation: "select",
            condition: policy.existsIn({
                collection: "team_members",
                where: policy.and(
                    policy.compare(policy.field("team_id"), "eq", policy.outerField("teamId")),
                    policy.compare(policy.field("user_id"), "eq", policy.authUid())
                ),
            }),
        },
    ],
});
```

Inside `existsIn`, `policy.field()` names a column of the other table and
`policy.outerField()` a column of the row being checked. It compiles to one
correlated `EXISTS` subquery.

| Expression | Compiles to |
|---|---|
| `policy.true()` / `policy.false()` | `true` / `false` |
| `policy.and(…)` / `policy.or(…)` / `policy.not(e)` | conjunction, disjunction, negation |
| `policy.compare(left, op, right)` | a comparison; `op` is `"eq"`, `"neq"`, `"lt"`, `"lte"`, `"gt"` or `"gte"` |
| `policy.rolesOverlap(roles)` | the caller holds **any** of these roles |
| `policy.rolesContain(roles)` | the caller holds **all** of these roles |
| `policy.authenticated()` | a signed-in caller |
| `policy.registered()` | a signed-in caller with an account, not a guest |
| `policy.serverContext()` | `rebase.uid() IS NULL`; see the caution below |
| `policy.existsIn({ collection, where })` | a correlated `EXISTS` over another table |
| `policy.raw(sql)` | the SQL, inserted as written |

| Operand | Means |
|---|---|
| `policy.field(name)` | a column of the row being checked, or inside `existsIn` of the other table |
| `policy.outerField(name)` | inside `existsIn`, a column of the row being checked |
| `policy.literal(value)` | a string, number, boolean or `null` |
| `policy.authUid()` | `rebase.uid()` |
| `policy.authRoles()` | the caller's roles as an array |
| `policy.authClaim(name)` | a custom claim on the session token, cast to the type of the column it is compared with |

`existsIn`, `raw` and `authClaim` are evaluated by the database only; the CMS
treats them as unknown and reflects what the server reports.

### Raw SQL

<span class="since-badge" data-since="0.31">Since 0.31</span>

`using` and `withCheck` take SQL. `{column}` resolves to the table's column, and
the caller is available as `rebase.uid()`, `rebase.roles()` (comma-separated
roles) and `rebase.jwt()` (the token's claims as `jsonb`):

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        orgId:    col.uuid().notNull(),
        isLocked: col.boolean().notNull().default(false),
    },
    rls: [
        {
            operation: "select",
            using: "EXISTS (SELECT 1 FROM org_members m WHERE m.org_id = {org_id} AND m.user_id = rebase.uid())",
        },
        { operation: "update", mode: "restrictive", using: "{is_locked} = false", withCheck: "{is_locked} = false" },
    ],
});
```

Raw SQL is enforced by Postgres alone: the CMS cannot evaluate it. Prefer a
shorthand or a structured condition wherever one can say the same thing.

## Evaluated once per statement

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every part of a rule that does not read the row — the caller's id, a roles
check, a claim, `serverContext()` — compiles inside a scalar subquery. An owner
rule becomes `(user_id)::text = (SELECT rebase.uid())`. Postgres computes such a
subquery once per statement rather than once per row, and plans as though the
check passes half the table rather than 1.5% of it, which keeps deep pages of a
large table on their index. Who may read or write what is unchanged.

Raw SQL gets the same treatment when Rebase can read its structure
(`owner_id = rebase.uid()` does). Anything else is inserted as written, so wrap
the calls yourself: `(SELECT rebase.uid())`.

## `authenticated()` and `registered()`

<span class="since-badge" data-since="0.31">Since 0.31</span>

A request with no session at all is given a sentinel id, so `rebase.uid()` is
never `NULL` on a request, and `policy.authenticated()` (like
`access: "authenticated"`) excludes it.

A **guest** is different: `POST /auth/anonymous` creates a real user row with a
real session, so a guest passes every test that looks at the id.
`policy.registered()` is `authenticated()` plus "not a guest". Use it wherever a
rule is about a person who could be held responsible — writing a review, joining
an organization, spending money — and `authenticated()` where a guest is welcome:
a cart before checkout, a draft before signup.

:::caution[`serverContext()` is not satisfied by `dataAsAdmin`]
It compiles to `rebase.uid() IS NULL`, true only for the built-in flows that run
with no user (sign-up, migrations). `rebase.dataAsAdmin` runs as
`uid: "service"` with the `admin` role, so it is **false** there. A table with
`defaultPolicies: false` whose only rule is `serverContext()` refuses those
writes and returns no rows to those reads. `rebase.sql()` is the accessor that
bypasses policies.
:::

## Permissive and restrictive

<span class="since-badge" data-since="0.31">Since 0.31</span>

Permissive rules (the default) are ORed: a row is reached when any one of them
admits it. Restrictive rules are ANDed with them: every restrictive rule must
also pass. A permissive rule widens access; a restrictive one can only narrow
it. Tenancy is a restrictive rule for that reason: an `access: "public"` rule
elsewhere on the table cannot take the tenant boundary off.

## What fails closed

<span class="since-badge" data-since="0.31">Since 0.31</span>

A table cannot become reachable by accident:

- **In the editor**, `rls` is required and `[]` is not a valid value.
- **When the module loads**, `defineTable` throws when `rls` is missing, empty
  or not one of the three postures, so JavaScript and casts are caught too.
- **When the schema is compiled** — `rebase db generate`, `rebase db push`,
  `rebase doctor` and server boot — the schema is refused for `"inherit"`
  without a `defaultRls`, `"admin-only"` with `defaultPolicies: false`, and a
  rule that names a column the table does not have (in `ownerField`, a
  shorthand key or a `policy.field()`). A typo in a rule would otherwise reach
  `CREATE POLICY` and fail there, on a table whose row-level security is
  already on, leaving it closed to everyone.
- **Without a schema**, when the backend reads the tables from the database, a
  table without `ENABLE ROW LEVEL SECURITY` is not served. Boot names it, with
  the `ALTER TABLE … ENABLE ROW LEVEL SECURITY` that protects it. See
  [Backend only](/docs/getting-started/headless/).

Each request runs its statements under a database role that row-level
security applies to, inside a transaction that carries the caller's id, roles
and claims. That is what `rebase.uid()`, `rebase.roles()` and `rebase.jwt()`
read.

## Requests without a session

<span class="since-badge" data-since="0.31">Since 0.31</span>

A request with no token reaches the policies only when `AUTH_REQUIRE=false`;
otherwise the API answers 401 first. It then runs with `rebase.uid()` set to
`'anonymous'` and no roles: `access: "public"` rules admit it,
`access: "authenticated"` and owner rules do not.

A contact form takes inserts from anyone and is read by admins only:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const contactMessages = defineTable("contact_messages", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        email:   col.text().notNull().validate({ email: true }),
        message: col.text().notNull().validate({ max: 5000 }),
    },
    rls: [
        { operation: "insert", access: "public" },
        { operations: ["select", "update", "delete"], roles: ["admin"] },
    ],
});
```

## Rows here, columns next door

<span class="since-badge" data-since="0.31">Since 0.31</span>

`rls` decides which rows a caller reaches. It has nothing to say about the
columns of a row they do reach: a rule that lets an employee read their team's
rows lets them read every column of those rows, salary included. Per-column
rules are [`.access()`](/docs/collections/field-access/) on the column:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().identity(),
        name:   col.text().notNull(),
        // Everyone the rules let read the row; only HR receives this column.
        salary: col.numeric(10, 2).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "authenticated" }],
});
```

The roles are the same roles: `policy.rolesOverlap(["hr"])` in a rule and
`.access({ read: ["hr"] })` on a column mean the same `hr`. Column rules are
applied by the server, so they cover every API route; a query run through
`rebase.sql()` sees every column, as it bypasses row-level security.

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Field access](/docs/collections/field-access/): per-column read and write roles
- [Tenancy](/docs/collections/tenancy/): one restrictive boundary per tenant
- [Roles and scopes](/docs/backend/roles-and-scopes/): where roles come from
- [The users table](/docs/schema/auth-table/): the policies `defineAuthTable` adds
