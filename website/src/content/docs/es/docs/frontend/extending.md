---
sourceHash: 6517ed25b1776f7e
title: Extender Rebase
sidebar_label: Extender Rebase
description: Una guía de decisión para elegir el mecanismo de extensión adecuado — plugins, slots, reemplazos de componentes, vistas de entidad, acciones y más.
---

## Visión general

Rebase ofrece cerca de una docena de mecanismos de extensión — plugins, slots, reemplazos de componentes, vistas de entidad, acciones, campos personalizados y más. Cada uno apunta a un alcance diferente (a nivel de aplicación, por colección, por entidad, por propiedad) y a una parte diferente de la interfaz de usuario.

Esta guía te ayuda a elegir el mecanismo adecuado para tu caso de uso y luego te remite a la referencia detallada de cada uno.

:::tip[Empieza por el modelo, no por la lista]
Cada mecanismo a continuación es lo mismo por dentro: un componente de React colocado en un lugar. [Personalizar el Admin](/docs/frontend/customizing) explica ese modelo en una sola página — bloques de construcción, hooks, lugares — con recetas probadas para un singleton de ajustes, ajustes por usuario, una acción masiva, una vista de calendario, un panel de control y una pantalla de inicio de sesión personalizada. Léelo primero; vuelve aquí para elegir el lugar.
:::

Todo lo que se describe aquí pertenece al **panel de administración**. Para el servidor — acotar una lectura,
añadir una ruta, embeber el driver en tu propio proceso, `rebase eject` — consulta
[Rebase no hace X](/docs/backend/extending), que es una tabla similar
para el backend.

## Tabla de decisiones

