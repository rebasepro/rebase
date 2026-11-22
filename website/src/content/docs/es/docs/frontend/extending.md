---
sourceHash: 26f6f53fc55b88dc
title: Extender Rebase
sidebar_label: Extender Rebase
description: "Una guía de decisión para elegir el mecanismo de extensión adecuado: plugins, slots, reemplazos de componentes, vistas de entidad, acciones y más."
---

## Información general

Rebase ofrece alrededor de una docena de mecanismos de extensión: plugins, slots, reemplazos de componentes (component overrides), vistas de entidad, acciones, campos personalizados y más. Cada uno apunta a un alcance diferente (a nivel de app, por colección, por entidad, por propiedad) y a una parte diferente de la interfaz de usuario.

Esta guía te ayuda a elegir el mecanismo adecuado para tu caso de uso y luego te enlaza a la referencia detallada de cada uno.

:::tip[Empieza por el modelo, no por la lista]
En el fondo, cada mecanismo que se describe a continuación es lo mismo: un componente de React ubicado en un lugar. [Personalizar la administración](/docs/frontend/customizing) explica ese modelo en una sola página (bloques de construcción, hooks, ubicaciones) con recetas probadas para un singleton de configuración, ajustes por usuario, una acción por lotes, una vista de calendario, un panel de control (dashboard) y una pantalla de inicio de sesión personalizada. Léelo primero y regresa aquí para elegir el lugar.
:::

Todo lo que se describe aquí corresponde al **panel de administración**. Para el servidor —restringir una lectura, añadir una ruta, embeber el driver en tu propio proceso, `rebase eject`— consulta [Rebase no hace X](/docs/backend/extending), que ofrece un cuadro similar para el backend.

## Tabla de decisiones

