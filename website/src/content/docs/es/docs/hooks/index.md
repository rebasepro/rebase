---
sourceHash: e73caf2e48ec0dd6
title: Referencia de Hooks
sidebar_label: Hooks
description: Hooks de React proporcionados por Rebase para acceder a autenticación, datos, navegación, paneles laterales, almacenamiento y estado de la interfaz de usuario.
---

## Descripción general

Rebase proporciona hooks de React para acceder a la funcionalidad del framework desde cualquier componente dentro del árbol del proveedor `<Rebase>`.

## `useRebaseContext`

<span class="since-badge" data-since="0.29">Desde 0.29</span>
El hook maestro — accede a todo:

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

`context.data` es la misma capa plana que leen los hooks de filas: `context.data.orders.find()`
se resuelve en `{ data: rows, meta }`, una fecha es su cadena ISO y un belongsTo es su
columna de clave foránea, exactamente como los devuelven `context.data` y
`client.data` de un callback del backend. Sus métodos `create`, `update` y `delete` ejecutan los
`admin.browserCallbacks` de la colección y actualizan cada vista de la colección,
tal como lo hace `useRowWrites`. Úsalo cuando el estado de React no encaje: el
`onClick` de una acción de entidad, un callback, un constructor de colecciones.

## `useAuthController`

Accede al estado de autenticación y a las capacidades:

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

Lee y escribe las filas de una colección en la forma en que el servidor las envía: fechas como cadenas ISO, un belongsTo bajo su columna de clave foránea (`author_id`). Es la misma forma que devuelven `client.data` y `context.data`, por lo que el código escrito con estos hooks se lee como código escrito contra el SDK.

Las filas de cada colección provienen de la fuente de datos que declara (`dataSource`, consulta [Múltiples fuentes de datos](/docs/backend/multiple-sources)), y las de cualquier otra colección provienen de la fuente de datos predeterminada de la aplicación. Con un `client`, la predeterminada es `client.data`, y las agregaciones se realizan a través de HTTP. Sin uno, es el driver de la fuente de datos predeterminada (un driver de Firebase, por ejemplo). Donde la fuente de datos puede suscribirse, las filas se mantienen en vivo. Donde no puede, cada hook de una colección vuelve a leer después de cada escritura en ella dentro del mismo `<Rebase>` (a través de `useRowWrites`, `context.data`, un formulario de registro o una vista de colección) y después de cada cambio que el driver de la fuente de datos anuncie. Lo mismo hacen las vistas de colección del administrador. Las opciones se comparan por valor, por lo que un objeto en línea no desencadena una nueva lectura en cada renderizado. `error` es una cadena de mensaje, y una escritura que falla también rechaza la promesa.

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
| `useRows(collection, { where, orderBy, limit, offset, searchString })` | `{ rows, total, hasMore, loadMore, loading, error, refresh }`. `limit` es el tamaño de página y `loadMore` añade una página a la misma lectura, hasta 1000 filas. |
| `useRow(collection, id)` | `{ row, loading, error, refresh }`. `id` puede ser `undefined`, en cuyo caso no se lee nada. |
| `useRowCount(collection, where)` | `{ count, loading, error }` |
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. Los parámetros y el resultado son los de `client.data.<collection>.aggregate()`. Una fuente de datos que no puede realizar agregaciones establece `error` y nunca devuelve un resultado vacío. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Cada escritura exitosa actualiza todos los hooks de filas y vistas de colección de esa colección. Una escritura ejecuta los `admin.browserCallbacks` de la colección tal como lo hace el guardado del formulario de registro: `beforeSave` (que puede modificar la fila o lanzar un error para detener la escritura), luego `afterSave` o `afterSaveError`; `beforeDelete`, luego `afterDelete`. A cada uno se le entregan las filas tal como las envía el servidor. |

## `usePermissions`

Hook para evaluar roles y permisos del usuario actual. Abstrae la necesidad de pasar manualmente el `authController` a las funciones de verificación de permisos.

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
| `canEdit` | `(collection, path, row) => boolean` | Comprueba si el usuario tiene permiso para editar la fila dada, tal como la devuelven `useRows` o `context.data`. `null` consulta sobre la colección sin ninguna fila en mano. |
| `canDelete` | `(collection, path, row) => boolean` | Comprueba si el usuario tiene permiso para eliminar la fila dada. `null` consulta sobre la colección sin ninguna fila en mano. |
| `canRead` | `(collection) => boolean` | Comprueba si el usuario tiene permiso para leer la colección. |

## `useClipboard`

Hook de utilidad para copiar o cortar texto al portapapeles, con soporte automático para mecanismos alternativos (fallbacks) en navegadores antiguos.

