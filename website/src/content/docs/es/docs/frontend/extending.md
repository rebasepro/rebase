---
sourceHash: 3317ba94279d0cb8
title: Extender Rebase
sidebar_label: Extender Rebase
description: "Una guía de decisión para elegir el mecanismo de extensión adecuado: plugins, slots, reemplazos de componentes, vistas de entidad, acciones y más."
---

## Visión general

Rebase ofrece aproximadamente una docena de mecanismos de extensión: plugins, slots, reemplazos de componentes, vistas de entidad, acciones, campos personalizados y más. Cada uno se enfoca en un alcance diferente (a nivel de aplicación, por colección, por entidad, por propiedad) y en una parte diferente de la interfaz de usuario.

Esta guía le ayuda a elegir el mecanismo adecuado para su caso de uso y luego enlaza a la referencia detallada de cada uno.

:::tip[Comience con el modelo, no con la lista]
Cada mecanismo a continuación es lo mismo por debajo: un componente de React colocado en un lugar. [Personalización del Administrador](/docs/frontend/customizing) explica ese modelo en una sola página —bloques de construcción, hooks, lugares— con recetas probadas para un singleton de ajustes, configuraciones por usuario, una acción masiva, una vista de calendario, un dashboard y una pantalla de inicio de sesión personalizada. Léalo primero; regrese aquí para elegir el lugar.
:::

Todo lo que se describe aquí corresponde al **panel de administración**. Para el servidor —delimitar una lectura,
añadir una ruta, embeber el driver en su propio proceso, `rebase eject`— consulte
[Rebase no hace X](/docs/backend/extending), que es una tabla similar
para el backend.

