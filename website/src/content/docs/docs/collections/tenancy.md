---
title: Tenancy
sidebar_label: Tenancy
description: Scope every row of a table to a site, organization or workspace with one tenant declaration, enforced by Postgres row-level security.
---

## What it does

<span class="since-badge" data-since="0.31">Since 0.31</span>

`tenant` on a table names the column that holds the tenant a row
belongs to (a site, an organization, a workspace) and says where the caller's
tenant comes from. From that one declaration Rebase generates:

- **A restrictive RLS policy**, `<table>_tenant_scope`. Restrictive policies
  are ANDed with every other policy on the table, so tenancy narrows what the
  table's `rls` allows and never widens it. An
  `access: "public"` rule elsewhere in the file cannot take the boundary off.
- **A `NOT NULL`, indexed column.** A row with no tenant would belong to nobody,
  and an unindexed tenant column would turn every read into a sequential scan.
- **The tenant on writes.** A create that leaves the field empty gets the
  caller's tenant when they have exactly one. Anything ambiguous or foreign is
  refused (see [Writes](#writes)).
- **A trigger that keeps rows in their tenant.** An update that moves a row to
  another tenant is refused, in the API and in SQL run as the caller.

Because Postgres enforces it, the admin panel, the REST API, the SDK and SQL
run as the caller all see the same rows.

## One tenant per user: a claim

<span class="since-badge" data-since="0.31">Since 0.31</span>

When each user belongs to exactly one tenant, put it on their session token
and name the claim:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        siteId: col.uuid().notNull(),
        title:  col.text().notNull(),
    },
    tenant: { field: "siteId", from: { claim: "site_id" } },
    rls: [{ operation: "all", access: "authenticated" }],
});
```

The policy compares the row's `site_id` with the `site_id` claim, cast to the
column's type. The
claim comes from your identity provider, or from the `customizeAccessToken`
auth hook (`auth.hooks`, see [Authentication](/docs/backend/authentication/);
the managed runtime has no route for hooks, so this needs an ejected backend).
Reserved claims such as `uid`, `roles` and `aal` cannot name a tenant: they
are written after custom claims so a hook cannot assert them, and a config
that names one is refused.

## Several tenants per user: a membership table

<span class="since-badge" data-since="0.31">Since 0.31</span>

When people work across tenants (an editor on two sites, a consultant in three
organizations), keep the memberships in a table of their own:

```ts
// backend/schema/site-members.ts
import { defineTable, col } from "@rebasepro/server/schema";

// One row per person per site they work on.
export const siteMembers = defineTable("site_members", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        userId: col.uuid().notNull(),
        siteId: col.uuid().notNull(),
    },
    // Members read their own rows. Required: the tenancy policy reads this
    // table as the caller, so without it nobody but an admin sees a post.
    rls: [{ operation: "select", ownerField: "userId" }],
});
```

```ts
// backend/schema/posts.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const posts = defineTable("posts", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        siteId: col.uuid().notNull(),
        title:  col.text().notNull(),
    },
    tenant: {
        field: "siteId",
        from: { membership: { collection: "site_members", userField: "userId", tenantField: "siteId" } },
    },
    rls: [{ operation: "all", access: "authenticated" }],
});
```

`membership.collection` is the slug of the membership table; `userField` and
`tenantField` are column keys on it.

The policy is a correlated `EXISTS` over `site_members`: "is the caller a
member of this row's site?", answered in the same query. Nothing goes on the
token, so adding or removing a membership takes effect on the next statement,
with no need to sign in again.

The membership table must let callers read their own rows, because a
policy is evaluated as the querying user and the membership table's own RLS
applies inside it. Boot refuses a config where it does not, and the error names
the rule to add. Boot also refuses a membership table that does not exist, lacks either named
column, or is not stored in the same Postgres database.

## Who it does not apply to

`bypassRoles` lists the roles that read and write across every tenant. It
defaults to `["admin"]`, so the admin panel does not show an admin an empty
table. An empty array means no role bypasses it; the server's own trusted
context (migrations, the auth flows) still does.

```typescript
tenant: { field: "siteId", from: { claim: "site_id" }, bypassRoles: ["admin", "support"] }
```

## Writes

Every refusal is a `400` that names the field, before the database is asked:

| Code | When |
|---|---|
| `TENANT_REQUIRED` | A create left the field empty and the caller has no tenant, or belongs to several. Send the tenant on the write |
| `TENANT_MISMATCH` | The write names a tenant the caller does not belong to |
| `TENANT_IMMUTABLE` | An update would move the row to another tenant. Create it in the other tenant and delete this one, or do it as a `bypassRoles` role |

SQL run as the caller gets the same answers from Postgres: the policy's
`WITH CHECK` refuses a foreign tenant, and a `BEFORE UPDATE` trigger refuses a
move (`42501`). A caller in a bypass role is exempt from all three.

## The field

<span class="since-badge" data-since="0.31">Since 0.31</span>

- A text, `uuid`, enum or integer column (`numeric` too), or a `belongsTo`
  relation to the table of tenants. For a relation, its foreign-key column is
  the field; no second one is created.
- It must be declared on the table, and readable: the schema is refused when the
  field is missing, of another type, or restricted by `.private()` or
  `.access({ read })`. The types check that the field names a column.
- The column is made `NOT NULL` whatever it was declared, and indexed.
- Not on a view: row-level security is what enforces it.

## What it does not cover

- **Files.** Uploads are not rows. Scope them by path with
  [storage authorization](/docs/backend/storage-authorization/), for example a
  folder per site.
- **Navigation.** Tables are shown or hidden in the CMS per role, not per
  tenant. A member of one site sees the same tables as everyone else, holding
  only their site's rows.
- **Separate infrastructure.** Every tenant shares one database and one server.
  Where tenants must not share infrastructure at all, give each its own
  deployment.

## Related

- [Row-level security](/docs/collections/security-rules/): the rules tenancy is ANDed with
- [Field access](/docs/collections/field-access/): per-field read and write permissions
- [Storage authorization](/docs/backend/storage-authorization/): who reads and writes which files
