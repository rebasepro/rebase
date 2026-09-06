---
sourceHash: 2ed2b6947b459eef
title: Referencia de Hooks
sidebar_label: Hooks
description: Hooks de React que proporciona Rebase para acceder a autenticación, datos, navegación, paneles laterales, almacenamiento y estado de la UI.
---

## Resumen

Rebase proporciona hooks de React para acceder a la funcionalidad del framework desde cualquier componente dentro del árbol del proveedor `<Rebase>`.

## `useRebaseContext`

El hook maestro — acceso a todo:

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

Accede al estado y las capacidades de autenticación:

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

Carga y se suscribe a una lista de entidades de una colección. Establece automáticamente una suscripción WebSocket en tiempo real si el driver la admite, y recurre a peticiones REST en caso contrario.

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

### Parámetros

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `path` | `string` | Ruta absoluta de la colección (p. ej., `"products"`). |
| `collection` | `CollectionConfig` | El objeto de definición de la colección. |
| `itemCount` | `number` | Opcional. Número de entidades a cargar (límite SQL). |
| `offset` | `number` | Opcional. Número de elementos a omitir. |
| `page` | `number` | Opcional. Número de página (empezando en 1), alternativa a `offset`. |
| `filterValues` | `FilterValues` | Opcional. Filtros de consulta. Admite igualdad abreviada, tuplas `[op, val]` y cadenas de operador de PostgREST. |
| `sortBy` | `[string, "asc" \| "desc"]` | Opcional. Tupla con el campo de ordenación y la dirección. |
| `searchString` | `string` | Opcional. Consulta para la búsqueda de texto completo. |

### Valor de retorno

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `data` | `Entity[]` | Array de entidades cargadas. |
| `dataLoading` | `boolean` | True si la carga inicial está en curso. |
| `dataLoadingError` | `Error` | Objeto de error si la petición falla. |
| `noMoreToLoad` | `boolean` | True si no hay más registros más allá de la página o el límite actuales. |
| `totalCount` | `number` | Opcional. El total de registros de la base de datos que coinciden con el filtro. |

## `useFetch`

Carga y se suscribe a una única entidad por ID. Se renderiza al instante con los datos en caché si ya se cargaron mediante una petición de colección, y luego se actualiza en segundo plano.

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

### Parámetros

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `path` | `string` | Ruta absoluta de la colección. |
| `entityId` | `string \| number` | El ID de la entidad a cargar. |
| `collection` | `CollectionConfig` | El objeto de definición de la colección. |
| `useCache` | `boolean` | Opcional. Si es `true` y la entidad está en caché, omite el refresco en segundo plano. (Por defecto: `false`). |

### Utilidades de caché

Rebase mantiene una caché global en memoria para evitar parpadeos en la UI. Puedes manipular esa caché directamente:

- `populateFetchCache(path, entities)`: Rellena la caché por adelantado con una lista de entidades (p. ej., tras una acción masiva o una llamada a una API propia).
- `clearFetchCache()`: Vacía la caché. Se recomienda llamarlo al cerrar sesión el usuario para evitar filtraciones de datos.

## `usePermissions`

Hook para evaluar roles y permisos del usuario actual. Te evita tener que pasar manualmente el `authController` a las funciones de comprobación de permisos.

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

### Valor de retorno

| Método | Firma | Descripción |
|--------|-----------|-------------|
| `canCreate` | `(collection, path) => boolean` | Comprueba si el usuario puede crear entidades en la colección. |
| `canEdit` | `(collection, path, entity) => boolean` | Comprueba si el usuario puede editar la entidad dada. |
| `canDelete` | `(collection, path, entity) => boolean` | Comprueba si el usuario puede eliminar la entidad dada. |
| `canRead` | `(collection) => boolean` | Comprueba si el usuario puede leer la colección. |

## `useClipboard`

Hook de utilidad para copiar o cortar texto al portapapeles, con soporte automático de mecanismos de reserva en navegadores antiguos.

> [!NOTE]
> Fíjate en la ortografía exacta de `isCoppied` (con dos `p`) en el valor devuelto.

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

### Parámetros

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `copiedDuration` | `number` | Opcional. Tiempo en milisegundos antes de devolver `isCoppied` a `false`. |
| `onSuccess` | `(text) => void` | Opcional. Callback que se dispara al copiar correctamente. |
| `onError` | `(err) => void` | Opcional. Callback que se dispara en caso de error. |