## Tabla de decisión

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Quiero… | Mecanismo | Alcance | Referencia |
|---|---|---|---|
| Reemplazar la barra de la aplicación | `components` (`Shell.AppBar`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio de sesión | `components` (`Auth.LoginView`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio | `components` (`HomePage`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Cambiar por completo la apariencia del formulario de una tabla | `formView` en `customizeTable` | tabla | [más abajo](#formview) |
| Intercambiar un componente dentro de la colección de una tabla | `components` en `customizeTable` | tabla | [Reemplazos de componentes](/docs/frontend/component-overrides#collection-level-component-overrides) |
| Establecer reemplazos de componentes predeterminados para todas las colecciones | `components` (nombres con alcance de colección) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Añadir un botón a la barra de herramientas de la colección | `Actions` en `customizeTable` | tabla | [Acciones de entidad](/docs/frontend/entity-actions#collection-actions) |
| Inyectar UI en un slot de la barra de herramientas de la colección | Slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Añadir una columna calculada a una tabla | `additionalFields` en `customizeTable` | tabla | [Columnas adicionales](/docs/frontend/additional-columns) |
| Reemplazar el control de un campo | `Field` en `customizeTable` | campo | [Campos personalizados](/docs/frontend/custom-fields) |
| Registrar un tipo de campo reutilizable | `propertyConfigs` | app | [Campos personalizados](/docs/frontend/custom-fields#a-reusable-field-type) |
| Añadir una pestaña a la entidad | `entityViews` en `customizeTable` | entidad | [Vistas de entidad](/docs/frontend/entity-views) |
| Renderizar las filas de una tabla de una forma diferente | `customViews` en `customizeTable` | tabla | [más abajo](#modos-de-vista-personalizados) |
| Añadir una acción de fila/contexto o un botón de entidad | `entityActions` en `customizeTable` | entidad | [Acciones de entidad](/docs/frontend/entity-actions) |
| Colocar una cifra o widget en la tarjeta de inicio de una colección | Slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Inyectar UI en una ubicación específica del chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir varias extensiones como una sola unidad instalable | `plugins` | app | [Plugins](/docs/plugins) |
| Dar estilo a lo que acabo de construir | `@rebasepro/ui` + tokens de tema | cualquiera | [Estilizado de UI personalizada](/docs/frontend/styling) |

:::tip[Sea lo que sea que elija, constrúyalo a partir del kit]
Cada mecanismo a continuación le proporciona un componente de React y no dice nada sobre con qué
rellenarlo. Utilice los componentes de `@rebasepro/ui` y los tokens de color del tema en lugar
de CSS escrito a mano: una vista personalizada sigue siendo una vista de administración, y un color
fijado manualmente es invisible en uno de los dos temas. Consulte
[Estilizado de UI personalizada](/docs/frontend/styling).
:::

## Mecanismos en detalle

### Plugins

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**Alcance:** app.

Un plugin agrupa colecciones inyectadas o modificadas, vistas, contribuciones de slots, envoltorios de campo, proveedores, hooks y callbacks de ciclo de vida en una sola unidad instalable. Los reemplazos de componentes, las vistas de entidad, las acciones de entidad y `propertyConfigs` no son campos de plugins: se colocan en `<Rebase>` o en el `customizeTable` de una tabla.

→ [Referencia de Plugins](/docs/plugins)

### Slots

**Alcance:** app (contribución por slot).

Los slots son puntos de extensión de UI con nombre distribuidos por todo el chrome del CMS. Usted registra un componente de React apuntando al nombre de un slot y este se renderiza en esa ubicación. Hay 27 slots que cubren la página de inicio, navegación, vistas de colección, formularios, filas de entidad, campos de formulario y la barra de la aplicación — y cada uno de ellos es renderizado.

→ [Referencia de Slots](/docs/frontend/slots)

### Reemplazos de componentes (Swizzling)

**Alcance:** valores predeterminados a nivel de app o por colección.

Dos modos: **Eject** (reemplazo total) o **Wrap** (extender el original).

19 nombres de componentes reemplazables en dos niveles:

**Solo para la aplicación (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Con alcance de colección (12):**
- `Collection.View`
- `Collection.Table`
- `Collection.Card`
- `Collection.EmptyState`
- `Collection.Actions`
- `Collection.FilterField`
- `Entity.Form`
- `EditView.FormActions`
- `DetailView`
- `Entity.SidePanel`
- `EntityPreview`
- `Entity.MissingReference`

**Precedencia:** Los `components` de una tabla se aplican sobre los valores predeterminados a nivel de app para el mismo nombre de componente: un reemplazo de colección sustituye a ambos, y un reemplazo de colección con `wrap: true` envuelve al de nivel de app. Los nombres de componentes exclusivos de la app (`Shell.*`, `HomePage`, `Auth.*`) solo se pueden reemplazar a nivel de `<Rebase>`.

→ [Reemplazos de componentes](/docs/frontend/component-overrides)

### Vistas de entidad

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**Alcance:** entidad (añade pestañas).

Vistas personalizadas que aparecen como pestañas en la página de detalles de la entidad. Se definen por tabla en `customizeTable`, o se registran una sola vez en `<Rebase entityViews>` (o `<RebaseCMS entityViews>`) y se referencian por su `key` en el `entityViews` de una tabla.

→ [Vistas de entidad](/docs/frontend/entity-views)

### Acciones de entidad

<span class="since-badge" data-since="0.31">Desde 0.31</span>

**Alcance:** entidad.

Botones de acción personalizados en entidades individuales (publicar, archivar, clonar, etc.). Se definen por tabla en `customizeTable`, o se registran una sola vez en `<Rebase entityActions>` (o `<RebaseCMS entityActions>`) y se referencian por su `key` en el `entityActions` de una tabla.

→ [Acciones de entidad](/docs/frontend/entity-actions)

### `Actions` de colección

**Alcance:** colección.

Componentes de React a nivel de barra de herramientas que reciben `CollectionActionsProps` (entidades seleccionadas, controlador de tabla, contexto de la colección). Se renderizan en la barra de herramientas de la colección junto a las acciones integradas.

**Relación con el slot `collection.actions`:** Ambos son aditivos — los componentes de `Actions` se renderizan primero en la barra de herramientas, y luego las contribuciones del slot `collection.actions`. No se reemplazan entre sí.

→ [Acciones de entidad — Acciones de colección](/docs/frontend/entity-actions#collection-actions)

### Modos de vista personalizados

<span class="since-badge" data-since="0.31">Desde 0.31</span>
**Alcance:** colección (añade un modo de vista).

Un mapa, un calendario, una galería, una línea de tiempo — otra representación de *las mismas filas*,
ofrecida en el selector de vistas de la colección junto a Lista, Tabla, Tarjetas y Tablero.

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";
import { MapView } from "../../../../../components/MapView";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView },
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map",
});
```

O registre el componente una vez y nómbrelo mediante su clave, lo que también permite
seleccionarlo desde el editor de colecciones:

```tsx
<RebaseCMS
    tableCustomizations={tableCustomizations}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    customViews: ["map"],
});
```

`Builder` recibe el `tableController` activo, por lo que la vista hereda los
filtros de la colección, la caja de búsqueda, el ordenamiento, la paginación, las comprobaciones de permisos
y el panel lateral de la entidad — esa es la razón principal para declarar una en lugar de
construir una `AppView`:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Las filas provienen del servidor, con la misma estructura que devuelve `useRows`: fechas como cadenas ISO,
un belongsTo como su columna de clave foránea, y una relación que la vista cargó anidada
bajo su nombre. Una fila tiene una columna `id` solo cuando su tabla la incluye; su id está
a su lado, `tableController.ids[i]` para `tableController.rows[i]`.
`highlightedIds` son los ids de las filas que la vista muestra como seleccionadas, y
`selectionController` también maneja ids y filas:

```tsx
import type { CollectionCustomViewParams } from "@rebasepro/cms-types";
import { Card, Typography } from "@rebasepro/ui";

function CardsView({ tableController, highlightedIds, onRowClick }: CollectionCustomViewParams) {
    return <div className="grid grid-cols-3 gap-4 p-4">
        {tableController.rows.map((row, i) => {
            const id = tableController.ids[i];
            return <Card key={id}
                className={highlightedIds?.includes(id) ? "p-4 ring-2 ring-primary" : "p-4"}
                onClick={() => onRowClick?.(row)}>
                <Typography variant="subtitle2">{String(row.title ?? id)}</Typography>
            </Card>;
        })}
    </div>;
}
```

Elegir la vista actualiza `?__view=`, persiste ante una recarga y se conserva por usuario.
Declarar una es suficiente para ofrecerla — solo es necesario configurar `enabledViews` cuando
desee *quitar las vistas integradas*. Con una sola entrada, el selector se oculta.

**Esta no es una forma de construir una vista que abarque varias colecciones.** Un modo de vista
es otra representación de la consulta de una sola colección. Si su componente ignora
`tableController` y obtiene datos de cuatro tablas por su cuenta, debería ser una
[`AppView`](/docs/frontend#custom-views) — la barra de herramientas superior, con su caja
de búsqueda y su conteo de registros, estaría describiendo una consulta que no está renderizando.

### `formView`

<span class="since-badge" data-since="0.31">Desde 0.31</span>
**Alcance:** colección.

Reemplaza por completo el formulario de entidad predeterminado por un componente personalizado, configurado mediante
`formView: { Builder, includeActions }` en `customizeTable`; consulte
[Reemplazar el formulario](/docs/frontend/form-layout/#replacing-the-form).
`includeActions` (por defecto `true`) mantiene Guardar y Descartar en la barra.

Úselo cuando necesite una disposición completamente personalizada para la edición de registros de una tabla.
Para ajustes menores, prefiera utilizar el reemplazo de `Entity.Form` en `components`.

El Builder se renderiza dentro del formulario del registro y recibe su `formContext` activo: escriba con `formContext.setFieldValue`, y el botón Guardar de la barra almacenará el registro. Donde el registro no se pueda editar —la vista de detalles de solo lectura o un usuario sin permisos de edición— `formContext.disabled` será `true` y los intentos de escritura lanzarán un error. Establezca `includeActions: false` si su Builder guarda por su cuenta mediante `formContext.submit()`.

### `additionalFields`

**Alcance:** colección.

Columnas calculadas que se muestran en la tabla de la colección. No corresponden a columnas almacenadas en la base de datos: se calculan en el momento del renderizado.

→ [Columnas adicionales](/docs/frontend/additional-columns)

### `propertyConfigs`

**Alcance:** tipo de propiedad.

Tipos de campo reutilizables, registrados una sola vez en `<Rebase propertyConfigs>` y referenciados mediante la propiedad `propertyConfig` de un campo.

→ [Campos personalizados](/docs/frontend/custom-fields)

## Fuera del panel de administración

Si lo que desea cambiar es el comportamiento del servidor en lugar de lo que
muestra el panel, esta no es la página indicada. El servidor tiene su propio esquema de niveles:

| Quiero… | Nivel | Referencia |
|---|---|---|
| Delimitar qué filas devuelve una lectura | Hook `beforeQuery` | [Extender el servidor](/docs/backend/extending#2-table-hooks) |
| Ocultar o editar un valor en la respuesta | Hook `afterRead` | [Hooks de tabla](/docs/collections/callbacks) |
| Añadir un endpoint propio | Función personalizada | [Funciones personalizadas](/docs/backend/custom-functions) |
| Hacer que la búsqueda encuentre subcadenas *y* no distinga acentos | `search.mode: "hybrid"` | [Búsqueda](/docs/backend/search) |
| Tener el control del proceso del servidor | Servidor personalizado, luego `rebase eject` | [Extender el servidor](/docs/backend/extending) |

→ [Rebase no hace X](/docs/backend/extending)

## Resumen de precedencia

<span class="since-badge" data-since="0.31">Desde 0.31</span>

- **Los `components` de una tabla tienen prioridad sobre los `components` globales** dentro de su colección. Un reemplazo a nivel de colección sustituye a ambos; un reemplazo de colección con `wrap: true` envuelve al reemplazo global en caso de existir uno. Consulte [Reemplazos de componentes](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Las `Actions` de colección y el slot `collection.actions` son aditivos** — `Actions` se renderiza primero, seguido de las contribuciones de slots.
- **`entityActions` y `entityViews` a nivel de aplicación son un registro, no valores predeterminados:** una tabla muestra uno solo cuando su propio `entityActions` / `entityViews` en `customizeTable` especifica su `key`.
- **Los plugins se aplican en el orden del array `plugins`**, no por `key`. Las contribuciones de slots se renderizan según su propiedad `order` (el valor menor primero, 50 por defecto), y los empates conservan ese orden. Los envoltorios de campo (field wrappers) de varios plugins se componen en ese mismo orden, situando al del primer plugin en el nivel más interno. Consulte [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
