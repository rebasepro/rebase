# Unit 36 — user-defined server functions

**Audited:** 2026-08-08 · read-only · `packages/server/src/functions/**`, the mount in
`packages/server/src/init.ts:1602-1662`, the auth/rate-limit/error middleware it composes
(`auth/middleware.ts`, `auth/adapter-middleware.ts`, `auth/api-keys/*`, `auth/rate-limiter.ts`,
`api/errors.ts`, `init/middlewares.ts`), the client caller
(`packages/client/src/functions.ts`, `transport.ts`), the CLI bundler
(`packages/cli/src/bundle.ts`, `commands/dev.ts`, `runtime/dev-server.mjs`), the scaffolded
template (`packages/cli/templates/template/backend/functions/hello.ts`), the public docs
(`website/src/content/docs/docs/backend/custom-functions.md`), and — as the only real-world
consumer — `saas/backend/functions/**`.

## Verdict

The *authorization* story is better than it looks from the outside. Functions are public by
default, which is a deliberate choice with a stated reason (webhook receivers), and unusually
for this repo the choice is written down in all three places a developer will actually read:
the scaffolded `hello.ts` spends fifteen lines on it, the docs page has a section on it, and
`define-function.test.ts` mounts the router the way `init.ts` mounts it and asserts the status
codes rather than the middleware shape. The API-key guard fails closed by construction, the
body limit covers the router, and an invalid JWT is rejected rather than downgraded — on one
of the two auth paths.

The *data-access* story is the opposite, and it is the finding of this audit.
`defineFunction` hands every function author exactly one thing, `ctx.rebase`, whose
`dataAsAdmin` accessor is documented in five separate places — the `defineFunction` docblock,
the singleton docblock, the scaffolded template, the docs page, twice — as **bypassing RLS**.
It does not. `init.ts:1485` wraps the base driver in `withAuth({ uid: "service", roles:
["admin"] })` before building it, so every `dataAsAdmin` read and write runs inside a
transaction that has done `SET LOCAL ROLE rebase_user` and `set_config('app.uid', 'service')`.
It is not a bypass, it is RLS evaluated as an admin — and it therefore fails
`policy.serverContext()`, the framework's own primitive for "the trusted server context",
which compiles to `auth.uid() IS NULL` and is one of the two arms of the default policy
injected onto every collection. The driver's own comment, the bootstrapper's own comment and
the e2e test's own header all assert the bypass; the e2e test proves it about the *base*
driver and then attributes the result to `dataAsAdmin`, which is a different object. This is
the exact shape the audit brief calls out: getting it wrong is silent, and it is silent in
both directions.

Below that sit the operational gaps. There is no request timeout anywhere in the server, no
`unhandledRejection` handler anywhere in the repo, and the anonymous rate-limit bucket is
switched off for functions by a hardcoded `anonymous: null` with no override — so the one
router that is public by default is also the one with no ceiling on anonymous work. And the
loader's failure mode still has the hole the cron loader fixed ninety lines further down the
same file: when every function file fails to import, `/api/functions` is not mounted at all.

---

## HIGH

### H1. `rebase.dataAsAdmin` does not bypass RLS, and five docblocks say it does

**`packages/server/src/init.ts:1483-1486`**, consumed at `:1504-1508` and `:1524`:

```ts
const serviceIdentity = { uid: "service", roles: ["admin"] as string[] };
const scopedDefaultDriver = await scopeDataDriver(defaultDriver, serviceIdentity);
const defaultData = buildSdkData(scopedDefaultDriver);
…
Object.assign(serverClient, { data: serverData, dataAsAdmin: serverData });
```

`defaultDriver` is the raw driver the bootstrapper produced (`init.ts:683`, `:729`), so
`scopeDataDriver` (`auth/rls-scope.ts:52-56`) finds `withAuth` and returns an
`AuthenticatedPostgresBackendDriver` (`PostgresBackendDriver.ts:1539-1541`). Every accessor
built over it routes through `withTransaction`, which calls
`applyAuthContext(tx, { uid: "service", roles: ["admin"] }, rlsUserRole)`
(`PostgresBackendDriver.ts:1616`) — and that sets `app.uid` to `'service'` and issues
`SET LOCAL ROLE rebase_user` (`security/rls-enforcement.ts:299-308`).

