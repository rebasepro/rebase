---
title: Hooks Reference
sidebar_label: Hooks
description: React hooks provided by Rebase for accessing auth, data, navigation, side panels, storage, and UI state.
---

## Overview

Rebase provides React hooks to access framework functionality from any component within the `<Rebase>` provider tree.

## `useRebaseContext`

The master hook — access everything:

```typescript
import { useRebaseContext } from "@rebasepro/app";

function MyComponent() {
    const context = useRebaseContext();

    context.data                      // Data operations (flat rows)
    context.client                    // The full SDK client
    context.storageSource             // File operations
    context.authController            // Auth state
    context.navigationStateController // Navigation state
    context.sidePanelController       // Side panel control
    context.snackbarController        // Toast notifications
}
```

## `useAuthController`

Access authentication state and capabilities:

```typescript
import { useAuthController } from "@rebasepro/app";

function UserMenu() {
    const auth = useAuthController();

    auth.user            // Current user (or null)
    auth.authLoading     // True when auth operation is in progress
    auth.initialLoading  // Loading initial session on app startup
    auth.signOut()       // Log out (returns Promise<void>)
    auth.getAuthToken()  // Get JWT for API calls (returns Promise<string>)
    auth.extra           // Additional user data (roles, etc.)
    auth.capabilities    // Capabilities advertised by auth provider (e.g. registration, reset)
}
```

## `useCollection`

Fetch and subscribe to a list of entities in a collection. It automatically establishes a real-time WebSocket subscription if supported by the driver, falling back to REST fetches.

```typescript
import { useCollection } from "@rebasepro/app";
import type { User } from "@rebasepro/types";
import { productsCollection } from "../config/collections";

function ProductList() {
    // The row shape drives `filterValues`, `sortBy` and `entity.values` — without it
    // TypeScript infers M from whichever key it sees first.
    type Product = { name: string; price: number; active: boolean; createdAt: string };

    const { data, dataLoading, dataLoadingError, noMoreToLoad } = useCollection<Product, User>({
        path: "products",
        collection: productsCollection,
        itemCount: 20,
        filterValues: {
            active: ["==", true],
            price: [">=", 100]
        },
        sortBy: ["createdAt", "desc"],
        searchString: "laptop"
    });

    if (dataLoading) return <p>Loading products...</p>;
    if (dataLoadingError) return <p>Error: {dataLoadingError.message}</p>;

    return (
        <ul>
            {data.map(product => (
                <li key={product.id}>{product.values.name} (${product.values.price})</li>
            ))}
        </ul>
    );
}
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Absolute collection path (e.g., `"products"`). |
| `collection` | `CollectionConfig` | The collection definition object. |
| `itemCount` | `number` | Optional. Number of entities to fetch (SQL limit). |
| `offset` | `number` | Optional. Number of items to skip. |
| `page` | `number` | Optional. Page number (1-indexed), alternative to offset. |
| `filterValues` | `FilterValues` | Optional. Query filters. Supports shorthand equality, tuples `[op, val]`, and PostgREST operator strings. |
| `sortBy` | `[string, "asc" \| "desc"]` | Optional. Sort field and order direction tuple. |
| `searchString` | `string` | Optional. Query for full-text search. |

### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `data` | `Entity[]` | Array of fetched entities. |
| `dataLoading` | `boolean` | True if the initial load is in progress. |
| `dataLoadingError` | `Error` | Error object if the fetch fails. |
| `noMoreToLoad` | `boolean` | True if there are no more records beyond the current page/limit. |
| `totalCount` | `number` | Optional. The total count of records matching the filter in the database. |

## `useFetch`

Fetch and subscribe to a single entity by ID. It renders instantly using cached data if already loaded via a collection fetch, then updates in the background.

```typescript
import { useFetch } from "@rebasepro/app";
import { productsCollection } from "../config/collections";

function ProductDetail({ productId }) {
    const { entity, dataLoading, dataLoadingError } = useFetch({
        path: "products",
        entityId: productId,
        collection: productsCollection
    });

    if (dataLoading) return <p>Loading product...</p>;
    if (dataLoadingError) return <p>Error: {dataLoadingError.message}</p>;
    if (!entity) return <p>Product not found</p>;

    return (
        <div>
            <h1>{entity.values.name}</h1>
            <p>{entity.values.description}</p>
        </div>
    );
}
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Absolute collection path. |
| `entityId` | `string \| number` | The ID of the entity to fetch. |
| `collection` | `CollectionConfig` | The collection definition object. |
| `useCache` | `boolean` | Optional. If `true` and entity is in cache, skips background refresh. (Default: `false`). |

### Caching Utilities

Rebase maintains a global memory cache to prevent UI flashing. You can manipulate this cache directly:

- `populateFetchCache(path, entities)`: Pre-populates the cache with a list of entities (e.g. after a bulk action or custom API call).
- `clearFetchCache()`: Clears the cache. Recommended to call this upon user logout to prevent data leakage.

## `usePermissions`

Hook to evaluate roles and permissions for the current user. It abstracts away the need to manually pass the `authController` to permission checking functions.

