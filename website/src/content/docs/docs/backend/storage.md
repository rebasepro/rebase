---
title: Storage Configuration
sidebar_label: Storage Configuration
description: Configure local filesystem, S3-compatible, or GCS/Firebase Storage backends for file uploads, images, and media.
---

## Overview

Rebase supports three storage backends:

- **Local filesystem** — Files stored on disk (great for development)
- **S3-compatible** — AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces
- **Google Cloud Storage / Firebase Storage** — Native GCS support via `@google-cloud/storage`

## Configuration

:::note[Where this goes]
**Managed runtime** — the `STORAGE_*` variables in `.env` (`STORAGE_TYPE`, `STORAGE_BUCKET` or `S3_BUCKET` / `GCS_BUCKET`, `STORAGE_PATH`, `STORAGE_PUBLIC_READ`, … — suffix any of them `__<KEY>` for a named source), plus a `bucket("<key>")` declaration in `config/resources.ts` for every bucket beyond the default, and `export const storageAuthorize` from `config/index.ts`. `storageAuthorize` has no environment form on purpose: no variable can express "this user may read this key".

**Ejected** — the `storage` block on `initializeRebaseBackend({ … })`. `storagePolicies` and `storageTriggers` are ejected-only.

The full map is in [Backend Overview](/docs/backend/#where-each-option-lives).
:::

Storage is configured in the `storage` block of `initializeRebaseBackend`:

### Local Storage

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "local",
        basePath: "./uploads"   // Directory for file storage
    }
});
```

### S3 Storage

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "s3",
        bucket: env.S3_BUCKET!,
        region: env.S3_REGION || "auto",
        accessKeyId: env.S3_ACCESS_KEY_ID || "",
        secretAccessKey: env.S3_SECRET_ACCESS_KEY || "",
        endpoint: env.S3_ENDPOINT,          // For MinIO, R2, etc.
        forcePathStyle: env.S3_FORCE_PATH_STYLE  // Required for MinIO
    }
});
```

### GCS / Firebase Storage

```typescript no-verify
const backend = await initializeRebaseBackend({
    // ...
    storage: {
        type: "gcs",
        bucket: env.GCS_BUCKET!,
        projectId: env.GCS_PROJECT_ID,
    }
});
```

On GCP (Cloud Run, GCE, GKE), the default service account credentials are used automatically. Outside GCP, set the `GOOGLE_APPLICATION_CREDENTIALS` environment variable to the path of your service account key file.

### Multiple Storage Backends

You can configure multiple named backends and route different fields to different storage:

```typescript
storage: {
    "(default)": { type: "local", basePath: "./uploads" },
    "media": { type: "s3", bucket: "media-bucket", region: "us-east-1", ... }
}
```

Then in your collection properties, reference a specific backend:

```typescript
image: {
    type: "string",
    name: "Image",
    storage: {
        storagePath: "products",
        storageSource: "media"  // Routes to the "media" S3 backend
    }
}
```

## Storage Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/storage/upload` | Direct file upload |
| `POST` | `/api/storage/upload?storageId=<key>` | Upload to a specific named backend |
| `GET` | `/api/storage/file/*` | Retrieve a file — everything after `/file/` is the object key |
| `GET` | `/api/storage/file/*?storageId=<key>` | Retrieve a file from a specific backend |
| `GET` | `/api/storage/metadata/*` | Size, content type and last modification of one object, without its bytes |
| `DELETE` | `/api/storage/file/*` | Delete a file |
| `GET` | `/api/storage/list` | List objects under a prefix (`prefix`, `bucket`, `maxResults`, `pageToken`, `storageId`). A `maxResults` below 1, or a `pageToken` the source never issued, is `400 INVALID_LIST_OPTIONS` |
| `POST` | `/api/storage/folder` | Create an empty folder marker |
| `GET` | `/api/storage/sources` | The storage sources this backend serves, by key |
| `OPTIONS` | `/api/storage/tus` | Query supported TUS protocol capabilities |
| `POST` | `/api/storage/tus` | Initiate a resumable TUS upload session |
| `HEAD` | `/api/storage/tus/:id` | Check upload progress (byte offset) |
| `PATCH` | `/api/storage/tus/:id` | Append data chunk to temporary file |
| `DELETE` | `/api/storage/tus/:id` | Terminate/abort TUS upload session |

