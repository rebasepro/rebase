---
sourceHash: e73caf2e48ec0dd6
title: Référence des hooks
sidebar_label: Hooks
description: Hooks React fournis par Rebase pour accéder à l'authentification, aux données, à la navigation, aux panneaux latéraux, au stockage et à l'état de l'interface utilisateur.
---

## Vue d'ensemble

Rebase fournit des hooks React pour accéder aux fonctionnalités du framework depuis n'importe quel composant au sein de l'arbre de fournisseurs `<Rebase>`.

## `useRebaseContext`

<span class="since-badge" data-since="0.29">Depuis 0.29</span>
Le hook principal — accédez à tout :

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

`context.data` est la même couche plate que celle lue par les hooks de lignes : `context.data.orders.find()`
résout `{ data: rows, meta }`, une date est sa chaîne ISO et un belongsTo sa
colonne de clé étrangère, exactement comme les renvoient le `context.data` d'un callback
backend et `client.data`. Ses méthodes `create`, `update` et `delete` exécutent les
`admin.browserCallbacks` de la collection et rafraîchissent chaque vue de la collection,
tout comme `useRowWrites`. Utilisez-le lorsque l'état React n'est pas adapté : le
`onClick` d'une action d'entité, un callback, un constructeur de collection.

## `useAuthController`

Accédez à l'état d'authentification et aux fonctionnalités :

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

## Lignes : `useRows`, `useRow`, `useRowCount`, `useAggregate`, `useRowWrites`

Lisez et écrivez les lignes d'une collection dans le format envoyé par le serveur : dates sous forme de chaînes ISO, belongsTo sous sa colonne de clé étrangère (`author_id`). C'est le même format que celui renvoyé par `client.data` et `context.data`, de sorte que le code écrit avec ces hooks se lit comme du code écrit directement avec le SDK.

Les lignes de chaque collection proviennent de la source de données qu'elle déclare (`dataSource`, voir [Sources de données multiples](/docs/backend/multiple-sources)), et celles de toute autre collection proviennent de la source de données par défaut de l'application. Avec un `client`, la valeur par défaut est `client.data`, et les agrégations passent par HTTP. Sans celui-ci, il s'agit du pilote de la source de données par défaut (un pilote Firebase, par exemple). Lorsque la source de données prend en charge les souscriptions, les lignes restent synchronisées en temps réel. Lorsque ce n'est pas le cas, chaque hook d'une collection effectue une nouvelle lecture après chaque écriture dans celle-ci au sein du même `<Rebase>` (via `useRowWrites`, `context.data`, un formulaire d'enregistrement ou une vue de collection) et après chaque modification annoncée par le pilote de la source de données. Il en va de même pour les vues de collection de l'interface d'administration. Les options sont comparées par valeur, de sorte qu'un objet inline ne déclenche pas une nouvelle lecture à chaque rendu. `error` est une chaîne de message, et une écriture qui échoue est également rejetée.

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

| Hook | Valeur de retour |
|------|------------------|
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` correspond à la taille de la page, et `loadMore` ajoute une page à la même lecture, jusqu'à 1 000 lignes. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` peut être `undefined`, auquel cas rien n'est lu. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. Les paramètres et le résultat sont ceux de `client.data.<collection>.aggregate()`. Une source de données qui ne peut pas effectuer d'agrégations définit `error` et ne renvoie jamais de résultat vide. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Chaque écriture réussie rafraîchit tous les hooks de ligne et les vues de collection de cette collection. Une écriture exécute les `admin.browserCallbacks` de la collection, tout comme l'enregistrement du formulaire : `beforeSave` (qui peut modifier la ligne ou lever une exception pour annuler l'écriture), puis `afterSave` ou `afterSaveError` ; `beforeDelete`, puis `afterDelete`. Chacun reçoit les lignes telles que le serveur les envoie. |

## `usePermissions`

Hook permettant d'évaluer les rôles et permissions de l'utilisateur actuel. Il évite d'avoir à passer manuellement le `authController` aux fonctions de vérification des permissions.

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

### Valeur de retour

| Méthode | Signature | Description |
|---------|-----------|-------------|
| `canCreate` | `(collection, path) => boolean` | Vérifie si l'utilisateur est autorisé à créer des entités dans la collection. |
| `canEdit` | `(collection, path, row) => boolean` | Vérifie si l'utilisateur est autorisé à modifier la ligne donnée, telle que renvoyée par `useRows` ou `context.data`. `null` interroge la collection sans ligne spécifique en main. |
| `canDelete` | `(collection, path, row) => boolean` | Vérifie si l'utilisateur est autorisé à supprimer la ligne donnée. `null` interroge la collection sans ligne spécifique en main. |
| `canRead` | `(collection) => boolean` | Vérifie si l'utilisateur est autorisé à lire la collection. |

## `useClipboard`

Hook utilitaire pour copier ou couper du texte dans le presse-papiers, avec prise en charge automatique de mécanismes de secours (fallback) sur les navigateurs plus anciens.

> [!NOTE]
> Notez l'orthographe exacte de `isCoppied` (avec deux « p ») dans la valeur de retour.

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

### Paramètres

| Option | Type | Description |
|--------|------|-------------|
| `copiedDuration` | `number` | Facultatif. Durée en millisecondes avant de réinitialiser `isCoppied` à `false`. |
| `onSuccess` | `(text) => void` | Facultatif. Callback déclenché lors d'une copie réussie. |
| `onError` | `(err) => void` | Facultatif. Callback déclenché en cas d'erreur. |

### Valeur de retour

