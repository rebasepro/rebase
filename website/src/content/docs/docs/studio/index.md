---
title: Studio Tools
sidebar_label: Studio
description: Rebase Studio provides developer tools for visual schema editing, SQL queries, JavaScript scripting, RLS policy management, and storage browsing.
---

## Overview

Studio is the developer half of the admin panel. The same application your
content team uses to edit rows also carries a schema editor, a SQL console, a
JavaScript scratchpad, an RLS policy browser and a storage browser — and Studio
is the mode that unlocks them. Nothing to install and nothing to deploy: it is
already in the panel, behind the toggle in the drawer.

![The collection editor, the flagship Studio tool: a visual schema editor that writes your TypeScript back](/img/collection_editor.png)

It exists because the alternative is a second set of credentials. Editing a
table, checking what a policy really allows, or running one query against
production otherwise means a database client, a copy of the connection string
and an audit trail that ends at "someone with psql". Studio does all of it as
the signed-in admin, through the same authorization the API uses.

## The two modes

The panel has two modes — `"cms" | "studio"`:

- **CMS** (`"cms"`) — For content editors and operations teams. Shows the tables and data management. This is the default.
- **Studio** (`"studio"`) — For developers. Unlocks the tools below.

Toggle between them with the admin mode controller or the drawer toggle. The
chosen mode is persisted in `localStorage` under `rebase-admin-mode`; a browser
that used the panel before 0.17.0 holds the old `"content"` value and is
migrated to `"cms"` on read.

## Built-in Studio Tools

### Collection Editor

<span class="since-badge" data-since="0.31">Since 0.31</span>

A visual editor for a table and how the panel shows it. A save is split in two:

