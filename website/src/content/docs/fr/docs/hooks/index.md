---
sourceHash: 2ed2b6947b459eef
title: Référence des Hooks
sidebar_label: Hooks
description: Hooks React fournis par Rebase pour accéder à l'authentification, aux données, à la navigation, aux panneaux latéraux, au stockage et à l'état de l'interface.
---

## Aperçu

Rebase fournit des hooks React pour accéder aux fonctionnalités du framework depuis n'importe quel composant à l'intérieur de l'arbre du provider `<Rebase>`.

## `useRebaseContext`

Le hook maître — accès à tout :

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

Accéder à l'état et aux capacités d'authentification :

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

Charge une liste d'entités d'une collection et s'y abonne. Un abonnement WebSocket temps réel est établi automatiquement si le driver le prend en charge, avec repli sur des requêtes REST.

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
| `path` | `string` | Chemin absolu de la collection (par ex. `"products"`). |
| `collection` | `CollectionConfig` | L'objet de définition de la collection. |
| `itemCount` | `number` | Facultatif. Nombre d'entités à charger (limite SQL). |
| `offset` | `number` | Facultatif. Nombre d'éléments à ignorer. |
| `page` | `number` | Facultatif. Numéro de page (à partir de 1), alternative à `offset`. |
| `filterValues` | `FilterValues` | Facultatif. Filtres de requête. Prend en charge l'égalité abrégée, les tuples `[op, val]` et les chaînes d'opérateur PostgREST. |
| `sortBy` | `[string, "asc" \| "desc"]` | Facultatif. Tuple champ de tri / sens du tri. |
| `searchString` | `string` | Facultatif. Requête pour la recherche plein texte. |

### Valeur de retour

| Propriété | Type | Description |
|----------|------|-------------|
| `data` | `Entity[]` | Tableau des entités chargées. |
| `dataLoading` | `boolean` | True tant que le chargement initial est en cours. |
| `dataLoadingError` | `Error` | Objet d'erreur si la requête échoue. |
| `noMoreToLoad` | `boolean` | True s'il n'y a plus d'enregistrements au-delà de la page ou de la limite actuelle. |
| `totalCount` | `number` | Facultatif. Le nombre total d'enregistrements de la base correspondant au filtre. |

## `useFetch`

Charge une seule entité par ID et s'y abonne. Elle s'affiche instantanément depuis le cache si elle a déjà été chargée par une requête de collection, puis se met à jour en arrière-plan.

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
| `entityId` | `string \| number` | L'ID de l'entité à charger. |
| `collection` | `CollectionConfig` | L'objet de définition de la collection. |
| `useCache` | `boolean` | Facultatif. Si `true` et que l'entité est en cache, ignore le rafraîchissement en arrière-plan. (Par défaut : `false`). |

### Utilitaires de cache

Rebase tient un cache mémoire global pour éviter les clignotements de l'interface. Vous pouvez le manipuler directement :

- `populateFetchCache(path, entities)`: Pré-remplit le cache avec une liste d'entités (par ex. après une action groupée ou un appel d'API personnalisé).
- `clearFetchCache()`: Vide le cache. À appeler de préférence à la déconnexion de l'utilisateur, pour éviter toute fuite de données.

## `usePermissions`

Hook d'évaluation des rôles et permissions de l'utilisateur courant. Il vous évite de passer manuellement l'`authController` aux fonctions de vérification des permissions.

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
|--------|-----------|-------------|
| `canCreate` | `(collection, path) => boolean` | Vérifie si l'utilisateur a le droit de créer des entités dans la collection. |
| `canEdit` | `(collection, path, entity) => boolean` | Vérifie si l'utilisateur a le droit de modifier l'entité donnée. |
| `canDelete` | `(collection, path, entity) => boolean` | Vérifie si l'utilisateur a le droit de supprimer l'entité donnée. |
| `canRead` | `(collection) => boolean` | Vérifie si l'utilisateur a le droit de lire la collection. |

## `useClipboard`

Hook utilitaire pour copier ou couper du texte vers le presse-papiers, avec prise en charge automatique des mécanismes de repli sur les navigateurs anciens.

