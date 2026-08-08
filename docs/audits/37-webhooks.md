# Audit 37 — Outbound webhooks

**Date:** 2026-08-08 · **Scope:** `packages/server/src/services/webhook-service.ts`, every call
site, and the places webhook destinations are configured (`rebase-agent-skills/skills/rebase-webhooks/`,
`website/src/content/docs/docs/recipes/webhooks.md`, `saas/config/collections/webhooks.ts`).
**Method:** read-only. Nothing was run, edited or fetched.

## Verdict

`WebhookDispatcher` is a 161-line class that does exactly what its tests check and nothing that a
webhook sender has to do to be safe. It calls `fetch(webhook.url)` with **no scheme check, no host
check, no redirect policy and no DNS pinning** — the destination is whatever string the caller put
in the config, and Node's `fetch` will follow up to 20 redirects to wherever the *receiver* points
it. Nothing in the shipped OSS code path builds a `WebhookConfig` from data, so there is no
turn-key remote SSRF today; but the skill that teaches this class tells developers to "load webhook
configs from environment **or database**", and the SaaS already ships a tenant-writable
`database_webhooks.url` column with an admin UI on top of it — a table nothing in the platform ever
reads. The library is the missing guard, not the missing feature. Alongside the SSRF surface, the
delivery engine has a timeout that does not cover the body read (so a slow receiver hangs a
delivery forever), a retry loop that the documented integration pattern runs **inside the write's
Postgres transaction**, a per-*attempt* delivery UUID that makes at-least-once delivery
undedupable, and a payload that is the whole row with no field allowlist. The public docs recipe
does not even use the dispatcher: it teaches a bare, timeout-less `await fetch(...)` in `afterSave`,
which — because `afterSave` errors are rethrown — turns a third-party outage into a rolled-back
customer write.

Counts: **0 critical, 5 high, 6 medium, 8 low.**

---

## HIGH

### H1. The destination URL is never validated — SSRF by construction

`packages/server/src/services/webhook-service.ts:127`

```ts
const response = await fetch(webhook.url, { method: "POST", headers, body, signal: controller.signal });
```

`webhook.url` is typed `string` (`webhook-service.ts:5`) and reaches `fetch` untouched. There is no
scheme allowlist, no rejection of loopback / link-local / RFC1918 / `.internal` hosts, no port
restriction, no proxy, and no DNS resolution step — so `http://169.254.169.254/latest/meta-data/`,
`http://metadata.google.internal/computeMetadata/v1/`, `http://localhost:5432/`,
`http://postgres-rw.rebase-saas.svc.cluster.local:5432/` and `http://kubernetes.default.svc/` are
all ordinary destinations. A repo-wide grep for `ssrf`, `169.254`, `isPrivateIp` and `link-local`
across `packages/*/src` returns nothing: no such guard exists anywhere in the monorepo.

Two things make this a live design defect rather than a hypothetical:

* `rebase-agent-skills/skills/rebase-webhooks/SKILL.md:476` — *"Load webhook configs from
  environment or database"* — is the canonical "shared dispatcher" pattern the skill teaches.
* `saas/config/collections/webhooks.ts:39-43` ships a `url` column with `validation: { required: true }`
  and nothing else, and `saas/config/collections/webhooks.ts:90-98` (`webhooks_owner_all`, mirrored
  into `saas/backend/src/schema.generated.ts:135` as USING **and** WITH CHECK) lets any member of
  the owning organization INSERT or UPDATE that row. The value is unconstrained.

**Failure scenario.** Attacker capability: a signed-up user of any Rebase-built app (or, the day the
SaaS wires its own table, any org member on the free tier) who can write a webhook row. Impact: the
backend pod issues POSTs to any address it can route to, and returns the first 1000 bytes of the
response to the attacker via `WebhookDeliveryResult.responseBody` (`webhook-service.ts:144`) — the
class is a *read* primitive, not just a blind one. On GKE that reaches the node metadata endpoint,
the in-cluster API server and the CNPG `postgres-rw` service. Custom headers
(`webhook-service.ts:114`) let the attacker add `Metadata-Flavor: Google`, which is the only thing
standing between an unauthenticated GET and a GCP service-account token.

