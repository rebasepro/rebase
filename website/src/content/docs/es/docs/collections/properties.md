---
title: Propiedades
sidebar_label: Propiedades
description: Los tipos de propiedades definen el tipo de dato, la validación y la renderización de la interfaz de usuario para cada campo en una colección. Rebase soporta los tipos cadena, número, booleano, fecha, array, mapa, referencia, relación y geopunto.
---

## Resumen

Las propiedades definen las columnas en la tabla de tu base de datos y cómo se renderizan en la interfaz de administración. Cada propiedad tiene un `type` que determina:

- El **tipo de columna de la base de datos** (mediante la generación de esquemas Drizzle)
- El componente de **campo de formulario**
- El renderizador de **celda de tabla**
- Las reglas de **validación**

## Tipos de Propiedades

| Type | Description | PostgreSQL Column |
|------|-------------|-------------------|
| `string` | Texto, selección, markdown, carga de archivos, URL, correo electrónico | `varchar`, `text`, `jsonb` |
| `number` | Entero, decimal, moneda | `integer`, `numeric`, `bigint`, `serial` |
| `boolean` | Alternador verdadero/falso | `boolean` |
| `date` | Fecha, fecha y hora, marca de tiempo | `timestamp`, `date` |
| `array` | Lista ordenada de valores | `jsonb` |
| `map` | Objeto clave-valor | `jsonb` |
| `geopoint` | Par latitud/longitud | `jsonb` |
| `reference` | Referencia incrustada a otra entidad | `varchar` (almacena ID) |
| `relation` | Relación de clave foránea SQL | Utiliza el array `relations` |

## Propiedades Comunes

Todos los tipos de propiedades comparten estas opciones:

| Property | Type | Description |
|----------|------|-------------|
| `type` | `string` | **Requerido.** Tipo de dato (ver arriba) |
| `name` | `string` | **Requerido.** Etiqueta de visualización |
| `description` | `string` | Texto de ayuda mostrado debajo del campo |
| `columnWidth` | `number` | Ancho de columna en píxeles (vista de tabla) |
| `readOnly` | `boolean` | Prevenir edición |
| `disabled` | `boolean \| PropertyDisabledConfig` | Deshabilitar con tooltip opcional |
| `hideFromCollection` | `boolean` | Ocultar de la vista de tabla |
| `defaultValue` | `any` | Valor predeterminado para nuevas entidades |
| `validation` | `object` | Reglas de validación |
| `Field` | `React.ComponentType` | Componente de campo personalizado |
| `Preview` | `React.ComponentType` | Componente de celda de tabla personalizado |
| `propertyConfig` | `string` | Clave de configuración de propiedad registrada |
| `editable` | `boolean` | Habilitar edición en línea en la tabla (predeterminado: true) |

## Propiedades de Cadena (String)

```typescript
name: {
    type: "string",
    name: "Name",
    validation: { required: true, min: 2, max: 200 }
}

description: {
    type: "string",
    name: "Description",
    multiline: true,       // Textarea
    markdown: true         // Markdown editor
}

category: {
    type: "string",
    name: "Category",
    enum: [
        { id: "electronics", label: "Electronics", color: "blueDark" },
        { id: "clothing", label: "Clothing", color: "pinkLight" },
    ]
}

email: {
    type: "string",
    name: "Email",
    email: true,           // Email validation
    validation: { required: true }
}

website: {
    type: "string",
    name: "Website",
    url: true              // URL validation
}

avatar: {
    type: "string",
    name: "Avatar",
    storage: {             // File upload
        storagePath: "avatars",
        acceptedFiles: ["image/*"],
        maxSize: 2 * 1024 * 1024
    }
}
```

### Opciones de Cadena (String)

