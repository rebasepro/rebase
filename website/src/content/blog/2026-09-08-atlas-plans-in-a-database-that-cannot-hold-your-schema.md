---
title: "Atlas plans your migration in a database that cannot hold your schema"
description: "A pgvector column made `atlas schema apply` impossible — not flaky, impossible — because Atlas resolves your desired state inside a scratch database it empties on every run. Four workarounds, all measured dead, and the carve-out that worked, including the phantom DROP COLUMN it left behind."
pubDate: 2026-09-08
authors: francesco
---

Declare a `{ type: "vector" }` property in Rebase and, until last week, `rebase db push` was not slow or unreliable. It was impossible:

```
pq: type "vector" does not exist
```

Permanently, for every project, for the framework's own embedding property. Nothing a user could write got past it.

The reason is worth knowing whether or not you have ever heard of Rebase, because it is a property of [Atlas](https://atlasgo.io) — and, in one form or another, of every declarative schema tool that works by diffing.

## The dev database is not your database

`rebase db push` compiles your collections to `drizzle/schema.sql` and hands that file to `atlas schema apply`. Atlas needs to know what that file *means* — what tables and types and constraints it describes once a real Postgres has parsed it — so it materialises the file in a scratch database, the one you point at with `--dev-url`.

That database is snapshotted, emptied at the start of every run, and restored afterwards.

Which reconciles two observations that look contradictory until you know this. Objects you place in the dev database by hand survive a *successful* push — they get restored at the end. They are missing when a push *fails* mid-analysis, because the restore never happens. And a dev database left dirty fails the next run outright with `connected database is not clean`.

More importantly: it means your desired state is resolved against a database that is, by design, guaranteed to be empty of everything you did not put in `schema.sql`. Including extensions. So `VECTOR(384)` is parsed by a Postgres that has never had pgvector installed and never will, and the type does not exist, and the run dies before it has looked at your actual database even once — where, quite possibly, pgvector is installed and the column already exists.

## Four ways around it, all measured dead

We tried the obvious ones, on Atlas 1.2.3 and 1.3.2 against Postgres 18.4. Recording the negative results because each one costs an hour to disprove:

**Seed the extension into the dev database beforehand.** It is wiped before planning. Verified directly: three seeded helper functions plus `unaccent` and `pg_trgm` were present before a run and gone after one that errored mid-analysis.

**Put `CREATE EXTENSION vector` in the desired state.** Refused on the free tier — extensions, like functions, are a logged-in feature.

**Install the extension into a non-`public` schema so the wipe misses it.** The dev database then reports as "not clean" and the run refuses to start.

**Leave the column in `schema.sql` and add `--exclude`.** This is the one that feels like it should work and does not, because of ordering: the desired-state file is parsed and applied *before* the diff is filtered. `--exclude` narrows what Atlas compares, not what it reads.

So there is no configuration of Atlas in which a declared vector column survives. The column has to leave `schema.sql` entirely.

## The carve-out

Full-text search had already been given this treatment, for a different Atlas limit: it will not parse a desired-state file containing a `CREATE FUNCTION` at all — `functions and procedures are available to logged-in users only` — and search ships helper functions for unaccenting and normalisation.

Vector took the same shape:

- The column, its `hnsw`/`ivfflat` indexes and `CREATE EXTENSION vector` are generated into `drizzle/vector.sql` instead of `schema.sql`.
- Atlas is given `--exclude` patterns for each of those objects, so it does not plan a drop for the things it can no longer see.
- Rebase applies `vector.sql` itself, after `schema apply`, and appends it to the migration Atlas just wrote.

One measurement made this much smaller than expected, and it contradicted a docstring we had been carrying for weeks: **excluding a column really does keep it out of Atlas's dev-database replay.** A target holding `vector(3) NOT NULL UNIQUE`, against a `schema.sql` holding neither the column nor the extension, reports "Schema is synced" on both 1.2.3 and 1.3.2. The `NOT NULL` and the `UNIQUE` are properties *of* the column and go with it. Only the column and index names need excluding — the elaborate dev-database seeding we had written for search was dead code the whole time, and is now deleted.

While we are correcting things: a wider reading of this limit — "Atlas cannot handle expression indexes" — is wrong, and we nearly acted on it. `CREATE INDEX ... ((lower(email)))` parses, plans, applies and re-plans clean, as do composite indexes with `DESC NULLS LAST`, partial `WHERE`, `UNIQUE`, covering `INCLUDE`, `USING gin` and `USING brin`. Atlas writes all of them into migration files correctly. Search needs its carve-out because it *ships functions*, not because it calls one. Declared collection indexes therefore stay on the Atlas path and keep drift detection, migrations and rollback for free.

## The four traps the carve-out sets

This is the part I would want to read if I were doing it myself.

**`--exclude` patterns must be fully qualified: `schema.table.object`.** The two-part form is only correct when the connection URL scopes Atlas to a single schema. Otherwise `posts.search_vector` is read as a *table* named `search_vector` in a *schema* named `posts`, matches nothing, and **reports no error**. The push then cheerfully plans a `DROP COLUMN` for the object your exclusion was written to protect. (Putting `exclude = [...]` in an `atlas.hcl` `env` block does not help either: on `migrate diff` it is accepted and silently ignored. Measured — it still wrote the drop.)

**`--exclude` exists on `atlas schema apply` and on nothing else.** Not `migrate diff`. Not `migrate apply`. A CLI rejects an unknown flag before doing any work, so passing it there is a total failure, not a degraded one — `rebase db generate` and `rebase db migrate` were both dead for every project with a `search` block, with `Error: unknown flag: --exclude`.

The guard that added the flag was this:

```ts
if (collectionsPath && (args.includes("apply") || args.includes("diff")))
```

which reads as a subcommand test and is not one, because `migrate apply`'s arguments begin with `"apply"` exactly as `schema apply`'s do. The general form is worth keeping: **the domain is half the identity of a subcommand.** Any guard that inspects only `args` cannot tell `schema apply` from `migrate apply`. The correct shape is `domain === "schema" && args.includes("apply")`.

**Removing the flag exposes what the crash was hiding.** `atlas migrate diff` computes the current state by replaying your migration directory — which now contains the appended `search.sql` and `vector.sql` — and diffs it against a `schema.sql` that deliberately omits those objects. So it plans `ALTER TABLE "public"."talents" DROP COLUMN "search_vector";` into your next migration, and nothing catches it: the destructive-change gate reads the *push* plan, and this is a file that will be applied days later by someone else.

Worse, Atlas folds the phantom drop into whatever real change shares the table:

```sql
ALTER TABLE "public"."talents" DROP COLUMN "embedding", ADD COLUMN "neighbourhood" text NULL;
```

You cannot drop the statement; you have to edit its clause list. `carved-out-migration.ts` splits the action list, removes only clauses that drop a carved-out object, preserves the untouched bytes, and — the important part — **refuses rather than guesses**, exiting non-zero on anything it cannot parse. Its statement splitter also had to learn dollar quoting, or a `DO $tag$ … $tag$` block shreds into fragments. And the predicate for refusing has to be precise: it fires only when the statement actually contains `DROP`, so a `COMMENT ON COLUMN`, a `RENAME COLUMN`, or the `CREATE INDEX` in the appended DDL pass through untouched. Merely naming a carved-out object is not a reason to reject a migration.

**`ADD COLUMN IF NOT EXISTS` launders a type change.** This is the subtlest cost and it is inherent to the approach. Atlas used to plan the `ALTER … TYPE` when you changed a column. Once it cannot see the column, editing `dimensions: 384` to `768` pushes clean and changes nothing at all. That needs its own guard — ours reads `atttypmod`, which for a pgvector column *is* the dimension count.

## Installing the extension is a permission, not a request

A first pass made `CREATE EXTENSION vector` unconditional whenever a vector property existed. That was the wrong call and got reverted.

Whether pgvector *may* be installed depends on the image, on the grant your role holds, and on your provider's allow-list — none of which are visible from inside a connection. So it is declared, on the database resource:

```ts
database({ extensions: ["vector"] })
```

Withholding it withholds the install, never the column. A hand-installed pgvector keeps working with no configuration at all, and a managed provider that pre-installs it needs nothing from you. The statement is issued only where the schema needs it *and* you have said it is allowed.

## The honest limits

A carved-out object is outside Atlas, and that is a real loss, not a neutral rearrangement. No drift detection on those columns, no automatic `ALTER … TYPE`, no rollback plan — which is precisely why the dimension guard had to be written by hand, and why the next carved-out object will need its own equivalent. We accept it for two object families, search and vector, because both are unreachable otherwise. It would be a bad default.

Everything above was measured on Atlas 1.2.3 and 1.3.2 against Postgres 18.4, on the free tier. Some of it is a licensing boundary rather than a technical one and may move. The dev-database wipe will not: it is how diffing works, and any tool that computes a desired state by materialising your DDL somewhere clean has the same hole wherever your schema depends on something that clean place does not have.

---

Rebase is an open-source backend-as-a-service for Postgres — REST, a typed SDK, auth, storage, realtime and row-level security over a database you own, with an admin panel when you want one. It is [MIT-licensed on GitHub](https://github.com/rebasepro/rebase), and it is in public beta: the [compatibility page](/docs/compatibility) sets out exactly what may change and what may not.
