---
name: rebase-studio
description: Guide for using and customizing the Rebase Studio developer tools layer. Use this skill when the user needs help with Studio dev tools (SQL/JS/RLS/Storage/Cron/Schema Visualizer/Branches/API Explorer/Logs), admin modes (content/studio/settings), Studio home page customization, bridge hooks, or Studio configuration. Studio is NOT the CMS — the CMS lives in @rebasepro/cms.
---

# Rebase Studio

Rebase Studio (`@rebasepro/studio`) is the developer tools layer for Rebase. It provides 9 built-in tools — SQL Console, JS Console, RLS Editor, Storage browser, Cron Jobs manager, Schema Visualizer, Branches manager, API Explorer, and Logs Explorer — accessible via the "Studio" mode toggle in the sidebar.

## Overview

- **9 built-in dev tools** — all lazy-loaded and code-split so they don't impact initial bundle size
- **StudioHomePage** — customizable landing page with tool cards grouped by section
- **Studio Bridge** — hooks that connect Studio tools to CMS data (collections, navigation, side panels)

## Admin Modes (Tri-State)

> **IMPORTANT FOR AGENTS:** The Studio uses a **tri-state** mode system: `"content"` | `"studio"` | `"settings"`. It is NOT `"developer"` / `"editor"`. These are the only valid values.

The admin mode is controlled by `AdminModeController` and persisted in `localStorage` under the key `rebase-admin-mode`. Default mode is `"content"`.

### Mode Values

| Mode | Description | Navigation Shows |
|------|-------------|------------------|
| `"content"` | Clean CMS experience for editing data. Default mode. | Collections + admin entries (Users/Roles) |
| `"studio"` | Developer tools and schema management. | Dev tool views + admin entries (Users/Roles) |
| `"settings"` | Application settings and configuration. | Settings-related views |

### Mode Controller API

```typescript
import { useAdminModeController } from "@rebasepro/app";

interface AdminModeController {
    mode: "content" | "studio" | "settings";
    setMode: (mode: "content" | "studio" | "settings") => void;
}

// Usage in a component
function MyComponent() {
    const adminModeController = useAdminModeController();

    // Check current mode
    if (adminModeController.mode === "studio") {
        // Show developer UI
    }

    // Switch modes
    adminModeController.setMode("content");
}
```

### Drawer Mode Switch

When `<RebaseStudio>` is registered, the drawer automatically renders a segmented **Content / Studio** toggle. Clicking "Content" sets mode to `"content"` and navigates to the base path. Clicking "Studio" sets mode to `"studio"` and navigates to `/s`.

## Effective Role Simulation

> **IMPORTANT FOR AGENTS:** The hook is called `useEffectiveRoleController()`, NOT `useEffectiveRole()`.

In Studio mode, developers can select an "effective role" to preview the application as a specific role would see it. The role is persisted in `localStorage` under `rebase-effective-role`.

```typescript
import { useEffectiveRoleController } from "@rebasepro/app";

interface EffectiveRoleController {
    effectiveRole: string | null;
    setEffectiveRole: (role: string | null) => void;
}

// Usage
function RoleSimulator() {
    const { effectiveRole, setEffectiveRole } = useEffectiveRoleController();

    // Set a role to simulate
    setEffectiveRole("editor");

    // Clear simulation (back to actual role)
    setEffectiveRole(null);
}
```

## Studio Dev Tools

The Studio ships 11 built-in dev tools, all **lazy-loaded** (code-split) so they don't impact the initial bundle. Heavy dependencies (Monaco, `@xyflow/react`, `dagre`, `pgsql-ast-parser`) are only loaded when a tool is visited.

### Tool Reference

