---
sourceHash: e73caf2e48ec0dd6
title: Riferimento agli Hook
sidebar_label: Hook
description: Hook React forniti da Rebase per accedere ad autenticazione, dati, navigazione, pannelli laterali, archiviazione e stato dell'interfaccia utente.
---

## Panoramica

Rebase fornisce hook React per accedere alle funzionalità del framework da qualsiasi componente all'interno dell'albero del provider `<Rebase>`.

## `useRebaseContext`

<span class="since-badge" data-since="0.29">Da 0.29</span>
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

`context.data` è lo stesso livello flat letto dagli hook delle righe: `context.data.orders.find()`
si risolve in `{ data: rows, meta }`, una data è la sua stringa ISO e un belongsTo è la sua
colonna foreign-key, esattamente come vengono restituiti da `context.data` e
`client.data` di un callback di backend. I suoi metodi `create`, `update` e `delete` eseguono i
`admin.browserCallbacks` della collection e aggiornano ogni vista della collection,
proprio come fa `useRowWrites`. Usalo dove lo stato di React non è adatto:
nell'`onClick` dell'azione di un'entità, in un callback, o in un collection builder.

## `useAuthController`

Accedi allo stato di autenticazione e alle relative funzionalità:

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

Leggi e scrivi le righe di una collection nel formato in cui le invia il server: date come stringhe ISO, un belongsTo sotto la sua colonna foreign-key (`author_id`). È lo stesso formato restituito da `client.data` e `context.data`, quindi il codice scritto con questi hook si legge come codice scritto direttamente per l'SDK.

Le righe di ogni collection provengono dall'origine dati che essa dichiara (`dataSource`, vedi [Multiple data sources](/docs/backend/multiple-sources)), mentre quelle di qualsiasi altra collection provengono dalla data source predefinita dell'app. In presenza di un `client`, il valore predefinito è `client.data` e le aggregazioni passano tramite HTTP. In assenza di un client, si tratta del driver della data source predefinita (un driver Firebase, ad esempio). Dove la data source supporta le sottoscrizioni, le righe rimangono aggiornate in tempo reale. Dove non è possibile, ogni hook di una collection effettua una nuova lettura dopo ogni scrittura su di essa all'interno dello stesso `<Rebase>` (tramite `useRowWrites`, `context.data`, un form di record o una vista della collection) e dopo ogni modifica segnalata dal driver della data source. Lo stesso vale per le viste della collection dell'admin. Le opzioni vengono confrontate per valore, quindi un oggetto inline non attiva una nuova lettura a ogni render. `error` è una stringa di messaggio e una scrittura non riuscita genera anche un reject.

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

| Hook | Valore restituito |
|------|-------------------|
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` è la dimensione della pagina e `loadMore` aggiunge una pagina alla stessa lettura, fino a un massimo di 1000 righe. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` può essere `undefined`, nel qual caso non viene letto nulla. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. I parametri e il risultato sono quelli di `client.data.<collection>.aggregate()`. Una data source che non può aggregare imposta `error` e non restituisce mai un risultato vuoto. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Ogni scrittura completata con successo aggiorna ogni hook di riga e ogni vista della collection associata. Una scrittura esegue i `admin.browserCallbacks` della collection esattamente come fa il salvataggio del form del record: `beforeSave` (che può modificare la riga o generare un errore per interrompere la scrittura), poi `afterSave` o `afterSaveError`; `beforeDelete`, poi `afterDelete`. A ciascuno vengono passate le righe nel formato inviato dal server. |

## `usePermissions`

Hook per valutare ruoli e permessi per l'utente corrente. Elimina la necessità di passare manualmente `authController` alle funzioni di verifica dei permessi.

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
|--------|-------|-------------|
| `canCreate` | `(collection, path) => boolean` | Verifica se l'utente ha il permesso di creare entità nella collection. |
| `canEdit` | `(collection, path, row) => boolean` | Verifica se l'utente ha il permesso di modificare la riga specificata, nel formato restituito da `useRows` o `context.data`. `null` esegue la verifica per l'intera collection senza considerare una riga specifica. |
| `canDelete` | `(collection, path, row) => boolean` | Verifica se l'utente ha il permesso di eliminare la riga specificata. `null` esegue la verifica per l'intera collection senza considerare una riga specifica. |
| `canRead` | `(collection) => boolean` | Verifica se l'utente ha il permesso di leggere la collection. |

## `useClipboard`

Hook di utilità per copiare o tagliare testo negli appunti, con supporto automatico per meccanismi di fallback sui browser più datati.

> [!NOTE]
> Nota l'ortografia esatta di `isCoppied` (con due `p`) nel payload restituito.

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
| `onSuccess` | `(text) => void` | Opzionale. Callback attivato in caso di copia riuscita. |
| `onError` | `(err) => void` | Opzionale. Callback attivato in caso di errore. |

