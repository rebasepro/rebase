---
title: MongoDB
sidebar_label: MongoDB
description: "@rebasepro/server-mongo runs Rebase on MongoDB: a complete data driver, change-stream realtime and snapshot history — and no row-level security."
---

:::note[Esta página solo está disponible en inglés]
La traducción está pendiente. El contenido siguiente está en inglés.
:::

`@rebasepro/server-mongo` implements Rebase's `BackendBootstrapper` against
MongoDB. The REST API, the generated SDK, the admin panel and the auth surface
all work over it.

:::caution[Experimental, and it does not have row-level security]
Read this section before choosing it. MongoDB has no equivalent of PostgreSQL's
row-level security, so **the isolation model the rest of Rebase rests on does not
apply here**. `securityRules` on a collection are not enforced by the database;
authorization is whatever your own code checks.

That is not a gap waiting to be filled — it is a property of the engine. If
per-row authorization enforced below the application is why you are looking at
Rebase, use the [PostgreSQL driver](/docs/backend/database/).
:::

## Installation

```bash
pnpm add @rebasepro/server-mongo
```

```ts title="backend/src/index.ts" no-verify
import { rebase } from "@rebasepro/server";
import { createMongoBootstrapper } from "@rebasepro/server-mongo";

rebase({
    backend: createMongoBootstrapper({ url: process.env.DATABASE_URL! })
});
```

Set `DATABASE_URL` to a MongoDB connection string
(`mongodb://…` or `mongodb+srv://…`).

## What works

| | |
|---|---|
| **Data API** | The full REST surface: list, get, create, update, delete, filters, ordering, pagination |
| **Generated SDK** | The same typed client as on Postgres |
| **Realtime** | Change streams. This needs a replica set — a standalone `mongod` has no oplog to tail, so realtime is silently unavailable there |
| **History** | Snapshot-based, the same shape as on Postgres |
| **Auth** | The full auth surface, with its repositories stored in MongoDB |
| **Admin panel** | Collections, forms, relations in the UI, storage fields |

## What is different

- **No row-level security.** See the warning above. This is the important one.
- **No SQL surface.** Studio's SQL editor, the RLS policy editor and
  `pnpm rls:check` are Postgres features and are not available.
- **No relational integrity.** A relation is a stored reference the application
  resolves; there is no foreign key, so nothing at the database level stops a
  dangling one.
- **No `rebase db push` / `generate` / `migrate`.** MongoDB has no schema to
  migrate. Collections appear as documents are written.

## Choosing between the two

Take MongoDB when the data is genuinely document-shaped and the authorization
model lives in your application anyway. Take PostgreSQL when you want the
database itself to be the thing enforcing who sees which row — which is the
argument Rebase makes everywhere else on this site.
