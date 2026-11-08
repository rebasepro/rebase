---
sourceHash: 09a9548b22748eda
title: Référence des hooks
sidebar_label: Hooks
description: Hooks React fournis par Rebase pour accéder à l'authentification, aux données, à la navigation, aux panneaux latéraux, au stockage et à l'état de l'interface utilisateur.
---

## Vue d'ensemble

Rebase fournit des hooks React pour accéder aux fonctionnalités du framework depuis n'importe quel composant au sein de l'arbre du fournisseur `<Rebase>`.

## `useRebaseContext`

Le hook principal — accédez à tout :

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

Accédez à l'état et aux capacités d'authentification :

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

Lisez et écrivez les lignes d'une collection dans le format dans lequel le serveur les envoie : dates sous forme de chaînes ISO, une relation belongsTo sous sa colonne de clé étrangère (`author_id`). Il s'agit du même format que celui renvoyé par `client.data` et par `context.data` dans un callback backend, de sorte que le code écrit avec ces hooks se lit comme du code écrit directement avec le SDK.

Les lignes proviennent de la source de données par défaut de l'application. Avec un `client`, il s'agit de `client.data`, et les agrégations passent par HTTP. Sans client, il s'agit du pilote de la source de données par défaut (un pilote Firebase, par exemple). Lorsque la source de données prend en charge les abonnements, les lignes restent synchronisées en temps réel. Dans le cas contraire, chaque hook d'une collection effectue une nouvelle lecture après chaque écriture sur celle-ci au sein du même `<Rebase>` (via `useRowWrites`, un formulaire d'enregistrement, une vue de collection ou `useData()`) et après chaque modification annoncée par le pilote de la source de données. Il en va de même pour les vues de collection de l'administration. Les options sont comparées par valeur, de sorte qu'un objet en ligne ne déclenche pas une nouvelle lecture à chaque rendu. `error` est une chaîne de message, et une écriture qui échoue est également rejetée.

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

| Hook | Retour |
|------|---------|
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` est la taille de la page, et `loadMore` ajoute une page à la même lecture, jusqu'à 1 000 lignes. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` peut être `undefined`, auquel cas rien n'est lu. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. Les paramètres et le résultat sont ceux de `client.data.<collection>.aggregate()`. Une source de données qui ne peut pas effectuer d'agrégation définit `error` et ne renvoie jamais un résultat vide. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Chaque écriture réussie rafraîchit tous les hooks de ligne et vues de collection de cette collection. Une écriture exécute les `admin.browserCallbacks` de la collection tout comme l'enregistrement du formulaire d'enregistrement, avec les mêmes valeurs : `beforeSave` (qui peut modifier les valeurs ou lever une exception pour interrompre l'écriture), puis `afterSave` ou `afterSaveError` ; `beforeDelete`, puis `afterDelete`. |

## `useCollection`

Récupérez et abonnez-vous à une liste d'entités dans une collection. Il établit automatiquement un abonnement WebSocket en temps réel si le pilote le prend en charge, avec un repli sur des requêtes REST.

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

### Paramètres

| Paramètre | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Chemin absolu de la collection (ex. `"products"`). |
| `collection` | `AdminCollection` | L'objet de définition de la collection. |
| `itemCount` | `number` | Facultatif. Nombre d'entités à récupérer (limite SQL). |
| `offset` | `number` | Facultatif. Nombre d'éléments à ignorer. |
| `page` | `number` | Facultatif. Numéro de page (indexé à partir de 1), alternative à l'offset. |
| `filterValues` | `FilterValues` | Facultatif. Filtres de requête. Prend en charge la notation raccourcie d'égalité, les tuples `[op, val]` et les chaînes d'opérateurs PostgREST. |
| `sortBy` | `[string, "asc" \| "desc"]` | Facultatif. Tuple du champ de tri et de la direction de tri. |
| `searchString` | `string` | Facultatif. Requête pour la recherche en texte intégral. |

### Valeur de retour

| Propriété | Type | Description |
|-----------|------|-------------|
| `data` | `Entity[]` | Tableau des entités récupérées. |
| `dataLoading` | `boolean` | `true` si le chargement initial est en cours. |
| `dataLoadingError` | `Error` | Objet d'erreur si la récupération échoue. |
| `noMoreToLoad` | `boolean` | `true` s'il n'y a plus d'enregistrements au-delà de la page/limite actuelle. |
| `totalCount` | `number` | Facultatif. Le nombre total d'enregistrements correspondant au filtre dans la base de données. |

## `useFetch`

Récupérez et abonnez-vous à une seule entité par son ID. Le rendu se fait instantanément à partir des données en cache si elle a déjà été chargée via une récupération de collection, puis se met à jour en arrière-plan.

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

### Paramètres

| Paramètre | Type | Description |
|-----------|------|-------------|
| `path` | `string` | Chemin absolu de la collection. |
| `entityId` | `string \| number` | L'ID de l'entité à récupérer. |
| `collection` | `AdminCollection` | L'objet de définition de la collection. |
| `useCache` | `boolean` | Facultatif. Si `true` et que l'entité est en cache, ignore le rafraîchissement en arrière-plan. (Par défaut : `false`). |

### Utilitaires de mise en cache

Rebase conserve un cache mémoire global pour éviter les clignotements de l'interface utilisateur. Vous pouvez manipuler ce cache directement :

- `populateFetchCache(path, entities)` : Préremplit le cache avec une liste d'entités (par exemple après une action groupée ou un appel d'API personnalisé). Le cache conserve les 2 000 enregistrements les plus récemment écrits ou lus. Une vue de collection n'y écrit plus chaque ligne qu'elle affiche : cliquer sur une ligne, ou sur son action **Edit** ou **Copy**, place cette seule ligne dans le cache, afin que l'enregistrement s'ouvre toujours avec ses valeurs à l'écran.
- `clearFetchCache()` : Vide le cache. Il est recommandé de l'appeler lors de la déconnexion de l'utilisateur pour éviter les fuites de données.

## `usePermissions`

Hook permettant d'évaluer les rôles et les permissions pour l'utilisateur actuel. Il évite d'avoir à transmettre manuellement l'`authController` aux fonctions de vérification des permissions.

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
| `canEdit` | `(collection, path, entity) => boolean` | Vérifie si l'utilisateur est autorisé à modifier l'entité donnée. |
| `canDelete` | `(collection, path, entity) => boolean` | Vérifie si l'utilisateur est autorisé à supprimer l'entité donnée. |
| `canRead` | `(collection) => boolean` | Vérifie si l'utilisateur est autorisé à lire la collection. |

## `useClipboard`

Hook utilitaire pour copier ou couper du texte dans le presse-papiers, avec prise en charge automatique de mécanismes de repli pour les navigateurs plus anciens.

> [!NOTE]
> Notez l'orthographe exacte de `isCoppied` (avec deux « p ») dans la valeur retournée.

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
| `copy` | `(text?: string) => void` | Déclenche la copie du texte fourni, ou du contenu de l'élément référencé par la ref. |
| `cut` | `() => void` | Déclenche la coupure du contenu de l'élément référencé par la ref. |
| `isCoppied` | `boolean` | `true` si du texte a été récemment copié. |
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
|---------|-------------|
| `open({ path, entityId, collection })` | Ouvrir une entité dans un panneau latéral |
| `close()` | Fermer le panneau latéral actuel |
| `replace({ path, entityId, collection })` | Remplacer le contenu du panneau latéral actuel |

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

`open()` accepte `{ type, title?, message, autoHideDuration?, action? }`.

L'emplacement `action` affiche un bouton à côté du message, ce qui est idéal pour l'action d'annulation (undo) — la fenêtre temporelle durant laquelle l'annulation a du sens correspond au temps où le snackbar est affiché à l'écran :

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

Le snackbar se ferme automatiquement une fois l'action cliquée, ce qui empêche de déclencher deux fois la même annulation. Deux snackbars contenant le même message apparaissent tous deux lorsque chacun a une action — rejeter deux candidatures d'affilée vous laisse un moyen d'annuler chacune d'elles.

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

Ouvrez une boîte de dialogue latérale pour sélectionner des entités à partir d'une collection. C'est le même hook utilisé en interne lorsqu'une propriété de relation est affichée :

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

## `useRelationSelector`

Gérez des sélections de relations complexes avec recherche intégrée, anti-rebond (debouncing) et pagination.

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

### Paramètres

| Option | Type | Description |
|--------|------|-------------|
| `path` | `string` | Chemin absolu de la collection. |
| `collection` | `AdminCollection` | Définition de la collection cible. |
| `fixedFilter` | `FilterValues` | Facultatif. Filtres statiques pour restreindre les résultats de recherche. |
| `pageSize` | `number` | Facultatif. Nombre d'éléments par page. (Par défaut : `10`). |
| `getLabelFromEntity` | `(entity) => string` | Facultatif. Personnaliser le texte du libellé affiché. |
| `getDescriptionFromEntity` | `(entity) => string` | Facultatif. Personnaliser le texte de description. |

## `useRebaseClient`

Récupérez l'instance sous-jacente du SDK typé (`RebaseClient`) depuis le contexte React. Ceci est utile pour invoquer des opérations brutes du SDK (comme l'appel d'endpoints personnalisés ou des téléversements manuels) au sein de vos composants.

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

Empêchez la navigation ou le déchargement de la page lorsque les données d'un formulaire comportent des modifications non enregistrées. Il demande confirmation avant un rechargement ou la fermeture d'un onglet (`beforeunload`) et, dans l'administration sous un data router React Router (`createBrowserRouter`), avant la navigation dans l'application également, via `useBlocker`. Sous tout autre routeur, tel qu'un simple `<BrowserRouter>`, seule l'invite au niveau du navigateur s'applique.

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
| `when` | `boolean` | Indicateur pour activer le blocage de la navigation de la page/du routeur. |
| `onOk` | `() => void` | Callback déclenché lorsque l'utilisateur confirme l'abandon des modifications. |

### Valeur de retour

| Propriété | Type | Description |
|-----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props de la modale à passer directement à un composant d'interface utilisateur `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Déclenche manuellement l'affichage de la boîte de dialogue par programmation. |

## `useEffectiveRoleController`

Changez le rôle pour lequel la navigation du panneau d'administration est construite, sans vous déconnecter : les vues Studio qu'elle liste. Cela n'envoie rien au serveur et n'évalue aucune politique de sécurité au niveau des lignes (RLS), de sorte qu'une vue de données affiche toujours ce que vous êtes autorisé à lire. Pour tester les politiques RLS, utilisez **Simulate access** (au-dessus de votre avatar dans le tiroir latéral), ou `client.simulate()` depuis le code ; voir [Tester les accès](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` fournit le contrôleur. `useBuildEffectiveRoleController`, le hook qui en construisait un à transmettre comme `effectiveRoleController`, est obsolète au profit de Simulate access et émet un avertissement une seule fois lorsqu'il est appelé.

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

Changez les modes d'affichage de la disposition d'administration au sein du panneau d'administration.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Ouvrez des écrans de boîte de dialogue de manière impérative depuis n'importe quel endroit de l'arborescence des composants.

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
- **[SDK typé](/docs/sdk)** — SDK pour les opérations sur les données
