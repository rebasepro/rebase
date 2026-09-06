---
sourceHash: 2ed2b6947b459eef
title: Hooks-Referenz
sidebar_label: Hooks
description: React-Hooks, die von Rebase bereitgestellt werden, um auf Authentifizierung, Daten, Navigation, Seitenfenster, Speicher und UI-Zustand zuzugreifen.
---

## Übersicht

Rebase stellt React-Hooks bereit, um von jeder Komponente innerhalb des `<Rebase>` Provider-Baums auf Framework-Funktionen zuzugreifen.

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

Zugriff auf Authentifizierungszustand und -fähigkeiten:

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

Eine Liste von Entitäten einer Sammlung laden und abonnieren. Sofern der Treiber es unterstützt, wird automatisch ein Echtzeit-WebSocket-Abonnement aufgebaut, andernfalls wird auf REST-Abrufe zurückgegriffen.

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
| `path` | `string` | Absoluter Sammlungspfad (z. B. `"products"`). |
| `collection` | `CollectionConfig` | Das Objekt mit der Sammlungsdefinition. |
| `itemCount` | `number` | Optional. Anzahl der zu ladenden Entitäten (SQL-Limit). |
| `offset` | `number` | Optional. Anzahl der zu überspringenden Einträge. |
| `page` | `number` | Optional. Seitennummer (1-basiert), Alternative zu `offset`. |
| `filterValues` | `FilterValues` | Optional. Abfragefilter. Unterstützt Kurzform-Gleichheit, Tupel `[op, val]` und PostgREST-Operator-Strings. |
| `sortBy` | `[string, "asc" \| "desc"]` | Optional. Tupel aus Sortierfeld und Sortierrichtung. |
| `searchString` | `string` | Optional. Suchbegriff für die Volltextsuche. |

### Rückgabewert

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `data` | `Entity[]` | Array der geladenen Entitäten. |
| `dataLoading` | `boolean` | True, solange der erste Ladevorgang läuft. |
| `dataLoadingError` | `Error` | Fehlerobjekt, falls der Abruf fehlschlägt. |
| `noMoreToLoad` | `boolean` | True, wenn es jenseits der aktuellen Seite bzw. des Limits keine weiteren Datensätze gibt. |
| `totalCount` | `number` | Optional. Gesamtzahl der Datensätze in der Datenbank, die auf den Filter passen. |

## `useFetch`

Eine einzelne Entität per ID laden und abonnieren. Sie wird sofort aus dem Cache gerendert, wenn sie bereits über einen Sammlungsabruf geladen wurde, und im Hintergrund aktualisiert.

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
| `path` | `string` | Absoluter Sammlungspfad. |
| `entityId` | `string \| number` | Die ID der zu ladenden Entität. |
| `collection` | `CollectionConfig` | Das Objekt mit der Sammlungsdefinition. |
| `useCache` | `boolean` | Optional. Bei `true` und vorhandener Entität im Cache wird die Hintergrundaktualisierung übersprungen. (Standard: `false`). |

### Cache-Hilfsfunktionen

Rebase hält einen globalen Speicher-Cache, um Aufblitzen der UI zu vermeiden. Sie können diesen Cache direkt manipulieren:

- `populateFetchCache(path, entities)`: Füllt den Cache vorab mit einer Liste von Entitäten (z. B. nach einer Massenaktion oder einem eigenen API-Aufruf).
- `clearFetchCache()`: Leert den Cache. Empfohlen beim Abmelden eines Benutzers, damit keine Daten durchsickern.

## `usePermissions`

Hook zur Auswertung von Rollen und Berechtigungen des aktuellen Benutzers. Er nimmt Ihnen ab, den `authController` manuell an die Prüffunktionen zu übergeben.

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
| `canCreate` | `(collection, path) => boolean` | Prüft, ob der Benutzer in der Sammlung Entitäten anlegen darf. |
| `canEdit` | `(collection, path, entity) => boolean` | Prüft, ob der Benutzer die angegebene Entität bearbeiten darf. |
| `canDelete` | `(collection, path, entity) => boolean` | Prüft, ob der Benutzer die angegebene Entität löschen darf. |
| `canRead` | `(collection) => boolean` | Prüft, ob der Benutzer die Sammlung lesen darf. |

## `useClipboard`

Hilfs-Hook zum Kopieren oder Ausschneiden von Text in die Zwischenablage, mit automatischer Unterstützung für Fallback-Mechanismen in älteren Browsern.

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
| `copiedDuration` | `number` | Optional. Zeit in Millisekunden, bis `isCoppied` wieder auf `false` zurückgesetzt wird. |
| `onSuccess` | `(text) => void` | Optional. Callback, der bei erfolgreichem Kopieren ausgelöst wird. |
| `onError` | `(err) => void` | Optional. Callback, der bei einem Fehler ausgelöst wird. |

