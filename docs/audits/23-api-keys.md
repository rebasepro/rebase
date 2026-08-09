# Unit 23 — Service API Keys

Read-only security audit, 2026-08-09, against `main` (`c678e1745`).

Scope: `packages/server/src/auth/api-keys/**`, `packages/client/src/api-keys.ts`,
`packages/cli/src/commands/api-keys.ts`, plus every call site that consults an
API key's permission list (`api-generator.ts`, `history-routes.ts`, the storage
and functions guards, `init.ts` wiring) and every transport that authenticates
one (`middleware.ts`, `adapter-middleware.ts`, the realtime sockets).

Lens: bug-classes **36** (a mechanism nothing enforces) and **10** (a flag whose
`false` grants instead of skipping).

---

## Verdict

The cryptographic core of this unit is sound and the *authentication* path is
one of the better-built things in the repo: one entry point (`validateApiKey`)
for every transport, a per-request database lookup with no cache, revocation and
expiry checked in that one place, a fail-closed permission parse, and an RLS
identity (`api-key:<id>` / `service`) that cannot pass for the platform's
`service` uid. `docs/backend/api.md` describes all of this accurately, including
the realtime gap.

The defects are all in the **authorization** half, and they share one root: the
permission list is a three-valued vocabulary — `read` / `write` / `delete` over
a flat string namespace — and *what the request actually does* is inferred from
the HTTP method and from a URL segment, in three places, by three different
rules. Each inference is right for the routes its author had in mind and wrong
for at least one route that exists:

* `POST /:slug/bulk/delete` is classified `write`, so **the `delete`
  permission is not a boundary** — a write-scoped key deletes rows (HIGH);
* the nested-route check reads the *relation name* out of the URL rather than
  resolving it to the target collection, two lines above the function that does
  resolve it correctly (MEDIUM);
* any storage path containing a `tus` segment is forced to `write` for every
  method, including `DELETE` and `GET` (MEDIUM).

Separately, and squarely class 36: **the permission list is consulted on no
admin surface at all.** `admin: true` is a second, orthogonal grant that the
permission list neither bounds nor describes, and the one control built to
contain it — `rejectApiKeyAuth`, "an API key never touches API keys" — is
bypassable in two hops through `POST /api/admin/users` (MEDIUM/HIGH).

Note the double gate genuinely does mitigate most of this: RLS is a real second
ceiling and a non-admin key matches no default policy. But the whole point of
the permission list is to be the ceiling a project reasons about when its
`securityRules` are permissive to the `service` role, which is exactly the shape
the docs instruct users to write (`{ operation: "select", roles: ["service"] }`).
Where that rule exists, the permission list is the only gate, and it is the one
that leaks.

Findings: **1 HIGH, 3 MEDIUM, 4 LOW, 6 informational.**

---

## HIGH

### H1. `delete` is not a real permission: bulk delete is checked as `write`

`packages/server/src/api/rest/api-generator.ts:518-519`
(guard: `api-generator.ts:130-142`; mapping:
`packages/server/src/auth/api-keys/api-key-permission-guard.ts:23-39`)

```ts
this.router.post(`${basePath}/bulk/delete`, async (c) => {
    this.enforceApiKeyPermission(c, collection.slug);
```

`enforceApiKeyPermission` derives the operation from `c.req.method` alone.
`POST` → `"write"`. The route deletes rows.

The route's own docblock explains, at length and correctly, why it is a `POST`
rather than a `DELETE` (proxies drop bodies on `DELETE`; generated clients omit
`requestBody` on a `DELETE` operation). That reasoning is about HTTP transport;
nothing propagated it to the layer that reads the verb as an intent. This is
class 2 with the two implementations one line apart: the route knows it is a
delete, the guard asks the method.

**Failure scenario.** An operator provisions the exact key the docs recommend
for an agent — `[{ "collection": "articles", "operations": ["read", "write"] }]`
— deliberately withholding `delete` so the agent can draft and edit but never
destroy. The collection carries the `securityRules` entry the docs tell you to
write so a scoped key sees rows at all (`roles: ["service"]`), and, as is normal,
that rule covers `delete` too, or the key is an `admin: true` CI key whose
permission list is the only scoping anyone applied. The agent (or anyone who
lifts the key out of a CI log) sends:

```
POST /api/data/articles/bulk/delete
Authorization: Bearer rk_live_…
{"ids": ["1","2","3", …]}
```