**Fix direction.** Validate in the dispatcher, not in the caller: parse with `new URL()`, allow only
`http:`/`https:` (and only `https:` by default), resolve the hostname yourself and reject
loopback/link-local/unique-local/RFC1918/CGNAT/`0.0.0.0`/IPv6-mapped equivalents, then connect to
the *resolved* address (pinning it via a custom `dispatcher`/`lookup`) so the check and the connect
see the same IP. Expose an explicit `allowPrivateNetworks: true` escape hatch for developers who
genuinely webhook to a sidecar, and document that turning it on re-opens this.

### H2. Redirects are followed and never re-validated (defeats any future allowlist)

`packages/server/src/services/webhook-service.ts:127-132`

The `fetch` options set `method`, `headers`, `body` and `signal` — no `redirect`. Node's default is
`redirect: "follow"` (20 hops). So validation of `webhook.url` is validation of hop 0 only.

**Failure scenario.** Attacker capability: control of a webhook receiver (their own public HTTPS
endpoint — allowed by any conceivable allowlist). The endpoint answers `307 Temporary Redirect` with
`Location: http://169.254.169.254/…`; 307 preserves method and body, so the full POST — including
`X-Webhook-Signature` and every custom header except the ones the fetch spec strips cross-origin —
is replayed against the internal address, and the response body comes back in
`WebhookDeliveryResult`. This is also the DNS-rebinding-shaped hole: even a validate-then-fetch
guard that pins the first resolution is bypassed, because the second request is a fresh resolution
the guard never sees.

**Fix direction.** `redirect: "manual"`. Either refuse to follow at all (webhook receivers should
not redirect) or follow a bounded number of hops with the H1 validation re-run on every `Location`.

### H3. The 10s timeout does not cover the response body — a delivery can hang forever

`packages/server/src/services/webhook-service.ts:124-136`

```ts
const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout
const response = await fetch(webhook.url, { …, signal: controller.signal });
clearTimeout(timeout);                                   // ← disarmed here
const responseBody = await response.text().catch(() => "");  // ← unbounded
```

The abort timer is cleared as soon as the *headers* arrive, and the body is only read afterwards.
`response.text()` has no timeout and no size limit; the truncation to 1000 chars at line 144 happens
*after* the entire body has been buffered in memory.

**Failure scenario.** Attacker capability: control of the receiving endpoint (in the SaaS shape,
control of the URL column; in the OSS shape, a compromised or merely broken partner endpoint).
Response: `200 OK`, `Transfer-Encoding: chunked`, then one byte every 60 seconds, forever. The
delivery never completes, never retries, never fails. Combined with H4 that is an unbounded
Postgres transaction; on its own it is an unbounded promise plus an unbounded buffer. A receiver
that instead streams 10 GB of body fast OOM-kills the pod, and the docs' own "10-second timeout"
guarantee (`SKILL.md:20`, `SKILL.md:347-354`) is simply not true.

**Fix direction.** Clear the timer in a `finally`, not between the two awaits; keep the signal armed
across the body read (or arm a second one); cap the body with a streaming reader that stops at ~64 KB
and cancels the rest, instead of `await response.text()`.

### H4. The whole retry sequence runs inside the write's Postgres transaction

`packages/server-postgres/src/PostgresBackendDriver.ts:1680` → `:721-731`;
`rebase-agent-skills/skills/rebase-webhooks/SKILL.md:379-389`

For user-context writes — the REST/SDK path — `AuthenticatedPostgresBackendDriver.save` is
`withTransaction((delegate) => delegate.save(props))` (`:1680`), and `withTransaction` opens a real
transaction and downgrades the role so RLS binds (`:1593-1626`). Inside that transaction, after the
row is written, the base `save` **awaits** `callbacks.afterSave` (`:721-731`). The canonical
integration pattern in the skill puts `await dispatcher.onEntityChange(...)` in exactly that
callback.

So one authenticated write holds one pooled connection and the row's locks for the entire delivery:
attempt (≤10s) + 1s backoff + attempt (≤10s) + 5s backoff + attempt (≤10s) ≈ **36 seconds**
worst case, multiplied by the number of matching webhooks because `onEntityChange` dispatches them
sequentially (`webhook-service.ts:49-61`), and *unbounded* once H3 is in play. This is the shape of
bug-class 16 — a retry loop living inside the transaction — with sleeps instead of doomed queries:
`deliverWithRetry` (`webhook-service.ts:71-86`) is a `for` loop whose failure branch is
`await new Promise(r => setTimeout(r, backoff))`, and every millisecond of it is transaction time.

