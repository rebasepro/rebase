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
| Logs Explorer | `logs` | Database | Real-time system and query logs |
| JS Console | `js` | Compute | Write and execute JavaScript through the Rebase SDK |
| Cron Jobs | `cron` | Compute | Inspect and manage [scheduled tasks](/docs/backend/cron-jobs) |
| Storage | `storage` | Storage | Browse, upload and manage files across your storage backends |
| API Explorer | `api` | API | Interactive API documentation, with a request runner |
| API Keys | `api-keys` | Access Control | Create and manage scoped service API keys |

The **Collection Editor** is a Studio tool too, but it is not in this list because
it is registered differently: `RebaseStudio` does not lazy-load it. The panel injects
it when `RebaseCMS` is given a `collectionEditor` prop, because unlike the tools
above it needs the project's collection source at hand to write back to. That is a
difference in how it is mounted, not in what it is — it edits schema, and it belongs
beside the SQL and RLS editors.

## Turning Studio on

One component, anywhere inside `<Rebase>`. It renders nothing — it registers
the tools, and `<RebaseShell>` draws them:

```tsx
import { RebaseStudio } from "@rebasepro/studio";

export function App() {
    return (
        <Rebase client={client} authController={authController}>
            <RebaseCMS collections={collections}/>
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

The list is read by *contents*, not identity, so writing it inline is safe: a
re-render of the host does not tear down and remount whichever tool is on screen.

## Next Steps

- **[Plugins](/docs/plugins)** — Extend the framework with plugins
- **[Collections](/docs/collections)** — Collection configuration
