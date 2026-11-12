---
description: Rebase architecture rules and package entry points
---
# Rebase Architecture and UX Rules

When working on the Rebase project, adhere to the following architectural guidelines:

## 1. Entry Points
- **Primary End-User Entry**: A Rebase project has a backend and a frontend in the project root:
  - `backend/schema/` — the tables: one `defineTable` / `defineAuthTable` / `defineView` per file, all exported from `backend/schema/index.ts` (which may also export `defaultRls`). This is the only thing the backend knows about the data.
  - `backend/functions/`, `backend/crons/`, `backend/resources.ts` — custom routes, scheduled jobs, declared databases, buckets and topics.
  - `frontend/` — React frontend (Vite). `frontend/src/cms/` holds the CMS customizations: one `customizeTable<typeof table>("slug", { … })` per table that should look different from its default, and `defineFirestoreCollection(…)` for Firestore.
- **Two layers.** The BaaS core is the backend: tables, row-level security, REST, realtime, MCP, the SDK. It serves every table's compiled descriptor at `GET /api/schema/tables`. The CMS is a frontend layer on top: it derives a default collection per descriptor and layers the project's `customizeTable` results over it. Nothing about presentation (labels, icons, enum colours, view modes, custom fields) goes in `backend/schema/`, and nothing about storage or access goes in `frontend/src/cms/`.
- **Package entry points for that split:**
  - `@rebasepro/server/schema` — `defineTable`, `defineAuthTable`, `defineView`, `col`, `rel`, `json`, `InferRow` and the hook types. Loads no server code, so the frontend can `import type` a table from `backend/schema`. The types live in `packages/types/src/schema/`.
  - `@rebasepro/server` — the server entrypoint (`initializeRebaseBackend`, `rebase`); `@rebasepro/server/functions` — what route handlers import.
  - `@rebasepro/cms` — `customizeTable`, `<RebaseCMS>`, `<RebaseShell>`; `@rebasepro/cms-types` — the CMS-only types.
  - `@rebasepro/firebase` — `defineFirestoreCollection` and the Firestore data source, passed to `<RebaseCMS externalCollections>`.
  - `@rebasepro/client` — the SDK: `client.data.table("posts")` or `client.data.posts`.

## 2. Dev Mode & End-User Preview
- **Mode Toggle**: The application uses `AdminModeController` (`useAdminModeController()`) with `mode: "cms" | "studio"` — `"cms"` for editing data, `"studio"` for the developer tools. This toggle must be preserved.
- **End-User Preview**: Switching to CMS mode is explicitly designed so the developer can see the app exactly as an end-user would see it, without any developer-specific UI elements.
- **Effective Role Simulation**: Use `EffectiveRoleControllerContext` (`useEffectiveRoleController()`) to simulate different user roles. In Studio mode, developers can select an "effective role" to accurately preview what that specific role can see/execute when switching to CMS mode.

## 3. Package Management
- **Do not rename packages**: Package names are settled and describe a **role**, not a position or a framework — `server` pairs with `client`; `app` is the runtime that `cms`, `studio` and the plugins register into. Keep the names in `packages/` as they are. The rename to these names is done; `pnpm run check:names` fails on any reference to a name that no longer exists.
- **Inner View Adaptability**: Internal views should conditionally render inline developer actions (like "Edit Schema") by checking if `mode === "studio"`.

## 4. View Modes

View modes are **presentation**, so they live in the table's CMS
customization, never in `backend/schema/` — the BaaS types know nothing about
them. `app/frontend/src/cms/posts.tsx` is the worked version:

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    // Enabled view modes: "table" | "cards" | "kanban" | "list"
    enabledViews: ["table", "kanban"],
    // The view the collection opens in
    defaultViewMode: "table",
    // Kanban groups by an enum column, and keeps a card's place within a
    // column in a text column; without `orderField` the order resets on every read
    kanban: { columnField: "status", orderField: "__order" },
    // How a row opens: "split" | "side_panel" | "full_screen" | "dialog"
    openEntityMode: "split",
    fields: {
        __order: { hidden: true, disabled: true }
    }
});
```

The table itself declares the columns: `status: col.enum(["todo", "doing",
"done"]).notNull().default("todo")` and `__order: col.text()`. Per-field
presentation (`multiline`, `markdown`, `clearable`, `enumLabels`, a custom
`Field`, …) goes under `fields.<key>`. `customizeTable` throws on an unknown or
old option name and says the new one.

## 5. Frontend Composition API
The frontend uses a declarative composition pattern:

```tsx
<Rebase client={rebaseClient} authController={authController} plugins={plugins}>
    <RebaseAuth/>
    <RebaseCMS tableCustomizations={tableCustomizations} entityViews={entityViews}/>
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
- `<RebaseCMS>` — CMS frontend: a collection per table the backend serves, with `tableCustomizations` layered on, plus `externalCollections` (Firestore), entity views and the collection editor
- `<RebaseStudio/>` — Studio (visual schema editor, SQL, settings)
- `<RebaseShell>` — App shell (drawer, navigation, title)

Adhere to these rules when building features or refactoring packages for Rebase.
