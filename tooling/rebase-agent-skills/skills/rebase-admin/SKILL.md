---
name: rebase-admin
description: Guide for navigating the Rebase admin panel, opening entities in side drawers, building URLs, embedding collection panels, using the collection registry, and programmatic navigation. Use this skill when an agent or user needs to navigate to a collection view, open an entity in the side panel/drawer, build admin URLs, embed a collection inside a custom page, use the entity selection dialog, or access admin-specific controllers.
---

# Rebase Admin (`@rebasepro/cms`)

The `@rebasepro/cms` package provides the admin-panel layer for Rebase. It handles collection views, entity editing, navigation, side panels (drawers), URL routing, breadcrumbs, and the full admin context. This skill covers the **programmatic APIs** for navigating and interacting with the admin.

> **IMPORTANT FOR AGENTS:** All hooks in this skill must be called **inside** the `<RebaseShell>` component tree. They rely on React contexts provided by `<RebaseNavigation>`, `<SidePanelProvider>`, and `<RebaseRouteDefs>`.

> **Building the view itself?** This skill covers navigation and admin plumbing. For what the view should *look* like, read the **`rebase-design-language`** skill first — custom views render inside the admin shell and must match it. It ships whole-view skeletons and points at the live UI reference at `/debug/ui`.

## Quick Reference — Common Tasks

| Task | Hook / Component | Package |
|------|-----------------|---------|
| Open entity in side drawer | `useSidePanel()` | `@rebasepro/cms` |
| Navigate to a collection view | `useUrlController()` | `@rebasepro/cms` |
| Look up a collection by slug | `useCollectionRegistryController()` | `@rebasepro/cms` |
| Embed a collection in a custom page | `<CollectionPanel>` | `@rebasepro/cms` |
| Add custom top-level views | `<RebaseCMS views={[...]}>` | `@rebasepro/cms` |
| Replace how one property is edited or shown | `admin: { Field, Preview }` | see §12 |
| Open an entity selection dialog | `useSelectionDialog()` | `@rebasepro/cms` |
| Open a custom side dialog | `useSideDialogsController()` | `@rebasepro/cms` |
| Set breadcrumbs | `useBreadcrumbsController()` | `@rebasepro/cms` |
| Access full admin context | `useAdminContext()` | `@rebasepro/cms` |
| Access navigation state & views | `useNavigationStateController()` | `@rebasepro/cms` |

---

## 1. Opening Entities in the Side Drawer

Use `useSidePanel()` to open, replace, or close entity side panels (the sliding drawer that shows entity forms).

```typescript
import { useSidePanel } from "@rebasepro/cms";
```

### SidePanelController Interface

```tsx
interface SidePanelController {
    /** Close the last (topmost) panel */
    close: () => void;

    /** Open a new entity side panel */
    open: <M extends Record<string, unknown>>(props: EntitySidePanelProps<M>) => void;

    /** Replace the last open panel with a new one */
    replace: <M extends Record<string, unknown>>(props: EntitySidePanelProps<M>) => void;
}
```

### EntitySidePanelProps

```typescript
interface EntitySidePanelProps<M extends Record<string, unknown> = Record<string, unknown>> {
    /** Absolute path of the entity's collection (e.g. "products") */
    path: string;

    /** ID of the entity. Omit to create a new entity. */
    entityId?: string | number;

    /** Set to true to create a copy of an existing entity */
    copy?: boolean;

    /** Open with a specific sub-collection tab selected */
    selectedTab?: string;

    /** Override the width of the form panel (e.g. "600px") */
    width?: number | string;

    /** Explicit collection config (auto-resolved from navigation if omitted) */
    collection?: CollectionConfig<M>;

    /** Whether to update the browser URL when opening (default: true) */
    updateUrl?: boolean;

    /** Callback when the entity is saved/updated */
    onUpdate?: (params: { entity: Entity<M> }) => void;

    /** Callback when the panel is closed */
    onClose?: () => void;

    /** Close the panel automatically after saving */
    closeOnSave?: boolean;

    /** Override form properties */
    formProps?: Record<string, unknown>;

    /** Show a full-screen toggle button */
    allowFullScreen?: boolean;

    /** Pre-populate form values when creating a new entity (only when entityId is not set) */
    defaultValues?: Partial<M>;
}
```

