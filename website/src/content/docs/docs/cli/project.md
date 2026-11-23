---
title: A running app
sidebar_label: A running app
description: CLI commands that act on a running Rebase app through its API — rows, users, cron, logs, functions, files, the RLS simulator — on rebase dev, a server you name, or a Rebase Cloud project.
---

These commands talk to a running app over its own API, so row-level security, field access, hooks and storage policies decide what they may do, as they do for the SDK. They reach the local `rebase dev`, a server you name, or a Rebase Cloud project, with the same flags everywhere.

## Choosing the server and the credential

| Flag | Where requests go, and as whom |
|---|---|
| *(none)* | `REBASE_BASE_URL` (shell, then `.env`), else the `rebase dev` this checkout is running; with the service key from `.env` |
| `--url <server>` | That server, with the service key from `.env` |
| `--project <slug>` | A Rebase Cloud project, through the console's Studio proxy: you sign in with `rebase cloud login`, and the control plane attaches the app's key on its side, so no key reaches your machine. Organization owners and admins, on a project whose Studio access is on (`rebase cloud settings set --studio on`) |
| `--cloud` | The Rebase Cloud project this directory is linked to |
| `--token <bearer>` | Send this bearer instead: an `rk_` key, or a user's access token. On a Cloud project it goes to the app's own address |
| `--session` | Send the person session `rebase auth login` stored for that server |
| `--anon` | Send nothing: what a visitor gets |