**What they answer.** One envelope, the same one `/api/data` uses: the payload
is under `data`, and a failure is `{ "error": { message, code, requestId } }`
with the codes on the [error reference](/docs/backend/errors/). `/api/storage/file/*`
is the exception, because its payload is the file — it answers the bytes, with
`Content-Type`, `Content-Length` and the caching headers.

```json
// GET /api/storage/list?prefix=products/images/
{ "data": { "items": [ { "bucket": "default", "fullPath": "products/images/a.jpg", "name": "a.jpg" } ], "prefixes": [] } }
```

`POST /api/storage/upload` answers `201` with the `{ key, bucket, storageUrl }`
of the stored object under `data`; `GET /api/storage/metadata/*` the object's
metadata and, for a private object, the short-lived `token`;
`GET /api/storage/sources` the array of configured sources, with
`configured: true`. On a deployment with no storage at all, it answers
`200 {"data": [], "configured": false}`, while every other route answers
`501 STORAGE_NOT_CONFIGURED`. `GET /api/auth/config` reports the same
fact as `storage: false`, so a client can skip asking.
`DELETE /api/storage/file/*` and `POST /api/storage/folder` carry only a
`message`, since there is nothing to return.

On S3 and GCS, a `bucket` has to be one the source serves, on writes as on
reads: an upload, a `POST /api/storage/folder` or a TUS upload naming any other
bucket answers `404 UNKNOWN_STORAGE_SOURCE`, as the listing does. Local storage
still creates a bucket on its first write.

**How a file read is authorized.** The read routes — `/api/storage/file/*` and
`/api/storage/metadata/*` — take the short-lived signed token that
[`getSignedUrl()`](/docs/sdk/storage) mints, passed as `?token=<token>` or as a
`Bearer`. An ordinary access JWT is **refused** on `/file/*` with `401
Unauthorized: Access JWT not allowed on file routes`: the token that works on
every other route does not work there, on purpose, because a file URL is
something you hand to a browser, a CDN or an `<img>` tag. Every other row above
takes the access JWT as usual.

## On-the-Fly Image Transformations

Rebase includes a built-in image processing pipeline powered by **Sharp**. When serving image assets from storage, you can apply dynamic operations using query parameters:

```bash
# Serve image scaled to 300px width in webp format
GET /api/storage/file/products/laptop.jpg?width=300&format=webp
```

### Supported Parameters

- `width`, `height`: Resize bounds, `1`–`4096` (the image is never enlarged).
- `quality`: `1`–`100`.
- `format`: Converts the image format. Supported formats: `webp`, `jpeg`, `png`, `avif`.
- `fit`: `cover`, `contain`, `fill`, `inside` or `outside`.

A parameter outside these bounds is a **400**, not a silently clamped value —
`?width=99999` used to return a 4096px image and `?format=tiff` a webp one, and
neither said so.

### Performance & LRU Caching

Transforming is CPU- and memory-heavy, and on a public object the endpoint is
reachable anonymously, so the work is bounded rather than merely cached:
- **Capacity**: an LRU capped at **500 entries** globally, keyed by storage
  source, bucket and canonical key.
- **TTL (Time to Live)**: Cached variants expire after **1 hour**.
- Concurrent requests for the same uncached variant produce **one** transform,
  not one each.
- A small number of transforms run at once; beyond a bounded backlog the server
  answers **503 `TRANSFORM_OVERLOADED`** rather than accepting work it will not
  get to.

That cache lives in the process, which means it is not shared between instances
and does not survive a restart. Two replicas each compute every variant, and a
deploy throws all of it away.

### Renditions that survive a restart

