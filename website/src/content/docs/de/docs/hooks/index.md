---
sourceHash: 09a9548b22748eda
title: Hooks-Referenz
sidebar_label: Hooks
description: Von Rebase bereitgestellte React-Hooks für den Zugriff auf Authentifizierung, Daten, Navigation, Sidepanels, Speicher und UI-Status.
---

## Übersicht

Rebase stellt React-Hooks zur Verfügung, um von jeder Komponente innerhalb des `<Rebase>`-Provider-Baums auf Framework-Funktionen zuzugreifen.

## `useRebaseContext`

Der Master-Hook – Zugriff auf alles:

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

Lesen und Schreiben von Zeilen einer Collection in der Struktur, wie der Server sie sendet: Daten als ISO-Strings, ein belongsTo unter seiner Fremdschlüssel-Spalte (`author_id`). Es ist dieselbe Struktur, die `client.data` zurückgibt und dieselbe, die `context.data` in einem Backend-Callback zurückgibt, sodass sich mit diesen Hooks geschriebener Code wie Code liest, der gegen das SDK geschrieben wurde.

Die Zeilen stammen aus der Standard-Datenquelle der App. Mit einem `client` ist das `client.data`, und Aggregate laufen über HTTP. Ohne client ist es der Treiber der Standard-Datenquelle (beispielsweise ein Firebase-Treiber). Wo die Datenquelle Subscriptions unterstützt, bleiben die Zeilen live. Wo dies nicht möglich ist, liest jeder Hook einer Collection nach jedem Schreibvorgang auf diese innerhalb desselben `<Rebase>` (über `useRowWrites`, ein Datensatzformular, eine Collection-Ansicht oder `useData()`) und nach jeder vom Treiber der Datenquelle gemeldeten Änderung erneut. Das gilt auch für die Collection-Ansichten des Admins. Optionen werden nach Wert verglichen, sodass ein Inline-Objekt nicht bei jedem Rendern einen neuen Lesevorgang auslöst. `error` ist ein Nachrichten-String, und ein fehlgeschlagener Schreibvorgang wird ebenfalls rejected.

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

| Hook | Rückgabewert |
|------|--------------|
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` ist die Seitengröße, und `loadMore` fügt demselben Lesevorgang eine Seite hinzu, bis zu 1000 Zeilen. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` kann `undefined` sein; in diesem Fall wird nichts gelesen. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. Die Parameter und das Ergebnis entsprechen denen von `client.data.<collection>.aggregate()`. Eine Datenquelle, die keine Aggregation unterstützt, setzt `error` und gibt niemals ein leeres Ergebnis zurück. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Jeder erfolgreiche Schreibvorgang aktualisiert jeden Zeilen-Hook und jede Collection-Ansicht dieser Collection. Ein Schreibvorgang führt die `admin.browserCallbacks` der Collection wie beim Speichern des Datensatzformulars mit denselben Werten aus: `beforeSave` (was die Werte ändern oder einen Fehler werfen kann, um den Schreibvorgang abzubrechen), danach `afterSave` oder `afterSaveError`; `beforeDelete`, danach `afterDelete`. |

## `useCollection`

Abrufen und Abonnieren einer Liste von Entitäten in einer Collection. Sofern vom Treiber unterstützt, wird automatisch eine Echtzeit-WebSocket-Subscription eingerichtet, andernfalls erfolgt ein Fallback auf REST-Abrufe.

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

### Parameter

| Parameter | Typ | Beschreibung |
|-----------|------|-------------|
| `path` | `string` | Absoluter Collection-Pfad (z. B. `"products"`). |
| `collection` | `AdminCollection` | Das Collection-Definitionsobjekt. |
| `itemCount` | `number` | Optional. Anzahl der abzurufenden Entitäten (SQL-Limit). |
| `offset` | `number` | Optional. Anzahl der zu überspringenden Elemente. |
| `page` | `number` | Optional. Seitennummer (1-basiert), Alternative zu Offset. |
| `filterValues` | `FilterValues` | Optional. Abfragefilter. Unterstützt Gleichheits-Kurzschreibweise, Tupel `[op, val]` und PostgREST-Operator-Strings. |
| `sortBy` | `[string, "asc" \| "desc"]` | Optional. Tupel aus Sortierfeld und Sortierreihenfolge. |
| `searchString` | `string` | Optional. Suchbegriff für die Volltextsuche. |

