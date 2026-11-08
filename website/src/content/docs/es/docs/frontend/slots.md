---
sourceHash: 35cdc0483d3f3fd4
title: Slots
sidebar_label: Slots
description: Referencia de todos los slots de puntos de extensión de la UI disponibles en Rebase — ubicaciones con nombre donde puedes inyectar componentes personalizados.
---

## Descripción general

Los slots son puntos de extensión de la interfaz de usuario con nombre donde puedes inyectar componentes de React personalizados. Cada slot tiene props tipadas específicas de su ubicación en la UI. Rebase incluye 27 slots integrados que abarcan la página de inicio, la navegación, las vistas de colecciones, los formularios de entidades, la barra de aplicaciones y más.

Cada slot de la tabla siguiente se renderiza. Si registras un componente para uno de ellos y no ves nada, el error está en tu componente o en sus props, no en el slot — `UNRENDERED_SLOTS` en `@rebasepro/cms-types` está vacío, y una prueba genera esa lista escaneando los puntos de renderizado, por lo que un slot no puede declararse aquí sin tener uno asignado.

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
`order` controla el orden de renderizado — los valores más bajos se renderizan primero. El valor predeterminado es `50`.
:::

## Slots disponibles

#### Página de inicio

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Acciones en el encabezado de la página de inicio |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Tarjetas adicionales en la página de inicio |
| `home.children.start` | `PluginGenericProps` | Contenido al inicio de la página de inicio |
| `home.children.end` | `PluginGenericProps` | Contenido al final de la página de inicio |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compacto dentro de una tarjeta de colección de la página de inicio |
| `home.collection.actions` | `PluginHomePageActionsProps` | Acciones en las tarjetas de colección de la página de inicio |

#### Navegación

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Debajo del logotipo en el panel lateral |
| `navigation.footer` | `NavigationSlotProps` | Encima del botón para colapsar en la parte inferior del panel lateral |

#### Vista de colección

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Acciones de la barra de herramientas del lado final (después de las `Actions` de la colección) |
| `collection.actions.start` | `CollectionActionsProps` | Acciones de la barra de herramientas del lado inicial (junto a los filtros) |
| `collection.header.action` | `CollectionHeaderActionProps` | Botones de acción en el encabezado de columna |
| `collection.add-column` | `CollectionAddColumnProps` | Área "Add column" en el encabezado de la tabla |
| `collection.error` | `CollectionErrorProps` | Visualización del estado de error para una colección |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets adicionales dentro de la fila de la barra de herramientas de la colección |
| `collection.empty-state` | `CollectionEmptyStateProps` | Estado vacío personalizado cuando la colección no tiene datos |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets encima de la tabla de la colección |

Cuando a un slot de colección se le pasa el `tableController` o el
`selectionController` de la vista, estos manejan las filas tal como las envía el servidor:
`tableController.rows` (con `loading`, `error` y el filtro,
búsqueda y ordenación de la barra de herramientas), y una selección por id — `selection` es
`{ type: "rows", ids, rows }` o `{ type: "query", query, excludedIds, count }`,
y `isSelected(id)` consulta sobre una sola fila.

#### Entidad / Formulario

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Acciones en la barra de acciones del formulario de la entidad. Recibe el `id` del registro (ausente mientras sea nuevo), `path`, `status`, `collection` y `formContext` |
| `form.actions.top` | `PluginFormActionProps` | Acciones encima de la barra de acciones del formulario |
| `form.before` | `PluginFormActionProps` | Contenido antes del título o lista de campos del formulario |
| `form.after` | `PluginFormActionProps` | Contenido después de la lista de campos del formulario |
| `entity.row.actions` | `EntityRowActionsProps` | Acciones por fila en las tablas de colección, junto a las herramientas de fila integradas. Recibe la fila tal como la envía el servidor (`row`), su `id`, `path`, `collection`, el `selectionController` de la tabla y `context` |
| `entity.field.before` | `EntityFieldSlotProps` | UI inyectada antes de un campo de formulario individual. Recibe el `propertyKey` y `property` del campo, y el `path` e `id` del registro (ausente mientras sea nuevo) |
| `entity.field.after` | `EntityFieldSlotProps` | UI inyectada después de un campo de formulario individual |

#### Global / Shell

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Búsqueda entre colecciones, en la barra de aplicaciones junto a las migas de pan |
| `shell.toolbar` | `ShellToolbarProps` | Acciones de nivel superior, al final de la barra de aplicaciones |

:::note
Para un widget en la página de inicio, utiliza `home.children.start`, `home.children.end`,
`home.cards` o `home.card.widget` — esas son las cuatro posiciones de la página de inicio.
No existe `dashboard.widget`: solo recibía el contexto, por lo que no indicaba ninguna
posición en una página que ya contaba con cuatro.

Para la UI de filtros junto a una tabla, utiliza `collection.toolbar` o
`collection.widgets`. No existe `collection.filter-panel`: el panel de administración no tiene una
barra lateral de filtros en la que pueda renderizarse.
:::

#### Kanban

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuración del tablero kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Add column" en la vista kanban |

## Referencia de Props de Slots

Todos los tipos de props de slots se exportan desde `@rebasepro/cms-types` y se pueden importar para crear componentes de slot con seguridad de tipos:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Cada tipo de props brinda acceso al contexto relevante para la ubicación del slot: metadatos de la colección, datos de la entidad, estado de la navegación y más. Consulta las definiciones de tipos individuales para conocer todos los detalles de sus propiedades.

## Relacionado

- [Sustituciones de componentes (Swizzling)](/docs/frontend/component-overrides/) — cuando un slot no es suficiente
- [Extender Rebase](/docs/frontend/extending/) — el resto de la superficie de extensión
- [Plugins](/docs/plugins/) — distribuir contenido de slots como un plugin
