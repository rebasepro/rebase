---
title: SQL functions as RPC
sidebar_label: SQL functions (RPC)
description: "Expose a Postgres function at POST /api/rpc/<name> with defineRpc: declared per function, arguments validated, run as the caller under row-level security, public ones rate-limited."
---

<span class="since-badge" data-since="0.35">Since 0.35</span>

A SQL function you declare with `defineRpc` is served at `POST /api/rpc/<name>`,
with its named arguments as the JSON body. It runs as the caller, the way
`getSql(c)` does: an anonymous caller as the anonymous identity, a signed-in one
as themselves, so the tables' row-level security applies inside the function,
and a `SECURITY DEFINER` function runs as its owner. This is what
`supabase.rpc('fn', args)` does, without writing a handler per function.

Only declared functions are callable. A function the database has and nobody
declared answers `404 RPC_NOT_FOUND`.

## Declaring one

<span class="since-badge" data-since="0.35">Since 0.35</span>

Declarations live beside the tables, in `backend/schema/`, and the schema index
exports them:

```typescript
// backend/schema/rpc.ts
import { defineRpc, json } from "@rebasepro/server/schema";

export const getPublicProposal = defineRpc("get_public_proposal", {
    access: "public",
    args: { token: json.string().required() }
});

export const myTrips = defineRpc("my_trips", {
    access: "authenticated",
    args: { from: json.date(), limit: json.number().validate({ integer: true, max: 100 }) }
});

export const bookTrip = defineRpc("book_trip", {
    access: "authenticated",
    write: true,
    args: { trip_id: json.number().required() }
});
```

```typescript
// backend/schema/index.ts
export * from "./rpc";
```

The function itself is SQL you create in the database, for example from a file
under `backend/sql/`:

```sql
CREATE OR REPLACE FUNCTION public.get_public_proposal(token text)
RETURNS public.proposals
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT * FROM public.proposals p WHERE p.share_token = get_public_proposal.token $$;
```

The name is the function's name as Postgres stores it (an unquoted
`CREATE FUNCTION getProposal` is stored as `getproposal`), and also the URL
segment. `schema` defaults to `"public"`. Like a table, an RPC defined in a file
under `backend/schema/` that the index does not export stops the boot, and so
does a name declared twice.

| Option | Means |
|---|---|
| `access` | Required. `"public"`: anyone, signed in or not, always rate-limited. `"authenticated"`: any caller with an identity (a session, a guest session, an API key, the service key); an anonymous one gets `401` |
| `args` | The named arguments, one `json.*` field per SQL parameter. Absent: the function takes none |
| `schema` | The Postgres schema the function is in. Default `"public"` |
| `write` | Run the call read-write. Off by default: the call is read-only, and may be served by a read replica |
| `rateLimit` | `{ limit, windowMs }` per caller for this function. A public RPC without one is held to 120 calls a minute |
| `description` | What it does, for whoever reads the declarations |

## Calling one

From the SDK:

```typescript
const proposal = await rebase.rpc<Proposal | null>("get_public_proposal", { token });
const trips = await rebase.rpc<Trip[]>("my_trips", { limit: 20 });
```

Over HTTP:

```bash
curl -X POST https://your-app.example.com/api/rpc/get_public_proposal \
  -H "content-type: application/json" \
  -d '{"token": "f1c2…"}'
```

A signed-in call sends its token as on every other route. The arguments can be
typed from the declaration, which the frontend imports as a type only:

```typescript
import type { RpcArgs } from "@rebasepro/server/schema";
import type { myTrips } from "../../backend/schema/rpc";

const args: RpcArgs<typeof myTrips> = { limit: 20 };
const trips = await rebase.rpc<Trip[]>("my_trips", args);
```

## Arguments

The body is checked against `args` before anything reaches the database. A key
`args` does not name, a `.required()` argument that is missing, and a value of
the wrong kind (a number for `json.string()`, a string that is not a date for
`json.date()`) are refused together with `400 VALIDATION_CONSTRAINT`, each
violation naming its field (`filters.from`, `tags[2]`). The rules a JSON column
takes apply too: `.validate({ min, max, pattern, … })`, `.oneOf([...])`.

