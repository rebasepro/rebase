---
title: The Remote MCP Endpoint
sidebar_label: Remote MCP endpoint
description: Serve MCP from a deployed backend at /mcp, so the people who use your app can connect Claude or Cursor as themselves — OAuth with a consent screen, eight tools under three scopes, every call under their own row-level security.
---

The [MCP server](/docs/ai/mcp/) is a developer tool: it runs on your machine and holds a service
key or an API key. A deployed backend can also serve MCP itself, at `/mcp`, for
the people who use your application. An assistant one of them connects reads and
writes the project **as that person**, and every call runs under their own
row-level security.

It is off unless you turn it on, and both variables are required:

```bash
REBASE_MCP_ENABLED=true
REBASE_PUBLIC_URL=https://app.example.com   # this deployment's real origin
```

Without `REBASE_PUBLIC_URL`, a JWT secret, or a data driver that can scope a query
to one user, the endpoint declines to mount and says why in the boot log. No
`REBASE_ROLE` turns it on.

- **OAuth, with a consent screen.** A client finds the authorization server
  through `/.well-known/oauth-protected-resource`, registers itself (dynamic
  registration is on by default; `REBASE_MCP_OPEN_REGISTRATION=false` limits it
  to clients you register), and sends the person to a consent screen that signs
  them in through your existing `/auth/login`. An account with a second factor
  is then asked for its authenticator code or a recovery code, through the
  existing `/auth/mfa/challenge` routes. The screen signs in with a password
  only: someone who has only ever used Google, GitHub or an email link sets one
  first with `/auth/forgot-password` (your app's "Forgot password"), and the
  screen tells them so. It also names the host the authorization code is sent
  to, and says that host is not verified: anyone may register a client under
  any name, so the host is the part a person can check.
- **Eight tools, three scopes.** The same [scopes](/docs/backend/roles-and-scopes/)
  every credential uses. `data:read` offers `list_collections`, `describe_collection`,
  `query_collection`, `count_documents` and `get_document`; `data:write` adds `create_document` and
  `update_document`; `data:delete` adds `delete_document`. A client that asks for
  nothing gets `data:read`. Each one narrows to a collection: `data:read:posts`
  lists, describes and reads `posts` and nothing else. A scope decides which tools are
  offered and which collections they reach, not which rows: an empty list can be
  RLS working, and `data:write` still cannot write a row the person could not.
- **Grants made before 0.24 keep their reach.** `mcp:read` is read as
  `data:read`, and `mcp:write` as `data:write data:delete`, on stored grants and
  on tokens already issued.
- **An API key works too.** `/mcp` also accepts `Authorization: Bearer rk_…`, for
  a client configured with a header rather than an OAuth flow. The key reaches
  the tools its `data:*` scopes cover, as whoever it acts as: a
  [personal key](/docs/backend/api-keys/#personal-keys) as its owner, a service key
  as `api-key:<id>`.
- **The SDK's vocabulary, REST's answers.** The tools take what the SDK takes —
  `where` (`{"status": ["==", "paid"]}`), `orderBy` (`["created_at", "desc"]` or
  `"created_at:desc"`), `limit`, `offset`, `searchString`, and `data` for a
  write — and read through `GET /api/data/<collection>`'s path, so a row comes
  back as REST serves it (ISO dates, a `belongsTo` as its foreign key, e.g.
  `authorId`) and can be sent back in an update unchanged. `query_collection`
  answers `{ data, meta }` with `meta.total` and `meta.hasMore`, and `count_documents`
  `{ count }`. As on REST, a `limit` above 1000, an undeclared argument and an
  edit or delete of a trashed row (404) are refused; setting the soft-delete
  field to `null` restores it. `deleted: "only"` (or `"include"`) on
  `query_collection` and `count_documents` reads the trash, as REST's
  `?deleted=` does, so a row `delete_document` trashed can be found again to
  restore. Its description tells the model the delete is permanent only where
  the collection has no soft-delete field.
- **The listing names the collections; `describe_collection` gives one's schema.**
  `list_collections` answers each collection's `name`, `title` and `description`,
  and `describe_collection { collection }` that collection's OpenAPI `row` and
  `create` schemas, plus `softDeleteField` where rows go to a trash. The tool
  descriptions tell the model to describe a collection before writing to it. A
  200-collection project's listing is about 5k tokens, and each description
  under 1k; with every schema in the listing it was about 150k.
- **A token for this endpoint only.** An MCP access token is refused by
  `/api/data`, `/api/admin` and the WebSocket, so connecting an assistant does not
  hand it a session.

Every request to `/mcp` re-reads the person's account. A deleted or disabled
account, or a "sign out everywhere" or password change after the token was
issued, stops a connected client at once with a 401. A demotion applies to its
next tool call. Every refresh makes the same checks and refuses such a grant
for good. A guest session cannot consent at all.

One limit. Disconnecting a client (`DELETE /api/oauth/grants/:clientId`, with the
person's own session) revokes its refresh tokens at once, but an access token
already issued keeps working until it expires, within the hour.

The routes are in [Endpoints](/docs/backend/endpoints/#mcp-surface) and the
variables in [Configuration](/docs/getting-started/configuration/#mcp-surface).
