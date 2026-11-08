---
sourceHash: 09a9548b22748eda
title: Riferimento degli Hook
sidebar_label: Hooks
description: Hook React forniti da Rebase per accedere ad autenticazione, dati, navigazione, pannelli laterali, storage e stato della UI.
---

## Panoramica

Rebase fornisce hook React per accedere alle funzionalità del framework da qualsiasi componente all'interno dell'albero dei provider di `<Rebase>`.

## `useRebaseContext`

L'hook principale — per accedere a tutto:

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

Legge e scrive le righe di una collezione nella forma in cui il server le invia: date come stringhe ISO, un belongsTo sotto la sua colonna foreign-key (`author_id`). È la stessa forma restituita da `client.data` e la stessa che `context.data` restituisce in una callback di backend, quindi il codice scritto con questi hook si legge come il codice scritto direttamente per l'SDK.

Le righe provengono dall'origine dati predefinita dell'applicazione. In presenza di un `client`, questa corrisponde a `client.data`, e le aggregazioni avvengono tramite HTTP. Senza un client, si tratta del driver dell'origine dati predefinita (ad esempio, un driver Firebase). Laddove l'origine dati supporti le sottoscrizioni, le righe rimangono aggiornate in tempo reale. Dove non è supportato, ogni hook di una collezione esegue nuovamente la lettura dopo ogni scrittura al suo interno nello stesso `<Rebase>` (tramite `useRowWrites`, un form di record, una vista di collezione o `useData()`) e dopo ogni modifica annunciata dal driver dell'origine dati. Lo stesso vale per le viste di collezione dell'admin. Le opzioni vengono confrontate per valore, quindi un oggetto inline non attiva una nuova lettura a ogni render. `error` è una stringa di messaggio, e una scrittura che fallisce genera un rifiuto (reject).

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
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` è la dimensione della pagina, e `loadMore` aggiunge una pagina alla stessa lettura, fino a un massimo di 1000 righe. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` può essere `undefined`, nel qual caso non viene letto nulla. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. I parametri e il risultato corrispondono a quelli di `client.data.<collection>.aggregate()`. Un'origine dati che non supporta le aggregazioni imposta `error` e non restituisce mai un risultato vuoto. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Ogni scrittura completata con successo aggiorna ogni hook di riga e vista di collezione di quella collezione. Una scrittura esegue i `admin.browserCallbacks` della collezione esattamente come il salvataggio del form del record, con gli stessi valori: `beforeSave` (che può modificare i valori o lanciare un errore per interrompere la scrittura), quindi `afterSave` o `afterSaveError`; `beforeDelete`, quindi `afterDelete`. |

## `useCollection`

Recupera e si sottoscrive a un elenco di entità in una collezione. Stabilisce automaticamente una sottoscrizione WebSocket in tempo reale se supportata dal driver, effettuando un fallback su fetch REST in caso contrario.

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
| `path` | `string` | Percorso assoluto della collezione (ad es. `"products"`). |
| `collection` | `AdminCollection` | L'oggetto di definizione della collezione. |
| `itemCount` | `number` | Opzionale. Numero di entità da recuperare (limite SQL). |
| `offset` | `number` | Opzionale. Numero di elementi da saltare. |
| `page` | `number` | Opzionale. Numero di pagina (indice a base 1), alternativo a offset. |
| `filterValues` | `FilterValues` | Opzionale. Filtri di query. Supporta la sintassi abbreviata di uguaglianza, tuple `[op, val]` e stringhe di operatori PostgREST. |
| `sortBy` | `[string, "asc" \| "desc"]` | Opzionale. Tupla composta dal campo di ordinamento e dalla direzione dell'ordinamento. |
| `searchString` | `string` | Opzionale. Query per la ricerca full-text. |

### Valore restituito

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `data` | `Entity[]` | Array delle entità recuperate. |
| `dataLoading` | `boolean` | True se il caricamento iniziale è in corso. |
| `dataLoadingError` | `Error` | Oggetto errore se il recupero fallisce. |
| `noMoreToLoad` | `boolean` | True se non ci sono più record oltre la pagina/limite corrente. |
| `totalCount` | `number` | Opzionale. Il conteggio totale dei record nel database che corrispondono al filtro. |

## `useFetch`

Recupera e si sottoscrive a una singola entità tramite ID. Effettua il rendering istantaneo utilizzando i dati memorizzati nella cache se già caricati tramite un fetch di collezione, per poi aggiornarsi in background.

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
| `entityId` | `string \| number` | L'ID dell'entità da recuperare. |
| `collection` | `AdminCollection` | L'oggetto di definizione della collezione. |
| `useCache` | `boolean` | Opzionale. Se impostato su `true` e l'entità è presente nella cache, salta l'aggiornamento in background. (Predefinito: `false`). |

### Utilità di memorizzazione nella cache

Rebase mantiene una cache globale in memoria per prevenire lo sfarfallio della UI. Puoi manipolare direttamente questa cache:

