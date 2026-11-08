---
sourceHash: 09a9548b22748eda
title: Referencia de Hooks
sidebar_label: Hooks
description: Hooks de React proporcionados por Rebase para acceder a la autenticación, los datos, la navegación, los paneles laterales, el almacenamiento y el estado de la interfaz de usuario.
---

## Visión general

Rebase proporciona hooks de React para acceder a la funcionalidad del framework desde cualquier componente dentro del árbol de proveedores `<Rebase>`.

## `useRebaseContext`

El hook principal: accede a todo:

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

Accede al estado y a las capacidades de autenticación:

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

## Filas: `useRows`, `useRow`, `useRowCount`, `useAggregate`, `useRowWrites`

Lee y escribe las filas de una colección con la misma estructura con la que las envía el servidor: fechas en formato de cadenas ISO, un belongsTo bajo su columna de clave foránea (`author_id`). Es la misma estructura que devuelve `client.data` y la misma que devuelve `context.data` en un callback de backend, por lo que el código escrito con estos hooks se lee igual que el código escrito directamente con el SDK.

Las filas provienen de la fuente de datos predeterminada de la aplicación. Con un `client`, se trata de `client.data`, y las agregaciones se realizan mediante HTTP. Sin él, se utiliza el driver de la fuente de datos predeterminada (un driver de Firebase, por ejemplo). Donde la fuente de datos permita suscripciones, las filas se mantienen en tiempo real. Donde no lo permita, cada hook de una colección realiza una nueva lectura después de cada escritura dentro del mismo `<Rebase>` (a través de `useRowWrites`, un formulario de registro, una vista de colección o `useData()`) y después de cada cambio anunciado por el driver de la fuente de datos. Lo mismo ocurre con las vistas de colección del administrador. Las opciones se comparan por valor, por lo que un objeto inline no desencadena una nueva lectura en cada renderizado. `error` es una cadena con el mensaje, y una escritura que falla también rechaza la promesa.

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

| Hook | Devuelve |
|------|----------|
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` es el tamaño de página, y `loadMore` añade una página a la misma lectura, hasta un máximo de 1000 filas. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` puede ser `undefined`, en cuyo caso no se lee nada. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. Los parámetros y el resultado son los de `client.data.<collection>.aggregate()`. Una fuente de datos que no admita agregaciones establece `error` y nunca devuelve un resultado vacío. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Cada escritura que se complete con éxito refresca todos los hooks de filas y vistas de colección de esa colección. Una escritura ejecuta los `admin.browserCallbacks` de la colección tal como lo hace el guardado del formulario de registro, con los mismos valores: `beforeSave` (que puede modificar los valores o lanzar un error para detener la escritura), luego `afterSave` o `afterSaveError`; `beforeDelete`, luego `afterDelete`. |

## `useCollection`

Obtiene y se suscribe a una lista de entidades en una colección. Establece automáticamente una suscripción en tiempo real mediante WebSocket si el driver lo admite, recurriendo a peticiones REST en caso contrario.

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
| `collection` | `AdminCollection` | El objeto de definición de la colección. |
| `itemCount` | `number` | Opcional. Número de entidades a obtener (límite SQL). |
| `offset` | `number` | Opcional. Número de elementos a omitir. |
| `page` | `number` | Opcional. Número de página (índice base 1), alternativa a offset. |
| `filterValues` | `FilterValues` | Opcional. Filtros de consulta. Admite igualdad abreviada, tuplas `[op, val]` y cadenas de operadores de PostgREST. |
| `sortBy` | `[string, "asc" \| "desc"]` | Opcional. Tupla con el campo de ordenación y la dirección. |
| `searchString` | `string` | Opcional. Consulta para búsqueda de texto completo. |