| Quiero… | Mecanismo | Alcance | Referencia |
|---|---|---|---|
| Reemplazar la barra de la app | `components` (`Shell.AppBar`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio de sesión | `components` (`Auth.LoginView`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Reemplazar la página de inicio | `components` (`HomePage`) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Cambiar por completo la apariencia del formulario de una tabla | `formView` en `customizeTable` | tabla | [más abajo](#formview) |
| Cambiar un componente dentro de la colección de una tabla | `components` en `customizeTable` | tabla | [Reemplazos de componentes](/docs/frontend/component-overrides#collection-level-component-overrides) |
| Establecer reemplazos de componentes por defecto para todas las colecciones | `components` (nombres con alcance de colección) | app | [Reemplazos de componentes](/docs/frontend/component-overrides) |
| Añadir un botón a la barra de herramientas de la colección | `Actions` en `customizeTable` | tabla | [Acciones de entidad](/docs/frontend/entity-actions#collection-actions) |
| Inyectar UI en un slot de la barra de herramientas de la colección | Slot `collection.actions` | app/plugin | [Slots](/docs/frontend/slots) |
| Añadir una columna calculada a una tabla | `additionalFields` en `customizeTable` | tabla | [Columnas adicionales](/docs/frontend/additional-columns) |
| Reemplazar el control de un campo | `Field` en `customizeTable` | campo | [Campos personalizados](/docs/frontend/custom-fields) |
| Registrar un tipo de campo reutilizable | `propertyConfigs` | app | [Campos personalizados](/docs/frontend/custom-fields#a-reusable-field-type) |
| Añadir una pestaña de entidad | `entityViews` en `customizeTable` | entidad | [Vistas de entidad](/docs/frontend/entity-views) |
| Renderizar las filas de una tabla de una manera diferente | `customViews` en `customizeTable` | tabla | [más abajo](#modos-de-vista-personalizados) |
| Añadir una acción de fila/contexto o un botón de entidad | `entityActions` en `customizeTable` | entidad | [Acciones de entidad](/docs/frontend/entity-actions) |
| Mostrar una cifra en la tarjeta de la página de inicio de una colección | Slot `home.card.widget` | app/plugin | [Slots](/docs/frontend/slots) |
| Inyectar UI en una ubicación específica del chrome | `slots` | app/plugin | [Slots](/docs/frontend/slots) |
| Distribuir varias extensiones como una sola unidad instalable | `plugins` | app | [Plugins](/docs/plugins) |
| Aplicar estilos a lo que acabo de construir | `@rebasepro/ui` + tokens de tema | cualquiera | [Estilos de UI personalizada](/docs/frontend/styling) |

:::tip[Elijas lo que elijas, constrúyelo a partir del kit]
Cada mecanismo a continuación te entrega un componente de React sin imponer cómo completarlo. Utiliza los componentes de `@rebasepro/ui` y los tokens de color del tema en lugar de CSS escrito a mano: una vista personalizada sigue siendo una vista de administración, y un color fijado a mano (hardcoded) resultará invisible en uno de los dos temas. Consulta [Estilos de UI personalizada](/docs/frontend/styling).
:::

## Mecanismos en detalle

### Plugins

**Alcance:** app.

Un plugin empaqueta colecciones inyectadas o modificadas, vistas, contribuciones a slots, envoltorios de campos (field wrappers), proveedores, hooks y callbacks de ciclo de vida en una única unidad instalable. Los reemplazos de componentes, vistas de entidad, acciones de entidad y `propertyConfigs` no son campos de plugins: se configuran en `<Rebase>` o en el `customizeTable` de una tabla.

→ [Referencia de plugins](/docs/plugins)

### Slots

**Alcance:** app (aportado por slot).

Los slots son puntos de extensión de UI con nombre distribuidos por todo el chrome del CMS. Registras un componente de React apuntando al nombre de un slot y este se renderiza en esa ubicación. Hay 27 slots que cubren la página de inicio, la navegación, las vistas de colección, los formularios, las filas de entidad, los campos de formulario y la barra de la app —y cada uno de ellos se renderiza.

→ [Referencia de slots](/docs/frontend/slots)

### Reemplazos de componentes (Swizzling)

**Alcance:** valores predeterminados a nivel de app o por colección.

Dos modos: **Eject** (reemplazo completo) o **Wrap** (aumentar el original).

19 nombres de componentes reemplazables en dos niveles:

**Solo a nivel de app (7):**
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

**Precedencia:** Los `components` de una tabla se aplican sobre los valores predeterminados a nivel de app para el mismo nombre de componente: un reemplazo de colección sustituye a ambos, y un override de colección con `wrap: true` envuelve al de nivel de app. Los nombres de componentes exclusivos de la app (`Shell.*`, `HomePage`, `Auth.*`) solo se pueden reemplazar a nivel de `<Rebase>`.

→ [Reemplazos de componentes](/docs/frontend/component-overrides)

### Vistas de entidad (Entity Views)

**Alcance:** entidad (añade pestañas).

Vistas personalizadas que aparecen como pestañas en la página de detalle de la entidad. Se definen por tabla en `customizeTable`, o se registran una sola vez en `<Rebase entityViews>` (o `<RebaseCMS entityViews>`) y se referencian por `key` en el `entityViews` de una tabla.

→ [Vistas de entidad](/docs/frontend/entity-views)

### Acciones de entidad (Entity Actions)

**Alcance:** entidad.

Botones de acción personalizados en entidades individuales (publicar, archivar, clonar, etc.). Se definen por tabla en `customizeTable`, o se registran una vez en `<Rebase entityActions>` (o `<RebaseCMS entityActions>`) y se referencian por `key` en el `entityActions` de una tabla.

→ [Acciones de entidad](/docs/frontend/entity-actions)

### `Actions` de colección

**Alcance:** colección.

Componentes de React a nivel de barra de herramientas que reciben `CollectionActionsProps` (entidades seleccionadas, controlador de tabla, contexto de la colección). Se renderizan en la barra de herramientas de la colección junto a las acciones integradas.

**Relación con el slot `collection.actions`:** Ambos son aditivos: los componentes `Actions` se renderizan primero en la barra de herramientas, seguidos por las contribuciones del slot `collection.actions`. No se reemplazan entre sí.

→ [Acciones de entidad — Acciones de colección](/docs/frontend/entity-actions#collection-actions)

### Modos de vista personalizados

**Alcance:** colección (añade un modo de vista).

Un mapa, un calendario, una galería, una línea de tiempo: otra forma de renderizar *las mismas filas*, disponible en el selector de vistas de la colección junto a Lista, Tabla, Tarjetas y Tablero.

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

O registra el componente una vez y haz referencia a él por su clave (`key`):

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

`Builder` recibe el `tableController` en vivo, por lo que la vista hereda los filtros de la colección, el cuadro de búsqueda, la ordenación, la paginación, las comprobaciones de permisos y el panel lateral de la entidad; esa es toda la razón para declarar uno en lugar de construir una `AppView`:

```tsx
function MapView({ tableController, onRowClick }: CollectionCustomViewParams) {
    return <MapCanvas
        markers={tableController.rows.map(row => row.location)}
        onMarkerClick={i => onRowClick?.(tableController.rows[i])}
    />;
}
```

Las filas son las del servidor, con la misma estructura que devuelve `useRows`: fechas como cadenas ISO, un `belongsTo` como su columna de clave foránea y una relación que la vista cargó anidada bajo su nombre. Una fila tiene una columna `id` solo donde su tabla la tenga; su id está junto a ella, `tableController.ids[i]` para `tableController.rows[i]`. `highlightedIds` son los identificadores de las filas que la vista dibuja como seleccionadas, y `selectionController` también maneja identificadores y filas:

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

Al elegir la vista se actualiza `?__view=`, sobrevive a una recarga de página y persiste por usuario. Declarar una es suficiente para ofrecerla; solo es necesario configurar `enabledViews` cuando quieras *eliminar las vistas integradas*. Con una sola entrada, el selector queda oculto.

**Esta no es una forma de construir una vista que abarque varias colecciones.** Un modo de vista es otra renderización de la consulta de una sola colección. Si tu componente ignora `tableController` y consulta cuatro tablas por su cuenta, debería ser una [`AppView`](/docs/frontend#custom-views); de lo contrario, la barra de herramientas situada encima, con su cuadro de búsqueda y su conteo de registros, estaría describiendo una consulta que en realidad no renderiza.

### `formView`

**Alcance:** colección.

Reemplaza todo el formulario de entidad predeterminado por un componente personalizado, configurado con `formView: { Builder, includeActions }` en `customizeTable`; consulta [Reemplazar el formulario](/docs/frontend/form-layout/#replacing-the-form). `includeActions` (por defecto `true`) mantiene Guardar y Descartar en la barra.

Úsalo cuando necesites un diseño completamente personalizado para la edición de registros de una tabla. Para ajustes menores, es preferible usar el reemplazo de `Entity.Form` en `components`.

El Builder se renderiza dentro del formulario del registro y recibe su `formContext` en vivo: escribe con `formContext.setFieldValue`, y el botón Guardar de la barra almacenará el registro. Cuando el registro no se puede editar (la vista de detalle de solo lectura o un usuario sin permiso de edición), `formContext.disabled` es `true` y los intentos de escritura lanzan un error. Establece `includeActions: false` si tu Builder guarda por su cuenta mediante `formContext.submit()`.

### `additionalFields`

**Alcance:** colección.

Columnas calculadas que se muestran en la tabla de la colección. No se corresponden con columnas almacenadas: se calculan en el momento del renderizado.

→ [Columnas adicionales](/docs/frontend/additional-columns)

### `propertyConfigs`

**Alcance:** tipo de propiedad.

Tipos de campo reutilizables, registrados una sola vez en `<Rebase propertyConfigs>` y nombrados mediante el `propertyConfig` de un campo.

→ [Campos personalizados](/docs/frontend/custom-fields)

## Fuera del panel de administración

Si lo que quieres cambiar es lo que hace el servidor en lugar de lo que muestra el panel, esta no es la página adecuada. El servidor tiene su propia escala de mecanismos:

| Quiero… | Nivel | Referencia |
|---|---|---|
| Restringir qué filas devuelve una lectura | Hook `beforeQuery` | [Extender el servidor](/docs/backend/extending#2-table-hooks) |
| Ocultar un valor en la salida | Hook `afterRead` | [Hooks de tabla](/docs/collections/callbacks) |
| Añadir un endpoint propio | Función personalizada | [Funciones personalizadas](/docs/backend/custom-functions) |
| Hacer que la búsqueda encuentre subcadenas *y* normalice acentos | `search.mode: "hybrid"` | [Búsqueda](/docs/backend/search) |
| Tomar control del proceso del servidor | Servidor personalizado, luego `rebase eject` | [Extender el servidor](/docs/backend/extending) |

→ [Rebase no hace X](/docs/backend/extending)

## Resumen de precedencia

- **Los `components` de una tabla se aplican sobre los `components` globales** dentro de su colección. Un reemplazo de colección sustituye a ambos; un override de colección con `wrap: true` envuelve al override global cuando existe. Consulta [Reemplazos de componentes](/docs/frontend/component-overrides#when-both-scopes-override-a-component).
- **Las `Actions` de colección y el slot `collection.actions` son aditivos**: `Actions` se renderiza primero, seguido de las contribuciones del slot.
- **`entityActions` y `entityViews` a nivel de app son un registro, no valores por defecto:** una tabla solo muestra uno cuando su propio `entityActions` / `entityViews` en `customizeTable` especifica su `key`.
- **Los plugins se aplican en el orden del array `plugins`**, no por `key`. Las contribuciones de slots se renderizan según su propiedad `order` (los valores menores primero, 50 por defecto), y los empates conservan ese orden. Los envoltorios de campo (field wrappers) de varios plugins se componen en ese orden, siendo el del primer plugin el más interno. Consulta [Plugins](/docs/plugins#field-wrappers-from-several-plugins).
