---
sourceHash: 2ed2b6947b459eef
title: Riferimento degli Hook
sidebar_label: Hooks
description: Hook React forniti da Rebase per accedere ad autenticazione, dati, navigazione, pannelli laterali, storage e stato della UI.
---

## Panoramica

Rebase fornisce hook React per accedere alle funzionalità del framework da qualsiasi componente all'interno dell'albero del provider `<Rebase>`.

## `useRebaseContext`

L'hook principale — accesso a tutto:

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

Accedere allo stato e alle capacità di autenticazione:

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

Carica un elenco di entità di una collezione e vi si sottoscrive. Se il driver lo supporta stabilisce automaticamente una sottoscrizione WebSocket in tempo reale, altrimenti ripiega su richieste REST.

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

### Parametri

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `path` | `string` | Percorso assoluto della collezione (es. `"products"`). |
| `collection` | `CollectionConfig` | L'oggetto di definizione della collezione. |
| `itemCount` | `number` | Opzionale. Numero di entità da caricare (limite SQL). |
| `offset` | `number` | Opzionale. Numero di elementi da saltare. |
| `page` | `number` | Opzionale. Numero di pagina (a partire da 1), alternativa a `offset`. |
| `filterValues` | `FilterValues` | Opzionale. Filtri di query. Supporta l'uguaglianza abbreviata, le tuple `[op, val]` e le stringhe di operatore PostgREST. |
| `sortBy` | `[string, "asc" \| "desc"]` | Opzionale. Tupla campo di ordinamento e direzione. |
| `searchString` | `string` | Opzionale. Query per la ricerca full-text. |

### Valore restituito

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `data` | `Entity[]` | Array delle entità caricate. |
| `dataLoading` | `boolean` | True se il caricamento iniziale è in corso. |
| `dataLoadingError` | `Error` | Oggetto errore se la richiesta fallisce. |
| `noMoreToLoad` | `boolean` | True se non ci sono altri record oltre alla pagina o al limite correnti. |
| `totalCount` | `number` | Opzionale. Il conteggio totale dei record nel database che corrispondono al filtro. |

## `useFetch`

Carica una singola entità per ID e vi si sottoscrive. Viene renderizzata subito dalla cache se è già stata caricata da una richiesta di collezione, e poi aggiornata in background.

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

### Parametri

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `path` | `string` | Percorso assoluto della collezione. |
| `entityId` | `string \| number` | L'ID dell'entità da caricare. |
| `collection` | `CollectionConfig` | L'oggetto di definizione della collezione. |
| `useCache` | `boolean` | Opzionale. Se `true` e l'entità è in cache, salta l'aggiornamento in background. (Predefinito: `false`). |

### Utilità della cache

Rebase mantiene una cache globale in memoria per evitare sfarfallii della UI. Puoi manipolarla direttamente:

- `populateFetchCache(path, entities)`: Popola in anticipo la cache con un elenco di entità (es. dopo un'azione massiva o una chiamata a un'API personalizzata).
- `clearFetchCache()`: Svuota la cache. È consigliabile chiamarla al logout dell'utente, per evitare fughe di dati.

## `usePermissions`

Hook per valutare ruoli e permessi dell'utente corrente. Ti evita di passare manualmente l'`authController` alle funzioni di verifica dei permessi.

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

### Valore restituito

| Metodo | Firma | Descrizione |
|--------|-----------|-------------|
| `canCreate` | `(collection, path) => boolean` | Verifica se l'utente può creare entità nella collezione. |
| `canEdit` | `(collection, path, entity) => boolean` | Verifica se l'utente può modificare l'entità indicata. |
| `canDelete` | `(collection, path, entity) => boolean` | Verifica se l'utente può eliminare l'entità indicata. |
| `canRead` | `(collection) => boolean` | Verifica se l'utente può leggere la collezione. |

## `useClipboard`

Hook di utilità per copiare o tagliare testo negli appunti, con supporto automatico dei meccanismi di fallback sui browser più vecchi.

> [!NOTE]
> Nota l'ortografia esatta di `isCoppied` (con due `p`) nel valore restituito.

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

### Parametri

| Opzione | Tipo | Descrizione |
|--------|------|-------------|
| `copiedDuration` | `number` | Opzionale. Tempo in millisecondi prima di riportare `isCoppied` a `false`. |
| `onSuccess` | `(text) => void` | Opzionale. Callback attivata a copia riuscita. |
| `onError` | `(err) => void` | Opzionale. Callback attivata in caso di errore. |

