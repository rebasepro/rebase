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

## `useSidePanel`

Entitäten programmatisch in einem Seitenfenster öffnen:

```typescript
import { useSidePanel } from "@rebasepro/admin";

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
            Aktuell: {mode.mode} {/* "light" | "dark" */}
        </button>
    );
}
```

## `useSelectionDialog`

Öffnen eines Seitendialogs zur Auswahl von Entitäten aus einer Sammlung. Dies ist derselbe Hook, der intern verwendet wird, wenn eine Relationseigenschaft gerendert wird:

```typescript
import { useSelectionDialog } from "@rebasepro/admin";

function SelectProduct() {
    const selectionDialog = useSelectionDialog({
        path: "products",
        collection: productsCollection,
        onSingleEntitySelected: (entity) => {
            console.log("Selected:", entity);
        }
    });

    return <button onClick={selectionDialog.open}>Produkt auswählen</button>;
}
```

## `useNavigationStateController`

Zugriff auf Navigationszustand und aufgelöste Sammlungen:

```typescript
import { useNavigationStateController } from "@rebasepro/admin";

function MyComponent() {
    const navigation = useNavigationStateController();

    navigation.views              // Custom views
    navigation.adminViews         // Admin-mode views
    navigation.topLevelNavigation // Resolved top-level entries
}
```

## Nächste Schritte

- **[Frontend-Übersicht](/docs/frontend)** — React-Framework-Referenz
- **[Client SDK](/docs/sdk)** — SDK für Datenoperationen
---
