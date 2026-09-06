---
title: Multiple Databases and Buckets
sidebar_label: Multiple Sources
description: Route collections to different databases and properties to different storage buckets, and configure each one from the environment.
---

## Overview

A project is not limited to one database and one bucket. Every named thing a
project needs — a database, a bucket, a topic, a queue — is **declared with a
constructor in your config**, and configured from the environment by a variable
derived from its key. Crons and functions are files, and they enter the same
graph under the name of the file.

One rule, whatever the kind: there is no second place to look, and nothing that
has to be kept in sync by hand.

## Declaring resources

Put them in `config/resources.ts`. Exporting them is good practice — it gives
you something to import — but the declaration is what registers them.

```ts
// config/resources.ts
import { bucket, database, queue, topic } from "@rebasepro/types";

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

`queue()` is new <span class="since-badge" data-since="0.18">Since 0.18</span>. `database()`, `bucket()` and `topic()`
have been declarable since 0.17, so a project on the released version declares
those three and reaches background work through `jobs.tasks` instead.

Then point a collection at one, by handle — the same name, spelled once:

```ts
import { defineCollection } from "@rebasepro/cms-types";
import { analytics } from "../resources";

const pageViewsCollection = defineCollection({
    name: "Page Views",
    slug: "page_views",
    table: "page_views",
    dataSource: analytics,
    properties: { /* … */ }
});
```

...or a file property:

```ts
import { media } from "../resources";

coverImage: {
    name: "Cover image",
    type: "string",
    storage: { storageSource: media, acceptedFiles: ["image/*"] }
}
```

`defineCollection` records the handle's key, so past that point a collection is
plain data — it serialises, it compares, it reaches the admin UI. The string
form (`dataSource: "analytics"`) still works; the handle is the one a rename
follows and jump-to-definition lands on.

In a function, the same handles reach the resource:

```ts
import { defineFunction } from "@rebasepro/server/functions";
import { analytics, media } from "../../config/resources";

export default defineFunction((app, { rebase }) => {
    app.post("/report", async (c) => {
        const rows = await rebase.sql("select count(*) from page_views", { database: analytics });
        const file = new File([JSON.stringify(rows)], "report.json", { type: "application/json" });
        await rebase.bucket(media).putObject({ key: "report.json", file });
        return c.json({ ok: true });
    });
});
```

### Seeing what you declared

<span class="since-badge" data-since="0.18">Since 0.18</span>

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

Each entry also records **who uses it** — `collection:page_views` on a
database, `property:posts.cover` on a bucket, `function:report` on whatever
the function imports from `resources.ts`. That is the map a console needs to
answer "what breaks if I remove this".

`rebase status` goes one step further: for every declaration it says whether
the environment binds it, using the same resolvers boot uses, so it cannot
reassure you about a deployment that is about to refuse to start.

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
DB_POOL_MAX__ANALYTICS=5
REBASE_DRIVER__ANALYTICS=@rebasepro/server-postgres
```

The driver is chosen from the declared `engine` (`postgres` and `mongodb` are
known), and `REBASE_DRIVER__<KEY>` overrides it for anything else.
`REBASE_DB_POOL_MAX` is a process-wide ceiling, not a per-source binding, so it
takes no suffix.

In development you set none of this: `rebase dev` serves every declared
database from its managed Postgres — a second instance for `analytics`, started
on demand — and exports `DATABASE_URL__ANALYTICS` itself. A variable you set by
hand is never overridden.

Tables and row-level-security policies are provisioned **per source**: a
collection routed to `analytics` gets its table, and its policies, in the
analytics database.

### Storage

```bash
S3_BUCKET__MEDIA=my-media-bucket
S3_REGION__MEDIA=eu-central-1
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

The engine comes from the declaration, so there is no `STORAGE_TYPE` to set.

### Many buckets on one account

Every variable is read per key, which is right for the bucket name and wrong for
the credentials — fifteen buckets on one MinIO install would mean fifteen copies
of the same access key. Name an `account` and the provider-level variables are
read once:

```ts
export const media   = bucket("media",   { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=project-media       # per bucket, never shared
S3_BUCKET__AVATARS=project-avatars
S3_ACCESS_KEY_ID__MINIO=…            # read once, by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

The account form covers the variables that describe the *provider*:
`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
`S3_FORCE_PATH_STYLE`, `GCS_PROJECT_ID` and `GCS_KEY_FILENAME`. The bucket name
is not one of them and never falls back — if it did, two buckets on one account
would silently become one.

A per-bucket value still wins where you set one, so a single source can be moved
to another provider without breaking the others off their shared account. There
is deliberately no fallback to the unsuffixed variable: that one belongs to the
default source, and letting a named bucket inherit it would mean a mistyped key
signs with another source's credentials.

## Topics and queues

A topic is delivered through the durable job queue: publishing writes **one row
per subscription**, so each subscriber retries on its own schedule and a broken
one neither blocks the others nor makes them run again.

```ts
await signups.publish({ userId });
```

A queue is the other shape of background work: a work list with **one
handler**, where the caller holds the job's id. Queues are new
<span class="since-badge" data-since="0.18">Since 0.18</span> — topics shipped in 0.17.

```ts
export const thumbnails = queue<{ key: string }>("thumbnails");
thumbnails.handler(async ({ key }, { attempt }) => { /* … */ });

const { id } = await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
```

Both are **at-least-once**. A worker that dies holding a job releases it and
the next one starts the handler from the top, so a handler must tolerate seeing
an event twice. Publishing or enqueueing inside a transaction that rolls back
never happened — it is a row insert.

Declaring either turns the job queue on by itself, on every boot path — a
project on the managed runtime, which has no entrypoint to pass `jobs.tasks`
through, gets its handlers this way. Publishing to a topic nothing declares, or
enqueueing on a queue with no handler, throws rather than writing rows no
worker handles.

## Crons and functions

Both are files — `backend/crons/<name>.ts`, `backend/functions/<name>.ts` —
and both enter the graph under the name of the file, which is also the id the
scheduler runs a cron as and the path a function mounts at. Neither binds from
the environment; they are in the graph so a host knows a project's schedules
before it runs anything.

```ts
export default defineCron({
    name: "Nightly cleanup",
    schedule: "0 3 * * *",
    timezone: "Europe/Madrid",
    async handler({ rebase }) { /* … */ }
});
```

Without `timezone` the schedule is read in the host's own zone — UTC in nearly
every container, yours on a laptop — so `0 3 * * *` means a different hour
either side of a deploy. An unknown zone is refused when the job loads.

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

In development, a declared bucket nothing binds is a local directory —
`uploads__media` beside the default `uploads` — whatever engine it declares, so
`bucket("media", { engine: "s3" })` plus `rebase dev` is enough to upload a
file. Boot says which engine the directory is standing in for, and `rebase
status` shows it in yellow beside the tick. That never happens in production,
or on the managed runtime: a bucket invented there would write uploads to a
container filesystem that vanishes on the next rollout, so an unbound bucket
stays unbound and answers 501.

## Related

- [Backend Overview](/docs/backend/) — `dataSources` and where the declaration lives
- [Storage Configuration](/docs/backend/storage/) — the same shape for buckets
- [Environment & Configuration](/docs/getting-started/configuration/) — the `__SUFFIX` convention that binds a source to its variables