| Property | Type | Description |
|----------|------|-------------|
| `multiline` | `boolean` | Renderizar como textarea |
| `markdown` | `boolean` | Renderizar como editor markdown |
| `email` | `boolean` | Validación de formato de correo electrónico |
| `url` | `boolean` | Validación de formato de URL |
| `storage` | `StorageConfig` | Habilitar carga de archivos |
| `enum` | `EnumValues` | Renderizar como menú desplegable (select) |
| `multiSelect` | `boolean` | Permitir múltiples selecciones de enum |
| `columnType` | `string` | Columna de base de datos: `"varchar"`, `"text"` |
| `isId` | `string` | Generación de ID: `"uuid"`, `"cuid"`, `"increment"`, `"manual"` |
| `userSelect` | `boolean` | Renderizar como un selector de usuario |
| `previewAsTag` | `boolean` | Renderizar esta cadena como una etiqueta en las vistas previas |
| `clearable` | `boolean` | Añadir un icono para borrar el valor (establecer a null) |

## Propiedades Numéricas

```typescript
price: {
    type: "number",
    name: "Price",
    validation: { required: true, min: 0 }
}

quantity: {
    type: "number",
    name: "Quantity",
    columnType: "integer"  // Store as integer
}
```

### Opciones Numéricas

| Property | Type | Description |
|----------|------|-------------|
| `enum` | `EnumValues` | Renderizar como select con valores numéricos |
| `columnType` | `string` | `"integer"`, `"bigint"`, `"numeric"`, `"serial"`, `"smallint"` |
| `isId` | `string` | Estrategia de generación de ID |
| `clearable` | `boolean` | Añadir un icono para borrar el valor (establecer a null) |

## Propiedades Booleanas

```typescript
active: {
    type: "boolean",
    name: "Active",
    defaultValue: true
}
```

![Campo de interruptor](/img/fields/Switch.png)

## Propiedades de Fecha

```typescript
created_at: {
    type: "date",
    name: "Created At",
    autoValue: "on_create",   // Set automatically on creation
    readOnly: true
}

updated_at: {
    type: "date",
    name: "Updated At",
    autoValue: "on_update"    // Set automatically on every save
}

event_date: {
    type: "date",
    name: "Event Date",
    mode: "date"              // Date only (no time)
}
```

![Campo de fecha](/img/fields/Date.png)

### Opciones de Fecha

| Property | Type | Description |
|----------|------|-------------|
| `mode` | `"date" \| "date_time"` | Solo fecha o fecha + hora (predeterminado: `"date_time"`) |
| `autoValue` | `"on_create" \| "on_update"` | Establecer marcas de tiempo automáticamente |
| `columnType` | `string` | `"timestamp"`, `"date"` |
| `timezone` | `string` | Cadena de zona horaria para evaluar la fecha |
| `clearable` | `boolean` | Añadir un icono para borrar el valor (establecer a null) |

## Propiedades de Array

```typescript
tags: {
    type: "array",
    name: "Tags",
    of: { type: "string" }    // Array of strings
}

images: {
    type: "array",
    name: "Images",
    of: {
        type: "string",
        storage: { storagePath: "images", acceptedFiles: ["image/*"] }
    }
}

// Block editor (multiple types)
content: {
    type: "array",
    name: "Content Blocks",
    oneOf: {
        properties: {
            text: {
                type: "map",
                properties: {
                    body: { type: "string", name: "Body", markdown: true }
                }
            },
            image: {
                type: "map",
                properties: {
                    src: { type: "string", name: "Image", storage: { ... } },
                    caption: { type: "string", name: "Caption" }
                }
            }
        }
    }
}
```

![Campo de bloque](/img/fields/Block.png)

### Opciones de Array

| Property | Type | Description |
|----------|------|-------------|
| `of` | `Property \| Property[]` | Esquema de propiedad para los elementos del array |
| `oneOf` | `object` | Array de objetos tipados con múltiples tipos discriminadores |
| `expanded` | `boolean` | ¿Debe el campo estar inicialmente expandido (predeterminado: true) |
| `minimalistView` | `boolean` | Mostrar propiedades secundarias directamente sin panel extensible |
| `sortable` | `boolean` | ¿Pueden reordenarse los elementos (predeterminado: true) |
| `canAddElements` | `boolean` | ¿Se pueden añadir nuevos elementos (predeterminado: true) |

## Propiedades de Mapa (Map)

