---
sourceHash: 15779772a2359662
title: Visión general del Frontend
sidebar_label: Frontend
description: "Construye y personaliza el panel — Rebase CMS y Rebase Studio — con React: controladores, scaffold, enrutamiento y vistas."
---

## Visión general

El frontend de Rebase es un **framework de React** que renderiza tu panel de administración.
Lee las tablas que sirve el backend y genera la navegación, tablas,
formularios y rutas a partir de ellas, sin configuración (consulta
[Tablas en el CMS](/docs/collections/)). Lo que tú añades es lo que difiere.

En el scaffold por defecto, el panel de administración **es** el frontend: se sirve en la raíz de tu URL desplegada. Si en su lugar construyes tu propia aplicación de producto, puedes montar el panel de administración bajo un prefijo como `/admin` en el mismo despliegue — consulta [Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

Este es un `frontend/src/App.tsx` sin sus importaciones de fuentes, error boundary ni el client id de
Google — todo el panel de administración, cuatro declaraciones dentro de un
único proveedor:

```tsx
import React from "react";
import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { tableCustomizations } from "./cms";

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
            {/* Every table the backend serves, plus your customizations. */}
            <RebaseCMS tableCustomizations={tableCustomizations}/>
            <RebaseStudio/>
            <RebaseShell title="My App"/>
        </Rebase>
    );
}
```

Los primeros tres no renderizan nada: *registran* configuración en el
proveedor. `<RebaseShell>` es lo que dibuja — lee ese registro y construye la
navegación, las rutas y el layout a partir de él. Por lo tanto, el orden en el que aparecen no
importa, y añadir una funcionalidad significa añadir un componente, no recablear un árbol.

| Componente | Paquete | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la pantalla de inicio de sesión (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | las tablas servidas con sus personalizaciones, colecciones externas, vistas personalizadas, la página de inicio, el editor de colecciones |
| `<RebaseStudio>` | `@rebasepro/studio` | las herramientas para desarrolladores (SQL, RLS, logs, backups…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada — renderiza el panel de administración a partir de todo lo anterior |

Elimina `<RebaseStudio>` y tendrás un CMS solo para contenido; elimina `<RebaseCMS>` y
tendrás únicamente las herramientas de desarrollador. Para maquetar el shell manualmente, consulta
[Avanzado: maquetación manual](#avanzado-maquetación-manual).

## Dónde residen los archivos del CMS

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```text
frontend/src/
├── App.tsx
└── cms/
    ├── index.ts      # export const tableCustomizations = [postsCms, …]
    ├── posts.tsx     # customizeTable("posts", { … })
    └── events.ts     # defineFirestoreCollection({ … })
```

`frontend/src/cms/` contiene lo que el panel no puede derivar: un
[`customizeTable`](/docs/frontend/customize-table/) por cada tabla que quieras
presentar de forma diferente, y las [colecciones de Firestore](/docs/frontend/firebase/)
que el navegador lee directamente. Estos archivos se ejecutan solo en el navegador, por lo que un
campo personalizado es un componente que importas por valor.

El frontend importa el **tipo** de una tabla desde `backend/schema`, nunca un valor:
`import type { posts } from "../../../backend/schema/posts"`. Una importación de tipo se
elimina del bundle, por lo que los hooks y el código del servidor del backend nunca llegan al
navegador. El backend no importa nada del frontend.

## Props de RebaseCMS

<span class="since-badge" data-since="0.31">Desde 0.31</span>

<!-- rebase-cms-props:start -->
| Prop | Descripción |
|------|-------------|
| `tableCustomizations` | Resultados de `customizeTable(...)`, uno por tabla como máximo. Dos para la misma tabla lanzan un error; uno para una tabla que no se sirve al invocador se ignora, con una advertencia en desarrollo |
| `externalCollections` | Colecciones cuyas filas residen en otra fuente de datos, como los resultados de `defineFirestoreCollection`, mostradas junto a las tablas en la misma navegación, búsqueda y selectores de referencias |
| `uiConfig` | Las preferencias de UI del espacio de trabajo tal como se escribieron en desarrollo: `import uiConfig from "./cms/ui-config.json"`. Superpuestas sobre `tableCustomizations`, por debajo de las preferencias individuales de cada usuario |
| `tables` | Para incrustación y pruebas: las tablas a renderizar en lugar de las que sirve el servidor (`compileTables([...])`). Si se proporcionan, no se solicita ninguna al servidor |
| `views` | Páginas de nivel superior en la navegación, o un constructor de las mismas — consulta [Vistas personalizadas](#vistas-personalizadas) |
| `homePage` | Reemplaza la página de inicio de contenido |
| `entityViews` | Pestañas de registro que cualquier tabla puede nombrar por `key` en sus `entityViews` |
| `collectionViews` | Modos de vista que cualquier tabla puede nombrar por `key` en sus `customViews` |
| `entityActions` | Acciones de registro que cualquier tabla puede nombrar por `key` en sus `entityActions` |
| `collectionEditor` | `true` u opciones para el editor visual de esquemas |
| `navigationGroupMappings` | Grupos con nombre y las colecciones y vistas en cada uno, en orden |
| `basePath` | El prefijo de URL bajo el cual está montado el panel de administración, cuando el router no tiene `basename` |
<!-- rebase-cms-props:end -->

Las colecciones del panel se componen en este orden, que también es el de la
navegación: cada tabla servida (con su personalización, seguida de las preferencias de UI del
espacio de trabajo y del usuario aplicadas), luego las `externalCollections`. Un slug
nombra solo una colección:

| Colisión | Qué ocurre |
|---|---|
| dos resultados de `customizeTable` para un mismo slug | lanza un error: combínalos en uno solo |
| una colección externa y una tabla servida, u otra colección externa | el panel muestra un error de carga indicando ambas; asigna a una de ellas otro slug |

La forma en que el panel espera a las tablas y lo que muestra cuando no se pueden
cargar se encuentra en [Tablas en el CMS](/docs/collections/#loading-and-errors).

## El proveedor Rebase

`<Rebase>` es el proveedor raíz que pone toda la funcionalidad de Rebase a disposición de los componentes hijos mediante contexto. Acepta:

Las veintitrés en su totalidad — la tabla solía listar diez, y dos de ellas
eran props que el componente nunca leía:

<!-- rebase-props:start -->
| Prop | Descripción |
|------|-------------|
| `children` | Los componentes raíz del panel de administración — `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una función de renderizado es la vía de escape para la maquetación manual. |
| `apiUrl` | URL base de la API del backend, disponible para cada hook mediante `useApiConfig()` |
| `dateTimeFormat` | Cómo se imprimen las fechas. Por defecto es `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial del panel de administración y configuración regional en la que se formatean las fechas — consulta [Traducciones](/docs/frontend/i18n) |
| `client` | Instancia de `RebaseClient`: la fuente por defecto para datos, autenticación y almacenamiento |
| `dataSources` | Fuentes de datos adicionales, para colecciones que indiquen una — consulta [Múltiples fuentes](/docs/backend/multiple-sources) |
| `authController` | Estado y métodos de autenticación. Reemplaza directamente la suscripción a `client.auth` |
| `storageSource` | La fuente de almacenamiento por defecto, sobrescribiendo `client.storage` |
| `storageSources` | Fuentes de almacenamiento con nombre adicionales a la predeterminada |
| `databaseAdmin` | Operaciones administrativas de base de datos (SQL, descubrimiento de esquemas). Solo Studio lo necesita |
| `userConfigPersistence` | Preferencias locales de UI — anchos de columnas, grupos colapsados |
| `onAnalyticsEvent` | Se invoca para cada evento de analítica que emite el panel de administración |
| `entityLinkBuilder` | `({ row, id, path }) => string`: la URL para el botón "abrir en tu aplicación" en un registro, a partir del registro tal como el servidor envía la fila |
| `plugins` | Instancias de plugins — consulta [Plugins](/docs/plugins) |
| `slots` | Contribuciones a slots declaradas directamente, sin un plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados por el nombre que un campo indica en `propertyConfig` |
| `entityViews` | Pestañas de vista de entidad personalizadas, disponibles para cualquier tabla que indique su `key` en sus `entityViews` |
| `collectionViews` | Modos de vista de colección personalizados, disponibles para cualquier colección por su `key` |
| `entityActions` | Acciones de entidad, disponibles para cualquier tabla que indique su `key` en sus `entityActions` |
| `effectiveRoleController` | Simula un rol diferente mientras el modo dev está activo |
| `modeController` | Pasa a Rebase el modo claro/oscuro de la aplicación anfitriona; Rebase nunca tocará `<html>`, `prefers-color-scheme` ni localStorage — consulta [Estilos](#estilos) |
| `translations` | Sobrescribe o extiende cualquier cadena de texto de la UI, indexada por locale — consulta [Traducciones](/docs/frontend/i18n) |
| `components` | Reemplaza componentes integrados — consulta [Sobrescribir componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Los controladores de navegación, URL y registro de colecciones **no** son
props de `<Rebase>` — se construyen mediante los hooks que se muestran a continuación y se consumen dentro del árbol de administración
(`<RebaseShell>` los conecta por ti en el scaffold por defecto).

Tampoco lo es el prefijo de URL. Cuando el panel de administración se monta bajo una ruta, este pertenece
a `<RebaseCMS basePath="/admin">`, que es lo que resuelve las URLs a colecciones —
y solo cuando el router no tiene un `basename` propio. Consulta
[Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

## Una única forma de datos

Tu código obtiene filas tal como las envía el servidor, desde donde sea que las solicite: `client.data`,
`context.data` (tanto en un callback del backend como en el navegador), `useRows`,
`useRow` y `useRowWrites`, el `data` de los constructores de colecciones y vistas, y lo que
reciben los `browserCallbacks` de una tabla. Una fila es un objeto plano: `row.title`,
una fecha como su cadena ISO, un belongsTo como su columna de clave foránea.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

El panel de administración en sí renderiza un modelo de vista `Entity` — el contenedor
`id` / `path` / `values` del cual se alimentan sus vistas de colección y formularios, con fechas como `Date`s y una
relación como un `EntityRelation` (las clases de valor `EntityRelation`, `EntityReference`,
`GeoPoint` y `Vector` provienen de `@rebasepro/cms-types`). Antes de cada escritura y
cada filtro, el panel de administración lo convierte a valores de transferencia (wire values) en el navegador — relaciones como
claves, vectores como listas de números, puntos como `{ latitude, longitude }`, fechas como texto
ISO — para que el servidor vea lo que enviaría cualquier otro cliente. Esa capa es interna del panel de administración y no forma parte de
la superficie pública: una acción de entidad, un resolver de visualización, el `tableController.rows` del
`Builder` de un modo de vista, la selección de una acción de colección y un slot
reciben todos filas, con el id de cada registro junto a su fila. Solo te encontrarás con `Entity` en una copia de una de las
partes del propio panel de administración (`Collection.Table`, una tarjeta), a la cual se le entrega el registro tal como lo
dibuja el panel. Los valores de un formulario son los del editor: `Date`s y relaciones, según los
edita un campo.

## Una colección o un registro en una página propia

No necesitas todo el panel de administración para mostrar una tabla. `<CollectionPanel>`,
`<RecordForm>`, `<RecordDetail>` y `<FieldValue>` funcionan en cualquier lugar bajo
`<Rebase>` y un router de React Router, sin necesidad de `<RebaseCMS>`,
`<RebaseNavigation>` o `<RebaseShell>`: una colección con las columnas y
barra de herramientas que elijas, el formulario de un registro con solo algunos campos o tu propio
layout, un registro de solo lectura, o un valor representado tal como lo dibuja el panel de administración. Consulta
[Paneles en una página propia](/docs/frontend/panels).

## Avanzado: maquetación manual

Todo lo que figura a continuación reemplaza a `<RebaseShell>`. Solo lo necesitas cuando el
layout por defecto es un obstáculo — una interfaz envolvente (chrome) diferente alrededor del panel de administración, un árbol de rutas
propio, una aplicación donde el panel de administración es una página entre muchas. Si no vas a
reemplazar el layout, puedes detenerte en [Vistas personalizadas](#vistas-personalizadas).

`<RebaseShell>` es azúcar sintáctico para cuatro capas, y puedes utilizarlas una a una:

```tsx
<Rebase client={client} authController={authController}>
    <RebaseCMS tableCustomizations={tableCustomizations}/>
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
RebaseLayout`. `RebaseAuthGate` muestra la vista de inicio de sesión hasta que haya un usuario, por lo
que nada debajo de él se renderiza para un visitante no autenticado; `RebaseNavigation` construye
los controladores de navegación, URL y registro de colecciones que `RebaseRouteDefs`
y cada vista de colección leen, por lo que un `RebaseRouteDefs` fuera de él lanzará un error.
Para incrustar una
vista de colección o un formulario de registro en una página propia, sin las
rutas del panel de administración, el más ligero `CollectionsProvider` construye esos controladores
en su lugar — consulta
[Paneles en una página propia](/docs/frontend/panels).

Cada capa se puede usar por separado. `<RebaseAuthGate>` por sí solo protege tu propia aplicación
tras el inicio de sesión de Rebase. Cambia `<RebaseLayout>` por tu propio componente para conservar el
enrutamiento y prescindir de la interfaz exterior (chrome); elimina también `<RebaseRouteDefs>` y estarás construyendo
las rutas tú mismo a partir de los componentes en
[Componentes de Scaffold](#componentes-de-scaffold).

Por debajo de ese nivel, `<Rebase>` también acepta una **render prop** en lugar de children,
la cual te entrega el contexto y el indicador de carga, dejándote el árbol completo
a tu disposición:

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

En ese punto nada está conectado por ti: construyes los siguientes controladores manualmente
y renderizas las rutas tú mismo.

### Controladores

Los controladores son hooks de React que configuran aspectos específicos del framework.
`<RebaseNavigation>` los invoca todos por ti — recurre a ellos únicamente dentro de una
render prop.

#### `useBuildNavigationStateController`

El controlador principal que conecta todo:

Su `data` es lo que reciben los constructores de colecciones y vistas: el
`context.data` plano del `<Rebase>` contenedor (consulta [Una única forma de datos](#una-única-forma-de-datos)),
por lo que este hook debe invocarse dentro del árbol de `<Rebase>`.

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

Gestiona el tema claro/oscuro. Mientras está habilitado, toma el control del tema de la página: añade
la clase `dark` a `<html>`, sigue `prefers-color-scheme` hasta que el usuario
elija un modo y recuerda esa elección en localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` construye uno de estos por sí mismo.

Cuando el
componente que lo utiliza se desmonta, elimina la clase `dark` que añadió; cualquier clase
`dark` que la página ya tuviera se conserva. Construye el tuyo propio
por encima de `<Rebase>` solo cuando componentes externos a él también necesiten el modo, y pásalo
mediante la [prop `modeController`](#estilos), de modo que haya un solo controlador
y no dos. `useBuildModeController({ enabled: false })` crea un controlador inerte:
mantiene `mode` en el estado de React y no modifica ninguna clase, media query
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
|-----------|-------------|
| `<Scaffold>` | Contenedor de diseño principal con barra lateral responsiva |
| `<AppBar>` | Barra de navegación superior con búsqueda, selector de modo y menú de usuario |
| `<Drawer>` | Navegación lateral con lista de colecciones y enlaces a vistas |
| `<SideDialogs>` | Contenedor para editores de entidades en paneles laterales |
| `<RebaseRoutes>` | Contenedor de rutas que se integra con React Router |
| `<RebaseRoute>` | Gestiona las rutas de colecciones (`/c/*`) |
| `<ContentHomePage>` | Página de inicio predeterminada que muestra tarjetas de colecciones |
| `<StudioHomePage>` | Página de inicio del modo Studio con herramientas para desarrolladores |

## Vistas personalizadas

Añade vistas de navegación de nivel superior para paneles de control (dashboards), herramientas o páginas personalizadas. Un
`AppView` es un objeto plano — todo lo siguiente se sitúa en el nivel superior, no hay ningún
bloque `admin` anidado:

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

Pásalas a `<RebaseCMS>`, junto a tus personalizaciones — ese es el
componente que registra la navegación:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} views={views}/>
```

| Campo | |
|---|---|
| `slug` | la ruta en la que se accede a ella, bajo la raíz de administración |
| `name` | la etiqueta en el drawer y en la página de inicio |
| `view` | el elemento a renderizar, o un `ComponentType` para renderizarlo de forma diferida (lazy) |
| `icon` | un nombre de icono de [Lucide](https://lucide.dev/icons/), ej. `"ShoppingCart"` — o cualquier nodo |
| `group` | agrupa vistas en el drawer; `"Admin"` y `"Settings"` se desplazan al fondo |
| `pinToBottom` | desplaza el grupo al fondo bajo cualquier nombre — se recomienda sobre las dos cadenas mágicas |
| `nestedRoutes` | también registra `slug/*`, para una vista con rutas propias |
| `hideFromNavigation` | mantiene la ruta, pero omite la entrada en la navegación |
| `roles` | solo los usuarios con uno de estos roles ven la vista o pueden acceder a ella |
| `description` | Markdown, mostrado en la tarjeta de la página de inicio |

Para colocar una vista bajo **Studio** en lugar del CMS, pásala a
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilos

Rebase utiliza **Tailwind CSS v4** y soporta modos claro y oscuro. Personalízalo mediante:

- **Propiedades personalizadas de CSS (CSS custom properties)** — Sobrescribe tokens de diseño
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

Por defecto, `<Rebase>` controla el tema de la página: añade la clase `dark` a
`<html>`, sigue `prefers-color-scheme` hasta que el usuario elija un modo en el
panel de administración y recuerda esa elección en localStorage.

Cuando `<Rebase>`
se desmonta, elimina la clase `dark` que añadió; cualquier clase que la página ya tuviera
se conserva.

Cuando tu aplicación
ya dispone de un tema, pásalo como `modeController`. Rebase lee `mode` de él,
llama a su `setMode` desde su propio selector de tema y nunca modifica `<html>`,
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
menús se renderizan en un portal sobre `<body>`, por lo que se recomienda colocar la clase en `<html>` o `<body>`
en lugar de en un contenedor alrededor de `<Rebase>`.

Envolver `<Rebase>` en un `ModeControllerProvider` no produce este efecto:
`<Rebase>` proporciona un controlador propio en su interior.

## Siguientes pasos

- **[customizeTable](/docs/frontend/customize-table)** — Cada opción de la colección de una tabla
- **[Campos personalizados](/docs/frontend/custom-fields)** — Construye campos de formulario personalizados
- **[Vistas de entidad](/docs/frontend/entity-views)** — Añade pestañas a los editores de entidades
- **[Modos de vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban
- **[Traducciones](/docs/frontend/i18n)** — Modifica cualquier texto o añade un idioma
- **[Plugins](/docs/plugins)** — Extiende el framework