### Examples

**Open an existing entity for editing:**
```tsx
const sidePanel = useSidePanel();

// Open the product with ID "abc123" in the side drawer
sidePanel.open({
    path: "products",
    entityId: "abc123"
});
```

**Create a new entity with pre-filled values:**
```tsx
sidePanel.open({
    path: "products",
    defaultValues: {
        name: "New Product",
        status: "draft"
    }
});
```

**Open with a callback on save:**
```tsx
sidePanel.open({
    path: "orders",
    entityId: orderId,
    closeOnSave: true,
    onUpdate: ({ entity }) => {
        console.log("Saved:", entity.id, entity.values);
    }
});
```

**Replace the current panel (instead of stacking):**
```tsx
sidePanel.replace({
    path: "clients",
    entityId: "xyz789"
});
```

---

## 2. Navigating to Collection Views

Use `useUrlController()` to build URLs and navigate programmatically within the admin.

```typescript
import { useUrlController } from "@rebasepro/cms";
```

### UrlController Interface

```typescript
type UrlController = {
    /** Base path for the admin (default: "/") */
    basePath: string;

    /** Base path for collection routes (default: "/c") */
    baseCollectionPath: string;

    /** Convert a URL path to a data path: "/c/products" → "products" */
    urlPathToDataPath: (cmsPath: string) => string;

    /** Base URL for the home screen */
    homeUrl: string;

    /** Check if a URL path belongs to a collection */
    isUrlCollectionPath: (urlPath: string) => boolean;

    /** Build a URL for a collection: "products" → "/c/products" */
    buildUrlCollectionPath: (path: string) => string;

    /** Build a URL for a custom view or app path */
    buildAppUrlPath: (path: string) => string;

    /** Resolve collection IDs in a path to database paths */
    resolveDatabasePathsFrom: (path: string) => string;

    /** Navigate to a route (wraps react-router's navigate) */
    navigate: (to: string, options?: NavigateOptions) => void;
};
```

### Examples

**Navigate to a collection view:**
```tsx
const urlController = useUrlController();

// Navigate to the "products" collection
const url = urlController.buildUrlCollectionPath("products");
urlController.navigate(url);
// This navigates to "/c/products"
```

**Navigate to a specific entity within a collection:**
```tsx
const url = urlController.buildUrlCollectionPath("products/abc123");
urlController.navigate(url);
// This navigates to "/c/products/abc123"
```

**Navigate to a custom view:**
```tsx
const url = urlController.buildAppUrlPath("my-dashboard");
urlController.navigate(url);
```

**Navigate and replace history (no back button):**
```tsx
urlController.navigate(
    urlController.buildUrlCollectionPath("orders"),
    { replace: true }
);
```

**Navigate to home:**
```tsx
urlController.navigate(urlController.homeUrl);
```

> **IMPORTANT FOR AGENTS:** The URL structure is `basePath + baseCollectionPath + "/" + slug`. By default this produces `/c/products`. Use `buildUrlCollectionPath()` instead of manually constructing URLs.

---

## 3. Collection Registry

Use `useCollectionRegistryController()` to look up registered collections by slug.

```typescript
import { useCollectionRegistryController } from "@rebasepro/cms";
```

### CollectionRegistryController Interface

