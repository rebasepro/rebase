---
sourceHash: f3f10a71f8d6c351
title: Slots
sidebar_label: Slots
description: Referencia para todos los slots de puntos de extensión de la interfaz de usuario disponibles en Rebase — ubicaciones con nombre donde puedes inyectar componentes personalizados.
---

## Descripción general

Los slots son puntos de extensión de la interfaz de usuario con nombre donde puedes inyectar componentes React personalizados. Cada slot tiene props tipadas específicas para su ubicación en la interfaz de usuario. Rebase incluye 27 slots integrados que cubren la página de inicio, navegación, vistas de colección, formularios de entidad, la barra de aplicaciones y más.

Todos los slots en la tabla a continuación se renderizan. Si registras un componente para uno y no ves nada, el fallo está en tu componente o en sus props, no en el slot — `UNRENDERED_SLOTS` en `@rebasepro/cms-types` está vacío, y una prueba deriva esa lista escaneando los sitios de renderizado, por lo que un slot no puede declararse aquí sin uno de nuevo.

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

| Slot | Props Type | Descripción |
|------|-----------|-------------|
| `home.actions` | `PluginGenericProps` | Acciones en el encabezado de la página de inicio |
| `home.cards` | `PluginHomePageAdditionalCardsProps` | Tarjetas adicionales en la página de inicio |
| `home.children.start` | `PluginGenericProps` | Contenido al inicio de la página de inicio |
| `home.children.end` | `PluginGenericProps` | Contenido al final de la página de inicio |
| `home.card.widget` | `HomeCardWidgetSlotProps` | Widget compacto dentro de una tarjeta de colección de la página de inicio |
| `home.collection.actions` | `PluginHomePageActionsProps` | Acciones en las tarjetas de colección de la página de inicio |

#### Navegación

| Slot | Props Type | Descripción |
|------|-----------|-------------|
| `navigation.header` | `NavigationSlotProps` | Debajo del logotipo en el panel lateral (drawer) |
| `navigation.footer` | `NavigationSlotProps` | Encima del botón para colapsar en la parte inferior del panel lateral |

#### Vista de colección

| Slot | Props Type | Descripción |
|------|-----------|-------------|
| `collection.actions` | `CollectionActionsProps` | Acciones de la barra de herramientas del extremo final (después de las `Actions` de la colección) |
| `collection.actions.start` | `CollectionActionsProps` | Acciones de la barra de herramientas del extremo inicial (junto a los filtros) |
| `collection.header.action` | `CollectionHeaderActionProps` | Botones de acción del encabezado de columna |
| `collection.add-column` | `CollectionAddColumnProps` | Área "Agregar columna" en el encabezado de la tabla |
| `collection.error` | `CollectionErrorProps` | Visualización del estado de error para una colección |
| `collection.toolbar` | `CollectionToolbarProps` | Widgets adicionales dentro de la fila de la barra de herramientas de la colección |
| `collection.empty-state` | `CollectionEmptyStateProps` | Estado vacío personalizado cuando la colección no tiene datos |
| `collection.widgets` | `CollectionWidgetsSlotProps` | Widgets encima de la tabla de la colección |

#### Entidad / Formulario

| Slot | Props Type | Descripción |
|------|-----------|-------------|
| `form.actions` | `PluginFormActionProps` | Acciones en la barra de acciones del formulario de la entidad |
| `form.actions.top` | `PluginFormActionProps` | Acciones encima de la barra de acciones del formulario |
| `form.before` | `PluginFormActionProps` | Contenido antes del título del formulario/lista de campos |
| `form.after` | `PluginFormActionProps` | Contenido después de la lista de campos del formulario |
| `entity.row.actions` | `EntityRowActionsProps` | <span class="since-badge" data-since="0.22">Desde 0.22</span> Acciones por fila en tablas de colección, junto a las herramientas de fila integradas |
| `entity.field.before` | `EntityFieldSlotProps` | <span class="since-badge" data-since="0.22">Desde 0.22</span> Interfaz inyectada antes de un campo de formulario individual |
| `entity.field.after` | `EntityFieldSlotProps` | <span class="since-badge" data-since="0.22">Desde 0.22</span> Interfaz inyectada después de un campo de formulario individual |

#### Global / Shell

| Slot | Props Type | Descripción |
|------|-----------|-------------|
| `global.search` | `GlobalSearchProps` | <span class="since-badge" data-since="0.22">Desde 0.22</span> Búsqueda entre colecciones, en la barra de aplicaciones junto a las migas de pan |
| `shell.toolbar` | `ShellToolbarProps` | <span class="since-badge" data-since="0.22">Desde 0.22</span> Acciones de nivel superior, al final de la barra de aplicaciones |

:::note
Para un widget en la página de inicio, usa `home.children.start`, `home.children.end`,
`home.cards` o `home.card.widget` — esas son las cuatro posiciones de la página de inicio.
No existe `dashboard.widget`: solo tomaba el contexto, por lo que no designaba ninguna
posición en una página que ya tenía cuatro.

Para la interfaz de filtros junto a una tabla, usa `collection.toolbar` o
`collection.widgets`. No existe `collection.filter-panel`: el panel de administración no tiene
una barra lateral de filtros en la que pueda renderizarse.
:::

#### Kanban

| Slot | Props Type | Descripción |
|------|-----------|-------------|
| `kanban.setup` | `KanbanSetupProps` | Interfaz de configuración del tablero kanban |
| `kanban.add-column` | `KanbanAddColumnProps` | "Agregar columna" en la vista kanban |

## Referencia de las props de slots

Todos los tipos de props de slots se exportan desde `@rebasepro/types` y se pueden importar para obtener componentes de slots con seguridad de tipos:

```typescript
import type { CollectionActionsProps, NavigationSlotProps } from "@rebasepro/cms-types";
```

Cada tipo de props proporciona acceso al contexto relevante para la ubicación del slot: metadatos de colección, datos de entidad, estado de navegación y más. Consulta las definiciones de tipos individuales para ver los detalles completos de las propiedades.

## Relacionado

- [Component Overrides (Swizzling)](/docs/frontend/component-overrides/) — cuando un slot no es suficiente
- [Extending Rebase](/docs/frontend/extending/) — el resto de la superficie de extensión
- [Plugins](/docs/plugins/) — distribuir contenido de slots como un plugin
