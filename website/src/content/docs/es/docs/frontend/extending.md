---
sourceHash: 387b83637f6dc883
title: Extender Rebase
sidebar_label: Extender Rebase
description: "Una guía de decisión para elegir el mecanismo de extensión adecuado: plugins, slots, sobrescritura de componentes, vistas de entidad, acciones y más."
---

## Descripción general

Rebase ofrece aproximadamente una docena de mecanismos de extensión: plugins, slots, sobrescritura de componentes, vistas de entidad, acciones, campos personalizados y más. Cada uno se enfoca en un alcance diferente (a nivel de aplicación, por colección, por entidad, por propiedad) y en una parte diferente de la interfaz de usuario (UI).

Esta guía te ayuda a elegir el mecanismo adecuado para tu caso de uso y luego te enlaza a la referencia detallada de cada uno.

## Tabla de decisión

| Quiero… | Mecanismo | Alcance | Referencia |
|---|---|---|---|
| Reemplazar la barra de la aplicación | `components` (`Shell.AppBar`) | app | [Sobrescritura de componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio de sesión | `components` (`Auth.LoginView`) | app | [Sobrescritura de componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio | `components` (`HomePage`) | app | [Sobrescritura de componentes](/docs/frontend/component-overrides) |
| Cambiar por completo la apariencia del formulario de una colección | `formView` | colección | [más abajo](#formview) |
| Intercambiar un componente dentro de una colección | `collection.components` | colección | [Sobrescritura de componentes](/docs/frontend/component-overrides) |
| Establecer sobrescrituras de componentes predeterminadas para todas las colecciones | `components` (nombres con alcance de colección) | app | [Sobrescritura de componentes](/docs/frontend/component-overrides) |
| Añadir un botón a la barra de herramientas de la colección | `Actions` de colección | colección | [Acciones de entidad](/docs/frontend/entity-actions#collection-actions) |
| Inyectar interfaz de usuario en un slot de la barra de herramientas de la colección | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Añadir una columna calculada a una tabla | `additionalFields` | colección | [Columnas adicionales](/docs/frontend/additional-columns) |
| Añadir un widget de campo personalizado para un tipo de propiedad | `propertyConfigs` | tipo de propiedad | [Campos personalizados](/docs/frontend/custom-fields) |
| Añadir una pestaña de entidad | `entityViews` | entidad | [Vistas de entidad](/docs/frontend/entity-views) |
| Renderizar las filas de una colección de una forma diferente | `admin.customViews` | colección | [más abajo](#customviews) |
| Añadir una acción de fila/contextual o un botón de entidad | `entityActions` | entidad | [Acciones de entidad](/docs/frontend/entity-actions) |
| Colocar una cifra en la tarjeta de la página de inicio de una colección | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Inyectar interfaz de usuario en una ubicación específica del chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir varias extensiones como una sola unidad instalable | `plugins` | app | [Plugins](/docs/plugins) |
| Dar estilo a lo que acabo de construir | `@rebasepro/ui` + tokens de tema | cualquiera | [Estilizar interfaz personalizada](/docs/frontend/styling) |

:::tip[Elijas lo que elijas, constrúyelo a partir del kit]
Cada uno de los mecanismos a continuación te proporciona un componente de React y no dice nada sobre con qué llenarlo. Utiliza los componentes de `@rebasepro/ui` y los tokens de color del tema en lugar de CSS escrito a mano: una vista personalizada sigue siendo una vista de administración, y un color hardcodeado es invisible en uno de los dos temas. Consulta [Estilizar interfaz personalizada](/docs/frontend/styling).
:::

## Mecanismos en detalle

### Plugins

**Alcance:** app.

Un plugin empaqueta colecciones, vistas, sobrescrituras de componentes, contribuciones de slots, autenticación, fuentes de datos, proveedores, hooks y callbacks de ciclo de vida en una sola unidad instalable. Todos los demás mecanismos listados aquí pueden aportarse a través de la interfaz de un plugin.

→ [Referencia de Plugins](/docs/plugins)

### Slots

**Alcance:** app (aportado por slot).

Los slots son puntos de extensión de la interfaz de usuario con nombre distribuidos por todo el chrome del CMS. Registras un componente de React apuntando al nombre de un slot y este se renderiza en esa ubicación. Hay 29 slots que cubren la página de inicio, navegación, vistas de colección, formularios, filas de entidad, paneles y más.

→ [Referencia de Slots](/docs/frontend/slots)

### Sobrescritura de componentes (Swizzling)

**Alcance:** valores predeterminados a nivel de app o por colección.

Dos modos: **Eject** (reemplazo completo) o **Wrap** (aumentar el original).

19 nombres de componentes sobrescribibles en dos niveles:

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

**Precedencia:** Los `components` a nivel de colección sobrescriben los valores predeterminados a nivel de app para el mismo nombre de componente (propagación de objetos simple: los valores de la colección sobrescriben los valores globales). Los nombres de componentes exclusivos de la app (`Shell.*`, `HomePage`, `Auth.*`) solo se pueden sobrescribir al nivel de `<Rebase>`.

→ [Sobrescritura de componentes](/docs/frontend/component-overrides)

### Vistas de entidad

**Alcance:** entidad (añade pestañas).

Vistas personalizadas que aparecen como pestañas en la página de detalle de la entidad. Se pueden definir globalmente en `<Rebase>` o por colección.

→ [Vistas de entidad](/docs/frontend/entity-views)

### Acciones de entidad

**Alcance:** entidad.

Botones de acción personalizados en entidades individuales (publicar, archivar, clonar, etc.). Se pueden definir globalmente o por colección.

→ [Acciones de entidad](/docs/frontend/entity-actions)

### `Actions` de colección

**Alcance:** colección.

Componentes de React a nivel de barra de herramientas que reciben `CollectionActionsProps` (entidades seleccionadas, controlador de tabla, contexto de la colección). Se renderizan en la barra de herramientas de la colección junto a las acciones integradas.

**Relación con el slot `collection.actions`:** Ambos son acumulativos: los componentes `Actions` se renderizan primero en la barra de herramientas, seguidos de las contribuciones del slot `collection.actions`. No se reemplazan entre sí.

→ [Acciones de entidad — Acciones de colección](/docs/frontend/entity-actions#collection-actions)

### Modos de vista personalizados {#customviews}

**Alcance:** colección (añade un modo de vista).

Un mapa, un calendario, una galería, una línea de tiempo: otra forma de renderizar *las mismas filas*, disponible en el selector de vistas de la colección junto a Lista, Tabla, Tarjetas y Tablero.

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

O registra el componente una vez y nómbralo por su clave, lo que también permite seleccionarlo desde el editor de colecciones:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` recibe el `tableController` en vivo, por lo que la vista hereda los filtros de la colección, la casilla de búsqueda, el ordenamiento, la paginación, las comprobaciones de permisos y el panel lateral de la entidad; esa es toda la razón para declarar una en lugar de construir una `AppView`:

```tsx
function MapView({ tableController, onEntityClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.data.map(e => e.values.location)}
        onMarkerClick={i => onEntityClick?.(tableController.data[i])}
    />;
}
```

Elegir la vista actualiza `?__view=`, sobrevive a una recarga y persiste por usuario. Declarar una es suficiente para ofrecerla; solo es necesario configurar `enabledViews` cuando deseas *quitar las integradas*. Con una sola entrada, el selector se oculta.

**Esta no es una forma de crear una vista que abarque varias colecciones.** Un modo de vista es otra representación de la consulta de una colección. Si tu componente ignora `tableController` y obtiene cuatro tablas por su cuenta, debería ser una [`AppView`](/docs/frontend#custom-views); de lo contrario, la barra de herramientas situada encima, con su casilla de búsqueda y su recuento de registros, estaría describiendo una consulta que no renderiza.

### `formView` {#formview}

**Alcance:** colección.

Reemplaza todo el formulario de entidad predeterminado por un componente personalizado. Se define en la configuración de la colección:

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

Úsalo cuando necesites un diseño completamente personalizado para la experiencia de edición de entidades de una colección. Para ajustes más pequeños, es preferible utilizar `collection.components` con una sobrescritura de `Entity.Form`.

El Builder se renderiza dentro del formulario del registro y recibe su `formContext` en vivo: escribe con `formContext.setFieldValue`, y el botón Guardar de la barra almacenará el registro. Donde el registro no se puede editar (la vista de detalle de solo lectura, o un usuario sin permisos de edición), `formContext.disabled` es `true` y las operaciones de escritura lanzarán un error. Configura `includeActions: false` si tu Builder guarda por su cuenta mediante `formContext.submit()`.

### `additionalFields`

**Alcance:** colección.

Columnas calculadas/virtuales mostradas en la tabla de la colección. Estas no corresponden a propiedades almacenadas: se calculan en el momento del renderizado.

→ [Columnas adicionales](/docs/frontend/additional-columns)

### `propertyConfigs`

**Alcance:** tipo de propiedad.

Widgets de campos personalizados para tipos de propiedades específicos, proporcionando campos de formulario y componentes de vista previa personalizados.

→ [Campos personalizados](/docs/frontend/custom-fields)

## Resumen de precedencia

- **`collection.components` tiene prioridad sobre `components` globales** dentro de esa colección (fusión simple mediante spread en `DataCollectionView`).
- **Las `Actions` de colección y el slot `collection.actions` son acumulativos**: `Actions` se renderizan primero, seguidos de las contribuciones de los slots.
- **Las `entityActions` y `entityViews` a nivel de colección amplían (no reemplazan) a las globales.**
- **Las contribuciones de los plugins se fusionan en el orden de `key`.**
