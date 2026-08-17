---
title: Slots
sidebar_label: Slots
description: Referencia de todos los slots de puntos de extensión de UI disponibles en Rebase — ubicaciones con nombre donde puede inyectar componentes personalizados.
---

## Resumen

Los slots son puntos de extensión de UI con nombre donde puede inyectar componentes React personalizados. Cada slot tiene props tipadas específicas de su ubicación en la UI. Rebase incluye 29 slots integrados que cubren la página de inicio, la navegación, las vistas de colección, los formularios de entidad, los dashboards y más.

## Uso

### A través de la prop `<Rebase>`

```tsx
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

## Slots Disponibles

#### Página de Inicio

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Acciones en la cabecera de la página de inicio |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Tarjetas adicionales en la página de inicio |
| `home.children.start` | `PluginGenericProps` | Contenido al principio de la página de inicio |
| `home.children.end` | `PluginGenericProps` | Contenido al final de la página de inicio |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compacto dentro de una tarjeta de colección de la página de inicio |
| `home.collection.actions` | `PluginHomePageActionsProps` | Acciones en las tarjetas de colección de la página de inicio |

#### Navegación

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Debajo del logo en el cajón de la barra lateral |
| `navigation.footer` | `NavigationSlotProps` | Encima del interruptor de colapso en la parte inferior del cajón |

#### Vista de Colección

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Acciones de la barra de herramientas del lado final (después de `Actions` de colección) |
| `collection.actions.start` | `CollectionActionsProps` | Acciones de la barra de herramientas del lado inicial (junto a los filtros) |
| `collection.header.action` | `CollectionHeaderActionProps` | Botones de acción de las cabeceras de columna |
| `collection.add-column` | `CollectionAddColumnProps` | Área "Añadir columna" en la cabecera de la tabla |
| `collection.error` | `CollectionErrorProps` | Visualización del estado de error de una colección |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets adicionales dentro de la fila de la barra de herramientas de la colección |
| `collection.empty-state` | `CollectionEmptyStateProps` | Estado vacío personalizado cuando la colección no tiene datos |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets sobre la tabla de la colección |
| `collection.filter-panel` | `CollectionFilterPanelProps` | Barra lateral de filtros personalizada junto a la tabla. **Todavía no se renderiza** — declarada, pero hoy nada en el panel la renderiza. |

#### Entidad / Formulario

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Acciones en la barra de acciones del formulario de entidad |
| `form.actions.top` | `PluginFormActionProps` | Acciones encima de la barra de acciones del formulario |
| `form.before` | `PluginFormActionProps` | Contenido antes del título/lista de campos del formulario |
| `form.after` | `PluginFormActionProps` | Contenido después de la lista de campos del formulario |
| `entity.row.actions` | `EntityRowActionsProps` | Acciones por fila en las tablas de entidades. **Todavía no se renderiza** — declarada, pero hoy nada en el panel la renderiza. |
| `entity.field.before` | `EntityFieldSlotProps` | UI inyectada antes de un campo de formulario individual. **Todavía no se renderiza** — declarada, pero hoy nada en el panel la renderiza. |
| `entity.field.after` | `EntityFieldSlotProps` | UI inyectada después de un campo de formulario individual. **Todavía no se renderiza** — declarada, pero hoy nada en el panel la renderiza. |

#### Dashboard

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `dashboard.widget` | `DashboardWidgetProps` | Widgets en el dashboard/página de inicio. **Todavía no se renderiza** — declarada, pero hoy nada en el panel la renderiza. |

#### Global

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | Componente de barra de búsqueda entre colecciones. **Todavía no se renderiza** — declarada, pero hoy nada en el panel la renderiza. |
| `shell.toolbar` | `ShellToolbarProps` | Acciones de la barra de herramientas de nivel superior en la barra de app. **Todavía no se renderiza** — declarada, pero hoy nada en el panel la renderiza. |

#### Kanban

| Slot | Tipo de Props | Descripción |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | UI de configuración del tablero Kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Añadir columna" en la vista kanban |

## Referencia de Props de los Slots

Todos los tipos de props de los slots se exportan desde `@rebasepro/types` y pueden importarse para componentes de slot con seguridad de tipos:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/admin-types";
```

Cada tipo de props proporciona acceso al contexto relevante para la ubicación del slot — metadatos de colección, datos de entidad, estado de navegación y más. Consulte las definiciones de tipos individuales para conocer todos los detalles de las propiedades.
