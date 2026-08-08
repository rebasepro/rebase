# Unit 31 — resumable uploads and image transforms

Scope: `packages/server/src/storage/tus-handler.ts`, `image-transform.ts`, `keys.ts`,
the upload/transform paths of `routes.ts`, and `packages/client/src/storage.ts`.
Read-only. Deliberately does not re-litigate `docs/AUDIT-storage-2026-08-07.md`
(key canonicalization, transform-cache `storageId`, download-token scoping,
streaming/`Range`, cloud metering); this is the upload *mechanics* underneath it.

## Verdict

The key-canonicalization work landed properly — for the key. `TusUpload.key` is
resolved once in `create`, authorized, and read verbatim by `finalize`, and that
invariant holds under reading. But the same request carries three other
caller-controlled routing values — `bucket`, `storageId`, and the content type —
and none of them got the same treatment. `bucket` is the serious one: it is
concatenated into the filesystem path *before* the traversal guard computes what
it is guarding, so the guard checks containment inside a directory the attacker
chose, and `POST /api/storage/upload` with `bucket=../../..` writes outside the
storage root entirely. `storageId` is the TUS-shaped repeat of the bug the last
audit closed: the hook is asked about `?storageId` from the query string and
`finalize` writes to `metadata.storageId` from the header. The content type is
the client's claim from upload to playback, so any deployment using the public
prefix has a stored-XSS delivery endpoint on its API origin.

Beneath the security findings, the resumable path is not production shaped: state
is a `Map` plus a directory nobody ever sweeps, a finalize failure leaks the temp
file *and* the map entry permanently while the client is told 204, PATCHes are
not serialized so the byte count and the file can diverge, and the three
advertised size limits (5 GB, 50 MB, 10 MB) disagree with the smallest one
winning silently. And the whole protocol has no client: nothing in
`packages/client`, `packages/admin`, `docs/` or `website/` mentions it, and
`image-transform.ts` has no test of any kind.

Counts: 1 critical, 3 high, 6 medium, 5 low.

---

## CRITICAL

### C1 — a caller-chosen `bucket` escapes the storage root

`packages/server/src/storage/LocalStorageController.ts:97-104`,
`packages/server/src/storage/routes.ts:313,333`,
`packages/server/src/storage/routes.ts:526,540`,
`packages/server/src/storage/tus-handler.ts:200,215,371`

`getFullPath` is the traversal guard, and it guards the wrong boundary:

```ts
const bucketPath = path.join(this.basePath, bucket ?? DEFAULT_BUCKET);
const resolved = path.resolve(path.join(bucketPath, storagePath));
if (!resolved.startsWith(bucketPath + path.sep) && resolved !== bucketPath) { throw … }
```

`bucketPath` is derived from the caller's `bucket`, so the containment check is
against a directory the caller picked. Verified arithmetic (node, `path` module):
with `basePath = /data/uploads` and `bucket = ../../../../etc`, `bucketPath`
becomes `/etc`, key `passwd` resolves to `/etc/passwd`, and
`"/etc/passwd".startsWith("/etc/")` is **true** — the guard passes.

Nothing validates `bucket` anywhere: `routes.ts:313` takes it straight from the
multipart body, `routes.ts:526` from the `?bucket=` query, `tus-handler.ts:215`
from the base64 `Upload-Metadata`. There is no `canonicalBucket` counterpart to
`canonicalStorageKey` (grep for `validateBucket|sanitizeBucket|canonicalBucket`
returns nothing in the repo). `checkAuthorized` *is* handed the raw bucket
(`routes.ts:326`), but both shipped `storageAuthorize` templates — and the JSDoc
recommending their shape — inspect `key` only, so the hook approves.

