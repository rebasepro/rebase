---
title: Multiple Databases and Buckets
sidebar_label: Multiple Sources
description: Route collections to different databases and properties to different storage buckets, and configure each one from the environment.
---

## Overview

A project is not limited to one database and one bucket. Collections already
route by `dataSource`, and file properties route by `storageSource`; this page is
about how each named source gets its configuration.

Two steps: **declare** the sources in your config package, then **configure**
each one with environment variables derived from its key.

## Declaring sources

Export `dataSources` and `storageSources` from your config package's `index.ts`.
They are shared with the frontend, which uses the same declarations to decide
whether it talks to a source through the Rebase API or directly.

```ts
// config/index.ts
import type { DataSourceDefinition, StorageSourceDefinition } from "@rebasepro/types";

export const dataSources: DataSourceDefinition[] = [
    { key: "(default)", engine: "postgres" },
    { key: "analytics", engine: "postgres", label: "Analytics warehouse" }
];

export const storageSources: StorageSourceDefinition[] = [
    { key: "(default)", engine: "local", transport: "server" },
    { key: "media", engine: "s3", transport: "server", label: "Public media" }
];
```

Then point a collection at one:

```ts
import { defineCollection } from "@rebasepro/admin-types";
const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: "analytics",
    properties: { /* … */ }
});
```

...or a file property:

```ts
coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

## Configuring each source

Environment variable names are derived from the source key, so there is nothing
to keep in sync by hand:

```
<VARIABLE>              the default source     DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named source         DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
```

The key is upper-cased and non-alphanumeric characters become underscores, so
`media-cdn` reads `S3_BUCKET__MEDIA_CDN`.

The separator is a **double** underscore on purpose. A single one would collide
with real variable names — `S3_BUCKET_NAME` would parse as the bucket for a
source called `name`.

### Databases

```bash
DATABASE_URL=postgres://localhost/app
DATABASE_URL__ANALYTICS=postgres://warehouse.internal/analytics

# Optional, per source:
DB_POOL_MAX__ANALYTICS=5
ADMIN_CONNECTION_STRING__ANALYTICS=postgres://…
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

The driver is chosen from the declared `engine` (`postgres` and `mongodb` are
known), and `REBASE_DRIVER__<KEY>` overrides it for anything else.

### Storage

```bash
STORAGE_TYPE__MEDIA=s3
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

`STORAGE_TYPE__<KEY>` may be omitted when the declaration already names the
engine.

## Failure behaviour

A declared server-transport data source with no connection string **fails the
boot**, naming the variable to set. This is deliberate and worth understanding:
the alternative is that collections routed to the missing source quietly fall
back to the default database. That is data landing in the wrong place behind a
server that reports itself healthy — far worse than a container that refuses to
start.

Two keys that would derive the same variable name are also rejected, because one
of them would silently read the other's configuration.

Sources declared with `transport: "direct"` are skipped entirely: the client
talks to those itself, so the backend holds no connection and demands no
configuration for them.

## Storage access control

Storage keys share one flat namespace and are not under row-level security, so
without an explicit access-control model the default would be "any signed-in user
may read, overwrite, delete or list any object". Production refuses to boot
rather than assume that.

The way to say what access means for your project is a `storageAuthorize` export
from the config package — a function, because no environment variable can express
"this user may read this key":

```ts
// config/index.ts
import type { StorageAuthorize } from "@rebasepro/types";

export const storageAuthorize: StorageAuthorize = async ({ key, user, operation }) => {
    if (!user) return false;
    const [ownerId] = key.split("/");
    return ownerId === user.uid || operation === "read";
};
```

Two environment escapes exist for the cases where that really is the model:

- `STORAGE_PUBLIC_READ=true` — the bucket is a public, read-only CDN. Writes,
  deletes and listing still require authentication.
- `STORAGE_ALLOW_ANY_AUTHENTICATED=true` — every signed-in user is trusted with
  every file. Defensible for a single-tenant app, never for a multi-tenant one.

## Storage in production

With no bucket configured, storage is **off** in production and uploads answer
`501`. Local disk is the container filesystem, so files written there vanish on
the next restart — an upload that fails loudly can be retried, one that succeeded
into a disk about to be wiped cannot. Set `FORCE_LOCAL_STORAGE=true` only when a
durable volume really is mounted.

One consequence worth knowing if you declare storage sources explicitly: no
default bucket is invented for you. Declaring only a `media` source means there
is no `(default)` source, and a property that does not name one has nowhere to
go — deliberately, and identically in development and production. Declare
`(default)` too if you want one.
