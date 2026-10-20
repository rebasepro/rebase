---
sourceHash: a874bc209f13c746
title: Extender Rebase
sidebar_label: Extender Rebase
description: Una guía de decisión para elegir el mecanismo de extensión adecuado — plugins, slots, reemplazos de componentes, vistas de entidad, acciones y más.
---

## Resumen

Rebase ofrece cerca de una docena de mecanismos de extensión — plugins, slots, reemplazos de componentes, vistas de entidad, acciones, campos personalizados y más. Cada uno apunta a un alcance diferente (a nivel de aplicación, por colección, por entidad, por propiedad) y a una parte diferente de la interfaz de usuario.

Esta guía te ayuda a elegir el mecanismo adecuado para tu caso de uso y luego enlaza a la referencia detallada de cada uno.

:::tip[Comienza con el modelo, no con la lista]
Cada mecanismo a continuación es lo mismo por debajo: un componente de React colocado en un lugar. [Personalizar el Admin](/docs/frontend/customizing) explica ese modelo en una sola página — bloques de construcción, hooks, lugares — con recetas probadas para un singleton de ajustes, configuraciones por usuario, una acción por lotes (bulk action), una vista de calendario, un dashboard y una pantalla de inicio de sesión personalizada. Léelo primero; vuelve aquí para elegir el lugar.
:::

Todo lo que se describe aquí corresponde al **panel de administración**. Para el servidor — restringir una lectura,
añadir una ruta, embeber el driver en tu propio proceso, `rebase eject` — consulta
[Rebase no hace X](/docs/backend/extending), que es una tabla similar
para el backend.

## Tabla de Decisión

