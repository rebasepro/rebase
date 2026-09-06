---
sourceHash: 8e814603c912d2a1
title: Descripción general del Frontend
sidebar_label: Frontend
description: Construye y personaliza el panel de administración de Rebase con React — controladores, scaffold, enrutamiento y vistas.
---

## Resumen

El frontend de Rebase es un **framework de React** que renderiza tu panel de administración. Lee tus definiciones de colecciones y genera tablas, formularios, navegación y enrutamiento automáticamente.

En el scaffold por defecto, el panel de administración **es** el frontend: se sirve en la raíz de tu URL desplegada. Si en su lugar construyes tu propia aplicación de producto, puedes montar el admin bajo un prefijo como `/admin` en el mismo despliegue — consulta [Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

Esto es `frontend/src/App.tsx` tal como lo escribe `rebase init` — el panel de
administración entero, cuatro declaraciones dentro de un proveedor:

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

Los tres primeros no renderizan nada: *registran* configuración en el proveedor.
`<RebaseShell>` es el que dibuja — lee ese registro y construye a partir de él la
navegación, las rutas y el layout. Así que el orden en el que aparecen no
importa, y añadir una funcionalidad consiste en añadir un componente, no en
recablear un árbol.

| Componente | Paquete | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la pantalla de inicio de sesión (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | colecciones, vistas personalizadas, la página de inicio, el editor de colecciones |
| `<RebaseStudio>` | `@rebasepro/studio` | las herramientas de desarrollo (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — renderiza el admin a partir de todo lo anterior |

Quita `<RebaseStudio>` y tienes un CMS solo de contenido; quita `<RebaseCMS>` y
tienes solo las herramientas de desarrollo. Para maquetar la shell a mano,
consulta [Avanzado: layout manual](#avanzado-layout-manual).

## El proveedor Rebase

`<Rebase>` es el proveedor raíz que pone toda la funcionalidad de Rebase a disposición de los componentes hijos a través del contexto. Acepta:

Las veintidós, completas — la tabla listaba diez, y dos de esas eran props que el
componente nunca leyó:

<!-- rebase-props:start -->
| Prop | Descripción |
|------|-------------|
| `children` | Los componentes raíz del admin — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una función de render es la vía de escape para el layout manual. |
| `apiUrl` | URL base de la API del backend, disponible para cada hook mediante `useApiConfig()` |
| `dateTimeFormat` | Cómo se imprimen las fechas. Por defecto `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial del admin, y el locale con el que se formatean las fechas — consulta [Traducciones](/docs/frontend/i18n) |
| `client` | Instancia de `RebaseClient`: la fuente por defecto para datos, autenticación y almacenamiento |
| `dataSources` | Fuentes de datos adicionales, para colecciones que nombran alguna — consulta [Múltiples fuentes](/docs/backend/multiple-sources) |
| `authController` | Estado y métodos de autenticación. Reemplaza por completo la suscripción a `client.auth` |
| `storageSource` | La fuente de almacenamiento por defecto, que anula `client.storage` |
| `storageSources` | Fuentes de almacenamiento con nombre más allá de la predeterminada |
| `databaseAdmin` | Operaciones administrativas de base de datos (SQL, descubrimiento de esquema). Solo Studio las necesita |
| `userConfigPersistence` | Preferencias locales de UI — anchos de columna, grupos plegados |
| `onAnalyticsEvent` | Se llama para cada evento de analítica que emite el admin |
| `entityLinkBuilder` | Devuelve una URL para el botón «abrir en tu aplicación» de un formulario de entidad |
| `plugins` | Instancias de plugins — consulta [Plugins](/docs/plugins) |
| `slots` | Contribuciones de slots declaradas directamente, sin un plugin |
| `propertyConfigs` | Widgets de campo personalizados, indexados por el nombre que una propiedad indica en `propertyConfig` |
| `entityViews` | Pestañas globales de vistas de entidad personalizadas |
| `collectionViews` | Modos de vista de colección personalizados, disponibles para cualquier colección por `key` |
| `entityActions` | Acciones globales de entidad |
| `effectiveRoleController` | Simula un rol distinto mientras el modo de desarrollo está activo |
| `translations` | Sobrescribe o amplía cualquier cadena de la UI, indexada por locale — consulta [Traducciones](/docs/frontend/i18n) |
| `components` | Reemplaza componentes integrados — consulta [Sobrescritura de componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Los controladores de navegación, URL y registro de colecciones **no** son props
de `<Rebase>` — los construyen los hooks de abajo y se consumen dentro del árbol
del admin (`<RebaseShell>` los cablea por ti en el scaffold por defecto).

El prefijo de URL tampoco lo es. Cuando el admin se monta bajo una ruta, eso
corresponde a `<RebaseCMS basePath="/admin">`, que es lo que resuelve las URLs a
colecciones — y solo cuando el router no tiene un `basename` propio. Consulta
[Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

## Dos formas de datos

Hay dos capas de datos, y **no** son intercambiables. Pasar una donde se espera
la otra es un error de tipos, así que conviene saberlo antes de cablear un
controlador a mano.

| | Forma | Dónde la obtienes | Cómo es una fila |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — filas planas | `client.data`, y `context.data` en los callbacks del backend | `row.title` |
| **Admin** | `RebaseData` — modelo de vista `Entity` | `useData()`, dentro del árbol `<Rebase>` | `entity.values.title` |

La capa del SDK es la superficie pública y simétrica: idéntica en el cliente del
frontend y en los callbacks del backend. La capa `Entity` es el modelo de vista
del admin — añade la envoltura `id` / `path` / `values` contra la que renderizan
las vistas de colección y los formularios. `CollectionAccessor` y `FindResponse`
pertenecen a ella y están marcados como `@internal` por esa razón.

`<Rebase>` es la frontera entre ambas: toma tu `client.data` plano y lo envuelve
con `wrapAsEntityData()` antes de proporcionarlo como el `RebaseData` del admin.
Nunca llamas a eso tú mismo — simplemente tomas la forma que necesitas del sitio
correcto:

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

## Avanzado: layout manual

Todo lo que sigue reemplaza a `<RebaseShell>`. Solo lo necesitas cuando el layout
estándar estorba — otro marco alrededor del admin, un árbol de rutas propio, una
aplicación en la que el admin es una página entre muchas. Si no vas a reemplazar
el layout, detente en [Vistas personalizadas](#vistas-personalizadas).

`<RebaseShell>` es azúcar sintáctico para cuatro capas, y puedes tomarlas de una
en una:

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

El orden es fijo: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
RebaseLayout`. `RebaseAuthGate` muestra la vista de inicio de sesión hasta que
hay un usuario, así que nada por debajo de él se renderiza para un visitante sin
sesión; `RebaseNavigation` construye los controladores de navegación, URL y
registro de colecciones que leen `RebaseRouteDefs` y todas las vistas de
colección, de modo que un `RebaseRouteDefs` fuera de él lanza una excepción.

Cada capa se puede usar por su cuenta. `<RebaseAuthGate>` por sí solo pone tu
propia aplicación detrás del login de Rebase. Cambia `<RebaseLayout>` por tu
propio componente para conservar el enrutamiento y perder el marco; quita también
`<RebaseRouteDefs>` y estarás construyendo las rutas tú mismo a partir de los
componentes de [Componentes del scaffold](#componentes-del-scaffold).

Por debajo de ese suelo, `<Rebase>` también acepta una **render prop** en lugar
de hijos, que te entrega el contexto y el indicador de carga y te deja el árbol
entero a ti:

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

Llegado ese punto no hay nada cableado por ti: construyes los controladores de
abajo a mano y renderizas las rutas tú mismo.

### Controladores

Los controladores son hooks de React que configuran aspectos concretos del
framework. `<RebaseNavigation>` los llama todos por ti — recurre a estos solo
dentro de una render prop.

#### `useBuildNavigationStateController`

El controlador principal que conecta todo:

Su `data` es el `RebaseData` **con forma de Entity**, así que viene de
`useData()` — no de `rebaseClient.data`, que es la capa del SDK con filas planas.
`<Rebase>` convierte una en la otra por ti (consulta
[Dos formas de datos](#dos-formas-de-datos) más arriba), de modo que este hook
debe llamarse dentro del árbol `<Rebase>`.

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

Alterna entre los modos Studio y Contenido:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes del scaffold

| Componente | Descripción |
|-----------|-------------|
| `<Scaffold>` | Contenedor principal de layout con barra lateral responsiva |
| `<AppBar>` | Barra de navegación superior con búsqueda, selector de modo y menú de usuario |
| `<Drawer>` | Navegación lateral con lista de colecciones y enlaces a vistas |
| `<SideDialogs>` | Contenedor para los editores de entidad del panel lateral |
| `<RebaseRoutes>` | Contenedor de rutas que se integra con React Router |
| `<RebaseRoute>` | Gestiona las rutas de colección (`/c/*`) |
| `<ContentHomePage>` | Página de inicio por defecto con tarjetas de colecciones |
| `<StudioHomePage>` | Página de inicio del modo Studio con las herramientas de desarrollo |

## Vistas personalizadas

Añade vistas de navegación de primer nivel para dashboards, herramientas o
páginas personalizadas. Un `AppView` es un objeto plano — todo lo de abajo va en
el nivel superior, no hay ningún bloque `admin` anidado:

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

Pásalas a `<RebaseCMS>`, junto a tus colecciones — ese es el componente que
registra la navegación:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | la ruta en la que se alcanza, bajo la raíz del admin |
| `name` | la etiqueta en el cajón y en la página de inicio |
| `view` | el elemento a renderizar, o un `ComponentType` para renderizarlo de forma diferida |
| `icon` | un nombre de icono de [Lucide](https://lucide.dev/icons/), p. ej. `"ShoppingCart"` — o cualquier nodo |
| `group` | agrupa vistas en el cajón; `"Admin"` y `"Settings"` se hunden al fondo |
| `pinToBottom` | hunde el grupo al fondo con cualquier nombre — preferible a las dos cadenas mágicas |
| `nestedRoutes` | registra también `slug/*`, para una vista con rutas propias |
| `hideFromNavigation` | conserva la ruta, elimina la entrada de navegación |
| `roles` | solo los usuarios con alguno de estos roles ven la vista, o pueden alcanzarla |
| `description` | Markdown, mostrado en la tarjeta de la página de inicio |

Para colocar una vista bajo **Studio** en lugar del CMS, pásala a
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Styling

Rebase usa **Tailwind CSS v4** y admite modos claro/oscuro. Personaliza mediante:

- **Propiedades personalizadas de CSS** — Sobrescribe los tokens de diseño
- **`ModeControllerProvider`** — Controla el modo claro/oscuro
- **Configuración de Tailwind** — Personalización estándar de Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

## Próximos Pasos

- **[Campos personalizados](/docs/frontend/custom-fields)** — Crea campos de formulario personalizados
- **[Vistas de entidad](/docs/frontend/entity-views)** — Añade pestañas a los editores de entidades
- **[Modos de vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban
- **[Traducciones](/docs/frontend/i18n)** — Cambia cualquier cadena, o añade un idioma
- **[Plugins](/docs/plugins)** — Extiende el framework
