---
title: Field access
sidebar_label: Field access
description: "Per-column read and write permissions by role with .access(), columns that never leave the server with .private(), and columns clients cannot write with .readOnly(). A caller the row's policies let through still does not receive a column their roles cannot read."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

[Row-level security](/docs/collections/security-rules/) decides which **rows** a
caller reaches. Three column modifiers decide which **columns of a reached row**
they see and may set:

| Modifier | Read | Write |
|---|---|---|
| `.access({ read, write })` | the roles in `read`, when given | the roles in `write`, when given |
| `.private()` | nobody, through the API | nobody, through the API |
| `.readOnly()` | as the row | nobody, through the API |

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const staff = defineTable("staff", {
    columns: {
        id:     col.integer().primaryKey().identity(),
        name:   col.text().notNull(),
        // Read by HR (and admins). Set by nobody through the API.
        salary: col.numeric(10, 2).access({ read: ["hr"], write: [] }),
    },
    rls: [{ operation: "select", access: "public" }],
});
```

The rule above puts no row filter on `select`, so every caller the API lets in
reads every staff row. Only a caller holding `hr` gets the `salary` column of
one, and nobody sets it over HTTP.

## The rule

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.access()` takes two optional lists, and an omitted list is not an empty one —
the difference is the whole feature.

| `read` / `write` | Means |
|------------------|-------|
| omitted | Delegate to the row. Everyone the table's `rls` lets read (or write) the row gets the column. |
| `[]` | Nobody, through the API, at any privilege — not `admin`, not the service key, not an in-process read. |
| `["hr"]` | A caller holding `hr`, **or** `admin`, **or** trusted server code with no request behind it. |

Roles are Rebase application roles — the same ones `rebase.roles()` returns
inside a policy and `policy.rolesOverlap` compiles against. They come from the
call context: `user.roles` on the authenticated request.

### Why `admin` always passes

Every baseline policy Rebase injects carries a `rolesOverlap(['admin'])` arm, and
`rebase.dataAsAdmin` runs as `{ uid: "service", roles: ["admin"] }`. A field rule
that could lock an administrator out of a column of their own database would
also lock the Studio out of rendering it and the CLI out of exporting it. If you
need a column no administrator reads through the API, that is `read: []`.

### Why the trusted plane passes

Server code with no request behind it — a migration, or the auth adapter
verifying a password — reads with no roles at all, and a role list does not
apply to it. `[]` still does: that is a statement about the API surface rather
than about who is calling.

A hook's `context.data` is not that plane. Inside a request it reads with the
caller's roles, so the field rules apply to what it reads exactly as they apply
to the request.

## `.private()` and `.readOnly()` are the same mechanism

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.private()` is `.access({ read: [], write: [] })`, with one difference: a
private column is also left out of OpenAPI, the SDK types and the MCP tool
schemas, so its name is not public either (see [Queries](#queries)). A column
cannot be both `.private()` and declare `.access()`; the schema is refused.

`.readOnly()` is `write: []`: nobody writes the column through the API, whatever
their role, while defaults, triggers and server code still fill it. Reads are
left to the row, or to `.access({ read })` when both are written.

## What a caller sees

### Reads

A field you cannot read is **absent** from the response. Not `null`, not an empty
string — the key is not there.

```json
// GET /api/data/staff/1  as a caller holding `staff`
{ "id": 1, "name": "Ada" }

// the same row as a caller holding `hr`
{ "id": 1, "name": "Ada", "salary": 90000 }
```

That is deliberate. A withheld value served as `null` is indistinguishable from a
stored `null`, so a client could map the whole column by counting them — and an
`update` that echoed the row back would overwrite the real value with the null it
was handed.

It applies at every exit: list, single get, relation targets included with
`?include=`, `_batch` results, realtime frames from `.listen()`, aggregate
results and [history](#history) snapshots.

A relation's value is its related rows, so a relation you cannot read is
withheld whole. `?include=` leaves it out of the row, with its `_count`, from
every door: REST, the SDK, `.listen()`, and nested includes one level down.
Naming it anywhere else is refused like a field (see [Queries](#queries)).

### Queries

A `where`, `orderBy`, `fields`, aggregate `select` or `groupBy` naming a field you
cannot read is a **400 `FIELD_NOT_READABLE`**. So is a filter through a relation
on a field of its target you cannot read (`?author.salary=gt.1`), an aggregate
sort over one (`orderBy=max(staff.salary)`), and a relation you cannot read
named in a nested path (`/departments/1/members`, `/departments/1/members/7`) or
an aggregate sort (`orderBy=count(members)`):

```http
GET /api/data/staff?salary=gt.100000
```

```json
{
  "error": {
    "code": "FIELD_NOT_READABLE",
    "message": "'salary' is not readable on 'staff' with your roles, so it cannot be used in a filter.",
    "details": {
      "collection": "staff",
      "fields": ["salary"],
      "violations": [
        { "field": "salary", "code": "access", "message": "'salary' is not readable with your roles." }
      ]
    }
  }
}
```

Without this the value is readable one predicate at a time: twenty requests is a
binary search over a salary.

The error **names the field**. That is a decision, not an oversight: the
published OpenAPI document lists every column of every table — it is
served off the app, not off the authenticated data router — so field names are
already public. Hiding the name here would protect nothing and would answer a
caller's genuine typo with "unknown field", sending them to look for a spelling
mistake that is not there. **Field names are public; field values are not.**

Except a `.private()` column's. OpenAPI, `list_collections` and the generated
SDK leave it out, so its name is not public, and "not readable" would confirm it
exists. A filter, `orderBy`, `fields`, `include`, aggregate `select` or
`groupBy`, or `vector_search` naming one gets exactly the answer a misspelt name
gets — `UNKNOWN_FILTER_FIELD`, `UNKNOWN_ORDER_BY_FIELD`, `UNKNOWN_FIELD`,
`UNKNOWN_RELATION`, `UNKNOWN_AGGREGATE_FIELD` or `UNKNOWN_VECTOR_PROPERTY`, the
same message and details — and no unknown-field answer lists it among the valid
fields.

### Writes

A value for a field you cannot write is a **400**, never a silently dropped key —
a write that discards a field reports success for an edit that did not happen.

| Code | When |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` is a role list you do not satisfy. Your colleague may get a 200 for the same body. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` is `[]`, or the column is `.private()` or `.readOnly()`. Nobody may write it; the answer is the same for every caller. |

Both carry `details.violations` keyed by the wire name you sent. Enforced on
create, `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, field operations
(`{ "salary": { "$inc": 1000 } }` names `salary` like any value does) and the
WebSocket `SAVE` frame.

