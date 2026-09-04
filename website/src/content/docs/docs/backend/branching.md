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

---

## Programmatic API

The branching API is exposed via the backend's `BranchService`. Below is a reference of the core interface:

### Create a Database Branch

Generates a new branch database from the default database or an explicit source template.

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
    parentDatabase: "rebase",
    createdAt: 2026-06-20T22:00:00.000Z,
    sizeBytes: 83886080 // 80 MB
  }
]
*/
```

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
> Safety Guard: The main database (default database name configured in connection strings) is protected. If you attempt to delete the parent database, the `BranchService` throws a `"Cannot delete the main database"` error and aborts.

---

## CLI Integration

Database branches can be managed directly using the Rebase CLI.

```bash
# Create a new branch named 'dev_sandbox'
rebase db branch create dev_sandbox

# List all branches and disk utilization
rebase db branch list

# Delete a branch
rebase db branch delete dev_sandbox
```

When you create or switch to a branch, the CLI updates your local development configuration. The `DatabasePoolManager` dynamically instantiates a new connection pool for the chosen branch database name (e.g. `rb_dev_sandbox`), letting you test migrations or seed data without manual connection string edits.

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

