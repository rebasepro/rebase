# Storage audit — 2026-08-07

Scope: `packages/server/src/storage/**`, `packages/server/src/init/storage.ts`,
`packages/client/src/storage.ts`, `packages/types` storage types, the CLI's
shipped `storageAuthorize` templates, and the cloud side (`saas/backend/src/utils/*storage*`,
`saas/backend/src/managed/intake.ts`, `saas/backend/src/metering/**`,
`saas/frontend/src/views/project/StorageSettings.tsx`).

## Verdict

The **design** is sound and, on the cloud side, unusually careful — the managed
provisioner is the best-reasoned code in this area. The **data plane** has one
real defect class and a set of scale-shaped gaps.

The defect class: storage is not under RLS, so `storageAuthorize` is the *entire*
access-control model. It is handed a key that has been **stripped, not
canonicalized** — and the storage controller then interprets that same string
differently. The hook and the write land on different objects.

Everything marked CONFIRMED below was reproduced against the real
`createStorageRoutes` + `LocalStorageController` (jest, `packages/server`).

---

## P0 — `storageAuthorize` can be bypassed with a non-canonical key — CONFIRMED, **FIXED**

> **Fixed** in `packages/server/src/storage/keys.ts` + the call sites below.
> `canonicalStorageKey` replaces `sanitizeStorageKey`: it normalizes what is safe
> to normalize (leading slashes, `.` segments, repeated slashes) and **refuses**
> (400 `INVALID_STORAGE_KEY`) any key carrying a real `..` segment, a null byte,
> or more than 1024 characters. `....` is correctly left alone as the ordinary
> directory name it is. Guarded by
> `packages/server/test/storage-key-canonicalization.test.ts` (42 tests).


