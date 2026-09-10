# The remote MCP endpoint (agents, as the signed-in user)

A Rebase project can serve `/mcp`, so an AI client — Claude, an IDE, an agent —
reads and writes it **as the person who authorized it**, with every row filtered
by that person's own row-level security.

That "as the person" is the whole design, and it is what makes this different
from the stdio server in `@rebasepro/mcp`. That one is a developer tool: it runs
on a laptop and authenticates with a service or API key, which is admin-scoped
by construction. This one is for the *users of the application you built*.

Off unless you turn it on. See [Enabling it](#enabling-it).

## The two things to understand

**1. The tools do not filter. The database does.**

Every database call in `mcp/mcp-tools.ts` goes through
`scopeDataDriver(driver, { uid, roles })` before it touches anything, so the
connection runs as `rebase_user` with `app.uid` set to the caller. There is no
path in the tool surface that can read a row the caller could not read through
the application itself.

Two consequences that look like bugs and are not:

- a tool can return an empty list for a collection that plainly has rows — that
  is RLS working;
- a write can fail with a permission error the tool cannot explain in detail,
  because the policy that refused it is not visible from the tool.

**2. An MCP token is not a session token.**

MCP access tokens carry `purpose: "mcp-access"`, and `verifyAccessToken` refuses
any token with a purpose. So a credential issued to third-party software cannot
be replayed against `/api/data`, `/api/admin` or the websocket. It buys exactly
the one resource it names, and nothing else.

This matters more than it first looks: these are the only credentials the system
mints for software the operator never vetted, and they live in that software's
storage. Without the separation, "connect Claude to your project" would silently
mean "give Claude a full session".

## What it serves

| Path | What it is |
|---|---|
| `/mcp` | The MCP endpoint. JSON-RPC over Streamable HTTP; POST only |
| `/.well-known/oauth-protected-resource/mcp` | RFC 9728 — how a client discovers the authorization server |
| `/.well-known/oauth-authorization-server` | RFC 8414 — the endpoints below |
| `${basePath}/oauth/register` | RFC 7591 dynamic client registration |
| `${basePath}/oauth/authorize` | The consent screen |
| `${basePath}/oauth/token` | Authorization-code and refresh grants |
| `${basePath}/oauth/revoke` | RFC 7009, for a client retiring its own token |
| `${basePath}/oauth/grants` | A person's connected applications (session token) |

The `.well-known` documents sit at the ROOT, not under `basePath`, because both
RFCs define the path relative to the origin — the same reason `jwks.json` does.

## Enabling it

Two environment variables, both required:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com     # this deployment's real origin
```

`REBASE_PUBLIC_URL` has no default and is not derived from the `Host` header.
Every document this surface serves names absolute URLs, and the token audience
is one of them — taking the origin from a request header would make the issuer
identity, and the audience its own tokens are checked against, a value the
caller supplies.

No runtime role turns this on. Every other surface describes a process shape
("this container answers HTTP") and a role can decide it; this one is a decision
to hand credentials to third-party software, which is a product decision rather
than a topology one. `REBASE_MCP_ENABLED` is therefore the single line to grep
for when asking whether a deployment serves agents.

Optional:

```bash
REBASE_MCP_OPEN_REGISTRATION=false            # pre-registered clients only
```

Open registration is what makes the Claude connector flow work at all — the
client is software the operator has never heard of, and there is nobody to hand
a client ID to in advance. Switch it off only if you intend to issue client IDs
yourself.

### When it declines to mount

The surface refuses rather than degrades, and each refusal is one line in the
boot log:

| Condition | Why it refuses |
|---|---|
| `REBASE_PUBLIC_URL` unset | It cannot name itself, so it cannot check a token's audience |
| No JWT secret configured | Nothing to sign or verify tokens with |
| The driver has no `withAuth()` | `scopeDataDriver` returns the driver **unscoped** for such a driver — correct for `/api/data`, catastrophic here, where it would turn "acts as you" into "acts as the database owner" |
| The OAuth tables could not be created | An authorization server that cannot persist a code issues credentials it cannot check |

The last one is worth a note. `createDdlBootstrapper` logs a failed statement
rather than throwing — the right trade for the cron log table, where a failure
should not stop a server serving. `ensureTables` therefore asks the database
whether its own work happened, and throws if not.

## Scopes

Two, and no more:

| Scope | What it grants |
|---|---|
| `mcp:read` | `list_collections`, `query_collection`, `get_document` |
| `mcp:write` | The above plus `create_document`, `update_document`, `delete_document` |

A scope decides whether a tool is *offered*. It is not the access-control
mechanism — a `mcp:write` token still cannot write a row the user could not
write themselves.

## The consent screen

One page, self-contained HTML with no build step and no external asset, because
the backend may be running with no frontend deployed at all — and a consent
screen that renders unstyled is one people click through without reading.

It carries `X-Frame-Options: DENY` and `frame-ancestors 'none'`, which is not
boilerplate: a consent screen that can be iframed is a consent screen an
attacker can have clicked. Make it transparent, float a button under the
cursor, and the user presses Allow for a client the attacker registered, having
never seen the page. The rest of the policy follows from what the page is —
`default-src 'none'` with a fresh per-response nonce for its own inline script,
`form-action 'self'` so an injection cannot repoint the credential form,
`no-store` because the HTML embeds a signed authorization request, and
`no-referrer` so the `client_id` and `state` do not travel onward.

The password never reaches this surface. The form posts to the existing
`${basePath}/auth/login` — the same endpoint, password policy, rate limits and
MFA the application already has — and only the resulting session token is handed
to the decision endpoint. There is no second credential path here to get wrong.

The client's name is attacker-controlled, since anyone may register, so it is
escaped, length-capped and always rendered as a quoted, untrusted string.

## What a person can do about it

`GET ${basePath}/oauth/grants` lists the applications they have connected;
`DELETE ${basePath}/oauth/grants/:clientId` disconnects one. Both take an
ordinary session token, never an MCP one: an application the user connected must
not be able to enumerate or revoke the others.

Disconnecting revokes every refresh token in the grant and forgets the consent.
**An access token already issued keeps working until it expires**, at most an
hour — these are self-contained JWTs verified with no database round trip, which
is what makes `/mcp` cheap. The endpoint says so in its response rather than
implying an instant cut-off.

There is no built-in UI for this. It is an API for the application to render.

## The tables

Four, in the `rebase` schema, all revoked from `rebase_user`:

| Table | Holds |
|---|---|
| `oauth_clients` | Registered clients. Secrets stored as SHA-256, never in the clear |
| `oauth_authorization_codes` | Live codes, by hash. Single-use, 60-second TTL |
| `oauth_refresh_tokens` | Live refresh tokens, by hash, with a `family` for rotation |
| `oauth_consents` | Which person approved which client for which scope |

Refresh tokens rotate on every use, and a **replay revokes the whole family** —
if a spent token is presented again we cannot tell the legitimate holder from a
thief, so both lose.

## Known limits

- **Roles are frozen at consent.** They ride on the refresh record, so a role
  change does not reach an existing grant until the refresh token expires or the
  user disconnects the client. The alternative is a user lookup on every
  refresh, which would put the auth adapter on a path that has no dependency on
  it today.
- **The consent screen appears every time.** Consent is recorded but never read
  to skip the screen: skipping needs to know who the user is at `GET /authorize`,
  before they sign in, and the only thing available there is the refresh cookie —
  reading it means rotating a refresh token on a GET, disturbing the user's real
  session to save a click, and putting an auto-approval path on an endpoint any
  site can navigate a browser to.
- **No server-initiated stream.** `GET /mcp` answers 405. Nothing here pushes
  messages, and an SSE stream that stays silent forever is worse than a refusal.
- **Revocation cannot reach an issued access token.** See above.

## Where the tests are

| File | What it covers |
|---|---|
| `packages/server/src/mcp/oauth-metadata.test.ts` | The specification's rules as assertions — PKCE, redirect matching, canonical URIs |
| `packages/server/test/mcp-token-separation.test.ts` | The session/MCP quarantine and audience binding |
| `packages/server/test/mcp-oauth-flow.test.ts` | The handshake end to end, and its refusals |
| `packages/server/test/mcp-revocation.test.ts` | Disconnecting, and who may do it |
| `packages/server/test/mcp-hardening.test.ts` | Tampered tokens, malformed JSON-RPC, hostile tool inputs |
| `packages/server/test/mcp-boot-wiring.test.ts` | `init.ts` — the four ways it declines to mount, and the one way it proceeds |
| `packages/server-postgres/test/mcp-oauth-store.test.ts` | The store's SQL, against a real Postgres (PGlite) |
| `packages/server-postgres/test/mcp-rls-end-to-end.test.ts` | **The product claim**: real tables, real policies, real `applyAuthContext` |

The last two exist because the others cannot cover what they cover. The store
suite drives real SQL: an in-memory `OAuthStore` reimplements the invariants in
TypeScript and proves nothing about the statements in `oauth-store.ts`, where a
`text[]` bound the wrong way passes every in-memory suite and fails on the first
real request.

The RLS suite proves the sentence this whole feature is sold on. It builds real
tables with real policies, drives the actual tools through their actual `run()`,
and calls the same `applyAuthContext` the data path uses — including the switch
to the restricted `rebase_user` role. That last part is not incidental: PGlite
connects as a superuser, **superusers bypass RLS**, and the first version of
that file passed every read test while returning every row. Bypassing the
scoping makes 11 of its 14 tests fail.

Fourteen mutation checks have been run against this surface — removing the
audience check, the purpose quarantine, PKCE, the client binding on code
redemption, exact redirect matching, the RLS scoping itself — and each was
caught by tests that name the failure rather than the behaviour.
