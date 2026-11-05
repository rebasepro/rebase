# The hosted Rebase connector (one MCP server for everything)

**Status: built, not shipped (2026-11-05).** Approved with the recommended
answers to every [decision](#decisions-taken). The framework half is on the
rebase branch `claude/objective-jang-72ac1e`, the control-plane half on the
saas branch `feat/hosted-mcp-connector`. [Shipping it](#rollout-order) is a
release, a control-plane deploy and a fleet rollout.

A developer adds one connector in claude.ai (Settings → Connectors), signs in
with their Rebase account, and gets their projects, the cloud operations on
them, and each project's data, including the `show_collection` table view. It
works from claude.ai on the web, the desktop app and mobile, where the local
`rebase-mcp` stdio server cannot run.

Today that takes two kinds of connector:

| | Local `rebase-mcp` (stdio) | Per-app `/mcp` |
|---|---|---|
| Runs | on the developer's machine | inside each deployed app |
| Signs in as | the service key or an `rk_` key from `.env` | a user of that app (OAuth) |
| Reaches | one project at a time; cloud ops by shelling out to the CLI | one app's data |
| Tools | 55 | 9 |
| claude.ai web/mobile | no | yes, one connector per app |

The hosted connector replaces neither. The local server stays the tool for
local development (dev server, schema generation, `db push` from local code,
database branches). The per-app `/mcp` stays the door for an app's own end
users, under their own row-level security. It is unchanged by this work.

## The rules it follows

These are Francesco's decisions of 2026-11-05.

1. **Identity.** The connector signs in with the person's Rebase account
   (OAuth) and acts with exactly that account's access: the same projects, the
   same organization roles, and inside a project the same data access that the
   account's link to the project gives it. No service key and no admin shortcut
   that exceeds what the person could do in the console or the CLI.
2. **Confirmation.** Destructive or outward actions take two steps. MCP tool
   annotations mark them (`readOnlyHint`, `destructiveHint`, `idempotentHint`),
   and the server enforces a plan-then-confirm exchange with a token bound to
   the person, the project, the arguments and a short expiry. Read-only tools
   need no confirmation.
3. **Fewer tools.** A small set of verb tools that take `project` and an
   `action`, in place of ~50 single-purpose tools.

## Architecture

```
claude.ai ──OAuth 2.1──▶ control plane  app.rebase.pro
   │                     (saas/backend — itself a Rebase app)
   │  POST /mcp           │
   │  Bearer <MCP token,   │ 1. who: the Rebase account, re-read on every call
   │  aud = …/mcp>         │ 2. cloud ops: the control plane's own function routes,
   │                       │    called in-process AS that account, so the
   │                       │    existing gates (verifyProjectOwner/Admin +
   │                       │    the token's scopes) decide
   │                       │ 3. data and cron: mint a platform token for this
   │                       │    account and this project (rpt_, 5 min) …
   │                       ▼
   │              tenant runtime  <project host>
   │                POST /api/admin/mcp   Bearer rpt_…
   │                runs the app's own MCP tools (mcp-tools.ts) under RLS
   ▼
the reply (and, for show_collection, the ui:// view the control plane serves)
```

### Where it runs: inside the control plane

The control plane is already a Rebase app built on `@rebasepro/server`, with
users, organizations, project membership, the scope vocabulary
(`project:read`, `project:deploy`, `project:logs`, `project:env`,
`project:studio`, …) and an OAuth 2.1 authorization server it gets for free
from the framework's `/mcp` surface (`docs/mcp-remote.md`). The hosted
connector is that surface switched on for the control plane, with its tool set
replaced:

- **The framework** gains a way for an app to supply its own MCP tools,
  instructions and OAuth scope vocabulary instead of the default data tools.
  The control plane must not expose its own database (projects, deployments,
  billing rows) through the default tools, so it replaces them, not adds to
  them.
- **The control plane** registers the ten tools below, and `REBASE_MCP_ENABLED`
  plus `REBASE_PUBLIC_URL` turn the endpoint on.

A separate service was considered and rejected. It would need its own OAuth
server, its own copy of the membership rules, and a credential to call the
control plane with. Inside the control plane, all three already exist.

### How the account becomes the caller

The MCP access token says who consented (`uid`) and to what (`scope`). On
every call the framework re-reads the account (deleted, disabled, signed out
everywhere, demoted all stop the next call, as for `/mcp` today).

**Cloud operations** (status, deployments, logs, env, deploy, rollback) are
the control plane's existing function routes. A hosted tool does not
re-implement them. It calls them in-process, as the account:

- The tool mints a session token for the account with the backend's own key
  and hands a `Request` carrying it straight to `backend.fetch`, the whole
  backend as a fetch handler with no port (`saas/backend/src/mcp/as-account.ts`).
  The token exists only on that in-process request. No framework change was
  needed for this.
- Every existing gate then runs unchanged: `verifyProjectOwner` /
  `verifyProjectAdmin` answer the organization role. A `member` gets what a
  member gets in the console. There is no second copy of an authorization rule
  to drift.
- A session holds every scope its person holds, so the grant's narrower scopes
  are checked by the tool before it calls (`requireGrant` in `access.ts`). An
  owner who consented only to `project:read` cannot deploy.

**Inside a project** (data, schema, the table view, cron) the control plane
reaches the tenant the way `docs/platform-tokens.md` designed for cron: it
signs a platform token for this account and this project, and the tenant
verifies it with a public key.

- Gate in the control plane, before minting (`requireTenantAccess` in
  `saas/backend/src/mcp/access.ts`): an owner or admin of the organization, the
  grant's `project:studio` on the project, and the project's Studio switch
  (`isStudioEnabled`), read fresh. That is the console's Studio gate.
  Reading cron is the exception: it needs membership and `project:logs`, what
  `runtime-token` issues `cron:read` for. The connector reaches a project's data exactly
  when the console would let the same person open Studio on it, and the
  customer's "Studio access off" switch turns both off.
- The token: `rpt_<ES256 JWS>`, `aud` = the project, `sub` = the account,
  `scope` = the data scopes the call needs (`data:read`, or `data:write` /
  `data:delete` for a confirmed write, `cron:read` / `cron:write` for cron),
  `exp - iat` = 300 s, a `jti` logged at both ends.
- The tenant runs the call through its own `mcp-tools.ts`, under row-level
  security, as `platform:<uid>` with the role `admin`. That is the reach of the
  identity the console's Studio already uses (`SERVICE_IDENTITY`: RLS
  evaluated, the default policies' admin arm passes). It is not an RLS bypass,
  and not raw SQL.

The control plane never holds the tenant's service key for this path, never
sees the tenant's database credentials, and the tenant's own ceiling
(`PLATFORM_TOKEN_SCOPES`) remains the last line: a compromised control plane
cannot sign itself more than that list.

#### Why proxy to the tenant rather than run the tools in the control plane

- One implementation of the data tools. The tenant's tools already speak REST
  (`docs/mcp-remote.md`), apply the app's collection callbacks, its auth
  collection rules and its RLS. Re-implementing them in the control plane
  against the tenant's REST API would be a second, drifting copy.
- The control plane does not need the app's collection schemas. The tenant has
  them, at the version that is deployed.
- `show_collection` is already a tool there.

The cost is a rollout dependency: a tenant must run a runtime that serves
`/api/admin/mcp` before its data is reachable. Until then the data tools say
so, with the fix (redeploy, or the next fleet rollout).

#### The tenant endpoint: `POST /api/admin/mcp`

- Mounted when platform tokens are configured
  (`REBASE_PLATFORM_TOKEN_KEY` + `REBASE_PLATFORM_TOKEN_AUDIENCE`), and only
  then. It accepts `rpt_` tokens and nothing else: no OAuth, no `rk_` keys, no
  session tokens, no `.well-known` documents.
- Independent of `REBASE_MCP_ENABLED`. That variable is the customer's decision
  to hand credentials to third-party software. The platform endpoint gives no
  third party anything, so it does not need that decision, and turning it on
  does not open the public `/mcp`.
- Under `/api/admin`, where the platform's other admin surfaces live, so a
  customer's own `/mcp` route (or the public one) never collides with it.
- It reuses the `/mcp` JSON-RPC dispatcher and the same tools, with the same
  body limit, batch cap and per-caller rate limit (bucketed by
  `platform:<uid>`).

### OAuth scopes the connector asks for

The control plane's grant uses its own vocabulary, not the data plane's:

| Scope | What the connector can then do |
|---|---|
| `project:read` | list projects, read status and deployments |
| `project:logs` | read runtime, build and cron logs |
| `project:env` | list env var names; set and unset (confirmed) |
| `project:deploy` | deploy, roll back, cancel (confirmed) |
| `project:studio` | read data and schemas, the table view; write data and run cron jobs (confirmed) |

The consent screen lists them in plain words. `project:backups`,
`project:restore`, `project:database` and `project:configure` are not offered:
no tool needs them.

## The tools

Ten tools, down from 55 local plus 9 per app. Each takes `project` (an id or a
name; ambiguity is an error that lists the matches) except `projects`.

| # | Tool | Arguments | Annotations | Needs | Runs |
|---|---|---|---|---|---|
| 1 | `projects` | `organization?` | read-only | signed in | the control plane's projects, filtered by membership |
| 2 | `project_status` | `project`, `include?: ("deployments" \| "env" \| "cron" \| "metrics")[]` | read-only | `project:read` (+ `project:env` for env names, `project:studio` for cron) | status, health, current and recent deployments; env var **names** only |
| 3 | `logs` | `project`, `source: "runtime" \| "build" \| "cron"`, `deployment?`, `job?`, `tail?` (200), `since?` | read-only | `project:logs` (+ `project:studio` for cron) | runtime-logs, a deployment's build log, cron run history |
| 4 | `schema` | `project`, `collection?` | read-only | `project:studio` | tenant `list_collections`, or `describe_collection` when `collection` is given |
| 5 | `query` | `project`, `collection`, `id?`, `where?`, `orderBy?`, `limit?`, `offset?`, `searchString?`, `count?` | read-only | `project:studio` | tenant `get_document` / `query_collection` / `count_documents` |
| 6 | `show_collection` | as `query`, without `id` and `count` | read-only, opens a view | `project:studio` | tenant `show_collection`; the view is served by the connector |
| 7 | `write` | `project`, `collection`, `action: "create" \| "update" \| "delete"`, `id?`, `data?`, `confirm?` | destructive, not idempotent | `project:studio` | tenant `create_document` / `update_document` / `delete_document`. Users are rows of the auth collection, so this covers creating, editing and deleting users, under the auth rules the app's REST routes apply |
| 8 | `deploy` | `project`, `action: "deploy" \| "rollback" \| "cancel"`, `branch?`, `deployment?`, `confirm?` | destructive, not idempotent | `project:deploy` | the control plane's deploy routes |
| 9 | `env` | `project`, `action: "set" \| "unset"`, `vars?: { KEY: value }`, `keys?: string[]`, `confirm?` | destructive, idempotent | `project:env` | the control plane's env-vars routes |
| 10 | `cron` | `project`, `job`, `action: "run" \| "enable" \| "disable"`, `confirm?` | destructive, not idempotent | `project:studio` | the tenant's `/api/admin/cron` |

Every tool also carries `openWorldHint: false` (it acts on Rebase, not the open
web) and a `title`.

Why reads and writes are separate tools: annotations are per tool. An `env`
tool that also listed variables would have to be marked destructive, and the
host would ask before every read. So env **names** are read through
`project_status`, and the `env` tool only writes. The same split keeps `query`
and `show_collection` free of prompts.

Not offered, on purpose:

- **Deploying local code.** The hosted connector has no checkout. It deploys a
  git branch (a project connected to a repository), rolls back to a previous
  deployment, or cancels one. Uploading source stays with the CLI and the local
  server.
- **`db migrate` / `db push` / schema changes.** These run from local code. On
  Cloud, migrations run with a deploy.
- **Creating or deleting projects, billing, backups and restores.** Each costs
  money or destroys data on a scale where the console is the right place.
  Easy to add later as actions of the tools above.
- **Storage objects** and **invoking functions.** Possible follow-ups; neither
  was in the brief.

Tool descriptions are written for the model: one sentence on what it is for,
one on when to use it rather than its neighbour (`query` vs `show_collection`:
"use show_collection when the person wants to look at rows; use query when you
need the rows yourself"), and, on the four mutating tools, the confirmation
contract.

## The confirmation protocol

Applies to `write`, `deploy`, `env` and `cron`.

**Step 1: plan.** The call without `confirm` validates the arguments, resolves
the project, and runs every authorization check the real call would run. It
changes nothing. It answers:

```json
{
  "status": "confirmation_required",
  "plan": {
    "summary": "Roll back project shop-prod (production) to deployment d_81f2, built 2026-11-03 14:02 from main@4c1e9a0.",
    "effects": ["The current deployment d_9a03 stops serving traffic.", "Env vars are not changed."],
    "reversible": "Yes: roll forward to d_9a03."
  },
  "confirm": "rmc_eyJ2IjoxLC…",
  "expiresAt": "2026-11-05T10:32:00Z"
}
```

The text the model reads says: show this plan to the person, and call again
with `confirm` only after they agree. For `write`, the plan shows the row as it
is now and the fields that change. For `env`, values are never echoed: a value
is shown as `(12 characters, hidden)`.

**Step 2: execute.** The same tool, the same arguments, plus `confirm`. The
server verifies, in this order, and refuses on the first failure:

1. The token's HMAC (key derived from `ENCRYPTION_KEY`, label
   `mcp-confirmation:v1:`, the way the tenant service keys are derived).
2. Not expired. Tokens live 5 minutes.
3. Bound to the same account (`uid`), the same OAuth client (`clientId`), the
   same tool, the same project, and the same arguments: a SHA-256 of the
   canonical JSON of the arguments without `confirm`. A model that changes one
   field between plan and confirm gets a refusal, not a different action.
4. Single use. The token's `jti` is inserted into `mcp_confirmations` (primary
   key on `jti`). A second use fails on the conflict, across replicas.
5. Authorization again, live. A demotion between the two steps refuses.

Then it executes. The server logs the `jti` with the account and the client,
so the audit lines on both sides can be matched.

**What it protects against, and what it does not.** It makes a destructive
action impossible in one call, so a prompt injection in a row or a log line
cannot trigger a deploy outright. It pins exactly what was shown. And it puts a
plan in the transcript, where the person sees it. It cannot prove that a human
said yes: a model can call twice. The human check comes from the host. Claude
asks before calling a tool marked `destructiveHint` unless the person chose
"always allow". MCP elicitation (the server asking the host to show a
confirmation dialog itself) would close that gap, but it needs a
server-initiated message, which this stateless POST-only endpoint does not
send. That is listed under decisions.

**The table view's edits.** A cell edit in `show_collection` is the person's
own action, but it goes through the same protocol: the view calls `write`
(plan), shows the change inline with a Confirm button, and sends the second
call when the person presses it.

The protocol lives in the framework (`packages/server/src/mcp/confirmation.ts`)
as an opt-in on a tool definition, so the per-app `/mcp` can adopt it for
`delete_document` later. Its single-use store is an interface with a Postgres
implementation beside the OAuth store.

## MCP Apps: `show_collection`

- **The view** (`ui://rebase/collection-table.html`) is served by the
  connector, from the same `@rebasepro/mcp-apps` build the server already
  inlines. `resources/list` and `resources/read` answer from the control plane.
  The tenant is never asked for HTML.
- **The data** comes from the tenant's `show_collection`, under the platform
  token, and is relayed as the tool's result.
- **The view's own calls** (next page, cell edits) come back to the connector,
  because the host relays them to the server that served the view. Today the
  view calls `query_collection` and `update_document` by name, which are not
  the hosted tools' names. The fix is in the view: `show_collection`'s
  structured result names the tools the view should call (`actions: { page:
  "query", edit: "write" }`), and the view defaults to the current names when
  that is absent, so the per-app `/mcp` keeps working unchanged. The view
  spreads the original tool input into its calls, so `project` travels with
  them.

## Security model

**Principals.** A person (Rebase account) → an OAuth grant to one client (the
host) with a subset of the `project:*` scopes → per call, the control plane's
gates → per tenant call, a 5-minute platform token for one project.

| Threat | What stops it |
|---|---|
| The connector does more in a project than the person could in the console | The tenant path is gated by the console's own Studio gate, and cloud ops run through the console's own routes. No new authorization rule exists to get wrong |
| A member uses the connector to reach data | `verifyProjectAdmin` refuses members, exactly as Studio does |
| The customer has switched Studio access off | `isStudioEnabled` is checked before every mint |
| A stolen MCP access token | 1 hour, audience-bound to the connector, purpose-quarantined (refused by `/api/*`), narrowed to the consented scopes; refresh tokens rotate and a replay revokes the family; the person can disconnect the client |
| A stolen platform token | It never leaves the control plane → tenant hop; 5 minutes; audience is one project; the tenant grants at most its ceiling |
| A malicious tenant (customer code) | It receives a token valid only for itself. Its replies are capped in size and time, stripped of `set-cookie`, and fenced as untrusted data before the model sees them, as the Studio proxy does |
| Prompt injection in rows or logs | Results are fenced in `untrustedEnvelope`. Mutations need the two-step, bound to exact arguments |
| A confirmation reused, or used for other arguments | Single-use `jti`; bound to account, client, tool, project and argument hash; 5 minutes |
| Cross-project confusion | `project` is resolved and gated on every call. A confirmation is bound to one project |
| Secrets passing through the model | Env values are write-only through the connector: never listed, never echoed in a plan or a result. Setting one does put it in the conversation, and the `env` description says so |
| Abuse of the endpoint | The data rate limiter on the control plane's `/mcp`, bucketed by account; the tenant's own limiter, bucketed by `platform:<uid>` |

**Audit.** The control plane logs every mint (`sub`, project, scopes, `jti`)
and every confirmed call (tool, account, client, confirmation `jti`). A deploy
or rollback started from the connector is recorded with `triggerSource: "mcp"`
and shows as "via the Rebase connector" in the console. The tenant logs
`[Auth] Platform token accepted` with the token's `jti`.

The organization's activity log (what the console's Activity page and
`rebase cloud activity` read) records the connector's actions as the person,
labelled "<email> via the Rebase connector". Deploys, rollbacks and env
changes are recorded by the control plane's own routes, which see that the
in-process request was the connector's: the mark is the `Request` object in a
`WeakSet`, so no network caller can forge or shed it. Rows written and cron
jobs run inside a project pass no such route, so the connector records them
itself: `data.create`, `data.update`, `data.delete` (the row's id and field
names, never values), `cron.run`, `cron.enable`, `cron.disable`. The activity
log lives on the unmerged saas branch `sweep/2026-10-24`, so this part is on
the saas branch `feat/hosted-mcp-connector-audit`, stacked on it.