### Valor de retorno

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `data` | `Entity[]` | Array de entidades obtenidas. |
| `dataLoading` | `boolean` | `true` si la carga inicial está en progreso. |
| `dataLoadingError` | `Error` | Objeto de error si la obtención falla. |
| `noMoreToLoad` | `boolean` | `true` si no hay más registros más allá de la página/límite actual. |
| `totalCount` | `number` | Opcional. El recuento total de registros que coinciden con el filtro en la base de datos. |

## `useFetch`

Obtiene y se suscribe a una sola entidad por ID. Se renderiza instantáneamente usando datos en caché si ya se cargó a través de una obtención de colección, y luego se actualiza en segundo plano.

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
| `entityId` | `string \| number` | El ID de la entidad a obtener. |
| `collection` | `AdminCollection` | El objeto de definición de la colección. |
| `useCache` | `boolean` | Opcional. Si es `true` y la entidad está en caché, omite la actualización en segundo plano. (Por defecto: `false`). |

### Utilidades de caché

Rebase mantiene una caché global en memoria para evitar parpadeos en la interfaz de usuario. Puedes manipular esta caché directamente:

- `populateFetchCache(path, entities)`: Rellena previamente la caché con una lista de entidades (p. ej., después de una acción masiva o una llamada a una API personalizada). La caché conserva los 2.000 registros leídos o escritos más recientemente. Una vista de colección ya no escribe cada fila que muestra en ella: al hacer clic en una fila, o en su acción **Edit** o **Copy**, se coloca esa única fila allí, por lo que el registro todavía se abre con sus valores en pantalla.
- `clearFetchCache()`: Limpia la caché. Se recomienda llamar a esto al cerrar la sesión del usuario para evitar fugas de datos.

## `usePermissions`

Hook para evaluar roles y permisos del usuario actual. Evita la necesidad de pasar manualmente el `authController` a las funciones de comprobación de permisos.

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
|--------|-------|-------------|
| `canCreate` | `(collection, path) => boolean` | Comprueba si el usuario tiene permiso para crear entidades en la colección. |
| `canEdit` | `(collection, path, entity) => boolean` | Comprueba si el usuario tiene permiso para editar la entidad proporcionada. |
| `canDelete` | `(collection, path, entity) => boolean` | Comprueba si el usuario tiene permiso para eliminar la entidad proporcionada. |
| `canRead` | `(collection) => boolean` | Comprueba si el usuario tiene permiso para leer la colección. |

## `useClipboard`

Hook de utilidad para copiar o cortar texto al portapapeles, con soporte automático para mecanismos de respaldo en navegadores más antiguos.

> [!NOTE]
> Ten en cuenta la ortografía exacta de `isCoppied` (con dos `p`) en el objeto de retorno.

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
| `copiedDuration` | `number` | Opcional. Tiempo en milisegundos antes de restablecer `isCoppied` a `false`. |
| `onSuccess` | `(text) => void` | Opcional. Callback ejecutado tras copiar con éxito. |
| `onError` | `(err) => void` | Opcional. Callback ejecutado en caso de error. |

### Valor de retorno

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `ref` | `MutableRefObject` | Ref de React para adjuntar a elementos input/textarea desde los que copiar. |
| `copy` | `(text?: string) => void` | Desencadena la copia del texto proporcionado o del contenido del elemento de la ref. |
| `cut` | `() => void` | Desencadena el corte del contenido del elemento de la ref. |
| `isCoppied` | `boolean` | `true` si el texto se ha copiado recientemente. |
| `clipboard` | `string` | El valor del texto copiado actualmente. |
| `clearClipboard` | `() => void` | Limpia el portapapeles. |

## `useSidePanel`

Abre entidades en un panel lateral mediante código:

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
| `open({ path, entityId, collection })` | Abre una entidad en un panel lateral |
| `close()` | Cierra el panel lateral actual |
| `replace({ path, entityId, collection })` | Reemplaza el contenido del panel lateral actual |

## `useSnackbarController`

Muestra notificaciones tipo toast:

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

`open()` acepta `{ type, title?, message, autoHideDuration?, action? }`.

