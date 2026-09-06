---
sourceHash: f54d8319cbbee30f
title: Referencia de Hooks
sidebar_label: Hooks
description: Hooks de React proporcionados por Rebase para acceder al estado de autenticación, datos, navegación, paneles laterales, almacenamiento y la interfaz de usuario.
---

## Visión general

Rebase proporciona hooks de React para acceder a la funcionalidad del framework desde cualquier componente dentro del árbol de proveedores `<Rebase>`.

## `useRebaseContext`

El hook maestro — accede a todo:

```typescript
import { useRebaseContext } from "@rebasepro/app";

function MyComponent() {
    const context = useRebaseContext();

    context.data          // Operaciones de datos
    context.storageSource       // Operaciones de archivo
    context.authController      // Estado de autenticación
    context.navigation          // Estado de navegación
    context.sidePanel // Control de panel lateral
    context.snackbarController  // Notificaciones Toast
}
```

## `useAuthController`

Acceder al estado de autenticación:

```typescript
import { useAuthController } from "@rebasepro/app";

function UserMenu() {
    const auth = useAuthController();

    auth.user            // Usuario actual (o nulo)
    auth.initialLoading  // Cargando sesión inicial
    auth.signOut()       // Cerrar sesión
    auth.getAuthToken()  // Obtener JWT para llamadas a la API
    auth.extra           // Datos de usuario adicionales (roles, etc.)
}
```

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
            Abrir Producto
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

Mostrar notificaciones Toast:

```typescript
import { useSnackbarController } from "@rebasepro/app";

function SaveButton() {
    const snackbar = useSnackbarController();

    const handleSave = async () => {
        try {
            await saveData();
            snackbar.open({ type: "success", message: "¡Guardado con éxito!" });
        } catch (error) {
            snackbar.open({ type: "error", message: "Error al guardar" });
        }
    };
}
```

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

Controlar tema claro/oscuro:

```typescript
import { useModeController } from "@rebasepro/app";

function ThemeToggle() {
    const mode = useModeController();

    return (
        <button onClick={() => mode.setMode(mode.mode === "dark" ? "light" : "dark")}>
            Actual: {mode.mode} {/* "light" | "dark" */}
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
            console.log("Seleccionado:", entity);
        }
    });

    return <button onClick={selectionDialog.open}>Seleccionar Producto</button>;
}
```

## `useNavigationStateController`

Acceder al estado de navegación y colecciones resueltas:

```typescript
import { useNavigationStateController } from "@rebasepro/cms";

function MyComponent() {
    const navigation = useNavigationStateController();

    navigation.collections     // Todas las colecciones registradas
    navigation.views           // Vistas personalizadas
    navigation.adminViews      // Vistas en modo administrador
    navigation.getCollection(path) // Obtener colección para una ruta
}
```

## Próximos pasos

- **[Visión general del Frontend](/docs/frontend)** — Referencia del framework de React
- **[SDK del Cliente](/docs/sdk)** — SDK de operaciones de datos
