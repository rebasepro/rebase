---
sourceHash: ec086b9ec3b281fc
title: Extender Rebase
sidebar_label: Extender Rebase
description: "Una guía de decisión para elegir el mecanismo de extensión adecuado: plugins, slots, reemplazos de componentes, vistas de entidad, acciones y más."
---

## Visión general

Rebase ofrece cerca de una docena de mecanismos de extensión: plugins, slots, reemplazos de componentes, vistas de entidad, acciones, campos personalizados y más. Cada uno de ellos se enfoca en un ámbito diferente (toda la aplicación, por colección, por entidad, por propiedad) y en una parte diferente de la interfaz de usuario.

Esta guía le ayuda a elegir el mecanismo adecuado para su caso de uso y luego enlaza a la referencia detallada de cada uno.

:::tip[Comience con el modelo, no con la lista]
Cada mecanismo a continuación es lo mismo por debajo: un componente de React colocado en un lugar. [Personalizar el Admin](/docs/frontend/customizing) explica ese modelo en una sola página (bloques de construcción, hooks, lugares) con recetas probadas para un singleton de configuración, ajustes por usuario, una acción masiva, una vista de calendario, un panel de control y una pantalla de inicio de sesión personalizada. Léalo primero; regrese aquí para elegir el lugar.
:::

Todo lo que se describe aquí corresponde al **panel de administración**. Para el servidor (restringir una lectura, agregar una ruta, incrustar el driver en su propio proceso, `rebase eject`), consulte [Rebase no hace X](/docs/backend/extending), que ofrece una tabla similar para el backend.

## Tabla de decisión

