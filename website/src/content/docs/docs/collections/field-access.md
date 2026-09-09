---
title: Field access
sidebar_label: Field access
description: Per-property read and write permissions by role. A caller the row's security rules let through still does not receive a field their roles cannot read.
---

## Overview

[Security rules](/docs/collections/security-rules/) decide which **rows** a caller
reaches. `access` decides which **fields of a reached row** they see and may set.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const staff = defineCollection({
    slug: "staff",
    name: "Staff",
    table: "staff",
    properties: {
        id: { type: "number", isId: "increment" },
        name: { type: "string" },
        salary: {
            type: "number",
            // Read by HR (and admins). Set by nobody through the API.
            access: { read: ["hr"], write: [] }
        }
    },
    securityRules: [
        { operation: "select", access: "public" }
    ]
});
```

The rule above puts no row filter on `select`, so every caller the API lets in
reads every staff row. Only a caller holding `hr` gets the `salary` column of
one, and nobody sets it over HTTP.

## The rule

`access` has two optional lists, and an omitted list is not an empty one — the
difference is the whole feature.

| `read` / `write` | Means |
|------------------|-------|
| omitted | Delegate to the row. Everyone the collection's security rules let read (or write) the row gets the field. |
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

An in-process `rebase.data` call in a hook, a migration, or the auth adapter
verifying a password has no request and no roles behind it. Those are server
code, and a role list does not apply to them. `[]` still does: that is a
statement about the API surface rather than about who is calling.

## `excludeFromApi` is the same mechanism

`excludeFromApi: true` is sugar for `access: { read: [], write: [] }`. There is
one predicate behind both spellings, so everything on this page applies to the
flag too. Write whichever reads better — but not both on one property, which is
refused at boot.

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

### Queries

A `where`, `orderBy`, `fields`, aggregate `select` or `groupBy` naming a field you
cannot read is a **400 `FIELD_NOT_READABLE`**:

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
published OpenAPI document lists every property of every collection — it is
served off the app, not off the authenticated data router — so field names are
already public. Hiding the name here would protect nothing and would answer a
caller's genuine typo with "unknown field", sending them to look for a spelling
mistake that is not there. **Field names are public; field values are not.**

### Writes

A value for a field you cannot write is a **400**, never a silently dropped key —
a write that discards a field reports success for an edit that did not happen.

| Code | When |
|------|------|
| `FIELD_NOT_WRITABLE` | `write` is a role list you do not satisfy. Your colleague may get a 200 for the same body. |
| `VALIDATION_EXCLUDED_FIELDS` | `write` is `[]` (or `excludeFromApi`). Nobody may write it; the answer is the same for every caller. |

Both carry `details.violations` keyed by the wire name you sent. Enforced on
create, `PATCH`/`PUT`, `/bulk`, `_batch`, upserts, field operations
(`{ "salary": { "$inc": 1000 } }` names `salary` like any value does) and the
WebSocket `SAVE` frame.

## Search

The fallback search — a collection with no `search` block — matches `ILIKE` across
your string properties, and it skips the ones the caller cannot read. Nothing
leaks through it.

A collection that **does** declare a [`search` block](/docs/backend/api/) compiles
to a single generated `tsvector` column shared by every caller. There is no
per-role variant of it, so a restricted field named in `search.fields` would stay
*matchable* to callers who can never see its value — recoverable a term at a
time. Rebase refuses that combination at boot: remove the field from
`search.fields`, or drop the read restriction.

## History

[Entity history](/docs/backend/api/) stores the whole row, and it is served to
anyone who can read the row — the gate is "can you fetch this entity", not "are
you an admin". So the read rule is applied to each stored snapshot too: the entry
is still listed, with who changed it and when, and the withheld columns are gone
from its `values`.

Reverting is unaffected. The revert route reads the stored entry server-side, so a
caller can restore a version whose every field they cannot see — exactly as they
can already overwrite a row without reading all of it.

## What the admin panel shows

Nothing to configure. The Studio reads through the same API, so a field the
caller cannot read never arrives and the form does not draw it; a field they
cannot write is refused if something tries to send it. This is a server-side
guarantee, unlike `admin.hideFromCollection`, which only stops the panel from
*rendering* a field and leaves the value in the JSON.

## Generated types and OpenAPI

The SDK's `Row`, `Insert` and `Update` types are one shape for every caller —
there is no `Row` that is right for both a reader who holds `hr` and one who does
not — so a **role** rule does not change them. A field closed to everybody
(`[]`, or `excludeFromApi`) is absent from them, as it always was.

The OpenAPI document states the rule rather than pretending to be per-caller.
Each restricted property carries `x-rebase-access`:

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

`rebase.data` and `rebase.dataAsAdmin` in a hook, a function or a cron job do not
pass through the write check. That is the same exemption `excludeFromApi` has
always had, and it is what makes the rule enforceable at all: something has to be
able to store the password hash.

Reads through `rebase.dataAsAdmin` hold the `admin` role, so a role rule does not
hide anything from them. `[]` still does — including from `dataAsAdmin`. Use
[`rebase.sql()`](/docs/backend/api/) if you need the raw column.

## Validation

These are refused at boot, before the server serves anything:

- `access` and `excludeFromApi` on the same property — they are one mechanism, and
  the flag wins, so the block beside it would be dead;
- a bare string where a list belongs (`read: "admin"`), which reads as a non-empty
  rule no caller satisfies and would hide the field from everybody;
- a role that is not a non-empty string;
- a restricted field named in the collection's `search.fields`.

Role *names* are not checked against a set: roles are application data, created
and deleted while the server runs. A typo in one is a field nobody can read, which
is the safe direction to fail.

## See also

- [Security Rules (RLS)](/docs/collections/security-rules/) — which rows a caller reaches
- [Properties](/docs/collections/properties/) — the full option table
- [Error codes](/docs/backend/errors/) — `FIELD_NOT_READABLE`, `FIELD_NOT_WRITABLE`
