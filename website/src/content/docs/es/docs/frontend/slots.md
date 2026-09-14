---
sourceHash: 24ecb93e6262aeca
title: Slots
sidebar_label: Slots
description: Referencia de todos los slots de puntos de extensión de UI disponibles en Rebase — ubicaciones con nombre donde puedes inyectar componentes personalizados.
---

## Descripción general

Los slots son puntos de extensión de UI con nombre donde puedes inyectar componentes personalizados de React. Cada slot cuenta con props tipadas específicas para su ubicación en la UI. Rebase incluye 29 slots integrados que cubren la página de inicio, navegación, vistas de colección, formularios de entidad, dashboards y más.

## Uso

### Mediante la prop `<Rebase>`

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

### Mediante plugin

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
| `navigation.header` | `NavigationSlotProps` | Debajo del logotipo en el drawer de la barra lateral |
| `navigation.footer` | `NavigationSlotProps` | Encima del control para colapsar en la parte inferior del drawer |

#### Vista de colección

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Acciones de la barra de herramientas del extremo final (después de las `Actions` de la colección) |
| `collection.actions.start` | `CollectionActionsProps` | Acciones de la barra de herramientas del extremo inicial (junto a los filtros) |
| `collection.header.action` | `CollectionHeaderActionProps` | Botones de acción en el encabezado de columna |
| `collection.add-column` | `CollectionAddColumnProps` | Área "Agregar columna" en el encabezado de la tabla |
| `collection.error` | `CollectionErrorProps` | Visualización del estado de error para una colección |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets adicionales dentro de la fila de la barra de herramientas de la colección |
| `collection.empty-state` | `CollectionEmptyStateProps` | Estado vacío personalizado cuando la colección no tiene datos |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets encima de la tabla de colección |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Barra lateral de filtros personalizada junto a la tabla. **Aún no se renderiza** — declarada, pero nada en el admin la renderiza actualmente. |

#### Entidad / Formulario

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Acciones en la barra de acciones del formulario de la entidad |
| `form.actions.top` | `PluginFormActionProps` | Acciones encima de la barra de acciones del formulario |
| `form.before` | `PluginFormActionProps` | Contenido antes del título/lista de campos del formulario |
| `form.after` | `PluginFormActionProps` | Contenido después de la lista de campos del formulario |
| `entity.row.actions` | `EntityRowActionsProps` | Acciones por fila en tablas de entidad. **Aún no se renderiza** — declarada, pero nada en el admin la renderiza actualmente. |
| `entity.field.before` | `EntityFieldSlotProps` | UI inyectada antes de un campo de formulario individual. **Aún no se renderiza** — declarada, pero nada en el admin la renderiza actualmente. |
| `entity.field.after` | `EntityFieldSlotProps` | UI inyectada después de un campo de formulario individual. **Aún no se renderiza** — declarada, pero nada en el admin la renderiza actualmente. |

#### Dashboard

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widgets en el dashboard/página de inicio. **Aún no se renderiza** — declarada, pero nada en el admin la renderiza actualmente. |

#### Global

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Componente de barra de búsqueda global entre colecciones. **Aún no se renderiza** — declarada, pero nada en el admin la renderiza actualmente. |
| `shell.toolbar` | `ShellToolbarProps` | Acciones de la barra de herramientas de nivel superior en la barra de la aplicación. **Aún no se renderiza** — declarada, pero nada en el admin la renderiza actualmente. |

#### Kanban

| Slot | Tipo de props | Descripción |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuración del tablero Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Agregar columna" en la vista Kanban |

## Referencia de props de los slots

Todos los tipos de props de los slots se exportan desde `@rebasepro/types` y se pueden importar para crear componentes de slot con seguridad de tipos:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Cada tipo de props proporciona acceso al contexto relevante para la ubicación del slot: metadatos de la colección, datos de la entidad, estado de navegación y más. Consulta las definiciones de tipos individuales para obtener todos los detalles de las propiedades.

## Relacionado

- [Component Overrides (Swizzling)](/docs/frontend/component-overrides/) — cuando un slot no es suficiente
- [Extender Rebase](/docs/frontend/extending/) — el resto de la superficie de extensión
- [Plugins](/docs/plugins/) — distribuir contenido de slots como un plugin