### Valor de retorno

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `ref` | `MutableRefObject` | Ref de React para adjuntar a elementos input/textarea desde los que copiar. |
| `copy` | `(text?: string) => void` | Copia el texto dado, o el contenido del elemento del ref. |
| `cut` | `() => void` | Corta el contenido del elemento del ref. |
| `isCoppied` | `boolean` | True si se ha copiado texto recientemente. |
| `clipboard` | `string` | El valor de texto copiado actualmente. |
| `clearClipboard` | `() => void` | Vacía el portapapeles. |

## `useSidePanel`

Abrir entidades programáticamente en un panel lateral:

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

Métodos:

| Método | Descripción |
|--------|-------------|
| `open({ path, entityId, collection })` | Abrir una entidad en un panel lateral |
| `close()` | Cerrar el panel lateral actual |
| `replace({ path, entityId, collection })` | Reemplazar el contenido del panel lateral actual |

## `useSnackbarController`

Mostrar notificaciones toast:

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

`open()` recibe `{ type, title?, message, autoHideDuration?, action? }`.

El slot `action` renderiza un botón junto al mensaje, que es donde corresponde
poner deshacer — la ventana en la que deshacer significa algo es la ventana en la
que la snackbar está en pantalla:

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

La snackbar se cierra sola en cuanto se pulsa la acción, así que el mismo
deshacer no puede dispararse dos veces. Dos snackbars con el mismo mensaje
aparecen ambas cuando cada una tiene una acción — rechazar dos solicitudes
seguidas te deja una vuelta atrás para cada una.

## `useStorageSource`

Acceder a las operaciones de almacenamiento de archivos:

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

Controlar el tema claro/oscuro:

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

Abrir un diálogo lateral para seleccionar entidades de una colección. Este es el mismo hook usado internamente cuando se renderiza una propiedad de relación:

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

Acceder al estado de navegación y a las colecciones resueltas:

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

Gestiona selecciones de relaciones complejas, con búsqueda, debouncing y paginación integrados.

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

### Parámetros

| Opción | Tipo | Descripción |
|--------|------|-------------|
| `path` | `string` | Ruta absoluta de la colección. |
| `collection` | `CollectionConfig` | Definición de la colección de destino. |
| `fixedFilter` | `FilterValues` | Opcional. Filtros estáticos para restringir los resultados de búsqueda. |
| `pageSize` | `number` | Opcional. Número de elementos por página. (Por defecto: `10`). |
| `getLabelFromEntity` | `(entity) => string` | Opcional. Personaliza el texto de la etiqueta mostrada. |
| `getDescriptionFromEntity` | `(entity) => string` | Opcional. Personaliza el texto de la descripción. |

## `useRebaseClient`

Recupera del contexto de React la instancia del SDK cliente subyacente (`RebaseClient`). Es útil para invocar operaciones directas del SDK (como llamar a endpoints propios o hacer subidas manuales) dentro de tus componentes.

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

Impide la navegación o la descarga de la página cuando un formulario tiene cambios sin guardar. Intercepta automáticamente la navegación interna de React Router mediante `useBlocker`, así como las recargas a nivel de navegador mediante `beforeunload`.

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

### Parámetros

| Parámetro | Tipo | Descripción |
|-----------|------|-------------|
| `when` | `boolean` | Flag para activar el bloqueo de la navegación de página/router. |
| `onOk` | `() => void` | Callback que se dispara cuando el usuario confirma descartar los cambios. |

### Valor de retorno

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props del modal para pasar directamente a un componente de UI `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Muestra el diálogo de forma programática. |

## `useEffectiveRoleController`

Cambia de rol en tiempo de ejecución para previsualizar permisos y probar políticas de Row-Level Security (RLS) en local sin cerrar sesión.

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

Cambia los modos de vista del layout dentro del panel de administración.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Abrir pantallas de diálogo de forma imperativa desde cualquier punto del árbol de componentes.

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

Captura globalmente las acciones de la UI del CMS y los eventos de usuario.

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

## Próximos Pasos

- **[Descripción general del Frontend](/docs/frontend)** — Referencia del framework de React
- **[SDK de cliente](/docs/sdk)** — SDK de operaciones de datos
