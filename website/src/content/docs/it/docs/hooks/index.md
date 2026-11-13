---
sourceHash: b247fb716c8348a7
title: Riferimento agli hook
sidebar_label: Hook
description: Hook di React forniti da Rebase per accedere ad autenticazione, dati, navigazione, pannelli laterali, archiviazione e stato dell'interfaccia utente.
---

## Panoramica

Rebase fornisce hook di React per accedere alle funzionalità del framework da qualsiasi componente all'interno dell'albero del provider `<Rebase>`.

## `useRebaseContext`

<span class="since-badge" data-since="0.31">Da 0.31</span>

L'hook principale — accedi a tutto:

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

`context.data` è lo stesso layer piatto letto dagli hook per le righe: `context.data.orders.find()`
si risolve in `{ data: rows, meta }`, una data corrisponde alla sua stringa ISO e una relazione belongsTo
alla sua colonna foreign key, esattamente come vengono restituiti da `context.data` di una callback
di backend e da `client.data`. I suoi metodi `create`, `update` e `delete` eseguono i
`browserCallbacks` della tabella (definiti nel suo `customizeTable`) e aggiornano ogni vista della collection,
proprio come fa `useRowWrites`. Utilizzalo nei casi in cui lo stato di React non sia adatto: l'`onClick`
di un'azione su un'entità, una callback o un builder di collection.

## `useAuthController`

Accedi allo stato di autenticazione e alle sue funzionalità:

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

## Righe: `useRows`, `useRow`, `useRowCount`, `useAggregate`, `useRowWrites`

<span class="since-badge" data-since="0.31">Da 0.31</span>

Leggi e scrivi le righe di una collection nel formato in cui le invia il server: date come stringhe ISO, un belongsTo sotto la sua colonna di foreign key (`author_id`). È la stessa struttura restituita da `client.data` e `context.data`, quindi il codice scritto con questi hook risulta naturale come quello scritto direttamente con l'SDK.

Le righe di ciascuna collection provengono dalla sorgente dati dichiarata (`dataSource`, vedi [Origini dati multiple](/docs/backend/multiple-sources)), mentre quelle di qualsiasi altra collection provengono dalla sorgente dati predefinita dell'app. In presenza di un `client`, l'impostazione predefinita è `client.data`, e le aggregazioni avvengono tramite HTTP. In assenza di un client, viene utilizzato il driver della sorgente dati predefinita (un driver Firebase, ad esempio). Laddove la sorgente dati supporti le sottoscrizioni, le righe rimangono aggiornate in tempo reale. Dove non è supportato, ogni hook di una collection effettua nuovamente la lettura dopo ogni scrittura su di essa all'interno dello stesso `<Rebase>` (tramite `useRowWrites`, `context.data`, un form di record o una vista della collection) e dopo ogni modifica notificata dal driver della sorgente dati. Lo stesso vale per le viste delle collection del pannello di amministrazione. Le opzioni vengono confrontate per valore, pertanto un oggetto inline non attiva una nuova lettura a ogni render. `error` è una stringa contenente il messaggio, e una scrittura che fallisce genera anche un rifiuto della promise (reject).

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

| Hook | Restituisce |
|------|-------------|
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` rappresenta la dimensione della pagina e `loadMore` aggiunge una pagina alla stessa lettura, fino a un massimo di 1000 righe. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` può essere `undefined`, nel qual caso non viene letto nulla. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. I parametri e il risultato sono gli stessi di `client.data.<collection>.aggregate()`. Una sorgente dati che non supporta le aggregazioni imposta `error` e non restituisce mai un risultato vuoto. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Ogni scrittura completata con successo aggiorna ogni hook per le righe e ogni vista della collection corrispondente. Una scrittura esegue i `browserCallbacks` della tabella (da `customizeTable`) esattamente come il salvataggio del form del record: `beforeSave` (che può modificare la riga o lanciare un errore per interrompere la scrittura), seguito da `afterSave` o `afterSaveError`; `beforeDelete`, seguito da `afterDelete`. A ciascuna callback vengono passate le righe nel formato restituito dal server. |