| Tool Key | Component | Name | Group | Icon | Description |
|----------|-----------|------|-------|------|-------------|
| `"sql"` | `SQLEditor` | SQL Console | Database | `terminal` | Execute raw SQL queries against the database |
| `"js"` | `JSEditor` | JS Console | Compute | `code` | Run JavaScript with the Rebase SDK in a live sandbox |
| `"rls"` | `RLSEditor` | RLS Policies | Database | `ShieldCheck` | Configure Row Level Security for fine-grained data access |
| `"storage"` | `StorageView` | Storage | Storage | `HardDrive` | Browse, upload, and manage files in the storage bucket |
| `"cron"` | `CronJobsView` | Cron Jobs | Compute | `Clock` | Monitor and manage scheduled background tasks |
| `"schema-visualizer"` | `SchemaVisualizer` | Schema Visualizer | Database | `Network` | Interactive ERD showing tables, columns, and relationships |
| `"branches"` | `BranchesView` | Branches | Database | `GitBranch` | Create and manage isolated database copies for development |
| `"backups"` | `BackupsView` | Backups | Database | `Database` | Browse and download database backups |
| `"api"` | `ApiExplorer` | API Explorer | API | `BookOpen` | Interactive API documentation with live request testing |
| `"logs"` | `LogsExplorer` | Logs Explorer | Database | `Activity` | Real-time system, query, and authentication logs |
| `"api-keys"` | `ApiKeysView` | API Keys | Access Control | `KeyRound` | Create and manage scoped service API keys |

> **IMPORTANT FOR AGENTS:** The `"schema"` tool (collection editor) is **NOT** registered by `<RebaseStudio>`. It is auto-injected by `<RebaseShell>` when `collectionEditor` is enabled on `<RebaseCMS>`. Do not try to register it manually.

### Enabling/Disabling Tools

By default, **all 11 tools** are enabled. Use the `tools` prop on `<RebaseStudio>` to selectively enable a subset:

```tsx
// Enable all tools (default behavior — both are equivalent)
<RebaseStudio />
<RebaseStudio tools={undefined} />

// Enable only specific tools
<RebaseStudio tools={["sql", "rls", "storage"]} />

// Enable everything except branches
<RebaseStudio tools={["sql", "js", "rls", "storage", "cron", "schema-visualizer", "backups", "api", "logs", "api-keys"]} />
```

The `tools` prop accepts an array of tool key strings:

```typescript
type ToolKey = "sql" | "js" | "rls" | "schema" | "storage" | "cron"
    | "schema-visualizer" | "branches" | "backups" | "api" | "logs" | "api-keys";

// Default when tools is undefined:
const DEFAULT_TOOLS: ToolKey[] = [
    "sql", "js", "rls", "storage", "cron", "schema-visualizer",
    "branches", "backups", "api", "logs", "api-keys"
];
```

### Individual tools are not importable

`@rebasepro/studio` exports **only** `RebaseStudio` and `StudioHomePage`. The
tools (SQLEditor, JSEditor, RLSEditor,
StorageView, …) are lazy-loaded inside `RebaseStudio.tsx` and deliberately not
re-exported, so that importing the Studio does not pull every tool into the
bundle.

> **WARNING FOR AGENTS:** Do NOT write a deep import such as
> `@rebasepro/studio/components/SQLEditor/SQLEditor`. It resolves inside this
> repository and fails for every installed consumer: the package's `exports`
> map contains `"."` and `"./package.json"` only, and the published `dist/` is a
> single bundle with no per-component file behind such a path. Mount
> `<RebaseStudio>` and let it load the tool.

## Frontend Composition

The Studio is mounted using the declarative composition API. All four components (`<Rebase>`, `<RebaseAuth>`, `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`) are purely declarative — they **render nothing** and only register configuration into the registry (`RebaseRegistryController`, read with `useRebaseRegistry()`). `<RebaseShell>` then reads the registry and builds the actual UI.

