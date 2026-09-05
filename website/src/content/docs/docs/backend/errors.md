---
title: Error codes
sidebar_label: Error codes
description: Every error code a Rebase backend can return, with its HTTP status, what it means and what to do about it — plus the response envelope, X-Request-ID and the details rules.
---

Every failure a Rebase backend returns uses one envelope and carries a stable
`code`. The code is the thing to branch on: the message is written for a person
and may be reworded, the status is shared by a dozen different problems, and the
code is neither.

## The envelope

```json
{
  "error": {
    "message": "Schema drift: table \"posts\" does not exist.",
    "code": "SCHEMA_DRIFT",
    "details": { "dbCode": "42P01" },
    "requestId": "6f1b2f3e-8a0c-4d1b-9c3e-2a5b7c9d1e0f"
  }
}
```

- **`message`** — human-readable. For a `4xx` it is the server's own message; for
  a `5xx` it is deliberately generic, because the underlying text can quote a
  host, a role or a column name.
- **`code`** — one of the values below. Stable across minor versions.
- **`details`** — optional, and never guaranteed. See the rules below.
- **`requestId`** — present whenever the request passed through the request-ID
  middleware, which is every route under `basePath`.

### `X-Request-ID`

Every request under `basePath` gets an ID: the caller's `X-Request-ID` header
when it is a valid UUID v4, otherwise a fresh one. It is echoed back on the
response as `X-Request-ID`, included in the error envelope as `requestId`, and
attached to the server's log line for that request.

That is the join key. Quote it in a bug report and an operator can find the one
log line that explains the failure, carrying the reason the client was never
shown.

Sending your own is how a trace survives a hop: a gateway or a job runner that
forwards the header gets one ID across every service that handled the request.
An invalid value is ignored rather than rejected — a malformed header from a
caller is not worth failing a request over — so do not assume the ID you sent is
the ID you got. Read the response header.

### What is in `details`

`details` is diagnostic, not contractual. Three rules govern it:

1. **Anything a route sets explicitly is always returned.** These are the
   caller's own mistakes described precisely: which filter field was unknown,
   which relation is not writable, which value did not fit its type.
2. **Database diagnostics are trimmed in production.** When the failure came
   from Postgres, `details.dbCode` — the SQLSTATE — is always present: it names
   the class of problem and reveals nothing about the data. `dbMessage`,
   `detail` and `hint` are added only when `NODE_ENV` is not `production`,
   because Postgres puts row contents in them. `23505` reports
   `Key (email)=(a@b.c) already exists.`, which answers "is this person
   registered?" for any address anyone cares to try.
3. **Never branch on `details`.** Branch on `code`. What is under `details` is
   whatever was useful to a person at that call site, and it changes.

## Reading a status

| Status | What it says about the request |
| --- | --- |
| `400` | Malformed, or asking for something that does not exist in the schema. Fix the request. |
| `401` | Not authenticated, or the credential expired. Sign in or refresh. |
| `403` | Authenticated, and not allowed. Retrying as the same identity will not help. |
| `404` | No such route, collection or row — or a row that row-level security hides. |
| `409` | A conflict with existing state: a duplicate, or a concurrent write. |
| `413` `415` `422` | The body is too large, the wrong media type, or semantically rejected. |
| `429` | Rate limited. Back off; the message says for how long. |
| `500` | The server or its database is wrong, not the caller. Check the logs. |
| `501` | The route exists, and this deployment cannot serve it — a feature that is off or unconfigured. |
| `502` `503` `504` | A dependency was unreachable, unconfigured, or too slow. |

## Authentication and accounts

