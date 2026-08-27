---
title: Référence des Hooks
sidebar_label: Hooks
description: Hooks React fournis par Rebase pour accéder à l'authentification, aux données, à la navigation, aux panneaux latéraux, au stockage et à l'état de l'interface utilisateur.
---

## Aperçu

Rebase fournit des hooks React pour accéder aux fonctionnalités du framework depuis n'importe quel composant au sein de l'arbre de fournisseurs `<Rebase>`.

## `useRebaseContext`

Le hook maître — accédez à tout :

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

Accéder à l'état d'authentification :

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

Ouvrir des entités par programmation dans un panneau latéral :

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

Méthodes :

| Méthode | Description |
|--------|-------------|
| `open({ path, entityId, collection })` | Ouvre une entité dans un panneau latéral |
| `close()` | Ferme le panneau latéral actuel |
| `replace({ path, entityId, collection })` | Remplace le contenu du panneau latéral actuel |

## `useSnackbarController`

Afficher les notifications de type "toast" :

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

Accéder aux opérations de stockage de fichiers :

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

Contrôler le thème clair/sombre :

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

Ouvre une boîte de dialogue latérale pour sélectionner des entités d'une collection. C'est le même hook utilisé en interne lorsqu'une propriété de relation est rendue :

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

Accéder à l'état de navigation et aux collections résolues :

```typescript
import { useNavigationStateController } from "@rebasepro/cms";

function MyComponent() {
    const navigation = useNavigationStateController();

    navigation.views              // Custom views
    navigation.adminViews         // Admin-mode views
    navigation.topLevelNavigation // Resolved top-level entries
}
```

## Prochaines étapes

- **[Aperçu du Frontend](/docs/frontend)** — Référence du framework React
- **[SDK Client](/docs/sdk)** — SDK d'opérations de données
