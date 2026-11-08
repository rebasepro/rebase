---
sourceHash: 23624a5be1a5e06a
title: Référence des Hooks
sidebar_label: Hooks
description: Hooks React fournis par Rebase pour accéder à l'authentification, aux données, à la navigation, aux panneaux latéraux, au stockage et à l'état de l'UI.
---

## Vue d'ensemble

Rebase fournit des hooks React pour accéder aux fonctionnalités du framework depuis n'importe quel composant au sein de l'arborescence du provider `<Rebase>`.

## `useRebaseContext`

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
se résout en `{ data: rows, meta }`, une date est sa chaîne ISO et un belongsTo est
sa colonne de clé étrangère, exactement comme les renvoient le `context.data` d'un callback backend et
`client.data`. Ses méthodes `create`, `update` et `delete` exécutent les
`admin.browserCallbacks` de la collection et actualisent chaque vue de la collection,
tout comme le fait `useRowWrites`. Utilisez-le lorsque l'état React n'est pas adapté : le `onClick` d'une
action d'entité, un callback, un constructeur de collection.

## `useAuthController`

Accéder à l'état et aux fonctionnalités d'authentification :

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

Lisez et écrivez les lignes d'une collection sous la forme envoyée par le serveur : les dates sous forme de chaînes ISO, un belongsTo sous sa colonne de clé étrangère (`author_id`). C'est la même forme que celle renvoyée par `client.data` et `context.data`, de sorte que le code écrit avec ces hooks ressemble à du code écrit avec le SDK.