**Failure scenario.** Attacker capability: none needed beyond a receiver that is slow, or an
attacker who registers a deliberately slow one. Impact: a handful of concurrent writes exhaust the
connection pool; concurrent updates to the same row queue behind the lock; `idle in transaction`
climbs; the app stops serving reads too, because reads take pooled connections as well
(`:1646`, `:1672`). The skill's own gotcha table (`SKILL.md:612`) states the cost as "~6s of
waiting", which is only the sum of the *backoffs* and ignores up to 30s of request timeouts.

**Fix direction.** Deliver out of band: `afterSave` should enqueue (an outbox row written in the
same transaction, or an in-memory queue drained by a worker), never await HTTP. If the awaiting
pattern stays documented, the docs must say plainly that it holds a transaction, and the dispatcher
should carry a total-deadline much shorter than any sane statement timeout. Consider making the
"fire-and-forget" pattern (`SKILL.md:588-593`) the primary one rather than a footnote.

### H5. The published recipe couples an unbounded third-party call into the write, and a failure rolls the write back

`website/src/content/docs/docs/recipes/webhooks.md:24-34`, `:44-61`;
`packages/server-postgres/src/PostgresBackendDriver.ts:776-816`

The public docs page — the one `SKILL.md:616` points readers at — never mentions `WebhookDispatcher`.
It teaches:

```ts
afterSave: async ({ values, id, status }) => {
    if (status === "new") {
        await fetch(process.env.SLACK_WEBHOOK_URL!, { … });   // no signal, no timeout
    }
}
```

Node's `fetch` has no default timeout. Per H4 this runs inside the transaction, so a Slack or
Shopify endpoint that black-holes the connection holds a Postgres transaction open until the OS TCP
timeout (minutes). Worse: the `catch` around the save calls `afterSaveError` and then **rethrows**
(`PostgresBackendDriver.ts:815`), and the whole thing is inside `withTransaction`. So when the third
party returns a connection error, the transaction rolls back and **the customer's order is not
saved** — the write is sacrificed to a notification. The "Error Handling" section
(`recipes/webhooks.md:78-93`) presents `afterSaveError` as handling this "gracefully"; what it
actually does is run the handler and then destroy the write anyway.

**Failure scenario.** Attacker capability: none — an outage at any integrated SaaS. Impact: silent
data loss on the write path, presented to the user as a 500. An attacker who can DoS the partner
endpoint (or DNS for it) can deny writes to the collection.

**Fix direction.** Rewrite the recipe around the dispatcher (or at minimum `AbortSignal.timeout(…)`
plus a `try/catch` that swallows), and state explicitly that a throw from `afterSave` rolls back the
save. This is the single most-copied piece of webhook code the project publishes.

---

## MEDIUM

### M1. Delivery is at-least-once, the delivery id changes per attempt, and no doc tells consumers to dedupe

`packages/server/src/services/webhook-service.ts:112`

`"X-Webhook-Delivery": randomUUID()` is computed inside `deliver()`, which is called once per
*attempt* (`:72`). Attempt 2 of the same logical event therefore carries a different UUID from
attempt 1. The only stable correlator a receiver gets is `X-Webhook-Attempt` — a small integer.
Neither `SKILL.md` nor the website recipe contains the strings "idempotent", "duplicate" or "dedupe"
(grepped, zero hits).

**Failure scenario.** No attacker required. The receiver processes the payload (charges a card,
sends an email) and then times out at 10.1s. `success` is false, so the dispatcher retries; the
receiver has no key by which to recognise the replay and charges again. Because retries fire on
**every** non-2xx including 4xx (`:137`, documented at `SKILL.md:343`), a receiver that returns 409
"already processed" gets hammered three times and the delivery is still recorded as a failure.

**Fix direction.** Mint the delivery UUID once per `onEntityChange`-per-webhook and keep it constant
across attempts; document at-least-once semantics and tell receivers to key on it. Stop retrying
non-retryable 4xx (400/401/403/404/410/422).

### M2. The signature has no timestamp commitment in a header, and no rotation