`sanitizeStorageKey` ([routes.ts:104](../../packages/server/src/storage/routes.ts#L104))
is a single-pass strip:

```ts
sanitized = sanitized.replace(/\.\.\/|\.\.\\/g, "");
```

One pass over `....//` leaves `../`. The result is passed **verbatim** to both the
authorize hook and the controller — but they read it differently: the hook does
string prefix matching, `LocalStorageController.getFullPath` does `path.resolve`.
`getFullPath`'s traversal guard only defends the **bucket** boundary, and the
escape stays inside it.

The shipped BaaS overlay hook
(`packages/cli/templates/overlays/baas/config/storage.ts`) is exactly
`key.startsWith(\`users/${user.uid}/\`)`, and both templates' JSDoc recommend that
shape. Against that hook, as `alice`:

| request | hook sees | actually served | result |
|---|---|---|---|
| `GET /file/users/bob/notes.txt` | `users/bob/…` | — | **403** (correct) |
| `GET /file/users/alice/....//bob/notes.txt` | `users/alice/../bob/notes.txt` → allowed | `…/default/users/bob/notes.txt` | **200 `bob private data`** |
| `GET /metadata/users/alice/....//bob/notes.txt` | allowed | — | **200** + a 5-minute download token scoped to `default/users/alice/../bob/notes.txt` |
| `POST /upload key=users/alice/....//bob/notes.txt` | allowed | overwrites bob's object | **201**, bob's file on disk becomes `PWNED` |

Same shape applies to `DELETE /file/*` and to `GET /list?prefix=users/alice/....//`
(which resolves to `default/users` and enumerates every user's directory —
enumeration being the exact thing the boot guard exists to prevent).

Note the minted token: `checkAuthorized` deliberately early-returns for the
`download-token` principal ([routes.ts:208](../../packages/server/src/storage/routes.ts#L208)),
so once minted it is unconditionally honoured. The 403 above is not just delayed,
it is converted into a shareable capability.

**Why the existing tests miss it.** `storage-local.test.ts:122` asserts a `../`
key cannot escape the *bucket*, and it can't. Nothing asserts a key cannot escape
the *prefix the hook approved* — which is the only boundary the authorization
model actually has.

**Fix direction.** Canonicalize, then **reject** rather than strip:
`path.posix.normalize`, then refuse any key with a residual `..` segment, a leading
`/`, or a null byte (400). Use the one canonical string for the hook, the
controller, and the token, and assert they are the same value. Stripping is wrong
independent of the bypass: it silently stores an object at a path the caller did
not ask for. `isPublicStoragePath` already got this right — it rejects any path
containing a `..` segment outright ([controllers/storage.ts](../../packages/types/src/controllers/storage.ts)).
Same rule, one layer up.

## P0 — TUS authorizes one key and writes another — **FIXED**

> **Fixed.** `TusUpload.key` is now non-optional and resolved **once**, in
> `create()`: canonicalize `metadata.key || metadata.filename`, fall back to the
> upload id, authorize *that*, store *that*. `finalize()` reads `upload.key` and
> nothing else — the `|| metadata.filename || id` fallback chain is gone. The
> route's authorize callback no longer re-derives the key either; two call sites
> computing it separately is how the check and the write came apart originally.


`TusHandler.create` gates on `sanitizeStorageKey(metadata.key)`, but `finalize`
calls `putObject({ key: upload.key })` — the **raw** `Upload-Metadata` value
([tus-handler.ts:326](../../packages/server/src/storage/tus-handler.ts#L326)).

These are different strings by construction, so this survives even a correct
sanitizer. The resumable path is a second way to write an object; the hook must
see the identical bytes that reach `putObject`. Store the canonical key on the
`TusUpload` at creation and finalize with that.

## P1 — the image-transform cache is keyed by path alone

```ts
transformCache.buildKey(filePath, transformOpts)   // routes.ts:391, 420
buildKey(fileKey, options) { return `${fileKey}::${JSON.stringify(options)}` }
```

No `storageId`, no bucket. In a multi-source deployment two sources holding the
same key share one cache entry for an hour — whichever is fetched first is served
to both. That is a cross-bucket content leak in exactly the configuration
`docs/storage-sources.md` promotes. It also serves stale bytes for an hour after
an object is overwritten in place.

## P1 — download tokens are not scoped to a storage source — **FIXED**

The token payload is `${bucket}/${resolvedPath}` ([routes.ts:469](../../packages/server/src/storage/routes.ts#L469)),
`fileTokenAuth` matches on that path only, and `/file/*` still resolves its
controller from `?storageId`. Mint a token on a source you may read, replay it
against a source you may not, same key. Put the source key in the token payload
and match it.

**Fixed 2026-08-12.** `DownloadTokenPayload` carries a `storageId`;
`/metadata/*` signs it with the source it just authorized against, and
`fileTokenAuth` refuses a token whose source is not the one the request names
(403 `Scoped token storage mismatch`, distinct from the path mismatch so a
client that forgets to forward `?storageId=` is debuggable).

Two details that decide whether this works:

- **One spelling of the default source.** Omitted, empty and `(default)` all
  resolve to the same controller, so all three have to produce the same grant.
  `canonicalStorageId` in `storage/keys.ts` is that rule, shared by the minting
  route and the middleware — the same "one canonical string, one function"
  discipline the key canonicalizer exists for, and for the same reason: two
  copies of this rule is the bug, not the fix. `DEFAULT_STORAGE_ID` is now an
  alias of `DEFAULT_STORAGE_SOURCE_KEY` rather than a second `"(default)"`
  literal.
- **Legacy tokens read as default-source grants, not as wildcards.** A token
  minted before the claim existed has none; `verifyDownloadToken` fills in the
  default source. Fail-closed, and bounded by the 300s TTL — for at most that
  long after a deploy an in-flight token for a *named* source is refused and the
  client re-fetches `/metadata`.

Guards: cross-source reads in `test/file-token-auth.test.ts` and, at route
level, `test/storage-routes.test.ts`. Both directions are needed and they fail
differently — a missing *check* is caught by spending a token on the wrong
source, while a mint site that forgets to name the source is invisible to that
(a default-scoped token is what a default request should get) and shows up only
when a **named**-source token is spent on its own source and wrongly refused.

## P1 — an unknown `storageId` silently falls back to the default source — **FIXED**

`DefaultStorageRegistry.getOrDefault` logs a warning and returns the default
controller. So the hook is asked about source `X` and the bytes come from
`(default)`. A hook that widens access for one named source (a public-assets
bucket, say) therefore widens it for the default one. An unknown `storageId`
should be a 400, not a fallback.

**Fixed 2026-08-12.** `getOrDefault` now means *the source you named, or the
default if you named none* — an unknown id throws `UnknownStorageSourceError`
instead of redirecting. The route layer turns that into one of two answers,
because they are two different problems:

- **501 `STORAGE_SOURCE_NOT_CONFIGURED`** when the source *is* declared in
  `rebase.json` but has no credentials here. This is the case that made the old
  fallback reachable without an attacker: boot skips such a source, but
  `GET /sources` still advertises it, so a client asks for a source it was told
  exists and gets a different bucket's contents. `docs/storage-sources.md`
  already claimed this 501 — it was aspirational until now.
- **400 `UNKNOWN_STORAGE_SOURCE`** otherwise, naming the sources that do exist.
  Marked `expected`, so a client holding a stale name does not log a warning per
  request forever.

Three places had to agree, not one:

- **TUS resolves the source twice** — `create` to tell the hook where the bytes
  are going, `finalize` to write them — so the fallback landed the object in
  `(default)` after the hook approved `X`. `create` now refuses an unknown
  source before a temp file exists (failing at `finalize` would mean accepting
  the entire upload first); `finalize` maps the error into its existing
  "nothing to write to" branch rather than into another bucket.
- **The single-controller path** (`controller` with no registry) honoured a
  named `storageId` by ignoring it — the same silent redirect by another route.
- **Empty and `(default)` must still mean the default.** `?storageId=` with no
  value is how a client spells "no preference"; refusing it would be a
  regression dressed as a fix. `get`/`has`/`getOrDefault` all canonicalize
  through `canonicalStorageId` so they cannot disagree about which spellings
  mean the default.

Guards in `test/storage-registry.test.ts`, `test/storage-routes.test.ts` (400,
501, empty-id, and *no bytes written anywhere*) and
`test/storage-tus-storage-id.test.ts`. Verified by mutation: restoring the
fallback fails 6, collapsing 501 into 400 fails 1, removing the TUS pre-check
fails 1.

## P1 — a `%` in a key makes the object permanently unreadable — CONFIRMED

The client builds `/storage/file/${filePath}` with no encoding
([client/src/storage.ts](../../packages/client/src/storage.ts)); the server always
`decodeURIComponent`s. `decodeURIComponent("100%.png")` throws `URIError`, which
reaches `errorHandler` as an unknown error: **500**. Uploading `100%.png` succeeds
and the file can never be read back. `#` and `?` in keys are broken the same way,
less loudly. Encode path segments client-side and decode defensively server-side.

## P2 — every byte is proxied through Node, fully buffered, with no Range or ETag

`/file/*` reads the whole object into memory for both local (`fsp.readFile`) and
remote (`await fileObject.arrayBuffer()`, itself preceded by
`S3StorageController.getObject` concatenating the entire body into a Buffer).
There is no `createReadStream`, no `Range` handling, no `ETag`/`Last-Modified`,
no conditional-request path anywhere in `packages/server/src/storage/`.

Consequences: a 500 MB download is a 500 MB RSS spike per concurrent request on a
tenant pod; video seeking does not work; every view is a full re-download (no 304);
and `Cache-Control: public, max-age=3600, immutable` is set on token-scoped
private objects. The comment explaining why signed-URL redirects were rejected
(mixed content, VPC-internal endpoints) is a good reason not to redirect *always*
— it is not a reason to have no streaming path at all. This is the single biggest
architectural limiter on the cloud side: the runtime is on the byte path for
every file, forever, and cannot be CDN-fronted.

## P2 — TUS state is in-memory and disk-local

`private uploads = new Map()` plus a temp dir under the local storage root (or
`./uploads` when the backend is S3 — i.e. the container filesystem). So:

- more than one replica, or any restart, and a resume 404s;
- `finalize()` catches its own failure and logs it, but the client already got
  `204` on the last PATCH — a silent data-loss path;
- `MAX_UPLOAD_SIZE` is a flat 5 GB and ignores the configured `maxFileSize` until
  `validateFile` rejects it *at finalize*, after the whole file has been written
  to the pod's disk.

For the managed runtime this means resumable uploads are effectively
single-replica-only. Worth either documenting as such or moving the state to S3
multipart.

## P2 — smaller things

- **`bucket` is write-only.** `POST /upload` forwards an arbitrary `bucket` from
  the body, but `parseBucketAndPath` hardcodes `default` for read/delete/metadata/
  folder. An object uploaded to another bucket is unaddressable afterwards. The
  same function also makes a real folder named `default/` ambiguous with the
  bucket prefix.
- **The upload body limit ignores multi-source config.** `init.ts:1257` reads
  `maxFileSize` only when `config.storage` is a single config with a `type`; a
  `Record<string, …>` of sources always gets the 50 MB default, whatever each
  source declares.
- **`S3StorageController` passes an explicit `credentials` object**, which
  suppresses the AWS SDK credential chain — IRSA / instance profiles can never
  work. Known and deliberate, but it is why "leave the keys blank" fails.

---

## Cloud integration

### What is genuinely good

- **Four concerns, four homes** (`docs/storage-sources.md`): topology in
  `rebase.json`, credentials in env via one shared `storageEnvSuffix()`, access
  model in code, console convenience rendered into the same variables. The
  env-wins rule is right and the console now *names* the overriding variables
  instead of showing a form that isn't in effect.
- **`storage-reader-conformance.test.ts`** runs one fixture table through both
  remaining readers. This is the correct answer to "three readers agreeing by
  coincidence".
- **Managed provisioning** (`managed-storage.ts` + `managed-storage-gcp.ts`) is
  the strongest code in the area: per-project bucket **and** service account,
  `objectAdmin` not `admin`, uniform bucket-level access, `publicAccessPrevention:
  enforced`, versioning plus a noncurrent-only lifecycle rule, ordering such that
  a credential is never minted before the grant it depends on, idempotent
  everywhere except the HMAC key (with the reason stated), a capacity ceiling that
  **refuses** rather than sharing an account, and a teardown that deactivates keys
  before deleting the account.
- **Two gates on the same rule**: `STORAGE_ACCESS_MODEL_REQUIRED` at bundle intake
  (a deploy error you can act on) and `assertStorageAccessControlConfigured` at
  boot (the backstop). Right layering.

### Gaps

1. **Storage quotas and overage are dead code.** `metering/quota.ts` declares
   1/10/100/500 GB per plan and a EUR/GB overage price; `metering/rollup.ts`
   accepts an optional `storageBytes(projectId)` dep — and **nothing in the
   repository calls `rollup` at all**, nor is there any implementation of
   `storageBytes` (no GCS bucket-size query exists). So no tenant's object storage
   is measured, no quota is enforced, and no overage is billed. The plan table is
   currently a marketing claim, not a mechanism.
2. **Nothing ever deletes a bucket.** `revokeServiceAccount` deliberately leaves
   the bucket and its objects — a defensible retention decision — but there is no
   retention job, no orphan sweep, and no console surface for it. Combined with
   (1), deleted tenants' buckets accumulate GCS cost indefinitely with no owner
   and no measurement. This is the concrete unit-economics hole in storage, and it
   pairs badly with the versioning-on default.
3. **~100 tenants is the managed ceiling** (one GCP service account each). Known,
   documented, refuses safely — but it is a hard product limit that arrives
   without warning to anyone who hasn't read `PROD-READINESS.md`.
4. **Two variable prefixes for one product.** The control plane reads
   `STORAGE_S3_BUCKET`; tenants read `S3_BUCKET`. A customer who copies the wrong
   one gets config that is silently ignored.

---

## Suggested order

1. ~~Canonicalize-and-reject keys~~ — **done**. One canonical value shared by hook,
   controller, download token and the token-matching middleware, plus the missing
   test axis (*escape the approved prefix*, not just the bucket).
2. ~~TUS: authorize and write the same key~~ — **done**.
3. ~~Put `storageId` into the transform-cache key and the download-token
   payload; 400 on unknown `storageId`~~ — **done**. All three P1 leaks closed.
4. Encode/decode keys properly on both sides (the `%` 500).
5. Then the scale work: stream + `Range` + `ETag` on `/file/*`, and decide whether
   TUS is single-replica-by-contract or moves to S3 multipart.
6. Cloud: wire `rollup` to a real `storageBytes` provider, or delete the storage
   plan limits until it exists. Decide a bucket-retention policy and implement it.