| Code | Status | Means | Do |
| --- | --- | --- | --- |
| `AAL2_REQUIRED` | 403 | The route needs a second factor and the session has only one. | Complete the MFA challenge, then retry. |
| `ALREADY_VERIFIED` | 400 | The address or factor is already verified. | Nothing — the desired state is already true. |
| `ANONYMOUS_AUTH_DISABLED` | 403 | Anonymous sign-in is off on this server. | Enable it, or sign in with a real identity. |
| `API_KEY_FORBIDDEN` | 403 | An API key was used on a route only people may call. | Use a user session. |
| `API_KEY_SELF_MANAGEMENT_FORBIDDEN` | 403 | An API key tried to create, list or revoke API keys. | Manage keys as a signed-in admin. |
| `AUTH_MIDDLEWARE_MISSING` | 500 | A guarded route ran with no Rebase auth middleware before it, so the caller's credential was never looked at. | Mount the app through the functions router rather than onto your own server directly. |
| `BOOTSTRAP_ANONYMOUS` | 403 | First-admin bootstrap was attempted by an anonymous caller. | Sign in first. |
| `BOOTSTRAP_COMPLETED` | 403 | The first admin already exists. | Have an existing admin grant the role. |
| `BOOTSTRAP_NOT_FIRST_USER` | 403 | Bootstrap is only for the very first user, and this is not it. | Have an existing admin grant the role. |
| `CAPTCHA_FAILED` | 400 | The provider rejected the CAPTCHA token. | Solve a fresh challenge. |
| `CAPTCHA_REQUIRED` | 400 | The route requires a CAPTCHA token and none was sent. | Include the token. |
| `CHALLENGE_EXHAUSTED` | 401 | Too many wrong codes against one MFA challenge. | Start a new challenge. |
| `EMAIL_EXISTS` | 409 | An account with that address already exists. | Sign in, or start a password reset. |
| `EMAIL_NOT_CONFIGURED` | 503 | Magic links or OTP were requested and the server has no mail transport. | Configure SMTP, or use another sign-in method. |
| `EMAIL_NOT_VERIFIED` | 403 | The account exists and its address is unverified. | Verify the address. |
| `FACTOR_NOT_VERIFIED` | 400 | The MFA factor was enrolled but never confirmed. | Confirm the factor. |
| `IDENTITY_ALREADY_LINKED` | 409 | That OAuth identity belongs to another account. | Sign in with it, or unlink it there first. |
| `INVALID_ACCOUNT` | 400 | The account is in a state this operation cannot act on. | See the message. |
| `INVALID_CHALLENGE` | 400 | The MFA challenge is unknown or expired. | Start a new one. |
| `INVALID_CODE` | 401 | The OTP or MFA code is wrong. | Retry with the current code. |
| `INVALID_CREDENTIALS` | 401 | Wrong email or password — deliberately not saying which. | Retry, or reset the password. |
| `INVALID_TOKEN` | 400 | A verification, reset or magic-link token is malformed or unknown. | Request a fresh link. |
| `LAST_ADMIN` | 403 | The change would leave the project with no admin. | Promote someone else first. |
| `NOT_ANONYMOUS` | 400 | An upgrade-from-anonymous route was called by a real account. | Nothing to upgrade. |
| `NO_SESSION` | 401 | No session cookie or refresh token was presented. Normal on a first page load. | Sign in. |
| `OAUTH_ERROR` | 401 | The OAuth provider refused, or returned an error. | Retry the flow; the message carries the provider's reason. |
| `RATE_LIMITED` | 429 | Too many attempts from this caller. | Back off; the message says for how long. |
| `REDIRECT_URI_NOT_ALLOWED` | 400 | The redirect target is not on the allow-list. | Add it to the provider configuration. |
| `REGISTRATION_DISABLED` | 403 | Self-service sign-up is off. | Have an admin create the account. |
| `ROLE_EXISTS` | 409 | That role name is taken. | Pick another name. |
| `ROLE_LOOKUP_FAILED` | 503 | Roles could not be read for an admin-gated request. Fails closed rather than trusting the token's own claim. | Retry; check the database. |
| `SELF_DELETE` | 400 | An admin tried to delete their own account. | Have another admin do it. |
| `SESSION_REVOKED` | 401 | The session was signed out elsewhere, or every session was revoked. | Sign in again. |
| `SETUP_REQUIRED` | 403 | The project has no admin yet, so this route is not available. | Complete first-admin setup. |
| `TOKEN_ALREADY_USED` | 401 | A one-time token was replayed. | Request a fresh one. |
| `TOKEN_EXPIRED` | 401 | The token is past its lifetime. | Request a fresh one. |
| `USER_NOT_FOUND` | 404 | No account with that id. | Check the id. |
| `WEAK_PASSWORD` | 400 | The password does not meet the configured policy. | Choose a stronger one. |

## Data, queries and writes