`packages/server/src/services/webhook-service.ts:118-121`

HMAC-SHA256 over the exact request body, hex, as `X-Webhook-Signature: sha256=…`. The secret is
per-webhook (good) and the signature is written *after* the custom-header spread so a config cannot
override it (also good, `:114` vs `:120`). What is missing:

* No signed timestamp header. The body contains `timestamp` (`:56`) so a replay is *detectable*, but
  only if the receiver parses and enforces it — and none of the three verification examples the
  project publishes (`SKILL.md:232-248`, `:283-308`, and the Express one) look at it. Stripe's
  `t=…,v1=…` shape exists precisely because the freshness check has to be impossible to forget.
* No support for two concurrent signatures, so rotating a secret means a window where deliveries
  fail closed at the receiver.
* Signing is opt-in and silent when omitted: `setWebhooks` accepts a secret-less webhook without a
  warning, and the skill's own third example (`SKILL.md:496-501`) ships one — data to a third party
  over an unauthenticated POST.

**Failure scenario.** Anyone who captures one delivery (a logging proxy, a shared CI log, a
misconfigured receiver behind a CDN) can replay it verbatim, forever, and it verifies.

**Fix direction.** Add `X-Webhook-Timestamp` and sign `${timestamp}.${body}`; document a
tolerance window in every verification example; accept `secrets: string[]` and emit all signatures
during rotation.

### M3. The payload is the entire row, with no field allowlist

`packages/server/src/services/webhook-service.ts:50-57`; `PostgresBackendDriver.ts:705`

`record: entity` is whatever the caller passed, and in the documented `afterSave` wiring that is
`savedValues = savedRow` — every column of the row, explicitly including the id column
(`PostgresBackendDriver.ts:702-705`). `WebhookConfig` has no `fields`/`include`/`exclude` option.
`old_record` ships the previous row too.

**Failure scenario.** A team wires the skill's analytics example (`SKILL.md:496-501` — third-party
endpoint, `Authorization: Bearer <analytics key>`, no HMAC) to their `users` table. Every password
hash, role array, MFA secret, reset-token column and internal flag on that table is POSTed to the
analytics vendor on every profile edit. Nothing in the code or the docs warns about it. Note also
that the row handed to the callback is the row *as written*, not an RLS-filtered projection: it can
contain columns the webhook's owner would never be allowed to SELECT.

**Fix direction.** A required-by-convention `fields` allowlist on `WebhookConfig` (and a redaction
list), plus an explicit warning in the skill for auth collections.

### M4. Failures are invisible, and nothing survives a restart

`packages/server/src/services/webhook-service.ts:148-159`; `SKILL.md:379-398`, `:588-593`

`deliver()` catches everything and converts it to `success: false`. The service imports no logger
and logs nothing, at any level, ever — not the first failure, not the final one. The only channel is
the returned `WebhookDeliveryResult[]`, and **both** documented integration patterns discard it: the
collection-callback pattern (`SKILL.md:382`) ignores the return value, and the fire-and-forget
pattern (`SKILL.md:591`) only `.catch`es a rejection that `onEntityChange` can never produce. There
is also no persistence: the retry loop is in-process, so a deploy or a crash between attempt 1 and
attempt 2 drops the event with no record that it existed, and there is no dead-letter destination.

**Failure scenario.** A receiver's TLS certificate expires. Every delivery fails for a week. Nothing
in any log, no metric, no `failureCount`. The developer finds out from the partner.

**Fix direction.** Log at `warn` on each failed attempt and `error` on final failure, from inside the
service; return the results *and* surface them; document that delivery is in-process and best-effort
until an outbox exists.

### M5. The SaaS ships a "Database Webhooks" feature that nothing dispatches

`saas/config/collections/webhooks.ts` (whole file), `saas/config/collections/webhook-deliveries.ts`
(whole file), `saas/backend/src/schema.generated.ts:122`, `:484`,
`saas/backend/src/hooks/encryption-hooks.ts:14`