Two things are left out on purpose:

- `runtime-token` (what `rebase cloud cron` uses) issues `cron:read` only. The
  connector signs its own tokens after its own gates, and nothing in the CLI
  would use more; issuing `data:*` there would hand a `--can logs` token a way
  into project data that no command needs.
- Preview pods get no platform-token variables. A preview needs an audience of
  its own (for example `<project>:preview:<name>`), or it would accept
  production's tokens, and nothing mints a preview token yet. It belongs with
  a "previews" target for the tools.

## What changes where

**Framework (`rebasepro/rebase`, this repo):**

1. `McpToolDefinition` gains `annotations` and `title`. `tools/list` sends them,
   and the per-app tools get accurate annotations too.
2. `initializeRebaseBackend({ mcp: { tools, instructions, scopes } })`: an app
   supplies its own tool set and OAuth scope vocabulary (with consent-screen
   descriptions) in place of the default data tools.
3. The confirmation protocol: `confirmation.ts`, the `mcp_confirmations` table,
   and tests.
4. Platform tokens: `PLATFORM_TOKEN_SCOPES` gains `cron:write`, `data:read`,
   `data:write`, `data:delete`. The platform caller is `platform:<sub>` with the
   role `admin`, on `/api/admin/mcp` and on the cron routes only. It stays a 401
   on `/api/data`, the websocket and the public `/mcp`. This is the change
   `docs/platform-tokens.md` says needs its own review: this document is that
   review.
