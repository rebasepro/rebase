---
title: Plugin System
sidebar_label: Plugins
description: Extend Rebase with plugins — inject UI components, modify collections, add toolbar actions, and create custom field builders.
---

## Overview

Plugins are the primary extension mechanism in Rebase. They can:

- Wrap the entire app with a **provider** (context, state management)
- Add **home page actions** and widgets
- Inject **collection view** components (toolbar, column builders)
- Add **form** components (field builders, additional panels)
- **Inject or modify collections** dynamically

## Plugin Interface

```typescript
interface RebasePlugin {
    key: string;                    // Unique identifier
    loading?: boolean;              // Hold admin content until the plugin is ready

    // UI contributions — a flat array, each entry naming its slot.
    // This replaced the old per-area objects (homePage, collectionView, form).
    slots?: SlotContribution[];

    // HOC providers. `scope: "root"` wraps the whole admin below
    // RebaseContext; `scope: "form"` wraps each entity form / edit view.
    providers?: PluginProvider[];

    // Behavioural (non-UI) hooks: collection modification and injection,
    // column reordering, navigation entries.
    hooks?: PluginHooks;

    // Custom field rendering (e.g. data enhancement).
    fieldBuilder?: FieldBuilderConfig;

    // Views added to the navigation automatically.
    views?: AppView[];

    lifecycle?: PluginLifecycle;
}
```

Every one of these is optional except `key`. The full slot-name list lives on
the **[Slots](/docs/frontend/slots)** page.

## Using Plugins

Plugins go on `<Rebase>`, next to the client. Everything below it — the
navigation, the collection views, the forms — reads them from there:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

export function App() {
    const authController = useRebaseAuthController({ client });
    const dataEnhancementPlugin = useDataEnhancementPlugin();

    return (
        <Rebase
            client={client}
            authController={authController}
            plugins={[dataEnhancementPlugin]}
        >
            <RebaseCMS collections={collections}/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Plugins are usually built by a hook, so the array is rebuilt on every render;
that is fine, and it is why `plugins` is a prop rather than something you
memoize by hand. Two plugins with the same `key` are a mistake — `<Rebase>`
logs the duplicates rather than silently dropping one.

For a single contribution you do not need a plugin at all: `<Rebase slots>`
takes the same `SlotContribution` entries directly.

### Under manual composition

Only if you have replaced `<RebaseShell>` with the layers underneath it does
the plugin list have to be threaded by hand, into the navigation controller:

```tsx
const navigationStateController = useBuildNavigationStateController({
    plugins,
    collections: () => collections,
    // These four are required — the controller resolves navigation against them.
    authController,
    data,
    collectionRegistryController,
    urlController
});
```

`<RebaseNavigation>` does exactly this call for you, reading `plugins` off the
customization controller `<Rebase>` provides. See
[Advanced: manual layout](/docs/frontend#advanced-manual-layout).

## Building a Plugin

Here's a minimal plugin that adds a toolbar action to every collection:

```tsx
import type { RebasePlugin } from "@rebasepro/cms-types";

function useMyPlugin(): RebasePlugin {
    return {
        key: "my_plugin",

        // `slots` is a flat array of contributions, each naming its slot.
        // See the Slots page for the full list of slot names.
        slots: [
            { slot: "collection.actions", Component: MyToolbarAction }
        ],

        // `fieldBuilder` is top-level and takes a `wrap` function that returns
        // a *component* (or null to leave the default field alone) — it is not
        // a render function and no longer lives under `form`.
        fieldBuilder: {
            wrap: ({ property }) =>
                property.propertyConfig === "my_custom_field" ? MyCustomField : null
        }
    };
}
```

## Built-in Plugins



### Data Enhancement Plugin

AI-powered field autocompletion:

```typescript
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";

const enhancementPlugin = useDataEnhancementPlugin();
```

![Data enhancement](/img/data_enhancement.png)

## Collection Injection

Plugins can dynamically add new collections:

```typescript
hooks: {
    // Receives the resolved collections and returns the full list to use.
    injectCollections: (collections) => [...collections, auditLogCollection]
}
```

## Collection Modification

Plugins can modify existing collections:

```typescript
hooks: {
    // Receives one collection, returns the modified one.
    // Use `modifyCollectionAsync` when the change needs a fetch.
    modifyCollection: (collection) => ({
        ...collection,
        properties: {
            ...collection.properties,
            last_modified_by: {
                type: "string",
                name: "Modified By",
                admin: { readOnly: true }
            }
        }
    })
}
```

## Next Steps

- **[Studio Tools](/docs/studio)** — SQL console, JS console, RLS editor
- **[Custom Fields](/docs/frontend/custom-fields)** — Building custom form fields
