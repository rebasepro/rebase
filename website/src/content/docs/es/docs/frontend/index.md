---
sourceHash: 648bcb814d96b084
title: Visión general del Frontend
sidebar_label: Frontend
description: "Construye y personaliza el panel — Rebase CMS y Rebase Studio — con React: controladores, scaffold, enrutamiento y vistas."
---

## Visión general

El frontend de Rebase es un **framework de React** que renderiza tu panel de administración. Lee las definiciones de tus colecciones y genera tablas, formularios, navegación y enrutamiento automáticamente.

En el scaffold por defecto, el panel de administración **es** el frontend: se sirve en la raíz de tu URL desplegada. Si en su lugar construyes tu propia aplicación de producto, puedes montar el panel de administración bajo un prefijo como `/admin` en el mismo despliegue — consulta [Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

Este es `frontend/src/App.tsx` tal como lo genera `rebase init`, sin sus importaciones de fuentes, error boundary ni el client id de Google — todo el panel de administración, cuatro declaraciones dentro de un único provider:

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

Los primeros tres no renderizan nada: *registran* configuración en el provider. `<RebaseShell>` es lo que dibuja — lee ese registro y construye la navegación, las rutas y el layout a partir de él. Por lo tanto, el orden en el que aparecen no importa, y añadir una funcionalidad significa añadir un componente, no recablear un árbol.

| Componente | Paquete | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la pantalla de inicio de sesión (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | colecciones, vistas personalizadas, la página de inicio, el editor de colecciones |
| `<RebaseStudio>` | `@rebasepro/studio` | las herramientas de desarrollo (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — renderiza la administración a partir de todo lo anterior |

Elimina `<RebaseStudio>` y tendrás un CMS solo de contenido; elimina `<RebaseCMS>` y tendrás únicamente las herramientas de desarrollo. Para maquetar el shell manualmente, consulta [Avanzado: maquetación manual](#avanzado-maquetación-manual).

## El Provider de Rebase

`<Rebase>` es el provider raíz que pone a disposición de los componentes hijos toda la funcionalidad de Rebase a través de context. Acepta:

Los veintitrés en su totalidad — la tabla solía listar diez, y dos de ellos eran props que el componente nunca leía:

<!-- rebase-props:start -->
| Prop | Descripción |
|------|-------------|
| `children` | Los componentes raíz del panel de administración — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una función de renderizado es la vía de escape para la maquetación manual. |
| `apiUrl` | URL base de la API del backend, disponible para cada hook a través de `useApiConfig()` |
| `dateTimeFormat` | Cómo se imprimen las fechas. Por defecto es `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial del panel de administración y el locale en el que se formatean las fechas — consulta [Traducciones](/docs/frontend/i18n) |
| `client` | Instancia de `RebaseClient`: la fuente predeterminada para datos, autenticación y almacenamiento |
| `dataSources` | Fuentes de datos adicionales, para colecciones que indiquen una — consulta [Múltiples fuentes](/docs/backend/multiple-sources) |
| `authController` | Estado y métodos de autenticación. Reemplaza por completo la suscripción a `client.auth` |
| `storageSource` | La fuente de almacenamiento predeterminada, sobreescribiendo `client.storage` |
| `storageSources` | Fuentes de almacenamiento con nombre más allá de la predeterminada |
| `databaseAdmin` | Operaciones administrativas de base de datos (SQL, descubrimiento de esquemas). Solo Studio lo necesita |
| `userConfigPersistence` | Preferencias locales de UI — anchos de columnas, grupos colapsados |
| `onAnalyticsEvent` | Se invoca para cada evento de analítica que emite la administración |
| `entityLinkBuilder` | `({ row, id, path }) => string`: la URL para el botón "abrir en tu app" en un registro, a partir del registro tal como el servidor envía la fila |
| `plugins` | Instancias de plugins — consulta [Plugins](/docs/plugins) |
| `slots` | Contribuciones de slots declaradas directamente, sin un plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados por el nombre que una propiedad especifica en `propertyConfig` |
| `entityViews` | Pestañas de vista de entidad personalizadas, disponibles para cualquier colección que indique su `key` en `admin.entityViews` |
| `collectionViews` | Modos de vista de colección personalizados, disponibles para cualquier colección por `key` |
| `entityActions` | Acciones de entidad, disponibles para cualquier colección que indique su `key` en `admin.entityActions` |
| `effectiveRoleController` | Simula un rol diferente mientras el modo de desarrollo está activado |
| `modeController` | Pasa a Rebase el modo claro/oscuro de la aplicación anfitriona; Rebase entonces nunca toca `<html>`, `prefers-color-scheme` o localStorage — consulta [Estilos](#estilos) |
| `translations` | Sobrescribe o extiende cualquier cadena de texto de la UI, indexada por locale — consulta [Traducciones](/docs/frontend/i18n) |
| `components` | Reemplaza componentes integrados — consulta [Sobrescrituras de componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Los controladores de navegación, URL y registro de colecciones **no** son props de `<Rebase>` — se construyen mediante los hooks que se muestran a continuación y se consumen dentro del árbol de administración (`<RebaseShell>` los conecta por ti en el scaffold por defecto).

Tampoco lo es el prefijo de URL. Cuando el panel de administración se monta bajo una ruta, este pertenece a `<RebaseCMS basePath="/admin">`, que es lo que resuelve las URL hacia las colecciones — y solo cuando el router no tiene un `basename` propio. Consulta [Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

## Una única estructura de datos

<span class="since-badge" data-since="0.29">Desde 0.29</span>
Tu código recibe las filas tal como las envía el servidor, dondequiera que las solicite: `client.data`, `context.data` (tanto en un callback de backend como en el navegador), `useRows`, `useRow` y `useRowWrites`, el `data` de los constructores de colecciones y vistas, y lo que reciben los `browserCallbacks` de una colección. Una fila es un objeto plano: `row.title`, una fecha como su cadena ISO, un belongsTo como su columna de clave foránea.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

El panel de administración en sí renderiza un modelo de vista `Entity` — el contenedor `id` / `path` / `values` del que se nutren sus vistas de colección y formularios, con fechas como objetos `Date` y una relación como un `EntityRelation`. Esa capa es propia de la administración y no forma parte de la superficie pública: una acción de entidad, un display resolver, los `tableController.rows` de un `Builder` de modo de vista, la selección de una acción de colección y un slot reciben todos filas, con el id de cada registro junto a su fila. Solo te encontrarás con `Entity` en una copia de una de las partes propias de la administración (`Collection.Table`, una tarjeta), a la cual se le entrega el registro tal como lo dibuja la administración. Los valores de un formulario son los del editor: objetos `Date` y relaciones, tal como los edita un campo.

## Una colección o un registro en tu propia página

No necesitas toda la administración para mostrar una sola tabla. `<CollectionPanel>`, `<EntityFormPanel>`, `<RecordDetail>` y `<FieldValue>` funcionan en cualquier lugar bajo `<Rebase>` y un router de React Router, sin `<RebaseCMS>`, `<RebaseNavigation>` ni `<RebaseShell>`: una colección con las columnas y la barra de herramientas que elijas, el formulario de un registro con solo algunos campos o tu propia maquetación, un registro de solo lectura o un valor renderizado tal como lo dibuja la administración. Consulta [Paneles en tu propia página](/docs/frontend/panels).

## Avanzado: maquetación manual

Todo lo que sigue a continuación reemplaza a `<RebaseShell>`. Solo lo necesitas cuando el layout por defecto te estorba — un marco (chrome) diferente alrededor de la administración, un árbol de rutas propio, o una app donde la administración es solo una página entre muchas. Si no vas a reemplazar el layout, puedes detenerte en [Vistas personalizadas](#vistas-personalizadas).

`<RebaseShell>` es azúcar sintáctico para cuatro capas, y puedes utilizarlas una por una:

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

El orden es fijo: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` muestra la vista de inicio de sesión hasta que haya un usuario, por lo que nada debajo de él se renderiza para un visitante no autenticado; `RebaseNavigation` construye los controladores de navegación, URL y registro de colecciones que leen `RebaseRouteDefs` y cada vista de colección, por lo que usar `RebaseRouteDefs` fuera de él lanza un error. Para incrustar una vista de colección o un formulario de registro en una página propia, sin las rutas de la administración, el más ligero `CollectionsProvider` construye esos controladores en su lugar — consulta [Paneles en tu propia página](/docs/frontend/panels).

Cada capa se puede usar por sí sola. `<RebaseAuthGate>` por sí solo protege tu propia aplicación detrás del inicio de sesión de Rebase. Cambia `<RebaseLayout>` por tu propio componente para conservar el enrutamiento y prescindir del marco; elimina también `<RebaseRouteDefs>` y construirás las rutas tú mismo a partir de los componentes en [Componentes de Scaffold](#componentes-de-scaffold).

Más allá de eso, `<Rebase>` también acepta una **render prop** en lugar de children, la cual te proporciona el contexto y el indicador de carga (loading flag), dejando todo el árbol en tus manos:

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

En ese punto nada está conectado para ti: construyes manualmente los controladores que se describen a continuación y renderizas las rutas tú mismo.

### Controladores

Los controladores son hooks de React que configuran aspectos específicos del framework. `<RebaseNavigation>` los llama a todos por ti — recurre a estos únicamente dentro de una render prop.

#### `useBuildNavigationStateController`

El controlador principal que conecta todo:

Su `data` es lo que reciben los constructores de colecciones y vistas: el `context.data` plano del `<Rebase>` contenedor (consulta [Una única estructura de datos](#una-única-estructura-de-datos)), por lo que este hook debe llamarse dentro del árbol de `<Rebase>`.

```typescript
const { data } = useRebaseContext();

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

Gestiona el tema claro/oscuro. Mientras está habilitado, toma el control del tema de la página: añade la clase `dark` a `<html>`, sigue `prefers-color-scheme` hasta que el usuario elija un modo y recuerda esa elección en localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` construye uno de estos por sí mismo.

Cuando el componente que lo usa se desmonta, elimina la clase `dark` que añadió; una clase `dark` que la página ya tuviese se mantiene. Construye el tuyo por encima de `<Rebase>` únicamente cuando los componentes fuera de él también necesiten el modo, y pásalo con la [prop `modeController`](#estilos), para que haya un solo controlador y no dos. `useBuildModeController({ enabled: false })` construye un controlador inerte: mantiene `mode` en el estado de React y no toca ninguna clase, media query ni localStorage. Cuando tu aplicación ya controla el tema, no necesitas este hook en absoluto: pasa tu propio controlador como `modeController`.

#### `useBuildAdminModeController`

Alterna entre los modos Studio y Content:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes de Scaffold

| Componente | Descripción |
|-----------|-------------|
| `<Scaffold>` | Contenedor de layout principal con barra lateral responsiva |
| `<AppBar>` | Barra de navegación superior con búsqueda, alternador de modo y menú de usuario |
| `<Drawer>` | Navegación lateral con lista de colecciones y enlaces a vistas |
| `<SideDialogs>` | Contenedor para editores de entidades en paneles laterales |
| `<RebaseRoutes>` | Contenedor de rutas que se integra con React Router |
| `<RebaseRoute>` | Maneja las rutas de colección (`/c/*`) |
| `<ContentHomePage>` | Página de inicio por defecto que muestra las tarjetas de colecciones |
| `<StudioHomePage>` | Página de inicio del modo Studio con herramientas de desarrollo |

## Vistas personalizadas

Añade vistas de navegación de nivel superior para paneles (dashboards), herramientas o páginas personalizadas. Un `AppView` es un objeto plano — todo lo que sigue se ubica en el nivel superior, no hay un bloque `admin` anidado:

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
| `slug` | la ruta en la que se accede, bajo la raíz de la administración |
| `name` | la etiqueta en el drawer y en la página de inicio |
| `view` | el elemento a renderizar, o un `ComponentType` para renderizarlo de forma diferida (lazy) |
| `icon` | un nombre de icono de [Lucide](https://lucide.dev/icons/), p. ej. `"ShoppingCart"` — o cualquier nodo |
| `group` | agrupa vistas en el drawer; `"Admin"` y `"Settings"` se sitúan al final |
| `pinToBottom` | sitúa el grupo al final bajo cualquier nombre — es preferible a los dos valores mágicos |
| `nestedRoutes` | también registra `slug/*`, para una vista con rutas propias |
| `hideFromNavigation` | conserva la ruta, elimina la entrada de navegación |
| `roles` | solo los usuarios que posean uno de estos roles ven la vista o pueden acceder a ella |
| `description` | Markdown, mostrado en la tarjeta de la página de inicio |

Para colocar una vista bajo **Studio** en lugar del CMS, pásala a [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilos

Rebase utiliza **Tailwind CSS v4** y soporta modos claro/oscuro. Personalízalo mediante:

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

Por defecto, `<Rebase>` controla el tema de la página: añade la clase `dark` a `<html>`, sigue `prefers-color-scheme` hasta que el usuario elija un modo en la administración y recuerda esa elección en localStorage.

Cuando `<Rebase>` se desmonta, elimina la clase `dark` que añadió; cualquier clase que la página ya tuviera se mantiene. En la versión 0.24, la clase permanece.

Cuando tu aplicación ya tiene un tema, pásalo como `modeController`. Rebase lee `mode` de él, llama a su `setMode` desde su propio alternador de tema y nunca toca `<html>`, `prefers-color-scheme` ni localStorage:

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

El CSS del scaffold aplica estilos de modo oscuro a cualquier elemento con la clase `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Los paneles laterales, diálogos y menús se renderizan en un portal sobre `<body>`, por lo que se recomienda colocar la clase en `<html>` o `<body>` en lugar de en un contenedor alrededor de `<Rebase>`.

Envolver `<Rebase>` en un `ModeControllerProvider` no logra esto: `<Rebase>` proporciona un controlador propio dentro de él. En la versión 0.24 la prop no existe y no hay forma de pasarle a `<Rebase>` el modo de tu aplicación.

## Próximos pasos

- **[Campos personalizados](/docs/frontend/custom-fields)** — Construye campos de formulario personalizados
- **[Vistas de entidad](/docs/frontend/entity-views)** — Añade pestañas a los editores de entidades
- **[Modos de vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban
- **[Traducciones](/docs/frontend/i18n)** — Modifica cualquier texto o añade un idioma
- **[Plugins](/docs/plugins)** — Extiende el framework
