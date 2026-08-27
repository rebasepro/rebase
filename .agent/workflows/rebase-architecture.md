---
description: Rebase architecture rules and package entry points
---
# Rebase Architecture and UX Rules

When working on the Rebase project, adhere to the following architectural guidelines:

## 1. Entry Points
- **Primary End-User Entry**: A Rebase project is structured with separate frontend, backend, and config folders in the project root:
  - `frontend/` — React frontend (Vite)
  - `backend/` — Hono backend server
  - `config/collections/` — TypeScript collection definitions (one file per collection)

## 2. Dev Mode & End-User Preview
- **Dev Mode Toggle**: The application uses `AdminModeController` with states `developer` and `editor`. This toggle must be preserved.
- **End-User Preview**: Toggling to Editor Mode is explicitly designed so the developer can see the app exactly as an end-user would see it, without any developer-specific UI elements.
- **Effective Role Simulation**: Use an `EffectiveRoleController` context to simulate different user roles. When in Dev Mode, developers can select an "effective role" to accurately preview what that specific role can see/execute when toggling to Editor Mode.

## 3. Package Management
- **Do not rename packages**: Package names are settled and describe a **role**, not a position or a framework — `server` pairs with `client`; `app` is the runtime that `admin`, `studio` and the plugins register into. Keep the names in `packages/` as they are. The rename to these names is done; `pnpm run check:names` fails on any reference to a name that no longer exists.
- **Inner View Adaptability**: Internal views should conditionally render inline developer actions (like "Edit Schema") by checking if `mode === "developer"`.

## 4. View Modes

View modes are **presentation**, so they live in the collection's `admin` block,
not at the top level — the BaaS types know nothing about them, and
`@rebasepro/cms-types` merges them in:

```ts
import { defineCollection } from "@rebasepro/cms-types";

export default defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string" },
        status: { name: "Status", type: "string" }
    },
    admin: {
        // Enabled view modes: "table" | "cards" | "kanban" | "list"
        enabledViews: ["table", "kanban"],
        // The view a collection opens in
        defaultViewMode: "table",
        // Kanban needs the property it groups columns by
        kanban: { columnProperty: "status" },
        // How an entity opens: "split" | "side_panel" | "full_screen" | "dialog"
        openEntityMode: "split"
    }
});
```

The same split applies per property: presentation options (`clearable`,
`markdown`, `multiline`, …) go in the property's own `admin` block. If a key you
expect at the top level is rejected, it is almost always because it belongs
under `admin`.

## 5. Frontend Composition API
The frontend uses a declarative composition pattern:

```tsx
<Rebase client={rebaseClient} authController={authController} plugins={plugins}>
    <RebaseAuth/>
    <RebaseCMS collections={collections} collectionEditor={collectionEditor} entityViews={entityViews}/>
    <RebaseStudio/>
    <RebaseShell title="Rebase"/>
</Rebase>
```

`Rebase` and `RebaseAuth` come from `@rebasepro/app`, `RebaseCMS` and
`RebaseShell` from `@rebasepro/cms`, `RebaseStudio` from `@rebasepro/studio`.
`app/frontend/src/App.tsx` is the worked version of this.

Key components:
- `<Rebase>` — Root provider (client, auth, user management, plugins)
- `<RebaseAuth/>` — Authentication UI (login/register screens)
- `<RebaseCMS>` — CMS frontend (collections, entity views, collection editor)
- `<RebaseStudio/>` — Admin panel (visual schema editor, settings)
- `<RebaseShell>` — App shell (drawer, navigation, title)

Adhere to these rules when building features or refactoring packages for Rebase.