5. `POST /api/admin/mcp`: the platform MCP endpoint.
6. The view: tool names from the structured result, and inline confirmation
   for edits.
7. The consent screen: the app's scope descriptions, and "Continue as you"
   from the session the app's own frontend keeps in the browser.

**Control plane (`rebasepro/saas`):** branch `feat/hosted-mcp-connector` (on
`main`), and `feat/hosted-mcp-connector-audit` (the same two commits stacked on
`sweep/2026-10-24`, plus the activity log). Ship the second once the sweep
branch is merged; until then the first ships without the activity log.

1. The unbuilt half of platform tokens (spec in `docs/platform-tokens.md`): the
   signing key derived from `ENCRYPTION_KEY`, both variables injected on every
   tenant path, and the `runtime-token` function.
2. The ten tools, each a thin adapter over an in-process call or a tenant call.
3. `REBASE_MCP_ENABLED=true`, `REBASE_PUBLIC_URL`, the scope vocabulary.
4. Tests: every tool against a member, an admin, a narrowed grant and a
   switched-off Studio. Confirmation binding, expiry and replay. A tenant reply
   that is hostile (huge, slow, `set-cookie`).

**Docs:** a page in `website/src/content/docs/<locale>/docs/ai/` in the five
locales ("Connect Claude to Rebase Cloud"), the CHANGELOG `[Unreleased]`
entries, and this file kept as the design record.