### Rückgabewert

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `data` | `Entity[]` | Array der abgerufenen Entitäten. |
| `dataLoading` | `boolean` | True, wenn der anfängliche Ladevorgang läuft. |
| `dataLoadingError` | `Error` | Fehlerobjekt, wenn der Abruf fehlschlägt. |
| `noMoreToLoad` | `boolean` | True, wenn über die aktuelle Seite/das aktuelle Limit hinaus keine weiteren Datensätze vorhanden sind. |
| `totalCount` | `number` | Optional. Die Gesamtzahl der Datensätze in der Datenbank, die dem Filter entsprechen. |

## `useFetch`

Abrufen und Abonnieren einer einzelnen Entität anhand der ID. Wenn sie bereits über einen Collection-Abruf geladen wurde, wird sie sofort anhand der zwischengespeicherten Daten gerendert und anschließend im Hintergrund aktualisiert.

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

### Parameter

| Parameter | Typ | Beschreibung |
|-----------|------|-------------|
| `path` | `string` | Absoluter Collection-Pfad. |
| `entityId` | `string \| number` | Die ID der abzurufenden Entität. |
| `collection` | `AdminCollection` | Das Collection-Definitionsobjekt. |
| `useCache` | `boolean` | Optional. Wenn `true` und sich die Entität im Cache befindet, wird die Hintergrundaktualisierung übersprungen. (Standard: `false`). |

### Caching-Hilfsprogramme

Rebase verwaltet einen globalen In-Memory-Cache, um UI-Flackern zu vermeiden. Sie können diesen Cache direkt manipulieren:

- `populateFetchCache(path, entities)`: Befüllt den Cache vorab mit einer Liste von Entitäten (z. B. nach einer Massenaktion oder einem benutzerdefinierten API-Aufruf). Der Cache behält die 2.000 zuletzt geschriebenen oder gelesenen Datensätze. Eine Collection-Ansicht schreibt nicht mehr jede angezeigte Zeile hinein: Durch das Klicken auf eine Zeile oder deren Aktion **Edit** oder **Copy** wird nur diese eine Zeile dort abgelegt, sodass der Datensatz weiterhin mit seinen Werten direkt auf dem Bildschirm geöffnet wird.
- `clearFetchCache()`: Leert den Cache. Es wird empfohlen, dies bei der Abmeldung des Benutzers aufzurufen, um Datenlecks zu verhindern.

## `usePermissions`

Hook zur Auswertung von Rollen und Berechtigungen für den aktuellen Benutzer. Er erübrigt die manuelle Übergabe des `authController` an Funktionen zur Berechtigungsprüfung.

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
| `canCreate` | `(collection, path) => boolean` | Prüft, ob der Benutzer berechtigt ist, Entitäten in der Collection zu erstellen. |
| `canEdit` | `(collection, path, entity) => boolean` | Prüft, ob der Benutzer berechtigt ist, die angegebene Entität zu bearbeiten. |
| `canDelete` | `(collection, path, entity) => boolean` | Prüft, ob der Benutzer berechtigt ist, die angegebene Entität zu löschen. |
| `canRead` | `(collection) => boolean` | Prüft, ob der Benutzer berechtigt ist, die Collection zu lesen. |

## `useClipboard`

Utility-Hook zum Kopieren oder Ausschneiden von Text in die Zwischenablage mit automatischer Unterstützung von Fallback-Mechanismen für ältere Browser.

> [!NOTE]
> Beachten Sie die exakte Schreibweise von `isCoppied` (mit zwei `p`) im Rückgabe-Payload.

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
| `onError` | `(err) => void` | Optional. Callback, der im Fehlerfall ausgelöst wird. |

### Rückgabewert

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `ref` | `MutableRefObject` | React-Ref zur Verknüpfung mit Input-/Textarea-Elementen, aus denen kopiert werden soll. |
| `copy` | `(text?: string) => void` | Löst das Kopieren des angegebenen Textes oder des Inhalts des Ref-Elements aus. |
| `cut` | `() => void` | Löst das Ausschneiden des Inhalts des Ref-Elements aus. |
| `isCoppied` | `boolean` | True, wenn kürzlich Text kopiert wurde. |
| `clipboard` | `string` | Der aktuell kopierte Textwert. |
| `clearClipboard` | `() => void` | Leert die Zwischenablage. |

## `useSidePanel`

Entitäten programmatisch in einem Sidepanel öffnen:

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

Methoden:

| Methode | Beschreibung |
|--------|-------------|
| `open({ path, entityId, collection })` | Eine Entität in einem Sidepanel öffnen |
| `close()` | Das aktuelle Sidepanel schließen |
| `replace({ path, entityId, collection })` | Den aktuellen Inhalt des Sidepanels ersetzen |

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

