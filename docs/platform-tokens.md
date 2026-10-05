# Platform tokens

How a Rebase Cloud owner reads their own app's admin surfaces, starting with
cron state and history, without holding any static secret. Two halves ship
from this repository: the runtime's verifier and the `rebase cloud cron` CLI.
The control plane's half lives in `saas` and is specified in
[What the control plane must add](#what-the-control-plane-must-add).

## Why

A cron job's run history is persisted to the app's own `rebase.cron_logs`
table and served by `GET /api/admin/cron/:id/logs` behind the admin gate. That
gate accepts three credentials: an admin user of the app, an `rk_` key, or the
service key. A project owner signed in with `rebase cloud login` is a user of
the control plane, not of the app, and often holds none of the three. A fresh
deploy has no admin account yet. Without `REBASE_SERVICE_KEY` set, the runtime
generates a per-boot service key that nobody outside the pod can learn.
`rebase cloud debug logs` reads pod stdout, which covers about 30 minutes.

Handing the owner the service key would make every owner the holder of a
static secret with full admin rights on the app. Platform tokens are the
alternative. The control plane, which already knows who is a member of which
project, signs a token that is short-lived, read-only, and bound to one
project. The app checks the signature with a public key and grants the token
nothing beyond a ceiling written into the app's own code.

```
rebase cloud cron logs nightly
  │ 1. POST /api/functions/runtime-token/<project>   { scopes: ["cron:read"] }
  │    (cloud session or rk_ cloud token — the channel `debug logs` uses)
  ▼
control plane ── checks project:logs, signs rpt_<ES256 JWS> (5 min)
  │
  │ 2. GET https://<project host>/api/admin/cron/nightly/logs
  │    Authorization: Bearer rpt_…   (the address `debug health` probes)
  ▼
runtime ── verifies against REBASE_PLATFORM_TOKEN_KEY, aud, lifetime;
           grants cron:read ∩ token.scope; serves the logs
```

## The runtime contract

Implemented in `packages/server/src/auth/platform-token.ts` and mounted in
front of every admin gate in `init.ts`, next to the `rk_` pre-auth.

**Turning it on.** Both variables must be set. Neither set means the feature is
off, which is every self-hosted server.

| Variable | Value |
| --- | --- |
| `REBASE_PLATFORM_TOKEN_KEY` | One or more PEM-encoded SPKI **EC P-256** public keys (`-----BEGIN PUBLIC KEY-----`). Real newlines, `\n`-escaped, or the whole value base64-encoded. Several blocks may be given during a key rotation, and a token verifies against any of them. |
| `REBASE_PLATFORM_TOKEN_AUDIENCE` | The project's id, exactly as the control plane puts it in `aud`. |

If only one variable is set, or the key is not a P-256 public key, the server
logs a warning and still boots, with platform tokens off. A misconfiguration
on the platform's side should not take a customer's app down.

**The token.** `rpt_` followed by a compact JWS.

| Part | Requirement |
| --- | --- |
| header `alg` | `ES256`. The verifier pins the algorithm. It never reads it from the token. |
| header `kid` | Optional. The runtime ignores it. |
| `iss` | `"rebase-cloud"` |
| `aud` | Equal to `REBASE_PLATFORM_TOKEN_AUDIENCE`. A string or an array containing it. |
| `sub` | Non-empty. The control-plane principal the token acts for. |
| `scope` | Space-separated scopes, for example `"cron:read"`. |
| `iat`, `exp` | Both required. `exp - iat` ≤ 600 seconds. `iat` may be at most 60 seconds ahead of the server's clock. |
| `jti` | Recommended. The runtime logs it. |

**What it grants.** The caller becomes `platform:<sub>`, with no roles, holding
the token's scopes intersected with `PLATFORM_TOKEN_SCOPES`, which is
`["cron:read"]` today. A token that asks for `cron:write` still gets read-only
access, and one that holds no allowed scope is refused. Every other admin
route checks its own scope and answers `403 SCOPE_MISSING`. On the data
plane, a platform token is an invalid session (401). Each accepted request
logs `[Auth] Platform token accepted` with `subject`, `jti`, `scopes`,
`method` and `path`.

Adding a scope to `PLATFORM_TOKEN_SCOPES` means letting the platform do
something new inside customers' apps on a person's behalf. Make that change
on its own, with its own review.

**Refusals.**

| Status, code | Meaning |
| --- | --- |
| `401 PLATFORM_TOKENS_OFF` | An `rpt_` token reached a server with the variables unset or invalid. |
| `401 INVALID_PLATFORM_TOKEN` | Bad signature, wrong issuer or audience, expired, too long-lived, no `sub`, or no grantable scope. The message says which. |
| `403 SCOPE_MISSING` | Valid token, but the route needs a scope the token does not hold. |
| `401 UNAUTHORIZED` "Invalid or expired token" | A runtime from before platform tokens, which parses `rpt_…` as a user session. |

## The CLI

`rebase cloud cron [list]` and `rebase cloud cron logs <job> [--limit N]`
(`packages/cli/src/commands/cloud/cron.ts`). They mint a fresh token on every
run and cache nothing. The token goes only to the app, and the control-plane
credential goes only to the control plane. Errors carry a code for each failure:
`runtime_token_unavailable` (the control plane has no `runtime-token`),
`runtime_token_refused` (the app does not accept the token: an old runtime, or
the platform never injected its key), `cron_not_served`, `not_found`,
`runtime_unreachable`. A `rebase cloud tokens` key needs `--can logs`. That
capability now includes `functions:invoke:runtime-token`.

## What the control plane must add

Everything below is in `saas`. Paths are relative to `saas/backend`.

### 1. A signing key

Use one platform-wide ES256 key. Binding a token to one project is the job of
`aud`, not of the key. Derive the key from `ENCRYPTION_KEY`, the way
`src/utils/tenant-service-key.ts` derives the tenant service and metrics
keys. That way there is no new secret to store, back up or migrate.

```ts
// src/utils/platform-token-key.ts
const LABEL = "platform-token-signing:v1:";
const P256_ORDER = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551n;

export const PLATFORM_TOKEN_KID = "platform-token:v1";

export function platformTokenSigningKey(): KeyObject {
    const seed = createHmac("sha256", Buffer.from(requireEncryptionKey(), "hex")).update(LABEL).digest();
    const d = (BigInt(`0x${seed.toString("hex")}`) % (P256_ORDER - 1n)) + 1n;
    const dBytes = Buffer.from(d.toString(16).padStart(64, "0"), "hex");
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(dBytes);
    const pub = ecdh.getPublicKey(); // 0x04 ‖ x(32) ‖ y(32)
    return createPrivateKey({
        format: "jwk",
        key: {
            kty: "EC", crv: "P-256",
            d: dBytes.toString("base64url"),
            x: pub.subarray(1, 33).toString("base64url"),
            y: pub.subarray(33).toString("base64url")
        }
    });
}

export function platformTokenPublicKeyPem(): string {
    return createPublicKey(platformTokenSigningKey()).export({ type: "spki", format: "pem" }).toString();
}
```

**Rotation.** Bump the label to `v2`. For one deploy sweep, inject both public
keys into `REBASE_PLATFORM_TOKEN_KEY` (the runtime accepts several PEM blocks).
Sign with `v2`. Drop `v1` after the sweep. Tokens live for minutes, so the
overlap needs to last only as long as the sweep.

### 2. Inject the two variables into every tenant

Set them on every path that renders a tenant's container, after the
customer's env so the platform's values win. Kubernetes resolves `env` after
`envFrom`. Both values are public, so they go in as plain `value` entries, not
Secret refs.

```ts
{ name: "REBASE_PLATFORM_TOKEN_KEY", value: platformTokenPublicKeyPem() },
{ name: "REBASE_PLATFORM_TOKEN_AUDIENCE", value: String(projectId) }
```

- `src/k8s/orchestrator.ts`, `provisionManagedDeployment`: add the entries to
  `platformEnv`, next to `platformSecretRef("REBASE_SERVICE_KEY")`. Fleet
  rollouts and rebuilds restate the Deployment through this method, so they
  carry the variables too.
- `src/k8s/orchestrator.ts`, `provisionRebaseDeployment` (the custom path,
  next to its `platformSecretRef("REBASE_SERVICE_KEY")`). A custom image built
  on `initializeRebaseBackend` reads the same variables from `process.env`.
- The docker-run paths that pass `-e REBASE_SERVICE_KEY=…`
  (`src/k8s/orchestrator.ts`, `functions/deploy.ts`) for local tenants.
- `src/hooks/env-var-hooks.ts`: add both names to `PLATFORM_DEPLOYMENT_KEYS`.
  `rebase cloud env set` then refuses them, instead of storing a value that
  the platform's own value silently overrides.

The audience must be the same `projects.id` the CLI puts in the path of
`runtime-token/<id>`.

### 3. `functions/runtime-token.ts`

Custom functions mount with `requireAuth: false`, so the route must check
the caller itself.

```
POST /api/functions/runtime-token/:projectId
body: { "scopes": ["cron:read"] }
```

1. `verifyProjectOwner(c, projectId, REQUIRED[scope])` for every requested
   scope, with `REQUIRED = { "cron:read": "project:logs" }`. That is the same
   project scope that gates `runtime-logs`. On refusal, answer
   `gateRefusal(result)` with its status, as `env-vars.ts` does.
2. An empty `scopes`, or a scope not in `REQUIRED`, is `400 { code:
   "scope_not_issuable" }`, naming the issuable ones. Do not pass unknown
   scopes through: the runtime's ceiling is the last line of defence, not
   the only one.
3. Sign with `platformTokenSigningKey()`, header `{ alg: "ES256", typ: "JWT",
   kid: PLATFORM_TOKEN_KID }`, claims:
   `{ iss: "rebase-cloud", aud: String(projectId), sub, scope: scopes.join(" "),
   iat: now, exp: now + 300, jti: randomUUID() }`. `sub` is the caller's
   `user.uid`. A personal `rk_` cloud token acts as its owner, so that is the
   owner's uid. A control-plane service key gives `"service"`.
4. Answer `200 { token: "rpt_" + jws, expiresAt: <ISO of exp>, scopes }`.
5. Log one line per mint (`sub`, project, scopes, `jti`), so the
   control-plane log and the app's `Platform token accepted` line can be
   matched by `jti`.

A missing project comes back from `verifyProjectOwner` as its usual 404. The
CLI tells that apart from a control plane without this route by the route
404's message (`No route for …`).

### 4. Tokens and the console

`packages/cli/src/commands/cloud/token-capabilities.ts` is the map the
console's token screen also reads. Its `logs` capability now includes
`functions:invoke:runtime-token`. Keys minted before that change need to be
minted again.

### 5. Tests on that side

- Sign a token with `platformTokenSigningKey()`. Verify it with
  `platformTokenPublicKeyPem()` using ES256. Assert every claim above,
  including `exp - iat === 300`.
- Derivation is deterministic across calls and replicas, and changes with
  the label.
- `runtime-token` refuses a non-member (403), an unissuable scope (400), and
  a member without `project:logs` (403).
- Both orchestrator paths render the two variables, and `env set` refuses
  both names.

## Rollout order

1. **Runtime.** Release `@rebasepro/server` with the verifier, and roll the
   managed runtime to it. On its own this changes nothing: without the
   variables the feature is off.
2. **Control plane.** Ship the function and the env injection together.
3. **Tenants.** Each tenant picks up the variables at its next deploy, or
   when a fleet rollout restates its Deployment. For `prospector` that means
   one `rebase cloud deploy` (or a rollout) after step 2.
4. **CLI.** It can ship at any point. Until steps 1 to 3 are done, it reports
   which one is missing instead of failing with a vague error.
