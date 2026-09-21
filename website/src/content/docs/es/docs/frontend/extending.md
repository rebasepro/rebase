---
sourceHash: c63661257e39dcba
title: Extender Rebase
sidebar_label: Extender Rebase
description: "Una guía de decisión para elegir el mecanismo de extensión adecuado: plugins, slots, reemplazos de componentes, vistas de entidad, acciones y más."
---

## Descripción general

Rebase ofrece cerca de una docena de mecanismos de extensión: plugins, slots, reemplazos de componentes, vistas de entidad, acciones, campos personalizados y más. Cada uno apunta a un alcance diferente (a nivel de aplicación, por colección, por entidad, por propiedad) y a una parte distinta de la interfaz de usuario.

Esta guía le ayuda a elegir el mecanismo adecuado para su caso de uso y luego enlaza con la referencia detallada de cada uno.

Todo lo que se describe aquí corresponde al **panel de administración**. Para el servidor —restringir una lectura,
agregar una ruta, integrar el driver en su propio proceso, `rebase eject`— consulte
[Rebase no hace X](/docs/backend/extending), que es una tabla similar
para el backend.

## Tabla de decisiones

| Quiero… | Mecanismo | Alcance | Referencia |
|---|---|---|---|
| Reemplazar la barra de la aplicación | `components` (`Shell.AppBar`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio de sesión | `components` (`Auth.LoginView`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio | `components` (`HomePage`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Cambiar por completo la apariencia del formulario de una colección | `formView` | colección | [más abajo](#formview) |
| Cambiar un componente dentro de una colección | `collection.components` | colección | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Establecer reemplazos de componentes predeterminados para todas las colecciones | `components` (nombres con alcance de colección) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Agregar un botón a la barra de herramientas de la colección | `Actions` de colección | colección | [Acciones de entidad](/docs/frontend/entity-actions#collection-actions) |
| Inyectar interfaz de usuario en un slot de la barra de herramientas de la colección | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Agregar una columna calculada a una tabla | `additionalFields` | colección | [Columnas adicionales](/docs/frontend/additional-columns) |
| Agregar un widget de campo personalizado para un tipo de propiedad | `propertyConfigs` | tipo de propiedad | [Campos personalizados](/docs/frontend/custom-fields) |
| Agregar una pestaña de entidad | `entityViews` | entidad | [Vistas de entidad](/docs/frontend/entity-views) |
| Renderizar las filas de una colección de una forma diferente | `admin.customViews` | colección | [más abajo](#customviews) |
| Agregar una acción de fila/contexto o un botón de entidad | `entityActions` | entidad | [Acciones de entidad](/docs/frontend/entity-actions) |
| Poner una cifra o gráfico en la tarjeta de la página de inicio de una colección | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Inyectar interfaz de usuario en una ubicación específica de la estructura (chrome) | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir varias extensiones como una única unidad instalable | `plugins` | app | [Plugins](/docs/plugins) |
| Dar estilo a lo que acabo de construir | `@rebasepro/ui` + tokens de tema | cualquiera | [Estilizado de interfaz personalizada](/docs/frontend/styling) |

:::tip[Elija lo que elija, constrúyalo a partir del kit]
Cada mecanismo a continuación le proporciona un componente de React y no dice nada sobre con qué
rellenarlo. Utilice componentes de `@rebasepro/ui` y los tokens de color del tema en lugar
de CSS escrito a mano: una vista personalizada sigue siendo una vista de administración, y un color
fijo en código será invisible en uno de los dos temas. Consulte
[Estilizado de interfaz personalizada](/docs/frontend/styling).
:::

## Mecanismos en detalle

### Plugins

**Alcance:** app.

Un plugin agrupa colecciones, vistas, reemplazos de componentes, contribuciones de slots, autenticación, fuentes de datos, proveedores, hooks y callbacks del ciclo de vida en una sola unidad instalable. Todos los demás mecanismos enumerados aquí pueden aportarse a través de la interfaz de un plugin.

→ [Referencia de Plugins](/docs/plugins)

### Slots

**Alcance:** app (aportados por cada slot).

Los slots son puntos de extensión de la interfaz de usuario nombrados y distribuidos a lo largo del chrome del CMS. Usted registra un componente de React dirigido a un nombre de slot y este se renderiza en esa ubicación. Hay 27 slots que abarcan la página de inicio, la navegación, las vistas de colección, los formularios, las filas de entidad, los campos de formulario y la barra de la aplicación; y cada uno de ellos es renderizado.

→ [Referencia de Slots](/docs/frontend/slots)

### Reemplazos de componentes (Swizzling)

**Alcance:** valores predeterminados a nivel de app o por colección.

Dos modos: **Eject** (reemplazo total) o **Wrap** (extender el original).

19 nombres de componentes reemplazables en dos niveles:

**Solo para la app (7):**
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

**Precedencia:** Los `components` a nivel de colección anulan los predeterminados a nivel de app para el mismo nombre de componente (propagación de objetos simple: los valores de la colección sobrescriben los valores globales). Los nombres de componentes exclusivos de la aplicación (`Shell.*`, `HomePage`, `Auth.*`) solo pueden reemplazarse a nivel de `<Rebase>`.

→ [Reemplazos de componentes](/docs/frontend/component-overrides)

### Vistas de entidad

**Alcance:** entidad (agrega pestañas).

Vistas personalizadas que aparecen como pestañas en la página de detalles de la entidad. Se pueden definir globalmente en `<Rebase>` o por colección.

→ [Vistas de entidad](/docs/frontend/entity-views)

### Acciones de entidad

**Alcance:** entidad.

Botones de acción personalizados en entidades individuales (publicar, archivar, clonar, etc.). Se pueden definir globalmente o por colección.

→ [Acciones de entidad](/docs/frontend/entity-actions)

### `Actions` de colección

**Alcance:** colección.

Componentes de React a nivel de barra de herramientas que reciben `CollectionActionsProps` (entidades seleccionadas, controlador de tabla, contexto de colección). Se renderizan en la barra de herramientas de la colección junto a las acciones integradas.

**Relación con el slot `collection.actions`:** Ambos son acumulativos: los componentes `Actions` se renderizan primero en la barra de herramientas y luego las contribuciones del slot `collection.actions`. No se reemplazan entre sí.

→ [Acciones de entidad — Acciones de colección](/docs/frontend/entity-actions#collection-actions)

### Modos de vista personalizados {#customviews}

**Alcance:** colección (agrega un modo de vista).

Un mapa, un calendario, una galería, una línea de tiempo: otra representación de *las mismas filas*,
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

O registre el componente una vez y nómbrelo por su clave, lo que también permite
seleccionarlo desde el editor de colecciones:

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
filtros de la colección, la casilla de búsqueda, el ordenamiento, la paginación, las verificaciones de permisos
y el panel lateral de la entidad; ese es todo el motivo para declarar uno en lugar
de construir un `AppView`:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Elegir la vista actualiza `?__view=`, sobrevive a una recarga y persiste por usuario.
Declarar una es suficiente para ofrecerla; `enabledViews` solo necesita configurarse cuando se
desea *quitar las opciones integradas*. Con una sola entrada, el selector se oculta.

**Esta no es una forma de construir una vista que abarque varias colecciones.** Un modo de vista
es otra representación de la consulta de una colección. Si su componente ignora
`tableController` y obtiene cuatro tablas por su cuenta, debería ser un
[`AppView`](/docs/frontend#custom-views); la barra de herramientas superior, con su casilla
de búsqueda y su conteo de registros, estaría describiendo una consulta que este no renderiza.

### `formView` {#formview}

**Alcance:** colección.

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

Utilícelo cuando necesite un diseño completamente personalizado para la experiencia de edición de entidades de una colección. Para ajustes menores, prefiera `collection.components` con el reemplazo de `Entity.Form`.

El Builder se renderiza dentro del formulario del registro y recibe su `formContext` en vivo: escriba con `formContext.setFieldValue`, y el botón Guardar de la barra almacenará el registro. Donde el registro no se pueda editar (la vista de detalles de solo lectura, o un usuario sin permisos de edición), `formContext.disabled` es `true` y las escrituras arrojarán un error. Establezca `includeActions: false` si su Builder guarda por su cuenta mediante `formContext.submit()`.

### `additionalFields`

**Alcance:** colección.

Columnas calculadas/virtuales mostradas en la tabla de la colección. Estas no corresponden a propiedades almacenadas: se calculan en el momento del renderizado.

→ [Columnas adicionales](/docs/frontend/additional-columns)

### `propertyConfigs`

**Alcance:** tipo de propiedad.

Widgets de campo personalizados para tipos de propiedad específicos, que proporcionan campos de formulario y componentes de vista previa personalizados.

→ [Campos personalizados](/docs/frontend/custom-fields)

## Fuera del panel de administración

Si lo que desea cambiar es lo que hace el servidor en lugar de lo que
muestra el panel, esta no es la página indicada. El servidor tiene su propia escala:

| Quiero… | Nivel | Referencia |
|---|---|---|
| Restringir qué filas devuelve una lectura | Callback `beforeQuery` | [Extender el servidor](/docs/backend/extending#2-collection-callbacks) |
| Ocultar/censurar un valor en la respuesta de salida | Callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Agregar un endpoint propio | función personalizada | [Funciones personalizadas](/docs/backend/custom-functions) |
| Hacer que la búsqueda encuentre subcadenas *y* normalice acentos | `search.mode: "hybrid"` | [Búsqueda](/docs/backend/search) |
| Tomar el control del proceso del servidor | servidor personalizado, luego `rebase eject` | [Extender el servidor](/docs/backend/extending) |

→ [Rebase no hace X](/docs/backend/extending)

## Resumen de precedencia

- **`collection.components` tiene prioridad sobre `components` globales** dentro de esa colección (fusión simple por propagación en `DataCollectionView`).
- **`Actions` de colección y el slot `collection.actions` son acumulativos**: `Actions` se renderizan primero, luego las contribuciones de los slots.
- **`entityActions` y `entityViews` a nivel de colección amplían (no reemplazan) a los globales.**
- **Las contribuciones de plugins se combinan según el orden de `key`.**
