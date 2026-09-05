---
slug: docs/troubleshooting
title: Troubleshooting
description: The failures that stop a Rebase backend from starting or serving — an unreachable database, wrong credentials, a missing extension, an RLS refusal, schema drift, a busy port, a function that will not load — and what each one looks like.
---

The failures that stop a Rebase backend from starting or serving, what each one
actually looks like on screen, and what to do about it.

Boot fails loudly and completely. If the database is unreachable, the
credentials are wrong, or the collection schema cannot be applied,
`initializeRebaseBackend` throws, nothing is served, and the process exits `1`.
There is no degraded mode: a server that comes up answering sign-in while every
`/api/data/*` route fails is harder to diagnose than one that never comes up.

So the first place to look is always the last thing in the log before the exit.

## Reading a boot error

Every database error you see is a wrapper. Drizzle rethrows query failures as
`Failed query: …` with a stack through its own internals, and the sentence that
says what is wrong sits underneath, in `.cause` — or inside an `AggregateError`
when a dual-stack host tried several addresses.

The runtime unwraps it for you. A boot failure logs:

- a **boxed diagnosis** naming the host, the port, and the fix, and
- `caused by:` lines carrying the chain, ending in the reason the operating
  system or Postgres gave.

If you are reading JSON logs (`NODE_ENV=production`), the same chain is under
`error.cause`, with `code`, `address` and `port` on each link.

## The database is not running

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  ❌  Cannot connect to PostgreSQL at 127.0.0.1:5432
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  The driver said: connect ECONNREFUSED 127.0.0.1:5432 (ECONNREFUSED)
```

Nothing is listening on that address. Start the database:

```bash
docker compose up -d db       # the service a Rebase scaffold ships
brew services start postgresql@18
```

Or run `rebase dev` with no `DATABASE_URL` at all, which starts a managed PGlite
database for you and needs nothing installed.

If the host and port in the box are not the ones you expected, `DATABASE_URL` in
`.env` is not the one the process read — check for a second `.env`, a shell
variable already exported, or a container that was started before you edited it.

## The password or the database name is wrong

```
  ❌  Authentication failed for user "app" at db.internal:5432
  The driver said: password authentication failed for user "app" (28P01)
```

`28P01` is a wrong password, `28000` a role that may not connect from here, and
`3D000` a database that does not exist. All three are settled facts about the
connection string: retrying produces the same answer, so boot fails immediately
rather than reporting a pool that "may recover".

Check the credentials in `DATABASE_URL`. A password containing `@`, `/`, `?` or
`#` must be percent-encoded — an unencoded one silently reshapes the URL and the
host you end up connecting to is not the one you wrote.

## `type "vector" does not exist`

pgvector is a server extension, so Rebase installs it only where a project says
it may. Declare it in `config/resources.ts`:

```ts
database({ extensions: ["vector"] })
```

The database also needs an image that ships the library. The scaffold's
`pgvector/pgvector:pg18` does; a stock `postgres:18` does not. If the install
itself is refused (`extension "vector" is not available`, or a permission
error), the config is already right and what is missing is the library on the
server or a role allowed to run `CREATE EXTENSION vector;`.

## The database refused the statement

```
DB_PERMISSION_DENIED — Permission denied by the database on "notes"
(row-level security). Check the RLS policies for this table.
```

SQLSTATE `42501`. Two different problems arrive under it, and the message
distinguishes them:

- **A row-level security policy denied the row.** The access-control system is
  working; the caller asked for something their policies do not permit. Check
  the collection's `securityRules`, and run `npx @rebasepro/rls-check` for a
  read-only audit of what the database will actually enforce.
- **The role lacks a `GRANT`.** Nothing about the request will help — the
  connection role cannot touch the table at all. This is a deployment problem.

A read that RLS excludes is not an error: the rows are filtered and you get an
empty page. If a collection reads as empty for a signed-in user who should see
rows, the policy is the place to look, not the query.

## `SCHEMA_DRIFT` — a table or column does not exist

```
SCHEMA_DRIFT — Schema drift: table "posts" does not exist.
```

The code and the database disagree. In development:

```bash
rebase db push        # apply the collections to the database
rebase doctor         # the full three-way drift report
```

On a managed Cloud tenant, `db push` cannot reach the database — the runtime
applies the schema at boot instead, so redeploy rather than pushing.

If a table exists but a column does not, the usual cause is a collection file
that was edited without regenerating: run `rebase schema generate` and push
again.

## The port is already in use

```
Port 3001 is in use — trying 3002.
```

Dev binds the next free port and says so. The message matters because everything
else — your frontend's `VITE_API_URL`, a bookmark, a `curl` — is still pointing
at the old one. The usual cause is a previous `rebase dev` still holding the
socket.

Pass `--port` to pin one, or stop the other process. In production there is no
retry: the configured port is the port, and `EADDRINUSE` is fatal.

## The backend crashed and `rebase dev` kept running

A backend that throws on boot does not stop the watcher — it prints the stack and
waits for a file change. `rebase dev` reports this:

```
  ✗ The backend crashed on startup.
    Fix the error above; the watcher restarts it on the next change.
```

The error above it is the real one. The most common causes are a syntax error in
a collection file, an import that does not resolve, and a `DATABASE_URL` that
points at nothing.

## A custom function is not being served

Functions are loaded from `backend/functions` at boot, and a file that fails to
load is **skipped, not fatal** — the server starts without it. So the symptom is
a 404 on a route you just wrote, and the explanation is two lines earlier in the
boot log:

```
❌ [functions] Failed to load orders.ts: Cannot find module './util'
⚠️ [functions] 1 function file(s) were skipped and will NOT be served:
  - orders.ts (threw: Cannot find module './util')
```

The usual causes: a dependency imported but not in `package.json`, a relative
import missing its extension (`./util` rather than `./util.js` — the project is
ESM, so the extension is required), and a file that exports something other than
a Hono app. Author with `defineFunction(...)` from `@rebasepro/server` to get
that last one as a compile error instead.

A subdirectory is not scanned. `functions/admin/users.ts` is reported as a
skipped entry rather than served.

Once the server is up, a function that throws at request time answers the JSON
error envelope and logs the reason; a function that never returns is cut off at
`REBASE_FUNCTIONS_TIMEOUT_MS` and answers `504 FUNCTION_TIMEOUT`.

## Is it up? `/livez` and `/health`

| Path | Touches the database | Answers |
| --- | --- | --- |
| `/livez` | No | `200 {"status":"ok"}` while the process is running. Use it for a liveness probe. |
| `/health` | Yes, every data source | `200 {"status":"ok"}` when every configured data source answers; `503 {"status":"degraded"}` when one does not. Use it for a readiness probe. |

Do not put a liveness probe on `/health`: a database blip would make the
orchestrator kill an otherwise healthy process, turning a short outage into a
restart loop.

`/health` is unauthenticated, so outside development it publishes the verdict and
which data source is degraded, and nothing else. The driver's own error text —
which quotes the host, port, database name and role — goes to the logs.

## Errors after boot

Every API failure answers the same envelope and carries a `code`. The
[error-code reference](/docs/backend/errors/) lists all of them with the status
and the fix.

## Where to go next

- [Error codes](/docs/backend/errors/) — every `code` the API can answer, with the status and the fix.
- [Environment & Configuration](/docs/getting-started/configuration/) — every variable the runtime reads, and the ones production refuses to start without.
- [Backend Overview](/docs/backend/) — what boot does, in order, and which probe answers which question.