```typescript
import { usePermissions } from "@rebasepro/app";
import { productsCollection } from "../config/collections";

function CreateProductButton() {
    const { canCreate } = usePermissions();

    const allowedToCreate = canCreate(productsCollection, "products");

    return (
        <button disabled={!allowedToCreate}>
            Create Product
        </button>
    );
}
```

### Return Value

| Method | Signature | Description |
|--------|-----------|-------------|
| `canCreate` | `(collection, path) => boolean` | Checks if the user is allowed to create entities in the collection. |
| `canEdit` | `(collection, path, entity) => boolean` | Checks if the user is allowed to edit the given entity. |
| `canDelete` | `(collection, path, entity) => boolean` | Checks if the user is allowed to delete the given entity. |
| `canRead` | `(collection) => boolean` | Checks if the user is allowed to read the collection. |

## `useClipboard`

Utility hook to copy or cut text to the clipboard, with automatic support for fallback mechanisms on older browsers.

> [!NOTE]
> Note the exact spelling of `isCoppied` (with two `p`s) in the return payload.

```typescript
import { useClipboard } from "@rebasepro/app";

function CopyButton({ text }) {
    const { copy, isCoppied } = useClipboard({ copiedDuration: 2000 });

    return (
        <button onClick={() => copy(text)}>
            {isCoppied ? "Copied!" : "Copy Text"}
        </button>
    );
}
```

### Parameters

| Option | Type | Description |
|--------|------|-------------|
| `copiedDuration` | `number` | Optional. Time in milliseconds before resetting `isCoppied` back to `false`. |
| `onSuccess` | `(text) => void` | Optional. Callback triggered on successful copy. |
| `onError` | `(err) => void` | Optional. Callback triggered on error. |

### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `ref` | `MutableRefObject` | React ref to attach to input/textarea elements to copy from. |
| `copy` | `(text?: string) => void` | Triggers copy of the given text, or the ref element's content. |
| `cut` | `() => void` | Triggers cut of the ref element's content. |
| `isCoppied` | `boolean` | True if text was recently copied. |
| `clipboard` | `string` | The current copied text value. |
| `clearClipboard` | `() => void` | Clears the clipboard. |

## `useSidePanel`

Programmatically open entities in a side panel:

```typescript
import { useSidePanel } from "@rebasepro/cms";

function OpenProductButton({ productId }) {
    const sidePanel = useSidePanel();

    return (
        <button onClick={() => {
            sidePanel.open({
                path: "products",
                entityId: productId,
                collection: productsCollection
            });
        }}>
            Open Product
        </button>
    );
}
```

Methods:

| Method | Description |
|--------|-------------|
| `open({ path, entityId, collection })` | Open a entity in a side panel |
| `close()` | Close the current side panel |
| `replace({ path, entityId, collection })` | Replace the current side panel content |

## `useSnackbarController`

Show toast notifications:

```typescript
import { useSnackbarController } from "@rebasepro/app";

function SaveButton() {
    const snackbar = useSnackbarController();

    const handleSave = async () => {
        try {
            await saveData();
            snackbar.open({ type: "success", message: "Saved successfully!" });
        } catch (error) {
            snackbar.open({ type: "error", message: "Save failed" });
        }
    };
}
```

`open()` takes `{ type, title?, message, autoHideDuration?, action? }`.

The `action` slot renders a button next to the message, which is where undo
belongs — the window in which undo means anything is the window the snackbar is
on screen:

```typescript
const rejectApplication = async (application: Application) => {
    const previous = application.status;
    await setStatus(application.id, "rejected");

    snackbar.open({
        type: "success",
        message: `Rejected ${application.name}`,
        action: {
            label: "Undo",
            onClick: () => setStatus(application.id, previous)
        }
    });
};
```

The snackbar dismisses itself once the action is clicked, so the same undo
cannot fire twice. Two snackbars carrying the same message both appear when
each has an action — rejecting two applications in a row leaves you a way back
from each.

## `useStorageSource`

Access file storage operations:

```typescript
import { useStorageSource } from "@rebasepro/app";

function FileUploader() {
    const storage = useStorageSource();

    const upload = async (file: File) => {
        const result = await storage.putObject({
            file,
            key: `documents/${file.name}`
        });
        const { url } = await storage.getSignedUrl(result.key);
        return url;
    };
}
```

## `useModeController`

Control light/dark theme:

```typescript
import { useModeController } from "@rebasepro/app";

function ThemeToggle() {
    const mode = useModeController();

    return (
        <button onClick={() => mode.setMode(mode.mode === "dark" ? "light" : "dark")}>
            Current: {mode.mode} {/* "light" | "dark" */}
        </button>
    );
}
```

## `useSelectionDialog`

Open a side dialog for selecting entities from a collection. This is the same hook used internally when a relation property is rendered:

```typescript
import { useSelectionDialog } from "@rebasepro/cms";

function SelectProduct() {
    const selectionDialog = useSelectionDialog({
        path: "products",
        collection: productsCollection,
        onSingleEntitySelected: (entity) => {
            console.log("Selected:", entity);
        }
    });

    return <button onClick={selectionDialog.open}>Select Product</button>;
}
```

