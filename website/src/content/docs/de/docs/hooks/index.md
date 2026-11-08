---
sourceHash: 23624a5be1a5e06a
title: Hooks-Referenz
sidebar_label: Hooks
description: Von Rebase bereitgestellte React-Hooks für den Zugriff auf Authentifizierung, Daten, Navigation, Seitenleisten, Speicher und UI-Zustand.
---

## Übersicht

Rebase bietet React-Hooks für den Zugriff auf Framework-Funktionen aus jeder Komponente innerhalb des `<Rebase>`-Provider-Baums.

## `useRebaseContext`

Der Master-Hook – Zugriff auf alles:

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

`context.data` ist dieselbe flache Schicht, die die Zeilen-Hooks lesen: `context.data.orders.find()` wird zu `{ data: rows, meta }` aufgelöst, ein Datum ist sein ISO-String und ein belongsTo seine Fremdschlüssel-Spalte, genau wie `context.data` und `client.data` eines Backend-Callbacks sie zurückgeben. Seine Methoden `create`, `update` und `delete` führen die `admin.browserCallbacks` der Collection aus und aktualisieren jede Ansicht der Collection, genau wie `useRowWrites`. Verwenden Sie es dort, wo React-State nicht passt: im `onClick` einer Entity-Aktion, einem Callback, einem Collection-Builder.

## `useAuthController`

Zugriff auf Authentifizierungsstatus und -funktionen:

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

## Zeilen: `useRows`, `useRow`, `useRowCount`, `useAggregate`, `useRowWrites`

Lesen und schreiben Sie die Zeilen einer Collection in der Struktur, wie der Server sie sendet: Daten als ISO-Strings, ein belongsTo unter seiner Fremdschlüssel-Spalte (`author_id`). Es ist dieselbe Struktur, die `client.data` und `context.data` zurückgeben, sodass sich Code, der mit diesen Hooks geschrieben wurde, wie Code liest, der gegen das SDK geschrieben wurde.

Die Zeilen jeder Collection stammen aus der von ihr deklarierten Datenquelle (`dataSource`, siehe [Mehrere Datenquellen](/docs/backend/multiple-sources)), und die jeder anderen Collection aus der Standard-Datenquelle der App. Mit einem `client` ist der Standard `client.data`, und Aggregate laufen über HTTP. Ohne einen ist es der Treiber der Standard-Datenquelle (beispielsweise ein Firebase-Treiber). Wo die Datenquelle abonnieren kann, bleiben die Zeilen live. Wo dies nicht möglich ist, liest jeder Hook einer Collection nach jedem Schreibvorgang auf diese innerhalb desselben `<Rebase>` erneut (über `useRowWrites`, `context.data`, ein Datensatzformular oder eine Collection-Ansicht) sowie nach jeder Änderung, die der Treiber der Datenquelle meldet. Ebenso die Collection-Ansichten des Admins. Optionen werden nach Wert verglichen, sodass ein Inline-Objekt nicht bei jedem Render-Vorgang ein erneutes Lesen auslöst. `error` ist ein Meldungs-String, und ein fehlgeschlagener Schreibvorgang schlägt ebenfalls fehl (rejects).

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

| Hook | Rückgabe |
|------|---------|
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` ist die Seitengröße, und `loadMore` fügt demselben Lesevorgang eine Seite hinzu, bis zu 1000 Zeilen. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` kann `undefined` sein; in diesem Fall wird nichts gelesen. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. Die Parameter und das Ergebnis entsprechen denen von `client.data.<collection>.aggregate()`. Eine Datenquelle, die keine Aggregation unterstützt, setzt `error` und gibt niemals ein leeres Ergebnis zurück. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Jeder erfolgreiche Schreibvorgang aktualisiert jeden Zeilen-Hook und jede Collection-Ansicht dieser Collection. Ein Schreibvorgang führt die `admin.browserCallbacks` der Collection aus, genau wie das Speichern im Datensatzformular: `beforeSave` (was die Zeile ändern oder einen Fehler werfen kann, um den Schreibvorgang abzubrechen), dann `afterSave` oder `afterSaveError`; `beforeDelete`, dann `afterDelete`. Jedem werden die Zeilen so übergeben, wie der Server sie sendet. |

## `usePermissions`