Der `action`-Slot rendert eine Schaltfläche neben der Nachricht, wo eine Rückgängig-Aktion (Undo) hingehört – das Zeitfenster, in dem ein Rückgängigmachen sinnvoll ist, entspricht genau dem Zeitraum, in dem die Snackbar auf dem Bildschirm zu sehen ist:

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

Die Snackbar schließt sich automatisch, sobald die Aktion angeklickt wird, sodass dieselbe Rückgängig-Aktion nicht zweimal ausgelöst werden kann. Zwei Snackbars mit derselben Nachricht werden beide angezeigt, wenn jede eine Aktion enthält – das Ablehnen zweier Bewerbungen hintereinander lässt Ihnen für jede davon einen Weg zurück.

## `useStorageSource`

Zugriff auf Datei-Storage-Operationen:

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

Hell-/Dunkel-Design (Light/Dark Theme) steuern:

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

Einen Seitendialog zur Auswahl von Entitäten aus einer Collection öffnen. Dies ist derselbe Hook, der intern verwendet wird, wenn eine Relation-Eigenschaft gerendert wird:

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

## `useRelationSelector`

Verwalten komplexer Beziehungsauswahlen (Relations) mit integrierter Suche, Debouncing und Paginierung.

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

### Parameter

| Option | Typ | Beschreibung |
|--------|------|-------------|
| `path` | `string` | Absoluter Collection-Pfad. |
| `collection` | `AdminCollection` | Ziel-Collection-Definition. |
| `fixedFilter` | `FilterValues` | Optional. Statische Filter zur Einschränkung der Suchergebnisse. |
| `pageSize` | `number` | Optional. Anzahl der Elemente pro Seite. (Standard: `10`). |
| `getLabelFromEntity` | `(entity) => string` | Optional. Den angezeigten Label-Text anpassen. |
| `getDescriptionFromEntity` | `(entity) => string` | Optional. Den Beschreibungstext anpassen. |

## `useRebaseClient`

Ruft die zugrunde liegende typisierte SDK-Instanz (`RebaseClient`) aus dem React-Kontext ab. Dies ist nützlich, um native SDK-Operationen (wie das Aufrufen benutzerdefinierter Endpunkte oder manuelle Uploads) innerhalb Ihrer Komponenten auszuführen.

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

Verhindert Navigation oder das Entladen der Seite, wenn Formulardaten nicht gespeicherte Änderungen aufweisen. Der Hook fragt vor dem Neuladen oder Schließen eines Tabs (`beforeunload`) nach und im Admin-Bereich unter einem React Router Data-Router (`createBrowserRouter`) über `useBlocker` auch vor der In-App-Navigation. Unter jedem anderen Router, wie etwa einem einfachen `<BrowserRouter>`, greift nur die Bestätigung auf Browser-Ebene.

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
| `when` | `boolean` | Flag zur Aktivierung der Blockierung von Seiten-/Router-Navigation. |
| `onOk` | `() => void` | Callback, der ausgelöst wird, wenn der Benutzer das Verwerfen der Änderungen bestätigt. |

### Rückgabewert

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Modal-Props zur direkten Übergabe an eine `UnsavedChangesDialog`-UI-Komponente. |
| `triggerDialog` | `() => void` | Löst das manuelle Anzeigen des Dialogs programmatisch aus. |

## `useEffectiveRoleController`

Wechselt die Rolle, für die die Navigation des Admin-Panels aufgebaut ist, ohne sich abzumelden: welche Studio-Ansichten aufgelistet werden. Es wird nichts an den Server gesendet und keine Row-Level-Security-Richtlinie (RLS) ausgewertet, sodass eine Datenansicht weiterhin anzeigt, was Sie lesen dürfen. Um RLS zu testen, verwenden Sie **Simulate access** (über Ihrem Avatar im Drawer) oder `client.simulate()` im Code; siehe [Testing access](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` stellt den Controller bereit. `useBuildEffectiveRoleController`, der Hook, der einen solchen Controller erstellte, um ihn als `effectiveRoleController` zu übergeben, ist zugunsten von Simulate access veraltet (deprecated) und gibt beim Aufruf einmalig eine Warnung aus.

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

Wechselt die Admin-Layout-Ansichtsmodi innerhalb des Admin-Panels.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Öffnet Dialogfenster imperativ von überall im Komponentenbaum.

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

Erfasst CMS-UI-Aktionen und Benutzerereignisse global.

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

- **[Frontend-Übersicht](/docs/frontend)** – React-Framework-Referenz
- **[Typisiertes SDK](/docs/sdk)** – SDK für Datenoperationen