**Failure scenario.** As any authenticated user on a local-storage deployment:
`POST /api/storage/upload`, multipart, `bucket=../../../../app/dist`,
`key=index.js`, file body = attacker JS. The key passes canonicalization (no `..`
in it), the hook sees `users/alice/`-shaped nothing and approves on the key,
`putObject` writes `/app/dist/index.js` plus a sibling
`/app/dist/index.js.metadata.json`. Any file the pod user can write is writable.
On the read side, `GET /api/storage/list?bucket=../../../..&prefix=` enumerates
arbitrary directories on the pod (`routes.ts:540` → `listObjects` →
`getFullPath`), which also reaches `.tus-uploads` (see M1).

This is *not* the previous audit's P2 "bucket is write-only" note — that observed
that a non-default bucket is unaddressable on the read routes. The traversal is
a different consequence of the same unvalidated parameter.

**Fix direction.** Validate the bucket at the route boundary the way the key is
validated: an allowlist of names the registry actually knows (plus
`DEFAULT_BUCKET`) is the right shape, since buckets are configuration and not
user data. As defence in depth, make `getFullPath` resolve the bucket *and* check
containment against `this.basePath`, not against `bucketPath` — a guard whose
reference point is attacker-derived is not a guard.

---

## HIGH

### H1 — TUS authorizes one `storageId` and writes to another

`packages/server/src/storage/routes.ts:614` vs
`packages/server/src/storage/tus-handler.ts:338`

The authorize callback the route injects reads the query string:

```ts
await checkAuthorized(c as never, "write", key, bucket, c.req.query("storageId"));
```

`finalize` reads the TUS metadata header:

```ts
const storageId = upload.metadata.storageId;
targetController = storageId ? this.storageRegistry.getOrDefault(storageId) : …
```