The claims:

| where | text |
|---|---|
| `functions/define-function.ts:20-21` | "`rebase.dataAsAdmin` runs with **admin privileges and bypasses RLS**" |
| `singleton.ts:72-75` | "**every read and write bypasses row-level-security policies**" |
| `cli/templates/template/backend/functions/hello.ts:33-34` | "gives you admin-level access to your data and **bypasses RLS**" |
| `website/.../custom-functions.md:240`, `:253` | "full administrative privileges (no RLS)" / "bypasses RLS completely" |
| `PostgresBackendDriver.ts:1605-1611` | "The server context (base driver / dataAsAdmin …) never reaches here, so it stays on the owner connection and bypasses RLS" |
| `PostgresBootstrapper.ts:364-367` | "The server context (base driver / dataAsAdmin / auth flows) stays on the owner connection and bypasses" |

The two driver-side comments are the interesting ones: they are not sloppy prose, they are the
design, and `init.ts` wires against them. `init.ts:1480-1482` even states the contrary
intention in its own comment ("RLS semantics are preserved: the driver is scoped once as
`{ uid: "service", roles: ["admin"] }`"), so the two halves of the system are each internally
consistent and disagree with each other — bug class 11, with the disagreement carried in
comments rather than in types, which is why nothing caught it.

**It also kills a public primitive.** `policy.serverContext()` compiles to
`auth.uid() IS NULL` (`common/src/util/policy/policyToPostgres.ts:100-102`, with the comment
"Only the built-in server flows leave `app.uid` unset"), and it is one arm of
`SERVER_OR_ADMIN_EXPR`, the condition on `<table>_default_admin_read` /
`<table>_default_admin_write` injected onto every collection
(`common/src/util/auth-default-policies.ts:54-57`, `:96-110`). Under `dataAsAdmin`,
`auth.uid()` is `'service'`, so that arm is **always false**. The default policies still pass,
via the `rolesOverlap(["admin"])` arm — which is precisely why nobody has noticed.

**Failure scenario.** A developer writes a collection whose rules say "only my backend may
write this": `securityRules: [{ operations: ["insert"], condition: policy.serverContext() }]`
plus `disableDefaultPolicies: true` (the documented way to take full responsibility). Their
Stripe webhook function — the flagship example in the docs — calls
`rebase.dataAsAdmin.subscriptions.create(...)`. Postgres evaluates `auth.uid() IS NULL` against
`'service'`, the `WITH CHECK` fails, and the write is refused with `42501`. Every document the
developer has read says this accessor bypasses RLS, so the policy is the last place they will
look. The read direction is worse: a `find()` against a collection whose admin policy was
hand-written returns **zero rows and HTTP 200**, and a webhook that reconciles state silently
reconciles against an empty set.

The inverse also holds and is the security half: a reader of `hello.ts` who believes
`dataAsAdmin` is an unconditional bypass will not think to check whether an app-level `admin`
role can reach the same rows — and it can, through `rolesOverlap(["admin"])`.

**Nothing tests it.** `packages/server-postgres/test/e2e/rls-enforcement.test.ts:6` states in
its header that "the server context (owner connection / dataAsAdmin / auth flows) bypasses",
and the test that proves it (`:252-258`) reads:

```ts
it("lets the server context (owner connection) bypass RLS for writes", async () => {
    // The BASE driver is the server context — it never switches role.
    await driver.save({ … });
```

The base driver does bypass. `rebase.dataAsAdmin` is not the base driver. This is bug class 8
(a security-labelled assertion watching a neighbouring mechanism) sitting on top of bug class 3
(the test never goes through `initializeRebaseBackend`, which is the only wiring that produces
the object the docs describe).

**Fix direction.** Decide which one is true, in one place, and make the other follow.
If the intent is the documented bypass, `init.ts:1485` should hand `buildSdkData` the
*unscoped* `defaultDriver` and `serverContext()` becomes reachable again. If the intent is the
current behaviour, then the six comments above are wrong and `policy.serverContext()` is dead
API that should either be redefined (`auth.uid() IS NULL OR auth.uid() = 'service'`) or
documented as unreachable per bug class 21. Either way the gate is an e2e that goes through
`initializeRebaseBackend`, reads `rebase.dataAsAdmin` off the singleton, and asserts against a
collection carrying `disableDefaultPolicies: true` — the only configuration where the two
answers differ.

**Related, and the sharper edge of the same confusion:** `rebase.sql()` *is* a true bypass —
it is bound to `driverAdmin.executeSql` on the owner connection (`init.ts:1567-1572`) and never
goes near `withAuth`. So the two accessors on the same object have opposite privilege, the
loudly-warned one is the safer of the two, and the `defineFunction` docblock's own example
(`define-function.ts:44-50`) reaches for `rebase.sql` with no warning at all.

---

## MEDIUM

### M1. One import-time throw can remove the entire `/api/functions` surface, and the deploy stays green

**`packages/server/src/init.ts:1609`** — `if (loadedFunctions.length > 0) { … }`.

`loadFunctionsFromDirectory` deliberately never throws (`function-loader.ts:29-32`,
`:100-105`): a file that fails to import is logged and skipped, and a summary line names every
skipped file (`:109-115`). That part is right. What is not is the mount condition. Ninety
lines further down, the cron router carries the post-mortem for exactly this bug:

> `init.ts:1693-1698` — "Mounted for the directory, not for the jobs in it. Mounting only when
> something loaded meant a single unparseable file … took the whole cron surface with it:
> `/api/cron` 404ed, the Studio panel broke, and the only trace was one line in the boot log.
> An empty list is the honest answer, and it is a debuggable one."

The fix was applied to cron and never swept back to the loader it was copied from — bug class
17 along its second axis (the feature reached one of the two call sites).

**Failure scenario.** A project has three functions and all three
`import { stripe } from "../src/stripe.js"`, which does
`new Stripe(process.env.STRIPE_SECRET_KEY!)` at module scope. The key is missing on the new
environment. All three imports throw, `loadedFunctions` is empty, the router is never mounted,
and `GET /api/functions` answers **404** — indistinguishable from "this build shipped no
functions". `rebase cloud debug` then reads that 404 and reports
(`packages/cli/src/commands/cloud/debug.ts:266-272`) "the functions router did not mount — no
functions directory was found at build time, or it held no functions", which sends the operator
to the bundle manifest. The actual cause is three `[functions] Failed to load …` lines in the
boot log, and the remediation text does not name it (bug class 5).

**Fix direction.** Mount the router unconditionally, exactly as cron does, so the listing
endpoint always answers and always tells the truth about what loaded. Then return the
`problems` list from the loader instead of only logging it, surface it on the listing response
(or a `/api/functions/_diagnostics`), and add the third cause to `debug.ts`'s 404 text.

### M2. Anonymous callers of a public-by-default router have no rate limit, by construction

**`packages/server/src/init.ts:1650-1651`**:

```ts
if (rateLimitConfig) {
    functionsRouter.use("/*", createDataRateLimiter({ ...rateLimitConfig, anonymous: null }));
}
```

`anonymous: null` reaches `resolveLimit`, which returns `null`, which
`createRateLimiter` reads as "not my bucket" and skips the limiter entirely
(`auth/rate-limiter.ts:78-82`, `:263-269`). The spread order means a caller's own
`rateLimit.anonymous` is overwritten: there is no configuration that re-enables it. The
comment at `:1645-1649` gives the reason (webhook bursts from a handful of provider IPs would
429), which is a real problem — but the chosen answer is "no limit for anonymous callers on
the one router that defaults to anonymous access".

**Evidence that the gap is real rather than theoretical:** the only production consumer of
this subsystem hand-rolled a replacement. `saas/backend/src/index.ts:128,133`:

```ts
app.use("/api/functions/*", createRateLimiter(50, 60 * 1000));
app.use("/api/functions/ai/*", createRateLimiter(20, 60 * 1000));
```

It had to, because `saas/backend/functions/ai.ts:432,576,647` exposes three unauthenticated
POST routes that call a paid LLM provider against a process-global daily quota
(`ai.ts:104-125`) — a deliberate public surface (`saas/backend/src/index.ts:82-87`) that the
framework's limiter would not have covered. A user who does not know to do this gets nothing.

**Failure scenario.** A project ships a public `contact-form` function (one of the four use
cases the docs list). An unauthenticated script POSTs it at line rate. The framework applies
no limit; each call runs the handler, which sends an email and writes a row. The only ceiling
is the 10 MB body limit and whatever the upstream provider does.

**Fix direction.** Keep an anonymous bucket with a generous default (the webhook argument
bounds the *value*, not the existence of the limit) and let `rateLimit.anonymous` through
instead of overwriting it — or key the exemption to an explicit per-function opt-out
(`export const webhook = true`) rather than to the whole router.

### M3. No request timeout, and one floating rejection in user code takes the process down

Two independent gaps, both confirmed by absence:

* `grep -rn "hono/timeout\|requestTimeout\|server.setTimeout\|headersTimeout"` over
  `packages/server/src` and `packages/cli/runtime` returns **zero hits**. `boot.ts:194`
  constructs `createServer(getRequestListener(app.fetch))` with no timeouts configured, and
  nothing in the functions mount adds one. A handler that awaits a promise that never settles
  — a fetch to an unreachable third-party API with no `AbortSignal`, a `pg` query on a wedged
  connection — holds its socket and its Node request object until the client gives up. There
  is no config knob and no documented pattern; the docs page does not mention timeouts.
* `grep -rn "unhandledRejection\|uncaughtException"` over `packages/server/src`,
  `packages/cli/src` and `packages/cli/runtime` returns **zero hits**. Node's default since v15
  is to terminate on an unhandled rejection. Hono catches anything thrown or rejected inside an
  awaited handler, so the ordinary path is fine — but a fire-and-forget `void doWork()`,
  a `setTimeout(async () => …)`, or an unawaited `.then()` inside one function file rejects
  outside Hono's frame and kills the process.

**Failure scenario.** A developer writes `app.post("/", (c) => { syncToCrm(body); return
c.json({ ok: true }); })` — deliberately not awaiting a slow third-party call. The CRM returns
401 once. The process exits. On the managed runtime that is a pod restart, and the pod is
shared: every other tenant's function on that instance goes with it. Nothing in the request
log points at the function, because the request succeeded.

**Fix direction.** A default per-request timeout on the functions router (Hono ships
`hono/timeout`), overridable per function, answering 504 — the number matters less than the
existence of a ceiling. And a process-level `unhandledRejection` handler that logs the
rejection with the request-id context and does *not* exit, so one function's bad promise is a
log line rather than an outage.

### M4. An expired token is a 401 on one auth path and an anonymous request on the other

**`packages/server/src/auth/adapter-middleware.ts:95-105`** vs
**`packages/server/src/auth/middleware.ts:366-372`**.

The non-adapter middleware is explicit:

```ts
} else {
    // Token present but invalid — always reject.
    // Providing a malformed token should never grant access,
    // regardless of requireAuth setting.
    return c.json({ error: { message: "Invalid or expired token", … } }, 401);
}
```

The adapter middleware has no such branch: `adapter.verifyRequest` returning `null` — which is
what the built-in adapter does for an expired or forged JWT
(`auth/builtin-auth-adapter.ts:143-148`) — falls into the "not authenticated" arm, gets an
anon-scoped driver, and with `enforceAuth === false` proceeds to the handler. One rule, two
implementations, disagreeing (bug class 2).

The adapter path is the live one: `authAdapter` is set whenever `config.auth` is a config
object, because `init.ts:1024` builds the built-in adapter for it. And the divergence is
**observable only on the functions router**, because it is the only router mounted with
`requireAuth: false` (`init.ts:1616`; the data router uses `resolveRequireAuth`, which defaults
to `true` — `auth/require-auth.ts:46-50`). Everywhere else the `enforceAuth` check at
`adapter-middleware.ts:108` catches it.

**Failure scenario.** A function serves personalised content and degrades gracefully for
anonymous callers — `const user = c.get("user"); return c.json(user ? mine() : public())`. A
signed-in user's access token expires. The SDK's refresh flow is driven by a 401
(`client/src/transport.ts:377-379`); the function returns 200 with public content instead, the
refresh never fires, and the user sees themselves silently signed out of that one screen while
the rest of the app still works. Debugging that starts nowhere near auth.

**Fix direction.** Extract the "a token was presented and did not verify" decision so both
middlewares call it, and return 401 from it regardless of `requireAuth`. Pin it with a test
that drives both `createAuthMiddleware` and `createAdapterAuthMiddleware` through the same
table of (token, requireAuth) cases and asserts the same status from both.

### M5. Functions in subdirectories are compiled, shipped, and then silently ignored

**`packages/cli/src/bundle.ts:959`** includes `${paths.functions}/**/*.ts` — recursive.
**`packages/server/src/functions/function-loader.ts:38-49`** is `fs.readdirSync(directory)`
with no recursion and a filter that requires `.ts`/`.js`, so a directory entry simply does not
match and is skipped **with no log line at all** — it never reaches the `problems` list,
because it is not treated as a problem.

**Failure scenario.** A project grows past a dozen functions and reorganises into
`backend/functions/admin/users.ts`, `backend/functions/public/contact.ts`. `rebase build`
compiles both, typechecks both, writes both into the bundle, prints nothing. The runtime mounts
neither. `GET /api/functions` lists zero, every route 404s, and the boot log is silent — the
one diagnostic surface the loader has is bypassed entirely because the files were never
considered.

The same silence covers `functions/index.ts` (reserved by `:47-48`, skipped without a word)
and any `.mts` / `.cts` / `.tsx` file.

**Fix direction.** Either recurse and mount `admin/users.ts` at `/admin/users`, or refuse:
walk directory entries with `withFileTypes` and push a `problems` entry naming each ignored
subdirectory and each ignored extension. The bundler and the loader must agree on what a
function file is — today the build's answer is strictly wider than the runtime's, which is the
worst direction for a mismatch to go.

---

## LOW

### L1. `error.details` is forwarded to the client verbatim on 500s, while `message` is sanitised

**`packages/server/src/api/errors.ts:287-305`** goes to some trouble to replace the message of
any non-`ApiError` 500 with `"Internal Server Error"` — "Sanitize the message for the client to
prevent leaking sensitive details like SQL queries or internal IP addresses." Twenty lines
later, `:323-325`:

```ts
...(error.details !== undefined
    ? { details: error.details }
    : dbDetails !== undefined ? { details: dbDetails } : {}),
```

`error.details` is spread in unconditionally, at any status, for any thrown value. The escape
is narrow — the object must carry a `details` property, which Postgres errors (`detail`), Zod
(`issues`) and Node system errors do not — but the whole point of the block above is that the
handler cannot know what user code throws. Reachability from a specific third-party error type
is **UNCONFIRMED**; the asymmetry is not.

**Fix direction.** Gate `details` on the same condition as the message: forward it for
`ApiError` (where the author chose it) and for 4xx, drop it for an unclassified 500.

### L2. Verbose database diagnostics are opt-*out*, keyed on `NODE_ENV !== "production"`

**`packages/server/src/api/errors.ts:310-317`** returns `dbMessage`, `detail` and `hint` from
the Postgres error to the HTTP client whenever `process.env.NODE_ENV !== "production"`. The
shipped images set it (`Dockerfile:61`, `packages/cli/templates/eject/Dockerfile:55`), so the
managed path is fine — but a self-hosted `node dist/index.js` with `NODE_ENV` unset leaks
schema internals to every caller, including the anonymous ones a function router invites. This
is bug class 1's watch-item: the zero state opens rather than closes. Not
functions-specific, but functions are the surface most likely to be public.

**Fix direction.** Invert it — an explicit `REBASE_VERBOSE_ERRORS=1`, or key it on the same
`isProduction` value `init.ts:599` already computes and passes around, and log loudly at boot
when verbose errors are on.

### L3. `GET /api/functions` enumerates every function to anonymous callers

**`packages/server/src/functions/function-routes.ts:17-24`** registers the listing route with
no guard, upstream of nothing but the permissive auth middleware. Anonymous callers get the
complete list of function names and paths. For API-key callers the guard closes it correctly
(`api-key-permission-guard.ts:104-118` treats the index as `functionName === ""`, grantable
only by `functions` or `*`), so the anonymous case is the outlier rather than the design.

Names like `admin-impersonate`, `stripe-webhook`, `internal-reindex` are a map of the private
surface. `rebase cloud debug` depends on this endpoint answering
(`cli/src/commands/cloud/debug.ts:255-262`), and correctly treats 401/403 as proof of the
mount, so gating it is already supported.

**Fix direction.** Make the listing require an authenticated caller by default, with an opt-out
for anyone who wants it public.

### L4. `functions.invoke()` returns `{}` for any response that is not JSON

**`packages/client/src/functions.ts:57-80`** delegates to `transport.request`, which parses the
body as JSON and, on failure, keeps `body = {}` (`transport.ts:355-364`) and then
`return body as T` (`:428`). A function that answers `c.text("ok")`, streams a CSV, or returns
`c.html(...)` — all ordinary Hono — resolves the promise with an empty object and no error.
The caller's `const { url } = await client.functions.invoke("export")` gets `undefined` and
looks like a server bug.

**Fix direction.** Either document `invoke` as JSON-only and throw on a non-JSON content type,
or return the raw text when parsing fails. Silently substituting `{}` is the one option that
cannot be debugged from the call site.

### L5. Filenames become Hono route patterns with no validation

**`packages/server/src/functions/function-routes.ts:26-28`** — `router.route(`/${fn.name}`, fn.app)`
where `fn.name` is `path.basename(file, path.extname(file))` (`function-loader.ts:67`).
Hono's path syntax gives `:` and `*` meaning, so a file named `:id.ts` mounts a parameterised
catch-all that swallows every unmatched function name, and `*.ts` mounts a wildcard. Neither
is a filename anyone types on purpose, but this is the same class as the generated-code
escaping issues in `docs/bug-classes.md` §13/§35: a name derived from data is being used in a
position where it is syntax. (Percent-encoding is *not* a problem here — Hono decodes the path
before matching, `hono/dist/utils/url.js:68-80`, so `encodeURIComponent` in the client caller
round-trips correctly.)

**Fix direction.** Validate the derived name against `^[A-Za-z0-9_.-]+$` at load time and push
a `problems` entry for anything else, so an unmountable name is reported rather than mounted as
a pattern.

### L6. A helper module in `functions/` is reported as a broken function

The loader imports every `.ts`/`.js` file in the directory and warns loudly when the default
export is not a Hono app (`function-loader.ts:58-62`, `:91-99`, plus the aggregate summary at
`:109-115`). There is no `_`-prefix convention, no `lib/` exemption (subdirectories are ignored
outright — see M5), so a `functions/helpers.ts` produces
`[functions] helpers.ts: no default export. Skipping.` on every boot forever. The message is
accurate and unactionable; the developer's only correct move is to move the file, and nothing
says so.

**Fix direction.** Skip `_`-prefixed files silently and say so in the docs, the way most
file-routing conventions do.

### L7. The docs page's two most-copied examples are unverified and use API that does not exist

`website/src/content/docs/docs/backend/custom-functions.md:347` —
`await instance.driver.data.subscriptions.create(...)` in the Stripe webhook example.
`DataDriver` (`packages/types/src/controllers/data_driver.ts:229`) declares no `data` property;
it exists only on the concrete Postgres driver. And `instance.driver` is the **unscoped base
driver** (`init.ts:495`, `:729`) — the one thing in this system that genuinely does bypass RLS
(see H1) — presented in a webhook example with no warning whatsoever.

It typechecks because `verify-docs` stubs relative imports to `any`
(`tooling/scripts/docs-verify/typecheck-snippets.mjs:168-171`: `if (specifier.startsWith("."))
return true`), and the snippet opens with `import { instance } from "../src/index"`. So
`instance` is `any` and the whole expression is unchecked — the gate reports green over a
snippet it is not reading. The Drizzle example at `:280` has the same shape.

Two smaller defects on the same page: `:266-271` is a markdown table with no header row and no
delimiter row, so it renders as four lines of literal pipes (and the two columns it compares
are never named); and `:195` claims the service key "Injects an admin-privileged `DataDriver`
into `c.get("driver")` that bypasses Row-Level Security", which is wrong for the same reason as
H1 — `middleware.ts:330-333` scopes it via `withAuth({ uid: "service", roles: ["admin"] })`.

**Fix direction.** Rewrite both examples against the public API (`rebase.dataAsAdmin` /
`c.var.driver`) so the verifier actually checks them; fix the table; correct `:195`. Separately,
the stub rule deserves its own look — every docs example that imports from the reader's own
project is currently unverified, and both of the ones on this page were wrong.

---

## Checked and clean

- **Default authorization is public, and it is documented — three times, correctly.**
  `init.ts:1613-1616` hardcodes `requireAuth: false` with the reason stated;
  `cli/templates/template/backend/functions/hello.ts:19-31` spends fifteen lines saying
  "**Custom functions are not authenticated for you** … reading `c.get("user")` is not a
  check", warns that `app.use("/*", requireAuth)` only covers routes declared below it, and
  demonstrates all three tiers; `custom-functions.md:132-180` has a section on it. This is the
  one place in the audit where the docs and the code agree.
- **The guards in the template are enforcement, not decoration.**
  `packages/server/test/define-function.test.ts:64-135` reproduces the real mount — the
  permissive router middleware in front, the function routed in — and asserts 200/401/403 for
  anonymous, forged-token, signed-in and admin callers on all three tiers. That is the right
  shape (assert the outcome through the wiring, per bug class 3), and a mutation that dropped
  `requireAuth` from a route would fail it.
- **The API-key guard fails closed by construction.**
  `api-key-permission-guard.ts:104-118` loops and returns `false` at the end; an empty or
  unparseable permission list grants nothing, and the index route (`functionName === ""`) is
  reachable only via a `functions` or `*` entry. It is applied to the functions router
  (`init.ts:1638`) and its semantics match the collection guard's
  (`api/rest/api-generator.ts:106-120`) — one predicate, and both call sites use it.
- **Middleware ordering is correct.** All three `functionsRouter.use("/*", …)` calls precede
  `functionsRouter.route("/", fnRoutes)` (`init.ts:1620-1655`), so none of them is the
  dead-middleware trap.
- **Errors from user code do not leak a stack trace to the client.** `functionsRouter.onError(errorHandler)`
  (`init.ts:1611`) is set before the router is mounted, and Hono's `route()` wraps the sub-app's
  handlers with the parent's error handler when the parent has a custom one — so a `throw` in
  any function reaches `errors.ts:160`. An unclassified 500 answers `"Internal Server Error"`
  (`:303-305`); the stack goes to the log only (`:283-285`). (See L1/L2 for the two channels
  that are not covered by this.)
- **Body size is bounded.** `configureMiddlewares` installs `bodyLimit` at `${basePath}/*`
  (`init/middlewares.ts:49-63`) before any router is mounted (`init.ts:602`), default 10 MB,
  configurable via `maxBodySize` / `REBASE_MAX_BODY_SIZE`, answering 413. It covers
  `/api/functions` for free.
- **Authenticated and API-key function traffic *is* rate-limited**, sharing one store with the
  data API so a caller has one budget rather than two (`init.ts:959-970`, `:1651`). Only the
  anonymous bucket is disabled (M2).
- **The RLS-scoped request driver is genuinely scoped, and never absent.**
  `adapter-middleware.ts:78-105` and `middleware.ts:271-387` both set `c.var.driver` on every
  path — authenticated, anonymous, service-key, API-key — and both return 500 rather than
  falling back to an unscoped driver when `withAuth` fails. The raw driver never reaches a
  request context. `withAuth` is lazy (`PostgresBackendDriver.ts:1539-1541`), so an anonymous
  webhook call that touches no data costs no connection.
- **The singleton is process-global via `Symbol.for`** (`singleton.ts:21`), which is what makes
  `defineFunction` work when the bundle's `@rebasepro/server` copy differs from the image's —
  the failure mode is documented at `:6-19` and the fix is the right one.
- **Local dev reload works.** `rebase dev` runs `tsx watch` (`commands/dev.ts:547`,
  `:587-597`) over either the project's own entrypoint or the shipped `dev-server.mjs`, which
  boots the same `runFromBundle` path production uses over TypeScript *source* — so functions
  are `.ts` in dev and stack traces point at source. Backend stdout is prefixed `[backend]` and
  streamed (`:600-609`). The loader's per-file diagnostics (`function-loader.ts:91-99`) name the
  export type, the prototype methods and the likely cause (Hono duplication), which is a good
  message. Whether `tsx watch` tracks the dynamically-imported function files as watch
  dependencies is **UNCONFIRMED** — it goes through the same ESM loader hooks, so it should, but
  I did not start a dev server to check.
- **The bundler's warning about an unused entrypoint** (`bundle.ts:910-995`) is a model of the
  class-5 fix: it names what will not be compiled, says routes written there will 404 after
  deploy, and points at `rebase eject` as the supported alternative.
- **No prototype-pollution or dynamic-key surface** in the loader or the router: the only
  data-derived key is the mount path (L5), and there is no `obj[expr] = …` anywhere in the four
  files.

---

## Open questions

1. **Which side of H1 is the intended design?** The wiring and the comments were written by
   different hands with opposite models. The answer changes whether `policy.serverContext()` is
   a working primitive or dead API, and it should be settled before anything else in this list.
2. **Is `policy.serverContext()` used by any project today?** If a shipped app has a rule
   relying on it, "fix the wiring" and "fix the docs" are not interchangeable — one of them
   changes what that app's policies do.
3. **Should a function be able to declare its own auth posture?** Today the only knob is
   per-route middleware, and the only global override is an undocumented
   `app.use("/api/functions/*", requireAuth)` on the caller's own Hono app before
   `initializeRebaseBackend`. A `functionsRequireAuth` config option, or a per-file
   `export const auth = "required" | "public"` that the loader reads and the router enforces,
   would let a project fail closed and mark its webhooks as the exceptions — the inverse of
   today's posture, and the one that survives a forgetful author.
4. **What is the intended isolation boundary in the managed runtime?** M3's process-kill and
   the missing timeout are per-process, and the managed runtime co-locates tenants. If one
   tenant's function can end the process, the timeout and rejection handler are not DX polish.
5. **Does `verify-docs`'s relative-import stub hide more than the two snippets on this page?**
   L7 found two wrong examples in one file because both import from the reader's project. The
   count of doc snippets whose only unverified part is exactly the API being demonstrated is
   worth measuring — it is bug class 4 in the gate itself.
