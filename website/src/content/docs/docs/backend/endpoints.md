---
title: Endpoint index
sidebar_label: Endpoint index
description: Every HTTP route a Rebase backend mounts — data, auth, storage, admin, meta — with the gate on each one and the page that explains it.
---

Every route the server mounts, in one table, with what it takes to reach it.

The paths assume the default `basePath` of `/api`; `REBASE_BASE_PATH` moves all
of them together. `/health`, `/livez` and `/metrics` sit outside it on purpose,
because an orchestrator probes `/health` and should not have to know the base
path. `/health` is *also* mounted under it, so `/api/health` answers the same
way rather than 404ing at the one moment someone is checking whether the server
is alive.

A gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compares this
table to the routes the source registers, so a new surface cannot be added
without appearing here.

## Gates

| Gate | Means |
|---|---|
| **none** | Unauthenticated. Anyone who can reach the host can call it |
| **session** | A signed-in caller: an access token, or an API key scoped to the operation |
| **`resource:action`** | A caller holding that [scope](/docs/backend/roles-and-scopes/): an admin, a person whose role declares it, an API key created with it, or the service key |
| **RLS** | Authenticated, and then the database decides row by row — see [Security Rules](/docs/collections/security-rules/) |
| **dev** | Mounted only outside production |

## Data

<span class="since-badge" data-since="0.31">Since 0.31</span>

Generated per table, so the paths carry your slugs rather than a fixed
list. `:slug` is a table's slug (its name, unless `defineTable` sets `slug`).

