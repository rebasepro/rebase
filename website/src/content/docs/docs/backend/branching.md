---
title: Database Branching
sidebar_label: Branching
description: Create isolated database branches for development, staging, and testing using PostgreSQL's CREATE DATABASE ... TEMPLATE — instant, full-fidelity copies with zero downtime.
---

## Overview

Database branching allows you to create **instant, isolated copies** of your entire database (both schema and data) to safely perform development, migration tests, and QA procedures. 

By leveraging native PostgreSQL templates, Rebase provisions clone databases at the filesystem level. This means you get a full-fidelity replica containing all tables, indexes, custom types, constraints, and Row-Level Security (RLS) policies without any network transfer overhead or schema setup delays.

```
                  ┌────────────────────────┐
                  │ Production DB (rebase) │
                  └───────────┬────────────┘
                              │
               (CREATE DATABASE ... TEMPLATE)
                              │
            ┌─────────────────┴─────────────────┐
            ▼                                   ▼
┌───────────────────────┐           ┌───────────────────────┐
│ rb_feature_auth (Dev) │           │ rb_staging (Staging)  │
└───────────────────────┘           └───────────────────────┘
```

---

## Under the Hood: PostgreSQL Templating

When a database branch is created, the Rebase `BranchService` executes the following SQL:

```sql
CREATE DATABASE "rb_feature_auth" TEMPLATE "rebase";
```

PostgreSQL processes this operation by copying the underlying filesystem directories containing the source database files. This provides:
- **Sub-Second Clones**: No SQL generation or data loading is performed.
- **Identical Schemas and Data**: Every row, index, and constraint is duplicated instantly.
- **Complete Isolation**: Altering the schema or inserting records into the branch has no impact on the source database.

### The Connection Limitation Guard

PostgreSQL requires that **no other active connections** exist on the template (source) database when running a `CREATE DATABASE ... TEMPLATE` command.

To prevent failures, the Rebase `DatabasePoolManager` executes an active eviction process before cloning or dropping a branch:
1. **Eviction Loop**: It automatically closes and disconnects all idle pools pointing to the targeted database within the Rebase application context.
2. **External Connections Block**: If external clients (such as DBeaver, pgAdmin, or external backend processes) maintain active transactions on the source database, PostgreSQL will reject the template operation with a `"being accessed by other users"` error.

The failure names what is connected rather than leaving you to guess:

```
Cannot create branch: the source database "leadgen" has active connections.
  Connected right now:
    2 × psql
  A running `rebase dev` is the usual one — stop it, or re-run with --force to
  disconnect them for you.
```

`--force` terminates those sessions before templating, on `create` and `delete`
alike. It never terminates the session running the command itself.

`create --force`
also closes the source to new connections for the copy
(`ALTER DATABASE … ALLOW_CONNECTIONS false`, run from the server's `postgres`
database) and opens it again afterwards: on failure, and on any signal it can
catch (closing the terminal, Ctrl-C, SIGTERM, SIGQUIT). Killed outright
(SIGKILL), it leaves the source closed until the next `rebase db branch`
command, any of them, which reopens it first and says so;
`ALTER DATABASE "<db>" ALLOW_CONNECTIONS true`, run from the `postgres`
database, does the same by hand. While a forced create holds its source closed,
it holds an advisory lock on it in the `postgres` database, so that reopening
leaves a live copy's source alone, and a second forced create from the same
source waits for the first to finish. A client
that reconnects as soon as it is disconnected, as a running `rebase dev` does,
then cannot slip back in before the copy starts. That needs the source's owner;
without it, and on `delete`, `--force` disconnects the sessions up to three
times before it gives up. When a session is still there after that, the error
says they reconnected and to stop them, not to pass `--force` again. On 0.24 it
disconnected them once, and about one `create --force` in seven under a running
`rebase dev` failed with advice to re-run with `--force`.

`DatabasePoolManager` disconnects its own idle pools before cloning or dropping — but only the pools **inside the process doing the work**. `rebase db branch` runs as its own process, so this reaches nothing else on your machine:

- **A running `rebase dev` blocks branching.** This is the common case, not an edge case: wanting a branch and running the app are usually the same moment. Stop the dev server, branch, and start it again.
- **So does any other client.** DBeaver, pgAdmin, a `psql` session, a second app instance — PostgreSQL rejects the operation with `is being accessed by other users` and those connections have to be closed by hand.

There is no way around this in PostgreSQL itself; `CREATE DATABASE ... TEMPLATE` is a filesystem-level copy and the template must be quiescent for the duration.

---

## Metadata Schema