```tsx
import { useRebaseAuthController, RebaseAuth } from "@rebasepro/app";
import { Rebase } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";
import { RebaseStudio } from "@rebasepro/studio";
import React from "react";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({ baseUrl: API_URL }), []);
    const authController = useRebaseAuthController({ client: rebaseClient });
    const dataEnhancementPlugin = useDataEnhancementPlugin();

    return (
        <Rebase client={rebaseClient} authController={authController} plugins={[dataEnhancementPlugin]}>
            <RebaseAuth/>
            <RebaseCMS collections={collections} collectionEditor={true}/>
            <RebaseStudio tools={undefined} homePage={undefined} />
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

### TypeScript Strict Props Warning

Under strict TypeScript checks, `<RebaseStudio/>` without props throws:
`Type '{}' is missing the following properties from type '{ tools: any; homePage: any; }': tools, homePage`

Pass `tools={undefined} homePage={undefined}` explicitly:
```tsx
<RebaseStudio tools={undefined} homePage={undefined} />
```

### Key Components

| Component | Package | Purpose | Renders UI? |
|-----------|---------|---------|-------------|
| `<Rebase>` | `@rebasepro/app` | Root provider (client, auth, user management, plugins) | Yes (providers) |
| `<RebaseAuth>` | `@rebasepro/app` | Authentication config (custom login view) | No — registers into registry |
| `<RebaseCMS>` | `@rebasepro/cms` | CMS config (collections, views, editor) | No — registers into registry |
| `<RebaseStudio>` | `@rebasepro/studio` | Studio config (tools, home page) | No — registers into registry |
| `<RebaseShell>` | `@rebasepro/cms` | App shell (drawer, navigation, routes, layout) | Yes — the actual UI |

## Global Component Overrides (Swizzling)

Rebase allows you to override default UI components globally by passing a `components` prop to the `<Rebase>` provider. This implements Docusaurus-style component swizzling, supporting both **Eject** and **Wrap** patterns.

```tsx
import { Rebase } from "@rebasepro/app";
import { MyAppBar } from "./MyAppBar";

<Rebase
    client={rebaseClient}
    components={{
        // Eject Mode: Replace the built-in AppBar entirely
        "Shell.AppBar": { Component: MyAppBar },

        // Wrap Mode: Wrap the default LoginView, adding custom branding
        "Auth.LoginView": {
            // `OriginalComponent` is injected at runtime when `wrap: true`; the override
                    // slot's type does not model it, hence the annotation.
                    Component: (({ OriginalComponent, ...props }: {
                        OriginalComponent: React.ComponentType<Record<string, unknown>>
                    }) => (
                <div className="custom-login-wrapper">
                    <div className="branding">Welcome to My Enterprise App</div>
                    <OriginalComponent {...props} />
                </div>
            )) as unknown as React.ComponentType<Record<string, unknown>>,
            wrap: true
        }
    }}
>
    {/* your app */}
    …
</Rebase>
```

### Overridable Component Scopes

#### App-scoped Components (`AppComponentName`)
These components can only be overridden at the root `<Rebase>` provider, as they represent global shell or utility structures.

- `"Shell.AppBar"` — The header bar at the top of the page.
- `"Shell.Drawer"` — The collapsible main sidebar drawer.
- `"Shell.DrawerNavigationItem"` — Sidebar navigation link.
- `"Shell.DrawerNavigationGroup"` — Sidebar navigation group header.
- `"HomePage"` — The landing dashboard of the CMS (when in content mode).
- `"HomePage.CollectionCard"` — Individual collection link card on the home page.
- `"Auth.LoginView"` — The login screen overlay.

#### Collection-scoped Components (`CollectionComponentName`)
These components can be overridden globally on `<Rebase>` (which acts as a fallback for all collections) or overridden on individual collections inside their definitions.

- `"Collection.View"` — The container view for the collection.
- `"Collection.Table"` — The default tabular data view.
- `"Collection.Card"` — Individual card wrapper.
- `"Collection.EmptyState"` — View shown when a collection is empty.
- `"Collection.Actions"` — Toolbar actions header.
- `"Collection.FilterField"` — The per-property filter input.
- `"Entity.Form"` — The detail form view.
- `"EditView.FormActions"` — Form action button bar.
- `"DetailView"` — Read-only detail view.
- `"Entity.SidePanel"` — Side panel wrapper.
- `"EntityPreview"` — Reference / relation preview chip.
- `"Entity.MissingReference"` — Placeholder view when a relation references a deleted/non-existent entity.

> **IMPORTANT FOR AGENTS:** three keys break the `Entity.` pattern the rest
> follow — `"EditView.FormActions"`, `"DetailView"` and `"EntityPreview"`.
> `"Entity.FormActions"`, `"Entity.DetailView"` and `"Entity.Preview"` are not in
> the union: they type-error, and in plain JavaScript the override silently never
> applies.

## RebaseCMS Configuration

`<RebaseCMS>` accepts the full `RebaseCMSConfig`:

```typescript
interface RebaseCMSConfig<EC extends CollectionConfig = CollectionConfig> {
    collections?: EC[] | CollectionConfigsBuilder<EC>;
    views?: AppView[] | AppViewsBuilder;
    homePage?: ReactNode;
    entityViews?: EntityCustomView[];
    entityActions?: EntityAction[];
    plugins?: RebasePlugin[];
    navigationGroupMappings?: NavigationGroupMapping[];
    collectionEditor?: boolean | CollectionEditorOptions;
}
```

### Collection Editor Options

```typescript
interface CollectionEditorOptions {
    /** Auth token for schema-editor API calls. Falls back to authController.getAuthToken. */
    getAuthToken?: () => Promise<string | null>;
    /** Mark the editor as read-only (disable mutations). */
    readOnly?: boolean;
    /** Suggested base paths shown when creating new collections. */
    pathSuggestions?: string[];
}
```

### Navigation Group Mappings

Control how collections and views are grouped in the sidebar and home page:

```typescript
interface NavigationGroupMapping {
    name: string;           // Group header display name
    entries: string[];      // Collection slugs or view paths
    collapsedByDefault?: boolean | {
        drawer?: boolean;   // Collapse in sidebar
        home?: boolean;     // Collapse on home page
    };
}