`storageRenditionCache` writes each derived image back to the same bucket as its
source, so the work is done once for the whole deployment rather than once per
instance per release:

```ts
storageRenditionCache: { enabled: true }
```

or `STORAGE_RENDITION_CACHE=true` for a bundle deployment. Renditions are stored
under the reserved prefix `_rebase/renditions/`, keyed by the source object's
version — so replacing an image serves the new one immediately.

Three things to know before turning it on:

- **A read now writes.** Each new variant costs one `PUT` in your bucket. It is
  off by default for that reason.
- **A failed write is not a failed request.** Read-only credentials, or a bucket
  policy that refuses the prefix, degrade to the in-process cache; the image is
  still served and the reason is logged once.
- **Superseded renditions are not collected.** Replacing a source object
  abandons its old renditions. Set a lifecycle rule on `_rebase/renditions/`
  — that prefix is fixed, not configurable, precisely so a rule can name it.

The prefix is not addressable from the API. Reading or writing it directly
answers **400 `INVALID_STORAGE_KEY`**: every access rule in the product —
`storageAuthorize` and the declarative policies alike — is written against the
*source* key, and a rendition served under its own path would answer a question
nobody asked.

### What gets served

The stored content type is whatever the uploader declared — nothing sniffs the
bytes — so `/api/storage/file/*` will only render a **narrow allowlist** inline:
images, video, audio, `application/pdf` and `text/plain`. Anything else,
`text/html` included, is served as `application/octet-stream` with
`Content-Disposition: attachment`, and every response carries
`X-Content-Type-Options: nosniff`. Storage is not a web host: an uploaded page
rendered on the API origin can read that origin's cookies and call its
endpoints.

An SVG is an image that is also a document, and can carry `<script>`. It is
served as `image/svg+xml` — so it renders in an `<img>` and in the admin
panel's thumbnails — with
`Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`
on every response, transformed URLs and download-token URLs included. Opened
directly, it renders with scripts disabled and an opaque origin, so it cannot
reach the API's cookies or endpoints.

## TUS Resumable Upload Protocol

For uploading large files or handling unstable network conditions, Rebase implements the **TUS v1.0.0** open protocol including the `Creation` and `Termination` extensions.

### How large a file may be

Each storage source accepts files up to its own limit: **50 MB** unless
`STORAGE_MAX_FILE_SIZE` (bytes, suffixed `__<KEY>` for a named source) or the
source's `maxFileSize` says otherwise. Every door holds a file to the same
number. `POST /api/storage/upload` answers `413 PAYLOAD_TOO_LARGE` above it; a
resumable upload is refused at creation, before its first chunk; and
`OPTIONS /api/storage/tus` advertises it as `Tus-Max-Size` — for the source
named by `?storageId=`, the default one otherwise.

for `STORAGE_MAX_FILE_SIZE`: on 0.23 only the source's `maxFileSize` sets
the limit, and the variable is not read.

```bash
STORAGE_MAX_FILE_SIZE=209715200          # (default): 200 MB
STORAGE_MAX_FILE_SIZE__MEDIA=1073741824  # media: 1 GB
```

A completed file is held in the server's memory while it is written to the
store, on every upload path, so size the limit to the memory the server has.

```
Client                                                   Rebase Server
  │                                                           │
  │─── POST /api/storage/tus (Upload-Length: 50000000) ──────>│ (Generates session ID)
  │<── 201 Created (Location: /api/storage/tus/uuid-abc) ────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 0) ───>│ (Appends chunk via open/write)
  │<── 204 No Content (Upload-Offset: 1500000) ───────────────│
  │                                                           │
  │─── PATCH /api/storage/tus/uuid-abc (Upload-Offset: 1.5M) ─>│ (Upload finishes)
  │<── 204 No Content (Upload-Offset: 50000000) ──────────────│ (Copies to storage, unlinks temp)
```

### Upload Lifecycle Mechanics

