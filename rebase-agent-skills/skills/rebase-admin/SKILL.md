---
name: rebase-admin
description: Guide for navigating the Rebase admin CMS, opening entitys in side drawers, building URLs, embedding collection panels, using the collection registry, and programmatic navigation. Use this skill when an agent or user needs to navigate to a collection view, open a entity in the side panel/drawer, build admin URLs, embed a collection inside a custom page, use the entity selection dialog, or access CMS-specific controllers.
---

# Rebase Admin (`@rebasepro/admin`)

The `@rebasepro/admin` package provides the CMS layer for Rebase. It handles collection views, entity editing, navigation, side panels (drawers), URL routing, breadcrumbs, and the full CMS context. This skill covers the **programmatic APIs** for navigating and interacting with the admin.

> **IMPORTANT FOR AGENTS:** All hooks in this skill must be called **inside** the `<RebaseShell>` component tree. They rely on React contexts provided by `<RebaseNavigation>`, `<SideEntityProvider>`, and `<RebaseRouteDefs>`.

## Quick Reference — Common Tasks

| Task | Hook / Component | Package |
|------|-----------------|---------|
| Open entity in side drawer | `useSidePanel()` | `@rebasepro/admin` |
| Navigate to a collection view | `useUrlController()` | `@rebasepro/admin` |
| Look up a collection by slug | `useCollectionRegistryController()` | `@rebasepro/admin` |
| Embed a collection in a custom page | `<CollectionPanel>` | `@rebasepro/admin` |
| Add custom top-level views | `<RebaseCMS views={[...]}>` | `@rebasepro/admin` |
| Open a entity selection dialog | `useSelectionDialog()` | `@rebasepro/admin` |
| Open a custom side dialog | `useSideDialogsController()` | `@rebasepro/admin` |
| Set breadcrumbs | `useBreadcrumbsController()` | `@rebasepro/admin` |
| Access full CMS context | `useCMSContext()` | `@rebasepro/admin` |
| Access navigation state & views | `useNavigationStateController()` | `@rebasepro/admin` |

---

## 1. Opening Entitys in the Side Drawer

Use `useSidePanel()` to open, replace, or close entity side panels (the sliding drawer that shows entity forms).

```typescript
import { useSidePanel } from "@rebasepro/admin";
```

### SidePanelController Interface

```typescript
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
const sideEntityController = useSidePanel();

// Open the product with ID "abc123" in the side drawer
sideEntityController.open({
    path: "products",
    entityId: "abc123"
});
```

**Create a new entity with pre-filled values:**
```tsx
sideEntityController.open({
    path: "products",
    defaultValues: {
        name: "New Product",
        status: "draft"
    }
});
```

**Open with a callback on save:**
```tsx
sideEntityController.open({
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
sideEntityController.replace({
    path: "clients",
    entityId: "xyz789"
});
```

---

## 2. Navigating to Collection Views

Use `useUrlController()` to build URLs and navigate programmatically within the admin.

```typescript
import { useUrlController } from "@rebasepro/admin";
```

### UrlController Interface

```typescript
type UrlController = {
    /** Base path for the CMS (default: "/") */
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
import { useCollectionRegistryController } from "@rebasepro/admin";
```

### CollectionRegistryController Interface

