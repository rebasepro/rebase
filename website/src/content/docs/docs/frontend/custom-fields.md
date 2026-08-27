---
title: Custom Fields
sidebar_label: Custom Fields
description: Build custom form fields for entity editing with full access to the form context, entity values, and Rebase hooks.
---

<video className="intro_video" loop autoPlay muted>
    <source src="/img/custom_fields_dark.mp4" type="video/mp4"/>
</video>

## Overview

Rebase generates form fields automatically based on property types. For custom behavior, you can build your own fields.

## Creating a Custom Field

A custom field is a React component that receives `FieldProps`:

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

| Prop | Type | Description |
|------|------|-------------|
| `value` | `T` | Current field value |
| `setValue` | `(value: T) => void` | Update the field value |
| `error` | `string` | Validation error message |
| `showError` | `boolean` | Whether to display the error |
| `isSubmitting` | `boolean` | Form is being saved |
| `property` | `Property` | The property configuration |
| `context` | `FormContext` | Full form context with all entity values |
| `disabled` | `boolean` | Field is readonly |
| `minimalistView` | `boolean` | Rendering inside the spreadsheet (compact mode) |

## Registering a Custom Field

### Per-Property

Register on a single property:

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

### When the collection file is also read by the server

In the default scaffold, `config/collections/` is loaded by **both** the admin panel and the backend — the backend reads the same files to derive the schema and the API. A direct component reference is only safe when nothing on the server loads that file, because importing `ColorPickerField` also imports React, your CSS and everything else the component pulls in, into the server's module graph.

Point at the component with a lazy import instead. It is type-checked exactly the same way, and the backend never calls it:

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

The module must have a **default export** — the thunk resolves to `default`, and a named-only export renders nothing. The admin wraps it in `React.lazy` on first render, so the component is also a separate chunk rather than part of the initial bundle.

### Global Property Config

Register a reusable field type:

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

Then use it in any collection:

```typescript
properties: {
    color: {
        type: "string",
        name: "Color",
        propertyConfig: "color_picker"
    }
}
```

## Accessing Form Context

Custom fields can access the full entity values:

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

## Table Mode

When rendering inside the spreadsheet view, fields should be compact. Check `minimalistView`:

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

## Custom Previews

For custom rendering in the table (non-editing mode), use the `Preview` component:

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

## Next Steps

- **[Entity Views](/docs/frontend/entity-views)** — Custom tabs in the entity editor
- **[Entity Actions](/docs/frontend/entity-actions)** — Custom action buttons
- **[Additional Columns](/docs/frontend/additional-columns)** — Computed table columns
