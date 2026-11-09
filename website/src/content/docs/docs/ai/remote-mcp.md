---
title: The Remote MCP Endpoint
sidebar_label: Remote MCP endpoint
description: Serve MCP from a deployed backend at /mcp, so the people who use your app can connect Claude or Cursor as themselves — OAuth with a consent screen, twelve tools under three scopes, every call under their own row-level security.
---

:::tip[Connecting Claude to your own projects?]
That is the [Rebase connector](/docs/ai/rebase-connector/): one connector for
all of them, and a self-hosted server joins it with `rebase cloud connect`. This
page is for the people who **use** your app.
:::

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
  existing `/auth/mfa/challenge` routes. When your app's own frontend
  keeps a session in the same browser, the screen offers that account, and
  Allow consents as it with no password; that is how someone who signs in only
  with Google, GitHub or an email link connects. Otherwise it signs in with a
  password, and someone with none sets one first with `/auth/forgot-password`
  (your app's "Forgot password"); the screen tells them so. It also names the host the authorization code is sent
  to, and says that host is not verified: anyone may register a client under
  any name, so the host is the part a person can check.
- **Twelve tools, three scopes.** The same [scopes](/docs/backend/roles-and-scopes/)
  every credential uses. `data:read` offers `list_collections`, `describe_collection`,
  `query_collection`, `count_documents`, `aggregate_documents`, `get_document` and the three views,
  `show_collection`, `show_record` and `show_app`; `data:write` adds `create_document` and
  `update_document`; `data:delete` adds `delete_document`. A client that asks for
  nothing gets `data:read`. Each one narrows to a collection: `data:read:posts`
  lists, describes and reads `posts` and nothing else. A scope decides which tools are
  offered and which collections they reach, not which rows: an empty list can be
  RLS working, and `data:write` still cannot write a row the person could not.
- **Three tools put your admin panel in front of the person.** In a client that
  renders MCP Apps, such as Claude, they open the admin panel's own views in the
  conversation, drawn from your collections: their fields, enums, validation,
  relations, form sections and view settings.
  - `show_collection` takes `query_collection`'s arguments, plus `view`
    (`table`, `list`, `cards` or `kanban`), and opens the collection view: the
    person can search, filter, sort and page, open a row's form, and add rows.
  - `show_record` opens one row's form (`id`), or a form for a new row that
    starts from the `values` the model filled in, for the person to check and
    save themselves.
  - `show_app` runs an app the model writes for the task at hand: one React
    component (`code`) and the `collections` it reads. It imports Rebase's
    own packages, so the same code works in your project:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      and `useRowWrites` over the project's rows;
    - `@rebasepro/cms`: the admin panel's `CollectionPanel` (with
      `CollectionToolbar` and its pieces, and `onRowClick`, which hands the
      app the clicked row as `useRows` reads it), `RecordForm` and `FormField`,
      `RecordDetail`, `FieldValue` and `useSidePanel`, each naming its
      collection by path, with your custom fields, views and actions;
    - `@rebasepro/ui`, the whole UI kit, `SplitView` and the KPI tiles and
      charts included.

    The server compiles it first, so a syntax error, a module the view does
    not serve, or a name it does not serve from `@rebasepro/cms` or
    `@rebasepro/app` is the call's error, with its line. An error while it
    runs is shown in its place and told to the model with the person's next
    message. An app may use only the collections it lists. Its styles are
    Tailwind's standard utilities, built with the view before any app
    arrives: an arbitrary value such as `h-[560px]` does nothing there, so an
    exact size is a `style`.

  Every read and save in the view is one of the read and write tools' calls,
  made as the person under their RLS, so a form offers only what their
  connection was granted: without `data:write` it is read-only, and a field
  their roles cannot read is not in it. That is the boundary an app's code
  works within too: it runs in the view, so every call it makes is one of
  those tools, as the person, and it can do nothing the model could not do
  with the same tools. On the hosted connector every write is also planned
  and confirmed by the server. Within that, `useRowWrites` asks the person
  before it writes, so an app does not write without their click; the
  admin's own controls (a form's Save, a delete, a table edit) behave as they
  do on a `show_collection` screen. The model is told what they changed. It reads the rows each tool answers, not the collection configs the
  view draws with. A client without MCP Apps, such as Claude Code or Cursor, shows nothing,
  and the model reads the same rows it would from `query_collection`.
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
  `{ count }`. `aggregate_documents` is `GET /api/data/<collection>/aggregate`:
  `select` is a list in REST's grammar (`["count()", "sum(total)"]`), `groupBy`
  a list of fields, and it answers `{ data }` with one row per group, plus
  `meta.hasMore` on a grouped call, whose groups page with `limit` and `offset`
  and sort with `orderBy`. On a collection an `afterRead` callback rewrites it
  serves `count()` alone, as REST does. As on REST, a `limit` above 1000, an undeclared argument and an
  edit or delete of a trashed row (404) are refused; setting the soft-delete
  field to `null` restores it. `deleted: "only"` (or `"include"`) on
  `query_collection`, `count_documents` and `aggregate_documents` reads the trash, as REST's
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
