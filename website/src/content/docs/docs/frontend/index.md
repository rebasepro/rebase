---
title: Frontend Overview
sidebar_label: Frontend
description: Build and customize the Rebase admin panel with React — controllers, scaffold, routing, and views.
---

## Overview

The Rebase frontend is a **React framework** that renders your admin panel. It reads your collection definitions and generates tables, forms, navigation, and routing automatically.

In the default scaffold, the admin panel **is** the frontend: it's served at the root of your deployed URL. If you build your own product app instead, you can mount the admin under a prefix like `/admin` in the same deployment — see [Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

This is `frontend/src/App.tsx` as `rebase init` writes it — the whole admin
panel, four declarations inside one provider:

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            {/* Sign-in screen. Pass `loginView` to replace it. */}
            <RebaseAuth/>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

The first three render nothing: they *register* configuration into the
provider. `<RebaseShell>` is what draws — it reads that registry and builds the
navigation, routes and layout from it. So the order they appear in does not
matter, and adding a feature means adding a component, not rewiring a tree.

| Component | Package | Registers |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | the sign-in screen (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | collections, custom views, the home page, the collection editor |
| `<RebaseStudio>` | `@rebasepro/studio` | the developer tools (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nothing — it renders the admin from everything above |

Drop `<RebaseStudio>` and you have a content-only CMS; drop `<RebaseCMS>` and
you have the developer tools alone. To lay the shell out by hand instead, see
[Advanced: manual layout](#advanced-manual-layout).

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
| `components` | Component overrides |

The navigation, URL and collection-registry controllers are **not** `<Rebase>`
props — they are built by the hooks below and consumed inside the admin tree
(`<RebaseShell>` wires them for you in the default scaffold).

Neither is the URL prefix. When the admin is mounted under a path, that belongs
on `<RebaseCMS basePath="/admin">`, which is what resolves URLs to collections —
and only when the router has no `basename` of its own. See
[Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

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

## Advanced: manual layout

Everything below replaces `<RebaseShell>`. You need it only when the stock
layout is in the way — a different chrome around the admin, a route tree of
your own, an app where the admin is one page among many. If you are not
replacing the layout, stop at [Custom Views](#custom-views).

`<RebaseShell>` is sugar for four layers, and you can take them one at a time:

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>

    {/* login screen until there is a user */}
    <RebaseAuthGate>
        {/* builds the navigation, URL and collection-registry controllers */}
        <RebaseNavigation>
            {/* the admin's routes, drawn inside the layout you pass */}
            <RebaseRouteDefs layout={<RebaseLayout title="My App"/>}/>
        </RebaseNavigation>
    </RebaseAuthGate>
</Rebase>
```

The order is fixed: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
RebaseLayout`. `RebaseAuthGate` shows the login view until there is a user, so
nothing below it renders for a signed-out visitor; `RebaseNavigation` builds
the navigation, URL and collection-registry controllers that `RebaseRouteDefs`
and every collection view read, so `RebaseRouteDefs` outside it throws.

Each layer is usable on its own. `<RebaseAuthGate>` alone gates your own app
behind Rebase's login. Swap `<RebaseLayout>` for your own component to keep the
routing and lose the chrome; drop `<RebaseRouteDefs>` too and you are building
the routes yourself out of the components in
[Scaffold Components](#scaffold-components).

Below that floor `<Rebase>` also accepts a **render prop** instead of children,
which hands you the context and the loading flag and leaves the entire tree to
you:

```tsx
<Rebase client={rebaseClient} authController={authController}>
    {({ context, loading }) => (
        <Scaffold>
            <AppBar/>
            <Drawer title="My App"/>
            <Outlet/>
            <SideDialogs/>
        </Scaffold>
    )}
</Rebase>
```

At that point nothing is wired for you: you build the controllers below by
hand and render the routes yourself.

### Controllers

Controllers are React hooks that configure specific aspects of the framework.
`<RebaseNavigation>` calls all of them for you — reach for these only inside a
render prop.

#### `useBuildNavigationStateController`

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

#### `useBuildCollectionRegistryController`

Manages how collections are resolved from URL paths:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

#### `useBuildUrlController`

Configures URL generation:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

#### `useBuildModeController`

Manages light/dark theme:

```typescript
const modeController = useBuildModeController();
// Provides: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

#### `useBuildAdminModeController`

Toggles between Studio and Content modes:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("studio" | "content")
```

### Scaffold Components

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

Add top-level navigation views for dashboards, tools, or custom pages. An
`AppView` is a flat object — everything below sits at the top level, there is no
nested `admin` block:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        icon: "LayoutDashboard",
        view: <MyDashboard/>
    },
    {
        slug: "settings",
        name: "App Settings",
        icon: "Settings",
        group: "Admin",
        // Register `settings/*` too, so the view can route inside itself.
        nestedRoutes: true,
        // Reachable by URL, but not listed in the drawer.
        hideFromNavigation: true,
        view: <AppSettings/>
    }
];
```

Hand them to `<RebaseCMS>`, next to your collections — that is the component
that registers navigation:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Field | |
|---|---|
| `slug` | the path it is reached at, under the admin root |
| `name` | the label in the drawer and on the home page |
| `view` | the element to render, or a `ComponentType` to render it lazily |
| `icon` | a [Lucide](https://lucide.dev/icons/) icon name, e.g. `"ShoppingCart"` — or any node |
| `group` | groups views together in the drawer; `"Admin"` and `"Settings"` sink to the bottom |
| `pinToBottom` | sinks the group to the bottom under any name — prefer it over the two magic strings |
| `nestedRoutes` | also registers `slug/*`, for a view with routes of its own |
| `hideFromNavigation` | keeps the route, drops the nav entry |
| `roles` | only users holding one of these roles see the view, or can reach it |
| `description` | Markdown, shown on the home-page card |

To put a view under **Studio** instead of the CMS, pass it to
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

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