### Valore restituito

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `ref` | `MutableRefObject` | Ref React da collegare agli elementi input/textarea da cui copiare. |
| `copy` | `(text?: string) => void` | Copia il testo indicato, o il contenuto dell'elemento del ref. |
| `cut` | `() => void` | Taglia il contenuto dell'elemento del ref. |
| `isCoppied` | `boolean` | True se del testo è stato copiato di recente. |
| `clipboard` | `string` | Il valore di testo attualmente copiato. |
| `clearClipboard` | `() => void` | Svuota gli appunti. |

## `useSidePanel`

Aprire entità a livello di codice in un pannello laterale:

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

Metodi:

| Metodo | Descrizione |
|--------|-------------|
| `open({ path, entityId, collection })` | Aprire un'entità in un pannello laterale |
| `close()` | Chiudere il pannello laterale corrente |
| `replace({ path, entityId, collection })` | Sostituire il contenuto del pannello laterale corrente |

## `useSnackbarController`

Mostrare notifiche toast:

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

`open()` accetta `{ type, title?, message, autoHideDuration?, action? }`.

Lo slot `action` renderizza un pulsante accanto al messaggio, ed è lì che va
l'annulla — la finestra in cui annullare significa qualcosa è la finestra in cui
la snackbar è a schermo:

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

La snackbar si chiude da sola non appena l'azione viene cliccata, quindi lo
stesso annulla non può scattare due volte. Due snackbar con lo stesso messaggio
compaiono entrambe quando ciascuna ha un'azione — rifiutare due candidature di
fila ti lascia una via di ritorno da ognuna.

## `useStorageSource`

Accedere alle operazioni di storage dei file:

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

Controllare il tema chiaro/scuro:

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

Aprire una finestra di dialogo laterale per selezionare entità da una collezione. È lo stesso hook usato internamente quando viene renderizzata una proprietà di relazione:

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

Accedere allo stato di navigazione e alle collezioni risolte:

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

Gestire selezioni di relazioni complesse, con ricerca, debouncing e paginazione integrati.

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

### Parametri

| Opzione | Tipo | Descrizione |
|--------|------|-------------|
| `path` | `string` | Percorso assoluto della collezione. |
| `collection` | `CollectionConfig` | Definizione della collezione di destinazione. |
| `fixedFilter` | `FilterValues` | Opzionale. Filtri statici per restringere i risultati della ricerca. |
| `pageSize` | `number` | Opzionale. Numero di elementi per pagina. (Predefinito: `10`). |
| `getLabelFromEntity` | `(entity) => string` | Opzionale. Personalizza il testo dell'etichetta mostrata. |
| `getDescriptionFromEntity` | `(entity) => string` | Opzionale. Personalizza il testo della descrizione. |

## `useRebaseClient`

Recupera dal contesto React l'istanza del client SDK sottostante (`RebaseClient`). Utile per invocare operazioni SDK dirette (come chiamare endpoint personalizzati o fare upload manuali) dentro i tuoi componenti.

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

Impedisce la navigazione o l'abbandono della pagina quando un form ha modifiche non salvate. Intercetta automaticamente la navigazione interna di React Router tramite `useBlocker` e i ricaricamenti a livello di browser tramite `beforeunload`.

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

### Parametri

| Parametro | Tipo | Descrizione |
|-----------|------|-------------|
| `when` | `boolean` | Flag per attivare il blocco della navigazione di pagina/router. |
| `onOk` | `() => void` | Callback attivata quando l'utente conferma di scartare le modifiche. |

### Valore restituito

| Proprietà | Tipo | Descrizione |
|----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Prop della modale, da passare direttamente a un componente UI `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Mostra la finestra di dialogo a livello di codice. |

## `useEffectiveRoleController`

Cambiare ruolo a runtime per vedere in anteprima i permessi e testare in locale le policy di Row-Level Security (RLS) senza disconnettersi.

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

Cambia le modalità di visualizzazione del layout all'interno del pannello di amministrazione.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Aprire finestre di dialogo in modo imperativo da qualsiasi punto dell'albero dei componenti.

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

Catturare globalmente le azioni della UI del CMS e gli eventi utente.

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

## Passi Successivi

- **[Panoramica del Frontend](/docs/frontend)** — Riferimento del framework React
- **[SDK client](/docs/sdk)** — SDK per le operazioni sui dati