```tsx
type CollectionRegistryController<
    DB = Record<string, unknown>,
    EC extends CollectionConfig = CollectionConfig
> = {
    /** All registered collections */
    collections?: CollectionConfig[];

    /** Whether the registry is ready */
    initialised: boolean;

    /** Get a collection by slug or path */
    getCollection: <K extends keyof DB>(slugOrPath: Extract<K, string>, includeUserOverride?: boolean) => EC | undefined;

    /** Get the raw (un-normalized) collection config — for the Visual Editor only */
    getRawCollection: (slugOrPath: string) => EC | undefined;

    /** Get all parent entity references for a path */
    getParentReferencesFromPath: (path: string) => EntityReference[];

    /** Get parent collection slugs for a path */
    getParentCollectionSlugs: (path: string) => string[];

    /** Get parent entity IDs for a path */
    getParentEntityIds: (path: string) => string[];

    /** Resolve IDs to paths */
    convertIdsToPaths: (ids: string[]) => string[];
};
```

### Example

```tsx
const registry = useCollectionRegistryController();

// Check if a collection exists
const products = registry.getCollection("products");
if (products) {
    console.log("Collection name:", products.name);
    console.log("Properties:", Object.keys(products.properties));
}

// List all collections
registry.collections?.forEach(c => {
    console.log(c.slug, c.name);
});
```

---

## 4. Embedding Collections with CollectionPanel

`CollectionPanel` is a high-level wrapper for embedding collection views inside custom pages (dashboards, home pages, entity detail views).

```typescript
import { CollectionPanel } from "@rebasepro/cms";
```

### CollectionPanelProps

```typescript
type CollectionPanelProps = {
    /** Collection slug to display (e.g. "tasks") — required */
    path: string;

    /** Title above the collection. `false` to hide. Defaults to collection name. */
    title?: string | false;

    /** Force a view mode (table, card, etc.) */
    viewMode?: ViewMode;

    /** Override sort: [fieldName, direction] */
    sort?: [string, "asc" | "desc"];

    /** Max entities to display */
    limit?: number;

    /** Sync filter/sort with URL params (default: false) */
    updateUrl?: boolean;

    /** Entity open mode when clicking */
    openEntityMode?: "side_panel" | "full_screen" | "split" | "dialog";

    /** Container CSS class */
    className?: string;

    /** Additional collection-level overrides */
    collectionOverrides?: Partial<CollectionConfig>;
};
```

### Examples

```tsx
// Simple embedded collection
<CollectionPanel path="tasks" title="Pending Tasks" />

// Table with sorting and limit
<CollectionPanel
    path="clients"
    viewMode="table"
    limit={10}
    sort={["createdAt", "desc"]}
/>

// With a default filter
<CollectionPanel
    path="orders"
    title={false}
    openEntityMode="dialog"
    collectionOverrides={{
        defaultFilter: { status: ["!=", "completed"] }
    }}
/>
```

> **IMPORTANT FOR AGENTS:** `CollectionPanel` defaults `updateUrl` to `false` so embedded panels don't hijack the browser URL. Only set `updateUrl={true}` if you explicitly need URL sync.

---

## 5. Entity Selection Dialog

Use `useSelectionDialog()` to open a side dialog for selecting entities (same mechanism used by reference fields).

```typescript
import { useSelectionDialog } from "@rebasepro/cms";
```

### Usage

```tsx
function MyComponent() {
    const { open, close } = useSelectionDialog<Product>({
        path: "products",
        onSingleEntitySelected: (entity) => {
            console.log("Selected:", entity?.id);
            close();
        }
    });

    return <Button onClick={open}>Select Product</Button>;
}
```

The hook accepts all `SelectionProps` except `path` (which you pass separately), plus an `onClose` callback.

---

## 6. Side Dialogs (Generic)

Use `useSideDialogsController()` to open arbitrary side panels with custom React content. This is the lower-level mechanism behind entity side panels.

```typescript
import { useSideDialogsController } from "@rebasepro/cms";
```

### SideDialogsController Interface

```typescript
interface SideDialogsController {
    /** Close the last panel */
    close: () => void;

    /** Currently open panels */
    sidePanels: SideDialogPanelProps[];

    /** Override all panels */
    setSidePanels: (panels: SideDialogPanelProps[]) => void;

    /** Open one or multiple side panels */
    open: (panelProps: SideDialogPanelProps | SideDialogPanelProps[]) => void;

    /** Replace the last panel */
    replace: (panelProps: SideDialogPanelProps | SideDialogPanelProps[]) => void;
}
```

