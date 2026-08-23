---
title: "Your backend's security should not depend on remembering to check"
description: "Rebase generates Postgres row-level security from the same definition that generates the API — fail-closed, in the database, where a forgotten middleware call cannot reach it. Here's why that placement matters, and a tool that will tell you whether your own database leaks."
pubDate: 2026-08-23
authors: francesco
---

Every authorization bug I have ever shipped had the same shape. Not a clever bypass, not a broken crypto primitive — a missing line. A route added in a hurry that forgot the `requireOwner` call. A new endpoint that queried the table directly because the helper did not quite fit. A join that reached through a protected table into an unprotected one.

The code was never wrong. It was *absent*, and absence has no stack trace.

This is the argument for putting authorization in the database, and it is the whole reason Rebase is built the way it is.

## Where the check lives decides what a mistake costs

Consider two backends holding the same data.

In the first, authorization is application code. Some middleware, a policy helper, a `where user_id = $1` that every query is supposed to carry. It works — until the day someone writes a query that does not go through the helper. Then the database, asked for every row, returns every row. It was asked politely and it answered honestly. Nothing failed; the check simply never ran.

In the second, authorization is a property of the table. The query arrives, Postgres consults the policies attached to that table, and returns the rows the current role is allowed to see. The application can be as forgetful as it likes. It can query the table directly, join through it, or expose a route nobody reviewed. The rows it gets back are still scoped, because the scoping is not in the path the developer might skip — it is in the thing they cannot skip, which is the database itself.

That is the difference between a system where a mistake is a leak and one where a mistake is a smaller result set.

## "Just use RLS", and why that is not the end of it

Postgres has had row-level security for a decade. Most people building on Postgres do not use it, and the ones who do usually use it partially. That is not laziness — the ergonomics are genuinely hostile.

RLS is off by default. Enabling it is one statement, writing a policy is another, and the two are independent: you can create a beautiful policy on a table where RLS was never switched on, and Postgres will accept it, store it, show it to you in `pg_policies`, and never once evaluate it. There is no warning. The policy is simply decorative.

Even with RLS on, `ENABLE` is not `FORCE`. An enabled-but-unforced policy is bypassed entirely for the table's owner — and an enormous number of applications connect as the owner, because that is the role the migration tool used. The policies are there. They are correct. They do not run.

Then there are the shapes that look like access control and are not. `USING (true)` is a policy. `auth.uid() IS NOT NULL` is a policy — it separates signed-in from signed-out and scopes precisely nothing beyond that, so every authenticated user sees every row. A view over a protected table runs as the view's owner and reads straight past the policies underneath it. A join table between two carefully protected endpoints is, very often, wide open — and a join table is an edge list, which is to say it is the entire social graph, or the entire permissions matrix, in one unprotected relation.

My favourite, because it is invisible in review: an unqualified column inside an `EXISTS` subquery binds to the *inner* table. `EXISTS (SELECT 1 FROM memberships WHERE org_id = org_id)` is not a tenant filter. It is `true`, spelled in a way that reads like a tenant filter, and it will survive every code review it is ever shown to.

So "just use RLS" is right and insufficient. Hand-written RLS is a second source of truth about who can see what, maintained by hand, in a language most application developers touch once a quarter, where the failure mode of every mistake is silence.

## One definition, and the policies come with it

Rebase takes the position that if RLS is the correct place for authorization, then it should not be a thing you hand-write and hope stays in sync.

A collection definition is a TypeScript file. It describes the fields, and it describes who may read and write. That one definition compiles to the Drizzle schema, the REST routes, the OpenAPI document, the typed SDK accessors — and the RLS policies, applied as migrations against your database. There is no second model of authorization to keep aligned with the first, because there is no second model at all.

Three consequences follow, and they are the interesting part.

**It is fail-closed.** In headless mode a table is served only once it has an authorization model — RLS enabled with at least one policy. A table without one is not exposed with a permissive default; it is not exposed. The API logs every table it declined to serve and why. The default state of a new table is "nobody", not "everybody", and you move it deliberately.

**Derived protection is derived.** Junction tables get policies computed from the endpoints they connect, rather than waiting for someone to notice that the many-to-many table between two locked-down collections was never locked down itself. That specific hole is common enough that it has an entry in our own audit checklist.

**The panel is not a back door.** The admin panel is a React application that talks to the same public API under the same policies as anything else. There is no privileged data path, no service-role escape hatch it quietly uses to render a table. Delete the panel and the `GET /api/data/users` response does not move. That is a property most admin UIs in this category cannot claim, and it falls out of putting the enforcement in the database rather than in a layer the panel could sit beside.

## Go and check your own database

Here is the part that does not require you to believe anything I have written.

```sh
npx @rebasepro/rls-check "postgresql://user:password@host:5432/database"
```

It audits row-level security on any Postgres — Supabase, Neon, RDS, Cloud SQL, a container on your laptop. It knows nothing about Rebase, asks nothing of your codebase, and works fine on a database that has never heard of us.

It is read-only. It issues `SELECT`s against the system catalogs — `pg_class`, `pg_policies`, `pg_proc`, `information_schema` — and nothing else. It writes nothing, changes no setting, and sends nothing anywhere: no telemetry, no upload, no network access beyond the connection string you hand it. We deliberately did not put analytics in it, because a security tool that phones home is a worse thing than any number we would have learned from it.

It looks for the failures that actually leak, rather than the ones that are easy to check for: tables served to an anonymous role with RLS switched off; policies that evaluate to `true` for every row; `auth.uid() IS NOT NULL`-shaped policies that scope nothing; views that read past the RLS on their base tables; that unqualified column in an `EXISTS` subquery; unprotected join tables between two protected endpoints; `SECURITY DEFINER` routines with an unpinned `search_path`; grants to `PUBLIC`.

Run it against something you own. If it comes back clean, you have lost ten seconds and gained a fact. If it does not, you would rather know today.

## The honest limits

Two things worth saying plainly, because a post arguing for a security model should be the first to mark its edges.

Putting authorization in Postgres means your authorization is expressed in SQL predicates. Some rules do not want to be predicates — anything that needs to call an external service, or reason about state the database does not hold. Those still belong in application code, and Rebase does not pretend otherwise. What it changes is the *default*: the row-scoping that covers most of the surface is handled where it cannot be skipped, so the code you write by hand is the genuinely unusual part rather than all of it.

And RLS costs something. Policies are predicates on every query, and a badly written one can be a sequential scan you did not order. Generated policies help here mostly by being consistent and reviewable — you can read the SQL, it lives in your migrations, and it is the same shape everywhere.

Neither of these is a reason to keep authorization in middleware. They are the terms of the trade, and after a few years of shipping systems where the answer to "why did this leak" was always "a check that was never written", I will take these terms every time.

---

Rebase is an open-source backend-as-a-service for Postgres — REST, a typed SDK, auth, storage, realtime and row-level security over a database you own, with an admin panel when you want one. It is [MIT-licensed on GitHub](https://github.com/rebasepro/rebase), and it is in public beta: the [compatibility page](/docs/compatibility) sets out exactly what may change and what may not.
