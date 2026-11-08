---
title: Frontend Overview
sidebar_label: Frontend
description: "Build and customize the panel — Rebase CMS and Rebase Studio — with React: controllers, scaffold, routing, and views."
---

## Overview

The Rebase frontend is a **React framework** that renders your admin panel. It reads your collection definitions and generates tables, forms, navigation, and routing automatically.

In the default scaffold, the admin panel **is** the frontend: it's served at the root of your deployed URL. If you build your own product app instead, you can mount the admin under a prefix like `/admin` in the same deployment — see [Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

This is `frontend/src/App.tsx` as `rebase init` writes it, without its font
imports, error boundary and Google client id — the whole admin panel, four
declarations inside one provider:

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

All twenty-three of them, in full — the table used to list ten, and two of those
were props the component never read:

<!-- rebase-props:start -->
| Prop | Description |
|------|-------------|
| `children` | The admin's root components — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. A render function is the manual-layout escape hatch. |
| `apiUrl` | Base URL of the backend API, made available to every hook via `useApiConfig()` |
| `dateTimeFormat` | How dates are printed. Defaults to `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Initial language of the admin, and the locale dates are formatted in — see [Translations](/docs/frontend/i18n) |
| `client` | `RebaseClient` instance: the default source for data, auth and storage |
| `dataSources` | Extra data sources, for collections that name one — see [Multiple sources](/docs/backend/multiple-sources) |
| `authController` | Authentication state and methods. Replaces the `client.auth` subscription outright |
| `storageSource` | The default storage source, overriding `client.storage` |
| `storageSources` | Named storage sources beyond the default |
| `databaseAdmin` | Administrative database operations (SQL, schema discovery). Only Studio needs it |
| `userConfigPersistence` | Local UI preferences — column widths, collapsed groups |
| `onAnalyticsEvent` | Called for every analytics event the admin emits |
| `entityLinkBuilder` | `({ row, id, path }) => string`: the URL for the "open in your app" button on a record, from the record as the server sends the row |
| `plugins` | Plugin instances — see [Plugins](/docs/plugins) |
| `slots` | Slot contributions declared directly, without a plugin |
| `propertyConfigs` | Custom field widgets, keyed by the name a property names in `propertyConfig` |
| `entityViews` | Custom entity view tabs, available to any collection that names their `key` in `admin.entityViews` |
| `collectionViews` | Custom collection view modes, available to any collection by `key` |
| `entityActions` | Entity actions, available to any collection that names their `key` in `admin.entityActions` |
| `effectiveRoleController` | Simulate a different role while dev mode is on |
| `modeController` | Hand Rebase the host app's light/dark mode; Rebase then never touches `<html>`, `prefers-color-scheme` or localStorage — see [Styling](#styling) |
| `translations` | Override or extend any UI string, keyed by locale — see [Translations](/docs/frontend/i18n) |
| `components` | Replace built-in components — see [Component Overrides](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

The navigation, URL and collection-registry controllers are **not** `<Rebase>`
props — they are built by the hooks below and consumed inside the admin tree
(`<RebaseShell>` wires them for you in the default scaffold).

Neither is the URL prefix. When the admin is mounted under a path, that belongs
on `<RebaseCMS basePath="/admin">`, which is what resolves URLs to collections —
and only when the router has no `basename` of its own. See
[Changing the Base URL](/docs/getting-started/deployment#changing-the-base-url).

## One data shape

Your code gets rows as the server sends them, wherever it asks: `client.data`,
`context.data` (in a backend callback and in the browser alike), `useRows`,
`useRow` and `useRowWrites`, the collection and view builders' `data`, and what
a collection's `browserCallbacks` are handed. A row is a flat object: `row.title`,
a date as its ISO string, a belongsTo as its foreign-key column.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

The admin itself renders an `Entity` view model — the `id` / `path` / `values`
wrapper its collection views and forms draw from, with dates as `Date`s and a
relation as an `EntityRelation`. That layer is the admin's own and is not part of
the public surface. You meet `Entity` only where one of the admin's parts calls
your code with its own record: an entity action's `entity`, a view mode
`Builder`'s `tableController.data`, a form's values.

## One collection or one record in a page of your own

You do not need the whole admin to show one table. `<CollectionPanel>`,
`<EntityFormPanel>`, `<EntityViewPanel>` and `<FieldValue>` work anywhere under
`<Rebase>` and a React Router router, with no `<RebaseCMS>`,
`<RebaseNavigation>` or `<RebaseShell>`: a collection with the columns and
toolbar you choose, one record's form with only some fields or your own
layout, one record read-only, or one value drawn as the admin draws it. See
[Panels in a page of your own](/docs/frontend/panels).

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
To embed a
collection view or a record form in a page of your own, without the
admin's routes, the lighter `CollectionsProvider` builds those controllers
instead — see
[Panels in a page of your own](/docs/frontend/panels).

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

Its `data` is what the collection and view builders are handed: the flat
`context.data` of the enclosing `<Rebase>` (see [One data shape](#one-data-shape)),
so this hook must be called inside the `<Rebase>` tree.

```typescript
const { data } = useRebaseContext();

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

