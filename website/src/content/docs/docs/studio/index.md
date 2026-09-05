---
title: Studio Tools
sidebar_label: Studio
description: Rebase Studio provides developer tools for visual schema editing, SQL queries, JavaScript scripting, RLS policy management, and storage browsing.
---

## Overview

The panel has three modes — `"cms" | "studio" | "settings"`:

- **CMS** (`"cms"`) — For content editors and operations teams. Shows collections and data management. This is the default.
- **Studio** (`"studio"`) — For developers. Unlocks the tools below.
- **Settings** (`"settings"`) — declared in the type, but nothing sets it and
  nothing reads it. There is no way to enter this mode today. It is listed here
  because it is part of the public `AdminModeController` type you will see in
  your editor, not because it does anything.

The drawer's toggle switches between the first two.

Toggle between them with the admin mode controller or the drawer toggle. The
chosen mode is persisted in `localStorage` under `rebase-admin-mode`; a browser
that used the panel before 0.17.0 holds the old `"content"` value and is
migrated to `"cms"` on read.

## Built-in Studio Tools

### Collection Editor

A visual schema editor that lets you create and modify collections through a drag-and-drop UI. When you save changes, it uses [ts-morph](https://ts-morph.com/) to update your TypeScript source files via AST manipulation — preserving all existing code and custom logic.

![Collection editor](/img/collection_editor.png)

```tsx
import { RebaseCMS } from "@rebasepro/cms";

// The Collection Editor is automatically enabled when you provide the 
// collectionEditor configuration to your RebaseCMS component
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken
    }}
/>
```

### Built-in tools

These ship with Studio and are **lazy-loaded by `RebaseStudio`** — each is a separate
chunk, fetched the first time you open it. They are not importable on their own:
`@rebasepro/studio` deliberately exports only the orchestrator, so a console you never
open costs nothing.

| Tab | Slug | Group | What it does |
|-----|------|-------|--------------|
| SQL Console | `sql` | Database | Run raw SQL against your PostgreSQL database and read results in a table |
| RLS Policies | `rls` | Database | Inspect and manage Row Level Security policies for your tables |
| Schema Visualizer | `schema-visualizer` | Database | Interactive ERD of tables and relations |
| Branches | `branches` | Database | Create and manage [database branches](/docs/backend/branching) |
| Backups | `backups` | Database | Browse and download database backups |
| Logs Explorer | `logs` | Database | Live request log, plus everything the server reports at warn or error — see below |
| JS Console | `js` | Compute | Write and execute JavaScript through the Rebase SDK |
| Cron Jobs | `cron` | Compute | Inspect and manage [scheduled tasks](/docs/backend/cron-jobs) |
| Storage | `storage` | Storage | Browse, upload and manage files across your storage backends |
| API Explorer | `api` | API | Interactive API documentation, with a request runner |
| API Keys | `api-keys` | Access Control | Create and manage scoped service API keys |

### What the Logs Explorer shows

Two streams into one in-memory ring, held on the server process:

- **Every request** — method, path, status, duration, the `X-Request-ID`, the
  collection when the request was about one, and, when the request failed, the
  error `code` and message the client received. A failed request is recorded at
  `warn` (4xx) or `error` (5xx), so the level filter finds it.
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

The **Collection Editor** is a Studio tool too, but it is not in this list because
it is registered differently: `RebaseStudio` does not lazy-load it. The panel injects
it when `RebaseCMS` is given a `collectionEditor` prop, because unlike the tools
above it needs the project's collection source at hand to write back to. That is a
difference in how it is mounted, not in what it is — it edits schema, and it belongs
beside the SQL and RLS editors.

## Adding Studio Views

Studio tools are automatically available when you include the `RebaseStudio` component inside your app:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            {/* Custom views are injected and studio mode is managed automatically */}
            <RebaseStudio />
            {/* ... */}
        </Rebase>
    );
}
```

These views appear in the sidebar navigation when Studio mode is active.

### Choosing which tools appear

Omit `tools` and every tool above is registered. Pass it to register a subset —
a hosted console that has its own storage browser, say, can leave that one out:

```tsx
<RebaseStudio tools={["sql", "rls", "schema-visualizer", "api"]} />
```

The list is read by *contents*, not identity, so writing it inline is safe: a
re-render of the host does not tear down and remount whichever tool is on screen.

## Next Steps

- **[Plugins](/docs/plugins)** — Extend the framework with plugins
- **[Collections](/docs/collections)** — Collection configuration
