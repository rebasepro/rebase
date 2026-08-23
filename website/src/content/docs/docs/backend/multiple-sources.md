---
title: Multiple Databases and Buckets
sidebar_label: Multiple Sources
description: Route collections to different databases and properties to different storage buckets, and configure each one from the environment.
---

## Overview

A project is not limited to one database and one bucket. Every named thing a
project needs — a database, a bucket, a topic — is **declared with a
constructor in your config**, and configured from the environment by a variable
derived from its key.

One rule, whatever the kind: there is no second place to look, and nothing that
has to be kept in sync by hand.

## Declaring resources

Put them in `config/resources.ts`. Exporting them is good practice — it gives
you something to import — but the declaration is what registers them.

```ts
// config/resources.ts
import { bucket, database, topic } from "@rebasepro/types";

/** The project's database. Reads DATABASE_URL, as it always did. */
export const main = database();

/** A second one. Reads DATABASE_URL__ANALYTICS. */
export const analytics = database("analytics", { label: "Analytics warehouse" });

/** A bucket. Reads S3_BUCKET__MEDIA. */
export const media = bucket("media", { engine: "s3", label: "Public media" });

/** A topic, delivered through the durable job queue. */
export const signups = topic<{ userId: string }>("signups");

signups.subscription("send-welcome", async (event) => {
    // …
});
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

### Seeing what you declared

```bash
rebase resources            # list them
rebase resources --write    # regenerate rebase.resources.json
rebase resources --check    # fail if that file is stale
```

`rebase.resources.json` is **generated** and committed. It is what a host reads
to decide what to provision *before* it runs anything — which is how a console
can say "this project wants a `media` bucket and has none" on a first deploy.
Edit the declarations, never the file; `--check` fails a build if the two
disagree.

### An engine the build has never heard of

Each kind owns its engine list, and an unknown one is refused at the call site
rather than accepted and failed later. Something genuinely outside the list is
spelled `custom:`:

```ts
export const objects = bucket("objects", { engine: "custom:minio" });
```

### Handing them to the frontend

The `<Rebase>` provider needs to know which sources exist and how each is
reached — a `direct` source is one the browser talks to itself. It imports the
same config package the backend does, so it can reuse the declarations rather
than repeating them:

```tsx
import "../config/resources";                 // registers them
import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";

<Rebase
    dataSources={declaredDataSources()}
    storageSources={declaredStorageSources()}
>
    {children}
</Rebase>
```

The side-effect import is deliberate: declaring is what registers, so a bundler
that dropped an unused module would leave both lists empty.

## Configuring each source

Environment variable names are derived from the resource key, so there is
nothing to keep in sync by hand:

```
<VARIABLE>              the default resource   DATABASE_URL, S3_BUCKET
<VARIABLE>__<KEY>       a named resource       DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
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
REBASE_DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

The driver is chosen from the declared `engine` (`postgres` and `mongodb` are
known), and `REBASE_DRIVER__<KEY>` overrides it for anything else.

### Storage

```bash
S3_BUCKET__MEDIA=my-media-bucket
STORAGE_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

The engine comes from the declaration, so there is no `STORAGE_TYPE` to set.

### An infrastructure config file instead

Environment variables are the ordinary path. A deployment with many resources
can use a file instead, which is read **before** the environment:

```bash
rebase eject infra          # writes rebase.infra.json
```

What it writes is the environment path spelled out — one entry per resource,
each pointing at the variable that was already being read — so nothing changes
until you edit it. Values are `{"$env": "..."}` pointers rather than literals,
so the file can live in a config repository without carrying secrets.

## Topics

A topic is delivered through the durable job queue: publishing writes **one row
per subscription**, so each subscriber retries on its own schedule and a broken
one neither blocks the others nor makes them run again.

```ts
await signups.publish({ userId });
```

Delivery is **at-least-once**. A worker that dies holding a job releases it and
the next one starts the handler from the top, so a handler must tolerate seeing
an event twice. Publishing inside a transaction that rolls back never happened —
the enqueue is a row insert.

Declaring a topic turns the job queue on by itself. Publishing to a topic
nothing declares throws rather than writing rows no worker handles.

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

One consequence worth knowing if you declare buckets explicitly: no default
bucket is invented for you. Declaring only `bucket("media")` means there is no
default bucket, and a property that does not name one has nowhere to go —
deliberately, and identically in development and production. Add `bucket()` too
if you want one.

In development, a declared bucket that nothing else configured becomes a real
local directory, so `bucket("media")` plus `rebase dev` is enough to upload a
file. That never happens in production, or on the managed runtime: a bucket
invented there would write uploads to a container filesystem that vanishes on
the next rollout.
