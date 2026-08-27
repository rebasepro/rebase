# Unit 27 — Secrets and encryption

Read-only audit, 2026-08-09, against `main` (`c678e1745`). Scope: every secret the
platform mints, stores, derives, compares or injects — `packages/server/src/auth/crypto-utils.ts`,
`mfa-crypto.ts`, `jwt.ts`, `password.ts`, the API-key store, the webhook signer,
and (read-only) the SaaS control plane's `ENCRYPTION_KEY` machinery, tenant
credential derivation, and the collections that hold customer secrets.

Never audited on its own before.

---

## Verdict

**The primitives are right and the storage decisions are right; the gap is
lifecycle.** Every comparison of a secret in this repository is constant-time —
there is not one `===` on a credential anywhere in `packages/*/src` or
`saas/backend`. Every secret written to a customer's row is AES-256-GCM at rest
with a random per-value IV. `ENCRYPTION_KEY` is genuinely mandatory and genuinely
fails closed, in every mode, with a message that says what it protects. The
`afterRead`-decrypts-for-everyone bug (bug-classes #15) is fixed and gated by an
observation test.

Two things are wrong.

The first is that **`mfa-crypto.ts` was fixed alone.** Its docblock now describes
a key-stamped ciphertext, a previous-key list and a rotation procedure. Three
other secrets in this codebase have exactly the shape it just grew out of —
unstamped ciphertext, key resolved from the environment at call time, no
previous-key list — and one of them, `saas/backend/functions/ssh-keygen.ts`, is
line-for-line the same code with the same `DEDICATED || JWT_SECRET` fallback.
`ENCRYPTION_KEY` is the largest instance: it cannot be rotated at all, and it is
also the seed of every tenant service key, so rotating it would both destroy the
data and re-issue the credentials in one step. Password hashes are the third:
`salt:hash` with no algorithm or cost stamp, so the `SCRYPT_PARAMS` constant
that a docblock explicitly invites the next person to raise cannot be raised.

The second is a single endpoint. **`POST /api/functions/setup-key/validate` is
unauthenticated and returns rows read through `rebase.dataAsAdmin`** — which is
precisely the identity the encryption hook decrypts for. So it hands the caller a
plaintext database connection string, a plaintext SSH private key and a plaintext
S3 secret, in a response body, for a credential that is itself stored in
plaintext in a table. The only consumer in this repository reads three
non-secret fields off the response and discards the rest. This is bug-classes
#15 recurring one layer up: the hook now asks "decrypt for whom", and the answer
is "for the platform" — but nobody asked what the platform then does with it.

Non-blocking for the OSS framework. Blocking for the control plane.

---

## Inventory

Every secret the platform holds. "Rotatable" means: can the value be changed on a
live deployment without destroying data or signing everyone out?

| # | Secret | Where it lives | Protected at rest by | Who can read it | Rotatable |
|---|---|---|---|---|---|
| 1 | `ENCRYPTION_KEY` (control plane) | `rebase-saas-secrets` k8s Secret, key `encryption-key`; `saas/.env` locally | Kubernetes Secret (etcd) / file mode of `.env` | control-plane pods; anyone with `get secret` in `rebase-saas` | **No.** No key stamp, no previous list. See M1 |
| 2 | Project env vars (customer Stripe keys, signing secrets) | `project_env_vars.value` | AES-256-GCM under #1, `iv:tag:ct` base64 | control plane only; `POST /env-vars/reveal`, owner-gated, per key | Only by rotating #1 |
| 3 | `databases.connectionString` | `databases` row | AES-256-GCM under #1 | control plane; `POST /db-info/reveal`, owner-gated. **Also H1** | Only by rotating #1 |
| 4 | `databases.sshPrivateKey` | `databases` row | **Double-wrapped**: SHA-256(`SSH_PRIVATE_KEY_ENCRYPTION_KEY \|\| JWT_SECRET`) inner, then #1 outer | control plane. **Also H1** | **No**, on either layer. See M2 |
| 5 | `storages.s3SecretAccessKey` | `storages` row | AES-256-GCM under #1 | control plane. **Also H1** | Only by rotating #1; the GCS HMAC key itself is re-mintable per project |
| 6 | `clusters.kubeConfigData`, `hetznerApiToken`, `backupSecretAccessKey` | `clusters` row | AES-256-GCM under #1 | control plane only (console cannot read the collection) | Only by rotating #1 |
| 7 | `database-webhooks.secret` (outbound HMAC) | `database_webhooks` row | AES-256-GCM under #1 | control plane; signs `X-Webhook-Signature` | Yes — it is a per-webhook value the owner can replace |
| 8 | `JWT_SECRET` (control plane) | `rebase-saas-secrets`, key `jwt-secret` | Kubernetes Secret | control-plane pods | Partially. Rotating signs everyone out **and silently breaks #4, #9, #10, #11, #12** |
| 9 | Tenant per-project JWT secret | derived: `HMAC-SHA256(JWT_SECRET, projectId)`; materialised into a per-tenant k8s Secret | Kubernetes Secret in the tenant namespace | control plane; the tenant's own pod | Only with #8, and only on redeploy |
| 10 | Tenant DB passwords (`app`, superuser) | derived: `HMAC-SHA256(JWT_SECRET, "db-password:"+id)`, 32 hex | never stored | control plane; the tenant pod via `DATABASE_URL` | Only with #8; converges on re-provision |
| 11 | Shared-pool tenant password | derived: `HMAC-SHA256(JWT_SECRET, "shared-db:"+pool+":"+project)` | never stored | control plane; tenant pod | Only with #8 |
| 12 | Domain-verification token | derived: `HMAC-SHA256(DOMAIN_VERIFICATION_SECRET \|\| JWT_SECRET, domain)` | never stored | published in DNS by design | Rotating #8 invalidates every pending verification |
| 13 | Tenant service key `rsk_…` | derived: `HMAC-SHA256(ENCRYPTION_KEY, "tenant-service-key:v1:"+id)` | never stored; injected as `REBASE_SERVICE_KEY` | control plane; the tenant pod | **Yes** — bump the `v1` label, then redeploy the fleet. The one secret here with a real rotation story |
| 14 | Tenant metrics token `rmt_…` | derived: `HMAC-SHA256(ENCRYPTION_KEY, "tenant-metrics-token:v1:"+id)` | never stored; injected as `REBASE_METRICS_TOKEN` | control plane; tenant pod | Yes, same label bump |
| 15 | Setup key `rsk_…` (one-time cloud link) | `setup_keys.key` | **plaintext** | org members of the project (RLS), platform admins | n/a — 24 h TTL, single use. See H2 |
| 16 | `REBASE_SERVICE_KEY` (a framework backend's own) | `.env`, mode 0600, written by `rebase init` | filesystem | the process; anyone with the file | Yes — restarts only invalidate nothing, it is compared not signed |
| 17 | `JWT_SECRET` (a framework backend's own) | `.env`, mode 0600, `crypto.randomBytes(32)` | filesystem | the process | Yes, at the cost of signing every session out |
| 18 | `MFA_ENCRYPTION_KEY` / `MFA_ENCRYPTION_KEY_PREVIOUS` | env only | n/a | the process | **Yes** — `v1.<keyId>` stamp + previous list + re-wrap on next sign-in. The reference implementation |
| 19 | TOTP secrets (`mfa_factors.secret`) | auth table | AES-256-GCM under SHA-256(#18 or `JWT_SECRET`), key-id stamped | the server | Yes, via #18 |
| 20 | User passwords | `users.passwordHash` | scrypt N=16384 r=8 p=1, 32-byte salt, `salt:hash` | the server | **Parameters not rotatable.** See M3 |
| 21 | Refresh tokens | `refresh_tokens` | SHA-256 of a 40-byte random token | the server | Yes — rotated on every use, sliding TTL |
| 22 | Service API keys `rk_live_…` | `rebase.api_keys.key_hash` | unsalted SHA-256 of a 16-byte random key; table revoked from the end-user role at every boot | the server | Yes — mint and revoke, per key |
| 23 | OAuth client secrets (Google, GitHub, Microsoft, …) | env only, never persisted | n/a | the process | Yes, at the provider |
| 24 | S3/GCS storage credentials (framework) | `S3_SECRET_ACCESS_KEY[__SOURCE]` env | n/a | the process | Yes, at the provider |
| 25 | Postgres password (scaffold) | `.env` `DATABASE_PASSWORD`, `randomBytes(16)` | filesystem 0600 | the process, docker-compose | Yes |

Cross-cutting: **two root keys, and everything hangs off them.** `JWT_SECRET`
seeds rows 4, 9, 10, 11, 12; `ENCRYPTION_KEY` seeds rows 2–7 and 13–14. Only row
13/14's derivation carries a version label. The deliberate separation of the two
domains — documented at `saas/backend/src/utils/tenant-service-key.ts:21-29` — is
good design and worth keeping; the gap is that neither root can move.

---

## Findings

### HIGH

#### H1 — An unauthenticated endpoint returns decrypted customer secrets

`saas/backend/functions/setup-key.ts:83-176`

`POST /api/functions/setup-key/validate` takes `{ projectId, setupKey }`, with no
session — "Does NOT require auth — the setup key IS the authentication"
(`:80-81`). It then reads the project's `databases` and `storages` rows through
`rebase.dataAsAdmin` (`:140-153`) and returns them whole (`:166-176`).

`rebase.dataAsAdmin` is scoped as `{ uid: "service" }`
(`saas/backend/src/utils/auth-context.ts:20`), which is exactly the identity
`isTrustedServerContext` admits, so the encryption hook decrypts on the way out
(`saas/backend/src/hooks/encryption-hooks.ts:71-89`). The response body therefore
carries, in plaintext:

- `databases.connectionString` — the tenant's Postgres URL, credentials included;
- `databases.sshPrivateKey` — the tunnel key;
- `storages.s3SecretAccessKey` — for every storage source on the project, since
  `:150` deliberately drops the `limit: 1`.

The only consumer in this repository is `linkScaffoldToCloud`
(`packages/cli/src/commands/init.ts:434-459`), and it reads `body.project.id`,
`body.project.subdomain` and `body.project.name`. Nothing reads `database` or
`storage` at all.

This is bug-classes #15 one layer up. The hook was fixed to ask *decrypt for
whom*, and answered "for the platform". Nobody then asked what the platform does
with the plaintext, and here it writes it to an HTTP response, a CLI's memory, and
whatever proxy sits in front of `app.rebase.pro`.

**Failure scenario.** A setup key leaks — from shell history (`--setup-key` is a
command-line argument, `init.ts:294`), from a CI log, from a screenshot in a
support thread, or from H2 below. Within its 24-hour window the holder POSTs it
and receives root on the project's database and its object storage. No session,
no org membership, no audit record beyond one `logger.info`.

**Fix direction.** Return the fields the linking flow actually needs — the
project's id, subdomain, name, and at most the *non-secret* database and storage
shape. If a scaffold genuinely needs a connection string, make that its own
owner-gated reveal, the way `db-info.ts:237` already does it. The general rule the
codebase is missing: a route that reads through `dataAsAdmin` and serialises the
result is a decrypt-for-the-caller path, whatever the hook thinks.

#### H2 — The setup key is stored in plaintext

`saas/config/collections/setup-keys.ts:25-29`, `saas/backend/functions/setup-key.ts:60-66`

`setup_keys.key` is a plain `string` column with a uniqueness constraint. It is
not hashed the way refresh tokens (`jwt.ts:222`) and API keys
(`api-key-store.ts:44`) are, and it is not in `ENCRYPTED_FIELDS`
(`encryption-hooks.ts:10-15`). The RLS policy `setup_keys_owner_all`
(`setup-keys.ts:68-76`) admits every member of the owning organization, and the
default admin policy admits platform admins.

So the credential that H1 exchanges for a database password is readable, in the
clear, by anyone who can read one row — via the admin panel, via
`GET /api/data/setup-keys`, or via a database dump. Rows are never deleted; they
are marked `used`/`expired`, so a leaked backup contains every key ever issued
along with the project each one opens.

**Fix direction.** Store `sha256(key)` and look up by hash, exactly as
`findByKeyHash` does. The plaintext is returned once at generation
(`:70`) and never needed again. That change alone also removes the
plaintext-in-backup exposure without touching the flow.

Secondary, same file: `/validate` is check-then-act (bug-classes #19) — the row is
read at `:97`, and `status: "used"` is written at `:156`, so two concurrent
requests carrying one key both succeed. Claim the key in the update's `WHERE`
(`... AND status = 'active' RETURNING`) and act only if a row comes back.

### MEDIUM

#### M1 — `ENCRYPTION_KEY` cannot be rotated

`saas/backend/src/utils/encryption.ts:63-131`

The ciphertext is `iv:authTag:ciphertext`, base64, and records nothing about
which key produced it. `decrypt` takes exactly one key. There is no
`ENCRYPTION_KEY_PREVIOUS`, no trial decryption, and no re-wrap-on-read. This is
the pre-fix `mfa-crypto` shape verbatim, and `DISASTER-RECOVERY.md:77` already
records the consequence as an operational rule: the key "must be the same key
that was in use when" the data was written.

The blast radius is larger than MFA's was, in two directions at once:

1. **Data.** Every project env var, every connection string, every kubeconfig,
   every Hetzner API token, every S3 secret and every webhook secret becomes
   permanently unreadable. `decryptIfEncrypted` throws, `tenantEnvFromRows`
   (`env-var-hooks.ts:197-203`) logs and *drops* the variable, and every managed
   tenant redeploys with a silently empty environment.
2. **Identity.** `tenantServiceKey` and `tenantMetricsToken` are HMACs *keyed by
   this value* (`tenant-service-key.ts:69`, `:102`). Rotating it re-issues every
   tenant's admin credential in the same instant, so Studio and metrics break for
   the whole fleet until every tenant redeploys.

That second half is the "one secret derived from another" hazard the audit brief
asks about, and it is the sharper of the two: the derivation is *documented as
rotatable* by bumping the `v1` label, which is true and good — but the label bump
and a key change are indistinguishable to the tenant, and only the label bump is
survivable.

**Fix direction.** Port the `mfa-crypto` pattern: stamp `v1.<keyId>` where
`keyId` is the first 8 hex of `sha256(key)`, accept an unstamped ciphertext as
legacy, read `ENCRYPTION_KEY_PREVIOUS` as a comma-separated list, and re-wrap on
read wherever the read path can persist (the `afterRead` hook cannot, so it wants
a background re-wrap sweep or a re-wrap in `beforeSave`). Keep the derivation
label independent of the key so #13/#14 can still rotate on their own.

#### M2 — `ssh-keygen.ts` is the unfixed twin of `mfa-crypto`

`saas/backend/functions/ssh-keygen.ts:12-44`

```ts
const secretKey = process.env.SSH_PRIVATE_KEY_ENCRYPTION_KEY || process.env.JWT_SECRET;
...
const key = createHash("sha256").update(secretKey).digest();
return `${iv.toString("hex")}:${authTag}:${encrypted}`;
```

`DEDICATED || JWT_SECRET`, SHA-256-derived, unstamped, key re-resolved from the
environment on every call. This is the code `mfa-crypto.ts:9-32` was rewritten to
stop being, and the docblock there names the exact outage: setting the dedicated
variable on a deployment that had been falling back makes every stored value
throw. Here the stored value is a tenant's SSH private key.

Worse than MFA's version in two ways:

- The value is **double-wrapped**. `encryptPrivateKey` produces `hex:hex:hex`,
  which `isEncrypted` rejects (`encryption.ts:158-164` decodes the first segment
  as base64 and requires 12 bytes; 24 hex characters decode to 18), so the
  collection hook encrypts it *again* under `ENCRYPTION_KEY`. Opening it needs
  both keys; losing either loses the key. Neither is rotatable.
- Rotating `JWT_SECRET` alone breaks it **silently**. Sessions are expected to
  drop on a `JWT_SECRET` rotation, so the operator is watching for that; nothing
  reads the SSH key until the next tunnelled backup, which then fails with a raw
  GCM error far from the change.

**Fix direction.** The same stamp-and-candidate-list as `mfa-crypto`, and drop
the double wrap: either the field is in `ENCRYPTED_FIELDS` or `ssh-keygen`
encrypts it, not both. Preferably the former, so there is one key and one format
for everything in `databases`.

#### M3 — Password hashes carry no algorithm or cost stamp

`packages/server/src/auth/password.ts:22-24, 67-90`

`hashPassword` returns `salt:hash`. `SCRYPT_PARAMS` sits above it under a comment
(`:17-21`) explaining that the parameters are now passed explicitly so that "the
next person to strengthen this needs the edit to take effect" — but the edit
cannot take effect. `verifyPassword` re-derives with the *current* constants and
compares; raising `N` makes every existing password fail to verify, with no
signal distinguishing "wrong password" from "hashed under the old cost".

Same class as the MFA key, same fix shape: the stored value has to say what
produced it. Also:

- `timingSafeEqual(derivedKey, storedKey)` at `:89` throws `RangeError` when the
  buffers differ in length. A truncated or foreign hash in the column (a
  migration from bcrypt, a `varchar` that clipped) turns a login into a 500
  instead of a `false`. Wrap it, or compare lengths first — the value being
  compared is a derived key, not the secret, so an early length return leaks
  nothing.
- 8 characters with one upper, one lower and one digit (`:38-61`) is a 2010-era
  policy that rejects a strong passphrase and accepts `Passw0rd`. Out of scope
  here, but it lives in this file.

### LOW

#### L1 — The shipped Secret manifest omits the mandatory key

`saas/infra/gcp/saas-secrets.yaml:7-21` declares `postgres-password`,
`database-url`, `jwt-secret` and `rebase-service-key`. It does not declare
`encryption-key`, which `saas/infra/gcp/saas-control-plane.yaml:245-246` mounts
and which the backend refuses to boot without. Applying the documented manifests
to a fresh cluster yields a CrashLoopBackOff. It fails closed, which is right —
but the file that is supposed to enumerate the platform's secrets is missing the
most important one, and `mfa-encryption-key` too.

#### L2 — `MFA_ENCRYPTION_KEY` is unvalidated and undiscoverable

`packages/server/src/auth/mfa-crypto.ts:79-90` accepts any non-empty trimmed
string and SHA-256s it into a 32-byte key. A one-character value is accepted
silently. Compare `ENCRYPTION_KEY`, which is pinned to 64 hex
(`encryption.ts:9`), and `JWT_SECRET`, which has a 32-character floor
(`env.ts:93`) plus a weak-value deny-list (`jwt.ts:49-83`).

It is also in no `.env.example`, not in `rebaseEnvSchema`, and not checked by
`rebase doctor` — the gap `docs/audits/20-mfa.md:273` recorded and which the
rotation fix did not close. It is documented in exactly one place,
`website/src/content/docs/docs/backend/authentication.md:220`.

#### L3 — `/metrics` is world-readable when no token is set

`packages/server/src/metrics/index.ts:326-334`: `if (token) { …check… }`. Absent
token means no check. Managed tenants always get one
(`deploy.ts:978-979`), so this is a self-hosted concern, and metrics are not
credentials — but it is the shape bug-classes #10 warns about, and the fix is a
one-line inversion plus a boot log.

#### L4 — JWT verification failures log token material and full payloads

`packages/server/src/auth/jwt.ts:207` logs `detail: token.substring(0, 15)`
(header only, low value to an attacker) and `:210` logs `detail: decoded` — the
entire decoded payload, including `roles` and any `email`/`displayName` custom
claims — at `error` level. `detail` matches none of
`SENSITIVE_KEY_FRAGMENTS` (`logger.ts:80-92`), so the redactor passes it through
verbatim into stdout and thence into Cloud Logging.

#### L5 — `PLATFORM_MANAGED_KEYS` no longer means what its comment says

`saas/backend/src/hooks/env-var-hooks.ts:24-42` states the invariant plainly:
"**it is exactly the set of names the platform writes**". The platform also
writes `REBASE_METRICS` and `REBASE_METRICS_TOKEN`
(`saas/backend/functions/deploy.ts:975-980`), and neither is in the list. Today
the platform's values win because they are applied last, so a customer variable
of that name is silently dropped — which is precisely the "lie" the reserved list
exists to turn into an honest error. `env-vars.test.ts` is documented as
asserting the list agrees with the injectors; whatever it compares, it does not
compare these two.

#### L6 — `rsk_` names two different credentials

`saas/backend/src/utils/tenant-service-key.ts:55` defines `rsk_` as the tenant
service key prefix, whose stated purpose is that "an accidental paste [is]
recognisable" and distinguishable from an `rk_` API key.
`saas/backend/functions/setup-key.ts:55` mints setup keys with the same `rsk_`.
One is a permanent admin credential on a tenant API; the other is a 24-hour
single-use token. A prefix that cannot tell them apart is not doing the job it is
documented to do.

#### L7 — A missing `NODE_ENV` generates a per-pod encryption key

`saas/backend/src/env.ts:39-47`: `nodeEnv` defaults to `"development"` when
unset, and the dev-key branch runs whenever it is not `production` or `test`. A
production container that loses `NODE_ENV` therefore generates a fresh
`ENCRYPTION_KEY`, persists it to a path inside the container, and boots
successfully — each replica with a different key, each writing secrets the others
cannot read, with only a `console.warn` to say so. Mitigated today by
`saas/Dockerfile:61` and `saas-control-plane.yaml:159-160`, both of which set it.
The guard should be positive (`nodeEnv === "development"`), so an unset or
misspelled value refuses rather than improvises.

#### L8 — Internal error text is echoed to API callers

`saas/backend/functions/ssh-keygen.ts:89-93` and `setup-key.ts:71-73, 175-177`
return `errorMessage(err)` in the 500 body. The decrypt failure message
(`encryption.ts:122-127`) names `ENCRYPTION_KEY` and its failure modes but not
its value, so nothing secret leaks today; it is the pattern that is wrong — the
next error thrown on that path decides what a caller learns.

---

## Checked and clean

- **Constant-time comparison, everywhere.** `safeCompare`
  (`crypto-utils.ts:19-44`) sizes its padding by *byte* length before
  `timingSafeEqual` and folds the length check in after, so neither a multi-byte
  character nor an early return leaks. Every consumer uses it: the service-key
  paths (`middleware.ts:149`, `:323`; `builtin-auth-adapter.ts:136`, `:174`), the
  realtime `AUTHENTICATE` frame (`server-postgres/src/websocket.ts:235`) and the
  metrics scrape (`metrics/index.ts:332`). `bundle-store.ts:87-100` reimplements
  it rather than importing, but reimplements it *correctly* and says why. A grep
  for `token ===`, `secret ===`, `key === ` and friends across `packages/*/src`
  and `saas/backend` returns zero credential comparisons.
- **`mfa-crypto` rotation itself.** The `v1.<keyId>` stamp is derived from the
  key (no registry to drift), the legacy 3-part format is still accepted and
  trial-decrypted, GCM's tag makes trial decryption safe, an unknown key id
  throws loudly and names the ids it does have, and the `rewrapped` value is
  actually persisted (`mfa-routes.ts:106-114`) rather than computed and discarded
  — bug-classes #20 avoided. `decryptTotpSecret`, the wrapper that would drop it,
  has no call sites in `src`.
- **`ENCRYPTION_KEY` fails closed in every mode.** 64-hex pattern
  (`encryption.ts:9`), asserted at boot and again on every sensitive write
  (`:26-43`), with `encryptForStorage` throwing rather than passing plaintext
  through (`:177-182`). The docblock records that it used to degrade gracefully
  and stores the plaintext, and says that mode is not allowed back.
- **`isEncrypted` checks decoded widths, not just the alphabet**
  (`encryption.ts:138-165`), so a config value shaped `abc:def:ghi` is no longer
  mistaken for ciphertext and skipped by the encryptor.
- **Decrypt-for-the-platform-only.** `encryption-hooks.ts:71` gates on
  `isTrustedServerContext`, and `auth-context.ts` documents the
  `context.user === undefined` trap that made two earlier hooks wrong. Env vars
  go further and register no `afterRead` at all, returning stored bytes rather
  than a mask — the read-modify-write reasoning at `env-var-hooks.ts:250-260` is
  correct and worth keeping.
- **Reveal endpoints are deliberate and gated.** `db-info.ts:237` and
  `env-vars.ts:196` both require `verifyProjectOwner` and release one value on an
  explicit action; env vars additionally support a write-only `secret: true` that
  even `/reveal` refuses.
- **Log redaction is centralised.** `logger.ts:59-100` strips Drizzle's
  `Failed query: … params: …` wrapper and denies eleven key fragments at any
  depth, in the one function every line passes through; the docblock explains why
  a per-call-site rule was the bug. The raw-query escape hatch is ignored in
  production. `env.ts:227-232` deliberately does not echo the *value* of a
  variable that failed the localhost check, for the same reason.
- **No secret reaches the client bundle.** No `VITE_`/`import.meta.env` reference
  to a secret in `packages/cms`, `packages/app`, `packages/client` or
  `saas/frontend`; `saas/frontend/src/test/env-vars.test.ts:217` asserts it.
- **Boot refuses weak and default values.** `configureJwt`
  (`jwt.ts:47-89`) enforces ≥32 characters and a 19-entry deny-list that includes
  the two `rebase_saas_*` placeholders; `saas/backend/src/index.ts:135-150` names
  the historic defaults explicitly. `loadEnv` auto-generates `JWT_SECRET` and
  `REBASE_SERVICE_KEY` only outside production and **fails validation** if an
  auto-generated one is present in production (`env.ts:213-220`) — the
  "random-per-pod secret" failure mode the brief asks about is closed on the
  framework side, and the dev path warns that tokens will not survive a restart.
- **`rebase init` writes real secrets with the right file mode.** `.env` is
  `chmod 0600` before the generated `JWT_SECRET`, `REBASE_SERVICE_KEY` and
  `DATABASE_PASSWORD` are written (`init.ts:1108-1130`), and the docblock records
  that copying `.env.example` used to leave it 0644. The `changeme` compose
  default is now always overridden by a written `DATABASE_PASSWORD`
  (`:1244-1266`).
- **Token hygiene.** Refresh tokens are 40 random bytes stored as SHA-256
  (`jwt.ts:216-224`), rotated on use. `verifyAccessToken` pins
  `algorithms: ["HS256"]` and rejects any token carrying a `purpose` claim, so a
  download token or an MFA-pending token can never authenticate a session
  (`jwt.ts:181-212`, `:296-311`).
- **API keys.** 16 random bytes, SHA-256 at rest, looked up by hash so no
  comparison timing exists; the table is revoked from the end-user role on every
  boot as a security control that survives a lost DDL race
  (`api-key-store.ts:198-221`); `toMasked` strips `key_hash` from every response
  shape. The hash is unsalted and unpeppered, which is acceptable for a 128-bit
  random key with a fixed prefix — noted, not a finding.
- **Outbound webhook signing** uses `HMAC-SHA256` over the exact body sent
  (`webhook-service.ts:257-260`), the destination is SSRF-checked, and redirects
  are refused rather than followed so a signed POST cannot be replayed at an
  address the guard never saw.
- **Derivation domain separation.** Three distinct labels
  (`tenant-service-key:v1:`, `tenant-metrics-token:v1:`, `shared-db:<pool>:`,
  `db-password:`/`db-app-password:`), each documented, so a leaked metrics token
  cannot be replayed as a service key. The choice of `ENCRYPTION_KEY` over
  `JWT_SECRET` for the tenant service key is argued explicitly at
  `tenant-service-key.ts:21-29` and is the right call.
- **Reserved env names.** `DATABASE_URL`, `JWT_SECRET` and `REBASE_SERVICE_KEY`
  are refused at every write path, with the reasoning spelled out; the
  Docker path additionally relies on last-one-wins ordering as a second line
  (`orchestrator.ts:1192-1204`). See L5 for the two names that escaped the list.

---

## Open questions

1. **Does anything outside this repo read the `database`/`storage` half of the
   `setup-key/validate` response?** The in-repo CLI does not. If a console flow
   or an older CLI does, H1's fix needs a deprecation window rather than a
   deletion. UNCONFIRMED.
2. **Is `ENCRYPTION_KEY` under any backup or escrow?** M1 makes losing it
   equivalent to losing every customer secret, and the derivation in #13/#14
   makes it equivalent to losing fleet access as well. `DISASTER-RECOVERY.md:77`
   states the constraint but I did not find a documented custody procedure.
3. **Has `SSH_PRIVATE_KEY_ENCRYPTION_KEY` ever been set in production?** If it
   has not, M2 is still fixable cheaply: everything is under `JWT_SECRET` today
   and can be re-wrapped in one pass. If it has been set at some point, some rows
   are under one key and some under the other, with nothing recording which —
   which is the state the stamp exists to make legible.
4. **What is the intended lifecycle of the `rewrapped` MFA path for a user who
   never signs in again?** Step 4 of the rotation procedure says drop
   `MFA_ENCRYPTION_KEY_PREVIOUS` "once every enrolled user has signed in", but
   nothing reports how many factors are still on an old key id. A count query, or
   a `keyId` column, would make that decidable rather than a guess.
5. **Does `env-vars.test.ts` actually compare `PLATFORM_MANAGED_KEYS` against the
   injectors, or against a hand-copied list?** L5 suggests the latter — the
   bug-classes #17 shape, a feature checked at most of its call sites. Not read
   in this pass.
6. **Are the three sibling checkouts (`saas-bughunt/`, `saas-sweep/`,
   `cloud-fleet-safety/`) live deployments or scratch copies?** Each carries its
   own `encryption.ts` and `ssh-keygen.ts`; if any is deployed, M2 applies to it
   independently. I audited only `saas/`.