Hook zur Auswertung von Rollen und Berechtigungen für den aktuellen Benutzer. Er nimmt Ihnen die manuelle Übergabe des `authController` an Berechtigungsprüfungsfunktionen ab.

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

### Rückgabewert

| Methode | Signatur | Beschreibung |
|--------|-----------|-------------|
| `canCreate` | `(collection, path) => boolean` | Prüft, ob der Benutzer Entitäten in der Collection erstellen darf. |
| `canEdit` | `(collection, path, row) => boolean` | Prüft, ob der Benutzer die angegebene Zeile bearbeiten darf, so wie sie von `useRows` oder `context.data` zurückgegeben wird. `null` fragt die Collection ab, ohne dass eine konkrete Zeile vorliegt. |
| `canDelete` | `(collection, path, row) => boolean` | Prüft, ob der Benutzer die angegebene Zeile löschen darf. `null` fragt die Collection ab, ohne dass eine konkrete Zeile vorliegt. |
| `canRead` | `(collection) => boolean` | Prüft, ob der Benutzer die Collection lesen darf. |

## `useClipboard`

Utility-Hook zum Kopieren oder Ausschneiden von Text in die Zwischenablage mit automatischer Unterstützung von Fallback-Mechanismen auf älteren Browsern.

> [!NOTE]
> Beachten Sie die genaue Schreibweise von `isCoppied` (mit zwei `p`) im Rückgabewert.

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

### Parameter

| Option | Typ | Beschreibung |
|--------|------|-------------|
| `copiedDuration` | `number` | Optional. Zeit in Millisekunden, bevor `isCoppied` wieder auf `false` zurückgesetzt wird. |
| `onSuccess` | `(text) => void` | Optional. Callback, der bei erfolgreichem Kopieren ausgelöst wird. |
| `onError` | `(err) => void` | Optional. Callback, der bei einem Fehler ausgelöst wird. |

### Rückgabewert

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `ref` | `MutableRefObject` | React-Ref zum Anhängen an Input-/Textarea-Elemente, aus denen kopiert werden soll. |
| `copy` | `(text?: string) => void` | Löst das Kopieren des angegebenen Texts oder des Inhalts des Ref-Elements aus. |
| `cut` | `() => void` | Löst das Ausschneiden des Inhalts des Ref-Elements aus. |
| `isCoppied` | `boolean` | True, wenn Text kürzlich kopiert wurde. |
| `clipboard` | `string` | Der aktuell kopierte Textwert. |
| `clearClipboard` | `() => void` | Leert die Zwischenablage. |

## `useSidePanel`

Entitäten programmatisch in einem Seitenpanel öffnen:

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

Methoden:

| Methode | Beschreibung |
|--------|-------------|
| `open({ path, id, collection })` | Eine Entität in einem Seitenpanel öffnen |
| `close()` | Das aktuelle Seitenpanel schließen |
| `replace({ path, id, collection })` | Den Inhalt des aktuellen Seitenpanels ersetzen |

## `useSnackbarController`

Toast-Benachrichtigungen anzeigen:

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

`open()` akzeptiert `{ type, title?, message, autoHideDuration?, action? }`.

Der `action`-Slot rendert eine Schaltfläche neben der Nachricht, wo Undo hingehört – das Zeitfenster, in dem Undo eine Bedeutung hat, ist genau das Zeitfenster, in dem die Snackbar auf dem Bildschirm zu sehen ist:

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

Die Snackbar schließt sich von selbst, sobald die Aktion angeklickt wird, sodass dasselbe Rückgängigmachen (Undo) nicht zweimal ausgelöst werden kann. Zwei Snackbars mit derselben Nachricht werden beide angezeigt, wenn jede eine Aktion hat – das Ablehnen von zwei Anträgen hintereinander lässt jeweils einen Weg zurück offen.

## `useStorageSource`

Zugriff auf Dateispeicheroperationen:

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

Helles/dunkles Farbschema steuern:

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

Öffnet einen seitlichen Dialog zur Auswahl von Zeilen aus einer Collection. Die Zeilen werden Ihnen so übergeben, wie der Server sie sendet – in der von `useRows` zurückgegebenen Form, einschließlich `id`:

```typescript
import { useSelectionDialog } from "@rebasepro/cms";

function SelectProduct() {
    const selectionDialog = useSelectionDialog({
        path: "products",
        collection: productsCollection,
        onSingleRowSelected: (row) => {
            console.log("Selected:", row?.id);
        }
    });

    return <button onClick={selectionDialog.open}>Select Product</button>;
}
```

Mit `multiselect: true` meldet `onMultipleRowsSelected(rows)` jedes Auswählen/Abwählen und `onSelectionDone(rows)` die finale Auswahl einmalig, wenn auf Fertig geklickt wird – verwenden Sie dies, wenn die Reaktion auf die Auswahl einen Schreibvorgang auslöst. `selectedIds` benennt die Zeilen, die beim Öffnen des Dialogs als ausgewählt und an erster Stelle angezeigt werden.

## `useSelectionController`

Eine Auswahl von Zeilen einer Collection, die Sie verwalten: Übergeben Sie sie an eine Ansicht als `admin.selectionController` (auf einem `CollectionPanel` über `collectionOverrides`) und lesen Sie aus, was die Person dort markiert:

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

`selection.selection` ist `{ type: "rows", ids, rows }` für markierte Zeilen oder `{ type: "query", query, excludedIds, count }`, sobald „alle passenden“ ausgewählt ist; `resolveSelection({ selection: selection.selection, data: context.data, collection })` liest die Zeilen einer Query-Auswahl. `isSelected(id)`, `toggleSelection(row)`, `setSelectedRows(rows)` und `clearSelection()` ändern die Auswahl.

## `useNavigationStateController`

Zugriff auf Navigationsstatus und aufgelöste Collections:

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

Ruft die zugrundeliegende typisierte SDK-Instanz (`RebaseClient`) aus dem React-Context ab. Dies ist nützlich, um direkte SDK-Operationen (wie den Aufruf benutzerdefinierter Endpunkte oder manuelle Uploads) innerhalb Ihrer Komponenten auszuführen.

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

Verhindert Navigation oder das Verlassen der Seite, wenn Formulardaten ungespeicherte Änderungen enthalten. Es fragt vor einem Neuladen oder Schließen des Tabs (`beforeunload`) nach und innerhalb des Admins unter einem React Router Data Router (`createBrowserRouter`) auch vor der In-App-Navigation über `useBlocker`. Unter jedem anderen Router, wie einem einfachen `<BrowserRouter>`, greift nur die Bestätigung auf Browserebene.

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

### Parameter

| Parameter | Typ | Beschreibung |
|-----------|------|-------------|
| `when` | `boolean` | Flag zur Aktivierung der Navigationsblockierung auf Seiten-/Router-Ebene. |
| `onOk` | `() => void` | Callback, der ausgelöst wird, wenn der Benutzer das Verwerfen der Änderungen bestätigt. |

### Rückgabewert

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Modal-Props zur direkten Übergabe an eine `UnsavedChangesDialog`-UI-Komponente. |
| `triggerDialog` | `() => void` | Löst die manuelle Anzeige des Dialogs programmatisch aus. |

## `useEffectiveRoleController`

Wechseln Sie die Rolle, für die die Navigation des Admin-Panels aufgebaut ist, ohne sich abzumelden: welche Studio-Ansichten aufgelistet werden. Es sendet nichts an den Server und wertet keine Row-Level-Security-Richtlinie (RLS) aus, sodass eine Datenansicht weiterhin anzeigt, was Sie lesen dürfen. Um RLS zu testen, verwenden Sie **Simulate access** (über Ihrem Avatar im Drawer) oder `client.simulate()` im Code; siehe [Zugriff testen](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` stellt den Controller bereit. `useBuildEffectiveRoleController`, der Hook, der einen Controller zur Übergabe als `effectiveRoleController` erstellte, ist zugunsten von „Simulate access“ veraltet und gibt beim Aufruf einmalig eine Warnung aus.

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

Wechseln Sie die Ansichtsmodi des Admin-Layouts innerhalb des Admin-Panels.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Öffnen Sie Dialog-Fenster imperativ von beliebiger Stelle im Komponentenbaum.

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

CMS-UI-Aktionen und Benutzer-Events global erfassen.

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

## Nächste Schritte

- **[Frontend-Übersicht](/docs/frontend)** — Referenz zum React-Framework
- **[Typisiertes SDK](/docs/sdk)** — SDK für Datenoperationen