> [!NOTE]
> Notez l'orthographe exacte de `isCoppied` (avec deux `p`) dans la valeur retournée.

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
| `copiedDuration` | `number` | Facultatif. Délai en millisecondes avant de remettre `isCoppied` à `false`. |
| `onSuccess` | `(text) => void` | Facultatif. Callback déclenché en cas de copie réussie. |
| `onError` | `(err) => void` | Facultatif. Callback déclenché en cas d'erreur. |

### Valeur de retour

| Propriété | Type | Description |
|----------|------|-------------|
| `ref` | `MutableRefObject` | Ref React à attacher aux éléments input/textarea depuis lesquels copier. |
| `copy` | `(text?: string) => void` | Copie le texte fourni, ou le contenu de l'élément référencé. |
| `cut` | `() => void` | Coupe le contenu de l'élément référencé. |
| `isCoppied` | `boolean` | True si du texte a été copié récemment. |
| `clipboard` | `string` | La valeur de texte actuellement copiée. |
| `clearClipboard` | `() => void` | Vide le presse-papiers. |

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
| `open({ path, entityId, collection })` | Ouvrir une entité dans un panneau latéral |
| `close()` | Fermer le panneau latéral courant |
| `replace({ path, entityId, collection })` | Remplacer le contenu du panneau latéral courant |

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

`open()` prend `{ type, title?, message, autoHideDuration?, action? }`.

Le slot `action` rend un bouton à côté du message, et c'est là qu'appartient
l'annulation — la fenêtre pendant laquelle annuler veut dire quelque chose est
celle où la snackbar est à l'écran :

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

La snackbar se ferme d'elle-même dès que l'action est cliquée : la même
annulation ne peut donc pas se déclencher deux fois. Deux snackbars portant le
même message apparaissent toutes les deux dès que chacune a une action — refuser
deux candidatures d'affilée vous laisse un retour en arrière pour chacune.

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

Ouvrir une boîte de dialogue latérale pour sélectionner des entités d'une collection. C'est le hook utilisé en interne lorsqu'une propriété de relation est rendue :

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

## `useRelationSelector`

Gérer des sélections de relations complexes, avec recherche, anti-rebond et pagination intégrés.

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
| `collection` | `CollectionConfig` | Définition de la collection cible. |
| `fixedFilter` | `FilterValues` | Facultatif. Filtres statiques restreignant les résultats de recherche. |
| `pageSize` | `number` | Facultatif. Nombre d'éléments par page. (Par défaut : `10`). |
| `getLabelFromEntity` | `(entity) => string` | Facultatif. Personnalise le texte du libellé affiché. |
| `getDescriptionFromEntity` | `(entity) => string` | Facultatif. Personnalise le texte de la description. |

## `useRebaseClient`

Récupère depuis le contexte React l'instance du SDK client sous-jacent (`RebaseClient`). Utile pour invoquer des opérations SDK brutes (appeler des endpoints personnalisés, faire des envois manuels) au sein de vos composants.

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

Empêche la navigation ou le déchargement de la page lorsqu'un formulaire comporte des modifications non enregistrées. Il intercepte automatiquement la navigation interne de React Router via `useBlocker`, ainsi que les rechargements au niveau du navigateur via `beforeunload`.

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
| `when` | `boolean` | Drapeau activant le blocage de la navigation page/routeur. |
| `onOk` | `() => void` | Callback déclenché lorsque l'utilisateur confirme l'abandon des modifications. |

### Valeur de retour

| Propriété | Type | Description |
|----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props de la modale, à passer directement à un composant d'interface `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Affiche la boîte de dialogue par programmation. |

## `useEffectiveRoleController`

Changer de rôle à l'exécution pour prévisualiser les permissions et tester les politiques de Row-Level Security (RLS) en local sans se déconnecter.

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

Change les modes d'affichage de la mise en page à l'intérieur du panneau d'administration.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Ouvrir des boîtes de dialogue de manière impérative depuis n'importe où dans l'arbre de composants.

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

- **[Aperçu du Frontend](/docs/frontend)** — Référence du framework React
- **[SDK client](/docs/sdk)** — SDK des opérations de données
