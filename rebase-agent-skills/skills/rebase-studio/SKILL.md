---
name: rebase-studio
description: Guide for using and customizing the Rebase Studio admin panel. Use this skill when the user needs help with the visual collection editor, custom views, dev/editor mode toggle, or Studio configuration.
---

# Rebase Studio

Rebase Studio is the visual admin panel that provides a complete CMS experience — table views, form editing, visual schema editor, user management, and more.

## Overview

The Studio is built on `@rebasepro/core` and provides:
- **Table collection views** with inline editing
- **Visual schema editor** for non-developers
- **Form views** with 20+ field types
- **Card grid** and **Kanban board** view modes
- **List** and **Split** view modes
- **User management** with role-based access
- **Data import/export** (CSV, JSON, Excel)
- **Entity history** and audit trail
- **Custom views** as React components
- **Rich text editor** (TipTap-based, Notion-style)
- **Storage browser** for uploaded files and media
- **Collection Editor** with AST-backed schema editing

## Dev Mode & Editor Mode

The Studio has two modes controlled by `AdminModeController`:

### Developer Mode (`mode === "developer"`)
- Full access to collection editor, schema management
- "Edit Schema" inline actions on views
- Debug tools and developer-specific UI
- Can simulate different roles via **Effective Role Controller**

### Editor Mode (`mode === "editor"`)
- Clean end-user experience
- No developer-specific UI elements
- Shows exactly what end-users see

**Important:** This toggle must always be preserved. Developers use it to preview the exact end-user experience.

## Effective Role Simulation

In Dev Mode, developers can select an "effective role" to preview the application as a specific role would see it:

```typescript
// The EffectiveRoleController context provides:
const { effectiveRole, setEffectiveRole } = useEffectiveRole();
```

When toggled to Editor Mode with an effective role set, the developer sees exactly what that role can access.

## Visual Collection Editor

The Studio's collection editor allows non-developers to:
- Add, remove, and reorder fields
- Configure field types and validation
- Set up enum values and relations
- Preview the form layout

Under the hood, it uses **AST manipulation** (via `ts-morph`) to modify the TypeScript collection files — preserving all custom callbacks and code.

### Collection Editor Auth

The collection editor requires an auth token to communicate with the backend's AST editing endpoints:

```typescript
const collectionEditor = React.useMemo(() => ({
    getAuthToken: authController.getAuthToken
}), [authController.getAuthToken]);

<RebaseCMS collections={collections} collectionEditor={collectionEditor}/>
```

## Frontend Composition

The Studio is mounted using the declarative composition API:

```tsx
import { useRebaseAuthController, useBackendUserManagement, RebaseAuth } from "@rebasepro/auth";
import { Rebase } from "@rebasepro/core";
import { RebaseCMS, RebaseShell } from "@rebasepro/admin";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-data-enhancement";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({ baseUrl: API_URL }), []);
    const authController = useRebaseAuthController({ client: rebaseClient });
    const userManagement = useBackendUserManagement({ client: rebaseClient, currentUser: authController.user });
    const dataEnhancementPlugin = useDataEnhancementPlugin();

    const collectionEditor = React.useMemo(() => ({
        getAuthToken: authController.getAuthToken
    }), [authController.getAuthToken]);

    return (
        <Rebase client={rebaseClient} authController={authController} userManagement={userManagement} plugins={[dataEnhancementPlugin]}>
            <RebaseAuth/>
            <RebaseCMS collections={collections} collectionEditor={collectionEditor}/>
            <RebaseStudio/>
            <RebaseShell title="Rebase"/>
        </Rebase>
    );
}
```

### Key Components

| Component | Package | Purpose |
|-----------|---------|---------|
| `<Rebase>` | `@rebasepro/core` | Root provider (client, auth, user management, plugins) |
| `<RebaseAuth/>` | `@rebasepro/auth` | Authentication UI (login/register) |
| `<RebaseCMS>` | `@rebasepro/admin` | CMS frontend (collections, views, editor) |
| `<RebaseStudio/>` | `@rebasepro/studio` | Admin panel (visual schema, settings) |
| `<RebaseShell>` | `@rebasepro/admin` | App shell (drawer, navigation) |

## Custom Views

Add custom React views to the Studio navigation:

```typescript
import { EntityCollection } from "@rebasepro/core";

const myCustomView = {
    path: "dashboard",
    name: "Dashboard",
    view: <DashboardView />,
};
```

### Useful Hooks

| Hook | Description |
|------|-------------|
| `useSideEntityController()` | Open/close entity side panels |
| `useSnackbarController()` | Show toast notifications |
| `useAuthController()` | Access current user and auth state |
| `useNavigationController()` | Navigate between views |
| `useDataSource()` | Access the data source for CRUD ops |
| `useRebaseLocaleContext()` | Access `t()` for translations |

## Key Packages

| Package | Description |
|---------|-------------|
| `@rebasepro/core` | Core framework, hooks, types |
| `@rebasepro/studio` | Studio admin panel components |
| `@rebasepro/admin` | CMS frontend application (previously `cms`) |
| `@rebasepro/ui` | Component library (Tailwind v4 + Radix) |
| `@rebasepro/plugin-data-enhancement` | AI-powered autofill |
| `@rebasepro/schema-inference` | Auto-infer schema from data |

## Running the Studio

```bash
# From the repo root
cd app
pnpm run dev
```

This starts both frontend and backend via the monorepo dev script. The Studio is accessible at `http://localhost:5173` (Vite default).

## Virtual Collection Import

Collections are auto-loaded via a Vite plugin using the `virtual:rebase-collections` import:

```typescript
import { collections } from "virtual:rebase-collections";
```

This reads all collection files from `app/config/collections/` and makes them available to the frontend without manual barrel exports.

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