// Usage
<RebaseCMS
    collections={collections}
    navigationGroupMappings={[
        { name: "Content", entries: ["posts", "pages", "media"] },
        { name: "Commerce", entries: ["products", "orders"], collapsedByDefault: { drawer: true } },
    ]}
/>
```

## RebaseStudio Configuration

`<RebaseStudio>` accepts the full `RebaseStudioConfig`:

```typescript
interface RebaseStudioConfig {
    tools?: ("sql" | "js" | "rls" | "schema" | "storage" | "cron"
        | "schema-visualizer" | "branches" | "backups" | "api" | "logs" | "api-keys")[];
    homePage?: ReactNode;
    devViews?: AppView[];  // Computed internally — not passed by consumers
}
```

## StudioHomePage Customization

The `StudioHomePage` component is the default landing page for Studio mode. It renders tool cards organized by section. It can be customized through props:

```typescript
interface StudioHomePageProps {
    additionalActions?: React.ReactNode;       // Toolbar actions at the top
    additionalChildrenStart?: React.ReactNode;  // Content before tool sections
    additionalChildrenEnd?: React.ReactNode;    // Content after tool sections
    sections?: HomePageSection[];               // Extra sections after tools
    hiddenGroups?: string[];                    // Groups to hide (unused by default sections)
}

interface HomePageSection {
    key: string;             // Unique key
    title: string;           // Section header text
    children: React.ReactNode; // Arbitrary content
}
```

### Built-in Home Page Sections

The default `StudioHomePage` renders tools grouped into these sections:

| Section | Dot Color | Tools |
|---------|-----------|-------|
| Database | Emerald | Collections, Schema Visualizer, SQL Console, Branches, RLS Policies, Logs Explorer |
| Compute | Blue | JS Console, Cron Jobs |
| API | Violet | API Explorer |
| Storage | Amber | Storage |
| Access Control | Rose | Users, Roles |

### Custom Home Page Examples

**Add extra sections:**
```tsx
<RebaseStudio
    homePage={
        <StudioHomePage
            sections={[
                {
                    key: "analytics",
                    title: "Analytics",
                    children: <AnalyticsDashboard />,
                },
            ]}
        />
    }
/>
```

**Add action buttons:**
```tsx
<RebaseStudio
    homePage={
        <StudioHomePage
            additionalActions={
                <Button onClick={exportAll}>Export All Data</Button>
            }
        />
    }
/>
```

**Completely replace the home page:**
```tsx
<RebaseStudio
    homePage={<MyCustomStudioHome />}
/>
```

## Custom Login View

Use `<RebaseAuth>` with the `loginView` prop to replace the default login UI:

```tsx
<Rebase client={rebaseClient} authController={authController}>
    <RebaseAuth loginView={<MyCustomLoginPage />} />
    <RebaseCMS collections={collections} />
    <RebaseStudio />
    <RebaseShell title="My App" />