Nothing else is guessed: with no `REBASE_BASE_URL` and no running `rebase dev`, a command refuses rather than send the service key to whatever listens on a port. The running `rebase dev` is the one whose process is alive, at the port its backend announced (`.rebase/dev.json`, else the backend's own `.rebase/state.json`); `.rebase-dev-url` is for your scripts, and a killed run leaves it behind, so no command reads it. Every command takes `--json` (and is JSON whenever stdout is not a terminal, as `rebase cloud` is) and `--yes`, which answers the confirmation that every destructive one asks; with no terminal it refuses with `confirmation_required` instead of prompting.

`rebase api-keys`, `rebase storage orphans|move` and `rebase schema reconcile` take the same flags.

## `rebase api`

Any route the app serves, with the project's credential — the long tail that has no command of its own: a materialized view's refresh, the RLS audit, `/api/meta/contract`, a route a plugin adds.

```bash
rebase api data/posts -f status=eq.published -f limit=5   # GET /api/data/posts?status=eq.published&limit=5
rebase api POST data/posts -F title=Hello -F published=true
rebase api /api/admin/rls-audit --project acme
rebase api PATCH data/posts/42 --input change.json --include
```

A path without a leading `/` is under `/api`. `-f key=value` is a string field and `-F` a typed one (`true`, `false`, `null`, numbers, JSON, `@file`); fields are the query string of a GET, HEAD or DELETE and a JSON body otherwise. Unlike `gh api`, a field alone never makes the request a POST: a write names its method or carries `--input`. The answer is printed as it came — JSON pretty-printed — and a non-2xx answer is printed and exits 1. An `Authorization` header is refused; the target flags choose the credential.

## `rebase data`

The rows of a table, through `/api/data`. Filters are the API's own (`?status=eq.published`), passed through as written: `--where status=eq.published`, `--where price=gte.10`, and a bare `--where status=draft` for equality.

```bash
rebase data query posts --where status=eq.published --order-by created_at:desc -n 10
rebase data query orders --all --format csv > orders.csv
rebase data get posts 42 --include author
rebase data count posts --where status=eq.draft
rebase data aggregate orders --select "count(),sum(total)" --group-by status
rebase data insert posts --data '{"title":"Hello"}'
rebase data update posts 42 --data '{"title":"Renamed"}'
rebase data delete posts --where status=eq.draft --yes
rebase data import posts --file seed.csv --upsert slug
rebase data history posts 42 && rebase data revert posts 42 <historyId>
rebase data watch posts --where status=eq.published
```

| Action | Notes |
|---|---|
| `query <table>` | `--where`, `--or`, `--order-by col[:desc]` (repeatable), `--limit`, `--offset`, `--fields a,b`, `--include`, `--search`, `--deleted include\|only`; `--all` walks every page; `--format table\|json\|ndjson\|csv` (csv and ndjson stream with `--all`) |
| `get <table> <id>` | One row, with `--fields` and `--include` |
| `count <table>` | The rows `--where` matches |
| `aggregate <table>` | `--select` and `--group-by`, the API's own |
| `insert <table>` | `--data <json>` or `--file <path\|->`; an array is several rows in one bulk write; `--upsert <column>` |
| `update <table> [<id>]` | One row, or every row `--where` matches after a count and a confirmation; `--if-match <etag>` |
| `delete <table> [<id>]` | Asks first; `--hard` on a soft-delete table |
| `import <table>` | `--file` (JSON array, NDJSON or CSV by extension, or `--format`), in batches (`--batch`); `--upsert`, `--ignore-duplicates`. What `query --format json` writes reads back |
| `history <table> <id>`, `revert <table> <id> <historyId>` | Tables with history on |
| `watch <table>` | The matching rows each time they change, over the realtime socket. Not through the Studio proxy: on a Cloud project pass `--token` or `--session` |

The service key is the `admin` role: row-level security still runs, as that role. Pass `--token`, `--session` or `--anon` to see the table as somebody else does.

## `rebase schema show`

The tables, or one table's columns, relations and row-level security — from `backend/schema` by default, or with `--remote` (or any target flag) as the running server describes them to this credential. A credential without `schema:read` sees no policies, and a table it cannot read is not listed.

```bash
rebase schema show
rebase schema show posts --remote --project acme
```

## `rebase users`

The accounts, through `/api/admin/users`, `/roles` and `/guests`. An account is named by its uid or its email (an exact match, never the first fuzzy hit).

```bash
rebase users list --search ada
rebase users create ada@example.com --role admin
rebase users import users.csv --dry-run
rebase users update bob@example.com --add-role editor
rebase users update bob@example.com --disable
rebase users reset-password bob@example.com
rebase users mfa-reset bob@example.com
rebase users roles
rebase users guests prune --older-than 30d --yes
```

`create` emails an invitation, or answers a temporary password once when no mail can be sent. `--no-invite` creates the account with no password and sends nothing, for an app that signs in by magic link, an email code or a provider (`POST /api/admin/users` with `invite: false`). Granting a role, `--disable`, `delete` and `mfa-reset` ask first. No caller may grant a role above its own, or act on an account that outranks it. `rebase auth reset-password` is the older spelling, and still falls back to the database when the server is not running.

### Importing accounts

`import` brings accounts over from another system and keeps their ids, so the rows that point at a user still point at the same one. It takes a CSV, a JSON array or NDJSON (`--format`, else the extension), with these columns:

| Column | |
|---|---|
| `id` | Kept as the account's id. Optional: without it the users table generates one. A uuid is the common case; letters, digits and `_ - . : \|` up to 128 characters also fit, though a `uuid` id column takes only uuids |
| `email` | Required |
| `display_name` / `displayName` | |
| `photo_url` / `photoUrl` | |
| `created_at` / `createdAt` | When the account was created there. Optional: now |
| `email_verified` / `emailVerified` | `true`/`t`/`1` or `false`/`f`/`0`. Optional: `false`, and the first magic link or reset the account follows confirms it |
| `roles` | `editor;viewer`, a quoted `"editor,viewer"`, or a Postgres array `{editor,viewer}` |

No password and no hash is imported, and no email is sent: an imported account signs in by magic link, an email code, a provider, or a password reset. An account whose id or email is already taken is reported as skipped and left as it is, never updated, so a file can be run again. Each account is reported as created, skipped or failed with the reason; the command exits 1 when any failed. `--dry-run` checks every account and writes nothing. The CLI sends 100 accounts per request (`POST /api/admin/users/import`), on `rebase dev`, a server or a Rebase Cloud project alike.

From Supabase:

```bash
SUPABASE_DB_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres"
psql "$SUPABASE_DB_URL" -c "\copy (select id, email, created_at, email_confirmed_at is not null as email_verified from auth.users) to users.csv csv header"
rebase users import users.csv --dry-run
rebase users import users.csv --project my-app
```

## `rebase cron`

The app's scheduled jobs (`backend/crons/*`).

```bash
rebase cron list
rebase cron logs nightly-backup -n 5
rebase cron run cleanup-sessions --yes
rebase cron disable nightly-backup --yes
rebase cron reset nightly-backup          # the job's code decides again
```

`enable` and `disable` override the job's code on every process, across redeploys; `run` asks first, and `--async` answers once the run has started. On a Cloud project `rebase cron` needs no Studio access for reads: it asks the control plane for a short `cron:read` platform token, which any member with log access holds. `run`, `enable`, `disable` and `reset` ask for `cron:write`, which an organization owner or admin holds on a project with Studio on. `rebase cloud cron` is the older, read-only spelling.

## `rebase logs`

The server's request and application log — the buffer Studio's Logs view reads — once, or followed with `-f`.

```bash
rebase logs -n 50 --level warn
rebase logs -f --source auth --search "sign-in"
```

The buffer is one process's. With `--project` or `--cloud` this is `rebase cloud logs --runtime`: every replica's output, through the control plane.

## `rebase functions`

The app's own routes, one per file in `backend/functions/`.

```bash
rebase functions list
rebase functions invoke hello --anon
rebase functions invoke billing webhook -X POST --input event.json
```

`invoke` takes the fields, body and headers `rebase api` takes, and prints the answer as it came. Functions decide their own access, so the credential matters: `--anon` shows what a visitor gets.

## `rebase storage`

Stored files, through the storage policies. The stored side starts with a colon: `:avatars/me.png` in the default source, `media:avatars/me.png` in the source keyed `media`.

```bash
rebase storage ls :avatars
rebase storage cp ./me.png :avatars/me.png
rebase storage cp :avatars/me.png ./me.png
rebase storage url :avatars/me.png      # a signed link: whoever holds it reads the file until it expires
rebase storage stat :avatars/me.png
rebase storage rm :avatars/me.png --yes
```

`cp --public` uploads under the public prefix (a permanent, token-less URL), `--content-type` sets the type, and `--force` overwrites a local file on download. `orphans` and `move` are the whole-store maintenance half of the group.

## `rebase rls simulate`

What another identity would see, from the app's RLS simulator — the one Studio's "view as" uses: per table, the rows it reads against the rows you read, the tables its scopes shut it out of, and the columns it cannot read. Read-only.

```bash
rebase auth login --email you@example.com
rebase rls simulate --role anon
rebase rls simulate --user 3f0c9a7e-… --table posts
rebase rls simulate --key <api-key-id>
rebase rls options
```

The simulator answers an administrator's own session and never a key, so this sends the session `rebase auth login` stored. `rebase verify --live` checks the policies themselves, with no identity in mind.

## `rebase auth login`, `emails` and `keys`

Some routes answer a person and never a machine: the RLS simulator, personal keys, live schema apply. `rebase auth login` signs in to a running app — through the browser when the server offers device sign-in, else with `--email` and a password (`--code` for a second factor) — and keeps the session in `~/.rebase/sessions.json`, by server, never in the project. `auth whoami` says who the server takes you to be and the scopes you hold; `auth logout` ends the session there too.

```bash
rebase auth login --email you@example.com
rebase auth whoami --session
rebase auth emails --latest --links      # the dev mailbox: sign-in, reset and magic-link mail with no SMTP_HOST
rebase auth keys create --name ci --scopes data:read:posts --expires-in 30
rebase auth keys revoke <id> --yes
```

`auth emails` reads the development mailbox a server with no `SMTP_HOST` keeps instead of sending; `--clear` empties it. An empty mailbox is answered with the server that was asked (`The development mailbox at http://localhost:3082 (rebase dev) is empty.`, and `server` in the JSON), since an empty answer from another backend reads exactly like mail that was never sent. `auth keys` manages your own `rk_` keys, which act as you, narrowed to the scopes named; the server answers it only when the auth table sets `auth.personalKeys: true`. Service keys are `rebase api-keys`, which also gained `update <id>`.

## Next steps

- [Endpoint index](/docs/backend/endpoints/) — every route these commands reach, and the scope each needs
- [REST API](/docs/backend/api/) — the filter, sort and paging syntax `rebase data` passes through
- [rebase cloud](/docs/cli/cloud/) — the project itself on Rebase Cloud: deploys, environment, backups, Studio access
- [CLI Reference](/docs/cli/) — every other command
