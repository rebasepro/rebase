---
title: Endpoint index
sidebar_label: Endpoint index
description: Every HTTP route a Rebase backend mounts — data, auth, storage, admin, meta — with the gate on each one and the page that explains it.
---

Every route the server mounts, in one table, with what it takes to reach it.

The paths assume the default `basePath` of `/api`; `REBASE_BASE_PATH` moves all
of them together. `/health` and `/metrics` sit outside it on purpose, because an
orchestrator probes `/health`, not `/api/health`.

A gate — `tooling/scripts/docs-verify/check-endpoint-index.mjs` — compares this
table to the routes the source registers, so a new surface cannot be added
without appearing here.

## Gates

| Gate | Means |
|---|---|
| **none** | Unauthenticated. Anyone who can reach the host can call it |
| **session** | A signed-in caller: an access token, or an API key scoped to the operation |
| **admin** | An admin session, a service key, or an admin-scoped API key |
| **RLS** | Authenticated, and then the database decides row by row — see [Security Rules](/docs/collections/security-rules/) |
| **dev** | Mounted only outside production |

## Data

Generated per collection, so the paths carry your slugs rather than a fixed
list. `:slug` is a collection's `slug`.

| Method | Path | Gate | More |
|---|---|---|---|
| `GET` | `/api/data/collections` | session | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug` | RLS | [Querying](/docs/backend/api/#filtering) |
| `POST` | `/api/data/:slug` | RLS | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `PATCH` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `DELETE` | `/api/data/:slug/:id` | RLS | [REST API](/docs/backend/api/) |
| `GET` | `/api/data/:slug/:id/history` | RLS | [Entity History](/docs/backend/history/) |
| `POST` | `/api/data/:slug/:id/history/:historyId/revert` | RLS | [Entity History](/docs/backend/history/) |

Aggregation, text search, vector search, relation inclusion and field selection
are query parameters on `GET /api/data/:slug` rather than routes of their own —
`aggregate`, `search`, `vector_search`, `include`, `fields`. See
[REST API](/docs/backend/api/).

A project that declares no collections and introspects none serves this prefix
as a single `404 NO_COLLECTIONS`. See [Backend only](/docs/getting-started/headless/).

## Auth

| Method | Path | Gate | More |
|---|---|---|---|
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
| `POST` | `/api/auth/send-verification` | session | [Authentication](/docs/backend/authentication/) |
| `GET` | `/api/auth/verify-email` | none (a verification token) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link` | none | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/magic-link/verify` | none (a link token) | [Authentication](/docs/backend/authentication/) |
| `POST` | `/api/auth/otp` | none | One-time codes by email |
| `POST` | `/api/auth/otp/verify` | none (a code) | One-time codes by email |
| `POST` | `/api/auth/anonymous` | none | Guest sessions. Off unless `ALLOW_ANONYMOUS` |
| `POST` | `/api/auth/anonymous/link` | session (a guest) | Turns a guest into an account |
| `POST` | `/api/auth/find-user` | session | Off unless `AUTH_ALLOW_USER_LOOKUP` — it is an enumeration surface |
| `POST` | `/api/auth/:provider` | none | One per configured OAuth/OIDC provider |
| `POST` | `/api/auth/link/:provider` | session | Links a provider to the signed-in account |
| `POST` | `/api/auth/mfa/enroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/verify` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/api/auth/mfa/factors` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `DELETE` | `/api/auth/mfa/unenroll` | session | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge` | none (a login in progress) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `POST` | `/api/auth/mfa/challenge/verify` | none (a challenge id) | [MFA](/docs/backend/auth-endpoints/#multi-factor-authentication-totp) |
| `GET` | `/.well-known/jwks.json` | none | The public JWKS, when [asymmetric signing](/docs/backend/auth-endpoints/#asymmetric-tokens-and-jwks) is configured |

## Admin

Everything under `/api/admin` needs an admin session, a service key, or an
API key with admin scope. Not one privilege: a key scoped to a collection
reaches none of this.

| Method | Path | Gate | More |
|---|---|---|---|
| `POST` | `/api/admin/bootstrap` | none, and only while no admin exists | Refused in production — see [First User Bootstrap](/docs/backend/authentication/#first-user-bootstrap) |
| `GET` | `/api/admin/users` | admin | User management |
| `POST` | `/api/admin/users` | admin | User management |
| `GET` | `/api/admin/users/:uid` | admin | User management |
| `PUT` | `/api/admin/users/:uid` | admin | User management |
| `DELETE` | `/api/admin/users/:uid` | admin | User management |
| `POST` | `/api/admin/users/:uid/reset-password` | admin | Issues a temporary password |
| `GET` | `/api/admin/roles` | admin | The roles the project declares |
| `GET` | `/api/admin/api-keys` | admin | [API keys](/docs/backend/api-keys/) |
| `POST` | `/api/admin/api-keys` | admin | The plaintext key is returned once, on creation |
| `GET` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `PUT` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `DELETE` | `/api/admin/api-keys/:id` | admin | [API keys](/docs/backend/api-keys/) |
| `GET` | `/api/admin/cron` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `GET` | `/api/admin/cron/:id` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `PUT` | `/api/admin/cron/:id` | admin | Enable or disable a job |
| `GET` | `/api/admin/cron/:id/logs` | admin | [Cron Jobs](/docs/backend/cron-jobs/) |
| `POST` | `/api/admin/cron/:id/trigger` | admin | Run a job now |
| `GET` | `/api/admin/backups` | admin | Backup inventory |
| `GET` | `/api/admin/backups/download` | admin | Streams one backup |
| `GET` | `/api/admin/logs` | admin | The recent log buffer |
| `GET` | `/api/admin/logs/latest` | admin | The most recent entries |
| `GET` | `/api/admin/logs/stream` | admin | Server-sent events |
| `GET` | `/api/admin/rls-audit` | admin | The scheduled audit's latest result |
| `GET` | `/api/admin/schema/status` | admin | [Live schema editing](/docs/backend/live-schema-editing/) |
| `POST` | `/api/admin/schema/plan` | admin | Plans a change; never applies one |
| `POST` | `/api/admin/schema/apply` | admin | Off unless `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` |
| `GET` | `/api/admin/schema-editor/status` | admin | Whether the editor is available, and the reason when it is not |
| `POST` | `/api/admin/schema-editor/collection/save` | admin | [Studio](/docs/studio/) — rewrites collection source |
| `POST` | `/api/admin/schema-editor/collection/delete` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/save` | admin | [Studio](/docs/studio/) |
| `POST` | `/api/admin/schema-editor/property/delete` | admin | [Studio](/docs/studio/) |
| `GET` | `/api/admin/dev/emails` | dev | Mail the development transport captured instead of sending |

