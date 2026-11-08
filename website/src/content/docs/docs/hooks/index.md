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

    context.data                      // Rows, as the server sends them; writes run browserCallbacks
    context.client                    // The full SDK client
    context.storageSource             // File operations
    context.authController            // Auth state
    context.navigationStateController // Navigation state
    context.sidePanelController       // Side panel control
    context.snackbarController        // Toast notifications
}
```

`context.data` is the same flat layer the row hooks read: `context.data.orders.find()`
resolves to `{ data: rows, meta }`, a date is its ISO string and a belongsTo its
foreign-key column, exactly as a backend callback's `context.data` and
`client.data` return them. Its `create`, `update` and `delete` run the
collection's `admin.browserCallbacks` and refresh every view of the collection,
as `useRowWrites` does. Reach for it where React state does not fit: an entity
action's `onClick`, a callback, a collection builder.

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

## Rows: `useRows`, `useRow`, `useRowCount`, `useAggregate`, `useRowWrites`

Read and write a collection's rows in the shape the server sends them: dates as ISO strings, a belongsTo under its foreign-key column (`author_id`). It is the same shape `client.data` and `context.data` return, so code written with these hooks reads like code written against the SDK.

Each collection's rows come from the data source it declares (`dataSource`, see [Multiple data sources](/docs/backend/multiple-sources)), and any other collection's from the app's default data source. With a `client`, the default is `client.data`, and aggregates go over HTTP. Without one, it is the default data source's driver (a Firebase driver, for example). Where the data source can subscribe, the rows stay live. Where it cannot, every hook of a collection reads again after each write to it inside the same `<Rebase>` (through `useRowWrites`, `context.data`, a record form or a collection view) and after each change the data source's driver announces. So do the admin's collection views. Options are compared by value, so an inline object does not trigger a new read on every render. `error` is a message string, and a write that fails also rejects.

```typescript
import { useRowWrites, useRows } from "@rebasepro/app";
type Order = { id: number; status: string; total: number; created_at: string };
function PendingOrders() {
    const { rows, hasMore, loadMore } = useRows<Order>("orders", {
        where: { status: ["==", "pending"] }, orderBy: ["created_at", "desc"], limit: 20 });
    const { update, saving } = useRowWrites();
    return (
        <ul>
            {rows.map(order => (
                <li key={order.id} onClick={() => !saving && update<Order>("orders", order.id, { status: "shipped" })}>
                    {order.created_at}: {order.total}
                </li>
            ))}
            {hasMore && <li onClick={loadMore}>Load more</li>}
        </ul>
    );
}
```

| Hook | Returns |
|------|---------|
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` is the page size, and `loadMore` adds a page to the same read, up to 1000 rows. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` may be `undefined`, in which case nothing is read. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. The parameters and result are those of `client.data.<collection>.aggregate()`. A data source that cannot aggregate sets `error` and never returns an empty result. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Each write that succeeds refreshes every row hook and collection view of that collection. A write runs the collection's `admin.browserCallbacks` as the record form's save does: `beforeSave` (which may change the row, or throw to stop the write), then `afterSave` or `afterSaveError`; `beforeDelete`, then `afterDelete`. Each is handed rows as the server sends them. |

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
| `canEdit` | `(collection, path, row) => boolean` | Checks if the user is allowed to edit the given row, as `useRows` or `context.data` return it. `null` asks about the collection with no row in hand. |
| `canDelete` | `(collection, path, row) => boolean` | Checks if the user is allowed to delete the given row. `null` asks about the collection with no row in hand. |
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
                id: productId,
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
| `open({ path, id, collection })` | Open an entity in a side panel |
| `close()` | Close the current side panel |
| `replace({ path, id, collection })` | Replace the current side panel content |

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

Open a side dialog for picking rows from a collection. The rows are handed to
you as the server sends them, the shape `useRows` returns, and their ids
beside them — the strings `selectedIds` and `useSidePanel().open` take:

```typescript
import { useSelectionDialog } from "@rebasepro/cms";

function SelectProduct() {
    const selectionDialog = useSelectionDialog({
        path: "products",
        collection: productsCollection,
        onSingleRowSelected: (row, id) => {
            console.log("Selected:", id, row?.name);
        }
    });

    return <button onClick={selectionDialog.open}>Select Product</button>;
}
```

With `multiselect: true`, `onMultipleRowsSelected(rows, ids)` reports every
tick and `onSelectionDone(rows, ids)` the final selection once, when Done is pressed — use it
when acting on the selection writes something. `selectedIds` names the rows
shown selected, and first, when the dialog opens.

## `useSelectionController`

A selection of a collection's rows that you hold: hand it to a view as
`admin.selectionController` (on a `CollectionPanel`, through
`collectionOverrides`) and read what the person ticks there:

```tsx
import { CollectionPanel, useSelectionController } from "@rebasepro/cms";
import { Button } from "@rebasepro/ui";

function ShipOrders() {
    const selection = useSelectionController(ordersCollection);
    return <>
        <CollectionPanel collection={ordersCollection}
            collectionOverrides={{ selectionController: selection }}/>
        <Button disabled={!selection.hasSelection}>
            Ship {selection.selectedCount ?? "all"}
        </Button>
    </>;
}
```

`selection.selection` is `{ type: "rows", ids, rows }` for ticked rows, or
`{ type: "query", query, excludedIds, count }` once "all matching" is picked;
`resolveSelection({ selection: selection.selection, data: context.data,
collection })` reads a query selection's rows. `isSelected(id)`,
`toggleSelection(row)`, `setSelectedRows(rows)` and `clearSelection()` change it.

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

## `useRebaseClient`

Retrieve the backing typed SDK instance (`RebaseClient`) from the React context. This is useful for invoking raw SDK operations (like calling custom endpoints or manual uploads) within your components.

```typescript
import { useRebaseClient } from "@rebasepro/app";

function CustomAction() {
    const client = useRebaseClient();

    const handleAction = async () => {
        const result = await client.functions.invoke("send-invoice", { invoiceId: "123" });
        console.log(result);
    };

    return <button onClick={handleAction}>Process Invoice</button>;
}
```

## `useUnsavedChangesDialog`

Prevent navigation or page unload when form data has unsaved changes. It asks before a reload or a closed tab (`beforeunload`) and, inside the admin under a React Router data router (`createBrowserRouter`), before in-app navigation too, via `useBlocker`. Under any other router, such as a plain `<BrowserRouter>`, only the browser-level prompt applies.

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

Switch the role the admin panel's navigation is built for, without signing out:
which Studio views it lists. It sends nothing to the server and evaluates no
row-level security policy, so a data view still shows what you can read. To
test RLS, use **Simulate access** (above your avatar in the drawer), or `client.simulate()` from
code; see [Testing access](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` provides the controller. `useBuildEffectiveRoleController`, the hook
that built one to pass as `effectiveRoleController`, is deprecated in favour of
Simulate access and warns once when called.

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
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

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
- **[Typed SDK](/docs/sdk)** — Data operations SDK
