---
title: Database Branching
sidebar_label: Branching
slug: docs/backend/branching
description: Create isolated database branches for development, staging, and testing using PostgreSQL's CREATE DATABASE ... TEMPLATE — instant, full-fidelity copies with zero downtime.
---

## Overview

Database branching lets you create **instant, isolated copies** of your entire database — schema and data — for development, staging, or testing. Each branch is a real PostgreSQL database created from a template, so it's a full-fidelity copy with no downtime.

This is similar to git branching, but for your database. Create a branch, experiment with migrations or data, and delete it when you're done. Your production database is never touched.

## How It Works

Rebase uses PostgreSQL's native `CREATE DATABASE ... TEMPLATE` to create branches. This is:

- **Instant** — PostgreSQL copies the template at the filesystem level
- **Full-fidelity** — schema, data, indexes, constraints, RLS policies — everything is copied
- **Isolated** — changes in the branch don't affect the source database

Branch metadata is stored in a `rebase.branches` table in the main database, so the system always knows which branches exist and where they came from.

## API

The branching API is available through the backend's `DatabaseAdmin` interface:

### Create a Branch

```typescript
// Create a branch from the default database
await admin.createBranch("feature_auth");

// Create a branch from a specific source database
await admin.createBranch("staging", { source: "production" });
```

This creates a new PostgreSQL database named `rb_feature_auth` (prefixed to avoid collisions) and records it in the metadata table.

### List Branches

```typescript
const branches = await admin.listBranches();
// [
//   {
//     name: "feature_auth",
//     parentDatabase: "rebase",
//     createdAt: "2026-04-15T10:30:00Z",
//     sizeBytes: 52428800
//   }
// ]
```

### Get Branch Info

```typescript
const branch = await admin.getBranchInfo("feature_auth");
// { name: "feature_auth", parentDatabase: "rebase", createdAt: ..., sizeBytes: ... }
```

### Delete a Branch

```typescript
await admin.deleteBranch("feature_auth");
```

This drops the PostgreSQL database and removes the metadata. The main database can never be deleted.

## Configuration

Database branching requires the `adminConnectionString` to be configured in your PostgreSQL bootstrapper, since creating and dropping databases needs elevated privileges:

```typescript
createPostgresBootstrapper({
    connection: db,
    schema: { tables, enums, relations },
    adminConnectionString: process.env.ADMIN_CONNECTION_STRING || databaseUrl,
    connectionString
})
```

The `DatabasePoolManager` automatically handles connection pooling for branch databases. When you switch to a branch, the pool manager creates a new connection pool targeting that database.

## Branch Naming

Branch names are sanitized to only allow alphanumeric characters and underscores. The actual PostgreSQL database name is prefixed with `rb_` to avoid collisions:

| Branch name | Database name |
|---|---|
| `feature_auth` | `rb_feature_auth` |
| `staging` | `rb_staging` |
| `v2_migration` | `rb_v2_migration` |

## Use Cases

### Preview Environments

Create a branch for each pull request or preview deployment. The branch gets a full copy of production data, so reviewers can test against real data.

### Migration Testing

Before running a migration on production, create a branch and run the migration there first. If something goes wrong, just delete the branch.

### Data Experiments

Need to test a data transformation? Create a branch, run your script, and verify the results without touching production.

## Limitations

- **Active connections** — PostgreSQL requires all connections to the source database to be closed before creating a template. The branch service automatically disconnects idle pools, but other clients (e.g., pgAdmin) must be disconnected manually.
- **Disk space** — each branch is a full copy of the database. Monitor disk usage when creating many branches.
- **Cross-database queries** — branches are separate PostgreSQL databases. You cannot JOIN between a branch and the main database.

## Next Steps

- **[Backend Overview](/docs/backend)** — Full backend configuration reference
- **[CLI](/docs/cli)** — Manage branches from the command line
- **[Entity History](/docs/backend/history)** — Track changes within a branch