| Code | Status | Means | Do |
| --- | --- | --- | --- |
| `AGGREGATE_NOT_SUPPORTED` | 501 | This driver cannot compute the requested aggregate. | Use a driver that can, or compute it in the client. |
| `BULK_TOO_LARGE` | 400 | The bulk body exceeds the configured item limit. | Split the request. |
| `BULK_UNSUPPORTED` | 400 | This collection or driver does not support bulk writes. | Write the rows one at a time. |
| `DB_PERMISSION_DENIED` | 500 | Postgres refused the statement (`42501`): either a row-level-security policy denying this role, or a missing `GRANT`. | See [Troubleshooting](/docs/troubleshooting/). |
| `IDEMPOTENCY_KEY_IN_PROGRESS` | 409 | An earlier request with the same `Idempotency-Key` is still running. | Retry once it finishes. |
| `IDEMPOTENCY_KEY_REUSED` | 422 | The same `Idempotency-Key` arrived with a different body. | Use a new key, or send the original body. |
| `INVALID_BULK_BODY` | 400 | The bulk body is not the expected shape. | Send the documented `items` array. |
| `INVALID_FILTER_FIELD` | 400 | The filter names a property this collection does not have. | Check the spelling against the collection. |
| `INVALID_FILTER_OPERATOR` | 400 | The operator is not one this property type supports. | See [Querying data](/docs/sdk/querying/). |
| `INVALID_INPUT` | 400 | The body failed validation. | See the message. |
| `INVALID_LIMIT` | — | A realtime subscription asked for a limit outside the allowed range. Delivered as a WebSocket `ERROR` frame, not an HTTP response. | Lower the limit. |
| `INVALID_PARAM` | 400 | A query parameter is malformed. | See the message. |
| `NOT_FOUND` | 404 | No row with that id in that collection — or one that row-level security hides from this caller. | Check the id, then the collection's `securityRules`. |
| `NO_COLLECTIONS` | 404 | The project serves no collections: none declared in code, and no tables to derive them from. | Create tables — a migration, SQL, or a collection file plus `rebase db push` — and restart. |
| `ORDER_BY_FIELD_NOT_SORTABLE` | 400 | The sort names a property that is not sortable. | Sort on a column-backed property. |
| `PAYLOAD_TOO_LARGE` | 413 | The body exceeds the configured limit. | Send less, or raise the limit. |
| `RELATION_NOT_UNLINKABLE` | 400 | The relation cannot be unlinked from this side. | Write from the owning side. |
| `RELATION_NOT_WRITABLE` | 400 | The nested path is not a writable relation. | See [Relations](/docs/collections/relations/). |
| `RELATION_SOURCE_KEY_EMPTY` | 400 | A relation write had no source key to hang the link on. | Save the parent row first. |
| `SCHEMA_DRIFT` | 500 | A table or column the code expects does not exist in the database. | `rebase db push` in development; redeploy on a managed tenant. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | The `Content-Type` is not one this route accepts. | Send the type the route documents. |
| `VALIDATION_INVALID_VALUE` | 400 | A value does not fit its property type. | See the message; it names the property. |
| `WRITE_DENIED` | 403 | A security rule or row-level-security policy refused the write. | Check the collection's `securityRules`. |

## Storage

| Code | Status | Means | Do |
| --- | --- | --- | --- |
| `INVALID_STORAGE_BUCKET` | 400 | The bucket name is malformed. | Check the name. |
| `INVALID_STORAGE_KEY` | 400 | The object key is malformed, or escapes its prefix. | Check the key. |
| `INVALID_TRANSFORM_OPTIONS` | 400 | The image-transform parameters are out of range or contradictory. | See [Storage](/docs/backend/storage/). |
| `STORAGE_NOT_CONFIGURED` | 503 | No storage backend is configured on this server. | Configure S3, GCS, or local storage. |
| `STORAGE_SOURCE_NOT_CONFIGURED` | 501 | The storage source is declared but has no credentials here. | Set that source's environment variables. |
| `STORAGE_WRITE_FAILED` | 502 | The storage backend refused or dropped the write. | Check its own logs and credentials. |
| `TRANSFORM_OVERLOADED` | 503 | Too many image transforms are in flight. | Retry; consider a CDN in front. |
| `UNKNOWN_STORAGE_SOURCE` | 400 | The request named a storage source this project does not declare. | Declare it in `config/resources.ts`. |

## Custom functions

| Code | Status | Means | Do |
| --- | --- | --- | --- |
| `FUNCTION_TIMEOUT` | 504 | The handler exceeded its timeout. It is still running; it cannot be cancelled from here. | Give outbound calls an `AbortSignal`, or raise `REBASE_FUNCTIONS_TIMEOUT_MS`. |
| `FUNCTIONS_UPSTREAM_UNREACHABLE` | 502 | This process proxies functions to another one, which did not answer. | Check that the functions unit is running. |