```typescript
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
import { CollectionPanel } from "@rebasepro/admin";
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

    /** Max entitys to display */
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

Use `useSelectionDialog()` to open a side dialog for selecting entitys (same mechanism used by reference fields).

```typescript
import { useSelectionDialog } from "@rebasepro/admin";
```

### Usage

```tsx
function MyComponent() {
    const { open, close } = useSelectionDialog<Product>({
        path: "products",
        onSingleEntitySelected: (entity) => {
            console.log("Selected:", entity.id);
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
import { useSideDialogsController } from "@rebasepro/admin";
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
import { useBreadcrumbsController } from "@rebasepro/admin";
```

### BreadcrumbsController Interface

```typescript
interface BreadcrumbsController {
    breadcrumbs: BreadcrumbEntry[];
    set: (props: { breadcrumbs: BreadcrumbEntry[] }) => void;
    updateCount: (id: string, count: number | null | undefined) => void;
}

interface BreadcrumbEntry {
    title: string;
    url: string;
    count?: number | null;  // undefined = N/A, null = loading, number = loaded
    id?: string;            // for targeted count updates
}
```

### Example

```tsx
const breadcrumbs = useBreadcrumbsController();

breadcrumbs.set({
    breadcrumbs: [
        { title: "Dashboard", url: "/" },
        { title: "Products", url: "/c/products", id: "products", count: null },
    ]
});

// Later, update the count without re-setting everything
breadcrumbs.updateCount("products", 42);
```

---

## 8. Navigation State

Use `useNavigationStateController()` to access registered views, loading state, and trigger navigation refresh.

```typescript
import { useNavigationStateController } from "@rebasepro/admin";
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

## 9. CMS Context (All-in-One)

Use `useCMSContext()` to get the full CMS context combining the core `RebaseContext` with all CMS-specific controllers.

```typescript
import { useCMSContext } from "@rebasepro/admin";
```

### CMSContext Type

```typescript
type CMSContext = RebaseContext & {
    sideEntityController: SidePanelController;
    sideDialogsController: SideDialogsController;
    urlController: UrlController;
    navigationStateController: NavigationStateController;
    collectionRegistryController: CollectionRegistryController;
};
```

### Example

```tsx
const context = useCMSContext();

// Access any controller
context.sideEntityController.open({ path: "products", entityId: "abc" });
context.urlController.navigate(context.urlController.buildUrlCollectionPath("orders"));
context.collectionRegistryController.getCollection("products");
context.authController; // from RebaseContext
context.data;           // DataSource from RebaseContext
```

> **TIP:** Use `useCMSContext()` instead of `useRebaseContext()` when you need CMS controllers (side panels, navigation, URL). Use `useRebaseContext()` from `@rebasepro/core` when you only need core context (auth, data, storage).

---

## 10. Common Patterns

### Navigate to a collection and open a entity

```tsx
import { useUrlController, useSidePanel } from "@rebasepro/admin";

function navigateAndOpen() {
    const urlController = useUrlController();
    const sideEntityController = useSidePanel();

    // First navigate to the collection
    urlController.navigate(urlController.buildUrlCollectionPath("products"));

    // Then open the entity in the side drawer
    sideEntityController.open({
        path: "products",
        entityId: "abc123"
    });
}
```

### Open entity from a custom view without navigating

```tsx
import { useSidePanel } from "@rebasepro/admin";

function MyCustomView() {
    const sideEntityController = useSidePanel();

    return (
        <button onClick={() => sideEntityController.open({
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
import { useSidePanel } from "@rebasepro/admin";

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

Add custom pages to the main CMS navigation using the `views` prop on `<RebaseCMS>`. Views appear alongside collections in the sidebar and home page.

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

<RebaseCMS plugins={[myPlugin]} />
```

All views (CMS, builder, plugin) are merged in order: **CMS views → Studio dev views → Plugin views**.

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

> **IMPORTANT FOR AGENTS:** The `roles` filter applies to ALL views — CMS views, builder-returned views, and plugin views. Use `roles` for simple role gates and the builder function for dynamic/async conditions. Both compose.

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

## Exported Components

The admin package exports the following components (from `@rebasepro/admin`):

| Component | Description |
|-----------|-------------|
| `RebaseCMS` | Declarative CMS config (collections, views, editor) — renders nothing |
| `RebaseShell` | App shell (drawer, nav, routes, layout) — renders the actual UI |
| `CollectionPanel` | Embed a collection view inside custom pages |
| `DataCollectionView` | The collection view component |
| `EntityCustomView` | Entity detail/edit view |
| `EntityPreview` | Reference/relation preview chip |
| `EntityCard` | Card representation of a entity |
| `SideDialogs` | Side dialog container |
| `SideEntityProvider` | Context provider for side entity controller |
| `EntitySelectionTable` | Table for selecting entitys |
| `Scaffold` | Layout scaffold component |
| `AppBar` | Top app bar |
| `Drawer` / `DefaultDrawer` | Sidebar drawer |
| `RebaseAuthGate` | Auth-gated wrapper |
| `RebaseNavigation` | Navigation provider |
| `RebaseLayout` | Layout wrapper |
| `RebaseRouteDefs` | Route definitions |

## Exported Hooks

| Hook | Description |
|------|-------------|
| `useSidePanel()` | Open/close entity side panels |
| `useSideDialogsController()` | Open/close generic side dialogs |
| `useUrlController()` | Build URLs and navigate |
| `useNavigationStateController()` | Access navigation state |
| `useCollectionRegistryController()` | Look up collections by slug |
| `useBreadcrumbsController()` | Read/set breadcrumbs |
| `useCMSContext()` | Full CMS context (core + CMS controllers) |
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
| `resolveEntityAction(...)` | Resolve a entity action |
| `resolveEntityView(...)` | Resolve a entity view |
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
} from "@rebasepro/admin";
```

These are pre-built `EntityAction` objects that can be added to a collection's `entityActions` array.