> [!NOTE]
> Ten en cuenta la ortografía exacta de `isCoppied` (con dos `p`) en el objeto retornado.

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
| `copiedDuration` | `number` | Opcional. Tiempo en milisegundos antes de restablecer `isCoppied` de nuevo a `false`. |
| `onSuccess` | `(text) => void` | Opcional. Callback ejecutado cuando la copia es exitosa. |
| `onError` | `(err) => void` | Opcional. Callback ejecutado en caso de error. |

### Valor de retorno

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `ref` | `MutableRefObject` | Ref de React para adjuntar a elementos input/textarea desde los que copiar. |
| `copy` | `(text?: string) => void` | Desencadena la copia del texto dado o del contenido del elemento ref. |
| `cut` | `() => void` | Desencadena el corte del contenido del elemento ref. |
| `isCoppied` | `boolean` | True si el texto se copió recientemente. |
| `clipboard` | `string` | El valor del texto copiado actualmente. |
| `clearClipboard` | `() => void` | Limpia el portapapeles. |

## `useSidePanel`

Abre entidades en un panel lateral de forma programática:

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

Métodos:

| Método | Descripción |
|--------|-------------|
| `open({ path, id, collection })` | Abre una entidad en un panel lateral |
| `close()` | Cierra el panel lateral actual |
| `replace({ path, id, collection })` | Reemplaza el contenido del panel lateral actual |

## `useSnackbarController`

Muestra notificaciones toast:

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
la acción de deshacer: la ventana de tiempo en la que deshacer tiene sentido es el
tiempo que el snackbar permanece en pantalla:

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

El snackbar se cierra automáticamente una vez que se hace clic en la acción, por lo que
la misma acción de deshacer no puede ejecutarse dos veces. Dos snackbars que lleven el
mismo mensaje aparecerán ambos si cada uno tiene una acción; rechazar dos solicitudes
seguidas te deja una vía para deshacer cada una.

## `useStorageSource`

Accede a operaciones de almacenamiento de archivos:

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

Abre un diálogo lateral para seleccionar filas de una colección. Las filas se te
entregan tal como las envía el servidor, la forma que devuelve `useRows`, junto
con sus IDs al lado — las cadenas que reciben `selectedIds` y `useSidePanel().open`:

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

Con `multiselect: true`, `onMultipleRowsSelected(rows, ids)` notifica cada
selección y `onSelectionDone(rows, ids)` la selección final una sola vez, cuando se presiona Done — úsalo
cuando actuar sobre la selección implique escribir algo. `selectedIds` indica las filas que
se muestran seleccionadas, y al principio, cuando se abre el diálogo.

## `useSelectionController`

Una selección de filas de una colección que tú controlas: pásala a una vista como
`admin.selectionController` (en un `CollectionPanel`, a través de
`collectionOverrides`) y lee lo que el usuario marque allí:

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

`selection.selection` es `{ type: "rows", ids, rows }` para las filas marcadas, o
`{ type: "query", query, excludedIds, count }` una vez que se selecciona "all matching";
`resolveSelection({ selection: selection.selection, data: context.data,
collection })` lee las filas de una selección por consulta y entrega `{ rows, ids }` en cualquiera de los modos. `isSelected(id)`,
`toggleSelection(row)`, `setSelectedRows(rows)` y `clearSelection()` lo modifican.

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

## `useRebaseClient`

Obtén la instancia del SDK tipado subyacente (`RebaseClient`) desde el contexto de React. Esto es útil para invocar operaciones directas del SDK (como llamar a endpoints personalizados o subidas manuales) dentro de tus componentes.

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

Evita la navegación o la descarga de la página cuando los datos del formulario tienen cambios sin guardar. Pregunta antes de recargar o cerrar una pestaña (`beforeunload`) y, dentro del panel de administración bajo un data router de React Router (`createBrowserRouter`), también antes de la navegación interna de la aplicación, mediante `useBlocker`. Bajo cualquier otro enrutador, como un `<BrowserRouter>` convencional, solo se aplica el aviso a nivel de navegador.

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
| `triggerDialog` | `() => void` | Activa la visualización manual del diálogo de forma programática. |

## `useEffectiveRoleController`

Cambia el rol para el cual se construye la navegación del panel de administración, sin cerrar sesión:
qué vistas de Studio muestra. No envía nada al servidor ni evalúa ninguna
política de seguridad a nivel de fila (RLS), por lo que una vista de datos sigue mostrando lo que puedes leer. Para
probar RLS, usa **Simulate access** (encima de tu avatar en el drawer), o `client.simulate()` desde
el código; consulta [Probar acceso](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` proporciona el controlador. `useBuildEffectiveRoleController`, el hook
que creaba uno para pasarlo como `effectiveRoleController`, está obsoleto en favor de
Simulate access y emite una advertencia una vez cuando se llama.

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

Cambia los modos de vista del diseño del administrador dentro del panel de administración.

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

## Próximos pasos

- **[Visión general del frontend](/docs/frontend)** — Referencia del framework de React
- **[SDK Tipado](/docs/sdk)** — SDK de operaciones de datos
