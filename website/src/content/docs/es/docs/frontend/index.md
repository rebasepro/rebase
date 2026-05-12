---
title: Descripción general del Frontend
sidebar_label: Frontend
slug: docs/frontend
description: Crea y personaliza el panel de administración de Rebase con React: controladores, scaffold, enrutamiento y vistas.
---

## Descripción general

El frontend de Rebase es un **framework de React** que renderiza tu panel de administración. Lee las definiciones de tus colecciones y genera tablas, formularios, navegación y enrutamiento automáticamente.

Los componentes clave que conforman un frontend de Rebase:

```tsx
<Rebase
    client={rebaseClient}
    collectionRegistryController={collectionRegistryController}
    cmsUrlController={cmsUrlController}
    navigationStateController={navigationStateController}
    authController={authController}
>
    {({ loading }) => (
        <Scaffold>
            <AppBar />
            <Drawer title="Mi aplicación" />
            <Outlet />
            <SideDialogs />
        </Scaffold>
    )}
</Rebase>
```

## El Proveedor Rebase

`<Rebase>` es el proveedor raíz que hace que toda la funcionalidad de Rebase esté disponible para los componentes hijos a través del contexto. Acepta:

| Propiedad | Descripción |
|------|-------------|
| `client` | Instancia de `RebaseClient` para datos, autenticación y almacenamiento |
| `collectionRegistryController` | Resuelve rutas y configuraciones de colecciones |
| `cmsUrlController` | Construye URLs y maneja el enrutamiento |
| `navigationStateController` | Gestiona el estado de navegación, vistas y plugins |
| `authController` | Estado y métodos de autenticación |
| `storageSource` | Operaciones de almacenamiento de archivos |
| `userConfigPersistence` | Preferencias de UI locales (ancho de columnas, etc.) |
| `entityViews` | Pestañas globales de vista de entidad personalizadas |
| `entityActions` | Acciones globales de entidad |
| `plugins` | Instancias de plugins (propiedad heredada — preferible pasar a través del controlador de navegación) |

## Controladores

Los controladores son hooks de React que configuran aspectos específicos del framework:

### `useBuildNavigationStateController`

El controlador principal que conecta todo:

```typescript
const navigationStateController = useBuildNavigationStateController({
    collections: () => [...collections],  // Definiciones de colección
    views: customViews,                   // Vistas de navegación personalizadas
    plugins,                              // Instancias de plugins
    authController,
    data: rebaseClient.data,
    collectionRegistryController,
    cmsUrlController,
    adminMode: adminModeController.mode,
    userManagement
});
```

### `useBuildCollectionRegistryController`

Gestiona cómo se resuelven las colecciones a partir de las rutas URL:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

### `useBuildCMSUrlController`

Configura la generación de URL:

```typescript
const cmsUrlController = useBuildCMSUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

### `useBuildModeController`

Gestiona el tema claro/oscuro:

```typescript
const modeController = useBuildModeController();
// Proporciona: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

### `useBuildAdminModeController`

Alterna entre los modos Studio y Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Proporciona: adminModeController.mode ("studio" | "content")
```

## Componentes Scaffold

| Componente | Descripción |
|-----------|-------------|
| `<Scaffold>` | Contenedor de diseño principal con barra lateral responsive |
| `<AppBar>` | Barra de navegación superior con búsqueda, alternancia de modo, menú de usuario |
| `<Drawer>` | Navegación lateral con lista de colecciones y enlaces a vistas |
| `<SideDialogs>` | Contenedor para editores de entidades en panel lateral |
| `<RebaseRoutes>` | Contenedor de rutas que se integra con React Router |
| `<RebaseRoute>` | Maneja las rutas de colección (`/c/*`) |
| `<ContentHomePage>` | Página de inicio predeterminada que muestra tarjetas de colección |
| `<StudioHomePage>` | Página de inicio del modo Studio con herramientas para desarrolladores |

## Vistas Personalizadas

Agrega vistas de navegación de nivel superior para paneles, herramientas o páginas personalizadas:

```typescript
const views: CMSView[] = [
    {
        slug: "dashboard",
        name: "Panel de control",
        icon: "dashboard",
        group: "Analíticas",
        view: <MyDashboard />
    },
    {
        slug: "settings",
        name: "Configuración de la aplicación",
        icon: "settings",
        view: <AppSettings />,
        nestedRoutes: true  // Soporte para subrutas
    }
];
```

## Estilizado

Rebase utiliza **Tailwind CSS v4** y soporta modos claro/oscuro. Personaliza a través de:

- **Propiedades personalizadas CSS** — Anula tokens de diseño
- **`ModeControllerProvider`** — Controla el modo claro/oscuro
- **Configuración de Tailwind** — Personalización estándar de Tailwind

```css
/* Anular tokens de diseño */
:root {
    --font-sans: "Inter", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Próximos pasos

- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construye campos de formulario personalizados
- **[Vistas de Entidad](/docs/frontend/entity-views)** — Agrega pestañas a los editores de entidades
- **[Modos de Vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban
- **[Plugins](/docs/plugins)** — Extiende el framework
---