### SideDialogPanelProps

```typescript
interface SideDialogPanelProps {
    /** Unique key identifying this panel */
    key: string;

    /** React component to render inside the panel */
    component: React.ReactNode;

    /** Optional panel width (e.g. "90vw", "600px") */
    width?: string;

    /** When open, update the browser URL to this path */
    urlPath?: string;

    /** URL to navigate to when the panel is closed and there's no history */
    parentUrlPath?: string;

    /** Callback when the panel is closed */
    onClose?: () => void;

    /** Store additional data on the panel */
    additional?: unknown;
}
```

### Example

```tsx
const sideDialogs = useSideDialogsController();

sideDialogs.open({
    key: "my-custom-panel",
    component: <MyCustomView data={someData} />,
    width: "600px",
    onClose: () => console.log("Panel closed")
});
```

---

## 7. Breadcrumbs

Use `useBreadcrumbsController()` to read or set the breadcrumb trail.

```typescript
import { useBreadcrumbsController } from "@rebasepro/cms";
```

### BreadcrumbsController Interface

```typescript
interface BreadcrumbsController {
    breadcrumbs: BreadcrumbEntry[];
    set: (props: { breadcrumbs: BreadcrumbEntry[] }) => void;
}

interface BreadcrumbEntry {
    title: string;
    url: string;
    // Stable identifier (e.g. the collection path). Lets the provider tell a
    // rebuilt-but-unchanged trail from a real navigation.
    id?: string;
}
```

### Example

```tsx
const breadcrumbs = useBreadcrumbsController();

breadcrumbs.set({
    breadcrumbs: [
        { title: "Dashboard", url: "/" },
        { title: "Products", url: "/c/products", id: "products" },
    ]
});
```

---

## 8. Navigation State

Use `useNavigationStateController()` to access registered views, loading state, and trigger navigation refresh.

```typescript
import { useNavigationStateController } from "@rebasepro/cms";
```

### NavigationStateController Interface

```typescript
type NavigationStateController = {
    /** Custom views added to the main navigation */
    views?: AppView[];

    /** Custom views added to admin navigation */
    adminViews?: AppView[];

    /** Top-level navigation entries and groups */
    topLevelNavigation?: NavigationResult;

    /** Whether navigation is still loading */
    loading: boolean;

    /** Error during navigation loading */
    navigationLoadingError?: unknown;

    /** Force a navigation recalculation */
    refreshNavigation: () => void;

    /** Registered plugins */
    plugins?: RebasePlugin[];
};
```

---

## 9. Admin Context (All-in-One)

Use `useAdminContext()` to get the full admin context combining the core `RebaseContext` with all admin-specific controllers.

```typescript
import { useAdminContext } from "@rebasepro/cms";
```

### AdminContext Type

```typescript
type AdminContext = RebaseContext & {
    sidePanelController: SidePanelController;
    sideDialogsController: SideDialogsController;
    urlController: UrlController;
    navigationStateController: NavigationStateController;
    collectionRegistryController: CollectionRegistryController;
};
```

### Example

```tsx
const context = useAdminContext();

// Access any controller
context.sidePanelController.open({ path: "products", entityId: "abc" });
context.urlController.navigate(context.urlController.buildUrlCollectionPath("orders"));
context.collectionRegistryController.getCollection("products");
context.authController; // from RebaseContext
context.data;           // DataSource from RebaseContext
```

> **TIP:** Use `useAdminContext()` instead of `useRebaseContext()` when you need admin controllers (side panels, navigation, URL). Use `useRebaseContext()` from `@rebasepro/app` when you only need core context (auth, data, storage).

---

## 10. Common Patterns

### Navigate to a collection and open an entity

```tsx
import { useUrlController, useSidePanel } from "@rebasepro/cms";

function navigateAndOpen() {
    const urlController = useUrlController();
    const sidePanel = useSidePanel();

    // First navigate to the collection
    urlController.navigate(urlController.buildUrlCollectionPath("products"));

    // Then open the entity in the side drawer
    sidePanel.open({
        path: "products",
        entityId: "abc123"
    });
}
```