Manages the light/dark theme. While enabled it owns the page's theme: it puts
the `dark` class on `<html>`, follows `prefers-color-scheme` until the user
picks a mode, and remembers that pick in localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` builds one of these itself.

When the
component using it unmounts, it removes the `dark` class it added; a `dark`
class the page already had stays. Build your own
above `<Rebase>` only when components outside it need the mode too, and hand
it over with the [`modeController` prop](#styling), so there is one controller
and not two. `useBuildModeController({ enabled: false })` builds an inert
controller: it keeps `mode` in React state and touches no class, media query
or localStorage. When your app already owns the theme you do not need this
hook at all: pass your own controller as `modeController`.

#### `useBuildAdminModeController`

Toggles between Studio and Content modes:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
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
- **`<Rebase modeController>`** — Hand Rebase your app's light/dark mode
- **Tailwind config** — Standard Tailwind customization

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Light and dark mode

By default `<Rebase>` owns the page's theme: it puts the `dark` class on
`<html>`, follows `prefers-color-scheme` until the user picks a mode in the
admin, and remembers that pick in localStorage.

When `<Rebase>`
unmounts, it removes the `dark` class it added; a class the page already had
stays. On 0.24 the class stays behind.

When your app
already has a theme, pass it as `modeController`. Rebase reads `mode` from it,
calls its `setMode` from its own theme toggle, and never touches `<html>`,
`prefers-color-scheme` or localStorage:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, type ModeController } from "@rebasepro/app";

export function App() {
    const [mode, setMode] = useState<"light" | "dark">("light");
    const modeController = useMemo<ModeController>(() => ({
        mode,
        setMode: (next) => setMode(next === "dark" ? "dark" : "light")
    }), [mode]);

    // Your app applies the mode, as it does for the rest of the page.
    useEffect(() => {
        document.documentElement.classList.toggle("dark", mode === "dark");
    }, [mode]);

    return (
        <Rebase client={client} modeController={modeController}>
            <MyAdmin/>
        </Rebase>
    );
}
```

The scaffold's CSS styles dark mode under any element with the `dark` class
(`@custom-variant dark (&:where(.dark, .dark *))`). Side panels, dialogs and
menus render in a portal on `<body>`, so put the class on `<html>` or `<body>`
rather than on a wrapper around `<Rebase>`.

Wrapping `<Rebase>` in a `ModeControllerProvider` does not do this:
`<Rebase>` provides a controller of its own inside it. On 0.24 the prop does
not exist, and there is no way to hand `<Rebase>` your app's mode.

## Next Steps

- **[Custom Fields](/docs/frontend/custom-fields)** — Build custom form fields
- **[Entity Views](/docs/frontend/entity-views)** — Add tabs to entity editors
- **[View Modes](/docs/frontend/view-modes)** — List, Table, Cards, Kanban
- **[Translations](/docs/frontend/i18n)** — Change any string, or add a language
- **[Plugins](/docs/plugins)** — Extend the framework
