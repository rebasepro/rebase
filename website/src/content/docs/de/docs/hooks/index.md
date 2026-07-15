---
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

    context.dataSource          // Data operations
    context.storageSource       // File operations
    context.authController      // Auth state
    context.navigation          // Navigation state
    context.sideEntityController // Side panel control
    context.snackbarController  // Toast notifications
}
```

## `useAuthController`

Zugriff auf den Authentifizierungszustand:

```typescript
import { useAuthController } from "@rebasepro/app";

function UserMenu() {
    const auth = useAuthController();

    auth.user            // Current user (or null)
    auth.initialLoading  // Loading initial session
    auth.signOut()       // Log out
    auth.getAuthToken()  // Get JWT for API calls
    auth.extra           // Additional user data (roles, etc.)
}
```

## `useSideEntityController`

Entitäten programmatisch in einem Seitenfenster öffnen:

```typescript
import { useSideEntityController } from "@rebasepro/app";

function OpenProductButton({ productId }) {
    const sideEntityController = useSideEntityController();

    return (
        <button onClick={() => {
            sideEntityController.open({
                path: "products",
                entityId: productId,
                collection: productsCollection
            });
        }}>
            Produkt öffnen
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

## `useStorageSource`

Zugriff auf Dateispeicheroperationen:

```typescript
import { useStorageSource } from "@rebasepro/app";

function FileUploader() {
    const storage = useStorageSource();

    const upload = async (file: File) => {
        const result = await storage.uploadFile({
            file,
            fileName: file.name,
            path: "documents"
        });
        const url = await storage.getDownloadURL(result.path);
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
        <button onClick={mode.toggleMode}>
            Aktuell: {mode.mode} {/* "light" | "dark" */}
        </button>
    );
}
```

## `useEntitySelectionDialog`

Öffnen eines Seitendialogs zur Auswahl von Entitäten aus einer Sammlung. Dies ist derselbe Hook, der intern verwendet wird, wenn eine Relationseigenschaft gerendert wird:

```typescript
import { useEntitySelectionDialog } from "@rebasepro/app";

function SelectProduct() {
    const selectionDialog = useEntitySelectionDialog({
        path: "products",
        collection: productsCollection,
        onSingleEntitySelected: (entity) => {
            console.log("Selected:", entity);
        }
    });

    return <button onClick={selectionDialog.open}>Produkt auswählen</button>;
}
```

## `useNavigationController`

Zugriff auf Navigationszustand und aufgelöste Sammlungen:

```typescript
import { useNavigationController } from "@rebasepro/app";

function MyComponent() {
    const navigation = useNavigationController();

    navigation.collections     // All registered collections
    navigation.views           // Custom views
    navigation.adminViews      // Admin-mode views
    navigation.getCollection(path) // Get collection for a path
}
```

## Nächste Schritte

- **[Frontend-Übersicht](/docs/frontend)** — React-Framework-Referenz
- **[Client SDK](/docs/sdk)** — SDK für Datenoperationen
---