</Rebase>
```

The `loginView` is registered into the registry via `registerAuth()` and consumed by `<RebaseAuthGate>`.

## Custom Views

Add custom React views to the Studio navigation using the `AppView` interface:

```typescript
interface AppView {
    slug: string;                    // URL path segment
    name: string;                    // Display name
    description?: string;            // Optional description (Markdown)
    icon?: string | React.ReactNode; // Lucide icon name or custom element
    hideFromNavigation?: boolean;    // Hide from sidebar (still accessible by URL)
    group?: string;                  // Navigation group name
    view: React.ReactNode;           // React component to render
    nestedRoutes?: boolean;          // Enable nested routing (slug/*)
    roles?: string[];                // Only show to users with at least one matching role
}
```

Custom top-level views are added through the `views` prop on `<RebaseCMS>`. They can also be contributed by plugins via `plugin.views`.

```tsx
// Static array
<RebaseCMS
    collections={collections}
    views={[
        { slug: "dashboard", name: "Dashboard", icon: "LayoutDashboard", view: <Dashboard /> },
        { slug: "audit-log", name: "Audit Log", icon: "ScrollText", view: <AuditLog />, roles: ["admin"] },
    ]}
/>

// Builder function (role-aware, async-capable)
<RebaseCMS
    collections={collections}
    views={({ user, authController, data }) => [
        { slug: "dashboard", name: "Dashboard", icon: "LayoutDashboard", view: <Dashboard /> },
        ...(user?.roles?.includes("analyst")
            ? [{ slug: "reports", name: "Reports", icon: "FileText", view: <Reports /> }]
            : []),
    ]}
/>
```

> **IMPORTANT FOR AGENTS:** The `roles` field on `AppView` provides declarative role filtering — the view is excluded entirely (not just hidden from nav) if the user lacks a matching role. Use `roles` for simple access control and the builder function for dynamic/async cases. Both approaches compose.

## CollectionPanel Component

`CollectionPanel` is a high-level wrapper for embedding collection views inside custom pages (dashboards, home pages, entity detail views):

```typescript
import { CollectionPanel } from "@rebasepro/cms";

type CollectionPanelProps = {
    path: string;                           // Collection slug (required)
    title?: string | false;                 // Title above the collection (false = hide)
    viewMode?: ViewMode;                    // Force view mode (table, card, etc.)
    sort?: [string, "asc" | "desc"];        // Override sort
    limit?: number;                         // Max entities to display
    updateUrl?: boolean;                    // Sync filter/sort with URL (default: false)
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";
    className?: string;                     // Container CSS class
    collectionOverrides?: Partial<CollectionConfig>; // Additional overrides
};
```

### Usage Examples

```tsx
import { CollectionPanel } from "@rebasepro/cms";

function MyDashboard() {
    return (
        <div>
            {/* Simple usage */}
            <CollectionPanel path="tasks" title="Pending Tasks" />

            {/* With overrides */}
            <CollectionPanel
                path="clients"
                viewMode="table"
                limit={10}
                sort={["createdAt", "desc"]}
                collectionOverrides={{
                    defaultFilter: { status: ["!=", "completed"] }
                }}
            />

            {/* Hide title, custom open mode */}
            <CollectionPanel
                path="orders"
                title={false}
                openEntityMode="dialog"
            />
        </div>
    );
}
```

> **IMPORTANT FOR AGENTS:** `CollectionPanel` defaults `updateUrl` to `false` so embedded panels don't hijack the browser URL. If you need URL sync, explicitly set `updateUrl={true}`.

## Studio Bridge Hooks

The Studio Bridge provides CMS capabilities to Studio components. When CMS is present, real implementations are injected. When CMS is absent, noop defaults ensure Studio works standalone.

### Bridge Interface

```typescript
interface StudioBridge {
    collectionRegistry: CollectionRegistryController;
    sidePanelController: SidePanelController;
    urlController: UrlController;
    navigationState: NavigationStateController;
    breadcrumbs: BreadcrumbsController;
}
```

### Bridge Hook Reference

| Hook | Return Type | Description |
|------|-------------|-------------|
| `useStudioCollectionRegistry()` | `CollectionRegistryController` | Access registered collections from Studio |
| `useStudioSidePanelController()` | `SidePanelController` | Open/close entity side panels from Studio |
| `useStudioUrlController()` | `UrlController` | Build URLs and navigate from Studio |
| `useStudioNavigationState()` | `NavigationStateController` | Access navigation state from Studio |
| `useStudioBreadcrumbs()` | `BreadcrumbsController` | Set breadcrumbs from Studio tools |

All bridge hooks are exported from `@rebasepro/studio` (re-exported from `@rebasepro/app`):

```typescript
import {
    useStudioCollectionRegistry,
    useStudioSidePanelController,
    useStudioUrlController,
    useStudioNavigationState,
    useStudioBreadcrumbs
} from "@rebasepro/studio";
```

### BreadcrumbsController

```typescript
interface BreadcrumbEntry {
    title: string;
    url: string;
    count?: number | null;
    id?: string;
}

