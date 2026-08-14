# Storage Sources (several buckets, one declaration)

A project is not limited to one bucket. Files route to a **storage source** — a
named place they live — the same way collections route to a data source. See
[data-sources.md](data-sources.md), which this mirrors deliberately.

## Four concerns, four homes

The thing that used to make storage confusing was not complexity; it was that
the same fact was stated in several places and nothing said which one won.

| Concern | Where it lives | Notes |
|---|---|---|
| **Topology** — which buckets exist | `rebase.json` → `storage` | Committed. Read by the platform *before* any build |
| **Credentials** — how to reach each | Environment, `<BASE>__<KEY>` | Never committed. The default source takes no suffix |
| **Access model** — who may touch what | `storageAuthorize` in config code | A function; no environment variable can express it |
| **Cloud convenience** | The console's storage settings | Rendered into the same variables; the environment still wins |

## Declaring sources

```jsonc
// rebase.json
{
  "rebase": "^1",
  "storage": {
    "(default)": { "engine": "s3" },
    "media":     { "engine": "s3",  "label": "Media" },
    "avatars":   { "engine": "firebase", "transport": "direct" }
  },
  "apps": { /* … */ }
}
```

Omit the block entirely for a single bucket — the overwhelmingly common project,
which must not be required to say so.

`engine` is `s3`, `gcs`, `local`, or a custom id. `transport` is how the
*frontend* reaches it: `server` (default, proxied through `/api/storage`) or
`direct` (a provider SDK talks to the bucket and the backend is not in the upload
path). `label` is what the console and admin UI show.

**Why `rebase.json` and not code.** It is the one artifact a host can read
before running a build. A managed bundle records the resolved list in its
`manifest.json`; a custom runtime reads the same file out of the image it already
ships. Both end at the same list, so the console cannot describe a topology the
tenant does not have. Config code may still `export const storageSources` to add
sources `rebase.json` does not mention — but it may not contradict it.

## Configuring them

Each source reads the same variable names carrying its own suffix. The default
source takes no suffix at all, which is why every project configured before
sources existed keeps working untouched.

```bash
# (default)
STORAGE_TYPE=s3
S3_BUCKET=app-uploads
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…

# media
STORAGE_TYPE__MEDIA=s3
S3_BUCKET__MEDIA=app-media
S3_ACCESS_KEY_ID__MEDIA=…
S3_SECRET_ACCESS_KEY__MEDIA=…
```

The suffix is derived mechanically from the key: uppercased, non-alphanumerics
collapsed to underscores, behind a double underscore (`media-cdn` →
`__MEDIA_CDN`). It is a double underscore because a single one collides with real
variable names — `S3_BUCKET_NAME` would otherwise parse as bucket `name`.

Two keys that collapse onto the same suffix are refused at build time rather than
silently reading each other's credentials.

## Properties opt in by key

```ts
{
  name: "Cover",
  dataType: "string",
  storage: { storageSource: "media", acceptedFiles: ["image/*"] }
}
```

Omitting `storageSource` means `(default)`.

## Declared is not configured

A source declared in `rebase.json` with nothing set for it in the environment is
**skipped**, not fatal. Requests routed to it answer
`501 STORAGE_SOURCE_NOT_CONFIGURED` — distinct from the `STORAGE_NOT_CONFIGURED`
the whole `/storage` router answers when the deployment has no storage at all,
because "this one bucket is not wired up" and "file storage is off" have
different fixes.

A `storageId` that was never declared at all is a `400 UNKNOWN_STORAGE_SOURCE`
naming the sources that do exist; it is a caller mistake, usually a typo.

Neither case falls back to the default source. It used to, silently, and that
was worse than an error in both directions: a write landed in a bucket nobody
named, and a read served bytes from a bucket the `storageAuthorize` hook was
never asked about — the hook having been asked about the source in the request.
Because a second source exists precisely to hold the same keys, the fallback
returned plausible bytes rather than anything that looked wrong.

This matters: declaring a bucket usually happens well before anyone attaches
storage to it. Treating that as a boot error would crash-loop the backend until
someone configured it — the unreadable failure the declaration exists to prevent.
The console shows the source as *declared, not configured*, and the build log
names it.

A source the *environment* configures **wrongly** is a different thing and is
refused: `STORAGE_TYPE__MEDIA=s3` with no bucket, or a bucket with no
credentials, means someone set this and got it wrong. A bucket with no
credentials cannot work at all — the S3 controller passes explicit empty
credentials to the AWS SDK, which suppresses the SDK's own credential chain, so
it never quietly falls back to an instance profile.

## On Rebase Cloud

The console keeps one row per (project, source) and renders it into that
source's variables at deploy time.

**Environment variables win.** Setting `S3_*` by hand was the only way to get
working storage before the console's settings were ever read, so some projects
depend on it; letting the row override them would silently repoint a live app at
a different bucket on its next deploy. The console says so explicitly now, per
source, and names the variables responsible — it used to show a form that was
simply not in effect.

Platform-managed storage creates one bucket per source and **one service account
per project**, so a project with four buckets consumes one of GCP's ~100
service-account slots rather than four. Isolation between tenants is what that
account buys, and it is unchanged.

## Local development

`rebase dev` uses local disk by default. In **production** a `local` backend is
dropped rather than honoured: a container filesystem is erased on every restart,
so uploads would succeed into a disk about to be wiped. Set
`FORCE_LOCAL_STORAGE=true` only where a durable volume really is mounted at
`STORAGE_PATH`.

## Access control

Storage is **not** under row-level security and its keys share one flat
namespace, so `storageAuthorize` is the access model — one hook governs every
source. The server refuses to boot in production without one, unless
`storagePublicRead` or `storageInsecureAllowAnyAuthenticated` states the intent
deliberately. On Rebase Cloud the deploy is rejected before the pod starts, with
the reason.

## Where the code lives

| Piece | File |
|---|---|
| Naming rule, merge rule | `packages/types/src/types/storage_source.ts` |
| Resolving env → controller configs | `packages/server/src/boot/sources.ts` |
| Reading `rebase.json` at runtime | `loadDeclaredStorageSources`, same file |
| Registry and routing | `packages/server/src/storage/storage-registry.ts` |
| Manifest recording | `packages/cli/src/bundle.ts` |
| Cloud: row → environment | `saas/backend/src/utils/project-storage.ts` |
| Cloud: what the tenant will do | `saas/backend/src/utils/tenant-storage.ts` |

The last two and the runtime resolver are held to one behaviour by
`saas/backend/src/utils/storage-reader-conformance.test.ts`, which runs one table
of environment fixtures through both readers. Storage previously had *three*
independent implementations of "read `STORAGE_TYPE` and the `S3_*` variables";
they agreed by coincidence and nothing checked it.