| Method | Path | Gate | More |
|---|---|---|---|
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/query` | RLS | The listing, query parameters in the body — [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/count` | RLS | [Querying](/docs/backend/filtering/) |
| `POST` | `/api/data/:slug/count` | RLS | The count, query parameters in the body — [Queries too long for a URL](/docs/backend/vector-search/#queries-too-long-for-a-url) |
| `GET` | `/api/data/:slug/aggregate` | RLS | [REST API](/docs/backend/api/#rest-endpoints) |
| `POST` | `/api/data/:slug/refresh` | `view.roles` | Recompute a materialized view, on the views that are materialized — [Views](/docs/collections/views/#materialized-views) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PUT` | `/api/data/:slug/:id` | RLS | Deprecated alias of `PATCH` — same partial write, answers `Deprecation: true` |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk` | RLS | Insert many rows, optionally upserting — [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/bulk` | RLS | Update many rows by id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/:slug/bulk/delete` | RLS | Delete many rows by id — [REST API](/docs/backend/api/) |
| `POST` | `/api/data/_batch` | RLS | Write across tables in one transaction — [Writing over REST](/docs/backend/writes/#cross-table-batches) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Counting and aggregation are routes of their own, registered before `/:id` so
that `aggregate` is not read as an entity id. `?select=` and `?groupBy=` are
their parameters, and `select` is required on `/aggregate`.

Text search, vector search, relation inclusion and field selection *are* query
parameters on `GET /api/data/:slug` rather than routes — `searchString`,
`vector_search`, `include`, `fields`. See [REST API](/docs/backend/api/).

A project that declares no tables and introspects none serves this prefix
as a single `404 NO_TABLES`. See [Backend only](/docs/getting-started/headless/).

## Auth

| Method | Path | Gate | More |
|---|---|---|---|
| `GET` | `/api/auth/config` | none | What the login screen can offer: registration, password reset, magic link, email codes, guest sign-in, OAuth providers, and whether first-admin setup is pending |
| `POST` | `/api/auth/register` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/login` | none | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/refresh` | none (a refresh token) | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `POST` | `/api/auth/logout` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `PATCH` | `/api/auth/me` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `GET` | `/api/auth/sessions` | session | [Auth endpoints](/docs/backend/auth-endpoints/) |
| `DELETE` | `/api/auth/sessions` | session | Revokes every other session |
| `DELETE` | `/api/auth/sessions/:id` | session | Revokes one |
| `POST` | `/api/auth/forgot-password` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/reset-password` | none (a reset token) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-password` | session | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/change-email` | session | Mails a confirmation link to the new address — [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/confirm-email-change` | none (a link token) | Moves the account onto the new address — [Changing an email address](/docs/backend/auth-endpoints/#changing-an-email-address) |
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (a verification token) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/verify-email` | none (a verification token, and a session or the password to keep it) | [Email verification](/docs/backend/email-verification/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (a link token) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | One-time codes by email |
| `POST` | `/api/auth/otp/verify` | none (a code) | One-time codes by email |
| `POST` | `/api/auth/device` | none | <span class="since-badge" data-since="0.31">Since 0.31</span> [Device sign-in](/docs/backend/device-sign-in/). Off unless the backend turns it on |
| `POST` | `/api/auth/device/token` | none (a device code) | [Device sign-in](/docs/backend/device-sign-in/): the device's poll |
| `GET` | `/api/auth/device/:userCode` | session | [Device sign-in](/docs/backend/device-sign-in/): what the approval page shows |
| `POST` | `/api/auth/device/approve` | session (`aal2` with a second factor) | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/device/deny` | session | [Device sign-in](/docs/backend/device-sign-in/) |
| `POST` | `/api/auth/anonymous` | none | Guest sessions. Off unless `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (a guest) | Turns a guest into an account |
| `POST` | `/api/auth/find-user` | session | Off unless `AUTH_ALLOW_USER_LOOKUP` — it is an enumeration surface |
| `POST` | `/api/auth/:provider` | none | One per configured OAuth/OIDC provider |
| `POST` | `/api/auth/link/:provider` | session | Links a provider to the signed-in account |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/recovery-codes` | session (`aal2`) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (a login in progress) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (a challenge id) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/scopes` | session | Every scope this backend knows, and the ones the caller holds — [Roles and scopes](/docs/backend/roles-and-scopes/) |
| `GET` | `/api/auth/keys` | session (an account) | The caller's own [personal keys](/docs/backend/api-keys/#personal-keys) |
| `POST` | `/api/auth/keys` | session (an account) | The plaintext key is returned once. `403 PERSONAL_KEYS_DISABLED` unless the auth table sets `auth.personalKeys` |
| `DELETE` | `/api/auth/keys/:id` | session (an account) | Revokes one of the caller's own keys |
| `GET` | `/.well-known/jwks.json` | none | The public JWKS, when [asymmetric signing](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) is configured |

## Admin

Everything under `/api/admin` needs a scope from the admin plane, and each
surface names its own: `users:read` lists accounts, `cron:write` triggers a job.
An admin holds all of them, and so does the service key. A person holds the ones
their roles declare, and an API key the ones it was created with. A key scoped to
a table reaches none of this. See [Roles and scopes](/docs/backend/roles-and-scopes/).

| Method | Path | Gate | More |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, and only while no admin exists | Refused in production — see [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | `users:read` | User management |
| `POST` | `/api/admin/users` | `users:write` | User management. Roles beyond the caller's own are refused |
| `GET` | `/api/admin/users/pick` | `users:read`, or write access to a table with a `.userId()` column | The [user picker's read](/docs/backend/auth-endpoints/): id, name, email and avatar only. A table whose write rules are raw SQL does not count |
| `GET` | `/api/admin/users/:uid` | `users:read` | User management |
| `PUT` | `/api/admin/users/:uid` | `users:write` | Refused for an account that holds more than the caller |
| `DELETE` | `/api/admin/users/:uid` | `users:write` | Refused for an account that holds more than the caller |
| `POST` | `/api/admin/users/:uid/reset-password` | `users:write` | Issues a temporary password |
| `DELETE` | `/api/admin/users/:uid/mfa` | `users:write` | Removes the account's second factors and recovery codes, ends its sessions |
| `GET` | `/api/admin/guests` | `users:read` | Guests, last seen longest ago first. `?lastSeenBefore=` narrows them to what the delete below would take, and `total` counts them |
| `DELETE` | `/api/admin/guests` | `users:write` | Deletes one batch of the guests last seen before `?lastSeenBefore=`, which is required. Answers `{ deleted, skipped, remaining }`. Repeat while `remaining` is not 0, with `?offset=` set to how many have been skipped. Accounts cannot be reached |
| `DELETE` | `/api/admin/guests/:uid` | `users:write` | Deletes one guest. An account is refused with `NOT_ANONYMOUS` |
| `GET` | `/api/admin/roles` | `users:read` | `admin` and the roles the project declares, with their scopes |
| `GET` | `/api/admin/api-keys` | `keys:read` | [API keys](/docs/backend/api-keys/). Never an API key |
| `POST` | `/api/admin/api-keys` | `keys:write` | The plaintext key is returned once, on creation |
| `GET` | `/api/admin/api-keys/:id` | `keys:read` | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | `keys:write` | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | `cron:write` | Enable or disable a job |
| `GET` | `/api/admin/cron/:id/logs` | `cron:read` | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | `cron:write` | Run a job now. `?async=1` answers `202` once it has started — [Cron Jobs API](/docs/backend/cron-jobs-api/#example-trigger-a-job-manually) |
| `GET` | `/api/admin/backups` | `backups:read` | Backup inventory |
| `GET` | `/api/admin/backups/download` | `backups:read` | Streams one backup. With `?token=` from a download link, no header is needed, for that backup only |
| `POST` | `/api/admin/backups/download-url` | `backups:read` | A link to one backup, `{ key }` → `{ url, token, expiresIn }`, good for 60 seconds — [Backups](/docs/deployment/backups/#download-a-backup) |
| `POST` | `/api/admin/storage/orphans/scans` | `database:write` | Starts a scan for the stored files no row names, `?storageId=&olderThanHours=`, in the background. Answers `202` with the scan's record: `id`, `status` (`queued`), and `runner` (`worker` when it is a `storage.orphans` job on the job queue, `in-process` when the server runs it itself). Its record is written into the source, under the reserved `_rebase/maintenance/` |
| `GET` | `/api/admin/storage/orphans/scans/:id` | `database:read` | The scan's record, `?storageId=`. While it runs: `progress` (`filesScanned`, `rowsScanned`, `collectionsScanned` of `collectionsTotal`, `unscanned`). Once `completed`: `result`, the report the old `GET /orphans` answered. A run that stopped reporting for 10 minutes is answered as `failed`. `404 STORAGE_SCAN_NOT_FOUND` when the source holds no such scan |
| `DELETE` | `/api/admin/storage/orphans?scan=:id` | `database:write` | Deletes a completed scan's orphans in the background, `202`. Each one is checked against every row and history entry again, and asked for again right before it is deleted. The outcome is the scan record's `deletion`. `409` with `STORAGE_SCAN_NOT_COMPLETE`, `STORAGE_SCAN_INCOMPLETE`, `STORAGE_SCAN_EXPIRED` or `STORAGE_SCAN_DELETION_STARTED` |
| `GET` | `/api/admin/storage/orphans` | `database:read` | Deprecated: the scan inside the request, `?storageId=&olderThanHours=`. Answers with `Deprecation: true`. Use `POST /orphans/scans` |
| `DELETE` | `/api/admin/storage/orphans` | `database:write` | Deprecated, without `?scan=`: scans again and deletes inside the request. `409 STORAGE_SCAN_INCOMPLETE` when a table could not be read |
| `POST` | `/api/admin/storage/move` | `database:write` | Copies a folder to another source under the same keys, a page per call — what `rebase storage move` sends; `400 STORAGE_SAME_LOCATION` for `deleteSource` between two sources that store in the same place |
| `POST` | `/api/admin/storage/move/verify` | `database:write` | Lists the source again after a move, with the same body, a page per call: `{ checked, notMoved: [{ key, reason }], cursor? }` — every file still in the source with `deleteSource`, every file the target has no copy of without it. `rebase storage move` asks it when the move is done |
| `GET` | `/api/admin/logs` | `logs:read` | The recent log buffer |
| `GET` | `/api/admin/logs/latest` | `logs:read` | The most recent entries |
| `GET` | `/api/admin/logs/stream` | `logs:read` | Server-sent events |
| `GET` | `/api/admin/rls-audit` | `schema:read` | The scheduled audit's latest result |
| `GET` | `/api/admin/rls-simulator/options` | `schema:read` | Roles, users' rule roles and live service keys an administrator can simulate |
| `POST` | `/api/admin/rls-simulator/preview` | `schema:read` | Each table as `{ role?, userId?, apiKeyId? }` reaches it: visible rows against the caller's, hidden by scope or RLS, masked fields. Administrator's session only |
| `POST` | `/api/admin/sql/csv` | `database:write` | Streams one read-only query's whole result as CSV — [Studio](/docs/studio/)'s "Download full result as CSV" |
| `GET` | `/api/admin/branches/:name/diff` | `database:write` | What a [branch](/docs/backend/branching/#reviewing-and-merging-a-branch) changed: schema, policies and rows, `?sampleLimit=&schemas=&maxRowsPerTable=` |
| `POST` | `/api/admin/branches/:name/merge` | `database:write` | Writes the branch's rows to its parent, `{ expectedFingerprint, onConflict?, skipBlocked? }`; `409` when either side changed since the diff, or rows conflict |
| `GET` | `/api/admin/schema/status` | `schema:read` | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | `schema:read` | Plans a change; never applies one |
| `POST` | `/api/admin/schema/apply` | `schema:write` | A person only, unless `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `POST` | `/api/admin/schema/reconcile/plan` | `schema:read` | Plans relaxing `NOT NULL` and dropping the undeclared columns named in `drop`, for [schema reconcile](/docs/cli/schema/#rebase-schema-reconcile); never applies one |
| `POST` | `/api/admin/schema/reconcile/apply` | `schema:write` | Applies a reconcile plan, only if its `digest` is the `confirm` sent |
| `GET` | `/api/admin/schema-editor/status` | `schema:read` | Whether the editor is available, and the reason when it is not |
| `GET` | `/api/admin/schema-editor/tables` | `schema:read` | <span class="since-badge" data-since="0.31">Since 0.31</span> Every table `backend/schema/index.ts` exports as the editor reads it, with what is edited in code (read-only) and why — [Live schema editing](/docs/backend/live-schema-editing/#the-edits-tablepatch) |
| `POST` | `/api/admin/schema-editor/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Since 0.31</span> `{ patches: TablePatch[] }`: the files the edit would write, compiled; writes nothing |
| `POST` | `/api/admin/schema-editor/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Since 0.31</span> The same edit, written to `backend/schema`; the database is not touched |
| `GET` | `/api/admin/schema-editor/unmapped-tables` | `schema:read` | <span class="since-badge" data-since="0.31">Since 0.31</span> Tables the database has and `backend/schema` does not declare: `{ tables: [{ schema, table, rlsEnabled, policies, unimportable? }] }` |
| `GET` | `/api/admin/schema-editor/unmapped-tables/:schema/:table` | `schema:read` | <span class="since-badge" data-since="0.31">Since 0.31</span> One of them described: `{ table: { …, descriptor, rlsRaised?, notes } }`, for "Import an existing table". `404` when unknown or already declared, `400 SCHEMA_EDIT_REFUSED` without a primary key |
| `GET` | `/api/admin/schema-editor/frontend/calls` | `schema:read` | <span class="since-badge" data-since="0.31">Since 0.31</span> The `defineFirestoreCollection` calls in `frontend/src/cms` the editor can rewrite (development only) |
| `POST` | `/api/admin/schema-editor/frontend/preview` | `schema:write` | <span class="since-badge" data-since="0.31">Since 0.31</span> The files an edit of one of those calls would write; writes nothing |
| `POST` | `/api/admin/schema-editor/frontend/apply` | `schema:write` | <span class="since-badge" data-since="0.31">Since 0.31</span> The same edit, written in place. `409 SCHEMA_EDIT_STALE_FILE` when the file changed on disk |
| `GET` | `/api/admin/ui-config` | session | <span class="since-badge" data-since="0.31">Since 0.31</span> The workspace's UI preferences per table, the caller's own, and whether the caller may write the workspace's — see [Studio](/docs/studio/#collection-editor) |
| `PUT` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Since 0.31</span> Merge a `UiTablePreferences` delta into one table's workspace preferences (`replace` replaces). Written to `frontend/src/cms/ui-config.json` where the server may write the project's source, else to `rebase.ui_preferences` |
| `DELETE` | `/api/admin/ui-config/workspace/:slug` | `schema:write` | <span class="since-badge" data-since="0.31">Since 0.31</span> Remove one table's workspace preferences |
| `PUT` | `/api/admin/ui-config/user/:slug` | session (a person) | <span class="since-badge" data-since="0.31">Since 0.31</span> The caller's own preferences for one table. An API key has none: `403 UI_PREFERENCES_NEED_A_PERSON` |
| `DELETE` | `/api/admin/ui-config/user/:slug` | session (a person) | <span class="since-badge" data-since="0.31">Since 0.31</span> Remove the caller's own preferences for one table |
| `GET` | `/api/admin/dev/emails` | dev + `users:write` | Mail the development transport captured instead of sending |
| `DELETE` | `/api/admin/dev/emails` | dev + `users:write` | Empties the captured mailbox |

`/api/admin/cron`, `/api/admin/logs` and `/api/admin/schema-editor` are also
served at their pre-0.17 paths without the `/admin` segment. Those aliases are
for projects that have not moved; write new code against the canonical path.

## Schema

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Method | Path | Gate | More |
|---|---|---|---|
| `GET` | `/api/schema/tables` | session, or a credential with `schema:read` or a `data:*` scope | Every table this backend serves, as a JSON array of descriptors redacted for the caller |
| `GET` | `/api/schema/tables/:slug` | as above | One descriptor. `404 TABLE_NOT_FOUND` when this caller is not served that table |

The descriptors are what the CMS renders its defaults from, what the Studio
draws the schema visualizer and the RLS editor from, and what the MCP apps
render tables and forms from. They carry columns with their Postgres types,
nullability, validation and storage rules, relations by slug, and the
row-level security posture. Hook code never leaves the server: a descriptor
only says which hooks a table has.

What a caller is served depends on who it is:

| Caller | Tables | Redacted |
|---|---|---|
| An administrator, a `schema:read` holder, or the service key | every table, plain views included | `.private()` columns, for everyone |
| Any other signed-in person, guests included | only the tables a permissive rule reaches for their roles (plus the auth table, and materialized views whose `roles` they hold) | columns and relations their roles fail `access.read` for; `.private()` columns; only the rules that can apply to their roles; relations into tables they are not served; hook flags; raw SQL in rules, compiled policies, view queries and indexes |
| A credential (API key, MCP or platform token) | the tables its `data:*` scopes name, or all of them with `schema:read` | as above, judged on the scopes it carries |
| Nobody signed in | none — `401` — unless the backend sets `schemaTables: { public: true }` | then the tables with a public `select` rule, redacted as for the least-privileged caller: no column with an `access.read` list, no raw SQL, no policies |

A person keeps `metadata`, `softDelete`, `tenant`, `history` and `search` on
the tables they are served. `schemaTables: { persons: "all" }` in the backend
options describes every table and rule to every signed-in caller; the
default is `"granted"`. MCP connections are judged as a
credential, by the same serializer.

A credential holding neither `schema:read` nor a `data:*` scope gets
`403 SCOPE_MISSING`. A backend with no authentication configured answers
every request `404 SCHEMA_UNAVAILABLE`: there is no caller to redact for, and
`auth.requireAuth: false` does not change that.

Responses carry `ETag: W/"<schema version>-<view>"`, `Cache-Control: private,
no-cache` and the `x-rebase-schema` header; a request whose `If-None-Match`
names the current tag gets `304`. The tag changes when the schema does,
including after a live schema edit.

`schemaTables` is an option of `initializeRebaseBackend` with no environment
variable: a scaffolded project reaches it by ejecting.

## Storage

| Method | Path | Gate | More |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/metadata` | session + `storageAuthorize`, per key | [Storage](/docs/backend/storage/#storage-endpoints): metadata for up to 100 objects |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | The named storage sources this backend serves |
| `OPTIONS` | `/api/storage/tus` | none | Resumable uploads: the TUS versions and extensions this server supports |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Resumable uploads: creation |
| `GET` | `/api/storage/tus/:id` | the upload's owner | Resumable uploads: offset |
| `PATCH` | `/api/storage/tus/:id` | the upload's owner | Resumable uploads: append |
| `DELETE` | `/api/storage/tus/:id` | the upload's owner | Resumable uploads: cancel |

A deployment with no storage configured serves this prefix as a `501` naming the
variable it needs, rather than 404ing as if the feature did not exist —
except `GET /api/storage/sources`, which answers `200` with an empty list.

## Functions

| Method | Path | Gate | More |
|---|---|---|---|
| `GET` | `/api/functions` | session | The names of the functions served, and how many files failed to load |
| any | `/api/functions/<name>` | whatever the function declares. An API key also needs `functions:invoke` | [Custom Functions](/docs/backend/custom-functions/) |

One route per file under `backend/functions/`, so the paths come from your
project. `GET /api/functions` lists them only to a signed-in caller — a
session, an API key or the service key — and answers anyone else `401`: an
inventory of a deployment's custom endpoints is not public.

## Meta and operations

| Method | Path | Gate | More |
|---|---|---|---|
| `GET` | `/livez` | none | Liveness alone: is this process running. Does not touch the database, which is why it is the probe path a container should use — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness and readiness. Reports every configured data source, not only the default |
| `GET` | `/api/docs` | <span class="since-badge" data-since="0.31">Since 0.31</span> the schema endpoint's audience by default (401 anonymous unless `schemaTables.public`, 403 for a credential without a schema or data scope); none when `enableSwagger` is `true`; the admin gate when `false` | The OpenAPI 3.0 document of the tables `GET /api/schema/tables` describes to the caller (all of them with `enableSwagger: true`). `404 DOCS_UNAVAILABLE` when no authentication is configured |
| `GET` | `/api/swagger` | none | Swagger UI. Only when `enableSwagger` is `true`, and never in production |
| `GET` | `/api/meta/schema-version` | none | The schema hash this backend was built from and the runtime version, and nothing else |
| `GET` | `/api/meta/contract` | `schema:read` | `{ schemaVersion, runtime: { version, contract }, tables }` — every table as an administrator sees it, the input of `rebase generate-sdk --from`. `404` when no auth is configured |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` when set | Prometheus metrics, when `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` when set | The recorded series behind the Studio charts. `501` on a runtime with no backend |

WebSocket connections arrive as an HTTP upgrade on the same server rather than at
a path of their own — see [Realtime](/docs/backend/realtime/).

## MCP surface

Mounted only when `REBASE_MCP_ENABLED=true`, which also requires
`REBASE_PUBLIC_URL` — see
[Configuration](/docs/getting-started/configuration/#mcp-surface). Off by
default: no `REBASE_ROLE` turns this on, because it hands project access to
third-party software and that is a decision for a person to make.

The `.well-known` documents sit at the **origin**, not under `basePath`: RFC 8414
and RFC 9728 define those paths relative to the origin, and a client fetches them
before it holds any token.

| Method | Path | Gate | More |
|---|---|---|---|
| `GET` | `/.well-known/oauth-protected-resource` | none | RFC 9728 metadata naming this resource and its authorization server. Served at the path-suffixed form as well |
| `GET` | `/.well-known/oauth-authorization-server` | none | RFC 8414 metadata: the endpoints, grant types and PKCE methods this deployment supports |
| `POST` | `/mcp` | OAuth bearer, or an API key | The MCP protocol endpoint. Acts **as the signed-in user** (or as whoever the key acts as), so every read and write is subject to the same RLS. The `data:*` scopes decide which tools are offered |
| `GET` | `/mcp` | OAuth bearer, or an API key | Answers `405` with `Allow: POST, DELETE`: this server opens no server-initiated stream. The token is checked first, so a missing or stale one gets the `401` challenge instead |
| `DELETE` | `/mcp` | none | Answers `204`. The endpoint keeps no session, so there is nothing to end |
| `POST` | `/api/oauth/register` | rate-limited | RFC 7591 dynamic client registration. Refused when `REBASE_MCP_OPEN_REGISTRATION=false` |
| `GET` | `/api/oauth/authorize` | session | The consent screen a client is redirected to |
| `POST` | `/api/oauth/authorize/decision` | session | The person's answer to it — approve or deny |
| `POST` | `/api/oauth/token` | client credentials + PKCE | Exchanges an authorization code, or refreshes |
| `POST` | `/api/oauth/revoke` | client credentials | RFC 7009 token revocation |
| `GET` | `/api/oauth/grants` | session | Which clients this user has approved |
| `DELETE` | `/api/oauth/grants/:clientId` | session | Withdraws one, so a person can undo a consent without an admin |

The admin panel's own MCP endpoint is not part of this surface: it takes the
admin panel's session, never an OAuth token, and is mounted with the admin
routes whether or not `REBASE_MCP_ENABLED` is set, on a driver that scopes each
call to RLS.

| Method | Path | Gate | More |
|---|---|---|---|
| `POST` | `/api/admin/apps/mcp` | session, never anonymous | **Experimental.** The same tools as `/mcp`, for the person signed in, with `data:read`, `data:write` and `data:delete`, under their RLS. The admin panel's `savedAppsView` opens [saved apps](/docs/ai/remote-mcp/) through it |

## Related

- [REST API](/docs/backend/api/) — the data routes in full: filters, sorting, pagination, errors
- [Auth endpoints](/docs/backend/auth-endpoints/) — request and response shapes for the auth table above
- [Environment & Configuration](/docs/getting-started/configuration/) — the variables that decide which of these are mounted