| Quiero… | Mecanismo | Alcance | Referencia |
|---|---|---|---|
| Reemplazar la barra de la aplicación | `components` (`Shell.AppBar`) | app | [Reemplazos de Componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio de sesión | `components` (`Auth.LoginView`) | app | [Reemplazos de Componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio | `components` (`HomePage`) | app | [Reemplazos de Componentes](/docs/frontend/component-overrides) |
| Cambiar por completo la apariencia del formulario de una colección | `formView` | collection | [más abajo](#formview) |
| Cambiar un componente dentro de una colección | `collection.components` | collection | [Reemplazos de Componentes](/docs/frontend/component-overrides) |
| Establecer reemplazos de componentes predeterminados para todas las colecciones | `components` (nombres con alcance de colección) | app | [Reemplazos de Componentes](/docs/frontend/component-overrides) |
| Añadir un botón a la barra de herramientas de la colección | `Actions` de colección | collection | [Acciones de Entidad](/docs/frontend/entity-actions#collection-actions) |
| Inyectar UI en un slot de la barra de herramientas de la colección | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Añadir una columna calculada a una tabla | `additionalFields` | collection | [Columnas Adicionales](/docs/frontend/additional-columns) |
| Añadir un widget de campo personalizado para un tipo de propiedad | `propertyConfigs` | property type | [Campos Personalizados](/docs/frontend/custom-fields) |
| Añadir una pestaña a la entidad | `entityViews` | entity | [Vistas de Entidad](/docs/frontend/entity-views) |
| Renderizar las filas de una colección de una forma diferente | `admin.customViews` | collection | [más abajo](#modos-de-vista-personalizados) |
| Añadir una acción de fila/contexto o un botón de entidad | `entityActions` | entity | [Acciones de Entidad](/docs/frontend/entity-actions) |
| Colocar una cifra/gráfico en la tarjeta de inicio de una colección | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Inyectar UI en una ubicación específica del chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir varias extensiones como una sola unidad instalable | `plugins` | app | [Plugins](/docs/plugins) |
| Dar estilo a lo que acabo de construir | `@rebasepro/ui` + tokens de tema | cualquiera | [Estilizar UI Personalizada](/docs/frontend/styling) |

:::tip[Elijas lo que elijas, constrúyelo a partir del kit]
Cada mecanismo a continuación te entrega un componente de React y no dice nada sobre con qué
rellenarlo. Utiliza los componentes de `@rebasepro/ui` y los tokens de color del tema en lugar
de CSS escrito a mano — una vista personalizada sigue siendo una vista del admin, y un color
definido a fuego (hardcoded) es invisible en uno de los dos temas. Consulta
[Estilizar UI Personalizada](/docs/frontend/styling).
:::

## Mecanismos en Detalle

### Plugins

**Alcance:** app.

Un plugin agrupa colecciones, vistas, reemplazos de componentes, contribuciones a slots, autenticación, fuentes de datos, proveedores, hooks y callbacks del ciclo de vida en una sola unidad instalable. Todos los demás mecanismos enumerados aquí pueden aportarse a través de la interfaz de un plugin.

→ [Referencia de Plugins](/docs/plugins)

### Slots

**Alcance:** app (aportados por cada slot).

Los slots son puntos de extensión de UI con nombre distribuidos por todo el chrome del CMS. Registras un componente de React que apunta al nombre de un slot y este se renderiza en esa ubicación. Hay 27 slots que cubren la página de inicio, la navegación, las vistas de colección, los formularios, las filas de entidad, los campos de formulario y la barra de la aplicación — y cada uno de ellos se renderiza.

→ [Referencia de Slots](/docs/frontend/slots)

### Reemplazos de Componentes (Swizzling)

**Alcance:** valores predeterminados a nivel de app o por colección.

Dos modos: **Eject** (reemplazo completo) o **Wrap** (ampliar el original).

19 nombres de componentes reemplazables divididos en dos niveles:

**Solo a nivel de App (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Con alcance de Colección (12):**
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

**Precedencia:** Los `components` a nivel de colección reemplazan los valores predeterminados a nivel de aplicación para el mismo nombre de componente (propagación de objetos simple — los valores de la colección sobrescriben los valores globales). Los nombres de componentes exclusivos para App (`Shell.*`, `HomePage`, `Auth.*`) solo se pueden reemplazar a nivel de `<Rebase>`.

→ [Reemplazos de Componentes](/docs/frontend/component-overrides)

### Vistas de Entidad

**Alcance:** entity (añade pestañas).

Vistas personalizadas que aparecen como pestañas en la página de detalle de la entidad. Se pueden definir globalmente en `<Rebase>` o por colección.

→ [Vistas de Entidad](/docs/frontend/entity-views)

### Acciones de Entidad

**Alcance:** entity.

Botones de acción personalizados en entidades individuales (publicar, archivar, clonar, etc.). Se pueden definir globalmente o por colección.

→ [Acciones de Entidad](/docs/frontend/entity-actions)

### `Actions` de Colección

**Alcance:** collection.

Componentes de React a nivel de barra de herramientas que reciben `CollectionActionsProps` (entidades seleccionadas, controlador de tabla, contexto de la colección). Se renderizan en la barra de herramientas de la colección junto a las acciones integradas.

**Relación con el slot `collection.actions`:** Ambos son aditivos — los componentes de `Actions` se renderizan primero en la barra de herramientas, y luego las contribuciones del slot `collection.actions`. No se reemplazan entre sí.

→ [Acciones de Entidad — Acciones de Colección](/docs/frontend/entity-actions#collection-actions)

### Modos de vista personalizados
**Alcance:** collection (añade un modo de vista).

Un mapa, un calendario, una galería, una línea de tiempo — otra renderización de *las mismas filas*,
ofrecida en el selector de vistas de la colección junto a Lista, Tabla, Tarjetas y Tablero.

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
filtros de la colección, la caja de búsqueda, la ordenación, la paginación, las comprobaciones de permisos
y el panel lateral de la entidad — esa es la razón principal para declarar uno en lugar de
construir un `AppView`:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Elegir la vista actualiza `?__view=`, sobrevive a una recarga y persiste por usuario.
Declarar una es suficiente para ofrecerla — `enabledViews` solo necesita configurarse cuando quieras
*quitar las vistas integradas*. Con una sola entrada, el selector se oculta.

**Esta no es una forma de construir una vista que abarque varias colecciones.** Un modo de vista
es otra representación de la consulta de una sola colección. Si tu componente ignora
`tableController` y obtiene cuatro tablas por su cuenta, debería ser una
[`AppView`](/docs/frontend#custom-views) — la barra de herramientas sobre él, con su caja de
búsqueda y su recuento de registros, estaría describiendo una consulta que no renderiza.

### `formView`
**Alcance:** collection.

Reemplaza todo el formulario de entidad predeterminado por un componente personalizado. Se configura en la definición de una colección:

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

Úsalo cuando necesites un diseño completamente personalizado para la experiencia de edición de entidades de una colección. Para ajustes más pequeños, es preferible usar `collection.components` con el reemplazo de `Entity.Form`.

El Builder se renderiza dentro del formulario del registro y recibe su `formContext` en vivo: escribe con `formContext.setFieldValue`, y el botón Guardar de la barra almacenará el registro. Donde el registro no se pueda editar —la vista de detalle de solo lectura o un usuario sin permisos de edición— `formContext.disabled` es `true` y las escrituras lanzarán un error. Establece `includeActions: false` si tu Builder guarda por su cuenta mediante `formContext.submit()`.

### `additionalFields`

**Alcance:** collection.

Columnas calculadas/virtuales mostradas en la tabla de la colección. Estas no corresponden a propiedades almacenadas — se calculan en el momento del renderizado.

→ [Columnas Adicionales](/docs/frontend/additional-columns)

### `propertyConfigs`

**Alcance:** property type.

Widgets de campo personalizados para tipos de propiedad específicos, que proporcionan campos de formulario y componentes de vista previa personalizados.

→ [Campos Personalizados](/docs/frontend/custom-fields)

## No es el panel de administración

Si lo que deseas cambiar es lo que hace el servidor en lugar de lo que muestra
el panel, esta es la página equivocada. El servidor tiene su propia escala:

| Quiero… | Nivel | Referencia |
|---|---|---|
| Delimitar qué filas devuelve una lectura | callback `beforeQuery` | [Extender el servidor](/docs/backend/extending#2-collection-callbacks) |
| Ocultar/censurar un valor en la salida | callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Añadir un endpoint propio | función personalizada | [Funciones Personalizadas](/docs/backend/custom-functions) |
| Hacer que la búsqueda encuentre subcadenas *y* normalice acentos | `search.mode: "hybrid"` | [Búsqueda](/docs/backend/search) |
| Controlar el proceso del servidor | servidor personalizado, luego `rebase eject` | [Extender el servidor](/docs/backend/extending) |

→ [Rebase no hace X](/docs/backend/extending)

## Resumen de Precedencia

- **`collection.components` se aplica sobre los `components` globales** dentro de esa colección. Un reemplazo a nivel de colección sustituye a ambos; un reemplazo con `wrap: true` en la colección envuelve al reemplazo global cuando existe uno (en 0.24 envuelve al componente integrado y se omite el reemplazo global). Consulta [Reemplazos de Componentes](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Las `Actions` de colección y el slot `collection.actions` son aditivos** — `Actions` se renderizan primero, seguidas de las contribuciones a los slots.
- **Las `entityActions` y `entityViews` a nivel de colección extienden (no reemplazan) las globales.**
- **Los plugins se aplican en el orden del array `plugins`**, no por `key`. Las contribuciones a slots se renderizan según su `order` (menor valor primero, 50 por defecto), y los empates mantienen ese orden. Los envoltorios de campo (field wrappers) de varios plugins se componen en ese orden, siendo el del primer plugin el más interno; en 0.24 solo se renderizaba el último envoltorio. Consulta [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