### Open entity from a custom view without navigating

```tsx
import { useSidePanel } from "@rebasepro/cms";

function MyCustomView() {
    const sidePanel = useSidePanel();

    return (
        <button onClick={() => sidePanel.open({
            path: "products",
            entityId: "abc123",
            updateUrl: false  // don't change the URL
        })}>
            View Product
        </button>
    );
}
```

### Programmatic entity creation from a custom view

```tsx
import { useSidePanel } from "@rebasepro/cms";

function CreateButton() {
    const sideEntity = useSidePanel();

    return (
        <button onClick={() => sideEntity.open({
            path: "orders",
            defaultValues: {
                status: "pending",
                createdAt: new Date()
            },
            closeOnSave: true,
            onUpdate: ({ entity }) => {
                console.log("Created order:", entity.id);
            }
        })}>
            New Order
        </button>
    );
}
```

---

## 10. Custom Top-Level Views

Add custom pages to the main admin navigation using the `views` prop on `<RebaseCMS>`. Views appear alongside collections in the sidebar and home page.

### AppView Interface

```typescript
interface AppView {
    slug: string;                    // URL path segment (e.g. "dashboard")
    name: string;                    // Display name in navigation
    view: React.ReactNode;           // Component to render
    icon?: string | React.ReactNode; // Lucide icon key or custom element
    group?: string;                  // Navigation group (default: "Views")
    description?: string;            // Optional description (Markdown)
    hideFromNavigation?: boolean;    // Hidden from sidebar but still routable
    nestedRoutes?: boolean;          // Register slug/* wildcard route
    roles?: string[];                // Only show to users with at least one matching role
}
```

### Static Views

```tsx
<RebaseCMS
    collections={collections}
    views={[
        { slug: "dashboard", name: "Dashboard", icon: "LayoutDashboard", view: <Dashboard /> },
        { slug: "reports",   name: "Reports",   icon: "FileText",        view: <Reports />, group: "Analytics" },
        { slug: "audit-log", name: "Audit Log",  icon: "ScrollText",     view: <AuditLog />, roles: ["admin"] },
    ]}
/>
```

### Builder Function (Role-Aware)

Pass a function instead of an array to dynamically resolve views based on the current user:

```tsx
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

The builder receives `{ user, authController, data }` and can return a `Promise<AppView[]>` for async resolution.

### Plugin-Contributed Views

Plugins can also contribute views via the `views` property on `RebasePlugin`:

```tsx
const myPlugin: RebasePlugin = {
    key: "analytics",
    views: [
        { slug: "analytics", name: "Analytics", icon: "BarChart3", view: <Analytics /> }
    ]
};

// `plugins` is a prop of <Rebase>, NOT of <RebaseCMS>.
<Rebase plugins={[myPlugin]} client={client} authController={authController}>
    {() => <RebaseCMS collections={collections} />}
</Rebase>
```

All views (admin, builder, plugin) are merged in order: **admin views → Studio dev views → Plugin views**.

### Role Filtering

The `roles` field provides declarative access control. When set, the view is excluded entirely (not just hidden from nav) if the user doesn't have at least one matching role:

```tsx
// Only visible to admin users
{ slug: "admin-panel", name: "Admin", view: <AdminPanel />, roles: ["admin"] }

// Visible to admin OR editor
{ slug: "editor", name: "Editor", view: <Editor />, roles: ["admin", "editor"] }