Branch configurations are stored in the default database under the `rebase.branches` table, which is provisioned during bootstrapping:

```sql
CREATE SCHEMA IF NOT EXISTS rebase;

CREATE TABLE IF NOT EXISTS rebase.branches (
    name         TEXT PRIMARY KEY,              -- Sanitize user branch name (alphanumeric & underscores)
    db_name      TEXT NOT NULL UNIQUE,          -- Actual PostgreSQL database name (prefixed with 'rb_')
    parent_db    TEXT NOT NULL,                 -- Source database cloned from
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata     JSONB DEFAULT '{}'
);
```

A server running on a branch keeps branches in the database the branch was
copied from. The branch's own `rebase.branches` is only a snapshot, taken before
its row was written. So `rebase dev` on a [switched](#cli-integration) checkout
sets `REBASE_BRANCH_PARENT_DATABASE` to the database `.env` names, and a server
with that variable reads and writes the registry there, and copies new branches
from it by default. Studio's Branches pane on a branch lists the main database's
branches, the current one included, and a branch created there is one
`rebase db branch list` shows.

---

## Programmatic API

The branching API is exposed via the backend's `BranchService`. Below is a reference of the core interface:

### Create a Database Branch

Generates a new branch database from the default database or an explicit source template.

The default is the database the server's own connection is on, or
`REBASE_BRANCH_PARENT_DATABASE` when the server runs on a branch. It is never
the database `ADMIN_CONNECTION_STRING` names, when that is another one.

```typescript no-verify
import { initializeRebaseBackend } from "@rebasepro/server";

const backend = await initializeRebaseBackend({ /* ... */ });
const admin = backend.driver.admin;

// Create a branch from the default database
const newBranch = await admin.createBranch("feature_oauth");

// Create a branch from a specific staging database
const stagingBranch = await admin.createBranch("pr_review_42", { 
    source: "rb_staging" 
});
```

### List Active Branches

Retrieves list of registered branches along with their physical sizes queried via the PostgreSQL `pg_database_size` system function.

```typescript
const branches = await admin.listBranches();
/*
Output:
[
  {
    name: "feature_oauth",
    database: "rb_feature_oauth",
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

`database` is the PostgreSQL database the branch is, as its record says:
what to connect to, and what to pass as `source` to copy the branch. It is not
the branch's name (`staging` is the database `rb_staging`).

### Get Branch Information

Fetches metadata for a single branch. If the branch exists, the service attempts to query its current physical disk usage:

```typescript
const info = await admin.getBranchInfo("feature_oauth");
```

### Delete a Branch

Drops the target database from the server and cleans up its record in the `rebase.branches` metadata table.

```typescript
await admin.deleteBranch("feature_oauth");
```

> [!CAUTION]
> Safety Guard: The main database (default database name configured in connection strings) is protected. That is the database the server's own connection is on, or `REBASE_BRANCH_PARENT_DATABASE` on a branch. If you attempt to delete the parent database, the `BranchService` throws a `"Cannot delete the main database"` error and aborts.

---

## CLI Integration

Database branches can be managed directly using the Rebase CLI.

```bash
# Create a new branch named 'dev_sandbox'
rebase db branch create dev_sandbox

# Clone from a database other than the default
rebase db branch create pr_review_42 --from rb_staging

# List all branches and disk utilization
rebase db branch list

# Work on it — every later command in this checkout uses it
rebase db branch switch dev_sandbox

# Which branch am I on?
rebase db branch switch

# Back to the main database
rebase db branch switch --off

# Show one branch's parent, age and size
rebase db branch info dev_sandbox

# What the branch changed: schema, RLS policies and rows (--json for all of it)
rebase db branch diff dev_sandbox

# Delete a branch
rebase db branch delete dev_sandbox
```

 `switch` is what makes a branch usable. It records the branch in
`.rebase/branch.json` — a name, never a connection string, so your credentials
stay in `.env` alone — and every `rebase` command in that checkout then resolves
the branch's database instead: `dev`, `db push`, `db migrate`, `db backup`.
A `rebase dev` that is already running keeps the database it started on until
you restart it, and `switch` says so.

`rebase db branch
list` marks the branch this checkout is on, and `prune` never removes it, as
`delete` refuses to: the plan lists it as kept, and says to leave it with
`rebase db branch switch --off` first. On 0.24 `prune --older-than … --yes`
dropped it, and the checkout then pointed every command at a database that no
longer existed.

It sits between the shell and the project file in the resolution order:

1. `--database-url` on the command line
2. `DATABASE_URL` in the shell environment
3. **the branch this checkout is switched to**
4. `DATABASE_URL` in the project's `.env`
5. `--docker`, or the last `rebase dev` having run with it
6. the managed development database

Rung 5 follows the
last `rebase dev --docker`, so a branch command after it needs no `--docker` of
its own, and a `--docker` that a rung above it outranks starts no container and
says it was ignored. On 0.24 only the flag counts, and an outranked one still
starts the container.

A branch has to outrank `.env` or switching would do nothing on any project that
sets `DATABASE_URL`; it must not outrank the two above it, because a flag on this
command line is a more immediate instruction than a switch made yesterday.

`.rebase/` is gitignored, so the branch you are on is a fact about your machine
and never about the project.

On a switched
checkout, `rebase db branch create`, `list`, `info`, `delete` and `prune` work
on the main database, where the registry is, and say so. `create` still copies
the branch you are on unless you pass `--from`; it is recorded in the main
database, so `list` shows it from any checkout. Before 0.25 only `list` did
this, and a branch created from a switched checkout was recorded in the branch's
snapshot alone.

Branches are ordinary PostgreSQL databases named after the branch with an `rb_` prefix, so `dev_sandbox` above is the database `rb_dev_sandbox` on the same server.

Creating a branch does **not** change which database your project talks to. `rebase db branch create` makes the copy and stops there; nothing writes to `.env`, and the next `rebase dev` still uses the database it used before. To work against a branch, switch to it with `rebase db branch switch <name>`, as above. To reach it from anything that is not a `rebase` command, its connection string is the one you already have with the database name swapped:

```bash
postgresql://user:pass@localhost:5432/rb_dev_sandbox
```

---

## Reviewing and merging a branch

<span class="since-badge" data-since="0.26">Since 0.26</span>

A branch is where an agent, or a migration you are not sure of, can change a
database without touching the real one. Before any of it reaches the database
the branch was made from, you can see what changed and merge it from
[Studio](/docs/studio/): open **Branches** and pick one.

- **Schema & RLS policies** lists every table, column, primary key,
  constraint (unique, foreign key, check, exclusion), index, trigger, policy,
  enum type (with its labels), view and function the branch added, dropped or
  altered, as SQL, with the parent's definition beside the branch's.
- **Data changes** counts, per table, the rows the branch inserted, updated and
  deleted, matched by primary key, and shows up to 100 of them per table (at
  most 1,000 when you ask for more) with the columns that changed. A column
  named like a credential — `password_hash`, a `*_token`, anything with
  `secret` in it, a `*_hash` — shows `[redacted]` instead of its value.

Reviewing a branch needs the `database:write` scope, the one that runs SQL as
the database owner: the samples are rows of both databases, read outside
row-level security. `database:read` lists branches but does not read their
rows.

The same diff is `rebase db branch diff <name>` in a terminal, `GET
/api/admin/branches/<name>/diff` over HTTP, the `rebase_db_branch_diff` MCP
tool, and `admin.diffBranch(name)` in code. Rebase's own tables (sessions,
history, the branch registry) are left out.

### Which side changed a row

The parent keeps taking writes while the branch is worked on, so "the two
databases differ" is not the same as "the branch changed it": a row the parent
inserted after the branch was made looks exactly like a row the branch deleted.
Rebase tells them apart by when each row was written. Transaction ids belong to
the server, not to one database, and the template copy keeps them, so a row
written after the branch was made — on either side — is younger than the
transaction that created the branch database.

| The branch's row | The parent's row | Counted as |
| --- | --- | --- |
| written since the fork | absent | inserted by the branch |
| absent | from before the fork | deleted by the branch |
| written since the fork | from before the fork | updated by the branch |
| from before the fork, or absent | written since the fork, or absent | the parent's change: kept |
| written since the fork | written since the fork | a **conflict** |

Two cases look alike and are read the way that loses nothing: a row the branch
deleted and the parent then changed is kept, and a row the parent deleted and
the branch then changed is the branch's insert. An `UPDATE` that writes the
values a row already had still counts as a write.

When the fork point cannot be read — a long-lived branch whose `pg_database`
row a vacuum froze, or one renamed with `ALTER DATABASE` — the diff says so,
and counts every difference as the branch's.

### What a merge does

**Merge** writes the rows the branch inserted, updated and deleted to the
parent. What wins:

- **Rows only the branch changed** are written: inserted, overwritten or
  deleted.
- **Rows only the parent changed** since the branch was made are left exactly as
  they are — unless one references a row the branch deleted, which is a
  conflict (below).
- **Rows both changed** are conflicts. By default the merge writes nothing at
  all; choose `onConflict: "branch"` to write the branch's row over the
  parent's, or `"target"` to keep the parent's.
- **A row the branch deleted that the parent's newer rows still reference** is
  a conflict too. Say the branch deleted an author, and the parent has since
  written a post by them: deleting the author on the parent would cascade into
  that post, null its column, or fail on the foreign key. The diff counts the
  author as a conflict and names the referencing rows (`referencedBy`: the
  table, the foreign key, its `ON DELETE` and how many rows). By default the
  merge refuses, naming the table, the rows and the way out; `"target"` keeps
  the author, and with it the post; `"branch"` deletes the author, lets the
  foreign key do what it says, and lists what it reached in `warnings`.
- **Schema and policy changes are never merged.** They belong to your
  collections and their migrations: apply them with `rebase db push` (or
  `migrate`), then merge the rows.

A table whose rows cannot be matched blocks the merge: one the branch added or
dropped, one whose columns or primary key differ between the two, one with no
primary key, or one with more than 100,000 rows on a side. Its counts read 0,
because which rows changed is not known; `rowCounts` gives each side's row
count. A table like that which only the parent changed — the branch wrote none
of its rows, and the ones from before the fork are the same — is not blocked.
Pass `skipBlocked` (in Studio, tick **Merge the other tables**) to merge the
rest and leave those alone.

A table rewritten since the branch was made is blocked too (`TABLE_REWRITTEN`).
A column type change, an `ADD COLUMN` with a volatile default, `VACUUM FULL` or
`CLUSTER` writes every row anew, so every row reads as written since and which
side changed what can no longer be told. When the branch changed a column's
type, merge its rows before applying that change to the parent, or make the
branch again after it.

Every write happens in one statement on the parent — all of it, or none of it,
foreign keys checked at its end. A merge carries the `fingerprint` of the diff
you reviewed, and writes nothing when either database has changed since:
reload the diff and look again. Sequences are moved past any ids the merge
inserted.

```typescript
const diff = await admin.diffBranch("agent_run_17");
// …review diff.schema and diff.data…
const result = await admin.mergeBranch("agent_run_17", {
    expectedFingerprint: diff.fingerprint,
    onConflict: "abort" // or "branch", or "target"
});
```

Merging is deliberately not an MCP tool: an agent proposes on its branch, and a
person merges.

---

## Branching requires a real PostgreSQL server

Branching does **not** work against the managed development database — the zero-setup PGlite database `rebase dev` starts when a project has no `DATABASE_URL`.

PGlite serves exactly one database. `CREATE DATABASE ... TEMPLATE` against it writes a catalog entry and copies nothing, so the "branch" resolves to the database it was cloned from: writes you believe are isolated land in your development database, and there is no second copy to go back to.

Use branching against a real server — your own PostgreSQL via `DATABASE_URL`, or `rebase dev --docker`, which the branch commands then follow.

---

## Best Practices and Limitations

### Disk Usage
Because PostgreSQL duplicates the files on disk, each branch consumes space equal to the source database. If you have a 100GB production database, creating 5 branches will consume an additional 500GB of storage. 
* *Recommendation*: Use subsetted databases or thin dev-templates as your clone sources instead of full production clones.

 `rebase db branch prune` is how you get the space back:

```bash
rebase db branch prune                      # orphans only — always safe
rebase db branch prune --older-than 2w      # and anything older than two weeks
```

Nothing expires unless you ask: a branch can be the only copy of an afternoon's
work, so `--older-than` is opt-in and ages are floored, and the command shows its
plan and asks before removing anything unless you pass `--yes`.

Prune also finds the two ways branches drift from their metadata — an entry whose
database was dropped with plain SQL (which `list` would keep reporting forever),
and a branch database whose entry was never written (a crash between the two
statements `create` runs). Atlas's `<db>_dev_diff` scratch databases are reported
alongside but removed only with `--include-dev-diff`: they are not branches, and
one may belong to a `db push` running right now.

### pgBouncer Compatibility
When deploying behind pgBouncer or connection poolers, ensure the pooler supports administrative database operations. Creating and dropping databases bypasses standard transaction-level pools and requires direct connections to the Postgres server (using elevated user privileges) via the `adminConnectionString` configuration.

### Cross-Database Queries
Because branches are separate PostgreSQL databases, you cannot perform SQL `JOIN` statements across branch boundaries. All relations must be contained within the scope of the single active branch database.


## Related

- [Database Commands](/docs/cli/database/#rebase-db-branch) — `rebase db branch` and its flags
- [Schema Generation](/docs/cli/schema/) — how the schema a branch copies is produced
- [Environment & Configuration](/docs/getting-started/configuration/) — `DATABASE_URL`, and what a switched branch outranks
