---
title: Modos de Vista
sidebar_label: Modos de Vista
slug: es/docs/frontend/view-modes
description: Configure vistas de tabla, tarjetas y tablero Kanban para sus colecciones.
---

## Resumen

Cada colección puede mostrarse en cuatro modos de vista:

- **Lista** — Vista de lista simple y limpia (el valor predeterminado clásico del CMS)
- **Tabla** — Cuadrícula estilo hoja de cálculo con edición en línea, clasificación, filtrado
- **Tarjetas** — Cuadrícula de tarjetas para contenido visual (imágenes, previsualizaciones)
- **Kanban** — Tablero de arrastrar y soltar agrupado por una propiedad de enumeración

## Configuración

```typescript
const productsCollection: EntityCollection = {
    slug: "products",
    defaultViewMode: "table",            // Vista predeterminada
    enabledViews: ["list", "table", "kanban"],    // Vistas disponibles
    kanban: {
        columnProperty: "status",        // Propiedad de enumeración para columnas
        orderProperty: "sort_order"      // Propiedad para el ordenamiento de arrastrar y soltar
    },
    // ...
};
```

## Vista de Lista

![Marcador de posición de la captura de pantalla de la Vista de Lista](/img/features/list-view.png)

La vista de lista es el modo de vista predeterminado clásico y limpio del CMS, que muestra las entidades en un formato de lista directo sin la densidad de una hoja de cálculo.

## Vista de Tabla

![Marcador de posición de la captura de pantalla de la Vista de Tabla](/img/features/table-view.png)

La vista predeterminada es una hoja de cálculo virtualizada de alto rendimiento con:

- **Edición en línea** — Haga clic en cualquier celda para editar in situ
- **Redimensionamiento de columnas** — Arrastre los encabezados de las columnas
- **Reordenación de columnas** — Arrastre para reorganizar
- **Clasificación** — Haga clic en los encabezados de las columnas
- **Búsqueda de texto** — Búsqueda de texto completo en campos de cadena
- **Filtrado** — Filtros por columna
- **Selección múltiple** — Seleccione entidades para acciones masivas

### Altura de Fila

Controle la altura de la fila con `defaultSize`:

| Tamaño | Píxeles | Ideal para |
|------|--------|----------|
| `"xs"` | 40 | Tablas de datos densos |
| `"s"` | 54 | Predeterminado |
| `"m"` | 80 | Con miniaturas de imágenes |
| `"l"` | 120 | Tarjetas con previsualizaciones |
| `"xl"` | 260 | Previsualizaciones de contenido enriquecido |

## Vista Kanban

![Marcador de posición de la captura de pantalla de la Vista Kanban](/img/features/kanban-view.png)

Configure un tablero Kanban especificando qué propiedad de enumeración usar como columnas:

```typescript
const tasksCollection: EntityCollection = {
    slug: "tasks",
    defaultViewMode: "kanban",
    kanban: {
        columnProperty: "status",
        orderProperty: "sort_order"
    },
    properties: {
        title: { type: "string", name: "Título" },
        status: {
            type: "string",
            name: "Estado",
            enum: [
                { id: "backlog", label: "Pendientes", color: "grayDark" },
                { id: "in_progress", label: "En Progreso", color: "blueDark" },
                { id: "review", label: "Revisión", color: "orangeDark" },
                { id: "done", label: "Hecho", color: "greenDark" }
            ]
        },
        sort_order: { type: "number", name: "Orden de Clasificación" }
    }
};
```

Arrastrar y soltar entre columnas actualiza automáticamente el campo de enumeración y el orden de clasificación.

## Vista de Tarjetas

![Marcador de posición de la captura de pantalla de la Vista de Tarjetas](/img/features/cards-view.png)

Las tarjetas muestran las entidades como tarjetas visuales — útiles para contenido con muchas imágenes:

```typescript
const articlesCollection: EntityCollection = {
    slug: "articles",
    defaultViewMode: "cards",
    properties: {
        title: { type: "string", name: "Título" },
        cover: {
            type: "string",
            name: "Imagen de Portada",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    }
};
```

## Próximos Pasos

- **[Vistas de Entidad](/docs/frontend/entity-views)** — Pestañas personalizadas en formularios de entidad
- **[Acciones de Entidad](/docs/frontend/entity-actions)** — Acciones de entidad personalizadas

---
