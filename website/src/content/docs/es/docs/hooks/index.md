---
sourceHash: b247fb716c8348a7
title: Referencia de hooks
sidebar_label: Hooks
description: Hooks de React proporcionados por Rebase para acceder a autenticación, datos, navegación, paneles laterales, almacenamiento y estado de la interfaz de usuario.
---

## Descripción general

Rebase proporciona hooks de React para acceder a la funcionalidad del framework desde cualquier componente dentro del árbol del proveedor `<Rebase>`.

## `useRebaseContext`

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El hook principal: accede a todo:

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
se resuelve como `{ data: rows, meta }`, una fecha es su cadena ISO y una relación belongsTo es su
columna de clave foránea, exactamente como los devuelven `context.data` y
`client.data` en un callback de backend. Sus métodos `create`, `update` y `delete` ejecutan los
`browserCallbacks` de la tabla (desde su `customizeTable`) y actualizan cada vista de la colección,
tal como lo hace `useRowWrites`. Úsalo cuando el estado de React no sea el adecuado: en el
`onClick` de una acción de entidad, un callback o un generador de colecciones.

## `useAuthController`

Accede al estado de autenticación y sus capacidades:

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

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Lee y escribe las filas de una colección en la forma en que las envía el servidor: fechas como cadenas ISO, relaciones belongsTo bajo su columna de clave foránea (`author_id`). Es la misma forma que devuelven `client.data` y `context.data`, por lo que el código escrito con estos hooks se lee como código escrito contra el SDK.

Las filas de cada colección provienen de la fuente de datos que declara (`dataSource`, consulta [Múltiples fuentes de datos](/docs/backend/multiple-sources)), y las de cualquier otra colección, de la fuente de datos predeterminada de la aplicación. Con un `client`, la opción predeterminada es `client.data`, y las agregaciones se realizan a través de HTTP. Sin él, es el controlador (driver) de la fuente de datos predeterminada (un driver de Firebase, por ejemplo). Donde la fuente de datos permita suscribirse, las filas se mantienen en tiempo real. Donde no pueda, cada hook de una colección vuelve a leer después de cada escritura en ella dentro del mismo `<Rebase>` (a través de `useRowWrites`, `context.data`, un formulario de registro o una vista de colección) y después de cada cambio anunciado por el driver de la fuente de datos. Lo mismo ocurre con las vistas de colección del administrador. Las opciones se comparan por valor, por lo que un objeto en línea no desencadena una nueva lectura en cada renderizado. `error` es una cadena con un mensaje, y una escritura que falla también rechaza la promesa (rejects).

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
| `useAggregate(collection, { select, groupBy, where, orderBy, limit, offset })` | `{ result, loading, error }`. Los parámetros y el resultado son los de `client.data.<collection>.aggregate()`. Una fuente de datos que no admita agregaciones establece `error` y nunca devuelve un resultado vacío. |
| `useRowWrites()` | `{ create(collection, values, id?), update(collection, id, values), remove(collection, id), saving, error }`. Cada escritura exitosa actualiza todos los hooks de fila y vistas de colección de esa colección. Una escritura ejecuta los `browserCallbacks` de la tabla (desde su `customizeTable`) de la misma forma que lo hace el guardado del formulario de registros: `beforeSave` (que puede modificar la fila o lanzar una excepción para detener la escritura), luego `afterSave` o `afterSaveError`; `beforeDelete`, luego `afterDelete`. A cada uno se le pasan las filas en la forma en que las envía el servidor. |

## `usePermissions`

Hook para evaluar roles y permisos del usuario actual. Abstrae la necesidad de pasar manualmente el `authController` a las funciones de verificación de permisos.

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

