---
title: Custom Fields
sidebar_label: Custom Fields
description: Build custom form fields for entity editing with full access to the form context, entity values, and Rebase hooks.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Overview

<span class="since-badge" data-since="0.31">Since 0.31</span>

The CMS draws a field for every column from its type (see
[Fields](/docs/collections/properties/)). When that is not what you want, give
the field a component of your own in `customizeTable`: `Field` replaces the
control in the form, `Preview` replaces how the value is drawn everywhere else
(a table cell, a card, a reference chip), and `Filter` replaces its filter
control.

A component is a value. `customizeTable` runs only in the browser bundle, so you
import the component as you would anywhere else in your frontend and pass it
itself. A string path or a lazy `() => import(…)` thunk throws, with what to
write instead.

## Creating a Custom Field

<span class="since-badge" data-since="0.31">Since 0.31</span>

A custom field is a React component that receives `FieldProps`:

```tsx
// frontend/src/fields/ColorPickerField.tsx
import React from "react";
import type { FieldProps } from "@rebasepro/cms";
import type { StringProperty } from "@rebasepro/types";

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

| Prop | Type | Description |
|------|------|-------------|
| `value` | `T` | Current field value |
| `setValue` | `(value: T) => void` | Update the field value |
| `error` | `string` | Validation error message |
| `showError` | `boolean` | Whether to display the error |
| `isSubmitting` | `boolean` | Form is being saved |
| `property` | `Property` | The field as the CMS resolved it: label, validation, options |
| `context` | `FormContext` | The form: its `values` (unsaved edits included), `setFieldValue`, `id`, and `row`, the saved record as the server sends it (absent for a new record) |
| `disabled` | `boolean` | Field is readonly |
| `minimalistView` | `boolean` | Rendering in the table's popup cell editor (compact mode) |
| `customProps` | `unknown` | The field's `customProps` from `customizeTable`, untouched |

## Using it

<span class="since-badge" data-since="0.31">Since 0.31</span>

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

`brandColor` is a `col.varchar(7)` on the backend. The backend never sees the
component, and the frontend imports only the table's type from
`backend/schema`.

## A reusable field type

<span class="since-badge" data-since="0.31">Since 0.31</span>

A field you use across many tables can be registered once on
`<Rebase propertyConfigs>`, keyed by name, and named on each field with
`propertyConfig: "color_picker"`.

## Accessing Form Context

<span class="since-badge" data-since="0.31">Since 0.31</span>

A custom field can read the whole record as it is being edited:

```tsx
import React from "react";
import type { FieldProps } from "@rebasepro/cms";
import type { NumberProperty } from "@rebasepro/types";

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

## Table Mode

<span class="since-badge" data-since="0.31">Since 0.31</span>

A custom field is not drawn inside a table cell: the cell shows the value (or
your `Preview`), and editing it opens the field in a popup with `minimalistView`
set. Keep it compact there, as `ColorPickerField` does above.

## Custom Previews

<span class="since-badge" data-since="0.31">Since 0.31</span>

`Preview` draws the value outside the form. It receives `FieldPreviewProps`:
`value`, the resolved `property`, the `size` the surface gives it (`"small"`,
`"medium"` or `"large"`), and the field's `customProps`.

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

## Custom Filters

<span class="since-badge" data-since="0.31">Since 0.31</span>

`Filter` replaces the filter control of one field. It wins over a
collection-wide `Collection.FilterField` override and the built-in control for
the type. To only narrow the operators offered, use `filterOperators` instead.

## Next Steps

- **[customizeTable](/docs/frontend/customize-table)** — Every field option
- **[Entity Views](/docs/frontend/entity-views)** — Custom tabs in the entity editor
- **[Entity Actions](/docs/frontend/entity-actions)** — Custom action buttons
- **[Additional Columns](/docs/frontend/additional-columns)** — Computed table columns