El slot `action` renderiza un botón junto al mensaje, que es donde corresponde colocar la opción de deshacer; la ventana de tiempo en la que deshacer tiene sentido es la misma en la que el snackbar está en pantalla:

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

El snackbar se cierra automáticamente una vez que se hace clic en la acción, por lo que el mismo deshacer no puede ejecutarse dos veces. Dos snackbars con el mismo mensaje aparecerán ambos si cada uno tiene una acción: rechazar dos solicitudes seguidas te deja una vía de retroceso para cada una.

## `useStorageSource`

Accede a las operaciones de almacenamiento de archivos:

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

Controla el tema claro/oscuro:

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

Abre un diálogo lateral para seleccionar entidades de una colección. Es el mismo hook que se utiliza internamente cuando se renderiza una propiedad de relación:

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

Accede al estado de navegación y a las colecciones resueltas:

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

Gestiona selecciones de relaciones complejas con búsqueda integrada, debouncing y paginación.

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
| `collection` | `AdminCollection` | Definición de la colección de destino. |
| `fixedFilter` | `FilterValues` | Opcional. Filtros estáticos para restringir los resultados de búsqueda. |
| `pageSize` | `number` | Opcional. Número de elementos por página. (Por defecto: `10`). |
| `getLabelFromEntity` | `(entity) => string` | Opcional. Personaliza el texto de la etiqueta visualizada. |
| `getDescriptionFromEntity` | `(entity) => string` | Opcional. Personaliza el texto de la descripción. |

## `useRebaseClient`

Recupera la instancia tipada subyacente del SDK (`RebaseClient`) desde el contexto de React. Esto resulta útil para invocar operaciones directas del SDK (como llamar a endpoints personalizados o subidas manuales) dentro de tus componentes.

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

Evita la navegación o la recarga de la página cuando los datos del formulario tienen cambios sin guardar. Solicita confirmación antes de recargar o cerrar una pestaña (`beforeunload`) y, dentro del panel de administración bajo un data router de React Router (`createBrowserRouter`), también antes de la navegación interna en la app, a través de `useBlocker`. Bajo cualquier otro enrutador, como un simple `<BrowserRouter>`, solo se aplica el aviso a nivel de navegador.

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
| `when` | `boolean` | Indicador para activar el bloqueo de navegación de página/enrutador. |
| `onOk` | `() => void` | Callback ejecutado cuando el usuario confirma descartar los cambios. |

### Valor de retorno

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props del modal para pasar directamente a un componente de interfaz `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Desencadena la visualización manual del diálogo de forma programática. |

## `useEffectiveRoleController`

Cambia el rol para el que está construida la navegación del panel de administración, sin cerrar sesión: qué vistas de Studio enumera. No envía nada al servidor ni evalúa ninguna política de seguridad a nivel de fila (RLS), por lo que una vista de datos sigue mostrando lo que tienes permiso para leer. Para probar RLS, usa **Simulate access** (encima de tu avatar en el menú lateral) o `client.simulate()` desde el código; consulta [Probar el acceso](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` proporciona el controlador. `useBuildEffectiveRoleController`, el hook que creaba uno para pasarlo como `effectiveRoleController`, está en desuso en favor de Simulate access y emite una advertencia la primera vez que se llama.

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

Cambia los modos de visualización del diseño de administración dentro del panel de administración.

```typescript
import { useAdminModeController } from "@rebasepro/app";

function ModeToggle() {
    const { mode, setMode } = useAdminModeController(); // mode is "cms" | "studio"

    return <button onClick={() => setMode("studio")}>Switch to Studio View</button>;
}
```

## `useDialogsController`

Abre pantallas de diálogo de forma imperativa desde cualquier lugar del árbol de componentes.

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

Captura acciones de la interfaz de usuario del CMS y eventos de usuario de forma global.

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

## Siguientes pasos

- **[Visión general del Frontend](/docs/frontend)** — Referencia del framework de React
- **[Typed SDK](/docs/sdk)** — SDK de operaciones de datos