// Visible to everyone (roles omitted)
{ slug: "dashboard", name: "Dashboard", view: <Dashboard /> }
```

> **IMPORTANT FOR AGENTS:** The `roles` filter applies to ALL views — admin views, builder-returned views, and plugin views. Use `roles` for simple role gates and the builder function for dynamic/async conditions. Both compose.

### Navigation Grouping

Views participate in the same navigation group system as collections. Use the `group` property on the view, or control grouping centrally via `navigationGroupMappings`:

```tsx
<RebaseCMS
    collections={collections}
    views={[
        { slug: "dashboard", name: "Dashboard", view: <Dashboard />, group: "Analytics" },
        { slug: "reports",   name: "Reports",   view: <Reports />,   group: "Analytics" },
    ]}
    navigationGroupMappings={[
        { name: "Content",   entries: ["posts", "pages"] },
        { name: "Analytics", entries: ["dashboard", "reports"] },
    ]}
/>
```

---

## 11. Where the Admin Lives — Mounting Under a URL Prefix

In the default scaffold the frontend **is** the admin panel: `App.tsx` renders `<RebaseAuth>` + `<RebaseCMS>` + `<RebaseShell>` at the root, so the deployed URL shows the admin directly. There is no separate admin URL — in production one server serves both the API (`/api/*`) and this SPA.

When a project ships its **own product app** as the frontend, the admin is mounted under a prefix (commonly `/admin`) instead. Split the Vite entry by URL so each app is lazy-loaded and product visitors never download the admin bundle:

```tsx
// frontend/src/main.tsx
const isAdmin = window.location.pathname.startsWith("/admin");
const ProductApp = lazy(() => import("./App"));
const AdminApp = lazy(() => import("./AdminApp"));

if (isAdmin) {
    // The admin uses useBlocker → needs a DATA router
    const router = createBrowserRouter([{ path: "/admin/*", element: <AdminApp /> }]);
    root.render(<RouterProvider router={router} />);
} else {
    root.render(<BrowserRouter><ProductApp /></BrowserRouter>);
}
```

```tsx
// frontend/src/AdminApp.tsx — tell the admin about the prefix
<RebaseCMS collections={collections} basePath="/admin" />
```

> **IMPORTANT FOR AGENTS:** Choose **either** a router `basename="/admin"` **or** `<RebaseCMS basePath="/admin">` — never both, or the prefix is applied twice. Without either, collection views hang on a spinner because URL⇄collection resolution never matches. `<RebaseCMS>` requires a **data router** (`createBrowserRouter`) because it uses `useBlocker`.

---

## 12. Custom Field and Preview Components

To replace how a single property is edited or displayed, point at your component from the property's `admin` block. `Field` is the form editor; `Preview` is the read-only rendering used in table cells and reference previews.

```ts no-verify
// config/collections/exercises.ts — a collection file, which the backend also loads
body_parts: {
    name: "Affected body parts",
    type: "array",
    of: { type: "string", name: "Part", enum: [/* … */] },
    admin: {
        Field: () => import("../../frontend/src/BodyPartsField"),
        Preview: () => import("../../frontend/src/BodyPartsPreview")
    }
}
```

The value is a **lazy import thunk**, and that is deliberate: a collection file is read by the server as well, so it must not import React. The thunk is type-checked at the call site and never called by the backend. The admin resolves it with `React.lazy` on first render. A direct component reference (`Field: MyField`) also works in a file the backend never loads.

The component itself is ordinary React, in `frontend/`:

```tsx
// frontend/src/BodyPartsField.tsx — default-exported, because the thunk resolves
// to the module's `default`.
import type { FieldProps } from "@rebasepro/cms";
import type { ArrayProperty } from "@rebasepro/types";

export default function BodyPartsField({ value, setValue, property, error, disabled }: FieldProps<ArrayProperty>) {
    return null; // …your editor
}
```

```tsx
// frontend/src/BodyPartsPreview.tsx
import type { PropertyPreviewProps } from "@rebasepro/cms";
import type { ArrayProperty } from "@rebasepro/types";