| Propriété | Type | Description |
|-----------|------|-------------|
| `ref` | `MutableRefObject` | Ref React à attacher aux éléments input/textarea à partir desquels copier. |
| `copy` | `(text?: string) => void` | Déclenche la copie du texte fourni, ou du contenu de l'élément référencé. |
| `cut` | `() => void` | Déclenche la coupure du contenu de l'élément référencé. |
| `isCoppied` | `boolean` | Vrai si le texte a été récemment copié. |
| `clipboard` | `string` | La valeur textuelle actuellement copiée. |
| `clearClipboard` | `() => void` | Vide le presse-papiers. |

## `useSidePanel`

Ouvrez des entités par programmation dans un panneau latéral :

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

Méthodes :

| Méthode | Description |
|---------|-------------|
| `open({ path, id, collection })` | Ouvrir une entité dans un panneau latéral |
| `close()` | Fermer le panneau latéral actuel |
| `replace({ path, id, collection })` | Remplacer le contenu du panneau latéral actuel |

## `useSnackbarController`

Affichez des notifications toast :

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

`open()` prend en paramètre `{ type, title?, message, autoHideDuration?, action? }`.

L'emplacement `action` affiche un bouton à côté du message, idéal pour
une action d'annulation (undo) — la fenêtre temporelle durant laquelle l'annulation a du sens
correspond au temps d'affichage de la snackbar à l'écran :

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

La snackbar disparaît dès que l'action est cliquée, empêchant ainsi la même annulation
d'être déclenchée deux fois. Deux snackbars contenant le même message apparaissent toutes deux
lorsque chacune dispose d'une action — rejeter deux candidatures consécutivement vous laisse la possibilité
d'annuler chacune d'elles.

## `useStorageSource`

Accédez aux opérations de stockage de fichiers :

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

Contrôlez le thème clair/sombre :

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

Ouvrez un dialogue latéral pour sélectionner des lignes dans une collection. Les lignes vous sont transmises
telles qu'envoyées par le serveur, au format renvoyé par `useRows`, accompagnées de leurs identifiants
— les chaînes que prennent `selectedIds` et `useSidePanel().open` :

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

Avec `multiselect: true`, `onMultipleRowsSelected(rows, ids)` signale chaque coche
et `onSelectionDone(rows, ids)` renvoie la sélection finale une seule fois, lorsque le bouton Terminé est cliqué — utilisez-le
lorsque l'action sur la sélection entraîne une écriture. `selectedIds` spécifie les lignes
affichées comme sélectionnées, et placées en tête, à l'ouverture du dialogue.

## `useSelectionController`

Une sélection de lignes d'une collection que vous conservez : transmettez-la à une vue en tant que
`admin.selectionController` (sur un `CollectionPanel`, via
`collectionOverrides`) et lisez ce que l'utilisateur y coche :

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

`selection.selection` vaut `{ type: "rows", ids, rows }` pour les lignes cochées, ou
`{ type: "query", query, excludedIds, count }` lorsque « tous les éléments correspondants » est sélectionné ;
`resolveSelection({ selection: selection.selection, data: context.data,
collection })` lit les lignes d'une sélection par requête et fournit `{ rows, ids }` dans les deux modes. `isSelected(id)`,
`toggleSelection(row)`, `setSelectedRows(rows)` et `clearSelection()` permettent de la modifier.

## `useNavigationStateController`

Accédez à l'état de navigation et aux collections résolues :

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

Récupérez l'instance sous-jacente du SDK typé (`RebaseClient`) depuis le contexte React. Cela est utile pour invoquer des opérations brutes du SDK (comme l'appel d'endpoints personnalisés ou des téléversements manuels) au sein de vos composants.

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

Empêchez la navigation ou le déchargement de la page lorsque les données d'un formulaire comportent des modifications non enregistrées. Une confirmation est demandée avant un rechargement ou la fermeture d'un onglet (`beforeunload`) et, au sein de l'administration sous un routeur de données React Router (`createBrowserRouter`), avant la navigation dans l'application également, via `useBlocker`. Sous tout autre routeur, comme un simple `<BrowserRouter>`, seule l'invite au niveau du navigateur s'applique.

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

### Paramètres

| Paramètre | Type | Description |
|-----------|------|-------------|
| `when` | `boolean` | Booléen permettant d'activer le blocage de la navigation sur la page ou dans le routeur. |
| `onOk` | `() => void` | Callback déclenché lorsque l'utilisateur confirme l'abandon des modifications. |

### Valeur de retour

| Propriété | Type | Description |
|-----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Propriétés de la modale à passer directement à un composant d'interface utilisateur `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Déclenche l'affichage manuel du dialogue par programmation. |

## `useEffectiveRoleController`

Basculez le rôle pour lequel la navigation du panneau d'administration est construite, sans vous déconnecter :
cela modifie les vues Studio listées. Cela n'envoie rien au serveur et n'évalue aucune
politique de sécurité au niveau des lignes (RLS), de sorte qu'une vue de données affiche toujours ce que vous pouvez lire. Pour
tester la RLS, utilisez **Simuler l'accès** (au-dessus de votre avatar dans le volet latéral), ou `client.simulate()` depuis
le code ; voir [Tester l'accès](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` fournit le contrôleur. `useBuildEffectiveRoleController`, le hook
qui en construisait un à transmettre en tant que `effectiveRoleController`, est obsolète au profit de
Simuler l'accès et émet un avertissement lors de son appel.

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

Basculez entre les modes de vue de mise en page dans le panneau d'administration.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Ouvrez des boîtes de dialogue de manière impérative depuis n'importe quel endroit de l'arbre des composants.

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

Capturez globalement les actions de l'interface utilisateur du CMS et les événements utilisateur.

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

## Prochaines étapes

- **[Vue d'ensemble du frontend](/docs/frontend)** — Référence du framework React
- **[SDK typé](/docs/sdk)** — SDK d'opérations de données
