---
sourceHash: d337d344b88534c8
title: Campos personalizados
sidebar_label: Campos personalizados
description: Construye campos de formulario personalizados para la edición de entidades con acceso total al contexto del formulario, los valores de la entidad y los hooks de Rebase.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Descripción general

<span class="since-badge" data-since="0.31">Desde 0.31</span>

El CMS genera un campo para cada columna a partir de su tipo (consulta
[Campos](/docs/collections/properties/)). Cuando esto no sea lo que deseas, asigna
al campo un componente propio en `customizeTable`: `Field` reemplaza el
control en el formulario, `Preview` reemplaza cómo se dibuja el valor en cualquier otro lugar
(una celda de tabla, una tarjeta, un chip de referencia) y `Filter` reemplaza su
control de filtro.

Un componente es un valor. `customizeTable` se ejecuta únicamente en el bundle del navegador, por lo que
importas el componente como lo harías en cualquier otra parte de tu frontend y pasas
la referencia directamente. Una ruta como cadena de texto o un thunk diferido `() => import(…)` lanzará un error,
indicando qué escribir en su lugar.

## Crear un campo personalizado

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un campo personalizado es un componente de React que recibe `FieldProps`:

```tsx
// frontend/src/fields/ColorPickerField.tsx
import React from "react";
import type { FieldProps } from "@rebasepro/cms";
import type { StringProperty } from "@rebasepro/cms-types";

export function ColorPickerField({ value, setValue, error, showError, minimalistView }: FieldProps<StringProperty>) {
    return (
        <div>
            <input
                type="color"
                value={value ?? "#000000"}
                onChange={(e) => setValue(e.target.value)}
            />
            {!minimalistView && <span>{value}</span>}
            {showError && error && <span className="text-red-500">{error}</span>}
        </div>
    );
}
```

### FieldProps

<span class="since-badge" data-since="0.31">Desde 0.31</span>

| Propiedad | Tipo | Descripción |
|------|------|-------------|
| `value` | `T` | Valor actual del campo |
| `setValue` | `(value: T) => void` | Actualiza el valor del campo |
| `error` | `string` | Mensaje de error de validación |
| `showError` | `boolean` | Si se debe mostrar el error |
| `isSubmitting` | `boolean` | El formulario se está guardando |
| `property` | `Property` | El campo tal como lo resolvió el CMS: etiqueta, validación, opciones |
| `context` | `FormContext` | El formulario: sus `values` (incluidas las ediciones no guardadas), `setFieldValue`, `id` y `row`, el registro guardado tal como lo envía el servidor (ausente para un nuevo registro) |
| `disabled` | `boolean` | El campo es de solo lectura |
| `minimalistView` | `boolean` | Renderizado en el editor emergente de celdas de la tabla (modo compacto) |
| `customProps` | `unknown` | Los `customProps` del campo desde `customizeTable`, sin modificar |

## Cómo usarlo

<span class="since-badge" data-since="0.31">Desde 0.31</span>

```tsx
// frontend/src/cms/brands.tsx
import { customizeTable } from "@rebasepro/cms";
import type { brands } from "../../../backend/schema/brands";
import { ColorPickerField } from "../fields/ColorPickerField";
import { ColorPreview } from "../fields/ColorPreview";

export const brandsCms = customizeTable<typeof brands>("brands", {
    fields: {
        brandColor: { Field: ColorPickerField, Preview: ColorPreview },
    },
});
```

`brandColor` es un `col.varchar({ length: 7 })` en el backend. El backend nunca ve el
componente, y el frontend solo importa el tipo de la tabla desde
`backend/schema`.

## Un tipo de campo reutilizable

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un campo que utilices en varias tablas se puede registrar una sola vez en
`<Rebase propertyConfigs>`, indexado por nombre, y referenciado en cada campo mediante
`propertyConfig: "color_picker"`.

## Acceder al contexto del formulario

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un campo personalizado puede leer el registro completo mientras se está editando:

```tsx
import React from "react";
import type { FieldProps } from "@rebasepro/cms";
import type { NumberProperty } from "@rebasepro/cms-types";

export function PriceWithTaxField({ value, setValue, context }: FieldProps<NumberProperty>) {
    const taxRate = Number(context.values.taxRate ?? 0.1);
    const priceWithTax = value ? value * (1 + taxRate) : 0;

    return (
        <div>
            <input
                type="number"
                value={value ?? 0}
                onChange={(e) => setValue(Number(e.target.value))}
            />
            <p>With tax: {priceWithTax.toFixed(2)}</p>
        </div>
    );
}
```

## Modo tabla

<span class="since-badge" data-since="0.31">Desde 0.31</span>

Un campo personalizado no se dibuja dentro de una celda de la tabla: la celda muestra el valor (o
tu `Preview`), y al editarlo se abre el campo en una ventana emergente con `minimalistView`
activado. Mantenlo compacto allí, como lo hace `ColorPickerField` anteriormente.

## Vistas previas personalizadas

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`Preview` dibuja el valor fuera del formulario. Recibe `FieldPreviewProps`:
`value`, la `property` resuelta, el `size` asignado por la superficie (`"small"`,
`"medium"` o `"large"`), y los `customProps` del campo.

```tsx
// frontend/src/fields/ColorPreview.tsx
import React from "react";
import type { FieldPreviewProps } from "@rebasepro/cms-types";

export function ColorPreview({ value }: FieldPreviewProps) {
    const color = typeof value === "string" ? value : "transparent";
    return (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: color }}/>
            {typeof value === "string" ? value : ""}
        </span>
    );
}
```

## Filtros personalizados

<span class="since-badge" data-since="0.31">Desde 0.31</span>

`Filter` reemplaza el control de filtro de un campo. Prevalece sobre una
sobrescritura a nivel de colección mediante `Collection.FilterField` y sobre el control integrado
para ese tipo. Para solo restringir los operadores ofrecidos, utiliza `filterOperators` en su lugar.

## Próximos pasos

- **[customizeTable](/docs/frontend/customize-table)** — Todas las opciones de campo
- **[Entity Views](/docs/frontend/entity-views)** — Pestañas personalizadas en el editor de entidades
- **[Entity Actions](/docs/frontend/entity-actions)** — Botones de acción personalizados
- **[Additional Columns](/docs/frontend/additional-columns)** — Columnas calculadas de la tabla
