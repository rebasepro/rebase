---
sourceHash: f04fd00564e10891
title: Visión general del frontend
sidebar_label: Frontend
description: "Construye y personaliza el panel — Rebase CMS y Rebase Studio — con React: controladores, scaffold, enrutamiento y vistas."
---

## Descripción general

El frontend de Rebase es un **framework de React** que renderiza tu panel de administración. Lee las definiciones de tus colecciones y genera tablas, formularios, navegación y enrutamiento automáticamente.

En el scaffold predeterminado, el panel de administración **es** el frontend: se sirve en la raíz de tu URL desplegada. Si en su lugar construyes tu propia aplicación de producto, puedes montar el panel de administración bajo un prefijo como `/admin` en el mismo despliegue — consulta [Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

Este es `frontend/src/App.tsx` tal como lo genera `rebase init`, sin sus
importaciones de fuentes, error boundary ni el client id de Google — todo el panel de administración, cuatro
declaraciones dentro de un único provider:

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

Los primeros tres no renderizan nada: *registran* la configuración en el
provider. `<RebaseShell>` es lo que dibuja — lee ese registro y construye la
navegación, las rutas y el layout a partir de él. Por lo tanto, el orden en el que aparecen no
importa, y añadir una funcionalidad significa añadir un componente, no reestructurar un árbol.

| Componente | Paquete | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la pantalla de inicio de sesión (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | colecciones, vistas personalizadas, la página de inicio, el editor de colecciones |
| `<RebaseStudio>` | `@rebasepro/studio` | las herramientas para desarrolladores (SQL, RLS, logs, copias de seguridad…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — renderiza la administración a partir de todo lo anterior |

Quita `<RebaseStudio>` y tendrás un CMS solo de contenido; quita `<RebaseCMS>` y
tendrás únicamente las herramientas para desarrolladores. Para maquetar el shell manualmente, consulta
[Avanzado: maquetación manual](#avanzado-maquetación-manual).

## El Provider de Rebase

`<Rebase>` es el provider raíz que pone toda la funcionalidad de Rebase a disposición de los componentes hijos a través del contexto. Acepta:

Los veintitrés al completo — la tabla solía listar diez, y dos de ellos
eran props que el componente nunca leía:

<!-- rebase-props:start -->
| Prop | Descripción |
|------|-------------|
| `children` | Los componentes raíz de la administración — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una función de renderizado es la vía de escape para la maquetación manual. |
| `apiUrl` | URL base de la API del backend, disponible para cada hook a través de `useApiConfig()` |
| `dateTimeFormat` | Cómo se imprimen las fechas. Por defecto es `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial de la administración y la configuración regional en la que se formatean las fechas — consulta [Traducciones](/docs/frontend/i18n) |
| `client` | Instancia de `RebaseClient`: la fuente predeterminada para datos, autenticación y almacenamiento |
| `dataSources` | Fuentes de datos adicionales, para colecciones que especifiquen una — consulta [Múltiples fuentes](/docs/backend/multiple-sources) |
| `authController` | Estado y métodos de autenticación. Reemplaza por completo la suscripción a `client.auth` |
| `storageSource` | La fuente de almacenamiento predeterminada, sobrescribiendo `client.storage` |
| `storageSources` | Fuentes de almacenamiento con nombre más allá de la predeterminada |
| `databaseAdmin` | Operaciones administrativas de la base de datos (SQL, descubrimiento de esquemas). Solo Studio lo necesita |
| `userConfigPersistence` | Preferencias locales de la interfaz de usuario — anchos de columna, grupos contraídos |
| `onAnalyticsEvent` | Se invoca para cada evento de analítica que emite la administración |
| `entityLinkBuilder` | Devuelve una URL para el botón "abrir en tu app" en el formulario de una entidad |
| `plugins` | Instancias de plugins — consulta [Plugins](/docs/plugins) |
| `slots` | Contribuciones de slots declaradas directamente, sin un plugin |
| `propertyConfigs` | Widgets de campo personalizados, indexados por el nombre que una propiedad especifica en `propertyConfig` |
| `entityViews` | Pestañas personalizadas de vista de entidad, disponibles para cualquier colección que indique su `key` en `admin.entityViews` |
| `collectionViews` | Modos de vista de colección personalizados, disponibles para cualquier colección por `key` |
| `entityActions` | Acciones de entidad, disponibles para cualquier colección que indique su `key` en `admin.entityActions` |
| `effectiveRoleController` | Simular un rol diferente mientras el modo dev está activo |
| `modeController` | Pasa a Rebase el modo claro/oscuro de la aplicación anfitriona; Rebase entonces nunca tocará `<html>`, `prefers-color-scheme` ni localStorage — consulta [Estilos](#estilos) |
| `translations` | Sobrescribe o extiende cualquier cadena de la interfaz de usuario, indexada por locale — consulta [Traducciones](/docs/frontend/i18n) |
| `components` | Reemplaza componentes integrados — consulta [Sobrescritura de componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Los controladores de navegación, URL y registro de colecciones **no** son props
de `<Rebase>` — se construyen mediante los hooks que se muestran a continuación y se consumen dentro del árbol de administración
(`<RebaseShell>` los conecta por ti en el scaffold predeterminado).

Tampoco lo es el prefijo de URL. Cuando la administración se monta bajo una ruta, este pertenece
a `<RebaseCMS basePath="/admin">`, que es lo que resuelve las URLs a las colecciones —
y solo cuando el enrutador no tiene un `basename` propio. Consulta
[Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

## Dos estructuras de datos

Existen dos capas de datos y **no** son intercambiables. Pasar una
donde se espera la otra es un error de tipos, por lo que vale la pena saber esto antes de
conectar un controlador a mano.

| | Estructura | Dónde se obtiene | Qué aspecto tiene una fila |
|---|---|---|---|
| **SDK** | `RebaseSdkData` — filas planas | `client.data` y `context.data` en callbacks del backend | `row.title` |
| **Admin** | `RebaseData` — view-model de `Entity` | `useData()`, dentro del árbol de `<Rebase>` | `entity.values.title` |

La capa SDK es la superficie pública y simétrica: idéntica en el cliente frontend
y en los callbacks del backend. La capa `Entity` es el view-model de la administración — añade
el envoltorio `id` / `path` / `values` contra el cual se renderizan las vistas de colección y formularios.
`CollectionAccessor` y `FindResponse` pertenecen a ella y están marcados como
`@internal` por esa razón.

`<Rebase>` es el límite entre ambas: toma tu `client.data` plano y
lo envuelve con `wrapAsEntityData()` antes de proporcionarlo como el `RebaseData`
de la administración. Nunca llamas a eso tú mismo — simplemente tomas la estructura que necesitas
del lugar correcto:

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

## Una colección o un registro en una página propia

No necesitas todo el panel de administración para mostrar una tabla. `<CollectionPanel>`,
`<EntityFormPanel>`, `<EntityViewPanel>` y `<FieldValue>` funcionan en cualquier lugar bajo
`<Rebase>` y un router de React Router, sin necesidad de `<RebaseCMS>`,
`<RebaseNavigation>` ni `<RebaseShell>`: una colección con las columnas y
la barra de herramientas que elijas, el formulario de un registro con solo algunos campos o tu propio
layout, un registro de solo lectura, o un valor representado tal como lo dibuja la administración. Consulta
[Paneles en una página propia](/docs/frontend/panels).

## Avanzado: maquetación manual

Todo lo que figura a continuación reemplaza a `<RebaseShell>`. Solo lo necesitas cuando el
layout predeterminado se interpone — un marco diferente alrededor de la administración, un árbol de rutas
propio, una aplicación donde la administración es una página entre muchas. Si no vas a
reemplazar el layout, detente en [Vistas personalizadas](#vistas-personalizadas).

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

El orden es fijo: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs →
RebaseLayout`. `RebaseAuthGate` muestra la vista de login hasta que haya un usuario, de modo que
nada por debajo de él se renderiza para un visitante no autenticado; `RebaseNavigation` construye
los controladores de navegación, URL y registro de colecciones que leen `RebaseRouteDefs`
y cada vista de colección, por lo que `RebaseRouteDefs` fuera de él lanzará un error.
Para incrustar una
vista de colección o el formulario de un registro en una página propia, sin las
rutas de administración, el más ligero `CollectionsProvider` construye esos controladores
en su lugar — consulta
[Paneles en una página propia](/docs/frontend/panels).

Cada capa se puede usar por separado. `<RebaseAuthGate>` por sí solo protege tu propia aplicación
detrás del login de Rebase. Cambia `<RebaseLayout>` por tu propio componente para mantener el
enrutamiento y prescindir del marco; elimina también `<RebaseRouteDefs>` y estarás construyendo
las rutas tú mismo a partir de los componentes en
[Componentes de Scaffold](#componentes-de-scaffold).

Por debajo de ese nivel, `<Rebase>` también acepta una **render prop** en lugar de children,
lo que te entrega el contexto y el indicador de carga, dejando todo el árbol en
tus manos:

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

Llegados a ese punto, nada está conectado por ti: construyes los controladores siguientes
manualmente y renderizas las rutas tú mismo.

### Controladores

Los controladores son hooks de React que configuran aspectos específicos del framework.
`<RebaseNavigation>` los llama a todos por ti — recurre a estos únicamente dentro de una
render prop.

#### `useBuildNavigationStateController`

El controlador principal que conecta todo:

Su `data` es el `RebaseData` con **estructura de Entity**, por lo que proviene de `useData()`
— no de `rebaseClient.data`, que es la capa SDK de filas planas. `<Rebase>`
convierte el uno en el otro por ti (consulta [Dos estructuras de datos](#dos-estructuras-de-datos)
más abajo), por lo que este hook debe llamarse dentro del árbol de `<Rebase>` .

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

Gestiona el tema claro/oscuro. Mientras está habilitado, toma el control del tema de la página: añade
la clase `dark` a `<html>`, sigue `prefers-color-scheme` hasta que el usuario
elige un modo y recuerda esa elección en localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` construye uno de estos por sí mismo.

Cuando el
componente que lo utiliza se desmonta, elimina la clase `dark` que añadió; una clase
`dark` que la página ya tuviera se conserva. Construye el tuyo
por encima de `<Rebase>` solo cuando componentes externos también necesiten el modo, y pásalo
con la [prop `modeController`](#estilos), para que haya un solo controlador
y no dos. `useBuildModeController({ enabled: false })` construye un controlador
inerte: mantiene `mode` en el estado de React y no toca ninguna clase, media query
ni localStorage. Cuando tu aplicación ya controla el tema, no necesitas este
hook en absoluto: pasa tu propio controlador como `modeController`.

#### `useBuildAdminModeController`

Alterna entre los modos Studio y Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes de Scaffold

| Componente | Descripción |
|------------|-------------|
| `<Scaffold>` | Contenedor principal de layout con barra lateral adaptable (responsive) |
| `<AppBar>` | Barra de navegación superior con búsqueda, alternador de modo y menú de usuario |
| `<Drawer>` | Navegación lateral con lista de colecciones y enlaces a vistas |
| `<SideDialogs>` | Contenedor para editores de entidad en panel lateral |
| `<RebaseRoutes>` | Contenedor de rutas que se integra con React Router |
| `<RebaseRoute>` | Gestiona las rutas de colecciones (`/c/*`) |
| `<ContentHomePage>` | Página de inicio predeterminada que muestra tarjetas de colecciones |
| `<StudioHomePage>` | Página de inicio del modo Studio con herramientas para desarrolladores |

## Vistas personalizadas

Añade vistas de navegación de nivel superior para paneles de control (dashboards), herramientas o páginas personalizadas. Un
`AppView` es un objeto plano — todo lo que sigue se ubica en el nivel superior, no hay un bloque
`admin` anidado:

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

Pásalos a `<RebaseCMS>`, junto a tus colecciones — ese es el componente
que registra la navegación:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | la ruta en la que está accesible, bajo la raíz de la administración |
| `name` | la etiqueta en el drawer y en la página de inicio |
| `view` | el elemento a renderizar, o un `ComponentType` para renderizarlo de forma diferida (lazy) |
| `icon` | un nombre de icono de [Lucide](https://lucide.dev/icons/), p. ej. `"ShoppingCart"` — o cualquier nodo |
| `group` | agrupa vistas en el drawer; `"Admin"` y `"Settings"` se desplazan al fondo |
| `pinToBottom` | desplaza el grupo al fondo bajo cualquier nombre — preferible a las dos cadenas mágicas |
| `nestedRoutes` | también registra `slug/*`, para una vista con rutas propias |
| `hideFromNavigation` | conserva la ruta, elimina la entrada de navegación |
| `roles` | solo los usuarios que posean uno de estos roles ven la vista o pueden acceder a ella |
| `description` | Markdown, mostrado en la tarjeta de la página de inicio |

Para colocar una vista bajo **Studio** en lugar del CMS, pásala a
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilos

Rebase utiliza **Tailwind CSS v4** y admite modos claro/oscuro. Personalízalo mediante:

- **Propiedades personalizadas de CSS** — Sobrescribe tokens de diseño
- **`<Rebase modeController>`** — Pasa a Rebase el modo claro/oscuro de tu aplicación
- **Configuración de Tailwind** — Personalización estándar de Tailwind

```css
/* Override design tokens */
:root {
    --font-sans: "Instrument Sans", sans-serif;
    --font-headers: "Instrument Sans", sans-serif;
    --font-mono: "JetBrains Mono", monospace;
}
```

### Modo claro y oscuro

Por defecto, `<Rebase>` controla el tema de la página: coloca la clase `dark` en
`<html>`, sigue `prefers-color-scheme` hasta que el usuario elige un modo en la
administración y recuerda esa elección en localStorage.

Cuando `<Rebase>`
se desmonta, elimina la clase `dark` que añadió; una clase que la página ya tuviese
permanece. En 0.24 la clase se queda atrás.

Cuando tu aplicación
ya tiene un tema, pásalo como `modeController`. Rebase lee `mode` de él,
invoca su `setMode` desde su propio alternador de tema y nunca toca `<html>`,
`prefers-color-scheme` ni localStorage:

```tsx
import { useEffect, useMemo, useState } from "react";
import { Rebase, type ModeController } from "@rebasepro/app";

export function App() {
    const [mode, setMode] = useState<"light" | "dark">("light");
    const modeController = useMemo<ModeController>(() => ({
        mode,
        setMode: (next) => setMode(next === "dark" ? "dark" : "light")
    }), [mode]);

    // Your app applies the mode, as it does for the rest of the page.
    useEffect(() => {
        document.documentElement.classList.toggle("dark", mode === "dark");
    }, [mode]);

    return (
        <Rebase client={client} modeController={modeController}>
            <MyAdmin/>
        </Rebase>
    );
}
```

El CSS del scaffold aplica los estilos del modo oscuro bajo cualquier elemento con la clase `dark`
(`@custom-variant dark (&:where(.dark, .dark *))`). Los paneles laterales, diálogos y
menús se renderizan en un portal sobre `<body>`, así que coloca la clase en `<html>` o `<body>`
en lugar de en un contenedor alrededor de `<Rebase>`.

Envolver `<Rebase>` en un `ModeControllerProvider` no produce este efecto:
`<Rebase>` proporciona un controlador propio en su interior. En 0.24 la prop no
existe y no hay forma de pasar a `<Rebase>` el modo de tu aplicación.

## Próximos pasos

- **[Campos personalizados](/docs/frontend/custom-fields)** — Construye campos de formulario personalizados
- **[Vistas de entidad](/docs/frontend/entity-views)** — Añade pestañas a los editores de entidades
- **[Modos de vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban
- **[Traducciones](/docs/frontend/i18n)** — Cambia cualquier cadena de texto o añade un idioma
- **[Plugins](/docs/plugins)** — Extiende el framework