## `usePermissions`

Hook per valutare i ruoli e i permessi dell'utente corrente. Astrae la necessità di passare manualmente `authController` alle funzioni di verifica dei permessi.

```tsx
import React from "react";
import { usePermissions } from "@rebasepro/app";
import { useCollectionRegistryController } from "@rebasepro/cms";

function CreateProductButton() {
    const { canCreate } = usePermissions();
    // The panel's collection for the `products` table, as the signed-in user was served it.
    const products = useCollectionRegistryController().getCollection("products");

    const allowedToCreate = products !== undefined && canCreate(products, "products");

    return (
        <button disabled={!allowedToCreate}>
            Create Product
        </button>
    );
}
```

Il risultato proviene dalla row-level security della tabella, valutata nel browser
nello stesso modo in cui il pannello decide quali controlli mostrare (vedi
[chi visualizza quali controlli](/docs/collections/#who-sees-which-controls)). È
comunque sempre il database a decidere per ciascuna scrittura.

### Valore restituito

| Metodo | Firma | Descrizione |
|--------|-------|-------------|
| `canCreate` | `(collection, path) => boolean` | Verifica se l'utente è autorizzato a creare entità nella collection. |
| `canEdit` | `(collection, path, row) => boolean` | Verifica se l'utente è autorizzato a modificare la riga indicata, nel formato restituito da `useRows` o `context.data`. `null` effettua la verifica per la collection nel suo complesso, senza considerare una riga specifica. |
| `canDelete` | `(collection, path, row) => boolean` | Verifica se l'utente è autorizzato a eliminare la riga indicata. `null` effettua la verifica per la collection nel suo complesso, senza considerare una riga specifica. |
| `canRead` | `(collection) => boolean` | Verifica se l'utente è autorizzato a leggere la collection. |

## `useClipboard`

Hook di utilità per copiare o tagliare testo negli appunti (clipboard), con supporto automatico ai meccanismi di fallback per i browser più datati.

> [!NOTE]
> Nota l'esatta ortografia di `isCoppied` (con due `p`) nel payload restituito.

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
|---------|------|-------------|
| `copiedDuration` | `number` | Opzionale. Tempo in millisecondi prima di reimpostare `isCoppied` su `false`. |
| `onSuccess` | `(text) => void` | Opzionale. Callback attivata in caso di copia riuscita. |
| `onError` | `(err) => void` | Opzionale. Callback attivata in caso di errore. |

### Valore restituito

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `ref` | `MutableRefObject` | Ref di React da associare a elementi input/textarea da cui copiare. |
| `copy` | `(text?: string) => void` | Attiva la copia del testo specificato o del contenuto dell'elemento associato al ref. |
| `cut` | `() => void` | Attiva il taglio del contenuto dell'elemento associato al ref. |
| `isCoppied` | `boolean` | True se il testo è stato copiato di recente. |
| `clipboard` | `string` | Il valore testuale attualmente copiato. |
| `clearClipboard` | `() => void` | Svuota gli appunti. |

## `useSidePanel`

Apri a livello di programmazione le entità in un pannello laterale:

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

Metodi:

| Metodo | Descrizione |
|--------|-------------|
| `open({ path, id, collection })` | Apre un'entità in un pannello laterale |
| `close()` | Chiude il pannello laterale corrente |
| `replace({ path, id, collection })` | Sostituisce il contenuto del pannello laterale corrente |

## `useSnackbarController`

Mostra notifiche toast:

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

Lo slot `action` esegue il rendering di un pulsante accanto al messaggio, il punto ideale
in cui inserire un'azione di annullamento (undo): la finestra temporale in cui ha senso annullare
coincide con il tempo in cui la snackbar rimane visibile sullo schermo:

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

La snackbar si chiude automaticamente dopo il clic sull'azione, evitando così che lo stesso
annullamento venga eseguito due volte. Due snackbar contenenti lo stesso messaggio vengono mostrate
entrambe se ciascuna include un'azione: rifiutare due candidature di fila ti consente di annullare
ciascuna operazione separatamente.

## `useStorageSource`

Accedi alle operazioni di archiviazione dei file (storage):

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
            Current: {mode.mode} {/* "light" | "dark" */}
        </button>
    );
}
```

## `useSelectionDialog`

Apre una finestra di dialogo laterale per selezionare righe da una collection. Le righe vengono
fornite nel formato restituito dal server (la stessa struttura di `useRows`) assieme ai rispettivi ID
(le stringhe accettate da `selectedIds` e `useSidePanel().open`):

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

Con `multiselect: true`, `onMultipleRowsSelected(rows, ids)` notifica ogni selezione/deselezione
e `onSelectionDone(rows, ids)` comunica la selezione finale una sola volta, quando viene premuto Fine (Done) —
usalo quando l'azione sulla selezione comporta una scrittura. `selectedIds` indica le righe mostrate come
selezionate, e in cima, all'apertura del dialogo.

## `useSelectionController`

Una selezione di righe di una collection gestita direttamente: passala a una vista come
`selectionController` (su un `CollectionPanel`, tramite `collectionOverrides`) e leggi ciò che l'utente seleziona:

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

`selection.selection` è `{ type: "rows", ids, rows }` per le righe selezionate, oppure
`{ type: "query", query, excludedIds, count }` quando viene scelta l'opzione "tutti i corrispondenti";
`resolveSelection({ selection: selection.selection, data: context.data,
collection })` legge le righe di una selezione basata su query e restituisce `{ rows, ids }` in entrambe le modalità. `isSelected(id)`,
`toggleSelection(row)`, `setSelectedRows(rows)` e `clearSelection()` consentono di modificarla.

## `useNavigationStateController`

Accedi allo stato di navigazione e alle collection risolte:

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

Recupera l'istanza SDK tipizzata sottostante (`RebaseClient`) dal contesto React. Questo è utile per richiamare direttamente le operazioni dell'SDK (come la chiamata a endpoint personalizzati o caricamenti manuali) all'interno dei tuoi componenti.

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

Impedisce la navigazione o lo scaricamento della pagina quando i dati del form presentano modifiche non salvate. Richiede conferma prima del ricaricamento o della chiusura della scheda (`beforeunload`) e, all'interno del pannello admin configurato con un data router di React Router (`createBrowserRouter`), anche prima della navigazione in-app tramite `useBlocker`. Con qualsiasi altro router, come un semplice `<BrowserRouter>`, viene applicato solo il prompt a livello di browser.

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
| `when` | `boolean` | Flag per attivare il blocco della navigazione della pagina/router. |
| `onOk` | `() => void` | Callback attivata quando l'utente conferma lo scarto delle modifiche. |

### Valore restituito

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props del modale da passare direttamente a un componente UI `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Attiva manualmente la visualizzazione del dialogo a livello di programmazione. |

## `useEffectiveRoleController`

Consente di cambiare il ruolo per cui è costruita la navigazione del pannello di amministrazione, senza effettuare il logout:
determina quali viste Studio vengono elencate. Non invia nulla al server e non valuta le policy di
row-level security, quindi una vista dati continuerà a mostrare solo ciò che hai i permessi di leggere. Per
testare la RLS, usa **Simulate access** (sopra il tuo avatar nel drawer) o `client.simulate()` da
codice; vedi [Testing access](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` fornisce il controller. `useBuildEffectiveRoleController`, l'hook
che ne costruiva uno da passare come `effectiveRoleController`, è deprecato a favore di
Simulate access e genera un avviso la prima volta che viene chiamato.

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

Consente di alternare le modalità di visualizzazione del layout all'interno del pannello di amministrazione.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Apre finestre di dialogo in modo imperativo da qualsiasi punto dell'albero dei componenti.

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

Cattura le azioni dell'interfaccia utente del CMS e gli eventi utente a livello globale.

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

## Passaggi successivi

- **[Panoramica frontend](/docs/frontend)** — Riferimento al framework React
- **[SDK tipizzato](/docs/sdk)** — SDK per le operazioni sui dati