Every id is deleted, in one transaction, and the response is `200 {"meta":
{"deleted": N}}`. The permission the operator relied on was never consulted.
Attacker capability: possession of a *write-scoped, delete-denied* key.
Impact: full row deletion across every collection the key can write.

**Fix direction.** Stop deriving the operation from the method at routes whose
semantics disagree with it. Give `enforceApiKeyPermission` an explicit
`operation` parameter and pass `"delete"` at `:518`, keeping
`httpMethodToOperation` as the default only where the verb is honest. Then pin
the property rather than the instance: a test that enumerates the generator's
registered routes and asserts that every route which calls `driver.delete` /
`driver.deleteMany` demands `"delete"` — so the next POST-shaped destructive
route fails the suite instead of shipping.

---

## MEDIUM

### M2. The permission list is enforced on no admin surface, and the "keys cannot manage keys" containment is two hops deep

`packages/server/src/auth/api-keys/api-key-routes.ts:41-67`;
`packages/server/src/init.ts:980`, `:1156`;
`packages/server/src/auth/admin-users-route.ts:227`, `:286`;
`packages/server/src/auth/reset-password-admin.ts:47`

Exhaustively, the sites that read `apiKey.permissions` are:
`api-generator.ts:138`, `api-generator.ts:158`, `history-routes.ts:73`,
`api-key-middleware.ts:200` (storage), `api-key-middleware.ts:244` (functions).
That is the whole list. `/api/admin/*`, `/api/cron/*`, `/api/logs/*`,
`/api/admin/backups`, `/api/schema-editor/*` and `/api/meta/contract` are gated
by `requireAdmin` on the *role* the `admin` flag confers
(`api-key-middleware.ts:102`) and never look at `permissions` at all.

So `{ "admin": true, "permissions": [] }` — a key that reads, in the CLI's own
`rebase api-keys list` output, as `Permissions: none` — holds user
administration, role administration, password resets, cron, backups, logs and
the schema editor. This is class 36 in its plain form: a mechanism (the
permission list) that the admin half of the system does not consult, while the
UI, the CLI and the docs present it as *the* scope of a key.

The sharper consequence is that `rejectApiKeyAuth` does not contain what its
docblock says it contains. That comment is precise and correct about the direct
route — an admin key must not mint a second admin key, because "the keys it
minted are ordinary rows with no link back to it" — and reads are refused
alongside writes for the same reason. But the same key reaches:

* `POST /api/admin/users` with `{"email":…, "password":…, "roles":["admin"]}`
  (`admin-users-route.ts:227`, `:255`), or
* `PUT /api/admin/users/:uid` setting a password on an existing admin
  (`admin-users-route.ts:286`), or
* `POST /api/admin/users/:uid/reset-password`, which returns
  `temporaryPassword` in its response body (`reset-password-admin.ts:47`,
  `:159`).

Any of the three yields an admin *user session*, and a session is precisely the
credential `rejectApiKeyAuth` admits to key management. The containment is one
`POST` wide.

**Failure scenario.** An `admin: true` key leaks (CI log, a compromised runner,
a `.env` committed by an integration). Revoking it is the incident response the
design promises. The holder first creates `attacker@x.test` with
`roles: ["admin"]`, signs in, and mints a fresh admin key. Revoking the original
row changes nothing — exactly the outcome the docblock at `api-key-routes.ts:47`
identifies and believes it has prevented.

**Fix direction.** Two separable pieces. (a) Make `admin: true` consult the
permission list rather than short-circuit it: require an explicit `admin`
resource entry (`{ "collection": "admin", "operations": [...] }`, or per-surface
`admin/users`, `admin/cron`) so `permissions: []` means what it says, and warn
at creation when `admin: true` is combined with a narrow list. (b) Extend
`rejectApiKeyAuth`'s rule to the routes that mint session-capable credentials —
user create/update with `roles` or `password`, and the reset-password route —
or, better, state the rule positively: an API key may not create or modify a
principal that can authenticate. Gate it by enumerating the admin routers and
asserting each one is either permission-checked or explicitly listed as
key-unreachable, so a new admin surface fails until someone decides.

### M3. Nested routes check the permission against the relation name, not the resolved collection

`packages/server/src/api/rest/api-generator.ts:144-158`, `:967` vs `:969`

