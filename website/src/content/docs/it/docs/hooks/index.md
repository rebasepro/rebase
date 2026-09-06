---
sourceHash: f54d8319cbbee30f
title: Riferimento agli Hook
sidebar_label: Hook
description: Hook React forniti da Rebase per accedere all'autenticazione, ai dati, alla navigazione, ai pannelli laterali, allo storage e allo stato dell'interfaccia utente.
---

## Panoramica

Rebase fornisce hook React per accedere alle funzionalità del framework da qualsiasi componente all'interno dell'albero del provider `<Rebase>`.

## `useRebaseContext`

L'hook principale — accede a tutto:

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

Accede allo stato di autenticazione:

```typescript
import { useAuthController } from "@rebasepro/app";

function UserMenu() {
    const auth = useAuthController();

    auth.user            // Utente corrente (o null)
    auth.initialLoading  // Caricamento della sessione iniziale
    auth.signOut()       // Disconnettersi
    auth.getAuthToken()  // Ottieni JWT per le chiamate API
    auth.extra           // Dati utente aggiuntivi (ruoli, ecc.)
}
```

## `useSidePanel`

Apre entità programmaticamente in un pannello laterale:

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
            Apri Prodotto
        </button>
    );
}
```

Metodi:

| Metodo | Descrizione |
|--------|-------------|
| `open({ path, entityId, collection })` | Apri un'entità in un pannello laterale |
| `close()` | Chiudi il pannello laterale corrente |
| `replace({ path, entityId, collection })` | Sostituisci il contenuto del pannello laterale corrente |

## `useSnackbarController`

Mostra notifiche toast:

```typescript
import { useSnackbarController } from "@rebasepro/app";

function SaveButton() {
    const snackbar = useSnackbarController();

    const handleSave = async () => {
        try {
            await saveData();
            snackbar.open({ type: "success", message: "Salvato con successo!" });
        } catch (error) {
            snackbar.open({ type: "error", message: "Salvataggio fallito" });
        }
    };
}
```

## `useStorageSource`

Accede alle operazioni di storage dei file:

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

Controlla il tema chiaro/scuro:

```typescript
import { useModeController } from "@rebasepro/app";

function ThemeToggle() {
    const mode = useModeController();

    return (
        <button onClick={() => mode.setMode(mode.mode === "dark" ? "light" : "dark")}>
            Corrente: {mode.mode} {/* "light" | "dark" */}
        </button>
    );
}
```

## `useSelectionDialog`

Apre un dialogo laterale per la selezione di entità da una collezione. Questo è lo stesso hook utilizzato internamente quando viene renderizzata una proprietà di relazione:

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

    return <button onClick={selectionDialog.open}>Seleziona Prodotto</button>;
}
```

## `useNavigationStateController`

Accede allo stato di navigazione e alle collezioni risolte:

```typescript
import { useNavigationStateController } from "@rebasepro/cms";

function MyComponent() {
    const navigation = useNavigationStateController();

    navigation.collections     // Tutte le collezioni registrate
    navigation.views           // Viste personalizzate
    navigation.adminViews      // Viste in modalità admin
    navigation.getCollection(path) // Ottieni la collezione per un percorso
}
```

## Prossimi Passi

- **[Frontend Overview](/docs/frontend)** — Riferimento al framework React
- **[Client SDK](/docs/sdk)** — SDK per operazioni sui dati

---
