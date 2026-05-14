---
title: Properties
sidebar_label: Properties
description: Property types define the data type, validation, and UI rendering for each field in a collection. Rebase supports string, number, boolean, date, array, map, reference, relation, and geopoint types.
---

## Overview

Properties define the columns in your database table and how they are rendered in the admin UI. Each property has a `type` that determines:

- The **database column type** (via Drizzle schema generation)
- The **form field** component
- The **table cell** renderer
- The **validation** rules

## Property Types

| Type | Description | PostgreSQL Column |
|------|-------------|-------------------|
| `string` | Text, select, markdown, file upload, URL, email | `varchar`, `text`, `jsonb` |
| `number` | Integer, decimal, currency | `integer`, `numeric`, `bigint`, `serial` |
| `boolean` | True/false toggle | `boolean` |
| `date` | Date, datetime, timestamp | `timestamp`, `date` |
| `array` | Ordered list of values | `jsonb` |
| `map` | Key-value object | `jsonb` |
| `geopoint` | Latitude/longitude pair | `jsonb` |
| `reference` | Embedded reference to another entity | `varchar` (stores ID) |
| `relation` | SQL foreign key relation | Uses the `relations` array |

## Common Properties

All property types share these options:

| Property | Type | Description |
|----------|------|-------------|
| `type` | `string` | **Required.** Data type (see above) |
| `name` | `string` | **Required.** Display label |
| `description` | `string` | Help text shown below the field |
| `columnWidth` | `number` | Column width in pixels (table view) |
| `readOnly` | `boolean` | Prevent editing |
| `disabled` | `boolean \| PropertyDisabledConfig` | Disable with optional tooltip |
| `hideFromCollection` | `boolean` | Hide from table view |
| `defaultValue` | `any` | Default value for new entities |
| `validation` | `object` | Validation rules |
| `Field` | `React.ComponentType` | Custom field component |
| `Preview` | `React.ComponentType` | Custom table cell component |
| `propertyConfig` | `string` | Registered property config key |
| `editable` | `boolean` | Enable inline editing in table (default: true) |

## String Properties

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

### String Options

| Property | Type | Description |
|----------|------|-------------|
| `multiline` | `boolean` | Render as textarea |
| `markdown` | `boolean` | Render as markdown editor |
| `email` | `boolean` | Email format validation |
| `url` | `boolean` | URL format validation |
| `storage` | `StorageConfig` | Enable file upload |
| `enum` | `EnumValues` | Render as select dropdown |
| `multiSelect` | `boolean` | Allow multiple enum selections |
| `columnType` | `string` | Database column: `"varchar"`, `"text"` |
| `isId` | `string` | ID generation: `"uuid"`, `"cuid"`, `"increment"`, `"manual"` |
| `userSelect` | `boolean` | Render as a user picker |
| `previewAsTag` | `boolean` | Render this string as a tag in previews |
| `clearable` | `boolean` | Add an icon to clear the value (set to null) |

## Number Properties

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

### Number Options

| Property | Type | Description |
|----------|------|-------------|
| `enum` | `EnumValues` | Render as select with numeric values |
| `columnType` | `string` | `"integer"`, `"bigint"`, `"numeric"`, `"serial"`, `"smallint"` |
| `isId` | `string` | ID generation strategy |
| `clearable` | `boolean` | Add an icon to clear the value (set to null) |

## Boolean Properties

```typescript
active: {
    type: "boolean",
    name: "Active",
    defaultValue: true
}
```

![Switch field](/img/fields/Switch.png)

## Date Properties

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

![Date field](/img/fields/Date.png)

### Date Options

| Property | Type | Description |
|----------|------|-------------|
| `mode` | `"date" \| "date_time"` | Date only or date + time (default: `"date_time"`) |
| `autoValue` | `"on_create" \| "on_update"` | Auto-set timestamps |
| `columnType` | `string` | `"timestamp"`, `"date"` |
| `timezone` | `string` | Timezone string to evaluate the date in |
| `clearable` | `boolean` | Add an icon to clear the value (set to null) |

## Array Properties

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

![Block field](/img/fields/Block.png)

### Array Options

| Property | Type | Description |
|----------|------|-------------|
| `of` | `Property \| Property[]` | Property schema for array items |
| `oneOf` | `object` | Array of typed objects with multiple discriminator types |
| `expanded` | `boolean` | Should the field be initially expanded (default: true) |
| `minimalistView` | `boolean` | Display child properties directly without extendable panel |
| `sortable` | `boolean` | Can elements be reordered (default: true) |
| `canAddElements` | `boolean` | Can new elements be added (default: true) |

## Map Properties

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

![Group field](/img/fields/Group.png)

### Map Options

| Property | Type | Description |
|----------|------|-------------|
| `properties` | `Properties` | Record of properties included in the map |
| `propertiesOrder` | `string[]` | Ordered keys for rendering |
| `previewProperties` | `string[]` | Which properties to show in the table preview |
| `pickOnlySomeKeys` | `boolean` | Let the user selectively add keys in the UI |
| `spreadChildren` | `boolean` | Render child properties as separate columns in table view |
| `minimalistView` | `boolean` | Display properties without a wrapping panel |
| `expanded` | `boolean` | Should the field be initially expanded (default: true) |
| `keyValue` | `boolean` | Render as arbitrary key-value pairs editor |

## Enum Values

Used with string or number properties to render selects:

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

![Select field](/img/fields/Select.png)

## Validation

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

## Conditional Fields

You can make fields dynamic so they react to the entity's values. There are two ways to do this:

### 1. JSON Logic Conditions (Declarative)

You can use the `conditions` property to define declarative JSON Logic rules that can be serialized and modified visually in the collection editor.

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

The conditions object gives you access to:
- `disabled`, `hidden`, `readOnly`
- `required`, `min`, `max`
- `defaultValue`
- `enumConditions`, `allowedEnumValues`, `excludedEnumValues`
- `referencePath`, `referenceFilter`
- `canAddElements`, `sortable` (for arrays)

### 2. Property Builders (Programmatic)

For complex behavior that can't be expressed via JSON Logic, you can use `dynamicProps` which evaluates a Javascript function.

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

## Next Steps

- **[Relations](/docs/collections/relations)** — Foreign keys and joins
- **[Security Rules](/docs/collections/security-rules)** — Row Level Security
- **[Custom Fields](/docs/frontend/custom-fields)** — Build custom field components
