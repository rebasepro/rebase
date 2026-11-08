---
sourceHash: 02aa0ee46111d905
title: Slots
sidebar_label: Slots
description: Referencia para todos los slots de puntos de extensión de la interfaz de usuario disponibles en Rebase — ubicaciones con nombre donde puedes inyectar componentes personalizados.
---

## Información general

Los slots son puntos de extensión con nombre en la interfaz de usuario donde puedes inyectar componentes React personalizados. Cada slot tiene props tipadas específicas para su ubicación en la UI. Rebase incluye 27 slots integrados que abarcan la página de inicio, la navegación, las vistas de colecciones, los formularios de entidades, la barra de la aplicación y más.

Cada slot de la siguiente tabla se renderiza. Si registras un componente para uno de ellos y no ves nada, el fallo está en tu componente o en sus props, no en el slot: `UNRENDERED_SLOTS` en `@rebasepro/cms-types` está vacío, y una prueba obtiene esa lista buscando puntos de renderizado, por lo que no es posible declarar un slot aquí sin tener uno.

## Uso

### A través de la prop `<Rebase>`

```tsx no-verify
<Rebase
    client={client}
    slots={[
        {
            slot: "navigation.footer",
            Component: MyNavigationFooter,
            order: 10
        },
        {
            slot: "collection.actions",
            Component: BulkExportButton
        }
    ]}
>
```

### A través de un plugin

```typescript
const myPlugin: RebasePlugin = {
    key: "my-plugin",
    slots: [
        {
            slot: "home.cards",
            Component: AnalyticsCard,
            order: 20
        }
    ]
};
```

:::note
`order` controla el orden de renderizado: los valores más bajos se renderizan primero. El valor predeterminado es `50`.
:::

## Slots disponibles

#### Página de inicio

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Acciones en el encabezado de la página de inicio |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Tarjetas adicionales en la página de inicio |
| `home.children.start` | `PluginGenericProps` | Contenido al inicio de la página de inicio |
| `home.children.end` | `PluginGenericProps` | Contenido al final de la página de inicio |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compacto dentro de una tarjeta de colección de la página de inicio |
| `home.collection.actions` | `PluginHomePageActionsProps` | Acciones en las tarjetas de colección de la página de inicio |

#### Navegación

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Debajo del logotipo en el panel lateral de navegación |
| `navigation.footer` | `NavigationSlotProps` | Encima del control para colapsar en la parte inferior del panel lateral |

#### Vista de colección

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Acciones de la barra de herramientas del lado final (después de `Actions` de la colección) |
| `collection.actions.start` | `CollectionActionsProps` | Acciones de la barra de herramientas del lado inicial (junto a los filtros) |
| `collection.header.action` | `CollectionHeaderActionProps` | Botones de acción en el encabezado de columna |
| `collection.add-column` | `CollectionAddColumnProps` | Área de "Añadir columna" en el encabezado de la tabla |
| `collection.error` | `CollectionErrorProps` | Visualización del estado de error para una colección |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets adicionales dentro de la fila de la barra de herramientas de la colección |
| `collection.empty-state` | `CollectionEmptyStateProps` | Estado vacío personalizado cuando la colección no tiene datos |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets encima de la tabla de la colección |

Cuando a un slot de colección se le pasa el `tableController` o el
`selectionController` de la vista, estos manejan las filas tal como las envía el servidor:
`tableController.rows` (con sus ids en las mismas posiciones en
`tableController.ids`, `loading`, `error` y el filtro, búsqueda y
ordenamiento de la barra de herramientas), y una selección por id — `selection` es
`{ type: "rows", ids, rows }` o `{ type: "query", query, excludedIds, count }`,
y `isSelected(id)` consulta sobre una fila específica.

#### Entidad / Formulario

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Acciones en la barra de acciones del formulario de la entidad. Recibe el `id` del registro (ausente mientras sea nuevo), `path`, `status`, `collection` y `formContext` |
| `form.actions.top` | `PluginFormActionProps` | Acciones encima de la barra de acciones del formulario |
| `form.before` | `PluginFormActionProps` | Contenido antes del título/lista de campos del formulario |
| `form.after` | `PluginFormActionProps` | Contenido después de la lista de campos del formulario |
| `entity.row.actions` | `EntityRowActionsProps` | Acciones por fila en tablas de colección, junto a las herramientas de fila integradas. Recibe la fila tal como la envía el servidor (`row`), su `id`, `path`, `collection`, el `selectionController` de la tabla y `context` |
| `entity.field.before` | `EntityFieldSlotProps` | UI inyectada antes de un campo de formulario individual. Recibe el `propertyKey` y `property` del campo, y el `path` e `id` del registro (ausente mientras sea nuevo) |
| `entity.field.after` | `EntityFieldSlotProps` | UI inyectada después de un campo de formulario individual |

#### Global / Shell

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Búsqueda entre colecciones, en la barra de la aplicación junto a las migas de pan |
| `shell.toolbar` | `ShellToolbarProps` | Acciones de nivel superior, al final de la barra de la aplicación |

:::note
Para un widget en la página de inicio, usa `home.children.start`, `home.children.end`,
`home.cards` o `home.card.widget` — esas son las cuatro posiciones de la página de inicio.
No existe `dashboard.widget`: solo recibía el contexto, por lo que no definía ninguna
posición en una página que ya tenía cuatro.

Para la interfaz de filtros junto a una tabla, usa `collection.toolbar` o
`collection.widgets`. No existe `collection.filter-panel`: el panel de administración no tiene
una barra lateral de filtros en la que pueda renderizarse.
:::

#### Kanban

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuración del tablero Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Añadir columna" en la vista kanban |

## Referencia de props de slots

Todos los tipos de props de los slots se exportan desde `@rebasepro/cms-types` y se pueden importar para crear componentes de slots con seguridad de tipos:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Cada tipo de props proporciona acceso al contexto relevante para la ubicación del slot: metadatos de la colección, datos de la entidad, estado de navegación y más. Consulta las definiciones de tipos individuales para ver todos los detalles de las propiedades.

## Relacionado

- [Sobrescritura de componentes (Swizzling)](/docs/frontend/component-overrides/) — cuando un slot no es suficiente
- [Extender Rebase](/docs/frontend/extending/) — el resto de la superficie de extensión
- [Plugins](/docs/plugins/) — distribuir contenido de slots como un plugin