Two tables exist, with RLS, an admin UI (`icon: "Webhook"`, `propertiesOrder`), field-level
encryption of `secret`, and columns that only a delivery engine could ever populate —
`lastTriggeredAt`, `failureCount`, and the entire `webhook_deliveries` table
(`statusCode`, `responseBody`, `attemptNumber`). Grepping `saas/backend`, `saas/frontend` and
`saas/config` for `database_webhooks` / `webhook_deliveries` returns only the schema, the collection
definitions, the encryption-hook allowlist and the generated SDK types. **Nothing reads them.**
This is bug-class 21 (a declared extension point nothing reads) wrapped around class 14 (fields the
platform writes but never reads back).

**Failure scenario.** Not an attack — a promise. A tenant configures a webhook in the console, sees
`Enabled: true` and `Failure Count: 0`, and never receives a delivery or an explanation. Separately,
this is a *stored* SSRF payload waiting for the day someone wires the dispatcher up: the URL column
is already tenant-writable and already unvalidated (H1).

**Fix direction.** Either wire it (with H1/H2/H3/H4 fixed first, because this is the multi-tenant
shape where SSRF is remote-and-free) or remove the collections from the console so the platform
stops advertising a feature it does not have.

### M6. Retry policy: no jitter, no cap, retries the unretryable

`packages/server/src/services/webhook-service.ts:25-26`, `:71-86`, `:137`

Fixed delays `[1000, 5000, 15000]` with no jitter — a receiver that goes down while N tenants are
writing gets three synchronised waves. `success` is `status >= 200 && status < 300`, so 3xx (after
20 redirects), 400, 404, 410 and 422 all retry. `maxRetries` and `retryDelays` are private with no
constructor options, so a consumer cannot shorten the deadline or extend the schedule. The
index/length mismatch between them is already noted and defended in-code with `??` (`:76-81`) — that
part is fine.

**Fix direction.** Full jitter, a retry-vs-terminal classification of status codes, honour
`Retry-After`, and expose `{ maxRetries, retryDelays, timeoutMs }` as constructor options.

---

## LOW

* **L1. The abort timer leaks on the error path.** `webhook-service.ts:148` — `clearTimeout` is only
  reached on the success path (`:134`). When `fetch` rejects fast (ECONNREFUSED, DNS), a 10s timer
  stays armed on the event loop per attempt. Harmless in a server, but it keeps a short-lived script
  or a Jest worker alive. Move it to `finally`.
* **L2. Custom headers can override `Content-Type`.** `webhook-service.ts:108-115` — the spread is
  last, and this is documented as a feature (`SKILL.md:208`). The signature header is safe (added
  after), but a config typo silently changes the wire format.
* **L3. Sequential dispatch.** `webhook-service.ts:49-61` — N matching webhooks are awaited one after
  another, multiplying H4's transaction window by N. `Promise.allSettled` with a concurrency cap
  costs nothing here.
* **L4. The published recipe does not compile, and the verifier cannot see it.**
  `website/src/content/docs/docs/recipes/webhooks.md:37` closes a `const … = {` with `});`;
  `:44` and `:84` destructure `entityId`, which is not a field of `AfterSaveProps` (it is `id` —
  `packages/types/src/types/entity_callbacks.ts:144`); `:63-65` uses `entity.values.shopify_id`,
  where `AfterDeleteProps` has `row`, flat (`entity_callbacks.ts:203-229`). The file *is* in
  `DEFAULT_GLOBS` (`scripts/docs-verify/extract.mjs:71`) and the fences are untagged `typescript`
  with no `no-verify`, yet this passes: the brace mismatch degrades to parse-artefact codes 1005/1128,
  which are suppressed (`scripts/docs-verify/typecheck-snippets.mjs:96-104`), and the two bare
  `callbacks: { … }` fragments have no contextual type, so the wrong destructured names are just
  implicit-any (7031, also suppressed). Machine-translated into it/pt/fr/es; German has no copy of
  the page at all.
* **L5. Two doc claims are wrong.** `SKILL.md:18` sells backoff as "1s → 5s → 15s" (the 15s entry is
  unreachable — `SKILL.md:327` says so correctly, so the overview contradicts the reference); and
  `SKILL.md:612` puts three failed attempts at "~6s of waiting", counting only backoffs and ignoring
  up to 30s of request timeouts. Both understate H4.
* **L6. The unit tests burn ~12s of real backoff.** `packages/server/test/webhook-service.test.ts:209`,
  `:227` carry 30s Jest timeouts because they actually sleep through `deliverWithRetry`. Fake timers
  or injectable delays would make the suite honest and fast.