`/api/admin/cron`, `/api/admin/logs` and `/api/admin/schema-editor` are also
served at their pre-0.17 paths without the `/admin` segment. Those aliases are
for projects that have not moved; write new code against the canonical path.

## Storage

| Method | Path | Gate | More |
|---|---|---|---|
| `POST` | `/api/storage/upload` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `DELETE` | `/api/storage/file/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/metadata/*` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/list` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `POST` | `/api/storage/folder` | session + `storageAuthorize` | [Storage](/docs/backend/storage/) |
| `GET` | `/api/storage/sources` | session | The named storage sources this backend serves |
| `POST` | `/api/storage/tus` | session + `storageAuthorize` | Resumable uploads: creation |
| `GET` | `/api/storage/tus/:id` | the upload's owner | Resumable uploads: offset |
| `PATCH` | `/api/storage/tus/:id` | the upload's owner | Resumable uploads: append |
| `DELETE` | `/api/storage/tus/:id` | the upload's owner | Resumable uploads: cancel |

A deployment with no storage configured serves this prefix as a `501` naming the
variable it needs, rather than 404ing as if the feature did not exist.

## Functions

| Method | Path | Gate | More |
|---|---|---|---|
| any | `/api/functions/<name>` | whatever the function declares | [Custom Functions](/docs/backend/custom-functions/) |

One route per file under `backend/functions/`, so the paths come from your
project. `GET /api/functions` does **not** list them: an inventory of a
deployment's custom endpoints is not public.

## Meta and operations

| Method | Path | Gate | More |
|---|---|---|---|
| `GET` | `/livez` | none | Liveness alone: is this process running. Does not touch the database, which is why it is the probe path a container should use — `RUNTIME_LIVENESS_PATH` |
| `GET` | `/health`, `/api/health` | none | Liveness and readiness. Reports every configured data source, not only the default |
| `GET` | `/api/docs` | none (admin in production) | The OpenAPI 3.0 document |
| `GET` | `/api/swagger` | none | Swagger UI. Development only unless `REBASE_ENABLE_SWAGGER` |
| `GET` | `/api/meta/schema-version` | none | The schema hash this backend was built from, and nothing else |
| `GET` | `/api/meta/contract` | admin | The full collection contract, for `rebase generate-sdk --from`. `404` when no auth is configured |
| `GET` | `/metrics` | `REBASE_METRICS_TOKEN` when set | Prometheus metrics, when `REBASE_METRICS=true` |
| `GET` | `/metrics/history` | `REBASE_METRICS_TOKEN` when set | The recorded series behind the Studio charts. `501` on a runtime with no backend |

WebSocket connections arrive as an HTTP upgrade on the same server rather than at
a path of their own — see [Realtime](/docs/backend/realtime/).

## Related

- [REST API](/docs/backend/api/) — the data routes in full: filters, sorting, pagination, errors
- [Auth endpoints](/docs/backend/auth-endpoints/) — request and response shapes for the auth table above
- [Environment & Configuration](/docs/getting-started/configuration/) — the variables that decide which of these are mounted
