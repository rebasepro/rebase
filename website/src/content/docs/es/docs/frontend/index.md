---
sourceHash: da074057e497c0e3
title: Visión general del frontend
sidebar_label: Frontend
description: "Construye y personaliza el panel — Rebase CMS y Rebase Studio — con React: controladores, scaffold, enrutamiento y vistas."
---

## Visión general

El frontend de Rebase es un **framework de React** que renderiza tu panel de administración. Lee las definiciones de tus colecciones y genera tablas, formularios, navegación y enrutamiento automáticamente.

En el scaffold predeterminado, el panel de administración **es** el frontend: se sirve en la raíz de tu URL desplegada. Si en su lugar construyes tu propia aplicación de producto, puedes montar el panel de administración bajo un prefijo como `/admin` en el mismo despliegue — consulta [Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

Este es `frontend/src/App.tsx` tal como lo genera `rebase init` — todo el panel de administración, cuatro declaraciones dentro de un único proveedor:

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

const client = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            {/* Sign-in screen. Pass `loginView` to replace it. */}
            <RebaseAuth/>
            <RebaseCMS collections={collections}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Los primeros tres no renderizan nada: *registran* la configuración en el proveedor. `<RebaseShell>` es lo que dibuja — lee ese registro y construye la navegación, las rutas y el layout a partir de él. Por lo tanto, el orden en el que aparecen no importa, y añadir una funcionalidad significa añadir un componente, no volver a cablear un árbol.

| Componente | Paquete | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la pantalla de inicio de sesión (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | colecciones, vistas personalizadas, la página de inicio, el editor de colecciones |
| `<RebaseStudio>` | `@rebasepro/studio` | las herramientas de desarrollo (SQL, RLS, registros, copias de seguridad…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — renderiza la administración a partir de todo lo anterior |

Elimina `<RebaseStudio>` y tendrás un CMS solo de contenido; elimina `<RebaseCMS>` y tendrás únicamente las herramientas para desarrolladores. Para maquetar el shell manualmente, consulta [Avanzado: diseño manual](#avanzado-diseño-manual).

## El proveedor Rebase

`<Rebase>` es el proveedor raíz que pone a disposición de los componentes secundarios toda la funcionalidad de Rebase mediante context. Acepta:

Los veintidós en su totalidad — la tabla solía listar diez, y dos de ellos eran props que el componente nunca leía:

<!-- rebase-props:start -->
| Prop | Descripción |
|------|-------------|
| `children` | Los componentes raíz del panel de administración — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una función de renderizado es el mecanismo de escape para el diseño manual. |
| `apiUrl` | URL base de la API del backend, disponible para cada hook a través de `useApiConfig()` |
| `dateTimeFormat` | Cómo se muestran las fechas. Por defecto es `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial del panel de administración y el locale en el que se formatean las fechas — consulta [Traducciones](/docs/frontend/i18n) |
| `client` | Instancia de `RebaseClient`: la fuente predeterminada para datos, autenticación y almacenamiento |
| `dataSources` | Fuentes de datos adicionales, para colecciones que especifican una — consulta [Múltiples fuentes](/docs/backend/multiple-sources) |
| `authController` | Estado y métodos de autenticación. Reemplaza directamente la suscripción a `client.auth` |
| `storageSource` | La fuente de almacenamiento predeterminada, que anula `client.storage` |
| `storageSources` | Fuentes de almacenamiento con nombre más allá de la predeterminada |
| `databaseAdmin` | Operaciones administrativas de la base de datos (SQL, descubrimiento de esquemas). Solo Studio lo necesita |
| `userConfigPersistence` | Preferencias locales de la interfaz de usuario: anchos de columna, grupos colapsados |
| `onAnalyticsEvent` | Se invoca para cada evento de analítica que emite el panel de administración |
| `entityLinkBuilder` | Devuelve una URL para el botón "abrir en tu aplicación" en un formulario de entidad |
| `plugins` | Instancias de plugins — consulta [Plugins](/docs/plugins) |
| `slots` | Contribuciones de slots declaradas directamente, sin un plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados por el nombre que una propiedad define en `propertyConfig` |
| `entityViews` | Pestañas globales de vistas de entidades personalizadas |
| `collectionViews` | Modos de vista de colección personalizados, disponibles para cualquier colección mediante `key` |
| `entityActions` | Acciones globales de entidad |
| `effectiveRoleController` | Simula un rol diferente mientras el modo de desarrollo está activo |
| `translations` | Anula o extiende cualquier cadena de texto de la interfaz de usuario, indexada por locale — consulta [Traducciones](/docs/frontend/i18n) |
| `components` | Reemplaza componentes integrados — consulta [Sustitución de componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Los controladores de navegación, URL y registro de colecciones **no** son props de `<Rebase>` — se construyen mediante los hooks a continuación y se consumen dentro del árbol de administración (`<RebaseShell>` los conecta por ti en el scaffold predeterminado).

Tampoco lo es el prefijo de URL. Cuando el panel de administración se monta bajo una ruta, este pertenece a `<RebaseCMS basePath="/admin">`, que es lo que resuelve las URLs a colecciones — y solo cuando el enrutador no tiene un `basename` propio. Consulta [Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

## Dos estructuras de datos

Existen dos capas de datos, y **no** son intercambiables. Pasar una donde se espera la otra es un error de tipado, por lo que vale la pena tenerlo en cuenta antes de conectar un controlador manualmente.

| | Estructura | Dónde se obtiene | Cómo luce una fila |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — filas planas | `client.data`, y `context.data` en callbacks del backend | `row.title` |
| **Admin** | `RebaseData` — view-model `Entity` | `useData()`, dentro del árbol `<Rebase>` | `entity.values.title` |

La capa del SDK es la superficie pública y simétrica: idéntica en el cliente frontend y en los callbacks del backend. La capa `Entity` es el view-model del panel de administración — añade el envoltorio `id` / `path` / `values` con el que se renderizan las vistas de colección y los formularios. `CollectionAccessor` y `FindResponse` pertenecen a ella y están marcados como `@internal` por esa razón.

`<Rebase>` es el límite entre ellas: toma tus datos planos de `client.data` y los envuelve con `wrapAsEntityData()` antes de proporcionarlos como el `RebaseData` del panel de administración. Nunca necesitas llamar a eso tú mismo — simplemente tomas la estructura que necesitas del lugar adecuado:

```tsx
// Flat rows — anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Entity view-model — inside the <Rebase> tree only.
// `data.posts` also works at runtime; `collection()` is the typed accessor.
const data = useData();
const { data: entities } = await data.collection("posts").find();
entities[0].values.title;
```

## Avanzado: diseño manual

Todo lo siguiente reemplaza a `<RebaseShell>`. Solo lo necesitas cuando el layout predeterminado te estorba: un contenedor visual diferente alrededor del panel de administración, un árbol de rutas propio, o una aplicación donde el panel de administración es una página entre muchas. Si no vas a reemplazar el layout, detente en [Vistas personalizadas](#vistas-personalizadas).

`<RebaseShell>` es azúcar sintáctico para cuatro capas, y puedes utilizarlas una a una:

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS collections={collections}/>
    <RebaseStudio/>

    {/* login screen until there is a user */}
    <RebaseAuthGate>
        {/* builds the navigation, URL and collection-registry controllers */}
        <RebaseNavigation>
            {/* the admin's routes, drawn inside the layout you pass */}
            <RebaseRouteDefs layout={<RebaseLayout title="My App"/>}/>
        </RebaseNavigation>
    </RebaseAuthGate>
</Rebase>
```

El orden es fijo: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` muestra la vista de inicio de sesión hasta que haya un usuario, por lo que nada debajo de él se renderiza para un visitante sin sesión iniciada; `RebaseNavigation` construye los controladores de navegación, URL y registro de colecciones que leen `RebaseRouteDefs` y cada vista de colección, por lo que usar `RebaseRouteDefs` fuera de él lanzará un error.

Cada capa se puede usar por sí sola. `<RebaseAuthGate>` por sí solo protege tu propia aplicación tras el inicio de sesión de Rebase. Cambia `<RebaseLayout>` por tu propio componente para mantener el enrutamiento prescindiendo del chrome; elimina también `<RebaseRouteDefs>` y estarás construyendo las rutas tú mismo a partir de los componentes en [Componentes de Scaffold](#componentes-de-scaffold).

Por debajo de ese nivel, `<Rebase>` también acepta una **render prop** en lugar de children, lo que te entrega el context y el indicador loading, dejando todo el árbol bajo tu control:

```tsx
<Rebase client={rebaseClient} authController={authController}>
    {({ context, loading }) => (
        <Scaffold>
            <AppBar/>
            <Drawer title="My App"/>
            <Outlet/>
            <SideDialogs/>
        </Scaffold>
    )}
</Rebase>
```

En ese punto nada está conectado por ti: construyes los controladores a continuación manualmente y renderizas las rutas tú mismo.

### Controladores

Los controladores son hooks de React que configuran aspectos específicos del framework. `<RebaseNavigation>` llama a todos ellos por ti — recurre a ellos solo dentro de una render prop.

#### `useBuildNavigationStateController`

El controlador principal que conecta todo:

Su `data` es el `RebaseData` con **estructura Entity**, por lo que proviene de `useData()` — no de `rebaseClient.data`, que es la capa del SDK de filas planas. `<Rebase>` convierte uno en el otro por ti (consulta [Dos estructuras de datos](#dos-estructuras-de-datos) más abajo), por lo que este hook debe llamarse dentro del árbol de `<Rebase>`.

```typescript
const data = useData();

const navigationStateController = useBuildNavigationStateController({
    collections: () => [...collections],  // Collection definitions
    views: customViews,                   // Custom navigation views
    plugins,                              // Plugin instances
    authController,
    data,
    collectionRegistryController,
    urlController,
    adminMode: adminModeController.mode
});
```

#### `useBuildCollectionRegistryController`

Gestiona cómo se resuelven las colecciones a partir de las rutas de URL:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

#### `useBuildUrlController`

Configura la generación de URLs:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

#### `useBuildModeController`

Gestiona el tema claro/oscuro:

```typescript
const modeController = useBuildModeController();
// Provides: modeController.mode ("light" | "dark"), modeController.toggleMode()
```

#### `useBuildAdminModeController`

Alterna entre los modos Studio y Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes de Scaffold

| Componente | Descripción |
|-----------|-------------|
| `<Scaffold>` | Contenedor principal de diseño con barra lateral adaptable (responsive) |
| `<AppBar>` | Barra de navegación superior con búsqueda, alternancia de modo y menú de usuario |
| `<Drawer>` | Navegación lateral con lista de colecciones y enlaces a vistas |
| `<SideDialogs>` | Contenedor para editores de entidad en panel lateral |
| `<RebaseRoutes>` | Contenedor de rutas que se integra con React Router |
| `<RebaseRoute>` | Maneja las rutas de colecciones (`/c/*`) |
| `<ContentHomePage>` | Página de inicio predeterminada que muestra tarjetas de colecciones |
| `<StudioHomePage>` | Página de inicio del modo Studio con herramientas para desarrolladores |

## Vistas personalizadas

Añade vistas de navegación de nivel superior para paneles de control (dashboards), herramientas o páginas personalizadas. Un `AppView` es un objeto plano — todo lo siguiente se sitúa en el nivel superior, no hay un bloque `admin` anidado:

```tsx
import type { AppView } from "@rebasepro/cms-types";

const views: AppView[] = [
    {
        slug: "dashboard",
        name: "Dashboard",
        icon: "LayoutDashboard",
        view: <MyDashboard/>
    },
    {
        slug: "settings",
        name: "App Settings",
        icon: "Settings",
        group: "Admin",
        // Register `settings/*` too, so the view can route inside itself.
        nestedRoutes: true,
        // Reachable by URL, but not listed in the drawer.
        hideFromNavigation: true,
        view: <AppSettings/>
    }
];
```

Pásalos a `<RebaseCMS>`, junto a tus colecciones — ese es el componente que registra la navegación:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | la ruta en la que se accede, bajo la raíz de administración |
| `name` | la etiqueta en el drawer y en la página de inicio |
| `view` | el elemento a renderizar, o un `ComponentType` para renderizarlo de forma perezosa (lazy) |
| `icon` | un nombre de icono de [Lucide](https://lucide.dev/icons/), ej. `"ShoppingCart"` — o cualquier nodo |
| `group` | agrupa vistas en el drawer; `"Admin"` y `"Settings"` se envían al final |
| `pinToBottom` | envía el grupo al final bajo cualquier nombre — preferible antes que los dos strings mágicos |
| `nestedRoutes` | también registra `slug/*`, para una vista con rutas propias |
| `hideFromNavigation` | mantiene la ruta, elimina la entrada de navegación |
| `roles` | solo los usuarios con uno de estos roles ven la vista o pueden acceder a ella |
| `description` | Markdown, mostrado en la tarjeta de la página de inicio |

Para colocar una vista bajo **Studio** en lugar del CMS, pásala a [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilos

Rebase utiliza **Tailwind CSS v4** y admite modos claro/oscuro. Personalízalo mediante:

- **Propiedades personalizadas de CSS** — Anular tokens de diseño
- **`ModeControllerProvider`** — Controlar el modo claro/oscuro
- **Configuración de Tailwind** — Personalización estándar de Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Próximos pasos

- **[Campos personalizados](/docs/frontend/custom-fields)** — Construye campos de formulario personalizados
- **[Vistas de entidad](/docs/frontend/entity-views)** — Añade pestañas a los editores de entidades
- **[Modos de vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban
- **[Traducciones](/docs/frontend/i18n)** — Cambia cualquier cadena de texto o añade un idioma
- **[Plugins](/docs/plugins)** — Extiende el framework