interface BreadcrumbsController {
    breadcrumbs: BreadcrumbEntry[];
    set: (props: { breadcrumbs: BreadcrumbEntry[] }) => void;
    updateCount: (id: string, count: number | null | undefined) => void;
}
```

### StudioBridgeProvider (Advanced)

For custom wiring, use `StudioBridgeProvider` to inject CMS capabilities:

```tsx
import { StudioBridgeProvider } from "@rebasepro/studio";

<StudioBridgeProvider value={{
    collectionRegistry: useCollectionRegistryController(),
    sidePanelController: useSidePanel(),
    urlController: useUrlController(),
    navigationState: useNavigationStateController(),
    breadcrumbs: useBreadcrumbsController(),
}}>
    <RebaseStudio />
</StudioBridgeProvider>
```

## Core Hooks Reference

These hooks are exported from `@rebasepro/app` and available inside any `<Rebase>` provider tree:

### Primary Hooks

| Hook | Return Type | Description |
|------|-------------|-------------|
| `useRebaseContext()` | `RebaseContext` | Full Rebase context with all controllers |
| `useAuthController()` | `AuthController` | Access current user and auth state |
| `useAdminModeController()` | `AdminModeController` | Read/set admin mode (`content` / `studio` / `settings`) |
| `useEffectiveRoleController()` | `EffectiveRoleController` | Simulate a role for previewing |
| `useModeController()` | `ModeController` | Read/set color theme (`light` / `dark`) |
| `useSnackbarController()` | `SnackbarController` | Show toast notifications |
| `useStorageSource()` | `StorageSource` | Access file storage |
| `useData()` | `DataSource` | Access the data source for CRUD ops |
| `useDialogsController()` | `DialogsController` | Programmatic dialog management |
| `useCustomizationController()` | `CustomizationController` | Access plugins, slots, property configs |
| `usePermissions()` | `{ canCreate, canEdit, canDelete, canRead }` | Role-aware permission checks |

### UI & Layout Hooks

| Hook | Return Type | Description |
|------|-------------|-------------|
| `useLargeLayout()` | `boolean` | `true` when viewport ≥ 1025px (lg breakpoint) |
| `useClipboard(options?)` | `useClipboardReturnType` | Copy/cut to clipboard with `ref` or text |
| `useSlot(name, props)` | `ReactNode \| null` | Render plugin slot contributions |
| `useTranslation()` | `{ t }` | Access `t()` for i18n translations |
| `useCollapsedGroups(groups, namespace, defaults)` | `{ isGroupCollapsed, toggleGroupCollapsed }` | Manage collapsible navigation groups |

### Navigation & Data Hooks (from `@rebasepro/cms`)

| Hook | Package | Description |
|------|---------|-------------|
| `useSidePanel()` | `@rebasepro/cms` | Open/close entity side panels |
| `useNavigationStateController()` | `@rebasepro/cms` | Navigate between views |
| `useUrlController()` | `@rebasepro/cms` | Build URLs and navigate |
| `useBreadcrumbsController()` | `@rebasepro/cms` | Set breadcrumbs |
| `useRebaseRegistry()` | `@rebasepro/app` | Access the full registry (CMS + Studio + Auth configs) |
| `useRebaseClient()` | `@rebasepro/app` | Access the `RebaseClient` instance |

### ModeController (Color Theme)

```typescript
interface ModeController {
    mode: "light" | "dark";
    setMode: (mode: "light" | "dark" | "system") => void;
}