## `useNavigationStateController`

Access navigation state and resolved collections:

```typescript
import { useNavigationStateController } from "@rebasepro/cms";

function MyComponent() {
    const navigation = useNavigationStateController();

    navigation.views              // Custom views
    navigation.adminViews         // Admin-mode views
    navigation.topLevelNavigation // Resolved top-level entries
}
```

## `useRelationSelector`

Manage complex relation selections with built-in search, debouncing, and pagination.

```typescript
import { useRelationSelector } from "@rebasepro/app";
import { categoriesCollection } from "../config/collections";

function CategorySelector({ onSelect }) {
    const { items, isLoading, search, loadMore, hasMore } = useRelationSelector({
        path: "categories",
        collection: categoriesCollection,
        pageSize: 10
    });

    return (
        <div>
            <input type="text" onChange={(e) => search(e.target.value)} placeholder="Search..." />
            <ul>
                {items.map(item => (
                    <li key={item.id} onClick={() => onSelect(item.relation)}>
                        {item.label}
                    </li>
                ))}
            </ul>
            {hasMore && <button onClick={loadMore} disabled={isLoading}>Load More</button>}
        </div>
    );
}
```

### Parameters

| Option | Type | Description |
|--------|------|-------------|
| `path` | `string` | Absolute collection path. |
| `collection` | `CollectionConfig` | Target collection definition. |
| `fixedFilter` | `FilterValues` | Optional. Static filters to restrict search results. |
| `pageSize` | `number` | Optional. Number of items per page. (Default: `10`). |
| `getLabelFromEntity` | `(entity) => string` | Optional. Customize the display label text. |
| `getDescriptionFromEntity` | `(entity) => string` | Optional. Customize the description text. |

## `useRebaseClient`

Retrieve the backing client SDK instance (`RebaseClient`) from the React context. This is useful for invoking raw SDK operations (like calling custom endpoints or manual uploads) within your components.

```typescript
import { useRebaseClient } from "@rebasepro/app";

function CustomAction() {
    const client = useRebaseClient();

    const handleAction = async () => {
        const result = await client.call("functions/send-invoice", { invoiceId: "123" });
        console.log(result);
    };

    return <button onClick={handleAction}>Process Invoice</button>;
}
```

## `useUnsavedChangesDialog`

Prevent navigation or page unload when form data has unsaved changes. It automatically intercepts internal React Router navigation via `useBlocker` as well as browser-level reloads via `beforeunload`.

```typescript
import { useUnsavedChangesDialog } from "@rebasepro/app";
import { useState } from "react";

function EditForm() {
    const [isDirty, setIsDirty] = useState(false);

    const { dialogProps, triggerDialog } = useUnsavedChangesDialog(
        isDirty,
        () => console.log("Navigation allowed (discarded or saved changes)")
    );

    // dialogProps contains { open, handleOk, handleCancel, body }
}
```

### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `when` | `boolean` | Flag to activate page/router navigation blocking. |
| `onOk` | `() => void` | Callback triggered when the user confirms discarding changes. |

### Return Value

| Property | Type | Description |
|----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Modal props to pass directly to an `UnsavedChangesDialog` UI component. |
| `triggerDialog` | `() => void` | Triggers manual dialog display programmatically. |

## `useEffectiveRoleController`

Switch roles at runtime to preview permissions and test Row-Level Security (RLS) policies locally without signing out.

```typescript
import { useEffectiveRoleController } from "@rebasepro/app";

function RoleSwitcher() {
    const { effectiveRole, setEffectiveRole } = useEffectiveRoleController();

    return (
        <select value={effectiveRole || ""} onChange={(e) => setEffectiveRole(e.target.value || null)}>
            <option value="">Default (No Simulation)</option>
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="user">Standard User</option>
        </select>
    );
}
```

## `useAdminModeController`

Switch the admin layout view modes within the admin panel.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "content" | "studio" | "settings"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Open dialog screens imperatively from anywhere in the component tree.

```typescript
import { useDialogsController } from "@rebasepro/app";
import { MyCustomDialog } from "./MyCustomDialog";

function OpenModalButton() {
    const dialogs = useDialogsController();

    return (
        <button onClick={() => dialogs.open({
            key: "my-custom-modal",
            Component: MyCustomDialog,
            props: { title: "Custom Title" }
        })}>
            Open Custom Dialog
        </button>
    );
}
```

## `useAnalyticsController`

Capture CMS UI actions and user events globally.

```typescript
import { useAnalyticsController } from "@rebasepro/app";
import { useEffect } from "react";

function AnalyticsLogger() {
    const analytics = useAnalyticsController();

    useEffect(() => {
        analytics.onAnalyticsEvent = (event, data) => {
            console.log(`CMS Event: ${event}`, data);
        };
    }, [analytics]);
}
```

## Next Steps

- **[Frontend Overview](/docs/frontend)** — React framework reference
- **[Client SDK](/docs/sdk)** — Data operations SDK
