---
title: Colecciones
sidebar_label: Colecciones
description: "Las colecciones son el componente fundamental de Rebase: cada colección se asigna a una tabla de base de datos y define su esquema, relaciones, seguridad y comportamiento de la interfaz de usuario."
---

## ¿Qué es una Colección?

Una **colección** es un objeto TypeScript que describe una tabla de base de datos y cómo debe aparecer en la interfaz de administración. Define:

- **Esquema** — Propiedades (columnas), sus tipos y reglas de validación
- **Relaciones** — Claves foráneas, tablas de unión y rutas de unión
- **Seguridad** — Políticas de Seguridad a Nivel de Fila
- **Comportamiento de la UI** — Modos de vista, edición en línea, vistas de entidad, acciones
- **Ganchos de ciclo de vida** — Callbacks para operaciones de creación, actualización, eliminación

```typescript
import { EntityCollection } from "@rebasepro/types";

export const productsCollection: EntityCollection = {
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name
    icon: "inventory_2",           // Material icon key

    properties: {
        name: {
            type: "string",
            name: "Product Name",
            validation: { required: true }
        },
        price: {
            type: "number",
            name: "Price",
            validation: { required: true, min: 0 }
        },
        category: {
            type: "string",
            name: "Category",
            enum: [
                { id: "electronics", label: "Electronics", color: "blueDark" },
                { id: "clothing", label: "Clothing", color: "pinkLight" },
                { id: "books", label: "Books", color: "orangeDark" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            multiline: true
        },
        active: {
            type: "boolean",
            name: "Active",
            defaultValue: true
        },
        created_at: {
            type: "date",
            name: "Created At",
            autoValue: "on_create",
            readOnly: true
        }
    }
};
```

## Propiedades Clave

### Identificación

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `slug` | `string` | **Requerido.** Identificador seguro para URL. Usado en la URL de la UI de administración y la ruta de la API REST (`/api/data/{slug}`). |
| `name` | `string` | **Requerido.** Nombre de visualización (plural). Se muestra en la navegación y los encabezados de página. |
| `singularName` | `string` | Nombre de visualización para una sola entidad. Usado en "Nuevo Producto", "Editar Producto", etc. |
| `table` | `string` | **Requerido.** Nombre de la tabla PostgreSQL. Si es diferente de `slug`, permite desacoplar las URLs de los nombres de las tablas. |
| `icon` | `string` | Clave del icono de Material Design. Ver [Google Fonts Icons](https://fonts.google.com/icons). |

### Esquema

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `properties` | `Properties` | **Requerido.** Mapa de clave de propiedad → definición de propiedad. Cada clave se convierte en una columna de la base de datos. |
| `relations` | `Relation[]` | Relaciones SQL — claves foráneas, tablas de unión. Ver [Relaciones](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Seguridad a Nivel de Fila. Ver [Reglas de Seguridad](/docs/collections/security-rules). |

### Configuración de la UI

| Propiedad | Tipo | Predeterminado | Descripción |
|----------|------|---------|-------------|
| `defaultViewMode` | `"list" \| "table" \| "cards" \| "kanban"` | `"table"` | Modo de vista predeterminado |
| `enabledViews` | `ViewMode[]` | Las cuatro | Qué modos de vista están disponibles |
| `kanban` | `KanbanConfig` | — | Configuración de Kanban (propiedad de columna) |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split"` | `"full_screen"` | Cómo se abren las entidades para editar |
| `sideDialogWidth` | `number \| string` | — | Ancho del diálogo lateral |
| `inlineEditing` | `boolean` | `true` | Habilitar edición en línea en la vista de hoja de cálculo |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | `"m"` | Altura predeterminada de la fila en la tabla |
| `pagination` | `boolean \| number` | `true` (50) | Habilitar paginación y/o establecer el tamaño de página |
| `listProperties` | `string[]` | — | Propiedades a mostrar en la vista de lista |
| `propertiesOrder` | `string[]` | — | Orden de las columnas en la vista de tabla |
| `selectionEnabled` | `boolean` | `true` | Habilitar selección de filas |
| `hideFromNavigation` | `boolean` | `false` | Ocultar de la navegación de la barra lateral |
| `defaultSelectedView` | `string \| function` | — | Vista o subcolección predeterminada a abrir |

### Opciones de Entidad

| Propiedad | Tipo | Predeterminado | Descripción |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Auto-guardar al cambiar de campo |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Realizar copia de seguridad de cambios no guardados |
| `hideIdFromForm` | `boolean` | `false` | Ocultar el ID de la entidad del formulario |
| `hideIdFromCollection` | `boolean` | `false` | Ocultar la columna ID de la tabla |
| `includeJsonView` | `boolean` | `false` | Mostrar una pestaña JSON en la vista de entidad |
| `history` | `boolean` | `false` | Rastrear cambios en el historial de la entidad |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Aplicar valores predeterminados en cada guardado |
| `previewProperties` | `string[]` | — | Propiedades a mostrar en las vistas previas de referencia |
| `titleProperty` | `string` | — | Propiedad a usar como título de la entidad |

### Avanzado

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `callbacks` | `EntityCallbacks` | Ganchos de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `entityActions` | `EntityAction[]` | Acciones personalizadas sobre entidades (archivar, publicar, etc.) |
| `Actions` | `React.ComponentType` | Componente de acciones de barra de herramientas personalizado |
| `entityViews` | `EntityCustomView[]` | Pestañas personalizadas en la vista de detalle de la entidad |
| `additionalFields` | `AdditionalFieldDelegate[]` | Columnas calculadas/virtuales |
| `childCollections` | `() => EntityCollection[]` | Colecciones hijas anidadas |
| `subcollections` | `() => EntityCollection[]` | Colecciones anidadas (p. ej., pedido → artículos de línea) |
| `exportable` | `boolean \| ExportConfig` | Habilitar exportación de datos |
| `ownerId` | `string` | ID de usuario propietario (usado por plugins/código personalizado) |
| `overrides` | `EntityOverrides` | Anulaciones para la vista de entidad |
| `driver` | `string` | Driver de base de datos a usar (predeterminado: `"(default)"`) |
| `databaseId` | `string` | ID de base de datos/esquema dentro del driver |

## Constructor de Colecciones

Para colecciones dinámicas que cambian según el usuario o datos externos, use una función constructora:

```typescript
const collectionsBuilder: EntityCollectionsBuilder = ({ user, authController }) => {
    const collections = [productsCollection];

    if (authController.extra?.role === "admin") {
        collections.push(adminSettingsCollection);
    }

    return collections;
};
```

## Filtrado y Ordenación

Puede establecer filtros predeterminados o forzados:

```typescript
{
    // Default filter — users can change it
    filter: { active: ["==", true] },

    // Forced filter — cannot be changed
    forceFilter: { tenant_id: ["==", currentTenantId] },

    // Default sort
    sort: ["created_at", "desc"]
}
```

## Próximos Pasos

- **[Callbacks de Entidad](/docs/collections/callbacks)** — Ganchos de ciclo de vida para sincronizar datos entre colecciones, validación, efectos secundarios
- **[Propiedades](/docs/collections/properties)** — Todos los tipos y opciones de propiedades
- **[Relaciones](/docs/collections/relations)** — Claves foráneas, tablas de unión, uniones
- **[Reglas de Seguridad](/docs/collections/security-rules)** — Seguridad a Nivel de Fila
- **[Modos de Vista](/docs/frontend/view-modes)** — Lista, Tabla, Tarjetas, Kanban

---