Les lignes de chaque collection proviennent de la source de données qu'elle déclare (`dataSource`, voir [Sources de données multiples](/docs/backend/multiple-sources)), et celles de toute autre collection proviennent de la source de données par défaut de l'application. Avec un `client`, la valeur par défaut est `client.data`, et les agrégations passent par HTTP. Sans client, il s'agit du pilote de la source de données par défaut (un pilote Firebase, par exemple). Lorsque la source de données supporte les abonnements, les lignes restent synchronisées en temps réel. Dans le cas contraire, chaque hook d'une collection effectue une nouvelle lecture après chaque écriture sur celle-ci au sein du même `<Rebase>` (via `useRowWrites`, `context.data`, un formulaire d'enregistrement ou une vue de collection) et après chaque modification annoncée par le pilote de la source de données. Il en va de même pour les vues de collection de l'admin. Les options sont comparées par valeur, de sorte qu'un objet inline ne déclenche pas une nouvelle lecture à chaque rendu. `error` est une chaîne de message, et une écriture qui échoue est également rejetée.

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
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` est la taille de la page, et `loadMore` ajoute une page à la même lecture, jusqu'à 1000 lignes. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` peut être `undefined`, auquel cas rien n'est lu. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. Les paramètres et le résultat sont ceux de `client.data.<collection>.aggregate()`. Une source de données qui ne peut pas effectuer d'agrégations définit `error` et ne renvoie jamais un résultat vide. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Chaque écriture réussie actualise chaque hook de ligne et vue de collection de cette collection. Une écriture exécute les `admin.browserCallbacks` de la collection, tout comme la sauvegarde d'un formulaire d'enregistrement : `beforeSave` (qui peut modifier la ligne ou lever une exception pour annuler l'écriture), puis `afterSave` ou `afterSaveError` ; `beforeDelete`, puis `afterDelete`. Chacun reçoit les lignes telles que le serveur les envoie. |

## `usePermissions`

Hook pour évaluer les rôles et permissions de l'utilisateur actuel. Il abstrait la nécessité de passer manuellement l'`authController` aux fonctions de vérification des permissions.

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
| `canEdit` | `(collection, path, row) => boolean` | Vérifie si l'utilisateur est autorisé à modifier la ligne donnée, telle que renvoyée par `useRows` ou `context.data`. `null` permet d'interroger la collection sans ligne spécifique. |
| `canDelete` | `(collection, path, row) => boolean` | Vérifie si l'utilisateur est autorisé à supprimer la ligne donnée. `null` permet d'interroger la collection sans ligne spécifique. |
| `canRead` | `(collection) => boolean` | Vérifie si l'utilisateur est autorisé à lire la collection. |

## `useClipboard`

Hook utilitaire pour copier ou couper du texte vers le presse-papiers, avec prise en charge automatique de mécanismes de secours pour les navigateurs plus anciens.

> [!NOTE]
> Notez l'orthographe exacte de `isCoppied` (avec deux « p ») dans la valeur renvoyée.

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
| `ref` | `MutableRefObject` | Ref React à attacher aux éléments input/textarea depuis lesquels copier. |
| `copy` | `(text?: string) => void` | Déclenche la copie du texte fourni, ou du contenu de l'élément référencé par le ref. |
| `cut` | `() => void` | Déclenche la coupure du contenu de l'élément référencé par le ref. |
| `isCoppied` | `boolean` | `true` si du texte a été récemment copié. |
| `clipboard` | `string` | La valeur actuelle du texte copié. |
| `clearClipboard` | `() => void` | Efface le presse-papiers. |

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
| `open({ path, id, collection })` | Ouvre une entité dans un panneau latéral |
| `close()` | Ferme le panneau latéral actuel |
| `replace({ path, id, collection })` | Remplace le contenu du panneau latéral actuel |

## `useSnackbarController`

Afficher des notifications toast :

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

`open()` accepte `{ type, title?, message, autoHideDuration?, action? }`.

L'emplacement `action` affiche un bouton à côté du message, idéal pour une action
d'annulation — la fenêtre pendant laquelle l'annulation a un sens correspond au
moment où le snackbar est à l'écran :

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

Le snackbar se ferme automatiquement une fois l'action cliquée, de sorte que la même annulation
ne peut pas être déclenchée deux fois. Deux snackbars comportant le même message apparaîtront tous
les deux si chacun comporte une action — rejeter deux candidatures à la suite vous laisse
un moyen d'annuler chacune d'elles.

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

Ouvrir une boîte de dialogue latérale pour sélectionner des lignes dans une collection. Les lignes vous
sont transmises telles que le serveur les envoie, sous la forme retournée par `useRows`, `id` inclus :

```typescript
import { useSelectionDialog } from "@rebasepro/cms";

function SelectProduct() {
    const selectionDialog = useSelectionDialog({
        path: "products",
        collection: productsCollection,
        onSingleRowSelected: (row) => {
            console.log("Selected:", row?.id);
        }
    });

    return <button onClick={selectionDialog.open}>Select Product</button>;
}
```

Avec `multiselect: true`, `onMultipleRowsSelected(rows)` notifie chaque coche et
`onSelectionDone(rows)` renvoie la sélection finale une seule fois, lorsque le bouton Terminé est cliqué — utilisez-le
lorsqu'une action sur la sélection déclenche une écriture. `selectedIds` indique les lignes
affichées comme sélectionnées, et placées en tête, à l'ouverture de la boîte de dialogue.

## `useSelectionController`

Une sélection de lignes d'une collection que vous gérez : transmettez-la à une vue via
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

`selection.selection` correspond à `{ type: "rows", ids, rows }` pour les lignes cochées, ou
à `{ type: "query", query, excludedIds, count }` lorsque « tous les éléments correspondants » est sélectionné ;
`resolveSelection({ selection: selection.selection, data: context.data, collection })` permet de lire les lignes d'une sélection par requête. `isSelected(id)`,
`toggleSelection(row)`, `setSelectedRows(rows)` et `clearSelection()` permettent de la modifier.

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

## `useRebaseClient`

Récupérer l'instance sous-jacente typée du SDK (`RebaseClient`) depuis le contexte React. Ceci est utile pour exécuter des opérations brutes du SDK (comme appeler des endpoints personnalisés ou effectuer des téléversements manuels) au sein de vos composants.

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

Empêcher la navigation ou le déchargement de la page lorsque les données d'un formulaire comportent des modifications non enregistrées. Une confirmation est demandée avant un rechargement ou la fermeture d'un onglet (`beforeunload`) et, dans l'admin sous un data router React Router (`createBrowserRouter`), avant toute navigation au sein de l'application via `useBlocker`. Sous tout autre routeur, comme un simple `<BrowserRouter>`, seule l'invite au niveau du navigateur s'applique.

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
| `when` | `boolean` | Indicateur pour activer le blocage de la navigation sur la page/le routeur. |
| `onOk` | `() => void` | Callback déclenché lorsque l'utilisateur confirme l'abandon des modifications. |

### Valeur de retour

| Propriété | Type | Description |
|-----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props de la modale à transmettre directement à un composant UI `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Déclenche manuellement l'affichage de la boîte de dialogue par programmation. |

## `useEffectiveRoleController`

Changer le rôle pour lequel la navigation du panneau d'administration est construite, sans se déconnecter :
cela détermine les vues Studio listées. Aucune requête n'est envoyée au serveur et aucune
politique de sécurité au niveau des lignes (RLS) n'est évaluée, de sorte qu'une vue de données affiche toujours ce que vous pouvez lire. Pour
tester le RLS, utilisez **Simuler l'accès** (au-dessus de votre avatar dans le tiroir latéral), ou `client.simulate()` depuis
le code ; voir [Tester les accès](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` fournit le contrôleur. `useBuildEffectiveRoleController`, le hook
qui permettait d'en construire un à passer en tant qu'`effectiveRoleController`, est déprécié au profit de
Simuler l'accès et émet un avertissement unique lorsqu'il est appelé.

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

Basculer entre les modes d'affichage de la mise en page d'administration au sein du panneau d'administration.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Ouvrir des fenêtres de dialogue de manière impérative depuis n'importe quel endroit de l'arborescence des composants.

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

Capturer globalement les actions de l'interface du CMS et les événements utilisateur.

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

- **[Vue d'ensemble du Frontend](/docs/frontend)** — Référence du framework React
- **[SDK Typé](/docs/sdk)** — SDK d'opérations sur les données