```ts
this.enforceSubcollectionApiKeyPermission(c, parsed.collectionPath);   // :967
…
const targetCollection = this.resolveNestedWriteCollection(parsed.collectionPath); // :969
```

`enforceSubcollectionApiKeyPermission` is `collectionPath.split("/").pop()`
(`:158`). `resolveNestedWriteCollection` (`:162-190`) walks the path through
`findRelation` / `relation.target()` and returns the real `CollectionConfig`.
Two answers to "which collection does this path address?", two lines apart, in
one file — class 2 — and the security-bearing one is the naive one.

The last URL segment is a **relation key**, not a collection slug. Nothing
requires the two to agree; `findRelation`
(`packages/common/src/util/relations.ts:130-146`) even accepts hyphen/underscore
variants of it. The docblock at `:145-153` shows the author reasoning carefully
about *which* segment to check ("checking the parent instead would let a key
scoped to `authors` write `posts`") and never asking whether the segment is a
collection name at all.

**Failure scenario.** `authors` declares a relation `drafts` whose `target()` is
the `posts` collection (a perfectly ordinary alias: `featured`, `drafts`,
`archive`, `attachments`). A separate, low-sensitivity collection also happens
to be slugged `drafts`, and a key is scoped
`[{ "collection": "drafts", "operations": ["read", "write", "delete"] }]`.
`GET/POST/DELETE /api/data/authors/1/drafts…` passes the guard — the popped
segment is the literal string `drafts` — and operates on `posts` rows. RLS is
the only remaining gate, and a project that granted `service` on `posts` for its
other integrations has none. The mirror-image failure is a support ticket: a key
correctly scoped to the target collection is refused on the alias path, because
the alias is not its slug.

**Fix direction.** Call `resolveNestedWriteCollection(parsed.collectionPath)`
*before* the guard on all five nested handlers and check `target.slug`; refuse
(rather than skip) when the path cannot be resolved, since an unresolvable path
is a 404 the driver is about to raise anyway. Note the existing test agrees with
the bug in the class-7 way: `api-key-permissions-fixes.test.ts:188-250` builds
two collections with *no relations at all* and a relation name identical to the
slug, so the fixture cannot distinguish the two implementations. The replacement
fixture needs `authors.drafts → posts`.

### M4. `/tus/` is matched anywhere in the path, so a `tus` folder makes storage `read` and `delete` collapse into `write`

`packages/server/src/auth/api-keys/api-key-middleware.ts:198-201`

```ts
const isTus = /\/tus(\/|$)/.test(c.req.path);
const operation = isTus ? "write" : httpMethodToOperation(c.req.method);
```

The intent (documented at `:187-191`, and correct) is that the four TUS routes —
`POST /tus`, `GET|PATCH|DELETE /tus/:id` — are all steps of one upload and must
all cost `write`. The implementation tests the whole request path for the
substring, not the route. The storage router also serves `GET /file/*`,
`GET /metadata/*` and `DELETE /file/*`, whose `*` is an object key that may
contain any segment (`packages/server/src/storage/routes.ts:475`, `:585`,
`:633`).

This is class 10's shape — a derived boolean whose branch is the more permissive
one — plus class 13's substring habit applied to a path instead of to generated
text.

**Failure scenario.** A bucket contains `uploads/tus/*` (a staging prefix named
after the protocol, which is what one would name it). A key scoped
`[{ "collection": "storage", "operations": ["write"] }]` — an upload-only key,
deliberately denied `read` and `delete` — sends
`DELETE /api/storage/file/uploads/tus/invoice.pdf`: `isTus` is true, operation
is `write`, the guard passes, and the object is deleted. `GET` on the same path
likewise returns the file's bytes to a key with no `read`. Attacker capability:
an upload-only storage key. Impact: read and delete of every object under any
`tus` path segment.

**Fix direction.** Decide from the *route*, not the path text: mount the guard
per-route (`storageRouter.on(["POST"], "/tus", …)`, `.on([...], "/tus/:id", …)`)
or anchor the test to the router-relative path immediately after the mount
prefix — `/^\/tus(\/[^/]*)?$/` against `c.req.path.slice(mountPrefix.length)`.
Test with an object key containing a `tus` segment; that case is currently
untested (`api-key-permissions-fixes.test.ts:351-`).

---

## LOW

### L5. Collection slugs share a namespace with `storage` and `functions`

`packages/server/src/auth/api-keys/api-key-permission-guard.ts:78-83`, `:104-118`

`isStorageAllowed` is literally `isOperationAllowed(permissions, "storage", op)`
and `isFunctionAllowed` matches `perm.collection === "functions"`. A project with
a collection slugged `storage` or `functions` therefore cannot scope a key to
that collection without also granting the file-storage surface / every custom
function, and cannot grant the surface without also granting the collection's
rows. The two namespaces are compared with the same string equality, so the
collision is silent in both directions and appears nowhere in the create-time
validation (`api-key-routes.ts:26-38`, which accepts any non-empty string).

**Fix direction.** Prefix the non-collection namespaces (`@storage`,
`@functions/<name>`) — a breaking change to the wire format, so more realistically:
reject at creation a `collection` entry whose value collides with a registered
collection slug, naming the collision.

### L6. `GET /storage/list` is `read` to the key guard and write-privileged to storage

`packages/server/src/storage/routes.ts:658` vs
`packages/server/src/auth/api-keys/api-key-middleware.ts:199`

Storage's own authorization puts bucket listing behind `writeAuthMiddleware`;
the API-key guard derives `read` from the `GET`. A key scoped
`storage: ["read"]` — "may download files it is told about" — can enumerate the
entire flat key namespace. The two layers disagree about how privileged listing
is; the more permissive one runs first.

**Fix direction.** Classify `/list` as `write` in the guard, matching the router
it guards, and add it to the same route-level classification table as the fix
for M4.

### L7. No rate limit, and no lockout, on API-key *authentication* failures

`packages/server/src/init.ts:1455-1472`, `:1710`;
`packages/server/src/auth/rate-limiter.ts:296-330`

The data rate limiter is registered *after* the auth middleware, so a request
bearing an invalid `rk_` token is answered 401 by `createAuthMiddleware` and
never reaches the limiter. Each attempt costs one indexed `SELECT` against
`rebase.api_keys`. There is no per-IP bucket in front, no failure counter, and
no backoff. Guessing a key is infeasible (128 bits, see C1), so the exposure is
an unauthenticated database-load amplifier rather than a credential risk.

Separately, `rate_limit` is advertised as a per-key ceiling but only two routers
mount the limiter — `/api/data` and `/api/functions`. Storage
(`init.ts:1332-1352`), `/api/admin/*`, cron, logs, backups and the schema editor
have no per-key limit at all, so a key's `rate_limit` does not bound its uploads
or its admin traffic.

**Fix direction.** Move the anonymous/IP bucket ahead of authentication on the
data router (or mount a cheap pre-auth limiter at the app level), and either
mount the limiter on the remaining routers or narrow the documented meaning of
`rate_limit` to the two surfaces that honour it.

### L8. Three distinguishable 401s tell a token holder which state their key is in

`packages/server/src/auth/api-keys/api-key-middleware.ts:77-98`

`"Invalid API key"` / `"API key has been revoked"` / `"API key has expired"` are
separate messages on separate branches. Useful diagnostics, and the distinction
only matters to someone already holding the bytes — but it does confirm to a
finder of a leaked key that the key *existed*, and lets them tell "revoked"
(incident handled) from "expired" (possibly renewable under the same name).

**Fix direction.** One `UNAUTHORIZED` envelope on the wire; keep the distinction
in a server-side log line keyed by `key_prefix`, which is also the audit record
this unit currently does not write.

---

## Informational

**C1 — entropy and format.** `randomBytes(16).toString("hex")` → 128 bits from
the CSPRNG, formatted `rk_live_` + 32 hex (`api-key-store.ts:36-39`). Adequate
and unguessable. `key_prefix` is the first 12 characters
(`api-key-store.ts:51-53`), i.e. `rk_live_` plus the first 4 hex characters, so
the stored/displayed prefix discloses 16 bits and leaves 112 — still far beyond
reach, but the prefix would be strictly better as a separate random label. The
`HEX_CHARS` constant at `api-key-store.ts:29` is dead (class 20's benign half —
"defined but never used", not "assigned and discarded").

**C2 — hashing and comparison.** Storage is unsalted single-round SHA-256
(`api-key-store.ts:44-46`, `api-key-middleware.ts:46-48`), which is the right
choice for a 128-bit random secret: there is nothing to brute-force and a slow
KDF would be a per-request cost on every surface. Lookup is `WHERE key_hash = $1`
on an indexed column, so the comparison happens in Postgres over a
high-entropy digest, not in application code over the secret — the timing
channel is not exploitable. Worth noting the asymmetry is unstated: `safeCompare`
is used for the service key (`middleware.ts:148`, `:325`) because that value is
compared in-process, and a reader may wonder why the API-key path does not.
A one-line comment would stop someone "fixing" it.

**C3 — the plaintext is minted, returned and printed exactly once.**
`createApiKey` is the only producer (`api-key-store.ts:227-254`); the response
is a 201 body (`api-key-routes.ts:142`); `toMasked` strips `key_hash`
(`api-key-store.ts:58-73`) and every read path goes through it. The CLI prints
to stdout and writes no file (`cli/src/commands/api-keys.ts:283-295`). No path
in `packages/server/src` logs the `Authorization` header or the token, and
`validateApiKey` logs nothing on the success path. Clean.

**C4 — masking is implemented twice.** `validateApiKey` hand-builds its
`ApiKeyMasked` field by field (`api-key-middleware.ts:107-120`) instead of
calling `toMasked`, which is not exported. They agree today. Class 17's field-list
shape: the next field added to `ApiKeyMasked` reaches one copy. Export `toMasked`
and use it.

**C5 — realtime does not accept keys, and that is fail-closed.**
`packages/server-postgres/src/websocket.ts:207-268` (and the Mongo twin) parse
the auth frame's token as a service key or a JWT only; an `rk_` token produces
`AUTH_ERROR / INVALID_TOKEN`. Documented at `docs/backend/api.md` ("No realtime
over API keys"). A capability gap, not a hole — worth restating only because a
permission model enforced on one transport and absent on another is the shape
this audit was looking for, and here the absent transport refuses rather than
admits.

**C6 — no admin-UI surface.** Nothing in `packages/admin` or `packages/app`
references API keys; management is CLI + SDK only. Relevant to M2: the CLI's
`Permissions: none` line (`cli/src/commands/api-keys.ts:137`) is the only place
a human sees a key's scope, and it does not print the `admin` flag at all.

---

## Checked and clean

* **One authentication entry point.** Every transport that accepts `rk_` funnels
  through `validateApiKey` — `createAuthMiddleware` (`middleware.ts:339-347`),
  `createAdapterAuthMiddleware` (`adapter-middleware.ts:63-72`) and
  `createApiKeyPreAuth` (`api-key-middleware.ts:268-282`). Revocation and expiry
  are therefore checked on every surface by construction, not by four
  remembered call sites.
* **Revocation is immediate.** `findByKeyHash` hits the database on every
  request (`api-key-store.ts:257-266`); there is no key cache anywhere. The only
  cached state is the `last_used_at` write debounce
  (`api-key-middleware.ts:146-160`), which is per-process, bounded by the number
  of keys, and touches no authorization decision.
* **Expiry is checked on the request path**, not only at creation
  (`api-key-middleware.ts:93-98`); `POST` additionally refuses a past
  `expires_at` (`api-key-routes.ts:117-125`).
* **The zero state fails closed.** An unparseable `permissions` JSONB becomes
  `[]` (`api-key-store.ts:78-86`) and all three guards loop and `return false`
  (`api-key-permission-guard.ts:57-63`, `:109-117`) — the reference case
  `docs/bug-classes.md` §1 cites, still true.
* **The RLS identity cannot pass for the platform.** `uid` is
  `api-key:<id>` and roles are `["service"]` / `["admin","service"]`
  (`api-key-middleware.ts:101-102`); `isTrustedServerContext` tests
  `uid === "service"` (`saas/backend/src/utils/auth-context.ts:81-83`) and
  `actingUserId` deliberately keeps `api-key:<id>` out of `RESERVED_UIDS`
  (`:107-111`). A key cannot reach the decrypt-for-the-platform path of
  bug-class 15.
* **No RLS bypass.** `scopeDataDriver` runs every key request as `rebase_user`
  (`rls-scope.ts:71-81`); a `withAuth` failure is a 500, never a fallback to the
  unscoped driver (`api-key-middleware.ts:128-140`). A non-admin key matches
  neither arm of the injected default policy
  (`common/src/util/auth-default-policies.ts`), and owner-style rules never
  match its synthetic uid.
* **A key cannot exceed its creator.** Creation requires `requireAdmin` after
  `createRequireAuth` (`api-key-routes.ts:79-83`), so the only creators are
  admin users and the service key; there is no self-service path and no
  inheritance to get wrong.
* **A key cannot read, create, update or revoke keys.** `rejectApiKeyAuth`
  covers the whole router including `GET` (`api-key-routes.ts:59-67`,
  mounted at `:82` before `requireAdmin` so the 403 explains itself). The
  transitive path via user administration is M2; the direct path is closed.
* **`rebase.api_keys` is taken back off the end-user role on every boot**, in
  its own contained DDL step that survives a lost race on the steps above it
  (`api-key-store.ts:203-221`, `common/src/util/internal-tables.ts:114-132`).
  A user-context query cannot reach the table to mint itself an admin key.
* **All twelve REST route registrations consult the guard** — `count`, list,
  get, `bulk`, `bulk` PATCH, `bulk/delete`, create, update (PATCH and PUT share
  one handler), delete, and the five subcollection handlers
  (`api-generator.ts:213, 225, 279, 402, 456, 519, 561, 696, 755, 857, 967,
  1001, 1039`). History routes too, through the same predicate
  (`history-routes.ts:71-77`), with a second RLS check by fetching the row
  through the scoped driver. Class 17's call-site axis is covered here; the
  defect is in *what* is checked (H1, M3), not in *whether*.
* **Middleware ordering is right on all three guarded routers.** Storage
  registers `apiKeyPreAuth` + guard before `storageRouter.route("/", …)`
  (`init.ts:1334-1352`, with the Hono-ordering post-mortem in the comment);
  functions registers the guard before `fnRoutes` (`init.ts:1695`, `:1720-1721`);
  the `/admin/*` pre-auth is an `app.use` at `:980`, before the routes mounted
  at `:1093-1101`. `requireAuth` and `createRequireAuth` both respect an
  upstream-resolved user (`middleware.ts:88`, `:134`), so the admin gates see
  the key rather than re-parsing `rk_` as a JWT.
* **Malformed percent-encoding in a function name** falls back to the raw
  segment rather than throwing, and the raw segment matches no
  `functions/<name>` entry (`api-key-middleware.ts:234-241`) — fail-closed, with
  the reasoning written down.
* **CLI has no silent full-access default**: `create` refuses without
  `--permissions` or `--full-access` (`cli/src/commands/api-keys.ts:216-228`),
  and strict flag parsing stops an undeclared flag becoming the key's name.
* **The docs match the code**, including the parts that are inconvenient — the
  `"*"`-is-not-read-only warning, the "scoped key reads zero rows until a rule
  grants `service`" section, the realtime gap, and the self-management refusal
  (`website/src/content/docs/docs/backend/api.md:295-430`). H1, M3 and M4 are
  each places where the code does not match *these* docs.

---

## Open questions

1. **How much of H1/M3/M4 does RLS actually absorb in a real deployment?** Not
   answerable without a live database. The mitigation is entirely a function of
   whether the project wrote a `service`-role rule per operation or one blanket
   rule; the docs' own example (`{ operation: "select", roles: ["service"] }`)
   is per-operation, which is the good case. Someone should measure the shipped
   examples and the scaffold.
2. **Does anything in the wild depend on `write`-without-`delete`?** If the
   pairing is rare, H1's fix is free; if common, the fix changes behaviour for
   keys currently able to bulk-delete, and should land with a release note.
3. **Storage's own authorization for `roles: ["service"]`** was not read here
   (unit 31's scope). A deployment on `storageInsecureAllowAnyAuthenticated`
   presumably treats a key as any authenticated caller, which would make the
   storage permission entry the only gate — raising M4's severity. Worth a
   cross-check.
4. **Is `rebase.api_keys` covered by `rls:check` / `policy-drift`?** It has no
   RLS by design and relies solely on the boot-time `REVOKE`. If the scanner
   only inspects policies, nothing verifies the revoke actually landed on a
   given deployment — and `ensureTable` returns early without revoking when the
   table is unreadable (`api-key-store.ts:203-210`), which is a state that logs
   loudly but is not asserted anywhere.
5. **The saas control plane's own key handling** (`saas/`) was out of scope and
   is a separate codebase with its own `api_keys` story.
6. **No audit trail.** Nothing records which key performed a mutation — only
   `last_used_at`, debounced to the minute. After an H1 or M4 event there is no
   way to attribute the deletions to a key. Out of scope for a fix here, but it
   is what makes each of these findings hard to detect after the fact.