// Usage
const { mode, setMode } = useModeController();
setMode("dark");     // Force dark mode
setMode("system");   // Follow OS preference
```

### useClipboard

```typescript
interface UseClipboardProps {
    onSuccess?: (text: string) => void;
    onError?: (error: string) => void;
    disableClipboardAPI?: boolean;
    copiedDuration?: number;  // ms before isCoppied resets to false
}

const { copy, cut, isCoppied, clipboard, clearClipboard, ref, isSupported } = useClipboard({
    copiedDuration: 2000
});

// Copy text directly
copy("Hello world");

// Copy from a ref
<input ref={ref} />
<button onClick={() => copy()}>Copy</button>
```

### usePermissions

```typescript
const { canCreate, canEdit, canDelete, canRead } = usePermissions();

// Check if current user can create in a collection
if (canCreate(myCollection, "products")) { ... }

// Check if current user can edit a specific entity
if (canEdit(myCollection, "products", entity)) { ... }
```

### useRebaseContext

Returns the full context object combining all controllers:

```typescript
const context = useRebaseContext();

// Access any controller
context.authController        // Auth state
context.data                  // Data source
context.storageSource         // File storage
context.snackbarController    // Toast notifications
context.effectiveRoleController // Role simulation
context.databaseAdmin         // Database admin capabilities
context.client                // RebaseClient instance
```

## RebaseShell Configuration

`<RebaseShell>` composes all CMS layers with sensible defaults:

```typescript
interface RebaseShellProps {
    title?: string;              // App title (default: "Rebase")
    appBar?: React.ReactNode;    // Custom app bar
    drawer?: React.ReactNode;    // Custom drawer
    autoOpenDrawer?: boolean;    // Expand the drawer on hover (default: true)
    children?: React.ReactNode;  // Additional route content
}
```

Internally it composes:
```
<RebaseAuthGate>
  <RebaseNavigation>
    <RebaseRouteDefs layout={<RebaseLayout>}>
      {children}
    </RebaseRouteDefs>
  </RebaseNavigation>
</RebaseAuthGate>
```

## Visual Collection Editor

The Studio's collection editor allows non-developers to:
- Add, remove, and reorder fields
- Configure field types and validation
- Set up enum values and relations
- Preview the form layout

Under the hood, it uses **AST manipulation** (via `ts-morph`) to modify the TypeScript collection files — preserving all custom callbacks and code.

### Enabling the Collection Editor

```tsx
// Simple — uses authController.getAuthToken automatically
<RebaseCMS collections={collections} collectionEditor={true} />

// With options
<RebaseCMS
    collections={collections}
    collectionEditor={{
        getAuthToken: authController.getAuthToken,
        readOnly: false,
        pathSuggestions: ["config/collections/"]
    }}
/>
```

## Virtual Collection Import

Collections are auto-loaded via a Vite plugin:

```typescript
import { collections } from "virtual:rebase-collections";
```

This reads all collection files from the configured collections directory (e.g., `config/collections/`) and makes them available without manual barrel exports.

## Running the Studio

```bash
# From the project root
pnpm run dev
```

This starts both frontend and backend. The Studio is accessible at `http://localhost:5173` (Vite default).

## Key Packages

| Package | Description |
|---------|-------------|
| `@rebasepro/app` | Core framework, hooks, types, `<Rebase>` provider |
| `@rebasepro/studio` | Studio admin panel (`<RebaseStudio>`, `StudioHomePage`, bridge hooks) |
| `@rebasepro/cms` | CMS frontend (`<RebaseCMS>`, `<RebaseShell>`, `CollectionPanel`, collection editor) |
| `@rebasepro/ui` | Component library (Tailwind v4 + Radix) |
| `@rebasepro/types` | Shared TypeScript types |
| `@rebasepro/plugin-ai` | AI-powered autofill |
| `@rebasepro/inference` | Auto-infer schema from data |

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
- **Icons:** [rebase.pro/docs/ui/icons](https://rebase.pro/docs/ui/icons) (Lucide-based)
