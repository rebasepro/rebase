---
title: Campos Personalizados
sidebar_label: Campos Personalizados
description: Cree campos de formulario personalizados para la edición de entidades con acceso completo al contexto del formulario, los valores de la entidad y los hooks de Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Resumen

Rebase genera campos de formulario automáticamente según los tipos de propiedad. Para un comportamiento personalizado, puede construir sus propios campos.

## Creación de un Campo Personalizado

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
| `showError` | `boolean` | Si se debe mostrar el error |
| `isSubmitting` | `boolean` | El formulario se está guardando |
| `property` | `Property` | La configuración de la propiedad |
| `context` | `FormContext` | Contexto completo del formulario con todos los valores de la entidad |
| `disabled` | `boolean` | El campo es de solo lectura |
| `tableMode` | `boolean` | Renderizado dentro de la hoja de cálculo (modo compacto) |

## Registro de un Campo Personalizado

### Por Propiedad

Registre en una sola propiedad:

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

### Cuando el archivo de la colección también lo lee el servidor

En el scaffold por defecto, `config/collections/` lo carga **tanto** el panel de administración como el backend — el backend lee los mismos archivos para derivar el esquema y la API. Una referencia directa al componente solo es segura si nada en el servidor carga ese archivo, porque importar `ColorPickerField` también importa React, tu CSS y todo lo que arrastre el componente al grafo de módulos del servidor.

En su lugar, apunta al componente con un import diferido. Se comprueba igual a nivel de tipos y el backend nunca lo invoca:

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

El módulo debe tener un **export por defecto** — el thunk resuelve a `default`, y un export solo con nombre no renderiza nada. El panel lo envuelve en `React.lazy` en el primer render, así que el componente queda en su propio chunk en lugar del bundle inicial.

### Configuración Global de Propiedad

Registre un tipo de campo reutilizable:

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

Luego úselo en cualquier colección:

```typescript
properties: {
    color: {
        type: "string",
        name: "Color",
        propertyConfig: "color_picker"
    }
}
```

## Acceso al Contexto del Formulario

Los campos personalizados pueden acceder a todos los valores de la entidad:

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

## Modo Tabla

Al renderizarse dentro de la vista de hoja de cálculo, los campos deben ser compactos. Verifique `tableMode`:

```tsx
function MyField({ value, setValue, minimalistView }: FieldProps<StringProperty>) {
    if (minimalistView) {
        return <span onClick={() => { /* open editor */ }}>{value}</span>;
    }

    return (
        <div>
            <label>Full Editor</label>
            <textarea value={value ?? ""} onChange={(e) => setValue(e.target.value)} />
        </div>
    );
}
```

## Vistas Previas Personalizadas

Para un renderizado personalizado en la tabla (modo no edición), use el componente `Preview`:

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

## Próximos Pasos

- **[Entity Views](/docs/frontend/entity-views)** — Pestañas personalizadas en el editor de entidades
- **[Entity Actions](/docs/frontend/entity-actions)** — Botones de acción personalizados
- **[Additional Columns](/docs/frontend/additional-columns)** — Columnas de tabla calculadas
---
