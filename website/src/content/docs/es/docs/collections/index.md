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
import { defineCollection } from "@rebasepro/admin-types";

export const productsCollection = defineCollection({
    slug: "products",              // URL path and API endpoint
    name: "Products",              // Display name (plural)
    singularName: "Product",       // Display name (singular)
    table: "products",            // PostgreSQL table name

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
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "pink" },
                { id: "books", label: "Books", color: "orange" }
            ]
        },
        description: {
            type: "string",
            name: "Description",
            admin: { multiline: true }
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
    },
    admin: {
        icon: "inventory_2"           // Material icon key
    }
});

```

## Declarar una: `defineCollection`

Envuelve el literal en `defineCollection`. En tiempo de ejecución es la función identidad — devuelve el objeto sin cambios — así que no cuesta nada. Lo que aporta es inferencia: un parámetro de tipo `const` captura las claves de `properties` como tipos literales, que es lo que las lleva al autocompletado del editor para `admin.display`, `admin.sort` y `admin.propertiesOrder`.

```typescript
import { defineCollection } from "@rebasepro/admin-types";

const products = defineCollection({
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" },
        price: { name: "Price", type: "number" }
    },
    admin: {
        display: { title: "name" },   // autocompletado: "name" | "price"
        sort: ["price", "asc"]   // autocompletado en el primer elemento
    }
});
```

Impórtala desde `@rebasepro/admin-types` en un proyecto con panel de administración — esa es la copia que además comprueba el bloque `admin`. Un proyecto BaaS headless, sin bloque `admin` ni React, importa la misma función desde `@rebasepro/common`.

Anotar el tipo directamente sigue funcionando y sigue comprobándose:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

const products: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: {
        name: { name: "Name", type: "string" }
    }
};
```

Pero una anotación solo *valida* el objeto — no puede ver los nombres de tus propiedades, así que no obtienes autocompletado. Prefiere `defineCollection` salvo que necesites nombrar el tipo.

:::note
`buildCollection` y `buildProperty` ya no existen. `buildCollection` es `defineCollection` sin la inferencia; `buildProperty` envolvía una propiedad en un tipo que ya tenía. Consulta el [changelog](/docs/changelog) para la migración de una línea.
:::

## Propiedades Clave

### Identificación

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `slug` | `string` | **Requerido.** Identificador seguro para URL. Usado en la URL de la UI de administración y la ruta de la API REST (`/api/data/{slug}`). |
| `name` | `string` | **Requerido.** Nombre de visualización (plural). Se muestra en la navegación y los encabezados de página. |
| `singularName` | `string` | Nombre de visualización para una sola entidad. Usado en "Nuevo Producto", "Editar Producto", etc. |
| `table` | `string` | **Requerido.** Nombre de la tabla PostgreSQL. Si es diferente de `slug`, permite desacoplar las URLs de los nombres de las tablas. |
| `admin.icon` | `string` | Clave del icono de Material Design. Ver [Google Fonts Icons](https://fonts.google.com/icons). |

### Esquema

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `properties` | `Properties` | **Requerido.** Mapa de clave de propiedad → definición de propiedad. Cada clave se convierte en una columna de la base de datos. |
| `relations` | `Relation[]` | Relaciones SQL — claves foráneas, tablas de unión. Ver [Relaciones](/docs/collections/relations). |
| `securityRules` | `SecurityRule[]` | Políticas de Seguridad a Nivel de Fila. Ver [Reglas de Seguridad](/docs/collections/security-rules). |

### Configuración de la UI

Todos los siguientes van dentro de `admin`.

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

Dentro de `admin`, excepto `history`, que es una función del backend y permanece en el nivel superior.

| Propiedad | Tipo | Predeterminado | Descripción |
|----------|------|---------|-------------|
| `formAutoSave` | `boolean` | `false` | Auto-guardar al cambiar de campo |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Realizar copia de seguridad de cambios no guardados |
| `hideIdFromForm` | `boolean` | `false` | Ocultar el ID de la entidad del formulario |
| `hideIdFromCollection` | `boolean` | `false` | Ocultar la columna ID de la tabla |
| `includeJsonView` | `boolean` | `true` | Ofrecer los valores en bruto en el inspector del registro |
| `history` | `boolean` | `false` | Rastrear cambios en el historial de la entidad |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Aplicar valores predeterminados en cada guardado |
| `previewProperties` | `string[]` | — | Propiedades a mostrar en las vistas previas de referencia |
| `display` | `EntityDisplay` | — | Qué rellena cada rol de visualización — `title`, `subtitle`, `image`, `status`, `date`, `tags` |

### Avanzado

| Propiedad | Tipo | Descripción |
|----------|------|-------------|
| `callbacks` | `CollectionCallbacks` | Ganchos de ciclo de vida (`beforeSave`, `afterSave`, `beforeDelete`, etc.) |
| `entityActions` | `EntityAction[]` | Acciones personalizadas sobre entidades (archivar, publicar, etc.) |
| `Actions` | `React.ComponentType` | Componente de acciones de barra de herramientas personalizado |
| `entityViews` | `EntityCustomView[]` | Pestañas personalizadas en la vista de detalle de la entidad |
| `additionalFields` | `AdditionalFieldDelegate[]` | Columnas calculadas/virtuales |
| `childCollections` | `() => CollectionConfig[]` | Colecciones hijas anidadas |
| `subcollections` | `() => CollectionConfig[]` | Colecciones anidadas (p. ej., pedido → artículos de línea) |
| `exportable` | `boolean \| ExportConfig` | Habilitar exportación de datos |
| `ownerId` | `string` | ID de usuario propietario (usado por plugins/código personalizado) |
| `overrides` | `EntityOverrides` | Anulaciones para la vista de entidad |
| `driver` | `string` | Driver de base de datos a usar (predeterminado: `"(default)"`) |
| `databaseId` | `string` | ID de base de datos/esquema dentro del driver |

## Constructor de Colecciones

Para colecciones dinámicas que cambian según el usuario o datos externos, use una función constructora:

```typescript
const collectionsBuilder: CollectionConfigsBuilder = ({ user, authController }) => {
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