## Admin surfaces and schema editing

These say a feature is off or unconfigured rather than that the request was
wrong. Each is also reported on the corresponding `/status` route with a `200`,
so a panel can grey the feature out instead of showing an error.

| Code | Status | Means | Do |
| --- | --- | --- | --- |
| `ADMIN_SURFACE_UNAVAILABLE` | 501 | An admin-only surface was called on a server with no authentication configured, so nothing can tell an admin from a stranger. | Set `auth.jwtSecret`, or pass an `AuthAdapter`. |
| `CONTRACT_UNAVAILABLE` | 404 | The project contract is served only when authentication is configured — it describes every table and relation. | Configure auth. `/meta/schema-version` is always served. |
| `DEV_MAILBOX_UNAVAILABLE` | 501 | No development mailbox is active. Mail is captured only when `SMTP_HOST` is unset and `NODE_ENV` is not production. | Unset `SMTP_HOST` in development, or read the real inbox. |
| `INVALID_CHANGE` | 400 | The proposed schema change is not well-formed. | See the message. |
| `SCHEMA_CHANGE_UNAPPLICABLE` | 400 | The change is valid and cannot be applied to the schema as it stands. | See the message. |
| `SCHEMA_EDITING_NO_COLLECTIONS_DIR` | 501 | Live schema editing needs `collectionsDir` or `liveSchema.repository`, and this server was started with neither. | Configure one. |
| `SCHEMA_EDITING_NO_REPOSITORY` | 503 | Planning works; there is no repository to commit the change to. | Configure `liveSchema.repository`. |
| `SCHEMA_EDITING_UNSUPPORTED` | 503 | This driver cannot plan schema changes. | Live editing is available on Postgres. |
| `SCHEMA_EDIT_DIRTY_TREE` | 409 | The repository has uncommitted changes, so the edit could not be applied safely. | Commit or stash, then retry. |
| `SCHEMA_EDIT_REQUIRES_A_PERSON` | 403 | An API key or other machine principal tried to apply a schema change. | Sign in as a user, or set `liveSchema.allowMachineApply`. |
| `SCHEMA_EDITOR_BAAS_MODE` | 501 | Collections are introspected from the database here, so there are no source files to edit. | Change the schema with a migration. |
| `SCHEMA_EDITOR_DISABLED` | 501 | The schema editor is turned off for this server. | Turn it on with `schemaEditor`. |
| `SCHEMA_EDITOR_MISSING_DEPENDENCY` | 501 | The schema editor needs `ts-morph`, which is not installed. | `pnpm add -D ts-morph@28.0.0`. |
| `SCHEMA_EDITOR_NO_COLLECTIONS_DIR` | 501 | The server has no `collectionsDir`, so the editor has nothing to write to. | Set `collectionsDir`. |
| `SCHEMA_EDITOR_PRODUCTION` | 501 | The editor is off under `NODE_ENV=production`: a deployed server's files are rebuilt from your repository on every deploy, so an edit here would be discarded. | Edit collections in development and deploy. |

## Generic codes

A route uses one of these when nothing more specific applies.

| Code | Status | Means | Do |
| --- | --- | --- | --- |
| `BAD_REQUEST` | 400 | Malformed, and nothing more specific applies. | See the message. |
| `UNAUTHORIZED` | 401 | Not authenticated, or the credential was rejected. | Sign in or refresh. |
| `FORBIDDEN` | 403 | Authenticated, and not allowed. | Retrying as the same identity will not help. |
| `CONFLICT` | 409 | A conflict with existing state. | See the message. |
| `INTERNAL_ERROR` | 500 | Something on the server failed. The message is generic on purpose. | Quote the `requestId`; the reason is in the logs. |
| `NOT_CONFIGURED` | 503 | A dependency this route needs is not configured on this server. | See the message. |
| `SERVICE_UNAVAILABLE` | 503 | A dependency was unreachable. | Retry; check the logs. |

## Keeping this page true

`pnpm verify:docs` fails when a code the server can raise is missing from these
tables, when a table lists a code nothing can raise, or when a stated status
disagrees with the source. The stage is
`tooling/scripts/docs-verify/check-error-codes.mjs`.