La respuesta proviene de la seguridad a nivel de fila (RLS) de la tabla, evaluada en el navegador
de la misma forma en que el panel decide qué controles mostrar (consulta
[quién ve qué controles](/docs/collections/#who-sees-which-controls)). La
base de datos sigue decidiendo cada escritura.

### Valor de retorno

| Método | Firma | Descripción |
|--------|-------|-------------|
| `canCreate` | `(collection, path) => boolean` | Comprueba si el usuario tiene permiso para crear entidades en la colección. |
| `canEdit` | `(collection, path, row) => boolean` | Comprueba si el usuario tiene permiso para editar la fila dada, tal como la devuelven `useRows` o `context.data`. `null` consulta sobre la colección sin ninguna fila específica en mano. |
| `canDelete` | `(collection, path, row) => boolean` | Comprueba si el usuario tiene permiso para eliminar la fila dada. `null` consulta sobre la colección sin ninguna fila específica en mano. |
| `canRead` | `(collection) => boolean` | Comprueba si el usuario tiene permiso para leer la colección. |

## `useClipboard`

Hook de utilidad para copiar o cortar texto al portapapeles, con soporte automático para mecanismos alternativos (fallbacks) en navegadores más antiguos.

> [!NOTE]
> Ten en cuenta la ortografía exacta de `isCoppied` (con dos `p`) en la carga útil devuelta.

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
| `onSuccess` | `(text) => void` | Opcional. Callback ejecutado tras una copia exitosa. |
| `onError` | `(err) => void` | Opcional. Callback ejecutado en caso de error. |

### Valor de retorno

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `ref` | `MutableRefObject` | Ref de React para adjuntar a elementos input/textarea desde los que copiar. |
| `copy` | `(text?: string) => void` | Desencadena la copia del texto dado o del contenido del elemento referenciado. |
| `cut` | `() => void` | Desencadena el corte del contenido del elemento referenciado. |
| `isCoppied` | `boolean` | `true` si el texto se copió recientemente. |
| `clipboard` | `string` | El valor actual del texto copiado. |
| `clearClipboard` | `() => void` | Limpia el portapapeles. |

## `useSidePanel`

Abre entidades mediante programación en un panel lateral:

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

Muestra notificaciones flotantes (toast):

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

El espacio `action` renderiza un botón junto al mensaje, que es el lugar correspondiente para
deshacer: la ventana de tiempo en la que deshacer tiene sentido es el tiempo que el snackbar
permanece en pantalla:

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

El snackbar se descarta automáticamente una vez que se hace clic en la acción, por lo que la
misma acción de deshacer no puede ejecutarse dos veces. Dos snackbars con el mismo mensaje
aparecerán ambos si cada uno tiene una acción; rechazar dos solicitudes seguidas te deja una
opción para revertir cada una.

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

Abre un cuadro de diálogo lateral para seleccionar filas de una colección. Las filas se entregan
tal como las envía el servidor, la forma que devuelve `useRows`, junto a sus IDs:
las cadenas que aceptan `selectedIds` y `useSidePanel().open`:

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

Con `multiselect: true`, `onMultipleRowsSelected(rows, ids)` informa de cada selección y
`onSelectionDone(rows, ids)` de la selección final una sola vez, cuando se presiona Done (Listo); úsalo
cuando actuar sobre la selección implique escribir datos. `selectedIds` nombra las filas que se
muestran seleccionadas, y en primer lugar, cuando se abre el cuadro de diálogo.

## `useSelectionController`

Una selección de filas de una colección que mantienes: pásala a una vista como
`selectionController` (en un `CollectionPanel`, a través de
`collectionOverrides`) y lee lo que el usuario marca allí:

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
`{ type: "query", query, excludedIds, count }` una vez que se elige "all matching" (todas las coincidentes);
`resolveSelection({ selection: selection.selection, data: context.data,
collection })` lee las filas de una selección por consulta y entrega `{ rows, ids }` en cualquiera de los dos modos. `isSelected(id)`,
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

Obtén la instancia tipada subyacente del SDK (`RebaseClient`) desde el contexto de React. Esto resulta útil para invocar operaciones directas del SDK (como llamar a endpoints personalizados o realizar subidas manuales) dentro de tus componentes.

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

Evita la navegación o la descarga de la página cuando los datos del formulario tienen cambios sin guardar. Pregunta antes de recargar la página o cerrar la pestaña (`beforeunload`) y, dentro del panel de administración bajo un data router de React Router (`createBrowserRouter`), también antes de la navegación interna de la aplicación, mediante `useBlocker`. Con cualquier otro enrutador, como un simple `<BrowserRouter>`, solo se aplica la advertencia a nivel del navegador.

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
| `when` | `boolean` | Indicador (flag) para activar el bloqueo de navegación en la página o en el enrutador. |
| `onOk` | `() => void` | Callback ejecutado cuando el usuario confirma descartar los cambios. |

### Valor de retorno

| Propiedad | Tipo | Descripción |
|-----------|------|-------------|
| `dialogProps` | `UnsavedChangesDialogProps` | Props del modal para pasar directamente a un componente de interfaz de usuario `UnsavedChangesDialog`. |
| `triggerDialog` | `() => void` | Desencadena manualmente la visualización del diálogo mediante programación. |

## `useEffectiveRoleController`

Cambia el rol para el cual está construida la navegación del panel de administración, sin cerrar sesión:
qué vistas de Studio enumera. No envía nada al servidor ni evalúa ninguna
política de seguridad a nivel de fila (RLS), por lo que una vista de datos sigue mostrando lo que puedes leer. Para
probar RLS, usa **Simulate access** (Simular acceso, encima de tu avatar en el drawer) o `client.simulate()` desde
el código; consulta [Probar el acceso](/docs/frontend/authentication/#testing-access-simulate-access).

`<Rebase>` proporciona el controlador. `useBuildEffectiveRoleController`, el hook
que creaba uno para pasarlo como `effectiveRoleController`, está en desuso (deprecated) en favor de
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

Cambia los modos de vista del diseño de administración dentro del panel de administración.

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

Captura acciones de la interfaz de usuario del CMS y eventos de usuario a nivel global.

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

- **[Descripción general del frontend](/docs/frontend)** — Referencia del framework de React
- **[SDK tipado](/docs/sdk)** — SDK de operaciones de datos