### Rückgabewert

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `ref` | `MutableRefObject` | React-Ref, die an Input- oder Textarea-Elemente gehängt wird, aus denen kopiert werden soll. |
| `copy` | `(text?: string) => void` | Kopiert den übergebenen Text oder den Inhalt des Ref-Elements. |
| `cut` | `() => void` | Schneidet den Inhalt des Ref-Elements aus. |
| `isCoppied` | `boolean` | True, wenn kürzlich Text kopiert wurde. |
| `clipboard` | `string` | Der aktuell kopierte Textwert. |
| `clearClipboard` | `() => void` | Leert die Zwischenablage. |

## `useSidePanel`

Entitäten programmatisch in einem Seitenfenster öffnen:

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
| `open({ path, entityId, collection })` | Eine Entität in einem Seitenfenster öffnen |
| `close()` | Das aktuelle Seitenfenster schließen |
| `replace({ path, entityId, collection })` | Den Inhalt des aktuellen Seitenfensters ersetzen |

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

`open()` nimmt `{ type, title?, message, autoHideDuration?, action? }` entgegen.

Der `action`-Slot rendert eine Schaltfläche neben der Meldung, und genau dorthin
gehört „Rückgängig“ — das Zeitfenster, in dem Rückgängig überhaupt etwas
bedeutet, ist das Zeitfenster, in dem die Snackbar zu sehen ist:

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

Die Snackbar schließt sich selbst, sobald die Aktion angeklickt wurde, dasselbe
Rückgängig kann also nicht zweimal auslösen. Zwei Snackbars mit derselben Meldung
erscheinen beide, wenn jede eine Aktion hat — lehnen Sie zwei Bewerbungen
nacheinander ab, bleibt Ihnen von jeder ein Weg zurück.

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

Hell-/Dunkel-Thema steuern:

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

Öffnen eines Seitendialogs zur Auswahl von Entitäten aus einer Sammlung. Dies ist derselbe Hook, der intern verwendet wird, wenn eine Relationseigenschaft gerendert wird:

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

Zugriff auf Navigationszustand und aufgelöste Sammlungen:

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

Komplexe Relationsauswahlen verwalten, mit eingebauter Suche, Entprellung und Paginierung.

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
| `path` | `string` | Absoluter Sammlungspfad. |
| `collection` | `CollectionConfig` | Definition der Zielsammlung. |
| `fixedFilter` | `FilterValues` | Optional. Statische Filter, die die Suchergebnisse einschränken. |
| `pageSize` | `number` | Optional. Anzahl der Einträge pro Seite. (Standard: `10`). |
| `getLabelFromEntity` | `(entity) => string` | Optional. Passt den angezeigten Beschriftungstext an. |
| `getDescriptionFromEntity` | `(entity) => string` | Optional. Passt den Beschreibungstext an. |

## `useRebaseClient`

Holt die zugrunde liegende Client-SDK-Instanz (`RebaseClient`) aus dem React-Kontext. Nützlich, um innerhalb Ihrer Komponenten rohe SDK-Operationen auszuführen — etwa eigene Endpunkte aufzurufen oder manuell hochzuladen.

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

Verhindert Navigation oder das Verlassen der Seite, solange ein Formular ungespeicherte Änderungen hat. Interne React-Router-Navigation wird automatisch über `useBlocker` abgefangen, Reloads auf Browserebene über `beforeunload`.

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
| `when` | `boolean` | Flag, das die Blockierung von Seiten- bzw. Router-Navigation aktiviert. |
| `onOk` | `() => void` | Callback, der ausgelöst wird, wenn der Benutzer das Verwerfen der Änderungen bestätigt. |

### Rückgabewert

| Eigenschaft | Typ | Beschreibung |
|----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Modal-Props, die direkt an eine `UnsavedChangesDialog`-UI-Komponente gereicht werden. |
| `triggerDialog` | `() => void` | Zeigt den Dialog programmatisch an. |

## `useEffectiveRoleController`

Rollen zur Laufzeit wechseln, um Berechtigungen vorab anzusehen und Row-Level-Security-Richtlinien (RLS) lokal zu testen, ohne sich abzumelden.

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

Wechselt die Layout-Ansichtsmodi innerhalb des Admin-Panels.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Dialogfenster imperativ von überall im Komponentenbaum öffnen.

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

Erfasst UI-Aktionen des CMS und Benutzerereignisse global.

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

- **[Frontend-Übersicht](/docs/frontend)** — React-Framework-Referenz
- **[Client SDK](/docs/sdk)** — SDK für Datenoperationen