export default function BodyPartsPreview({ value, property, size }: PropertyPreviewProps<ArrayProperty>) {
    return null; // …your read-only rendering
}
```

Read the enum, labels and limits off the `property` argument rather than restating them, so the component cannot drift from the collection.

> **IMPORTANT FOR AGENTS:** the module must have a **default export** — the resolver takes `default` from what the thunk resolves to, and a named-only export renders nothing. A component whose name begins with a capital and takes no props is treated as a component, not a loader, so `Preview: () => null` is a (useless) component while `Preview: () => import("…")` is a loader; the distinction is made on the dynamic import in the body, not the name.

---

## Exported Components

The admin package exports the following components (from `@rebasepro/cms`):

| Component | Description |
|-----------|-------------|
| `RebaseCMS` | Declarative admin config (collections, views, editor) — renders nothing |
| `RebaseShell` | App shell (drawer, nav, routes, layout) — renders the actual UI |
| `CollectionPanel` | Embed a collection view inside custom pages |
| `CollectionViewBinding` | The collection view, bound to Rebase data |
| `CollectionTableBinding` | The table rendering of a collection |
| `CollectionCardViewBinding` | The card/grid rendering of a collection |
| `EntityViewBinding` | Entity detail/edit view |
| `EntityPreviewBinding` | Reference/relation preview chip |
| `EntityCardBinding` | Card representation of an entity |
| `SelectionTableBinding` / `SelectableTable` | Table for selecting entities |
| `SideDialogs` | Side dialog container |
| `SidePanelProvider` | Context provider for the side panel controller |
| `Scaffold` | Layout scaffold component |
| `AppBar` | Top app bar |
| `Drawer` / `DefaultDrawer` | Sidebar drawer |
| `RebaseAuthGate` | Auth-gated wrapper |
| `RebaseNavigation` | Navigation provider |
| `RebaseLayout` | Layout wrapper |
| `RebaseRouteDefs` | Route definitions |

> **IMPORTANT FOR AGENTS: a component-override *slot name* is not an export.**
> `"DetailView"`, `"EntityPreview"`, `"Collection.View"`, `"Collection.Table"`,
> `"Collection.Card"`, `"Entity.Form"`, `"Entity.SidePanel"` and
> `"Entity.MissingReference"` are string keys in the `OverridableComponentName`
> union — what you pass to `components={{ … }}` to *replace* a component. There
> is no `import { EntityPreview } from "@rebasepro/cms"`; the component that
> ships is `EntityPreviewBinding`. Importing a slot name gets you `undefined`.

## Exported Hooks

| Hook | Description |
|------|-------------|
| `useSidePanel()` | Open/close entity side panels |
| `useSideDialogsController()` | Open/close generic side dialogs |
| `useUrlController()` | Build URLs and navigate |
| `useNavigationStateController()` | Access navigation state |
| `useCollectionRegistryController()` | Look up collections by slug |
| `useBreadcrumbsController()` | Read/set breadcrumbs |
| `useAdminContext()` | Full admin context (core + admin controllers) |
| `useSelectionDialog()` | Open entity selection dialog |
| `useSelectionController()` | Multi-select controller |
| `useHistory()` | Entity version history |
| `useApp()` | App-level utilities |

## Exported Utilities

| Utility | Description |
|---------|-------------|
| `addInitialSlash(path)` | Ensure path starts with `/` |
| `removeInitialSlash(path)` | Strip leading `/` |
| `removeTrailingSlash(path)` | Strip trailing `/` |
| `removeInitialAndTrailingSlashes(path)` | Strip both |
| `getLastSegment(path)` | Get last path segment |
| `getCollectionBySlugWithin(collections, slug)` | Find collection in array |
| `mergeEntityActions(...)` | Merge entity action arrays |
| `resolveEntityAction(...)` | Resolve an entity action |
| `resolveEntityView(...)` | Resolve an entity view |
| `isReferenceProperty(prop)` | Check if property is a reference |
| `isRelationProperty(prop)` | Check if property is a relation |
| `getIconForProperty(prop)` | Get icon for a property type |

## Built-in Entity Actions

```typescript
import {
    editEntityAction,
    copyEntityAction,
    deleteEntityAction,
    resetPasswordAction
} from "@rebasepro/cms";
```

These are pre-built `EntityAction` objects that can be added to a collection's `entityActions` array.