- **Schema facts** — a column's type, nullability, default, validation, enum
  values, storage, relations, rules, description, history — become `TablePatch`
  edits that the server's schema editor writes into `backend/schema/<table>.ts`
  with [ts-morph](https://ts-morph.com/), changing only the code an edit names
  and leaving the rest of the file as it was: imports, comments, formatting,
  hooks, shared columns. An edit that reaches into code — a column built by a
  helper, rules held in a variable — is refused with the place to make it. A
  rule left untouched is sent back exactly as served, so its policy name never
  changes. See [Live schema editing](/docs/backend/live-schema-editing/#the-edits-tablepatch).
- **Presentation** — labels, icon, view modes, column order, hidden columns,
  widths, enum labels and colours, kanban, query defaults — is a UI preference,
  never a schema edit. An admin's are the workspace's: where the server may
  write the project's source they go to `frontend/src/cms/ui-config.json`, and
  on a deployment to the `rebase.ui_preferences` table, through
  `/api/admin/ui-config`. A user's own resizes and view switches are theirs.

A slug, SQL table or database change is refused as a migration. A table whose
rules come from `defaultRls` asks before taking rules of its own. A caller
served redacted rules gets a read-only editor, and a Firestore collection is
read-only here: it is defined in the frontend. It is the screenshot at the top
of this page.

The editor is on wherever Studio is mounted — a scaffold's `<RebaseStudio/>` is
enough, and there is no prop to add. `collectionEditor` tunes it rather than
turning it on:

```tsx
import { RebaseCMS } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";

// Studio is mounted, so the Collection Editor is available. Nothing else
// is needed for it.
<Rebase>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
    <RebaseStudio/>
</Rebase>

// `collectionEditor` is for fine-tuning — a read-only editor, a different
// token — not for opting in.
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

Whether a *save* lands is the server's decision, not the panel's: the editor
rewrites `backend/schema`, so it is off under `NODE_ENV=production` (unless
[live schema editing](/docs/backend/live-schema-editing/) names a repository),
in `baas` mode, and on a server with no `schemaDir`. The panel asks
`GET /api/admin/schema-editor/status` and shows the reason it gets back beside the
disabled button.

### Built-in tools

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every tool that knows the schema reads the tables the server serves, from
`GET /api/schema/tables`, with or without the CMS on the page — so Studio works
as the console of a backend with no admin panel. Against a runtime older than
0.31, which has no such route, the schema-aware tools say the runtime needs
upgrading rather than guessing; against a backend with no authentication, or
when the request fails, each says which. The SQL console, logs, storage and
the other tools that do not read the schema work regardless.

These ship with Studio and are **lazy-loaded by `RebaseStudio`** — each is a separate
chunk, fetched the first time you open it. They are not importable on their own:
`@rebasepro/studio` deliberately exports only the orchestrator, so a console you never
open costs nothing.

| Tab | Slug | Group | What it does |
|-----|------|-------|--------------|
| SQL Console | `sql` | Database | Run raw SQL against your PostgreSQL database and read results in a table. The table shows the last statement's result, up to its first 10,000 rows or 32 MB of values; a longer result says how many rows there were, and copy and export include only the rows shown. Such a result also offers **Download full result as CSV**: the server streams the whole of it through a read-only cursor (`POST /api/admin/sql/csv`), one query at a time, on a Postgres server of your own rather than the in-process development database. Values are the database's text, as psql shows them, and **Export JSON** writes them so; **Export typed JSON** writes each value read by its column's type — integers and numerics a JSON number holds exactly, booleans, `json`/`jsonb` as JSON — and keeps every other value as text. In every CSV (export, copy and the full download), a value a spreadsheet would run as a formula (one starting with `=`, `+`, `-`, `@`, a tab or a carriage return, other than a signed number) is written with a leading `'`, as the collection export writes it. While a run is in flight, **Cancel run** gives the console back at once; a server that takes the socket's `CANCEL_SQL` frame (it lists `cancel_sql` in the `hello` it answers the socket with) also stops the statement with `pg_cancel_backend`. The in-process development database cannot be interrupted, and an older server is left to finish the statement within its `statement_timeout` |
| RLS Policies | `rls` | Database | Inspect and manage Row Level Security policies for your tables. The declared side is what the server compiled from each table's `rls` (served to callers holding `schema:read`), compared with `pg_policies` the way `rebase doctor` judges drift: a policy is listed as the database holds it, badged **Differs from code** where that is not what the project declares, and a declared rule the database lacks is listed as unapplied. A policy Rebase generates cannot be edited straight in the database, and on a table Rebase manages a banner says that each server start and `rebase db push` re-apply the declared policies. A caller without `schema:read` sees what the database holds and is told why the declaration is not shown |
| Schema Visualizer | `schema-visualizer` | Database | Entity diagram of your tables and their relations, drawn from the served descriptors: SQL names, Postgres types, nullability, keys, enum values, foreign keys and junctions are as the tables declare them. Only the RLS markers are read from the database. The layout runs in a web worker, so the page stays responsive while a large diagram is arranged. A schema of more than 300 tables is drawn one table's neighbourhood at a time — the tables one or two relations away — starting from the most connected table; pick another table in the list to move |
| Branches | `branches` | Database | Create and manage [database branches](/docs/backend/branching), and review one like a pull request: its schema and RLS policy changes side by side, the rows it inserted, updated and deleted, and a merge into the database it was made from that says what wins first — see [Reviewing and merging a branch](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Database | Browse and download database backups |
| Logs Explorer | `logs` | Database | Live request log, plus everything the server reports at warn or error — see below |
| JS Console | `js` | Compute | Write and execute JavaScript through the Rebase SDK. A script receives `context.tables`, the served descriptors (it was `context.collections`), and reaches a table as `client.data.<slug>` or `client.data.table("<slug>")` |
| Cron Jobs | `cron` | Compute | Inspect and manage [scheduled tasks](/docs/backend/cron-jobs) |
| Storage | `storage` | Storage | Browse, upload and manage files across your storage backends |
| API Explorer | `api` | API | Interactive API documentation, with a request runner |
| API Keys | `api-keys` | Access Control | Create and manage scoped service API keys; a `data:*` scope's targets are the served tables |

### What the Logs Explorer shows

Two streams into one in-memory ring, held on the server process:

- **Every request** — method, path, status, duration, the `X-Request-ID`, the
  table when the request was about one, and, when the request failed, the
  error `code` and message the client received. A failed request is recorded at
  `warn` (4xx) or `error` (5xx), so the level filter finds it.
  Its `source` comes from the path: `/api/auth/*` and `/api/oauth/*` are
  `auth`, `/api/storage/*` is `storage`, and everything else is `api`, so the
  Source filter finds sign-ins under Auth and uploads under Storage.
- **Everything the server reports at warn or error** — a schema warning, an
  auth refusal, a driver diagnosis, a boot failure. `source` comes from the
  message's own prefix (`[API]`, `[Auth]`, `[storage]`, `[realtime]`), and
  anything unrecognised is `system`.

Routine `info` chatter is deliberately left out. The ring holds 10,000 entries
and a wall of `200`s evicts what you opened the panel to find.

A custom function that throws therefore shows its own message here, against the
request that called it — the case this exists for.

The ring is per process and per boot: it is not durable, it is not shared
between replicas, and a restart empties it. For anything you need to keep, read
the process's stdout, which carries the same lines and more.

The explorer says so. It shows the log of the one server instance serving
it and names that instance: the `snapshot` event of
`GET /api/admin/logs/stream` carries `instance`, the process's `HOSTNAME` (the
pod name on Kubernetes, the container id under Docker) or else `pid-<n>`. There
is no view across replicas, nor of the `functions` and `worker` processes of a
[split deployment](/docs/deployment/split-processes/). A reconnect that lands on
another instance replaces the window instead of mixing the two logs.

The **Collection Editor** is a Studio tool too, but it is not in this list because
it is registered differently: `RebaseStudio` does not lazy-load it. The panel mounts
it wherever Studio and the CMS are registered, because unlike the tools above it
edits the presentation the CMS draws as well as the schema. That is a difference in how it
is mounted, not in what it is — it edits schema, and it belongs beside the SQL and
RLS editors.

## Turning Studio on

One component, anywhere inside `<Rebase>`. It renders nothing — it registers
the tools, and `<RebaseShell>` draws them:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

The tools appear in the drawer while Studio mode is active. Leave
`<RebaseStudio>` out entirely and you ship a content-only CMS: no Studio mode,
no toggle, nothing lazy-loaded.

## Adding your own tool

`devViews` puts your own views beside the built-in ones. They are ordinary
[`AppView`](/docs/frontend#custom-views)s — the only thing that makes one a
Studio tool rather than a CMS view is which component it is registered on:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const queues: AppView = {
    slug: "queues",
    name: "Queues",
    group: "Compute",
    icon: "ListOrdered",
    description: "Depth and failures, per queue",
    view: <QueuesView/>
};

<RebaseStudio devViews={[queues]}/>
```

| Registered on | Shows up in | For |
|---|---|---|
| `<RebaseCMS views>` | content mode | things the people editing content use |
| `<RebaseStudio devViews>` | Studio mode | things you use to run the backend |

A view goes in exactly one of them — the drawer sorts by which one registered
it, so listing a slug in both hides it from content mode.

Like `tools`, the list is read by its *contents*: writing it inline is safe, and
a re-render of the host does not remount whichever tool is on screen. Renaming a
view or changing its group does re-register it.

### Choosing which tools appear

Omit `tools` and every tool above is registered. Pass it to register a subset —
a hosted console that has its own storage browser, say, can leave that one out:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

The Collection Editor's Studio view is the `"schema"` tool. Omit `tools` and it
is there; pass a list without `"schema"`, as above, and it is left out.

The list is read by *contents*, not identity, so writing it inline is safe: a
re-render of the host does not tear down and remount whichever tool is on screen.

## Next Steps

- **[Plugins](/docs/plugins)** — Extend the framework with plugins
- **[Tables](/docs/schema/)** — Declaring the tables Studio reads
- **[Customizing a table](/docs/frontend/customize-table/)** — How the panel shows them