## Rollout order

1. Release the framework (a `@rebasepro/server` with items 1–7) and roll the
   managed runtime to it. On its own this changes nothing on any tenant: the
   platform endpoint is off without the platform variables.
2. Ship the control plane with the platform-token signing key and env
   injection. Each tenant picks the variables up at its next deploy or fleet
   rollout, which is when its data becomes reachable through the connector.
3. Turn on the control plane's `/mcp`. From then on the connector works for
   cloud operations on every project, and for data on every rolled tenant.
4. Add the connector to the docs and the console ("Connect Claude").

Steps 1, 2 and 3 are a release, a control-plane deploy and a fleet rollout.
Each needs Francesco's explicit go. The branch prepares them and ships nothing.

## Decisions taken

Francesco approved every recommendation on 2026-11-05.

1. **Who you are inside a project.** Taken: membership-derived, as above
   (owner/admin with `project:studio` and Studio on → `platform:<uid>` with the
   `admin` role, the console's Studio reach; members → no data). The
   alternative is a *linked app account*: the tenant maps the token to the app
   user whose verified email matches the Rebase account, and runs as that user
   with their own roles. It is closer to "the same data access the user has in
   the app", but it gives nothing on a fresh project with no accounts, and it
   trusts the app's email verification, which is the customer's code.
2. **The address.** `https://app.rebase.pro/mcp` needs no infrastructure.
   `https://mcp.rebase.pro/mcp` reads better but needs DNS, an ingress rule,
   and a separate public URL for the MCP surface (the token audience is the
   URL people paste). Taken: `app.rebase.pro/mcp` now, the alias later.
3. **Signing in on the consent screen.** It accepts a password today, and many
   Cloud accounts sign in with Google or GitHub only. Options: (a) "Continue
   as <you>" from the console session in the same browser, with a button press
   (never automatic); (b) Google and GitHub buttons that come back to the
   consent request; (c) both. Taken: (a), built, it is smaller and covers
   anyone who has the console open.
4. **Elicitation.** A human-only confirmation through MCP elicitation needs
   server-initiated messages (an SSE response). Taken: not now; the
   two-step plus the host's approval prompt is the v1.
5. **Scope of v1.** Taken: the ten tools above. Candidates for later:
   backups (list, create), storage objects, invoking functions, creating a
   project.
6. **The per-app `/mcp`.** Taken: unchanged, except that its tools get
   annotations. Adopting the confirmation protocol for its `delete_document`
   would change behaviour for apps' end users, and is a separate decision.
