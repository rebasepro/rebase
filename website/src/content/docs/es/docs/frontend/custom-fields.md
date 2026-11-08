---
sourceHash: adec4552f7386908
title: Campos personalizados
sidebar_label: Campos personalizados
description: Construye campos de formulario personalizados para la edición de entidades con acceso total al contexto del formulario, los valores de la entidad y los hooks de Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Descripción general

Rebase genera campos de formulario automáticamente según los tipos de propiedades. Para comportamientos personalizados, puedes crear tus propios campos.

## Crear un campo personalizado

Un campo personalizado es un componente de React que recibe `FieldProps`:

```tsx
import type { FieldProps } from "@rebasepro/cms";
import type { StringProperty, NumberProperty } from "@rebasepro/types";

function ColorPickerField({ value, setValue, error, showError }: FieldProps<StringProperty>) {
    return (
        <div>
            <input
                type="color"
                value={value ?? "#000000"}
                onChange={(e) => setValue(e.target.value)}
            />
            {showError && error && <span className="text-red-500">{error}</span>}
        </div>
    );
}
```

### FieldProps

| Prop | Tipo | Descripción |
|------|------|-------------|
| `value` | `T` | Valor actual del campo |
| `setValue` | `(value: T) => void` | Actualiza el valor del campo |
| `error` | `string` | Mensaje de error de validación |
| `showError` | `boolean` | Indica si se debe mostrar el error |
| `isSubmitting` | `boolean` | El formulario se está guardando |
| `property` | `Property` | La configuración de la propiedad |
| `context` | `FormContext` | El formulario: sus `values` (incluidas las ediciones no guardadas), `setFieldValue`, `id` y `row`, el registro guardado tal como lo envía el servidor (ausente para un registro nuevo) |
| `disabled` | `boolean` | El campo es de solo lectura |
| `minimalistView` | `boolean` | Se está renderizando en el editor de celda emergente de la tabla (modo compacto) |

## Registrar un campo personalizado

### Por propiedad

Regístralo en una sola propiedad:

```typescript
properties: {
    brand_color: {
        type: "string",
        name: "Brand Color",
        admin: {
            Field: ColorPickerField
        }
    }
}
```

### Cuando el archivo de la colección también es leído por el servidor

En el scaffold predeterminado, `config/collections/` es cargado por **ambos**, el panel de administración y el backend — el backend lee los mismos archivos para derivar el esquema y la API. Una referencia directa al componente solo es segura cuando nada en el servidor carga ese archivo, ya que importar `ColorPickerField` también importa React, tu CSS y todo lo demás que el componente incluye dentro del grafo de módulos del servidor.

En su lugar, apunta al componente con una importación diferida (lazy import). Se comprueban los tipos exactamente de la misma manera y el backend nunca lo llama:

```ts no-verify
// config/collections/products.ts
properties: {
    brand_color: {
        type: "string",
        name: "Brand Color",
        admin: {
            Field: () => import("../../frontend/src/ColorPickerField"),
            Preview: () => import("../../frontend/src/ColorPreview")
        }
    }
}
```

El módulo debe tener un **default export** — el thunk se resuelve a `default`, y una exportación que solo tenga nombre (named export) no renderiza nada. El panel de administración lo envuelve en `React.lazy` en el primer renderizado, por lo que el componente también es un chunk separado en lugar de formar parte del bundle inicial.

### Configuración global de propiedad

Registra un tipo de campo reutilizable:

```tsx
const colorPropertyConfig: PropertyConfig = {
    key: "color_picker",
    name: "Color Picker",
    property: {
        type: "string",
        admin: {
            Field: ColorPickerField
        }
    }
};

// Register globally — keyed by the config's `key`
<Rebase propertyConfigs={{ color_picker: colorPropertyConfig }}>…</Rebase>
```

Luego úsalo en cualquier colección:

```typescript
properties: {
    color: {
        type: "string",
        name: "Color",
        propertyConfig: "color_picker"
    }
}
```

## Acceder al contexto del formulario

Los campos personalizados pueden acceder a los valores completos de la entidad:

```tsx
function PriceWithTaxField({ value, setValue, context }: FieldProps<NumberProperty>) {
    const taxRate = Number(context.values.tax_rate ?? 0.1);
    const priceWithTax = value ? value * (1 + taxRate) : 0;

    return (
        <div>
            <input
                type="number"
                value={value ?? 0}
                onChange={(e) => setValue(Number(e.target.value))}
            />
            <p>With tax: ${priceWithTax.toFixed(2)}</p>
        </div>
    );
}
```

## Modo tabla

Un campo personalizado no se dibuja dentro de la celda de una tabla: la celda muestra el valor (o tu `Preview`), y al editarlo se abre el campo en una ventana emergente con `minimalistView` activado. Mantenlo compacto allí:

```tsx
function MyField({ value, setValue, minimalistView }: FieldProps<StringProperty>) {
    if (minimalistView) {
        return <input value={value ?? ""} onChange={(e) => setValue(e.target.value)}/>;
    }

    return (
        <div>
            <label>Full Editor</label>
            <textarea value={value ?? ""} onChange={(e) => setValue(e.target.value)} />
        </div>
    );
}
```

## Vistas previas personalizadas

Para un renderizado personalizado en la tabla (modo de no edición), utiliza el componente `Preview`:

```tsx
function ColorPreview({ value }: { value: string }) {
    return (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{
                width: 24, height: 24,
                borderRadius: 4,
                backgroundColor: value
            }} />
            <span>{value}</span>
        </div>
    );
}

// Register it
properties: {
    color: {
        type: "string",
        name: "Color",
        admin: {
            Field: ColorPickerField,
            Preview: ColorPreview
        }
    }
}
```

## Próximos pasos

- **[Vistas de entidad](/docs/frontend/entity-views)** — Pestañas personalizadas en el editor de entidades
- **[Acciones de entidad](/docs/frontend/entity-actions)** — Botones de acción personalizados
- **[Columnas adicionales](/docs/frontend/additional-columns)** — Columnas calculadas de la tabla