- `populateFetchCache(path, entities)`: Pre-popola la cache con un elenco di entità (ad es. dopo un'operazione bulk o una chiamata API personalizzata). La cache conserva i 2.000 record scritti o letti più di recente. Una vista di collezione non scrive più ogni riga visualizzata al suo interno: facendo clic su una riga, o sulla relativa azione **Modifica** o **Copia**, viene inserita solo quella riga, consentendo al record di aprirsi comunque con i suoi valori a schermo.
- `clearFetchCache()`: Svuota la cache. Si raccomanda di chiamare questa funzione al momento del logout dell'utente per prevenire perdite di dati.

## `usePermissions`

Hook per valutare ruoli e permessi per l'utente corrente. Rende superfluo il passaggio manuale di `authController` alle funzioni di verifica dei permessi.

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
| `canCreate` | `(collection, path) => boolean` | Verifica se l'utente ha il permesso di creare entità nella collezione. |
| `canEdit` | `(collection, path, entity) => boolean` | Verifica se l'utente ha il permesso di modificare l'entità specificata. |
| `canDelete` | `(collection, path, entity) => boolean` | Verifica se l'utente ha il permesso di eliminare l'entità specificata. |
| `canRead` | `(collection) => boolean` | Verifica se l'utente ha il permesso di leggere la collezione. |

## `useClipboard`

Hook di utilità per copiare o tagliare testo negli appunti, con supporto automatico per meccanismi di fallback sui browser meno recenti.

> [!NOTE]
> Fai attenzione alla grafia esatta di `isCoppied` (con due `p`) nel valore restituito.

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
| `ref` | `MutableRefObject` | Ref React da associare agli elementi input/textarea da cui copiare. |
| `copy` | `(text?: string) => void` | Avvia la copia del testo indicato o del contenuto dell'elemento referenziato da `ref`. |
| `cut` | `() => void` | Avvia il taglio del contenuto dell'elemento referenziato da `ref`. |
| `isCoppied` | `boolean` | True se il testo è stato copiato di recente. |
| `clipboard` | `string` | Il testo attualmente copiato negli appunti. |
| `clearClipboard` | `() => void` | Svuota gli appunti. |

## `useSidePanel`

Apre a livello programmatico le entità in un pannello laterale:

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
| `open({ path, entityId, collection })` | Apre un'entità in un pannello laterale |
| `close()` | Chiude il pannello laterale corrente |
| `replace({ path, entityId, collection })` | Sostituisce il contenuto del pannello laterale corrente |

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

Lo slot `action` esegue il rendering di un pulsante accanto al messaggio, esattamente dove
deve trovarsi un'azione di annullamento (undo) — la finestra temporale in cui l'annullamento ha senso è quella in cui la snackbar rimane
a schermo:

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

La snackbar si chiude automaticamente una volta fatto clic sull'azione, evitando che lo stesso annullamento
possa attivarsi due volte. Due snackbar contenenti lo stesso messaggio compaiono entrambe quando
ciascuna dispone di un'azione — rifiutare due domande di seguito lascia una via di ritorno
per ciascuna di esse.

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

Apre una finestra di dialogo laterale per selezionare entità da una collezione. È lo stesso hook utilizzato internamente quando viene renderizzata una proprietà di relazione:

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

Accedi allo stato di navigazione e alle collezioni risolte:

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

Gestisci selezioni complesse di relazioni con ricerca, debouncing e paginazione integrati.

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
|---------|------|-------------|
| `path` | `string` | Percorso assoluto della collezione. |
| `collection` | `AdminCollection` | Definizione della collezione di destinazione. |
| `fixedFilter` | `FilterValues` | Opzionale. Filtri statici per limitare i risultati della ricerca. |
| `pageSize` | `number` | Opzionale. Numero di elementi per pagina. (Predefinito: `10`). |
| `getLabelFromEntity` | `(entity) => string` | Opzionale. Personalizza il testo dell'etichetta visualizzata. |
| `getDescriptionFromEntity` | `(entity) => string` | Opzionale. Personalizza il testo della descrizione. |

## `useRebaseClient`

Recupera l'istanza SDK tipizzata sottostante (`RebaseClient`) dal contesto React. Questo è utile per invocare operazioni SDK di basso livello (come la chiamata a endpoint personalizzati o caricamenti manuali) all'interno dei tuoi componenti.

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

Impedisce la navigazione o lo scaricamento della pagina quando i dati del form contengono modifiche non salvate. Richiede conferma prima di un ricaricamento o della chiusura di una scheda (`beforeunload`) e, all'interno dell'admin gestito tramite un data router di React Router (`createBrowserRouter`), anche prima della navigazione in-app, mediante `useBlocker`. Con qualsiasi altro router, come un semplice `<BrowserRouter>`, viene applicato solo il prompt a livello di browser.

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
| `when` | `boolean` | Flag per attivare il blocco della navigazione della pagina/del router. |
| `onOk` | `() => void` | Callback attivata quando l'utente conferma lo scarto delle modifiche. |

### Valore restituito

| Proprietà | Tipo | Descrizione |
|-----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props della modale da passare direttamente a un componente UI `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Mostra manualmente la finestra di dialogo a livello programmatico. |

## `useEffectiveRoleController`

Cambia il ruolo per cui è costruita la navigazione del pannello di amministrazione, senza effettuare il logout:
in particolare, quali viste di Studio vengono elencate. Non invia nulla al server e non valuta alcuna
policy di row-level security, quindi una vista dati continua a mostrare ciò che hai i permessi di leggere. Per
testare la RLS, usa **Simulate access** (sopra il tuo avatar nel drawer) oppure `client.simulate()` da
codice; consulta [Testing access](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` fornisce il controller. `useBuildEffectiveRoleController`, l'hook
che ne creava uno da passare come `effectiveRoleController`, è deprecato a favore di
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

Apre schermate di dialogo in modo imperativo da qualsiasi punto dell'albero dei componenti.

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

Acquisisce a livello globale le azioni dell'interfaccia utente del CMS e gli eventi utente.

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

- **[Panoramica del frontend](/docs/frontend)** — Riferimento del framework React
- **[SDK tipizzato](/docs/sdk)** — SDK per le operazioni sui dati
