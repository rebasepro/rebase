---
sourceHash: 3d9958fb7e16f02e
title: Visión general del Frontend
sidebar_label: Frontend
description: "Construye y personaliza el panel — Rebase CMS y Rebase Studio — con React: controladores, scaffold, enrutamiento y vistas."
---

## Visión general

El frontend de Rebase es un **framework de React** que renderiza tu panel de
administración. Lee las tablas que sirve el backend y genera la navegación,
tablas, formularios y rutas a partir de ellas, sin configuración alguna (consulta
[Tablas en el CMS](/docs/collections/)). Lo que agregas es lo que difiere.

En el scaffold predeterminado, el panel de administración **es** el frontend: se sirve en la raíz de tu URL desplegada. Si en su lugar construyes tu propia aplicación de producto, puedes montar el panel de administración bajo un prefijo como `/admin` en el mismo despliegue; consulta [Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

Este es un archivo `frontend/src/App.tsx` sin sus importaciones de fuentes, error boundary ni id de cliente de Google: todo el panel de administración, cuatro declaraciones dentro de un único proveedor:

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
proveedor. `<RebaseShell>` es lo que dibuja; lee ese registro y construye la
navegación, las rutas y el layout a partir de él. Por lo tanto, el orden en el que
aparecen no importa, y agregar una funcionalidad significa agregar un componente,
no recablear un árbol.

| Componente | Paquete | Registra |
|---|---|---|
| `<RebaseAuth>` | `@rebasepro/app` | la pantalla de inicio de sesión (`loginView`) |
| `<RebaseCMS>` | `@rebasepro/cms` | las tablas servidas con sus personalizaciones, colecciones externas, vistas personalizadas, la página de inicio |
| `<RebaseStudio>` | `@rebasepro/studio` | las herramientas para desarrolladores (SQL, RLS, logs, copias de seguridad…) |
| `<RebaseShell>` | `@rebasepro/cms` | nada: renderiza el panel de administración a partir de todo lo anterior |

Elimina `<RebaseStudio>` y tendrás un CMS solo de contenido; elimina `<RebaseCMS>` y
tendrás solo las herramientas para desarrolladores. Para diseñar la estructura (shell)
manualmente, consulta [Avanzado: diseño manual](#avanzado-diseño-manual).

## Dónde residen los archivos del CMS

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
presentar de manera diferente, y las [colecciones de Firestore](/docs/frontend/firebase/)
que el navegador lee directamente. Estos archivos se ejecutan únicamente en el
navegador, por lo que un campo personalizado es un componente que importas por valor.

El frontend importa el **tipo** de una tabla desde `backend/schema`, nunca un valor:
`import type { posts } from "../../../backend/schema/posts"`. Una importación de tipo
se elimina del bundle, por lo que los hooks y el código del servidor del backend nunca
llegan al navegador. El backend no importa nada del frontend.

## Props de RebaseCMS

<!-- rebase-cms-props:start -->
| Prop | Descripción |
|------|-------------|
| `tableCustomizations` | Resultados de `customizeTable(...)`, como máximo uno por tabla. Dos para la misma tabla lanzan un error; uno para una tabla que no se le sirve al invocador se ignora, con una advertencia en desarrollo |
| `externalCollections` | Colecciones cuyas filas residen en otra fuente de datos, como los resultados de `defineFirestoreCollection`, mostradas junto a las tablas en la misma navegación, búsqueda y selectores de referencias |
| `uiConfig` | Las preferencias de UI del espacio de trabajo tal como se definieron en desarrollo: `import uiConfig from "./cms/ui-config.json"`. Superpuestas sobre `tableCustomizations`, debajo de las preferencias de cada usuario |
| `tables` | Para incrustaciones y pruebas: las tablas a renderizar en lugar de las que sirve el servidor (`compileTables([...])`). Si se proporcionan, no se le solicita ninguna al servidor |
| `views` | Páginas de nivel superior en la navegación, o un constructor de las mismas; consulta [Vistas personalizadas](#vistas-personalizadas) |
| `homePage` | Reemplaza la página de inicio de contenido |
| `entityViews` | Pestañas de registro que cualquier tabla puede designar por `key` en su `entityViews` |
| `collectionViews` | Modos de vista que cualquier tabla puede designar por `key` en su `customViews` |
| `entityActions` | Acciones de registro que cualquier tabla puede designar por `key` en su `entityActions` |
| `collectionEditor` | Opciones para el controlador de esquema a través del cual guarda el editor RLS de Studio (`readOnly`, `getAuthToken`) |
| `navigationGroupMappings` | Grupos con nombre y las colecciones y vistas en cada uno, en orden |
| `basePath` | El prefijo de URL bajo el cual está montado el panel de administración, cuando el enrutador no tiene un `basename` |
<!-- rebase-cms-props:end -->

Las colecciones del panel se componen en este orden, que también es el de la
navegación: cada tabla servida (con su personalización aplicada, luego las
preferencias de UI del espacio de trabajo y las del usuario), luego las
`externalCollections`. Un slug nombra solo a una colección:

| Colisión | Qué sucede |
|---|---|
| dos resultados de `customizeTable` para un mismo slug | lanza un error: únelos en uno solo |
| una colección externa y una tabla servida, u otra colección externa | el panel muestra un error de carga nombrando ambas; asígnale a una otro slug |

Cómo el panel espera a las tablas, y qué muestra cuando no se pueden cargar, se
encuentra en [Tablas en el CMS](/docs/collections/#loading-and-errors).

## El proveedor Rebase

`<Rebase>` es el proveedor raíz que pone toda la funcionalidad de Rebase a disposición de los componentes secundarios a través del contexto. Acepta:

Las veintitrés en su totalidad: la tabla solía listar diez, y dos de ellas eran
props que el componente nunca leía:

<!-- rebase-props:start -->
| Prop | Descripción |
|------|-------------|
| `children` | Los componentes raíz del panel de administración: `<RebaseCMS>`, `<RebaseStudio>`, `<RebaseShell>`. Una función de renderizado es la vía de escape para el diseño manual. |
| `apiUrl` | URL base de la API del backend, disponible para cada hook mediante `useApiConfig()` |
| `dateTimeFormat` | Cómo se imprimen las fechas. Por defecto es `MMMM dd, yyyy, HH:mm:ss` |
| `locale` | Idioma inicial del panel de administración y configuración regional en la que se formatean las fechas; consulta [Traducciones](/docs/frontend/i18n) |
| `client` | Instancia de `RebaseClient`: la fuente predeterminada para datos, autenticación y almacenamiento |
| `dataSources` | Fuentes de datos adicionales, para colecciones que designan una; consulta [Múltiples fuentes](/docs/backend/multiple-sources) |
| `authController` | Estado y métodos de autenticación. Reemplaza por completo la suscripción a `client.auth` |
| `storageSource` | La fuente de almacenamiento predeterminada, anulando `client.storage` |
| `storageSources` | Fuentes de almacenamiento con nombre más allá de la predeterminada |
| `databaseAdmin` | Operaciones administrativas de la base de datos (SQL, descubrimiento de esquemas). Solo Studio lo necesita |
| `userConfigPersistence` | Preferencias locales de UI: anchos de columna, grupos colapsados |
| `onAnalyticsEvent` | Se llama para cada evento analítico que emite el panel de administración |
| `entityLinkBuilder` | `({ row, id, path }) => string`: la URL para el botón "abrir en tu aplicación" en un registro, a partir del registro tal como el servidor envía la fila |
| `plugins` | Instancias de plugins; consulta [Plugins](/docs/plugins) |
| `slots` | Contribuciones de slots declaradas directamente, sin un plugin |
| `propertyConfigs` | Widgets de campos personalizados, indexados por el nombre que un campo designa en `propertyConfig` |
| `entityViews` | Pestañas de vista de entidad personalizadas, disponibles para cualquier tabla que nombre su `key` en su `entityViews` |
| `collectionViews` | Modos de vista de colección personalizados, disponibles para cualquier colección por `key` |
| `entityActions` | Acciones de entidad, disponibles para cualquier tabla que nombre su `key` en su `entityActions` |
| `effectiveRoleController` | Simula un rol diferente mientras el modo de desarrollo está activado |
| `simulateAccess` | Muestra "Simular acceso", el control de administrador que ejecuta cada vista de datos como un rol, un usuario o una clave de servicio, en modo de solo lectura, frente a las políticas reales de seguridad a nivel de fila (RLS). Desactivado a menos que sea `true` |
| `modeController` | Pasa a Rebase el modo claro/oscuro de la aplicación anfitriona; entonces Rebase nunca modificará `<html>`, `prefers-color-scheme` ni localStorage; consulta [Estilos](#estilos) |
| `translations` | Anula o amplía cualquier cadena de texto de la UI, indexada por configuración regional; consulta [Traducciones](/docs/frontend/i18n) |
| `components` | Reemplaza componentes integrados; consulta [Reemplazo de componentes](/docs/frontend/component-overrides) |
<!-- rebase-props:end -->

Los controladores de navegación, URL y registro de colecciones **no** son props de
`<Rebase>`; se construyen mediante los hooks que se indican a continuación y se
consumen dentro del árbol del panel de administración (`<RebaseShell>` los conecta
por ti en el scaffold predeterminado).

Tampoco lo es el prefijo de URL. Cuando el panel de administración se monta bajo una
ruta, este pertenece a `<RebaseCMS basePath="/admin">`, que es lo que resuelve las URLs
en colecciones, y solo cuando el enrutador no tiene un `basename` propio. Consulta
[Cambiar la URL base](/docs/getting-started/deployment#changing-the-base-url).

## Una única forma de datos

Tu código recibe las filas tal como las envía el servidor, dondequiera que las solicite:
`client.data`, `context.data` (tanto en un callback del backend como en el navegador),
`useRows`, `useRow` y `useRowWrites`, el `data` de los constructores de colecciones y
vistas, y lo que reciben los `browserCallbacks` de una tabla. Una fila es un objeto
plano: `row.title`, una fecha como su cadena ISO, un belongsTo como su columna de clave
foránea.

```tsx
// Anywhere, including outside React.
const { data: posts } = await client.data.posts.find();
posts[0].title;

// Inside the <Rebase> tree: the same rows, kept current after every write.
const { rows } = useRows("posts");
rows[0].title;
```

El propio panel de administración renderiza un modelo de vista `Entity`: el contenedor
`id` / `path` / `values` a partir del cual se dibujan sus vistas de colección y
formularios, con fechas como `Date` y una relación como un `EntityRelation` (las clases
de valor `EntityRelation`, `EntityReference`, `GeoPoint` y `Vector` provienen de
`@rebasepro/cms-types`). Antes de cada escritura y cada filtro, el panel de administración
lo convierte a valores de transmisión (wire values) en el navegador: relaciones como
claves, vectores como listas de números, puntos como `{ latitude, longitude }`, fechas
como texto ISO, de modo que el servidor ve lo que enviaría cualquier otro cliente. Esa
capa es propia del panel de administración y no forma parte de la superficie pública:
una acción de entidad, un resolver de visualización, el `tableController.rows` del
`Builder` de un modo de vista, la selección de una acción de colección y un slot
reciben todos filas, con el id de cada registro junto a su fila. Solo te encuentras con
`Entity` en una copia de una de las partes del propio panel (`Collection.Table`, una
tarjeta), a la cual se le pasa el registro tal como lo dibuja el panel de administración.
Los valores de un formulario son los del editor: `Date`s y relaciones, según los edita
un campo.

## Una colección o un registro en una página propia

No necesitas todo el panel de administración para mostrar una sola tabla.
`<CollectionPanel>`, `<RecordForm>`, `<RecordDetail>` y `<FieldValue>` funcionan en
cualquier lugar bajo `<Rebase>` y un enrutador de React Router, sin necesidad de
`<RebaseCMS>`, `<RebaseNavigation>` ni `<RebaseShell>`: una colección con las columnas
y la barra de herramientas que elijas, el formulario de un registro con solo algunos
campos o con tu propio layout, un registro de solo lectura o un valor dibujado tal
como lo dibuja el panel de administración. Consulta
[Paneles en una página propia](/docs/frontend/panels).

## Avanzado: diseño manual

Todo lo que se muestra a continuación reemplaza a `<RebaseShell>`. Solo lo necesitas
cuando el layout predeterminado estorba: un chrome diferente alrededor del panel de
administración, un árbol de rutas propio, una aplicación donde el panel de administración
es una página entre muchas. Si no vas a reemplazar el layout, puedes detenerte en
[Vistas personalizadas](#vistas-personalizadas).

`<RebaseShell>` es azúcar sintáctico para cuatro capas, y puedes usarlas una a la vez:

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

El orden es fijo: `RebaseAuthGate → RebaseNavigation → RebaseRouteDefs → RebaseLayout`.
`RebaseAuthGate` muestra la vista de inicio de sesión hasta que haya un usuario, por lo
que nada debajo de él se renderiza para un visitante desconectado; `RebaseNavigation`
construye los controladores de navegación, URL y registro de colecciones que leen
`RebaseRouteDefs` y cada vista de colección, por lo que `RebaseRouteDefs` fuera de él
lanzará un error. Para incrustar una vista de colección o un formulario de registro en
una página propia, sin las rutas del panel de administración, el más ligero
`CollectionsProvider` construye esos controladores en su lugar; consulta
[Paneles en una página propia](/docs/frontend/panels).

Cada capa se puede usar por sí sola. `<RebaseAuthGate>` por sí solo protege tu propia
aplicación tras el inicio de sesión de Rebase. Cambia `<RebaseLayout>` por tu propio
componente para mantener el enrutamiento y prescindir del chrome; elimina también
`<RebaseRouteDefs>` y construirás las rutas tú mismo a partir de los componentes en
[Componentes de Scaffold](#componentes-de-scaffold).

Por debajo de ese nivel, `<Rebase>` también acepta una **render prop** en lugar de
children, lo que te entrega el contexto y el indicador de carga y te deja todo el
árbol a ti:

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

En ese punto, nada está conectado por ti: construyes los controladores siguientes a
mano y renderizas las rutas tú mismo.

### Controladores

Los controladores son hooks de React que configuran aspectos específicos del framework.
`<RebaseNavigation>` los llama a todos por ti; recurre a estos únicamente dentro de una
render prop.

#### `useBuildNavigationStateController`

El controlador principal que conecta todo:

Su `data` es lo que se entrega a los constructores de colecciones y vistas: el
`context.data` plano del `<Rebase>` contenedor (consulta [Una única forma de datos](#una-única-forma-de-datos)),
por lo que este hook debe llamarse dentro del árbol de `<Rebase>`.

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

Configura la generación de URLs:

```typescript
const urlController = useBuildUrlController({
    basePath: "/",
    baseCollectionPath: "/c",
    collectionRegistryController
});
```

#### `useBuildModeController`

Administra el tema claro/oscuro. Mientras está habilitado, asume el control del tema
de la página: añade la clase `dark` a `<html>`, sigue `prefers-color-scheme` hasta que
el usuario elija un modo y recuerda esa elección en localStorage.

```typescript
const modeController = useBuildModeController();

modeController.mode;             // "light" | "dark"
modeController.setMode("dark");  // "light" | "dark" | "system" — "system" follows the OS again
```

`<Rebase>` construye uno de estos por sí mismo.

Cuando el componente que lo usa se desmonta, elimina la clase `dark` que agregó; la
clase `dark` que la página ya tenía permanece. Construye el tuyo propio por encima de
`<Rebase>` solo cuando componentes externos también necesiten el modo, y pásalo mediante
la [prop `modeController`](#estilos), para que haya un solo controlador y no dos.
`useBuildModeController({ enabled: false })` construye un controlador inerte: mantiene
`mode` en el estado de React y no modifica ninguna clase, media query ni localStorage.
Cuando tu aplicación ya controla el tema, no necesitas este hook en absoluto: pasa tu
propio controlador como `modeController`.

#### `useBuildAdminModeController`

Alterna entre los modos Studio y Contenido:

```typescript
const adminModeController = useBuildAdminModeController();
// Provides: adminModeController.mode ("cms" | "studio")
```

### Componentes de Scaffold

| Componente | Descripción |
|-----------|-------------|
| `<Scaffold>` | Contenedor de layout principal con barra lateral responsiva |
| `<AppBar>` | Barra de navegación superior con búsqueda, alternador de modo y menú de usuario |
| `<Drawer>` | Navegación lateral con lista de colecciones y enlaces de vistas |
| `<SideDialogs>` | Contenedor para editores de entidades en paneles laterales |
| `<RebaseRoutes>` | Contenedor de rutas que se integra con React Router |
| `<RebaseRoute>` | Gestiona las rutas de colecciones (`/c/*`) |
| `<ContentHomePage>` | Página de inicio predeterminada que muestra tarjetas de colecciones |
| `<StudioHomePage>` | Página de inicio del modo Studio con herramientas para desarrolladores |

## Vistas personalizadas

Agrega vistas de navegación de nivel superior para paneles de control (dashboards),
herramientas o páginas personalizadas. Un `AppView` es un objeto plano: todo lo que se
muestra a continuación se ubica en el nivel superior, no hay ningún bloque `admin`
anidado:

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

Pásalas a `<RebaseCMS>`, junto a tus personalizaciones; ese es el componente que
registra la navegación:

```tsx
<RebaseCMS tableCustomizations={tableCustomizations} views={views}/>
```

| Campo | |
|---|---|
| `slug` | la ruta en la que se accede a él, bajo la raíz del panel de administración |
| `name` | la etiqueta en el drawer y en la página de inicio |
| `view` | el elemento a renderizar, o un `ComponentType` para renderizarlo de forma perezosa (lazy) |
| `icon` | un nombre de icono de [Lucide](https://lucide.dev/icons/), p. ej. `"ShoppingCart"`, o cualquier nodo |
| `group` | agrupa vistas en el drawer; `"Admin"` y `"Settings"` descienden al fondo |
| `pinToBottom` | fija el grupo al fondo bajo cualquier nombre; es preferible a las dos cadenas mágicas |
| `nestedRoutes` | también registra `slug/*`, para una vista con rutas propias |
| `hideFromNavigation` | mantiene la ruta, omite la entrada en la navegación |
| `roles` | solo los usuarios que posean uno de estos roles verán la vista o podrán acceder a ella |
| `description` | Markdown, mostrado en la tarjeta de la página de inicio |

Para colocar una vista bajo **Studio** en lugar del CMS, pásala a
[`<RebaseStudio devViews>`](/docs/studio#adding-your-own-tool).

## Estilos

Rebase utiliza **Tailwind CSS v4** y admite modos claro y oscuro. Personalízalo mediante:

- **Propiedades personalizadas de CSS** — Invalida los tokens de diseño
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
`<html>`, sigue `prefers-color-scheme` hasta que el usuario elige un modo en el
panel de administración y recuerda esa elección en localStorage.

Cuando `<Rebase>` se desmonta, elimina la clase `dark` que agregó; la clase que
la página ya tenía permanece.

Cuando tu aplicación ya tenga un tema, pásalo como `modeController`. Rebase lee
`mode` de él, llama a su `setMode` desde su propio alternador de tema y nunca
modifica `<html>`, `prefers-color-scheme` ni localStorage:

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

El CSS del scaffold aplica estilos de modo oscuro bajo cualquier elemento con la clase
`dark` (`@custom-variant dark (&:where(.dark, .dark *))`). Los paneles laterales,
diálogos y menús se renderizan en un portal sobre `<body>`, por lo que debes colocar la
clase en `<html>` o `<body>` en lugar de en un contenedor alrededor de `<Rebase>`.

Envolver `<Rebase>` en un `ModeControllerProvider` no hace esto:
`<Rebase>` proporciona un controlador propio en su interior.

## Siguientes pasos

- **[customizeTable](/docs/frontend/customize-table)** — Todas las opciones de la colección de una tabla
- **[Campos personalizados](/docs/frontend/custom-fields)** — Construye campos de formulario personalizados
- **[Vistas de entidad](/docs/frontend/entity-views)** — Agrega pestañas a los editores de entidades
- **[Modos de vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban
- **[Traducciones](/docs/frontend/i18n)** — Cambia cualquier cadena de texto o agrega un idioma
- **[Plugins](/docs/plugins)** — Extiende el framework