```typescript
address: {
    type: "map",
    name: "Address",
    properties: {
        street: { type: "string", name: "Street" },
        city: { type: "string", name: "City" },
        zip: { type: "string", name: "ZIP Code" },
        country: { type: "string", name: "Country" }
    }
}

metadata: {
    type: "map",
    name: "Metadata",
    keyValue: true    // Free-form key-value editor
}
```

![Campo de grupo](/img/fields/Group.png)

### Opciones de Mapa (Map)

| Property | Type | Description |
|----------|------|-------------|
| `properties` | `Properties` | Registro de propiedades incluidas en el mapa |
| `propertiesOrder` | `string[]` | Claves ordenadas para la renderización |
| `previewProperties` | `string[]` | Qué propiedades mostrar en la vista previa de la tabla |
| `pickOnlySomeKeys` | `boolean` | Permitir al usuario añadir selectivamente claves en la UI |
| `spreadChildren` | `boolean` | Renderizar propiedades secundarias como columnas separadas en la vista de tabla |
| `minimalistView` | `boolean` | Mostrar propiedades sin un panel envolvente |
| `expanded` | `boolean` | ¿Debe el campo estar inicialmente expandido (predeterminado: true) |
| `keyValue` | `boolean` | Renderizar como editor de pares clave-valor arbitrarios |

## Valores Enum

Se utiliza con propiedades de cadena o número para renderizar selectores:

```typescript
// Simple array
enum: ["draft", "published", "archived"]

// With labels
enum: [
    { id: "draft", label: "Draft" },
    { id: "published", label: "Published" },
    { id: "archived", label: "Archived" }
]

// With colors (for Kanban columns and chips)
enum: [
    { id: "draft", label: "Draft", color: "grayDark" },
    { id: "published", label: "Published", color: "greenDark" },
    { id: "archived", label: "Archived", color: "orangeDark" }
]
```

![Campo de selección](/img/fields/Select.png)

## Validación

```typescript
validation: {
    required: true,             // Field is required
    unique: true,               // Must be unique in the table
    requiredMessage: "Custom error message",

    // String-specific
    min: 2,                     // Minimum length
    max: 200,                   // Maximum length
    matches: /^[a-z]+$/,       // Regex pattern
    email: true,                // Email format
    url: true,                  // URL format

    // Number-specific
    min: 0,                     // Minimum value
    max: 1000,                  // Maximum value
    integer: true,              // Must be integer

    // Array-specific
    min: 1,                     // Minimum items
    max: 10,                    // Maximum items
}
```

## Campos Condicionales

Puedes hacer que los campos sean dinámicos para que reaccionen a los valores de la entidad. Hay dos formas de hacer esto:

### 1. Condiciones JSON Logic (Declarativas)

Puedes usar la propiedad `conditions` para definir reglas declarativas de JSON Logic que pueden ser serializadas y modificadas visualmente en el editor de colecciones.

```typescript
price: {
    type: "number",
    name: "Price",
    conditions: {
        disabled: { "==": [{ "var": "values.is_free" }, true] },
        required: { "!=": [{ "var": "values.is_free" }, true] },
        min: 0,
        clearOnDisabled: true // Set to null if field gets disabled
    }
}
```

El objeto `conditions` te da acceso a:
- `disabled`, `hidden`, `readOnly`
- `required`, `min`, `max`
- `defaultValue`
- `enumConditions`, `allowedEnumValues`, `excludedEnumValues`
- `referencePath`, `referenceFilter`
- `canAddElements`, `sortable` (para arrays)

### 2. Constructores de Propiedades (Programáticos)

Para comportamientos complejos que no pueden expresarse mediante JSON Logic, puedes usar `dynamicProps`, que evalúa una función Javascript.

```typescript
price: {
    type: "number",
    name: "Price",
    dynamicProps: ({ values, user }) => ({
        disabled: values.is_free === true || !user.roles.includes("admin"),
        validation: values.is_free ? {} : { required: true, min: 0 }
    })
}
```

## Próximos Pasos

- **[Relaciones](/docs/collections/relations)** — Claves foráneas y uniones
- **[Reglas de Seguridad](/docs/collections/security-rules)** — Seguridad a nivel de fila (Row Level Security)
- **[Campos Personalizados](/docs/frontend/custom-fields)** — Construir componentes de campo personalizados
---
