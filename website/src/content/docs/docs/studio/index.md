---
title: Studio Tools
sidebar_label: Studio
description: Rebase Studio provides developer tools for visual schema editing, SQL queries, JavaScript scripting, RLS policy management, and storage browsing.
---

## Overview

Rebase has two modes:

- **Content Mode** — For content editors and operations teams. Shows collections and data management.
- **Studio Mode** — For developers. Unlocks developer-facing tools.

Toggle between modes using the admin mode controller or the UI toggle in the app bar.

## Built-in Studio Tools

### Collection Editor

A visual schema editor that lets you create and modify collections through a drag-and-drop UI. When you save changes, it uses [ts-morph](https://ts-morph.com/) to update your TypeScript source files via AST manipulation — preserving all existing code and custom logic.

![Collection editor](/img/collection_editor.png)

```tsx
import { RebaseAdmin } from "@rebasepro/admin";

// The Collection Editor is automatically enabled when you provide the 
// collectionEditor configuration to your RebaseAdmin component
<RebaseAdmin
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

| Tab | Slug | What it does |
|-----|------|--------------|
| SQL Console | `sql` | Run raw SQL against your PostgreSQL database and read results in a table |
| JS Console | `js` | Write and execute JavaScript through the Rebase SDK |
| RLS Policy Editor | `rls` | Inspect and manage Row Level Security policies for your tables |
| Storage Browser | `storage` | Browse, upload and manage files across your storage backends |


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

## Next Steps

- **[Plugins](/docs/plugins)** — Extend the framework with plugins
- **[Collections](/docs/collections)** — Collection configuration
