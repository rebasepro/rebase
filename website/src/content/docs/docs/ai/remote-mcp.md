---
title: The Remote MCP Endpoint
sidebar_label: Remote MCP endpoint
description: Serve MCP from a deployed backend at /mcp, so the people who use your app can connect Claude or Cursor as themselves — OAuth with a consent screen, seventeen tools under three scopes, every call under their own row-level security.
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
- **Seventeen tools, three scopes.** <span class="since-badge" data-since="0.31">Since 0.31</span> The same [scopes](/docs/backend/roles-and-scopes/)
  every credential uses. `data:read` offers `list_tables`, `describe_table`,
  `query_table`, `count_rows`, `aggregate_rows`, `get_row`, the three views,
  `show_table`, `show_record` and `show_app`, `show_app_guide`, and the experimental
  `list_apps` and `open_app`; `data:write` adds `create_row`, `update_row` and the
  experimental `save_app` and `delete_app`; `data:delete` adds `delete_row`. A client that asks for
  nothing gets `data:read`. Each one narrows to a table: `data:read:posts`
  lists, describes and reads `posts` and nothing else. A scope decides which tools are
  offered and which tables they reach, not which rows: an empty list can be
  RLS working, and `data:write` still cannot write a row the person could not.
- **Three tools put your admin panel in front of the person.** In a client that
  renders MCP Apps, such as Claude, they open the admin panel's own views in the
  conversation, drawn from the table descriptors the backend serves to this
  person — columns, enums, validation, relations — and your project's own
  panel customizations, where the backend serves its MCP view.
  - `show_table` takes `query_table`'s arguments, plus `view`
    (`table`, `list`, `cards` or `kanban`), and opens the table's view: the
    person can search, filter, sort and page, open a row's form, and add rows.
  - `show_record` opens one row's form (`id`), or a form for a new row that
    starts from the `values` the model filled in, for the person to check and
    save themselves.
  - `show_app` runs an app the model writes for the task at hand: one React
    component (`code`) and the `tables` it reads. It imports Rebase's
    own packages, so the same code works in your project:
    - `@rebasepro/app`: `useRows`, `useRow`, `useRowCount`, `useAggregate`
      and `useRowWrites` over the project's rows;
    - `@rebasepro/cms`: the admin panel's `CollectionPanel` (with
      `CollectionToolbar` and its pieces, and `onRowClick`, which hands the
      app the clicked row as `useRows` reads it), `RecordForm` and `FormField`,
      `RecordDetail`, `FieldValue` and `useSidePanel`, each naming its
      table by path, with your custom fields, views and actions;
    - `@rebasepro/ui`, the whole UI kit, `SplitView` and the KPI tiles and
      charts included.

    The server compiles it first, so a syntax error, a module the view does
    not serve, or a name it does not serve from `@rebasepro/cms` or
    `@rebasepro/app` is the call's error, with its line. An error while it
    runs is shown in its place and told to the model with the person's next
    message. An app may use only the tables it lists. Its styles are
    Tailwind's standard utilities, built with the view before any app
    arrives: an arbitrary value such as `h-[560px]` does nothing there, so an
    exact size is a `style`.

    `show_app`'s description carries only the essentials, because a client
    may cut a long tool description short (claude.ai does at about 4,000
    characters). It tells the model to call `show_app_guide` first, which
    returns every hook, component and prop an app may use, with a worked
    example. `show_app_guide` is offered wherever `show_app` is.

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
  do on a `show_table` screen. The model is told what they changed. It reads the rows each tool answers, not the descriptors the
  view draws with. A client without MCP Apps, such as Claude Code or Cursor, shows nothing,
  and the model reads the same rows it would from `query_table`.
- **Experimental: apps saved to the project.** `save_app` keeps an app the
  model built with `show_app` so it opens again: it compiles the code as
  `show_app` does and stores it with its `title`, `tables` and
  `visibility`, which is `personal` (its owner, the default), `roles` (anyone
  holding one of its `roles`) or `team` (everyone who signs in). Saving for
  more than yourself takes the admin role, since a shared app is code an AI
  wrote, running for other people. Only its owner or an admin replaces
  (`id`) or deletes one, and a person keeps at most 200. `list_apps` lists
  the apps the caller may open, `open_app` opens one as `show_app` would, and
  `delete_app` removes one. Seeing an app is not reaching its data: an opened
  app reads and writes through the tools above, as whoever opens it, under
  their RLS. The apps live in `rebase.saved_apps`, which the backend creates
  the first time a tool uses it and grants to no end user.
  The admin panel opens the same apps: add `savedAppsView` from
  `@rebasepro/cms` to your `views`. It runs an app in an iframe sandboxed
  without `allow-same-origin` and with no network of its own, and relays its
  tool calls to `POST /api/admin/apps/mcp`, the same tools for the admin
  panel's session, which is mounted with the admin routes whether or not
  `REBASE_MCP_ENABLED` is set. The tools' names and shapes may still change.
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
  write — and read through `GET /api/data/<table>`'s path, so a row comes
  back as REST serves it (ISO dates, a `belongsTo` as its foreign key, e.g.
  `authorId`) and can be sent back in an update unchanged. `query_table`
  answers `{ data, meta }` with `meta.total` and `meta.hasMore`, and `count_rows`
  `{ count }`; `tools/list` gives both, `aggregate_rows` and `get_row`
  an `outputSchema`, loose where an answer varies. `aggregate_rows` is `GET /api/data/<table>/aggregate`:
  `select` is a list in REST's grammar (`["count()", "sum(total)"]`), `groupBy`
  a list of fields, and it answers `{ data }` with one row per group, plus
  `meta.hasMore` on a grouped call, whose groups page with `limit` and `offset`
  and sort with `orderBy`. On a table an `afterRead` hook rewrites it
  serves `count()` alone, as REST does. As on REST, a `limit` above 1000, an undeclared argument and an
  edit or delete of a trashed row (404) are refused; setting the soft-delete
  field to `null` restores it. `deleted: "only"` (or `"include"`) on
  `query_table`, `count_rows` and `aggregate_rows` reads the trash, as REST's
  `?deleted=` does, so a row `delete_row` trashed can be found again to
  restore. Its description tells the model the delete is permanent only where
  the table has no soft-delete field.
- **The listing names the tables; `describe_table` gives one's schema.**
  `list_tables` answers `{ tables: [{ name, description, kind? }] }` — no label:
  the backend has no presentation — and `describe_table { table }` that table's
  OpenAPI `row` (the columns this caller is served) and `create` (the writable
  ones) schemas, its served `relations` and `rls` (raw SQL redacted without
  `schema:read`), plus `softDeleteField` where rows go to a trash. What a
  connection may learn about the schema is decided by the same serializer
  `GET /api/schema/tables` uses. The tool descriptions tell the model to
  describe a table before writing to it. A 200-table project's listing is
  about 5k tokens, and each description
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
