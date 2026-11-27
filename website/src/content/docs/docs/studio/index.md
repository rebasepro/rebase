---
title: Studio Tools
sidebar_label: Studio
description: Rebase Studio provides developer tools for SQL queries, JavaScript scripting, RLS policy management, a schema diagram, and storage browsing.
---

## Overview

Studio is the developer half of the admin panel. The same application your
content team uses to edit rows also carries a SQL console, a JavaScript
scratchpad, an RLS policy editor, a schema diagram and a storage browser — and
Studio is the mode that unlocks them. Nothing to install and nothing to deploy:
it is already in the panel, behind the toggle in the drawer.

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

A table's schema is code: `defineTable` in `backend/schema`, or — for a
project that declares none — whatever the database holds, changed with SQL or a
migration. Studio has no visual table editor; the Collections tool that was one
was removed, because a table's columns and its panel presentation had
been decoupled and one form editing both no longer matched either. The RLS
editor still saves policies into `backend/schema` in development, through the
same plan → confirm → apply step as
[live schema editing](/docs/backend/live-schema-editing/).

### Built-in tools

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
| Tables | `tables` | Database | Every table and view of the schema. For the one selected: **Data** reads its rows as the database owner through `/api/admin/db` (unserved tables and views included) with server-side paging, sorting and filters, foreign-key cells that open the row they point at, a value viewer, inline and bulk edits and CSV import and export, and **Read as** an API user shows the rows that user's row level security returns; **Structure** edits columns (name, type, nullability, default), indexes (with size and scans), constraints (foreign key, unique, check) and triggers; **Policies** is the Policies tool's editor for that table, with its privileges; **Relations** lists foreign keys both ways and draws the table's neighbourhood; **Stats** shows sizes, the row estimate, scans, dead rows and the last vacuum and analyze, with **Analyze** and **Vacuum**; **Settings** holds the table's metadata (`rebase.table_meta`), rename and drop. **View SQL** shows the table's definition as one script. A switch above the list draws the whole schema as a **Diagram**. Every schema change shows the SQL it will run first. On the auth table, each row also resets the account's password or two-step verification and switches the account off or on, as the users collection does in the admin panel. The selection lives in the URL (`?table=schema.name&tableTab=…`), so other views link straight to a table |
| SQL editor | `sql` | Database | Run raw SQL against your PostgreSQL database and read results in a table. Each statement of a run gets its own result tab, labelled with its command and row count, and the statements share one budget of 10,000 rows or 32 MB of values; a longer result says how many rows there were, and copy and export include only the rows shown. Such a result also offers **Download full result as CSV**: the server streams the whole of it through a read-only cursor (`POST /api/admin/sql/csv`), one query at a time, on a Postgres server of your own rather than the in-process development database. Values are the database's text, as psql shows them, and **Export JSON** writes them so; **Export typed JSON** writes each value read by its column's type — integers and numerics a JSON number holds exactly, booleans, `json`/`jsonb` as JSON — and keeps every other value as text. In every CSV (export, copy and the full download), a value a spreadsheet would run as a formula (one starting with `=`, `+`, `-`, `@`, a tab or a carriage return, other than a signed number) is written with a leading `'`, as the collection export writes it. While a run is in flight, **Cancel run** gives the console back at once; a server that takes the socket's `CANCEL_SQL` frame (it lists `cancel_sql` in the `hello` it answers the socket with) also stops the statement with `pg_cancel_backend`. The in-process development database cannot be interrupted, and an older server is left to finish the statement within its `statement_timeout`. **Explain analyze** runs one statement inside a transaction it rolls back and shows each step's actual time, rows, loops and buffers. A `:name` placeholder gets a field above the editor. Snippets are saved in the project, shared or personal, and a result can be drawn as a bar or line chart. |
| Policies | `rls` | Database | Inspect and manage Row Level Security policies for your tables. The declared side is what the server compiled from each table's `rls` (served to callers holding `schema:read`), compared with `pg_policies` the way `rebase doctor` judges drift: a policy is listed as the database holds it, badged **Differs from code** where that is not what the project declares, and a declared rule the database lacks is listed as unapplied. A policy Rebase generates cannot be edited straight in the database, and on a table Rebase manages a banner says that each server start and `rebase db push` re-apply the declared policies. A caller without `schema:read` sees what the database holds and is told why the declaration is not shown |
| Schema | `schema-visualizer` | Database | Entity diagram of your tables and their relations: the served descriptors (SQL names, Postgres types, keys, enum values, foreign keys, junctions) and, on a backend that serves `/api/admin/db`, the database's catalog — tables the server does not serve, drawn as not served, and foreign keys the code does not declare. Where the Tables tool is registered the diagram is its **Diagram** mode, and this tool stays out of the navigation while its route keeps working. The layout runs in a web worker, so the page stays responsive while a large diagram is arranged. A schema of more than 300 tables is drawn one table's neighbourhood at a time — the tables one or two relations away — starting from the most connected table |
| Branches | `branches` | Database | Create and manage [database branches](/docs/backend/branching), and review one like a pull request: its schema and RLS policy changes side by side, the rows it inserted, updated and deleted, and a merge into the database it was made from that says what wins first — see [Reviewing and merging a branch](/docs/backend/branching/#reviewing-and-merging-a-branch) |
| Backups | `backups` | Database | Browse and download database backups |
| Database | `database` | Database | The database as a whole. **Advisors** lists security findings from [`rls-check`](/docs/rls-check) and performance findings — unused and duplicate indexes, foreign keys without an index, tables without a primary key, large tables read by full scans, tables heavy with dead rows, and searches that read a whole large table — each with the SQL that fixes it, to open in the SQL editor. **Query performance** shows the top statements from `pg_stat_statements` by total time, mean time or calls, and installs the extension where the server ships it. **Activity** lists this database's sessions that are doing something, refreshed every five seconds while open, with what each waits on and which session blocks it; a query can be cancelled and a session terminated. **Functions**, **Triggers**, **Types** and **Extensions** list those objects, drop a function, add a value to an enum, and install or drop an extension, each previewing its SQL first. When the backend serves more than one database (the default and each declared with `database("…")`), a picker in the header chooses which one every section reads and changes. The in-process development database collects no query statistics and has no other sessions |
| JS console | `js` | Compute | Write and execute JavaScript through the Rebase SDK. A script receives `context.tables`, the served descriptors (it was `context.collections`), and reaches a table as `client.data.<slug>` or `client.data.table("<slug>")` |
| Scheduled jobs | `cron` | Compute | Inspect and manage [scheduled tasks](/docs/backend/cron-jobs), including zero-code SQL and HTTP cron jobs |
| Storage | `storage` | Storage | Browse, upload and manage files across your storage backends, and configure declarative storage access policies |
| API | `api` | API | Interactive API documentation, with a request runner |
| Webhooks | `webhooks` | API | Configure and test database webhooks triggered on row inserts, updates, and deletes |
| Logs | `logs` | API | Live request log, plus everything the server reports at warn or error — see below |
| Roles | `roles` | Access Control | The roles users hold and the scopes each grants: the ones declared in code, read-only, and the ones made at runtime, which it creates, edits and deletes. Which user holds which role is edited in the users collection. `users`, its old name from when it also listed the accounts, still works |
| API keys | `api-keys` | Access Control | Create and manage scoped service API keys; a `data:*` scope's targets are the served tables |

### What the Logs view shows

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

`"schema"`, the Collections tool, is no longer accepted: the tool was removed.

The list is read by *contents*, not identity, so writing it inline is safe: a
re-render of the host does not tear down and remount whichever tool is on screen.

## Next Steps

- **[Plugins](/docs/plugins)** — Extend the framework with plugins
- **[Tables](/docs/schema/)** — Declaring the tables Studio reads
- **[Customizing a table](/docs/frontend/customize-table/)** — How the panel shows them
