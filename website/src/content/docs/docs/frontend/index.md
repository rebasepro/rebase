---
title: Frontend Overview
sidebar_label: Frontend
description: Build and customize the Rebase admin panel with React — controllers, scaffold, routing, and views.
---

## Overview

The Rebase frontend is a **React framework** that renders your admin panel. It reads your collection definitions and generates tables, forms, navigation, and routing automatically.

In the default scaffold, the admin panel **is** the frontend: it's served at the root of your deployed URL. If you build your own product app instead, you can mount the admin under a prefix like `/admin` in the same deployment — see [Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

The key components that make up a Rebase frontend:

```tsx
<Rebase
    client={rebaseClient}
    authController={authController}
>
    {({ loading }) => (
        <Scaffold>
            <AppBar />
            <Drawer title="My App" />
            <Outlet />
            <SideDialogs />
        </Scaffold>
    )}
</Rebase>
```

## The Rebase Provider

`<Rebase>` is the root provider that makes all Rebase functionality available to child components via context. It accepts:

| Prop | Description |
|------|-------------|
| `client` | `RebaseClient` instance for data, auth, and storage |
| `authController` | Authentication state and methods |
| `dataSources` | Additional data sources (see [Multiple sources](/docs/backend/multiple-sources)) |
| `storageSource` / `storageSources` | File storage operations, and named storage sources |
| `userConfigPersistence` | Local UI preferences (column widths, etc.) |
| `entityViews` | Global custom entity view tabs |
| `entityActions` | Global entity actions |
| `plugins` | Plugin instances |
| `slots` | Slot contributions declared directly, without a plugin |
| `basePath` / `baseCollectionPath` | URL prefixes when the admin is not at the site root |
| `components` | Component overrides |

The navigation, URL and collection-registry controllers are **not** `<Rebase>`
props — they are built by the hooks below and consumed inside the admin tree
(`<RebaseShell>` wires them for you in the default scaffold).

## Two data shapes

There are two data layers, and they are **not** interchangeable. Passing one
where the other is expected is a type error, so this is worth knowing before you
wire a controller by hand.

| | Shape | Where you get it | What a row looks like |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — flat rows | `client.data`, and `context.data` in backend callbacks | `row.title` |
| **Admin** | `RebaseData` — `Entity` view-model | `useData()`, inside the `<Rebase>` tree | `entity.values.title` |

The SDK layer is the public, symmetric surface: identical on the frontend client
and in backend callbacks. The `Entity` layer is the admin's view-model — it adds
the `id` / `path` / `values` wrapper that the collection views and forms render
against. `CollectionAccessor` and `FindResponse` belong to it and are marked
`@internal` for that reason.

`<Rebase>` is the boundary between them: it takes your flat `client.data` and
wraps it with `wrapAsEntityData()` before providing it as the admin's
`RebaseData`. You never call that yourself — you just take the shape you need
from the right place:

```tsx
// Flat rows — anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Entity view-model — inside the <Rebase> tree only.
// `data.posts` also works at runtime; `collection()` is the typed accessor.
const data = useData();
const { data: entities } = await data.collection("posts").find();
entities[0].values.title;
```

## Controllers

Controllers are React hooks that configure specific aspects of the framework:

### `useBuildNavigationStateController`

The main controller that wires everything together:

Its `data` is the **Entity-shaped** `RebaseData`, so it comes from `useData()`
— not from `rebaseClient.data`, which is the flat-row SDK layer. `<Rebase>`
converts one to the other for you (see [Two data shapes](#two-data-shapes)
below), so this hook must be called inside the `<Rebase>` tree.

```typescript
const data = useData();

const navigationStateController = useBuildNavigationStateController({
    collections: () => [...collections],  // Collection definitions
    views: customViews,                   // Custom navigation views
    plugins,                              // Plugin instances
    authController,
    data,
    collectionRegistryController,
    urlController,
    adminMode: adminModeController.mode
});
```

### `useBuildCollectionRegistryController`

Manages how collections are resolved from URL paths:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

### `useBuildUrlController`

Configures URL generation:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

### `useBuildModeController`

Manages light/dark theme:

```typescript
const modeController = useBuildModeController();
// Provides: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

### `useBuildAdminModeController`

Toggles between Studio and Content modes:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("studio" | "content")
```

## Scaffold Components

| Component | Description |
|-----------|-------------|
| `<Scaffold>` | Main layout container with responsive sidebar |
| `<AppBar>` | Top navigation bar with search, mode toggle, user menu |
| `<Drawer>` | Side navigation with collection list and view links |
| `<SideDialogs>` | Container for side panel entity editors |
| `<RebaseRoutes>` | Route container that integrates with React Router |
| `<RebaseRoute>` | Handles collection routes (`/c/*`) |
| `<ContentHomePage>` | Default home page showing collection cards |
| `<StudioHomePage>` | Studio mode home page with developer tools |

## Custom Views

Add top-level navigation views for dashboards, tools, or custom pages:

```tsx
const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        view: <MyDashboard />
    },
    {
        slug: "settings",
        name: "App Settings",
        view: <AppSettings />,
        nestedRoutes: true,   // Support sub-paths
        admin: {
            icon: "settings",
            group: "Analytics"
        }
    }
];

```

## Styling

Rebase uses **Tailwind CSS v4** and supports light/dark modes. Customize via:

- **CSS custom properties** — Override design tokens
- **`ModeControllerProvider`** — Control light/dark mode
- **Tailwind config** — Standard Tailwind customization

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Next Steps

- **[Custom Fields](/docs/frontend/custom-fields)** — Build custom form fields
- **[Entity Views](/docs/frontend/entity-views)** — Add tabs to entity editors
- **[View Modes](/docs/frontend/view-modes)** — List, Table, Cards, Kanban
- **[Plugins](/docs/plugins)** — Extend the framework
