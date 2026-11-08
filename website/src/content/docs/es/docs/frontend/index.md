---
sourceHash: 758100d13ca5c533
title: Visión general del frontend
sidebar_label: Frontend
description: "Construye y personaliza el panel — Rebase CMS y Rebase Studio — con React: controladores, scaffold, enrutamiento y vistas."
---

## Visión general

El frontend de Rebase es un **framework de React** que renderiza tu panel de administración. Lee las definiciones de tus colecciones y genera tablas, formularios, navegación y enrutamiento automáticamente.

En el scaffold predeterminado, el panel de administración **es** el frontend: se sirve en la raíz de tu URL desplegada. Si en su lugar construyes tu propia aplicación de producto, puedes montar el panel de administración bajo un prefijo como `/admin` en el mismo despliegue — consulta [Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

Este es el archivo `frontend/src/App.tsx` tal como lo escribe `rebase init`, sin sus importaciones de fuentes, límites de error (error boundaries) e id de cliente de Google — todo el panel de administración, cuatro declaraciones dentro de un solo proveedor:

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

Los primeros tres no renderizan nada: *registran* la configuración en el proveedor. `<RebaseShell>` es el que dibuja — lee ese registro y construye la navegación, las rutas y el diseño a partir de él. Por lo tanto, el orden en el que aparecen no importa, y agregar una funcionalidad significa agregar un componente, no reconfigurar un árbol.

| Componente | Paquete | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la pantalla de inicio de sesión (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | colecciones, vistas personalizadas, la página de inicio, el editor de colecciones |
| `<RebaseStudio>` | `@rebasepro/studio` | las herramientas para desarrolladores (SQL, RLS, registros, copias de seguridad…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — renderiza el panel de administración a partir de todo lo anterior |

Elimina `<RebaseStudio>` y tendrás un CMS solo de contenido; elimina `<RebaseCMS>` y tendrás únicamente las herramientas para desarrolladores. Para diseñar la estructura manualmente en su lugar, consulta [Avanzado: diseño manual](#avanzado-diseño-manual).

## El proveedor Rebase

`<Rebase>` es el proveedor raíz que pone a disposición de los componentes hijos toda la funcionalidad de Rebase a través de contexto. Acepta:

Las veintitrés al completo — la tabla solía listar diez, y dos de ellas eran props que el componente nunca leía:

<!-- rebase-props:start -->
| Prop | Descripción |
|------|-------------|
| `children` | Los componentes raíz del panel de administración — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una función de renderizado es la vía de escape para el diseño manual. |
| `apiUrl` | URL base de la API del backend, disponible para cada hook mediante `useApiConfig()` |
| `dateTimeFormat` | Cómo se imprimen las fechas. Por defecto es `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial del panel de administración y el locale en el que se formatean las fechas — consulta [Traducciones](/docs/frontend/i18n) |
| `client` | Instancia de `RebaseClient`: la fuente predeterminada para datos, autenticación y almacenamiento |
| `dataSources` | Fuentes de datos adicionales, para colecciones que indiquen una — consulta [Múltiples fuentes](/docs/backend/multiple-sources) |
| `authController` | Estado y métodos de autenticación. Reemplaza por completo la suscripción a `client.auth` |
| `storageSource` | La fuente de almacenamiento predeterminada, sobreescribiendo `client.storage` |
| `storageSources` | Fuentes de almacenamiento con nombre más allá de la predeterminada |
| `databaseAdmin` | Operaciones administrativas de la base de datos (SQL, detección de esquemas). Solo Studio lo necesita |
| `userConfigPersistence` | Preferencias locales de la UI — anchos de columna, grupos contraídos |
| `onAnalyticsEvent` | Se invoca para cada evento de analítica que emite el panel de administración |
| `entityLinkBuilder` | `({ row, id, path }) => string`: la URL para el botón "abrir en tu app" en un registro, a partir del registro tal como el servidor envía la fila |
| `plugins` | Instancias de plugins — consulta [Plugins](/docs/plugins) |
| `slots` | Contribuciones de slots declaradas directamente, sin un plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados por el nombre que una propiedad define en `propertyConfig` |
| `entityViews` | Pestañas de vistas de entidad personalizadas, disponibles para cualquier colección que indique su `key` en `admin.entityViews` |
| `collectionViews` | Modos de vista de colección personalizados, disponibles para cualquier colección por su `key` |
| `entityActions` | Acciones de entidad, disponibles para cualquier colección que indique su `key` en `admin.entityActions` |
| `effectiveRoleController` | Simula un rol diferente mientras el modo dev está activado |
| `modeController` | Pasa a Rebase el modo claro/oscuro de la aplicación anfitriona; Rebase entonces nunca toca `<html>`, `prefers-color-scheme` ni localStorage — consulta [Estilos](#estilos) |
| `translations` | Sobrescribe o extiende cualquier cadena de la UI, indexada por locale — consulta [Traducciones](/docs/frontend/i18n) |
| `components` | Reemplaza componentes integrados — consulta [Sobrescritura de componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Los controladores de navegación, URL y registro de colecciones **no** son props de `<Rebase>` — se construyen mediante los hooks que figuran más abajo y se consumen dentro del árbol de administración (`<RebaseShell>` los conecta por ti en el scaffold predeterminado).

Tampoco lo es el prefijo de URL. Cuando el panel de administración se monta bajo una ruta, este pertenece a `<RebaseCMS basePath="/admin">`, que es el que resuelve las URL a colecciones — y solo cuando el enrutador no tiene un `basename` propio. Consulta [Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

## Una única forma de datos

Tu código obtiene las filas tal como las envía el servidor, dondequiera que las solicite: `client.data`, `context.data` (tanto en un callback de backend como en el navegador), `useRows`, `useRow` y `useRowWrites`, el `data` de los constructores de colecciones y vistas, y lo que reciben los `browserCallbacks` de una colección. Una fila es un objeto plano: `row.title`, una fecha como su cadena ISO, un belongsTo como su columna de clave foránea.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

El panel de administración en sí renderiza un modelo de vista `Entity` — el contenedor `id` / `path` / `values` del que se nutren sus vistas de colección y formularios, con fechas como objetos `Date` y una relación como un `EntityRelation`. Esa capa es propia del panel de administración y no forma parte de la superficie pública: una acción de entidad, un solucionador de visualización (display resolver), el `tableController.rows` de un `Builder` de modo de vista, la selección de una acción de colección y un slot reciben todos filas. Solo te encuentras con `Entity` en una copia de una de las partes del propio panel (`Collection.Table`, una tarjeta), que recibe el registro tal como lo dibuja el panel. Los valores de un formulario son los del editor: `Date`s y relaciones, según los edita un campo.

## Una colección o un registro en tu propia página

No necesitas todo el panel de administración para mostrar una sola tabla. `<CollectionPanel>`, `<EntityFormPanel>`, `<EntityViewPanel>` y `<FieldValue>` funcionan en cualquier lugar bajo `<Rebase>` y un enrutador de React Router, sin `<RebaseCMS>`, `<RebaseNavigation>` ni `<RebaseShell>`: una colección con las columnas y la barra de herramientas que elijas, el formulario de un registro con solo algunos campos o tu propia estructura, un registro de solo lectura o un valor renderizado tal como lo dibuja el panel de administración. Consulta [Paneles en tu propia página](/docs/frontend/panels).

## Avanzado: diseño manual

Todo lo que se describe a continuación reemplaza a `<RebaseShell>`. Solo lo necesitas cuando el diseño predeterminado estorba — una interfaz (chrome) diferente alrededor del panel de administración, un árbol de rutas propio, una aplicación donde el panel de administración es una página entre muchas. Si no vas a reemplazar el diseño, detente en [Vistas personalizadas](#vistas-personalizadas).

`<RebaseShell>` es azúcar sintáctico para cuatro capas, y puedes utilizarlas una a la vez:

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

El orden es fijo: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`. `RebaseAuthGate` muestra la vista de inicio de sesión hasta que haya un usuario, por lo que nada debajo de él se renderiza para un visitante sin sesión iniciada; `RebaseNavigation` construye los controladores de navegación, URL y registro de colecciones que leen `RebaseRouteDefs` y cada vista de colección, por lo que `RebaseRouteDefs` fuera de él arroja un error. Para incrustar una vista de colección o un formulario de registro en tu propia página, sin las rutas del panel de administración, el más liviano `CollectionsProvider` construye esos controladores en su lugar — consulta [Paneles en tu propia página](/docs/frontend/panels).

Cada capa se puede usar por separado. `<RebaseAuthGate>` por sí solo protege tu propia aplicación detrás del inicio de sesión de Rebase. Cambia `<RebaseLayout>` por tu propio componente para conservar el enrutamiento y prescindir de la interfaz (chrome); elimina `<RebaseRouteDefs>` también y estarás construyendo las rutas tú mismo a partir de los componentes en [Componentes de Scaffold](#componentes-de-scaffold).

Por debajo de ese nivel, `<Rebase>` también acepta una **render prop** en lugar de hijos, lo que te entrega el contexto y el indicador de carga, dejándote todo el árbol a ti:

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

En ese punto nada está conectado para ti: construyes manualmente los controladores que se muestran a continuación y renderizas las rutas tú mismo.

### Controladores

Los controladores son hooks de React que configuran aspectos específicos del framework. `<RebaseNavigation>` los llama a todos por ti — recurre a ellos solo dentro de una render prop.

#### `useBuildNavigationStateController`

El controlador principal que conecta todo:

Su `data` es lo que reciben los constructores de colecciones y vistas: el `context.data` plano del `<Rebase>` contenedor (consulta [Una única forma de datos](#una-única-forma-de-datos)), por lo que este hook debe llamarse dentro del árbol de `<Rebase>`.

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

Administra cómo se resuelven las colecciones a partir de las rutas de URL:

```typescript
const collectionRegistryController = useBuildCollectionRegistryController({
    userConfigPersistence
});
```

#### `useBuildUrlController`

Configura la generación de URL:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

#### `useBuildModeController`

Administra el tema claro/oscuro. Mientras está habilitado, se adueña del tema de la página: añade la clase `dark` a `<html>`, sigue `prefers-color-scheme` hasta que el usuario elija un modo, y recuerda esa elección en localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` construye uno de estos por sí mismo.

Cuando el componente que lo usa se desmonta, elimina la clase `dark` que añadió; cualquier clase `dark` que la página ya tuviera se conserva. Construye el tuyo propio por encima de `<Rebase>` solo cuando componentes externos a él también necesiten el modo, y pásalo mediante la [prop `modeController`](#estilos), de modo que haya un único controlador y no dos. `useBuildModeController({ enabled: false })` construye un controlador inerte: mantiene `mode` en el estado de React y no toca ninguna clase, media query o localStorage. Cuando tu aplicación ya controla el tema, no necesitas este hook en absoluto: pasa tu propio controlador como `modeController`.

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
| `<AppBar>` | Barra de navegación superior con búsqueda, alternador de modo y menú de usuario |
| `<Drawer>` | Navegación lateral con lista de colecciones y enlaces de vistas |
| `<SideDialogs>` | Contenedor para editores de entidad en paneles laterales |
| `<RebaseRoutes>` | Contenedor de rutas que se integra con React Router |
| `<RebaseRoute>` | Gestiona las rutas de colección (`/c/*`) |
| `<ContentHomePage>` | Página de inicio predeterminada que muestra tarjetas de colección |
| `<StudioHomePage>` | Página de inicio del modo Studio con herramientas para desarrolladores |

## Vistas personalizadas

Añade vistas de navegación de nivel superior para paneles de control (dashboards), herramientas o páginas personalizadas. Un `AppView` es un objeto plano — todo lo siguiente se sitúa en el nivel superior, no hay ningún bloque `admin` anidado:

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

Pásalas a `<RebaseCMS>`, junto a tus colecciones — ese es el componente que registra la navegación:

```tsx
<RebaseCMS collections={collections} views={views}/>
```

| Campo | |
|---|---|
| `slug` | la ruta a través de la cual se accede, bajo la raíz del panel de administración |
| `name` | la etiqueta en el drawer lateral y en la página de inicio |
| `view` | el elemento a renderizar, o un `ComponentType` para renderizarlo de forma diferida (lazy) |
| `icon` | un nombre de icono de [Lucide](https://lucide.dev/icons/), p. ej. `"ShoppingCart"` — o cualquier nodo |
| `group` | agrupa vistas en el drawer; `"Admin"` y `"Settings"` se desplazan al final |
| `pinToBottom` | desplaza el grupo al final bajo cualquier nombre — es preferible a las dos cadenas mágicas |
| `nestedRoutes` | también registra `slug/*`, para una vista con rutas propias |
| `hideFromNavigation` | conserva la ruta, elimina la entrada de navegación |
| `roles` | solo los usuarios que posean uno de estos roles ven la vista o pueden acceder a ella |
| `description` | Markdown, mostrado en la tarjeta de la página de inicio |

Para colocar una vista bajo **Studio** en lugar del CMS, pásala a [`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

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

Por defecto, `<Rebase>` controla el tema de la página: añade la clase `dark` a `<html>`, sigue `prefers-color-scheme` hasta que el usuario elija un modo en el panel de administración, y recuerda esa elección en localStorage.

Cuando `<Rebase>` se desmonta, elimina la clase `dark` que añadió; cualquier clase que la página ya tuviera se conserva. En la versión 0.24, la clase permanece.

Cuando tu aplicación ya tiene un tema, pásalo como `modeController`. Rebase lee `mode` de él, llama a su `setMode` desde su propio alternador de tema, y nunca toca `<html>`, `prefers-color-scheme` ni localStorage:

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

El CSS del scaffold aplica los estilos del modo oscuro bajo cualquier elemento con la clase `dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Los paneles laterales, diálogos y menús se renderizan en un portal en `<body>`, por lo que debes colocar la clase en `<html>` o `<body>` en lugar de en un contenedor alrededor de `<Rebase>`.

Envolver `<Rebase>` en un `ModeControllerProvider` no logra esto: `<Rebase>` proporciona un controlador propio en su interior. En la versión 0.24 la prop no existe y no hay forma de pasarle a `<Rebase>` el modo de tu aplicación.

## Próximos pasos

- **[Campos personalizados](/docs/frontend/custom-fields)** — Construye campos de formulario personalizados
- **[Vistas de entidad](/docs/frontend/entity-views)** — Añade pestañas a los editores de entidades
- **[Modos de vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban
- **[Traducciones](/docs/frontend/i18n)** — Modifica cualquier texto o añade un idioma
- **[Plugins](/docs/plugins)** — Extiende el framework
