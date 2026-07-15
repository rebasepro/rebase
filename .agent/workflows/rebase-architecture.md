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
- **Do not rename packages**: Existing packages (like `core`, `admin`, `server-postgresql`, etc.) should keep their current names.
- **Inner View Adaptability**: Internal views should conditionally render inline developer actions (like "Edit Schema") by checking if `mode === "developer"`.

## 4. View Modes
Collections support multiple view modes, configured via:
- `enabledViews` — Array of enabled view modes: `"table"`, `"cards"`, `"kanban"`, `"list"`
- `defaultViewMode` — The default view when opening the collection
- `kanban` — Kanban board configuration: `{ columnProperty: "status" }`
- `openEntityMode` — How entities open: `"split"` (side-by-side), `"side_panel"` (right drawer), `"full_screen"` (full page)

## 5. Frontend Composition API
The frontend uses a declarative composition pattern:

```tsx
<Rebase client={rebaseClient} authController={authController} userManagement={userManagement} plugins={plugins}>
    <RebaseAuth/>
    <RebaseAdmin collections={collections} collectionEditor={collectionEditor} entityViews={entityViews}/>
    <RebaseStudio/>
    <RebaseShell title="Rebase"/>
</Rebase>
```

Key components:
- `<Rebase>` — Root provider (client, auth, user management, plugins)
- `<RebaseAuth/>` — Authentication UI (login/register screens)
- `<RebaseAdmin>` — CMS frontend (collections, entity views, collection editor)
- `<RebaseStudio/>` — Admin panel (visual schema editor, settings)
- `<RebaseShell>` — App shell (drawer, navigation, title)

Adhere to these rules when building features or refactoring packages for Rebase.