1. **Session Initialisation (`POST`)**: The client sends the total file size in the `Upload-Length` header and base64 metadata via `Upload-Metadata`. The server creates an empty placeholder file under a hidden temporary directory `.tus-uploads/` and returns the upload URL.
2. **Progress Inquiries (`HEAD`)**: If an upload is interrupted, the client queries the upload URL using a `HEAD` request. The server returns the current byte position in the `Upload-Offset` header.
3. **Data Appending (`PATCH`)**: The client resumes sending binary data starting at the returned offset with `Content-Type: application/offset+octet-stream`. The server writes each chunk to the temporary file at the byte offset the request declares, which must be the offset the server holds (`409` otherwise). One chunk is received at a time: a `PATCH` that arrives while another for the same upload is still being received — typically a client re-sending a chunk that stalled — is answered `423 UPLOAD_LOCKED`, and the client resumes from the offset `HEAD` reports.
4. **Finalisation**: When the accumulated `Upload-Offset` matches the declared `Upload-Length`, Rebase reads the completed temporary file, wraps it as a standard JavaScript `File` object, and saves it to the configured storage backend (local disk or S3). The temporary file is then deleted.
5. **Periodic Sweep**: A background cleaner runs every **60 seconds** to delete orphaned, incomplete temporary uploads that have exceeded the **24-hour** retention threshold.

## Environment Variables