Two sources for one decision — precisely the shape the last audit fixed for
`key` ("two call sites computing it separately is how the check and the write
came apart originally", per the comment at `routes.ts:607-611`), left standing on
the axis beside it.

**Failure scenario.** A deployment with two sources: `default` (per-user prefixes
enforced by the hook) and `assets` (the hook widens writes for a marketing
bucket, or narrows them to an admin role). Create the upload with **no**
`?storageId` in the URL and `storageId <base64 "assets">` in `Upload-Metadata`.
The hook is asked "may alice write `users/alice/x` on the default source?" —
yes — and `finalize` writes it to `assets`. The reverse direction is worse: any
source whose hook branch is more permissive can be named in the query to obtain
approval, and the private source named in the header to receive the bytes. An
unknown id compounds it: `getOrDefault` logs and falls back to the default source
(previous audit, P1).

**Fix direction.** Resolve `storageId` once in `create()`, store it on
`TusUpload` next to `key`, pass *that* to `authorizeUpload`, and have `finalize`
read only the stored field. Same for `bucket` (`create` shows the hook
`metadata.bucket || "default"` while `finalize` passes
`metadata.bucket || undefined` — equivalent today only because the controller's
default happens to be the same string).

### H2 — the served `Content-Type` is the uploader's claim, from upload to render

`packages/server/src/storage/LocalStorageController.ts:147`,
`packages/server/src/storage/routes.ts:383-391,408`,
`packages/server/src/storage/tus-handler.ts:360`,
`packages/server/src/storage/routes.ts:346-349`

Nothing sniffs. `putObject` writes `contentType: file.type` — the browser's or
the API caller's declared multipart type — into the `.metadata.json` sidecar; the
TUS path takes `upload.metadata.contentType || upload.metadata.filetype` from the
header (`tus-handler.ts:360`); `/file/*` reads the sidecar back and echoes it
(`routes.ts:388,408`). `allowedMimeTypes` (`LocalStorageController.ts:115-119`)
compares against the same client string, so it is advisory rather than a control,
and it is unset by default.

The response carries `Cross-Origin-Resource-Policy: cross-origin`
(`routes.ts:349`), no `Content-Disposition`, and no CSP.
`X-Content-Type-Options: nosniff` is installed only by the bundle runtime
(`boot/boot.ts:166`) and the eject template — `initializeBackend` installs no
`secureHeaders` — and nosniff does not help when the declared type is literally
`text/html`. Objects under the public prefix are served token-less at a permanent
URL (`routes.ts:476`, `auth/middleware.ts:446-461`), which is a stable hosted
page.

**Failure scenario.** Upload `public/x.html` declaring `text/html`. Visit
`https://api.example.com/api/storage/file/public/x.html`: attacker JS executes on
the API origin. Where the deployment enabled `cookieAuth`, the refresh cookie is
`HttpOnly` but scoped `Path=/` on that exact origin
(`auth/cookie-utils.ts:36`, `getCookieSettings` defaults path `/`), so
`fetch("/api/auth/refresh", {credentials:"same-origin"})` returns a fresh access
token to the injected script — full account takeover, HttpOnly notwithstanding.
Without cookie auth the impact is a same-origin phishing/CSRF surface on the API
domain (CSRF middleware is opt-in, `init/middlewares.ts:66`).

**Fix direction.** Sniff the type from the bytes at write time and store the
sniffed value, not the claim. On read, serve anything outside a small
render-safe allowlist (`image/*` minus svg, `video/*`, `audio/*`, `application/pdf`
if wanted) as `application/octet-stream` with
`Content-Disposition: attachment`, and always emit `nosniff`. `text/html`,
`application/xhtml+xml` and `image/svg+xml` should never be echoed inline from
the API origin.

### H3 — the transform endpoint is unauthenticated CPU amplification with an attacker-chosen cache key

`packages/server/src/storage/routes.ts:366,396-406,425-436`,
`packages/server/src/storage/image-transform.ts:112-149,181`

`parseTransformOptions` runs on every `/file/*` GET, including the anonymous
public-object path (`publicObjectAuth` sets a `public` principal and
`checkAuthorized` returns early for it, `routes.ts:214`). The cache key is
`${filePath}::${JSON.stringify(options)}` — every parameter the caller chose:

- width 1…4096, height 1…4096, quality 1…100, 4 formats, 5 fits
- ≈ 10^10 distinct keys against a 500-entry / 256 MB cache

so the hit rate an attacker sees is zero by construction. Each miss reads the
whole object into memory (`fsp.readFile`, or `arrayBuffer()` for remote) and runs
a full libvips decode plus an encode. There is no concurrency cap, no queue, and
no in-flight de-duplication, so N concurrent requests for the same uncached
variant do N decodes.

**Failure scenario.** One public 4000×3000 JPEG and a loop over
`?format=avif&quality=100&width=<i>` for i in 1..4096, from an unauthenticated
client. AVIF encoding at q100 is seconds of CPU per request; each response also
evicts real entries, so legitimate thumbnails stop being cached at the same time.
A few hundred bytes per request against seconds of pod CPU and a full-resolution
bitmap in RSS.

**Fix direction.** Quantize: accept a small allowlist of widths and 2-3
qualities and 400 anything else (this also fixes L1), or require the transform
parameters to be signed into the URL. Add a promise map so concurrent misses on
one key produce one decode, and a global semaphore on `transformImage`.

---

## MEDIUM

### M1 — a TUS upload has no owner; the id is the whole credential, and it travels in the URL

`packages/server/src/storage/tus-handler.ts:23-50,236,254-258,311-315`

`TusUpload` records no principal. `head`, `patch` and `delete` do
`this.uploads.get(id)` and nothing else; `authorizeUpload` runs only in `create`
(`tus-handler.ts:199-201`). The route middleware proves the caller is *some*
authenticated user (`routes.ts:622-624`), never *the* user.

`randomUUID()` is unguessable, so this is a bearer capability — but it is a
bearer capability transported as a URL path segment, which means it is in
`requestLogger` output (`init/middlewares.ts:88`), the Studio log ring buffer
(`logMiddleware`, same file), and every reverse-proxy/ingress access log in front
of the pod. Anyone with log read access can hijack an in-flight upload.

**Failure scenario.** B reads `PATCH /api/storage/tus/<uuid>` from a shared log
stream while A's 500 MB upload is running, PATCHes their own bytes at the current
offset, and the object lands under A's authorized key with A's ownership row —
content B chose, at a path B could never have written to directly. `DELETE` is
the same, as a denial-of-service on someone else's upload.

Enumeration removes even the log dependency in one configuration: the tus temp
directory is a sibling of the buckets (`tus-handler.ts:85`,
`join(storageBaseDir, ".tus-uploads")`), and `GET /list?bucket=.tus-uploads`
reaches it through `getFullPath`. With no `authorize` hook — which the boot guard
permits whenever `publicRead` is set (`init/storage.ts:124`) — that listing is
available to any authenticated caller and returns every in-flight upload id.

**Fix direction.** Store `uid` at create, require it to match on HEAD/PATCH/
DELETE (404, not 403, so ids stay non-probeable), and re-run `authorizeUpload`
on the finalizing PATCH so a revoked grant does not complete.

### M2 — a failed finalize leaks the temp file and the map entry permanently, and the client is told 204

`packages/server/src/storage/tus-handler.ts:334,379-381,107`

```ts
private async finalize(upload) {
    upload.completed = true;            // :334 — set BEFORE the work
    …
    } catch (err) {
        logger.error(`[TUS] Failed to finalize upload ${upload.id}`, { error: err });
    }                                   // :379-381 — no unlink, no map delete
}
```

and the sweeper skips it forever:

```ts
if (now - upload.createdAt > UPLOAD_EXPIRY_MS && !upload.completed) { … }   // :107
```

Class 4 in its purest form — the catch swallows the failure — compounded by the
flag that means "handled" being set on the path that did not handle it (class 23's
"watch for").

**Failure scenario.** Default config, 200 MB video. `create` accepts it
(`Upload-Length` is checked only against the 5 GB `MAX_UPLOAD_SIZE`,
`tus-handler.ts:170`); every PATCH returns 204; `finalize` calls `putObject`,
whose `validateFile` throws `File size 209715200 exceeds maximum allowed size
52428800` (`LocalStorageController.ts:110-113`). The client saw nothing but
success. The object does not exist. 200 MB sits in `.tus-uploads` until the pod
is replaced, and the Map entry sits in RSS for the life of the process. Repeat
until the disk is full.

**DX note — this is what a failed upload looks like to a developer.** There is no
signal at all: the last PATCH is 204, and `HEAD /tus/:id` 404s afterwards whether
the upload succeeded (`tus-handler.ts:376` deletes the entry) or failed (deleted
by nothing, but `completed`). Success and permanent failure are indistinguishable
from the client, and the final storage key is never returned by any response.

**Fix direction.** Set `completed` only after `putObject` resolves; unlink and
delete the map entry on the failure path too; check the declared `Upload-Length`
against the configured `maxFileSize` in `create()` and answer 413 up front; and
give the terminating PATCH a real status plus the resulting key.

### M3 — nothing sweeps `.tus-uploads`, and expiry is measured from creation rather than activity

`packages/server/src/storage/tus-handler.ts:85,96-112`

The `Map` is per-process and the directory is never read — there is no startup
reconciliation anywhere (`tusDir` appears only inside this class). A restart
therefore orphans every temp file with no record that they exist, and every
in-flight resume 404s. The comment says "idle for longer than" but the predicate
is `now - upload.createdAt`, so an upload that is *actively* progressing past 24
hours (a large file on a slow link, exactly what resumable uploads are for) has
its temp file unlinked underneath it and the next PATCH 404s from zero.

`startCleanup` also creates an interval that is never `unref`'d and has no stop
method, so each `createStorageRoutes()` call leaks a timer that keeps the Node
event loop alive.

**Fix direction.** Sweep the directory at startup (the map is empty, so every
file there is an orphan) and on the interval; track `lastActivityAt` and expire
on that; `unref()` the timer and add `stopCleanup()`.

### M4 — the declared length is never checked against the bytes on disk, and concurrent PATCHes corrupt the file

`packages/server/src/storage/tus-handler.ts:264-299,12`

```ts
if (offset !== upload.offset) throw ApiError.conflict("Offset mismatch");   // :269
…
const fh = await open(upload.filePath, "a");                               // :288
await fh.write(chunk);
upload.offset += chunk.length;                                             // :294
```

Read-modify-write on `upload.offset` across two `await`s, no lock, and the file
is opened in **append** mode rather than written at an explicit position — so the
offset the client declared is validated but never *used* to place the bytes.
Class 19: check-then-act, in the counter that is supposed to make the protocol
resumable.

**Failure scenario.** A tus client times out a chunk and retries it (routine
behaviour) while the original request is still in flight. Both carry the same
`Upload-Offset`, both pass line 269, both append. The counter reaches
`upload.size` having written `size + chunk` bytes; the overrun guard at 284
compares against the counter, not the file, so it never fires; `finalize`
`readFile`s the whole thing and stores a corrupt object that is larger than the
length the client declared. Nothing in the system ever compares the two —
`stat` is imported at line 12 and called nowhere, which is the fossil of the
check that is missing.

**Fix direction.** Serialize per upload id (a promise chain keyed by id), write
positionally (`fh.write(chunk, 0, chunk.length, upload.offset)`), and `stat` the
file in `finalize`, refusing when its size disagrees with `Upload-Length`.

### M5 — three advertised upload limits, and the smallest one is undocumented

`packages/server/src/storage/tus-handler.ts:53,152`,
`packages/server/src/init.ts:1260,1304`,
`packages/server/src/init/middlewares.ts:49,51`,
`packages/server/src/init.ts:398-399,602,1317`

- `Tus-Max-Size: 5368709120` (5 GB) advertised by `OPTIONS /tus`
- `maxFileSize` 50 MB default, enforced by the controller *at write time*
- global body limit 10 MB, registered on `${basePath}/*` at `init.ts:602`

The global limit is registered before the storage router is mounted
(`init.ts:1317`), so Hono composes it outermost and it runs first — the
storage-specific 50 MB limit at `init.ts:1304` is unreachable for anything the
global one rejects. Verified empirically against hono 4.13.0 (outer 10 MB, inner
50 MB, 20 MB body): **413, `global-10MB`**. The doc comment at `init.ts:398-399`
asserts the opposite — "Storage upload routes use their own limit … which takes
precedence over this" — and this is the same block whose comment at 1289-1294 is
a post-mortem for the previous version of this exact bug (a `use()` registered
after the routes it guarded).

**Failure scenario.** A developer sets `storage.maxFileSize = 100MB`, uploads a
30 MB file, and gets `Request body too large. Maximum size is 10MB.` from a
limit they never configured, with no mention of storage. Class 5: the message
names a limit whose knob is not the one they turned.

**Fix direction.** Raise the global limit to at least the resolved storage limit
(or register the storage router outside it), and have each `onError` name which
limit rejected and which setting changes it.

### M6 — transform responses are `immutable` for a year, including token-scoped private objects

`packages/server/src/storage/routes.ts:404,434` and `397` vs `371`

```ts
c.header("Cache-Control", "public, max-age=31536000, immutable");
```

set on both the local and remote transform paths, for objects that were readable
only because of a 300-second scoped download token whose value is in the URL.
(The previous audit flagged the `max-age=3600` variant on the non-transform
remote path; this is a year, and it applies to local storage too.) Any shared
cache keyed on URL retains a private object for a year past the token's life.

Separately, the cache key uses the **raw** wildcard `filePath` (`routes.ts:397`)
while authorization and retrieval use the canonical `resolvedPath`
(`routes.ts:371`), so one object accumulates one entry per URL spelling
(`x.png`, `default/x.png`, `./x.png`) — dilution on top of the missing
`storageId` the previous audit reported.

**Fix direction.** `private, max-age=…, must-revalidate` whenever the read was
authorized by a scoped token; key the cache on
`${storageId}/${bucket}/${canonicalKey}` plus an object version/mtime.

---

## LOW

### L1 — transform parameters clamp silently instead of rejecting

`packages/server/src/storage/image-transform.ts:55-89`

`width=99999` becomes 4096; `quality=1000` becomes 100; `format=tiff` is dropped
and you silently get webp; `width=abc` is dropped, and if it was the only
parameter, no transform happens at all and the original bytes come back with the
original content type. Nothing in the response says what was applied. A bound
that clamps is invisible to the caller (class 23's family) — the developer
debugs a wrongly sized `<img>` in the browser rather than reading a 400.

To the audit's question directly: **no, a 30000×30000 render is not reachable** —
`Math.min(w, MAX_DIMENSION)` plus `withoutEnlargement: true` bounds the output
in both directions. The clamping is a DX defect, not a memory one.

### L2 — `isTransformableImage` tests a string the uploader chose; sharp reads the bytes

`packages/server/src/storage/image-transform.ts:101-107,117`

The function excludes svg and gif explicitly — from the *stored declared*
content type, which per H2 is whatever the uploader said. Upload an SVG
declaring `image/png` and the exclusion does not apply: sharp detects the format
from the magic bytes and renders it through libvips/librsvg. Whether librsvg as
linked in sharp 0.35 resolves external references is **UNCONFIRMED**; what is
confirmed is that a guard stated as a safety property cannot enforce it, because
the predicate and the decoder read different inputs (class 2).

Related: no `limitInputPixels` is set anywhere in the repo, so sharp's 268 Mpx
default is the only decompression-bomb bound — adequate, but implicit and
undocumented. And a decode failure (bomb, truncated file, wrong format) throws a
plain `Error`, which reaches `errorHandler` as a **500** on an ordinary GET
rather than a 415/422.

### L3 — browser TUS cannot work cross-origin: no `Access-Control-Expose-Headers`

`packages/server/src/boot/boot.ts:162-165`, hono 4.13.0
`dist/middleware/cors/index.js:7,43`

`cors({ origin, credentials: true })` with no `exposeHeaders`; Hono defaults it
to `[]` and emits the header only when non-empty. A browser tus client on the
frontend origin therefore cannot read `Location` from the 201 or `Upload-Offset`
from the 204/HEAD — which is the entire protocol. Additionally, `create` builds
`Location` from `new URL(c.req.url).origin` (`tus-handler.ts:222-223`); behind a
TLS-terminating proxy that is the internal `http://` origin, i.e. a
mixed-content URL the browser refuses.

Verified as *not* a bug while checking this: Hono does route `HEAD /tus/:id` to
the `get` handler (tested against 4.13.0), so tus clients' offset probes land.

**Fix direction.** `exposeHeaders: ["Location", "Upload-Offset", "Upload-Length",
"Tus-Resumable", "Tus-Version", "Tus-Extension", "Tus-Max-Size"]`, and honour
`X-Forwarded-Proto`/`X-Forwarded-Host` when building `Location`.

### L4 — resumable upload is a server feature with no client, no docs and no tests

`packages/client/src/storage.ts:30-71`;
`grep -rn "tus|resumable"` over `packages/client/src`, `packages/admin/src`,
`docs/`, `website/` → nothing

The SDK's only upload path is a single multipart `POST /storage/upload`. The TUS
surface is mounted by default, is API-key aware
(`auth/api-keys/api-key-middleware.ts:187-205`), advertises itself via
`OPTIONS`, and is discoverable only by reading the server source; a developer
who finds it must bring their own tus client and then hit L3. Class 21.

Test coverage matching: the only TUS assertion in the repo is one key case in
`packages/server/test/storage-key-canonicalization.test.ts:331-345`.
`image-transform.ts` has **no test at all** — `parseTransformOptions`,
`TransformCache` and `transformImage` appear in no test file.

### L5 — upload creation is unbounded

`packages/server/src/storage/tus-handler.ts:158-233`

Each `create` allocates a Map entry and an inode, with no per-user cap, no cap
on concurrent uploads, and no reservation against the declared length; entries
live 24 hours. An authenticated caller can create hundreds of thousands of
zero-byte uploads and hold both the inodes and the heap for a day.

---

## Checked and clean

- **The key invariant genuinely holds.** `create` canonicalizes
  `metadata.key || metadata.filename` once, falls back to the upload id,
  authorizes *that*, stores it (`tus-handler.ts:185-218`), and `finalize` reads
  `upload.key` and nothing else (`:359`). The previous audit's P0 is closed on
  this axis; the same discipline is what H1 is missing on the neighbouring one.
- **The gate runs before any temp file exists** (`tus-handler.ts:199-206`), so a
  denied upload leaves nothing behind to resume — as the comment claims.
- **Protocol validation on the happy path is correct.** Missing `Upload-Length`
  → 400; non-numeric or ≤ 0 → 400; over `MAX_UPLOAD_SIZE` → 413; missing
  `Upload-Offset` → 400; mismatched offset → 409; wrong `Content-Type` → 415;
  chunk exceeding the declared length → 413.
- **`parseMetadata` cannot pollute the prototype.** Values are always strings, so
  a `__proto__ <base64>` pair is a no-op assignment rather than class 22.
- **`HEAD /tus/:id` reaches `head()`** — Hono 4.13.0 routes HEAD to GET handlers
  (verified empirically), so the `router.get` registration is not the
  interoperability bug it looks like.
- **The transform path is behind authorization** for both local and remote
  (`routes.ts:362`), and the cache is consulted after it — the cache is never a
  way to read an object you could not read directly (within one `storageId`; see
  the previous audit's P1 for across).
- **`TransformCache` accounting is sound.** `totalBytes` is decremented on both
  eviction and expiry, and the eviction loop is bounded by `this.cache.size > 0`
  so it cannot spin on an oversized single entry.
- **`MAX_DIMENSION` + `withoutEnlargement`** correctly bound output resolution in
  both directions.
- **The API-key guard classifies every `/tus*` method as `write`**
  (`api-key-middleware.ts:193-205`), which is the right call for a protocol whose
  progress check is a GET and whose abort is a DELETE, and it is tested.

---

## Open questions

1. **Is TUS meant to be a supported feature?** If yes it needs an SDK client,
   documentation, and a decision on multi-replica state (S3 multipart, or a
   shared-state store) — the managed runtime scales pods, and today a resume
   after a reschedule 404s. If no, it should not be mounted by default; it is
   currently reachable, undocumented, and carries M1/M2/M4.
2. **Does any deployment actually use a non-`default` bucket?** Every read route
   hardcodes `default` (`routes.ts:285-296`). If the answer is no, C1 is closable
   by *deleting* the write-side `bucket` parameter rather than validating it,
   which is the stronger fix.
3. **Does librsvg as linked in sharp 0.35 resolve external hrefs?** (L2 is
   UNCONFIRMED on impact; the guard defect itself is confirmed.)
4. **Should transforms be signed?** A signed parameter set answers H3 and L1 at
   once and makes the cache key non-attacker-chosen by construction.
5. **Is there a deployment running `cookieAuth` with public storage on the API
   origin?** That is H2's worst case (HttpOnly refresh cookie reachable by
   same-origin fetch from an uploaded page) and it decides that finding's
   priority.
6. **`publicRead: true` alone satisfies the boot guard** (`init/storage.ts:124`)
   and installs no `authorize` hook, so a "public reads" intent silently answers
   the *write* question too — every authenticated caller may then write or
   overwrite any key. Deliberate?