A field operation also needs `read` on its field. An operation on a field you may
write but not read is refused with `FIELD_NOT_READABLE`: whether it passed a
bound would tell you the value you are not allowed to see.

## Search

<span class="since-badge" data-since="0.31">Since 0.31</span>

The fallback search — a table with no `search` block — matches `ILIKE` across
your text columns, and it skips the ones the caller cannot read. Nothing leaks
through it.

A table that **does** declare a [`search` block](/docs/backend/search) compiles
to a single generated `tsvector` column shared by every caller. There is no
per-role variant of it, so a restricted column named in `search.fields` would
stay *matchable* to callers who can never see its value — recoverable a term at
a time. The schema is refused with that combination: remove the column from
`search.fields`, or drop the read restriction. A `tenant` column cannot be read
restricted either.

## History

[Entity history](/docs/backend/history) stores the whole row, and it is served to
anyone who can read the row — the gate is "can you fetch this entity", not "are
you an admin". So the read rule is applied to each stored snapshot too: the entry
is still listed, with who changed it and when, and the withheld columns are gone
from its `values`.

Reverting is unaffected. The revert route reads the stored entry server-side, so a
caller can restore a version whose every field they cannot see — exactly as they
can already overwrite a row without reading all of it.

## What the CMS shows

Nothing to configure. The CMS reads through the same API, so a column the
caller cannot read never arrives and the form does not draw it; a column they
cannot write is refused if something tries to send it. This is a server-side
guarantee, unlike hiding a field in the CMS, which only stops it being
*rendered* and leaves the value in the JSON.

## Generated types and OpenAPI

The SDK's `Row`, `Insert` and `Update` types are one shape for every caller —
there is no `Row` that is right for both a reader who holds `hr` and one who does
not — so a **role** rule does not change them. A `.private()` column is absent
from all three, and a `.readOnly()` one from `Insert` and `Update`. The
[inferred types](/docs/schema/types/) follow the same rule.

The OpenAPI document states the rule rather than pretending to be per-caller.
Each restricted column carries `x-rebase-access`:

```json
"salary": {
  "type": "number",
  "description": "Salary — Field access: readable by `hr` (and `admin`); writable by nobody through the API. A caller without the role does not receive the field at all — it is absent, not null.",
  "x-rebase-access": { "read": ["hr"], "write": [] }
}
```

A field nobody can read is absent from the read schema and from the filter
parameters; a field nobody can write is absent from the input schema. The two
directions are separate schemas and are judged separately, so a token an admin
posts and never reads back appears in the request body and not in the row.

## In-process writes

In-process writes — `context.data` in a hook, `rebase.dataAsAdmin` in a hook,
a function or a cron job — do not pass through the write check. That is what
makes the rule enforceable at all: something has to be able to store the
password hash.

Reads through `rebase.dataAsAdmin` hold the `admin` role, so a role rule does not
hide anything from them. `[]` still does — including from `dataAsAdmin`. Use
[`rebase.sql()`](/docs/backend/custom-functions) if you need the raw column.

## Validation

<span class="since-badge" data-since="0.31">Since 0.31</span>

These are refused when the schema is compiled, before the server serves
anything:

- `.private()` and `.access()` on the same column: they are one mechanism;
- a role that is not a non-empty string;
- a read-restricted column named in the table's `search.fields`, or used as its
  `tenant` field;
- a `.private()` primary key: the key is how every row is addressed.

Role *names* are not checked against a set: roles are application data, created
and deleted while the server runs. A typo in one is a field nobody can read, which
is the safe direction to fail.

## See also

- [Row-level security](/docs/collections/security-rules/) — which rows a caller reaches
- [Columns](/docs/schema/columns/) — every column modifier
- [Error codes](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