| Variable | Description |
|----------|-------------|
| `STORAGE_TYPE` | `"local"`, `"s3"`, or `"gcs"` |
| `STORAGE_PATH` | Local storage directory (default: `./uploads`) |
| `S3_BUCKET` | S3 bucket name |
| `S3_REGION` | AWS region (default: `"auto"`) |
| `S3_ACCESS_KEY_ID` | AWS access key |
| `S3_SECRET_ACCESS_KEY` | AWS secret key |
| `S3_ENDPOINT` | Custom S3 endpoint (for MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | Use path-style URLs (required for MinIO) |
| `GCS_BUCKET` | Google Cloud Storage bucket name |
| `GCS_PROJECT_ID` | GCP project ID for GCS |
| `GCS_KEY_FILENAME` | Path to a GCP service account key file (omit on GKE — Workload Identity/ADC supplies credentials) |
| `GOOGLE_APPLICATION_CREDENTIALS` | Standard ADC variable, read by the Google SDK itself (not needed on GCP with default credentials) |
| `STORAGE_DOWNLOAD_TOKEN_TTL` | How long a private file's download URL works, in seconds — the lifetime of the token `/api/storage/metadata/*` mints (default `300`, at most `604800`, a week). Raise it for private video and audio, which keep requesting ranges after the page renders. The env spelling of `storageDownloadTokenTtl` |
| `STORAGE_MAX_FILE_SIZE` | Largest file the source accepts, in bytes (default `52428800`, 50 MB). Suffix `__<KEY>` for a named source. A value that is not a whole number of bytes refuses the boot. See [How large a file may be](#how-large-a-file-may-be) |
| `FORCE_LOCAL_STORAGE` | Allow `STORAGE_TYPE=local` in production — see below |
| `STORAGE_PUBLIC_READ` | Serve stored objects to unauthenticated readers. The env spelling of `storagePublicRead`, and one of the three ways to satisfy the [production boot guard](#per-object-authorization). |
| `STORAGE_ALLOW_ANY_AUTHENTICATED` | Opt out of the boot guard, restoring the behaviour where any signed-in user may read, overwrite, delete or list any key. The env spelling of `storageInsecureAllowAnyAuthenticated`. Only defensible when every signed-in user is trusted with every file. |

## Several Buckets

A project can have more than one bucket. Declare each one in `config/resources.ts`
— the one place the platform, the runtime and the console all read:

```ts
import { bucket } from "@rebasepro/types";

export const uploads = bucket({ engine: "s3" });    // the default one
export const media = bucket("media", { engine: "s3", label: "Media" });
```

Then run `rebase resources --write`, which regenerates `rebase.resources.json`
so a host can read your topology without running a build. See
[Multiple Sources](/docs/backend/multiple-sources) for databases, buckets and
topics together.

Each source is configured from the **same variable names carrying its own
suffix**. The default source takes no suffix, so a single-bucket project keeps
using the plain names above and needs to declare nothing at all:

```bash
S3_BUCKET=app-uploads             # (default)
S3_BUCKET__MEDIA=app-media        # media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

The suffix is derived from the key: uppercased, non-alphanumerics collapsed to
underscores, behind a **double** underscore (`media-cdn` → `__MEDIA_CDN`). A
single underscore would collide with real variable names — `S3_BUCKET_NAME`
would parse as bucket `name`.

Route a property to a source with `storageSource`:

```ts
{
    name: "Cover",
    dataType: "string",
    storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

A source you declare but never configure is **skipped**, not fatal: uploads
routed to it answer `501 STORAGE_SOURCE_NOT_CONFIGURED`. Declaring a bucket usually
happens before anyone attaches storage to it, and a boot error there would
crash-loop the backend until someone did. A source the environment configures
*wrongly* — a type with no bucket, or a bucket with no credentials — is refused
at boot, because that is a mistake rather than an absence.

### Buckets that share one account

Credentials usually describe the **provider**, not the bucket. Fifteen buckets on
one MinIO install would otherwise mean fifteen copies of the same access key, and
a rotation would be fifteen paired edits. Name an account instead:

```ts
export const media = bucket("media", { engine: "s3", account: "minio" });
export const avatars = bucket("avatars", { engine: "s3", account: "minio" });
```

```bash
S3_BUCKET__MEDIA=b-media          # per bucket, always
S3_BUCKET__AVATARS=b-avatars
S3_ACCESS_KEY_ID__MINIO=…         # shared by both
S3_SECRET_ACCESS_KEY__MINIO=…
S3_ENDPOINT__MINIO=https://minio.internal
```

Only the account-scoped variables fall back — `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`, `S3_FORCE_PATH_STYLE`, and
the GCS `GCS_PROJECT_ID` / `GCS_KEY_FILENAME` pair. The bucket name never does:
it is what distinguishes one source from another. A per-bucket value still wins,
so one source can move providers without breaking the rest.

## Frontend Storage Sources

When using multiple storage backends, pass `storageSources` to the `<Rebase>` provider so the frontend knows how to route uploads directly:

```tsx
import { Rebase } from "@rebasepro/app";

<Rebase
    apiUrl="https://api.example.com"
    storageSources={[
        // `engine` names the provider, `transport` says who talks to it:
        // "server" proxies through the Rebase backend, "direct" goes
        // client-to-provider (and needs a `source` implementation).
        { key: "media", engine: "s3", transport: "server", label: "Media CDN" },
        { key: "firebase", engine: "firebase", transport: "server", label: "Firebase Storage" },
    ]}
>
    {() => <MyApp />}
</Rebase>
```

Each source's `key` must match a backend key registered in the server's `storage` map. The `StorageSourcesContext` React context resolves the active source for each upload field.

## Caching and CDNs

Every object is proxied through the server, with an `ETag` for cheap
revalidation, a `Cache-Control` that depends on who may read it, and byte ranges
for seeking in audio and video. [Storage caching and CDNs](/docs/backend/storage-caching/)
has the headers, and what to configure on a CDN in front.

## Production Tips

:::caution
**In production, `type: "local"` disables file storage instead of using it.** On an ephemeral platform (Cloud Run, Heroku, a Kubernetes pod) the filesystem is wiped on every deploy, restart and eviction — so uploads would succeed, read back fine, and be gone at the next rollout, with no error at any point.

So the local default is not registered, and a request to `/api/storage/*` that names no storage source answers **`501 STORAGE_NOT_CONFIGURED`**, naming the sources that are served. A named source that is configured, such as `bucket("media", { engine: "s3" })`, keeps serving. Uploads fail loudly and recoverably; the rest of the app keeps serving. File storage is opt-in in production: it exists once a bucket does.

Set `STORAGE_TYPE=s3` or `gcs`. If a **durable volume** really is mounted at `STORAGE_PATH`, set `FORCE_LOCAL_STORAGE=true` to say so explicitly.
:::

- Mount a **persistent volume** if using local storage on Docker/Kubernetes, and set `FORCE_LOCAL_STORAGE=true`
- Use **S3** or compatible (R2, MinIO), or **GCS**, for production deployments
- Configure a **CDN** (CloudFront, Cloudflare) in front for performance — see [Putting a CDN in front](/docs/backend/storage-caching/#putting-a-cdn-in-front)
- **Any app with storage in production must declare an access model** — see below.
  Not just multi-tenant ones: the server *refuses to boot* without one.

## Per-Object Authorization

### Policies

The declarative form. A list of path patterns, read without running anything:

```ts
storagePolicies: [
    { path: "public/**", operations: ["read"], allow: "public" },
    { path: "users/:uid/**", allow: ({ params, user }) => user?.uid === params.uid }
]
```

**A key matched by no policy is refused.** Every widening is an explicit line,
and a mistake denies rather than grants.

Patterns match **by segment, never by substring** — `public/**` does not match
`publicity/secret.png`:

| Pattern | Matches |
|---|---|
| `avatars/logo.png` | that key exactly |
| `users/*/avatar.png` | exactly one segment where `*` is |
| `users/:uid/**` | one captured segment, then the rest — including nothing |

`**` is only legal as the final segment. `:name` captures one segment and never
spans a `/`; captures arrive as `params` on the predicate.

`allow` is `"public"` (anyone), `"authenticated"` (any caller with a uid), or a
predicate receiving the captured params, the user, the operation and the bucket.
`operations` defaults to all four — `read`, `write`, `delete`, `list`.

Policies satisfy the production boot guard on their own, and a malformed pattern
fails the boot rather than the first upload.

### The hook


`requireAuth` and `publicRead` are *global* switches: they decide whether a caller must be signed in, not what that caller may touch. Without an authorization hook, **any authenticated user can read any key they can name** — the only thing separating two tenants' files is key unguessability, which is not an access-control model. Worse, they can `GET /storage/list?prefix=` first, so the keys do not even have to be guessed.

:::caution[Storage will not boot in production without one]
Collections are protected by row-level security; storage is not. There is no
per-object equivalent in the bucket, so this hook *is* the model — and
`initializeRebaseBackend` **throws at startup** under `NODE_ENV=production` when
storage is configured and none of these is set:

- `storageAuthorize` — a hook, per object. Recommended.
- `storagePublicRead: true` — the bucket genuinely is a public read-only CDN.
- `storageInsecureAllowAnyAuthenticated: true` — a single-tenant app where every
  signed-in user is trusted with every file. Named to be read twice.

In development it logs a warning instead, so a project can be wrong about this and
work fine locally right up until it is deployed. A scaffolded project ships a hook in
`config/storage.ts` already — read it before you replace it, and note that it models
a CMS's *shared content library*, which is not the same shape as per-user files.
:::

`storageAuthorize` is the storage analogue of a collection's security rules, and runs after authentication on every storage route:

```typescript no-verify
await initializeRebaseBackend({
    storage: { type: "s3", bucket: "app-files", /* ... */ },
    storageAuthorize: async ({ key, bucket, operation, user }) => {
        if (!user) return false;
        // Keys are laid out as `{teamId}/{docId}/...`
        const [teamId] = key.split("/");
        return isTeamMember(user.uid, teamId);
    }
});
```

| Field | Description |
|-------|-------------|
| `key` | Object key, bucket prefix stripped and traversal sanitized |
| `bucket` | Resolved bucket (`"default"` when unspecified) |
| `operation` | `"read"`, `"write"`, `"delete"` or `"list"` |
| `user` | `{ uid, email?, roles? }`, or `null` where the route allows anonymous access |
| `storageId` | The named backend, when the request targeted one — its canonical key (`storageId=%20media` is `"media"`). Absent for the default source, however the request named it (no parameter, empty, or `(default)`) |
| `data` | Trusted, **RLS-bypassing** read access — `data.collection(slug).find(query)` / `.findById(id)`. Ownership lives in a row, not in a key prefix, so the hook needs a reader to answer "who owns this object?". It bypasses row-level security deliberately: this hook *is* the authorization decision, and making it through a reader already narrowed by the caller's own permissions would be circular. Read-only by design. |

Return `false` to deny with a **403**. Throwing also denies — an ownership lookup that fails does not fall open.

Worth knowing:

- **The metadata route is where read access is really decided.** It mints the short-lived path-scoped download token that the file route trusts, so the hook gates it there. Requests already carrying such a token, or hitting a declared public path, skip the hook — the token was minted under it and is valid only for its own path.
- **A path is public when the key it names is.** The `public/` prefix is tested on the canonical key the route serves — after a leading `default/` bucket segment is read off and `//`, `./` and a leading `/` are folded away — never on the URL as written. `/api/storage/file/notes://public/x.txt` names the private key `notes:/public/x.txt`, and the key `default/public/x.txt` (reached as `/api/storage/file/default/default/public/x.txt`) lies in a folder called `default`; neither is public. In a hook, test the `key` you are handed with `isPublicStorageKey` from `@rebasepro/types` — `isPublicStoragePath` reads a client-side path or URL, and reads both of those as public.
- **`list` is gated on the prefix.** Listing is how you discover keys nobody told you about.
- **Resumable (TUS) uploads are gated at create time**, so a denied upload leaves no temp file behind.
- Omitting the hook preserves the previous behaviour, so single-tenant apps are unaffected.

### API keys and tokens

A signed-in person holds every storage scope, so the hook and the policies above
decide for them. An [API key](/docs/backend/api-keys/) also needs the storage
scope for the operation, on the source the request names: `storage:read` for
downloads, metadata and listings, `storage:write` for uploads, folders and every
step of a resumable upload, `storage:delete` for deletes. The target is the
source id, and the default source's is `(default)`: `storage:read:(default)`,
`storage:write:avatars`. Without it the answer is `403 SCOPE_MISSING`. With it,
the hook still runs, as whoever the key acts as.

## Reacting to an upload

Every other write in Rebase can be reacted to — a row has `beforeSave` and
`afterSave`, a schedule has a cron job — and an upload had nothing. Anything an
upload implied had to be done by the client, on a second call, which means it
was not done at all when the client went away in between.

```ts
storageTriggers: [
    {
        path: "uploads/:uid/**",
        events: ["finalize"],
        handler: async ({ key, params, size, user }) => {
            await jobs.enqueue("index-upload", { key, uid: params.uid, size });
        }
    }
]
```

The pattern language is the same as `storagePolicies` — literal segments, `*`
for one segment, `:name` to capture one, `**` for the rest — and a malformed
pattern fails the boot rather than quietly matching nothing.

| Event | When |
| --- | --- |
| `finalize` | after the object is durably written; never for a write that failed |
| `delete` | after the object is gone |

`finalize` fires for the multipart and the resumable (TUS) paths alike — once
per upload, not once per chunk — and a resumable upload reports the user who
*created* it, since that is the principal the authorization checked.

What a handler must not assume:

- **A throwing handler does not fail the request.** The object is already stored
  by the time it runs, so answering the client with an error would say the
  upload failed when it did not, and clients retry uploads. Failures are logged
  and the response is unchanged. If the work must happen, enqueue a job.
- **Handlers are awaited**, in declaration order, before the response is sent —
  firing and forgetting would leave a promise a serverless runtime is free to
  freeze mid-flight. A slow handler is therefore a slow upload, which is the
  other reason to enqueue rather than to work here.
- **Internal writes do not fire triggers.** The image-rendition cache writes
  derived objects straight to the storage controller; a `**` trigger firing on
  those would be firing on its own output.

## Next Steps

- **[Frontend Storage & File Uploads](/docs/frontend/storage)** — File upload fields and hooks
- **[Properties](/docs/collections/properties)** — Storage property configuration