| Quiero… | Mecanismo | Ámbito | Referencia |
|---|---|---|---|
| Reemplazar la barra de la aplicación | `components` (`Shell.AppBar`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio de sesión | `components` (`Auth.LoginView`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio | `components` (`HomePage`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Cambiar por completo la apariencia del formulario de una colección | `formView` | colección | [a continuación](#formview) |
| Sustituir un componente dentro de una colección | `admin.components` | colección | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Establecer reemplazos de componentes predeterminados para todas las colecciones | `components` (nombres con ámbito de colección) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Agregar un botón a la barra de herramientas de la colección | `Actions` de la colección | colección | [Acciones de entidad](/docs/frontend/entity-actions#collection-actions) |
| Inyectar interfaz de usuario en un slot de la barra de herramientas de la colección | slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Agregar una columna calculada a una tabla | `additionalFields` | colección | [Columnas adicionales](/docs/frontend/additional-columns) |
| Agregar un widget de campo personalizado para un tipo de propiedad | `propertyConfigs` | tipo de propiedad | [Campos personalizados](/docs/frontend/custom-fields) |
| Agregar una pestaña de entidad | `entityViews` | entidad | [Vistas de entidad](/docs/frontend/entity-views) |
| Renderizar las filas de una colección de una forma diferente | `admin.customViews` | colección | [a continuación](#modos-de-vista-personalizados) |
| Agregar una acción de fila/contexto o un botón de entidad | `entityActions` | entidad | [Acciones de entidad](/docs/frontend/entity-actions) |
| Colocar una cifra en la tarjeta de la página de inicio de una colección | slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Inyectar interfaz de usuario en una ubicación específica del chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir varias extensiones como una única unidad instalable | `plugins` | app | [Plugins](/docs/plugins) |
| Aplicar estilos a lo que acabo de construir | `@rebasepro/ui` + tokens de tema | cualquiera | [Estilizado de interfaz de usuario personalizada](/docs/frontend/styling) |

:::tip[Elija lo que elija, constrúyalo con el kit]
Cada mecanismo a continuación le proporciona un componente de React y no impone nada sobre con qué rellenarlo. Utilice los componentes de `@rebasepro/ui` y los tokens de color del tema en lugar de CSS escrito a mano: una vista personalizada sigue siendo una vista de administración, y un color fijado en código resultará invisible en uno de los dos temas. Consulte [Estilizado de interfaz de usuario personalizada](/docs/frontend/styling).
:::

## Mecanismos en detalle

### Plugins

**Ámbito:** app.

Un plugin agrupa colecciones inyectadas o modificadas, vistas, contribuciones a slots, wrappers de campos, proveedores, hooks y callbacks de ciclo de vida en una única unidad instalable. Los reemplazos de componentes, vistas de entidad, acciones de entidad y `propertyConfigs` no son campos de plugin: se definen en `<Rebase>` o en la colección.

→ [Referencia de Plugins](/docs/plugins)

### Slots

**Ámbito:** app (contribuido por cada slot).

Los slots son puntos de extensión de interfaz de usuario con nombre distribuidos por todo el chrome del CMS. Registra un componente de React dirigido al nombre de un slot y este se renderiza en dicha ubicación. Existen 27 slots que cubren la página de inicio, la navegación, las vistas de colección, los formularios, las filas de entidad, los campos de formulario y la barra de la aplicación; y cada uno de ellos se renderiza.

→ [Referencia de Slots](/docs/frontend/slots)

### Reemplazos de componentes (Swizzling)

**Ámbito:** valores predeterminados a nivel de app o por colección.

Dos modos: **Eject** (reemplazo completo) o **Wrap** (ampliar el original).

19 nombres de componentes reemplazables divididos en dos niveles:

**Solo para la aplicación (7):**
- `Shell.AppBar`
- `Shell.Drawer`
- `Shell.DrawerNavigationItem`
- `Shell.DrawerNavigationGroup`
- `HomePage`
- `HomePage.CollectionCard`
- `Auth.LoginView`

**Con ámbito de colección (12):**
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

**Precedencia:** Los `components` a nivel de colección se aplican por encima de los valores predeterminados a nivel de app para el mismo nombre de componente: un reemplazo de colección sustituye a ambos, y un reemplazo de colección con `wrap: true` envuelve al de nivel de app. Los nombres de componentes exclusivos de la aplicación (`Shell.*`, `HomePage`, `Auth.*`) solo se pueden reemplazar al nivel de `<Rebase>`.

→ [Reemplazos de componentes](/docs/frontend/component-overrides)

### Vistas de entidad

**Ámbito:** entidad (agrega pestañas).

Vistas personalizadas que aparecen como pestañas en la página de detalle de la entidad. Se definen por colección o se registran una vez en `<Rebase entityViews>` (o `<RebaseCMS entityViews>`) y se referencian por su `key` en el `admin.entityViews` de una colección.

→ [Vistas de entidad](/docs/frontend/entity-views)

### Acciones de entidad

**Ámbito:** entidad.

Botones de acción personalizados en entidades individuales (publicar, archivar, clonar, etc.). Se definen por colección o se registran una vez en `<Rebase entityActions>` (o `<RebaseCMS entityActions>`) y se referencian por su `key` en el `admin.entityActions` de una colección.

→ [Acciones de entidad](/docs/frontend/entity-actions)

### `Actions` de colección

**Ámbito:** colección.

Componentes de React a nivel de barra de herramientas que reciben `CollectionActionsProps` (entidades seleccionadas, controlador de tabla, contexto de la colección). Se renderizan en la barra de herramientas de la colección junto a las acciones integradas.

**Relación con el slot `collection.actions`:** Ambos son aditivos: los componentes `Actions` se renderizan primero en la barra de herramientas y luego las contribuciones del slot `collection.actions`. No se reemplazan entre sí.

→ [Acciones de entidad — Acciones de colección](/docs/frontend/entity-actions#collection-actions)

### Modos de vista personalizados
**Ámbito:** colección (agrega un modo de vista).

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

O registre el componente una vez y nómbrelo mediante su clave, lo que también permite seleccionarlo desde el editor de colecciones:

```tsx
<RebaseCMS
    collections={collections}
    collectionViews={[{ key: "map", name: "Map", icon: "Map", Builder: MapView }]}
/>
```

```ts
admin: { customViews: ["map"] }
```

`Builder` recibe el `tableController` en vivo, por lo que la vista hereda los filtros de la colección, el cuadro de búsqueda, la ordenación, la paginación, las comprobaciones de permisos y el panel lateral de la entidad; esa es la razón principal para declarar uno en lugar de construir un `AppView`:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Las filas proceden del servidor, con la estructura devuelta por `useRows`: fechas como cadenas ISO, un belongsTo como su columna de clave foránea y una relación que la vista cargó anidada bajo su nombre. `highlightedIds` contiene los IDs de las filas que la vista dibuja como seleccionadas, y `selectionController` también opera con IDs y filas.

Elegir la vista actualiza `?__view=`, sobrevive a una recarga y se conserva por usuario. Declarar una es suficiente para ofrecerla; solo es necesario configurar `enabledViews` cuando desee *eliminar las vistas integradas*. Con una sola entrada, el selector permanece oculto.

**Esta no es una forma de construir una vista que abarque varias colecciones.** Un modo de vista es otra renderización de la consulta de una sola colección. Si su componente ignora `tableController` y obtiene cuatro tablas por su cuenta, lo adecuado es que sea un [`AppView`](/docs/frontend#custom-views); de lo contrario, la barra de herramientas superior, con su cuadro de búsqueda y su recuento de registros, estaría describiendo una consulta que este no renderiza.

### `formView`
**Ámbito:** colección.

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

Utilícelo cuando necesite un diseño completamente personalizado para la experiencia de edición de entidades de una colección. Para ajustes menores, es preferible utilizar `admin.components` con el reemplazo de `Entity.Form`.

El Builder se renderiza dentro del formulario del registro y recibe su `formContext` activo: escriba con `formContext.setFieldValue`, y el botón Guardar de la barra almacenará el registro. En los casos en que el registro no se puede editar (la vista de detalle de solo lectura o un usuario sin permiso de edición), `formContext.disabled` es `true` y las operaciones de escritura lanzarán un error. Establezca `includeActions: false` si su Builder guarda por su cuenta mediante `formContext.submit()`.

### `additionalFields`

**Ámbito:** colección.

Columnas calculadas/virtuales mostradas en la tabla de la colección. Estas no corresponden a propiedades almacenadas, sino que se calculan en el momento de la renderización.

→ [Columnas adicionales](/docs/frontend/additional-columns)

### `propertyConfigs`

**Ámbito:** tipo de propiedad.

Widgets de campo personalizados para tipos de propiedad específicos, que proporcionan componentes de vista previa y campos de formulario a medida.

→ [Campos personalizados](/docs/frontend/custom-fields)

## Fuera del panel de administración

Si lo que desea modificar es el comportamiento del servidor en lugar de lo que muestra el panel, esta no es la página adecuada. El servidor dispone de su propia escala de opciones:

| Quiero… | Nivel | Referencia |
|---|---|---|
| Restringir qué filas devuelve una lectura | callback `beforeQuery` | [Extender el servidor](/docs/backend/extending#2-collection-callbacks) |
| Ocultar o editar un valor en la salida | callback `afterRead` | [Callbacks](/docs/collections/callbacks) |
| Agregar un endpoint propio | función personalizada | [Funciones personalizadas](/docs/backend/custom-functions) |
| Hacer que la búsqueda encuentre subcadenas *y* normalice acentos | `search.mode: "hybrid"` | [Búsqueda](/docs/backend/search) |
| Tener el control total del proceso del servidor | servidor personalizado, luego `rebase eject` | [Extender el servidor](/docs/backend/extending) |

→ [Rebase no hace X](/docs/backend/extending)

## Resumen de precedencia

- **El `admin.components` de una colección se aplica sobre los `components` globales** dentro de esa colección. Un reemplazo de colección sustituye a ambos; un reemplazo de colección con `wrap: true` envuelve al reemplazo global si existe (en la versión 0.24 envuelve al integrado y se omite el reemplazo global). Consulte [Reemplazos de componentes](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Las `Actions` de colección y el slot `collection.actions` son aditivos**: `Actions` se renderizan primero, seguidas de las contribuciones del slot.
- **`entityActions` y `entityViews` a nivel de aplicación funcionan como un registro, no como valores predeterminados:** una colección solo mostrará una opción cuando su propio `admin.entityActions` / `admin.entityViews` especifique su `key`.
- **Los plugins se aplican en el orden del array `plugins`**, no por `key`. Las contribuciones a slots se renderizan según su `order` (menor primero, 50 por defecto), y en caso de empate mantienen ese orden. Los wrappers de campos procedentes de varios plugins se componen en ese orden, siendo el del primer plugin el más interno; en la versión 0.24 solo se renderizaba el último wrapper. Consulte [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