### Valore restituito

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `ref` | `MutableRefObject` | Ref di React da associare agli elementi input/textarea da cui copiare. |
| `copy` | `(text?: string) => void` | Avvia la copia del testo fornito o del contenuto dell'elemento referenziato. |
| `cut` | `() => void` | Avvia il taglio del contenuto dell'elemento referenziato. |
| `isCoppied` | `boolean` | True se il testo è stato copiato di recente. |
| `clipboard` | `string` | Il valore del testo attualmente copiato. |
| `clearClipboard` | `() => void` | Svuota gli appunti. |

## `useSidePanel`

Apri entità a livello programmatico in un pannello laterale:

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

Lo slot `action` visualizza un pulsante accanto al messaggio, che è la posizione ideale
per l'annullamento (undo): l'intervallo di tempo in cui l'annullamento ha senso corrisponde esattamente
a quello in cui la snackbar è visibile sullo schermo:

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

La snackbar si chiude automaticamente dopo aver fatto clic sull'azione, evitando che
la stessa azione di annullamento venga eseguita due volte. Due snackbar con lo stesso messaggio
compaiono entrambe se ciascuna dispone di un'azione; ad esempio, rifiutare due candidature di seguito
permette di annullare separatamente ciascuna operazione.

## `useStorageSource`

Accedi alle operazioni di archiviazione file:

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
fornite nel formato inviato dal server, la stessa struttura restituita da `useRows`, insieme ai rispettivi ID
— le stringhe accettate da `selectedIds` e `useSidePanel().open`:

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

Con `multiselect: true`, `onMultipleRowsSelected(rows, ids)` segnala ogni
selezione effettuata e `onSelectionDone(rows, ids)` restituisce la selezione finale una sola volta, quando si preme Fine — usalo
quando l'azione sulla selezione comporta un'operazione di scrittura. `selectedIds` specifica le righe
visualizzate come selezionate, posizionate per prime all'apertura del dialog.

## `useSelectionController`

Una selezione delle righe di una collection gestita direttamente: passala a una vista come
`admin.selectionController` (su un `CollectionPanel`, tramite
`collectionOverrides`) e leggi ciò che l'utente seleziona:

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
`{ type: "query", query, excludedIds, count }` quando viene scelto "tutti i corrispondenti";
`resolveSelection({ selection: selection.selection, data: context.data,
collection })` legge le righe di una selezione basata su query e restituisce `{ rows, ids }` in entrambe le modalità. `isSelected(id)`,
`toggleSelection(row)`, `setSelectedRows(rows)` e `clearSelection()` ne modificano lo stato.

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

Recupera l'istanza tipizzata dell'SDK sottostante (`RebaseClient`) dal contesto React. È utile per eseguire operazioni SDK dirette (come chiamare endpoint personalizzati o effettuare caricamenti manuali) all'interno dei componenti.

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

Impedisce la navigazione o la chiusura della pagina quando i dati del form contengono modifiche non salvate. Richiede conferma prima del ricaricamento o della chiusura della scheda (`beforeunload`) e, all'interno dell'admin sotto un data router di React Router (`createBrowserRouter`), anche prima della navigazione interna all'app, tramite `useBlocker`. Con qualsiasi altro router, come un semplice `<BrowserRouter>`, si applica solo il prompt a livello di browser.

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
| `onOk` | `() => void` | Callback attivato quando l'utente conferma l'abbandono delle modifiche. |

### Valore restituito

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props modali da passare direttamente a un componente UI `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Attiva manualmente la visualizzazione del dialog a livello programmatico. |

## `useEffectiveRoleController`

Cambia il ruolo per cui è strutturata la navigazione del pannello admin, senza dover effettuare il logout:
influisce sulle viste di Studio elencate. Non invia nulla al server e non valuta alcuna
policy di row-level security, pertanto una vista dati continua a mostrare solo ciò che si ha il permesso di leggere. Per
testare l'RLS, usa **Simulate access** (sopra il tuo avatar nel menu laterale), oppure `client.simulate()` da
codice; vedi [Testing access](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` fornisce il controller. `useBuildEffectiveRoleController`, l'hook
precedentemente utilizzato per crearne uno da passare come `effectiveRoleController`, è deprecato a favore di
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

Alterna le modalità di visualizzazione del layout admin all'interno del pannello di amministrazione.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Apri schermate di dialogo in modo imperativo da qualsiasi punto dell'albero dei componenti.

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

Cattura globalmente le azioni dell'interfaccia utente del CMS e gli eventi utente.

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

- **[Panoramica del Frontend](/docs/frontend)** — Riferimento al framework React
- **[SDK tipizzato](/docs/sdk)** — SDK per le operazioni sui dati