| Quiero… | Mecanismo | Alcance | Referencia |
|---|---|---|---|
| Reemplazar la barra de la aplicación | `components` (`Shell.AppBar`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio de sesión | `components` (`Auth.LoginView`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Reemplazar la página principal | `components` (`HomePage`) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Cambiar por completo el diseño del formulario de una colección | `formView` | colección | [más abajo](#formview) |
| Intercambiar un componente dentro de una colección | `admin.components` | colección | [Component Overrides](/docs/frontend/component-overrides) |
| Establecer reemplazos de componentes predeterminados para todas las colecciones | `components` (nombres con alcance de colección) | app | [Component Overrides](/docs/frontend/component-overrides) |
| Añadir un botón a la barra de herramientas de la colección | `Actions` de colección | colección | [Entity Actions](/docs/frontend/entity-actions#collection-actions) |
| Inyectar interfaz de usuario en un slot de la barra de herramientas de la colección | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Añadir una columna calculada a una tabla | `additionalFields` | colección | [Additional Columns](/docs/frontend/additional-columns) |
| Añadir un widget de campo personalizado para un tipo de propiedad | `propertyConfigs` | tipo de propiedad | [Custom Fields](/docs/frontend/custom-fields) |
| Añadir una pestaña de entidad | `entityViews` | entidad | [Entity Views](/docs/frontend/entity-views) |
| Renderizar las filas de una colección de una forma diferente | `admin.customViews` | colección | [más abajo](#modos-de-vista-personalizados) |
| Añadir una acción de fila/contexto o un botón de entidad | `entityActions` | entidad | [Entity Actions](/docs/frontend/entity-actions) |
| Poner una cifra en la tarjeta de la página principal de una colección | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Inyectar interfaz de usuario en una ubicación específica del chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir varias extensiones como una única unidad instalable | `plugins` | app | [Plugins](/docs/plugins) |
| Aplicar estilos a lo que acabo de construir | `@rebasepro/ui` + tokens de tema | cualquiera | [Styling Custom UI](/docs/frontend/styling) |

:::tip[Elijas lo que elijas, constrúyelo a partir del kit]
Cada mecanismo a continuación te proporciona un componente de React y no dice nada sobre con qué
rellenarlo. Utiliza los componentes de `@rebasepro/ui` y los tokens de color del tema en lugar
de CSS escrito a mano — una vista personalizada sigue siendo una vista de administración, y un color
fijado en el código es invisible en uno de los dos temas. Consulta
[Estilizar interfaz de usuario personalizada](/docs/frontend/styling).
:::

## Mecanismos en detalle

### Plugins

**Alcance:** app.

Un plugin agrupa colecciones inyectadas o modificadas, vistas, contribuciones de slots, wrappers de campos, providers, hooks y callbacks de ciclo de vida en una única unidad instalable. Los reemplazos de componentes, vistas de entidad, acciones de entidad y `propertyConfigs` no son campos del plugin: van en `<Rebase>` o en la colección.

→ [Referencia de Plugins](/docs/plugins)

### Slots

**Alcance:** app (aportado por slot).

Los slots son puntos de extensión de la interfaz de usuario con nombre dispersos por todo el chrome del CMS. Registras un componente de React apuntando al nombre de un slot y este se renderiza en esa ubicación. Hay 27 slots que cubren la página principal, navegación, vistas de colección, formularios, filas de entidad, campos de formulario y la barra de la aplicación — y cada uno de ellos se renderiza.

→ [Referencia de Slots](/docs/frontend/slots)

### Reemplazos de componentes (Swizzling)

**Alcance:** valores predeterminados a nivel de app o por colección.

Dos modos: **Eject** (reemplazo completo) o **Wrap** (aumentar el original).

19 nombres de componentes reemplazables divididos en dos niveles:

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

**Precedencia:** Los `components` a nivel de colección se aplican por encima de los valores predeterminados a nivel de aplicación para el mismo nombre de componente: un reemplazo de colección reemplaza ambos, y un override de colección con `wrap: true` envuelve al de nivel de aplicación. Los nombres de componentes exclusivos de la aplicación (`Shell.*`, `HomePage`, `Auth.*`) solo se pueden reemplazar a nivel de `<Rebase>`.

→ [Component Overrides](/docs/frontend/component-overrides)

### Entity Views (Vistas de entidad)

**Alcance:** entidad (añade pestañas).

Vistas personalizadas que aparecen como pestañas en la página de detalles de la entidad. Se definen por colección o se registran una vez en `<Rebase entityViews>` (o `<RebaseCMS entityViews>`) y se referencian por su `key` en el `admin.entityViews` de una colección.

→ [Entity Views](/docs/frontend/entity-views)

### Entity Actions (Acciones de entidad)

**Alcance:** entidad.

Botones de acción personalizados en entidades individuales (publicar, archivar, clonar, etc.). Se definen por colección o se registran una vez en `<Rebase entityActions>` (o `<RebaseCMS entityActions>`) y se referencian por su `key` en el `admin.entityActions` de una colección.

→ [Entity Actions](/docs/frontend/entity-actions)

### `Actions` de colección

**Alcance:** colección.

Componentes de React a nivel de barra de herramientas que reciben `CollectionActionsProps` (entidades seleccionadas, controlador de tabla, contexto de la colección). Se renderizan en la barra de herramientas de la colección junto a las acciones integradas.

**Relación con el slot `collection.actions`:** Ambos son aditivos — los componentes `Actions` se renderizan primero en la barra de herramientas, seguidos de las contribuciones del slot `collection.actions`. No se reemplazan entre sí.

→ [Entity Actions — Collection Actions](/docs/frontend/entity-actions#collection-actions)

### Modos de vista personalizados
**Alcance:** colección (añade un modo de vista).

Un mapa, un calendario, una galería, una línea de tiempo — otra representación de *las mismas filas*,
disponible en el selector de vistas de la colección junto a Lista, Tabla, Tarjetas y Tablero.

```ts
// collection config
admin: {
    customViews: [
        { key: "map", name: "Map", icon: "Map", Builder: MapView }
    ],
    enabledViews: ["table", "map"],
    defaultViewMode: "map"
}
```

O registra el componente una vez y nómbralo por su clave, lo que también hace que sea
seleccionable desde el editor de colecciones:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` recibe el `tableController` en vivo, por lo que la vista hereda los
filtros de la colección, el cuadro de búsqueda, la ordenación, la paginación, las comprobaciones de permisos
y el panel lateral de la entidad — esa es la razón principal para declarar uno en lugar
de construir un `AppView`:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Las filas son las del servidor, con la forma que devuelve `useRows`: fechas como cadenas ISO,
un belongsTo como su columna de clave foránea, y una relación que la vista cargó anidada
bajo su nombre. Una fila tiene una columna `id` solo donde su tabla la tenga; su id está
junto a ella, `tableController.ids[i]` para `tableController.rows[i]`.
`highlightedIds` son los ids de las filas que la vista muestra como seleccionadas, y
`selectionController` también opera con ids y filas:

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

Al elegir la vista se actualiza `?__view=`, persiste ante recargas y se mantiene por usuario.
Declarar una es suficiente para ofrecerla — solo es necesario configurar `enabledViews` cuando
deseas *quitar las opciones integradas*. Con una sola entrada, el selector se oculta.

**Esta no es una forma de construir una vista que abarque varias colecciones.** Un modo de vista
es otra representación de la consulta de una sola colección. Si tu componente ignora
`tableController` y obtiene cuatro tablas por su cuenta, debería ser un
[`AppView`](/docs/frontend#custom-views) — la barra de herramientas sobre él, con su cuadro de búsqueda
y su recuento de registros, estaría describiendo una consulta que no está renderizando.

### `formView`
**Alcance:** colección.

Reemplaza todo el formulario de entidad predeterminado por un componente personalizado. Se define en la configuración de una colección:

```typescript
const collection = {
    slug: "products",
    admin: {
        formView: {
            Builder: MyCustomProductForm,
            includeActions: true  // Save and Discard in the bar (default: true)
        }
    }
};

```

Úsalo cuando necesites un diseño completamente personalizado para la experiencia de edición de entidades de una colección. Para ajustes menores, es preferible usar `admin.components` con el reemplazo de `Entity.Form`.

El Builder se renderiza dentro del formulario del registro y recibe su `formContext` en vivo: escribe con `formContext.setFieldValue`, y el botón Guardar de la barra guardará el registro. Donde el registro no se pueda editar — la vista de detalle de solo lectura, o un usuario sin permiso de edición — `formContext.disabled` es `true` y las operaciones de escritura lanzarán un error. Configura `includeActions: false` si tu Builder guarda por su cuenta mediante `formContext.submit()`.

### `additionalFields`

**Alcance:** colección.

Columnas calculadas/virtuales mostradas en la tabla de la colección. No se corresponden con propiedades almacenadas — se calculan en el momento del renderizado.

→ [Additional Columns](/docs/frontend/additional-columns)

### `propertyConfigs`

**Alcance:** tipo de propiedad.

Widgets de campos personalizados para tipos de propiedades específicos, que proporcionan campos de formulario personalizados y componentes de previsualización.

→ [Custom Fields](/docs/frontend/custom-fields)

## Fuera del panel de administración

Si lo que deseas cambiar es lo que hace el servidor en lugar de lo que
muestra el panel, esta no es la página adecuada. El servidor tiene su propia escala:

| Quiero… | Peldaño | Referencia |
|---|---|---|
| Acotar qué filas devuelve una lectura | callback `beforeQuery` | [Extender el servidor](/docs/backend/extending#2-collection-callbacks) |
| Ocultar/censurar un valor en la salida | callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Añadir un endpoint propio | función personalizada | [Custom Functions](/docs/backend/custom-functions) |
| Hacer que la búsqueda encuentre subcadenas *y* normalice acentos | `search.mode: "hybrid"` | [Búsqueda](/docs/backend/search) |
| Controlar el proceso del servidor | servidor personalizado, luego `rebase eject` | [Extender el servidor](/docs/backend/extending) |

→ [Rebase no hace X](/docs/backend/extending)

## Resumen de precedencia

- **El `admin.components` de una colección se aplica sobre los `components` globales** dentro de esa colección. Un reemplazo de colección sustituye a ambos; un reemplazo de colección con `wrap: true` envuelve al reemplazo global cuando existe. Consulta [Component Overrides](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Las `Actions` de colección y el slot `collection.actions` son aditivos** — `Actions` se renderiza primero, luego las contribuciones de los slots.
- **Los `entityActions` y `entityViews` a nivel de aplicación son un registro, no valores predeterminados:** una colección muestra uno solo cuando su propio `admin.entityActions` / `admin.entityViews` menciona su `key`.
- **Los plugins se aplican en el orden del array `plugins`**, no por `key`. Las contribuciones de los slots se renderizan según su `order` (menor valor primero, 50 por defecto), y los empates mantienen ese orden. Los wrappers de campos de varios plugins se componen en ese orden, siendo el del primer plugin el más interno. Consulta [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