An argument left out is not passed, so the SQL function's own `DEFAULT`
applies; a `.default(value)` on the field fills it instead. An argument sent as
`null` is passed as `NULL`.

The values reach the function as one bound parameter, a JSON object that
Postgres converts to the function's parameter types (`json_to_record`), so an
array becomes an `integer[]`, an object a `jsonb`, an ISO string a
`timestamptz`. They are never written into the statement's text. A value
Postgres cannot read as the parameter's type is `400 RPC_INVALID_ARGUMENT`.

## What it answers

The answer follows the function's return type, as PostgREST's does:

| The function returns | The answer |
|---|---|
| `SETOF <table>`, `TABLE (…)` | an array of rows |
| `SETOF integer` (any single value) | an array of values |
| a row type, or `OUT` parameters | the row, or `null` when it is `NULL` |
| a single value (`bigint`, `text`, `jsonb`, …) | the value |
| `void` | `null` |

Values are spelled as `/api/data` spells them: a `timestamptz` in RFC 3339, a
`bigint` as a number when it fits.

## Who it runs as

Each call opens a transaction as the caller, with the same identity the data
API uses, so a `SECURITY INVOKER` function (the default) sees exactly the rows
the caller's policies give them, and `rebase.uid()` inside it is the caller.
An anonymous caller of a public RPC runs as the anonymous identity: a policy
that requires a user hides every row from it. A `SECURITY DEFINER` function
runs as the role that owns it, which is how a function hands an anonymous
caller one row by a token without opening the table to them.

An API key that narrows what it may do needs `data:read` to call an RPC, or
`data:write` for one declared `write: true`, unqualified: a function reads
whatever tables it reads.

## Writes

A call runs read-only unless the RPC says `write: true`. A function that
inserts, updates or deletes without it fails with `500 RPC_READ_ONLY`. A write
still passes the tables' insert and update policies as the caller.

## Rate limits

Every `public` RPC is limited per caller (by user id when signed in, by address
otherwise): 120 calls a minute unless it declares `rateLimit`. The count lives
where the backend keeps its [function rate limits](/docs/backend/function-rate-limits/),
so `REBASE_RATE_LIMIT_STORE=sql` shares it across replicas. Past it the call
answers `429 RATE_LIMITED` with `Retry-After`. Calls also spend the caller's
data API budget. An `authenticated` RPC is limited only when it declares
`rateLimit`.

## Errors from the function

`RAISE EXCEPTION 'This proposal has expired'` answers `400 RPC_EXCEPTION`
with that message, and `details.sqlState`, `detail` and `hint`.
`RAISE SQLSTATE 'PT404'` answers with the status after `PT`, as in PostgREST.
Every RPC code is listed under [Errors](/docs/backend/errors/#sql-functions-as-rpc).

## On the managed runtime and Rebase Cloud

Nothing to configure: the declarations are part of `backend/schema`, which
`rebase build` puts in the bundle, and the runtime reads them where it reads
the tables. The function itself must exist in the database the deployment uses.

An ejected backend that passes `schemaDir` reads them from the same index; one
that passes its tables as values passes its RPCs the same way:

```typescript
await initializeRebaseBackend({ app, server, tables, rpc: [getPublicProposal, myTrips], /* … */ });
```

RPCs are part of the data surface: a process that does not serve `/api/data`
(`REBASE_ROLE=functions`) does not serve `/api/rpc`, and they run on the
default database.

## What it does not do

- Calls are `POST` only; a `GET` on a declared name answers `405`.
- Only named parameters can be passed. A function whose parameters have no
  names, or that returns `SETOF record` without `OUT` parameters, cannot be
  called this way.
- Among overloads of one name, the call reaches the one whose named parameters
  take exactly the arguments sent; two that both do are `500 RPC_AMBIGUOUS`.

For logic that is not one SQL function, write a [custom function](/docs/backend/custom-functions/)
and run SQL in it with `getSql(c)`.