* **L7. No test covers anything security-relevant.** The suite checks matching, the HMAC value,
  custom headers and multi-dispatch. Nothing asserts a scheme/host restriction, redirect behaviour,
  timeout behaviour, delivery-id stability across attempts, or that a disabled webhook stays disabled
  after a re-`setWebhooks`. Absence of a test is not a bug, but it is why H1–H3 have survived.
* **L8. No `User-Agent`, no per-endpoint rate limit, no circuit breaker.** A receiver cannot identify
  the sender, and a webhook pointed at a table with a hot write path has no throttle in front of it.

---

## Checked and clean

* **Default RLS policies on the webhook tables.** `database_webhooks_default_admin_read` etc. read
  `(auth.uid() IS NULL) OR admin`, which looks like an anonymous grant and is not:
  `packages/common/src/util/auth-default-policies.ts:36-40` documents `auth.uid() IS NULL` as the
  *server* context, and an anonymous HTTP request carries `ANONYMOUS_USER_ID` precisely so it cannot
  reach that state. The owner rule (`webhooks_owner_all`) correctly gets both USING and WITH CHECK
  (`saas/backend/src/schema.generated.ts:135`).
* **`X-Webhook-Signature` cannot be overridden by a config's custom headers** — it is assigned after
  the spread (`webhook-service.ts:114` then `:120`).
* **Disabled webhooks** are filtered at registration (`:30`) and the test asserts the disabled one
  receives nothing (`test/webhook-service.test.ts:25-57`).
* **`maxRetries` / `retryDelays` drift** is already guarded with `?? retryDelays[length-1]` and an
  explanatory comment (`:76-81`). No `setTimeout(r, undefined)` immediate-retry hazard remains.
* **Deploy hooks (inbound) are not this bug.** `saas/config/collections/deploy-hooks.ts:69-76` stores
  only the SHA-256 of the trigger token; the token is returned once at mint time and never again.
* **`database_webhooks.secret` is encrypted at rest** and `afterRead` decrypts only for the platform,
  never for an API caller (`saas/backend/src/hooks/encryption-hooks.ts:14`, `:43-60`).
* **No other outbound `fetch` in `packages/server/src` takes a data-derived URL.** The only
  non-literal destinations are the OAuth providers, whose hosts come from provider config
  (`auth/gitlab-oauth.ts:24`, `auth/facebook-oauth.ts:27`, …). This matches the earlier sweep note at
  `docs/bug-classes.md:1625` — with the caveat that the note's justification for the dispatcher
  ("instantiated by the developer, not from data") is exactly the assumption H1 says the project's
  own docs and SaaS schema break.

---

## Open questions

1. **Is `database_webhooks` meant to be wired, or deleted?** The answer decides whether H1 is a
   library-hygiene fix or a P0. If it is meant to be wired, the URL validation has to land *before*
   the dispatcher does, and it has to live in the dispatcher rather than in SaaS code, because OSS
   users will hit the same shape.
2. **Should `afterSave` be able to roll back the write at all?** H5 depends on the rethrow at
   `PostgresBackendDriver.ts:815`. That may well be deliberate for `beforeSave`-style validation, but
   for an *after* callback it means every integration is a write-availability dependency. Worth a
   deliberate decision and a documented one either way.
3. **Is there an appetite for an outbox table?** Every medium finding above (M1 dedupe keys, M4
   durability and visibility, M6 scheduling) collapses into one design if deliveries are rows written
   in the same transaction and drained by a worker — which is also the only correct fix for H4.
4. **UNCONFIRMED:** exactly which URL schemes Node's `fetch` accepts in the versions Rebase supports.
   Reasoning says `file:` and `gopher:` throw rather than read (undici implements only
   http/https/data/blob/about), so the practical SSRF vector is http(s) to internal addresses — but I
   did not execute anything to verify it, and `data:` being accepted is its own small oddity. Do not
   treat scheme support as a mitigation; add the allowlist regardless.
5. **UNCONFIRMED:** whether `verify:docs` currently passes on
   `website/src/content/docs/docs/recipes/webhooks.md`. I traced why it *would* pass despite L4
   (suppressed codes, untyped fragments) by reading the extractor and the code filter, but did not
   run the verifier.
