---
name: rebase-collections
description: Comprehensive guide for defining Rebase collections, property types, validation, and schema configuration. Use this skill when the user needs help creating collections, adding properties, configuring field types, or understanding the schema-as-code approach.
---

# Rebase Collections

Rebase collections are the core building blocks of your data model. They define the structure, validation, and UI configuration of your data — all in TypeScript.

## Core Concepts

### Collections

A collection is defined as a TypeScript object implementing the `PostgresCollectionConfig` interface from `@rebasepro/types`. Each collection maps to a database table (via the `table` property) and generates:
- Full CRUD REST endpoints at `/api/data/{slug}`
- Optional GraphQL queries and mutations
- Admin panel views (table, forms, cards, kanban, list)

### Properties

Properties define the fields of your collection. Rebase supports these built-in property types:

| Type | Description | PostgreSQL Column |
|------|-------------|-------------------|
| `string` | Text fields, URLs, emails, markdown, file uploads | `VARCHAR` / `TEXT` |
| `number` | Integers and decimals | `INTEGER` / `DOUBLE PRECISION` |
| `boolean` | True/false toggles | `BOOLEAN` |
| `date` | Date and datetime values | `TIMESTAMP` |
| `map` | Nested objects (JSON) | `JSONB` |
| `array` | Lists of values | `JSONB` or native arrays |
| `relation` | Foreign key to another collection (SQL JOINs) | FK column or junction table |
| `reference` | Legacy FK reference by collection slug (Firestore-style) | `UUID` with FK |
| `geopoint` | Latitude/longitude pairs | `JSONB` |
| `vector` | Embedding vectors for similarity search | `VECTOR` |

### Reference vs Relation

> **IMPORTANT FOR AGENTS:** Understand the difference between `reference` and `relation` — they are NOT interchangeable.

| Feature | `relation` (Recommended) | `reference` (Legacy) |
|---------|-------------------------|---------------------|
| Backend | SQL JOINs, FK constraints | Stores a collection path + snapshot ID |
| Cascade rules | `onDelete`, `onUpdate` | None |
| Junction tables | Yes (many-to-many) | No |
| Multi-hop joins | Yes (`joinPath`) | No |
| Inverse lookups | Yes (`direction: "inverse"`) | No |
| Where to use | **PostgresCollectionConfig** | FirebaseCollectionConfig or legacy |
| Stored value | FK column(s) managed by framework | `{ id, path }` object or string |

**Use `relation` for all new Postgres collections.** The `reference` type exists for backward compatibility with Firestore-style collections.

A `string` property can also act as a lightweight reference via its `reference` sub-property (stores just the ID string and renders a reference picker), but this does not create SQL JOINs.

### Schema-as-Code

Collections are defined as standalone TypeScript files under `config/collections/` relative to the project root. The visual Studio edits these files via AST manipulation — it never runs raw SQL. This preserves custom callbacks and complex configuration.

## Defining a Collection

```typescript
import { PostgresCollectionConfig } from "@rebasepro/types";

const productsCollection: PostgresCollectionConfig = {
    name: "Products",
    singularName: "Product",
    slug: "products",
    table: "products",
    icon: "ShoppingBag",
    group: "E-Commerce",
    description: "Product catalog with pricing and inventory",
    history: true,
    defaultViewMode: "table",
    enabledViews: ["table", "cards"],
    openSnapshotMode: "split",
    inlineEditing: true,
    exportable: true,
    selectionEnabled: true,
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
        },
        name: {
            name: "Product Name",
            type: "string",
            validation: { required: true }
        },
        price: {
            name: "Price",
            type: "number",
            validation: { required: true, min: 0 }
        },
        description: {
            name: "Description",
            type: "string",
            multiline: true
        },
        published: {
            name: "Published",
            type: "boolean",
            defaultValue: false
        },
        created_at: {
            name: "Created At",
            type: "date",
            mode: "date_time",
            autoValue: "on_create",
            ui: { readOnly: true, hideFromCollection: true }
        },
        category: {
            name: "Category",
            type: "string",
            enum: [
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "purple" },
                { id: "books", label: "Books", color: "green" }
            ]
        }
    },
    propertiesOrder: [
        "name", "price", "category", "description",
        "published", "created_at"
    ]
};

export default productsCollection;
```

### Collection Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | — | Display name (plural). E.g. `"Products"` |
| `singularName` | `string` | — | Singular display name. E.g. `"Product"` |
| `slug` | `string` | — | URL slug for API and routing |
| `table` | `string` | — | PostgreSQL table name |
| `schema` | `string` | `"public"` | PostgreSQL schema name |
| `description` | `string` | — | Description shown in the UI (supports Markdown) |
| `icon` | `string \| ReactNode` | — | Lucide icon name or React element |
| `group` | `string` | `"Views"` | Sidebar group heading |
| `dataSource` | `string` | `"(default)"` | Data-source key — routes the collection to a backend registered on `<Rebase dataSources>` / `initializeRebaseBackend({ dataSources })`. See **Data sources & multiple backends** below. |
| `driver` | `string` | `undefined` | **Deprecated** — engine hint (`"postgres"`/`"firestore"`/`"mongodb"`). Prefer `dataSource`. When `dataSource` is omitted, `driver` doubles as the routing key. |
| `databaseId` | `string` | — | Physical DB/schema/Firestore-database within the engine |
| `history` | `boolean` | `false` | Enable snapshot audit trail (requires history plugin) |
| `defaultViewMode` | `ViewMode` | `"table"` | Default view: `"table"`, `"cards"`, `"kanban"`, `"list"` |
| `enabledViews` | `ViewMode[]` | `["table","cards","kanban"]` | Enabled view modes |
| `openSnapshotMode` | `"split" \| "side_panel" \| "full_screen" \| "dialog"` | `"full_screen"` | How snapshots open when clicked |
| `defaultSnapshotAction` | `"edit" \| "view"` | `"edit"` | Click behavior: open form or read-only view |
| `kanban` | `{ columnProperty: string }` | — | Kanban column config (requires enum property) |
| `propertiesOrder` | `string[]` | — | Field display order in forms and table |
| `snapshotViews` | `(string \| SnapshotCustomView)[]` | — | Custom tabs on snapshot detail |
| `titleProperty` | `string` | first text prop | Property used as snapshot title in previews |
| `previewProperties` | `string[]` | — | Properties shown when this collection is referenced |
| `listProperties` | `string[]` | — | Columns to display in list view |
| `selectionEnabled` | `boolean` | — | Enable row selection checkboxes |
| `selectionController` | `SelectionController` | — | External selection state controller |
| `inlineEditing` | `boolean` | — | Allow inline editing in collection table view |
| `exportable` | `boolean \| ExportConfig` | — | Enable data export. `true` for default, or `ExportConfig` for custom fields |
| `pagination` | `boolean \| number` | `true` (50) | Enable pagination. Set a number to customize page size |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | — | Default rendered row size |
| `fixedFilter` | `FilterValues` | — | Permanent filter that cannot be changed by users |
| `defaultFilter` | `FilterValues` | — | Initial filter (can be changed by users) |
| `filterPresets` | `FilterPreset[]` | — | Quick-access filter buttons in toolbar |
| `sort` | `[string, "asc" \| "desc"]` | — | Default sort order. E.g. `["created_at", "desc"]` |
| `orderProperty` | `string` | — | Property key for drag-and-drop ordering (Kanban/general) |
| `formAutoSave` | `boolean` | `false` | Auto-save form on field change |
| `formView` | `FormViewConfig` | — | Custom component replacing the default snapshot form |
| `hideFromNavigation` | `boolean` | `false` | Hide from sidebar (still accessible via URL) |
| `hideIdFromForm` | `boolean` | `false` | Hide ID field in snapshot form |
| `hideIdFromCollection` | `boolean` | `false` | Hide ID column in collection table |
| `defaultSelectedView` | `string \| Function` | — | Auto-open a custom view/subcollection tab |
| `sideDialogWidth` | `number \| string` | — | Width of side dialog in pixels |
| `alwaysApplyDefaultValues` | `boolean` | `false` | Re-apply defaults on every update |
| `includeJsonView` | `boolean` | `false` | Show a JSON tab in snapshot detail |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Local changes backup strategy |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | — | Disable built-in actions |
| `additionalFields` | `AdditionalFieldDelegate[]` | — | Virtual computed columns for views |
| `snapshotActions` | `SnapshotAction[]` | — | Custom action buttons (see Snapshot Actions section) |
| `Actions` | `ComponentRef[]` | — | Custom toolbar action components |
| `callbacks` | `CollectionCallbacks<M, USER>` | — | Lifecycle hooks (see Collection Callbacks section) |
| `relations` | `Relation[]` | — | Explicit relation definitions (usually auto-extracted from properties) |
| `securityRules` | `SecurityRule[]` | — | Row Level Security policies |
| `childCollections` | `() => CollectionConfig[]` | — | Nested child collections (populated automatically) |
| `overrides` | `SnapshotOverrides` | — | Override data source or storage source |
| `ownerId` | `string` | — | Owner user ID (for plugins/custom code) |
| `auth` | `boolean | AuthCollectionConfig` | — | Mark collection as authentication collection (user management, reset password, etc.) |
| `components` | `CollectionComponentOverrideMap` | — | Collection-scoped UI component overrides |


## Data sources & multiple backends

A collection lives in a **data source** identified by `collection.dataSource`
(default `"(default)"`). A data source has an **engine** (`postgres`,
`mongodb`, `firestore`, custom → drives editor capabilities) and a **transport**:

- **`server`** — through the Rebase backend/client. Covers Postgres, MongoDB,
  and any server-mediated engine. This is the default; such collections need no
  registration.
- **`direct`** — straight from the client to an external backend via its SDK
  (e.g. Firestore). The Rebase backend is not in the data path.
- **`custom`** — a developer-supplied `DataDriver`.

Register the non-default (direct/custom) sources once; server engines ride the
client and only need a backend bootstrapper.

```tsx
// Frontend — register direct/custom sources (Postgres rides the client)
<Rebase
  client={rebaseClient}
  dataSources={[
    { key: "analytics", engine: "firestore", transport: "direct", driver: firestoreDriver }
  ]}
/>

// A collection opts in by key:
{ slug: "events", dataSource: "analytics", properties: { /* … */ } }
```

```ts
// Backend — multiple engines in one instance (Postgres + MongoDB)
initializeRebaseBackend({
  bootstrappers: [pgBootstrapper /* isDefault */, mongoBootstrapper],
  // Declare direct/custom sources so the backend skips server routes for them:
  dataSources: [{ key: "analytics", engine: "firestore", transport: "direct" }],
  collections: [
    { slug: "products" },                  // → Postgres (default)
    { slug: "orders", driver: "mongodb" }  // → MongoDB
  ],
});
```

Routing is automatic and resolved by collection path: list/snapshot views,
references, board, import/export, and `context.data` all hit the right backend
with no per-collection wiring. The data-source key matches the backend
bootstrapper id/type (e.g. `"mongodb"`). RLS is applied per-engine where
supported. The deprecated `drivers={{ key: driver }}` prop is a shorthand for a
single `direct` `dataSources` entry.

> **Migration note:** collection-level `driver` is deprecated in favor of
> `dataSource`. It still works (and provides the engine hint), so existing
> Firestore collections using `driver: "firestore"` keep functioning.

## Common Property Options (BaseProperty)

All property types share these base options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | — | Display label for the field |
| `description` | `string` | — | Help text displayed under the field |
| `columnName` | `string` | auto from key | Explicit DB column name (bypasses snake_case conversion) |
| `validation` | `PropertyValidationSchema` | — | Validation rules (see below) |
| `defaultValue` | `unknown` | — | Default value for new snapshots |
| `propertyConfig` | `string` | — | Reuse a globally defined property config by key |
| `dynamicProps` | `(props) => Partial<Property>` | — | Dynamic property overrides based on snapshot values |
| `conditions` | `PropertyConditions` | — | JSON Logic-based declarative conditions |
| `callbacks` | `PropertyCallbacks` | — | Per-field `afterRead` and `beforeSave` hooks |

### UI Options (BaseUIConfig)

All property types support a `ui` object for display configuration:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ui.columnWidth` | `number` | — | Column width in pixels (table view) |
| `ui.hideFromCollection` | `boolean` | — | Hide from collection table view |
| `ui.readOnly` | `boolean` | — | Render as read-only preview |
| `ui.disabled` | `boolean \| PropertyDisabledConfig` | — | Disable editing |
| `ui.widthPercentage` | `number` | — | Width as percentage of form |
| `ui.customProps` | `unknown` | — | Custom props passed to the field component |
| `ui.Field` | `ComponentRef` | — | Custom field component |
| `ui.Preview` | `ComponentRef` | — | Custom preview/cell component |

## String Properties

```typescript
title: {
    name: "Title",
    type: "string",
    validation: { required: true, min: 3, max: 200 },
    multiline: false
}
```

### String-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columnType` | `"varchar" \| "text" \| "char" \| "uuid"` | `"varchar"` | Database column type |
| `isId` | `boolean \| "manual" \| "uuid" \| "cuid" \| string` | — | Mark as primary key with generation strategy |
| `enum` | `EnumValues` | — | Dropdown/picklist values |
| `multiline` | `boolean` | `false` | Multi-line text area |
| `markdown` | `boolean` | `false` | Markdown editor with preview. Uses the `RichTextEditor` component (`import { RichTextEditor } from "@rebasepro/admin/editor"`) — a full WYSIWYG editor supporting Markdown, JSON, and HTML output. |
| `url` | `boolean \| PreviewType` | — | Render as link. `PreviewType`: `"image"`, `"video"`, `"audio"`, `"file"` |
| `email` | `boolean` | — | Email field rendering |
| `storage` | `StorageConfig` | — | File upload configuration (see Storage section) |
| `userSelect` | `boolean` | — | Render as user picker (value = user ID) |
| `previewAsTag` | `boolean` | — | Render value as a colored tag/chip |
| `reference` | `ReferenceProperty` | — | Lightweight reference to another collection by ID |

### String isId Strategies

| Value | Behavior |
|-------|----------|
| `true` / `"manual"` | User-defined ID, must be entered manually |
| `"uuid"` | Auto-generated UUID via `gen_random_uuid()` |
| `"cuid"` | Auto-generated CUID |
| Any other string | Raw SQL default expression, e.g. `"nanoid()"` |

### String Validation

```typescript
validation: {
    required: true,
    min: 3,            // Minimum string length
    max: 200,          // Maximum string length
    matches: /^[a-z]+$/,  // Regex pattern (string or RegExp)
    matchesMessage: "Only lowercase letters allowed",
    unique: true,
    uniqueInArray: true,
    requiredMessage: "Title is required",
    trim: true,        // Trim whitespace before validation
    lowercase: true,   // Transform to lowercase before validation
    uppercase: false,   // Transform to uppercase before validation
}
```

### Storage Configuration (File Uploads)

When a string property has `storage`, it becomes a file upload field. The stored value is the file path (or URL) in your storage provider.

```typescript
avatar: {
    name: "Avatar",
    type: "string",
    storage: {
        storagePath: "avatars/{snapshotId}",
        acceptedFiles: ["image/*"],
        maxSize: 5 * 1024 * 1024, // 5MB
        fileName: "{rand}_{file.name}.{file.ext}",
        metadata: { cacheControl: "max-age=31536000" },
        imageResize: {
            maxWidth: 400,
            maxHeight: 400,
            mode: "cover",
            format: "webp",
            quality: 80
        },
        previewUrl: (path) => `https://cdn.example.com/${path}`,
        processFile: async (file) => { /* transform before upload */ return file; },
        postProcess: async (pathOrUrl) => { /* transform saved value */ return pathOrUrl; }
    }
}
```

| StorageConfig Option | Type | Default | Description |
|---------------------|------|---------|-------------|
| `storagePath` | `string \| (ctx) => string` | **required** | Upload destination path. Placeholders: `{file}`, `{file.name}`, `{file.ext}`, `{rand}`, `{snapshotId}`, `{propertyKey}`, `{path}` |
| `acceptedFiles` | `FileType[]` | all | Allowed MIME types. E.g. `["image/*"]`, `["application/pdf"]` |
| `maxSize` | `number` | — | Max file size in bytes |
| `fileName` | `string \| (ctx) => string` | — | Custom filename. Same placeholders as `storagePath` |
| `metadata` | `Record<string, unknown>` | — | Upload metadata (e.g. Firebase `UploadMetadata`) |
| `imageResize` | `ImageResize` | — | Resize images before upload |
| `previewUrl` | `(fileName) => string` | — | Custom preview URL builder |
| `processFile` | `(file: File) => Promise<File>` | — | Transform file before upload |
| `postProcess` | `(pathOrUrl) => Promise<string>` | — | Transform saved path/URL after upload |
| `includeBucketUrl` | `boolean` | `false` | Include bucket URL in saved path |
| `storeUrl` | `boolean` | `false` | Save download URL instead of storage path |
| `storageSource` | `string` | `undefined` (default backend) | Named storage source key — routes uploads to a specific backend registered in the backend `storage` map or in `storageSources` on `<Rebase>`. Must match a `StorageSourceDefinition.key`. |

#### Per-Property Backend Binding

When using multiple storage backends, use `storageSource` to route a specific property's uploads to a named backend:

```typescript
// Route this property's uploads to Firebase Storage
image: {
    type: "string",
    storage: {
        storageSource: "firebase",
        storagePath: "products/{snapshotId}",
        acceptedFiles: ["image/*"],
    }
}
```

### ImageResize Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxWidth` | `number` | — | Max width in pixels |
| `maxHeight` | `number` | — | Max height in pixels |
| `mode` | `"contain" \| "cover"` | `"contain"` | Resize fitting mode |
| `format` | `"original" \| "jpeg" \| "png" \| "webp"` | `"original"` | Output format |
| `quality` | `number` (0-100) | `80` | Quality for JPEG/WebP |

## Number Properties

```typescript
price: {
    name: "Price",
    type: "number",
    validation: { required: true, min: 0, positive: true }
}
```

### Number-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columnType` | `"integer" \| "real" \| "double precision" \| "numeric" \| "bigint" \| "serial" \| "bigserial"` | auto | Database column type |
| `isId` | `boolean \| "manual" \| "increment" \| string` | — | Mark as primary key |
| `enum` | `EnumValues` | — | Dropdown values |

### Number isId Strategies

| Value | Behavior |
|-------|----------|
| `true` / `"manual"` | User-defined numeric ID |
| `"increment"` | Auto-incrementing integer (`GENERATED BY DEFAULT AS IDENTITY`) |
| Any other string | Raw SQL default expression |

### Number Validation

```typescript
validation: {
    required: true,
    min: 0,
    max: 1000,
    lessThan: 1001,
    moreThan: -1,
    positive: true,
    negative: false,
    integer: true,
    unique: true
}
```

## Boolean Properties

```typescript
published: {
    name: "Published",
    type: "boolean",
    defaultValue: false,
    validation: { required: true }
}
```

No additional options beyond `BaseProperty`.

## Date Properties

```typescript
created_at: {
    name: "Created At",
    type: "date",
    mode: "date_time",
    autoValue: "on_create",
    clearable: false,
    ui: { readOnly: true }
}

updated_at: {
    name: "Updated At",
    type: "date",
    mode: "date_time",
    autoValue: "on_update",
    ui: { readOnly: true }
}
```

### Date-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columnType` | `"timestamp" \| "date" \| "time"` | `"timestamp"` | Database column type (with timezone) |
| `mode` | `"date" \| "date_time"` | `"date_time"` | Date-only or date + time picker |
| `autoValue` | `"on_create" \| "on_update"` | — | Auto-set timestamp on create or every update |
| `timezone` | `string` | — | Timezone string for display |
| `clearable` | `boolean` | `false` | Show clear button to set value to `null` |

### Date Validation

```typescript
validation: {
    required: true,
    min: new Date("2020-01-01"),
    max: new Date("2030-12-31")
}
```

## Map Properties (Nested Objects)

Maps store nested objects as `JSONB` in PostgreSQL. They can define their own inner properties schema.

```typescript
address: {
    name: "Address",
    type: "map",
    properties: {
        street: { name: "Street", type: "string" },
        city: { name: "City", type: "string", validation: { required: true } },
        zip: { name: "ZIP Code", type: "string" },
        country: { name: "Country", type: "string", enum: [
            { id: "US", label: "United States" },
            { id: "UK", label: "United Kingdom" }
        ]}
    },
    propertiesOrder: ["street", "city", "zip", "country"],
    ui: { expanded: true, spreadChildren: true }
}
```

### Map-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columnType` | `"json" \| "jsonb"` | `"jsonb"` | Database column type |
| `properties` | `Properties` | — | Nested property schema (same types as collection properties) |
| `propertiesOrder` | `string[]` | — | Display order of nested fields |
| `previewProperties` | `string[]` | — | Properties shown in preview/collapsed state |
| `keyValue` | `boolean` | — | Render as key-value table with arbitrary keys (no `properties` needed) |

### Map UI Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ui.expanded` | `boolean` | — | Expand map fields by default in forms |
| `ui.minimalistView` | `boolean` | — | Compact rendering |
| `ui.spreadChildren` | `boolean` | — | Spread child fields as if they were top-level form fields |

> **IMPORTANT FOR AGENTS:** If `validation.required` is not set on the map property itself, an empty object `{}` is considered valid even if inner properties have `required: true`. Always set `validation: { required: true }` on the map if the entire object is mandatory.

## Array Properties

Arrays can contain any element type (except nested arrays). They map to native Postgres arrays for primitives or `JSONB` for complex types.

```typescript
tags: {
    name: "Tags",
    type: "array",
    of: { type: "string" },
    validation: { min: 1, max: 10 }
}

gallery: {
    name: "Gallery",
    type: "array",
    of: {
        type: "string",
        storage: {
            storagePath: "products/{snapshotId}/gallery",
            acceptedFiles: ["image/*"]
        }
    }
}

metadata: {
    name: "Metadata",
    type: "array",
    of: {
        type: "map",
        properties: {
            key: { name: "Key", type: "string", validation: { required: true } },
            value: { name: "Value", type: "string" }
        }
    },
    ui: { expanded: true }
}
```

### Array-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columnType` | `"json" \| "jsonb" \| "text[]" \| "integer[]" \| "boolean[]" \| "numeric[]"` | auto | Database column type. Primitives default to native arrays |
| `of` | `Property \| Property[]` | — | Element type definition. Use a single `Property` for homogeneous arrays |
| `oneOf` | `{ properties, propertiesOrder?, typeField?, valueField? }` | — | Discriminated union for heterogeneous arrays (e.g. blog blocks) |
| `sortable` | `boolean` | `true` | Allow drag-and-drop reordering |
| `canAddElements` | `boolean` | `true` | Allow adding new elements |

### Array UI Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ui.expanded` | `boolean` | — | Expand array items by default |
| `ui.minimalistView` | `boolean` | — | Compact rendering |
| `ui.Field` | `ComponentRef` | — | Custom field component for the entire array |

### Array Validation

```typescript
validation: {
    required: true,
    min: 1,    // Minimum number of elements
    max: 20    // Maximum number of elements
}
```

### oneOf (Discriminated Union Arrays)

Use `oneOf` for content blocks with different types (e.g. blog content):

```typescript
content: {
    name: "Content Blocks",
    type: "array",
    oneOf: {
        typeField: "type",   // default: "type"
        valueField: "value", // default: "value"
        properties: {
            text: {
                name: "Text Block",
                type: "string",
                markdown: true
            },
            image: {
                name: "Image",
                type: "string",
                storage: { storagePath: "blog/{snapshotId}/content" }
            },
            quote: {
                name: "Quote",
                type: "map",
                properties: {
                    text: { name: "Quote Text", type: "string" },
                    author: { name: "Author", type: "string" }
                }
            }
        }
    }
}
// Stored as: [{ type: "text", value: "# Hello" }, { type: "image", value: "path/to/img.jpg" }]
```

## Property Validation

Every property supports a `validation` object with these common options:

| Option | Type | Applies To | Description |
|--------|------|-----------|-------------|
| `required` | `boolean` | All | Field is mandatory |
| `requiredMessage` | `string` | All | Custom error message when required validation fails |
| `unique` | `boolean` | All | Value must be unique across all snapshots |
| `uniqueInArray` | `boolean` | All | Value must be unique within parent array |
| `min` | `number \| Date` | String (length), Number, Date, Array (count) | Minimum value/length/count/date |
| `max` | `number \| Date` | String (length), Number, Date, Array (count) | Maximum value/length/count/date |
| `matches` | `string \| RegExp` | String | Regex pattern |
| `matchesMessage` | `string` | String | Error message for regex mismatch |
| `trim` | `boolean` | String | Trim whitespace before validation |
| `lowercase` | `boolean` | String | Transform to lowercase |
| `uppercase` | `boolean` | String | Transform to uppercase |
| `length` | `number` | String | Exact string length |
| `lessThan` | `number` | Number | Value must be less than |
| `moreThan` | `number` | Number | Value must be greater than |
| `positive` | `boolean` | Number | Value must be positive |
| `negative` | `boolean` | Number | Value must be negative |
| `integer` | `boolean` | Number | Value must be an integer |

## Enum Values

Use the `enum` property on `string` or `number` types to define picklist options:

```typescript
status: {
    name: "Status",
    type: "string",
    defaultValue: "draft",
    enum: [
        { id: "draft", label: "Draft", color: "gray" },
        { id: "published", label: "Published", color: "green" },
        { id: "archived", label: "Archived", color: "red", disabled: true }
    ]
}
```

Each `EnumValueConfig` entry supports:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string \| number` | Stored value |
| `label` | `string` | Display text |
| `color` | `ColorKey \| ColorScheme` | Optional chip color |
| `disabled` | `boolean` | Option is visible but not selectable |

`EnumValues` can also be a `Record<string, string | EnumValueConfig>` for simpler definitions:

```typescript
enum: {
    draft: "Draft",
    published: { label: "Published", color: "green" }
}
```

### PostgreSQL Enum Database Constraints

When `rebase schema generate` is run, any `string` property configured with an `enum` array generates a corresponding PostgreSQL `ENUM` type (e.g. `CREATE TYPE "public"."collection_property" AS ENUM('val1', 'val2')`).

If you write custom server functions, backend callback handlers, or perform manual database updates:
1. **Validation Constraints**: Pushing or inserting a value that is NOT defined in the collection's enum options array will trigger a PostgreSQL database-level check constraint error (e.g., `invalid input value for enum`).
2. **Adding Enum Options**: Adding a new enum value in code requires generating and applying a database migration (e.g., `pnpm db:generate` followed by `pnpm db:migrate` or raw enum modification SQL). In development, using a raw SQL command to alter the enum may be necessary because modifying PostgreSQL enums dynamically can be restrictive.


## Relations (Inline Property API)

Relations are defined **directly on the property** using `type: "relation"`. The framework automatically extracts these into the collection's internal `relations[]` at normalization time — you do **not** need a separate `relations[]` array.

### Many-to-One (Owning)

```typescript
import { PostgresCollectionConfig } from "@rebasepro/types";
import authorsCollection from "./authors";

const postsCollection: PostgresCollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        author: {
            name: "Author",
            type: "relation",
            target: () => authorsCollection,
            cardinality: "one",
            direction: "owning"
        }
    }
};
```

This automatically creates an `author_id` foreign key column on the `posts` table.

### Many-to-Many (Owning)

```typescript
tags: {
    name: "Tags",
    type: "relation",
    target: () => tagsCollection,
    cardinality: "many",
    direction: "owning"
}
```

This automatically creates a `posts_tags` junction table with `post_id` and `tag_id` columns.

### One-to-Many (Inverse)

```typescript
comments: {
    name: "Comments",
    type: "relation",
    target: () => commentsCollection,
    cardinality: "many",
    direction: "inverse",
    foreignKeyOnTarget: "post_id"
}
```

### Relation Property Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `target` | `string \| (() => CollectionConfig \| string)` | — | Target collection (use a function for lazy resolution to avoid circular imports) |
| `cardinality` | `"one" \| "many"` | `"one"` | Whether this references one or many records |
| `direction` | `"owning" \| "inverse"` | `"owning"` | Which side owns the FK or junction table |
| `localKey` | `string` | auto-inferred | Column on THIS table storing the FK (e.g. `"author_id"`) |
| `foreignKeyOnTarget` | `string` | auto-inferred | Column on TARGET table storing the FK (for inverse) |
| `through` | `{ table, sourceColumn, targetColumn }` | auto-inferred | Junction table config for many-to-many |
| `joinPath` | `JoinStep[]` | — | Explicit multi-hop join path (overrides all other join config) |
| `relationName` | `string` | property key | Override the relation name (defaults to the property key) |
| `inverseRelationName` | `string` | — | Name of the corresponding relation on the target collection |
| `onDelete` | `OnAction` | — | Cascade rule on delete |
| `onUpdate` | `OnAction` | — | Cascade rule on update |
| `overrides` | `Partial<CollectionConfig>` | — | Override target collection config when rendered as subcollection tab |
| `fixedFilter` | `FilterValues` | — | Filter applied when selecting related snapshots |
| `includeId` | `boolean` | `true` | Show snapshot ID in the reference preview |
| `includeSnapshotLink` | `boolean` | `true` | Show link to open the related snapshot |
| `isId` | `boolean` | — | Mark as primary key |
| `validation` | `{ required?: boolean }` | — | Relation-level validation |

### Relation UI Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `ui.widget` | `"select" \| "dialog"` | `"select"` | UI widget for selecting relations |
| `ui.previewProperties` | `string[]` | — | Properties shown in relation preview (max 3) |

### Cascade Rules (OnAction)

| Action | Behavior |
|--------|----------|
| `"cascade"` | Propagate change to related rows |
| `"restrict"` | Prevent if related rows exist |
| `"set null"` | Set FK to NULL |
| `"no action"` | Defer to constraint check |
| `"set default"` | Set FK to default value |

### Multi-Hop Joins (joinPath)

Use `joinPath` for advanced relationships that traverse multiple tables. When set, it overrides `localKey`, `foreignKeyOnTarget`, and `through`.

Each `JoinStep` defines one JOIN operation:

```typescript
interface JoinStep {
    table: string;          // Table to join TO
    on: {
        from: string | string[];  // Column(s) on the PREVIOUS table
        to: string | string[];    // Column(s) on THIS table
    };
}
```

**Example: Users → Permissions through Roles (4-table join)**

```typescript
permissions: {
    name: "Permissions",
    type: "relation",
    target: () => permissionsCollection,
    cardinality: "many",
    joinPath: [
        {
            table: "user_roles",
            on: { from: "id", to: "user_id" }         // users.id = user_roles.user_id
        },
        {
            table: "roles",
            on: { from: "role_id", to: "id" }          // user_roles.role_id = roles.id
        },
        {
            table: "role_permissions",
            on: { from: "id", to: "role_id" }          // roles.id = role_permissions.role_id
        },
        {
            table: "permissions",
            on: { from: "permission_id", to: "id" }    // role_permissions.permission_id = permissions.id
        }
    ]
}
```

**Example: Composite key join**

```typescript
customer: {
    name: "Customer",
    type: "relation",
    target: () => customersCollection,
    cardinality: "one",
    joinPath: [
        {
            table: "customers",
            on: {
                from: ["company_code", "region_id"],  // orders table columns
                to: ["code", "region_id"]             // customers table columns
            }
        }
    ]
}
```

> **See full documentation:** [Relations](https://rebase.pro/docs/collections/relations)

## Collection Callbacks (Lifecycle Hooks)

> **IMPORTANT FOR AGENTS**: Collections support **lifecycle callbacks** that let you run custom logic when snapshots are created, updated, read, or deleted. Use these to **sync data between collections**, transform data, validate business rules, or trigger side effects. **Do NOT use raw SQL triggers, cron jobs, or external scripts** when a callback can solve the problem.

### Generic Type Parameters

`CollectionCallbacks<M, USER>` accepts two generic type parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `M` | `Record<string, unknown>` | Snapshot values type — maps to your collection's property schema |
| `USER` | `User` | User type — extends the base `User` type with custom fields |

```typescript
import { PostgresCollectionConfig, CollectionCallbacks } from "@rebasepro/types";

interface Product {
    name: string;
    price: number;
    slug: string;
    status: string;
}

const callbacks: CollectionCallbacks<Product> = {
    beforeSave: async ({ values, status }) => {
        // `values` is typed as Partial<Product>
        if (values.name) {
            values.slug = values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        }
        return values;
    }
};
```

### RebaseCallContext\<USER\>

All callbacks receive a `context` property of type `RebaseCallContext<USER>`. This is the subset of the full `RebaseContext` that is available in both frontend and backend (server-side) execution:

| Property | Type | Description |
|----------|------|-------------|
| `context.client` | `RebaseClient` | Invoke backend functions, access APIs |
| `context.data` | `RebaseData` | Unified data access — `context.data.products.create(...)` |
| `context.storageSource` | `StorageSource` | File storage operations |
| `context.user` | `USER \| undefined` | Authenticated user (set by backend in server-side callbacks) |

### Reserved `context.user` Values

The `context.user` object is populated by the auth middleware. In server-side callbacks, it contains one of these reserved identities:

| Caller | `context.user.uid` | `context.user.roles` |
|---|---|---|
| JWT-authenticated end-user | Real user ID (e.g. `"abc123"`) | Their assigned roles (e.g. `["viewer"]`) |
| Server-side `rebase.data` (cron jobs, custom functions) | `"service"` | `["admin"]` |
| API key (default) | `"api-key:{id}"` | `["service"]` |
| API key (admin) | `"api-key:{id}"` | `["admin", "service"]` |
| Anonymous (no auth, `requireAuth: false`) | `"anon"` | `["anon"]` |
| Anonymous REST (no token) | `undefined` | N/A — `context.user` is not set; only the DataDriver is scoped |

> **IMPORTANT FOR AGENTS:** `rebase.data` calls (used in cron jobs, afterSave side-effects, custom functions) go through the full middleware pipeline with the service key, so callbacks see `uid: "service"`, `roles: ["admin"]`. Use this to gate behavior — e.g., skip PII masking for admin/service reads:
>
> ```typescript
> afterRead: async ({ row, context }) => {
>     // Server-side reads (cron jobs, admin) see real values
>     if (context.user?.roles?.includes("admin")) return row;
>     // End-user reads get masked values
>     return { ...row, email: "***@***.***" };
> }
> ```

> **WARNING FOR AGENTS:** Do NOT confuse `RebaseCallContext` (available in callbacks, both client & server) with `RebaseContext` (full context available only on the frontend, includes `authController`, `snackbarController`, `sideSnapshotController`, etc.). Snapshot callbacks always receive `RebaseCallContext`.

### Callback Example

```typescript
const jobSubmissionsCollection: PostgresCollectionConfig = {
    name: "Job Submissions",
    slug: "job_submissions",
    table: "job_submissions",
    callbacks: {
        // Runs BEFORE saving — transform or validate data
        beforeSave: async ({ values, status }) => {
            if (values.title) {
                values.slug = values.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            }
            if (status === "new") {
                values.created_at = new Date();
            }
            return values;
        },

        // Runs AFTER saving — trigger side effects, sync other collections
        afterSave: async ({ values, id, previousValues, context }) => {
            if (values.status === "approved" && previousValues?.status !== "approved") {
                await context.data.jobs.create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: id,
                });
            }
        },

        // Runs BEFORE deleting — block or validate
        beforeDelete: async ({ row }) => {
            if (row.status === "published") {
                throw new Error("Cannot delete published submissions");
            }
        },

        // Runs AFTER deleting — cleanup related data
        afterDelete: async ({ id, context }) => {
            console.log(`Submission ${id} deleted`);
        },

        // Runs AFTER reading — transform for display
        afterRead: async ({ row }) => {
            return {
                ...row,
                displayName: `${row.title} (${row.company_name})`
            };
        }
    },
    properties: { /* ... */ }
};
```

### Available Callbacks

| Callback | When It Runs | Return Value | Can Block? |
|----------|-------------|--------------|------------|
| `beforeSave` | Before write to DB (after validation) | Modified `values` (`Partial<SnapshotValues<M>>`) | Yes (throw to block) |
| `afterSave` | After successful write | `void` | No |
| `afterSaveError` | After a failed write | `void` | No |
| `afterRead` | After reading from DB | Modified row (`Record<string, unknown>`) | No |
| `beforeDelete` | Before deletion | `void \| boolean` | Yes (throw to block) |
| `afterDelete` | After successful deletion | `void` | No |

### Callback Props Reference

**`beforeSave` / `afterSave` / `afterSaveError` Props:**

| Prop | Type | Description |
|------|------|-------------|
| `values` | `Partial<SnapshotValues<M>>` | Snapshot values being saved |
| `id` | `string \| number` (optional in `beforeSave`) | Snapshot ID (`undefined` for new snapshots in `beforeSave`) |
| `previousValues` | `Partial<SnapshotValues<M>> \| undefined` | Previous values (for updates) |
| `status` | `SnapshotStatus` | `"new"`, `"existing"`, or `"copy"` |
| `collection` | `CollectionConfig<M>` | The collection definition |
| `path` | `string` | Collection path |
| `context` | `RebaseCallContext<USER>` | Context with `client`, `data`, `storageSource`, `user` |

**`afterRead` Props:**

| Prop | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | The fetched row (flat — `{ id, ...columns }`) |
| `collection` | `CollectionConfig<M>` | The collection definition |
| `path` | `string` | Collection path |
| `context` | `RebaseCallContext<USER>` | Context |

**`beforeDelete` / `afterDelete` Props:**

| Prop | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | The row being deleted (flat — `{ id, ...columns }`) |
| `id` | `string \| number` | Snapshot ID |
| `collection` | `CollectionConfig<M>` | The collection definition |
| `path` | `string` | Collection path |
| `context` | `RebaseCallContext<USER>` | Context |

### Property-Level Callbacks

Individual properties also support `callbacks` with `afterRead` and `beforeSave`:

```typescript
title: {
    name: "Title",
    type: "string",
    callbacks: {
        beforeSave: async ({ value, values }) => {
            // Transform just this property's value before saving
            return value?.trim().replace(/\s+/g, " ");
        },
        afterRead: async ({ value }) => {
            // Transform just this property's value after reading
            return value?.toUpperCase();
        }
    }
}
```

### Common Use Cases

- **Syncing data between collections** — Use `afterSave` to copy/move snapshots from one collection to another (e.g., approved submissions → published jobs)
- **Computed fields** — Use `beforeSave` to generate slugs, timestamps, or derived values
- **Validation** — Use `beforeSave` to enforce business rules beyond schema validation
- **Notifications** — Use `afterSave` to send emails, Slack messages, or webhook calls
- **Cascade operations** — Use `afterDelete` to clean up related records in other collections
- **Data enrichment** — Use `afterRead` to add computed/virtual fields for display

> **See full documentation:** [Collection Callbacks](https://rebase.pro/docs/collections/callbacks)

## Snapshot Actions (Custom UI Buttons)

> **IMPORTANT FOR AGENTS**: Collections support **custom action buttons** that appear in the collection table view and snapshot form. Use these for workflow actions like "Approve", "Send Email", "Export PDF", "Clone to Staging", etc. Do NOT build separate pages or scripts for common admin actions.

Add an `snapshotActions` array to any collection definition:

```typescript
const jobSubmissionsCollection: PostgresCollectionConfig = {
    name: "Job Submissions",
    slug: "job_submissions",
    table: "job_submissions",
    snapshotActions: [
        {
            name: "Approve",
            icon: <CheckCircleIcon />,
            // Only show for pending submissions
            isEnabled: ({ snapshot }) => snapshot?.values.status === "pending",
            onClick: async ({ snapshot, context, onCollectionChange }) => {
                if (!snapshot) return;
                await context.data.job_submissions.update(snapshot.id, {
                    status: "approved"
                });
                context.snackbarController?.open({
                    type: "success",
                    message: "Submission approved!"
                });
                onCollectionChange?.();
            }
        },
        {
            name: "Export PDF",
            collapsed: true,  // Show in overflow menu
            includeInForm: true,
            onClick: async ({ snapshot }) => {
                window.open(`/api/functions/export-pdf/${snapshot?.id}`);
            }
        }
    ],
    properties: { /* ... */ }
};
```

### SnapshotAction Interface

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | — | Button label |
| `key` | `string` | — | Override default actions: `"edit"`, `"delete"`, `"copy"` |
| `icon` | `ReactElement` | — | Optional icon |
| `onClick` | `(props: SnapshotActionClickProps) => void \| Promise<void>` | — | Action handler |
| `isEnabled` | `(props: SnapshotActionClickProps) => boolean` | — | Conditionally disable the action |
| `collapsed` | `boolean` | `true` | If `true`, show in overflow menu |
| `includeInForm` | `boolean` | `true` | Show in snapshot form view |
| `showActionsInListView` | `boolean` | `false` | Show inline on each row in list view |

### SnapshotActionClickProps

The `onClick` and `isEnabled` handlers receive:

| Prop | Type | Description |
|------|------|-------------|
| `snapshot` | `Snapshot<M> \| undefined` | The current snapshot |
| `context` | `RebaseContext<USER>` | Full context (includes `snackbarController`, `authController`, etc.) |
| `path` | `string \| undefined` | Collection path |
| `collection` | `CollectionConfig<M> \| undefined` | Collection definition |
| `formContext` | `FormContext \| undefined` | Form state (when called from a form) |
| `sideSnapshotController` | `SidePanelController \| undefined` | Side panel control |
| `selectionController` | `SelectionController \| undefined` | Multi-select state (collection view) |
| `view` | `"collection" \| "form"` | Where the action was triggered |
| `openSnapshotMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | How the snapshot form is opened |
| `highlightSnapshot` | `(snapshot) => void` | Highlight a snapshot row |
| `unhighlightSnapshot` | `(snapshot) => void` | Remove highlight |
| `navigateBack` | `() => void` | Navigate back (e.g., after deleting) |
| `onCollectionChange` | `() => void` | Refresh the collection view |

## Snapshot Custom Views (Tabs)

Collections support `snapshotViews` — custom React components that appear as **tabs** in the snapshot detail view. Use these for previews, analytics, related items, or any custom UI per snapshot.

Snapshot views can be registered:
1. **Globally** in the `<RebaseCMS>` component via the `snapshotViews` prop
2. **Per-collection** by referencing view keys in the collection's `snapshotViews` array

```typescript
// Global registration in App.tsx
const snapshotViews = [
    {
        key: "blog_preview",
        name: "Preview",
        Builder: BlogEntryPreview,
        position: "start" as const
    }
];

<RebaseCMS collections={collections} snapshotViews={snapshotViews}/>

// Per-collection reference in collection definition
const postsCollection: PostgresCollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    snapshotViews: ["blog_preview"],  // References the global view by key
    properties: { /* ... */ }
};
```

The `Builder` component receives:
- `snapshot` — The saved snapshot (may be `undefined` for new snapshots)
- `modifiedValues` — Current unsaved form values
- `formContext` — Form state and methods
- `collection` — The collection definition

### TypeScript Strict Checks in Custom Views

Under strict TypeScript checks (`strictNullChecks: true`), since `snapshot` is typed as optional (`snapshot?: Snapshot<M>`), accessing `snapshot.id` or `snapshot.values` directly will cause compilation errors like:
`error TS18048: 'snapshot' is possibly 'undefined'.`

Always add a guard clause at the very beginning of your custom view component to handle the undefined state:
```typescript
if (!snapshot) {
    return null; // or show a loading/error state
}
```
This narrows the type of `snapshot` for the remainder of the component, allowing safe property access (e.g. `snapshot.id`, `snapshot.values.field`).

## Snapshot Preview & Title Resolution

### Title Property Selection
By default, the property used as the snapshot's display title (previews, headers) is resolved as follows:
1. If `titleProperty` is explicitly specified on the collection, it is used.
2. If `propertiesOrder` is explicitly defined on the collection, the first non-ID property that is either a `relation` or `string` type is chosen as the title key.
3. If no `propertiesOrder` is defined, the framework searches the properties in order and picks the first string type property.

### Relation Previews in Tables
When `propertiesOrder` is explicitly set, relation properties are *not* automatically filtered out of the default preview columns (whereas they are excluded from unordered defaults to avoid slow join operations).

### resolveTitleToString Utility
Rebase provides a `resolveTitleToString(title: any): string` helper to turn complex snapshot title values (including dates, arrays, or relation shapes like `{ __type: "relation", id, data: { values } }`) into clean, renderable strings. It prioritizes common fields like `name`, `title`, `label`, and `displayName` from nested relation data, falling back to stringified IDs or JSON representations.

## Collection-Scoped Component Overrides

You can override built-in UI components for a specific collection by adding a `components` map to its definition. This is a collection-level implementation of Docusaurus-style swizzling.

Only collection-scoped components can be overridden here. App-level components (such as `Shell.AppBar` or `HomePage`) must be overridden globally at the `<Rebase>` root.

```typescript
import { PostgresCollectionConfig } from "@rebasepro/types";

const productsCollection: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    components: {
        // Eject Mode: Replace the empty state view entirely
        "Collection.EmptyState": { Component: ProductCustomEmptyState },
        
        // Wrap Mode: Wrap the built-in form, augmenting it
        "Snapshot.Form": {
            Component: ({ OriginalComponent, ...props }) => (
                <div>
                    <div className="bg-amber-100 p-2 text-amber-800 text-sm">Editing Product</div>
                    <OriginalComponent {...props} />
                </div>
            ),
            wrap: true
        }
    },
    properties: { ... }
};
```

### Collection-Scoped Overridable Components

| Component Key | Original Props | Description |
|---|---|---|
| `"Collection.View"` | `CollectionViewProps` | The entire collection landing page |
| `"Collection.Table"` | `CollectionTableProps` | The default table view |
| `"Collection.Card"` | `CollectionCardProps` | The card view item wrapper |
| `"Collection.EmptyState"` | `CollectionEmptyStateProps` | Displayed when a collection has no items |
| `"Collection.Actions"` | `CollectionActionsProps` | Toolbar buttons above the table/cards |
| `"Snapshot.Form"` | `SnapshotFormProps` | The detail form for creating/updating |
| `"Snapshot.FormActions"` | `SnapshotFormActionsProps` | Form submission/cancel button bar |
| `"Snapshot.DetailView"` | `SnapshotDetailViewProps` | Read-only detail view |
| `"Snapshot.SidePanel"` | `SnapshotSidePanelProps` | The side panel container for form/detail |
| `"Snapshot.Preview"` | `SnapshotPreviewProps` | Inline reference/relation chip preview |
| `"Snapshot.MissingReference"` | `MissingReferenceProps` | Rendered when a referenced snapshot is deleted or missing |

## Authentication Collection Configuration (auth)

You can mark a collection as an authentication collection by setting the `auth` property to `true` (shorthand for `{ enabled: true }`) or providing an `AuthCollectionConfig` object.

This is the collection used for user credentials, password hashing, and user management. Rebase auto-injects required auth actions (like resetting passwords) and routes them through this config.

```typescript
import { PostgresCollectionConfig } from "@rebasepro/types";

const customUsersCollection: PostgresCollectionConfig = {
    name: "Members",
    slug: "members",
    table: "members",
    auth: {
        enabled: true,
        // Override default user creation flow
        onCreateUser: async (values, ctx) => {
            const hash = await ctx.hashPassword("welcome123");
            return {
                values: { ...values, passwordHash: hash, emailVerified: true },
                temporaryPassword: "welcome123"
            };
        },
        // Override default password reset flow
        onResetPassword: async (userId, ctx) => {
            if (ctx.emailConfigured) {
                const tempPassword = "reset_" + Math.random().toString(36).substring(2, 8);
                const hash = await ctx.hashPassword(tempPassword);
                // Custom email sending or persistence
                return { temporaryPassword: tempPassword, invitationSent: false };
            }
            return { invitationSent: false };
        },
        // Override/disable default user management actions
        actions: {
            resetPassword: true // Or false to disable, or a custom SnapshotAction to replace the UI
        }
    },
    properties: { ... }
};
```

## Vector Properties

For similarity search and AI embeddings:

```typescript
embedding: {
    name: "Embedding",
    type: "vector",
    dimensions: 1536  // Required — must match your model's output dimensions
}
```

| Option | Type | Description |
|--------|------|-------------|
| `dimensions` | `number` | **Required.** Number of dimensions in the vector |

## Geopoint Properties

```typescript
location: {
    name: "Location",
    type: "geopoint"
}
// Stored as JSONB: { latitude: number, longitude: number }
```

## Security Rules (RLS)

Collections support **Row Level Security** via the `securityRules` array. This generates PostgreSQL RLS policies:

```typescript
const postsCollection: PostgresCollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    securityRules: [
        // Anyone can read published posts
        { operation: "select", access: "public", using: "{status} = 'published'" },
        // Authors can see/edit their own
        { operations: ["select", "insert", "update"], ownerField: "author_id" },
        // Only admins can delete
        { operation: "delete", roles: ["admin"] }
    ],
    properties: { /* ... */ }
};
```

### Security Rule Types

Rules are a discriminated union — you must use exactly one of: `ownerField`, `access: "public"`, raw `using`/`withCheck`, or roles-only. They cannot be mixed (enforced at the type level).

| Variant | Key Field | Generates |
|---------|-----------|-----------|
| `OwnerSecurityRule` | `ownerField: "user_id"` | `USING (user_id = auth.uid())` |
| `PublicSecurityRule` | `access: "public"` | `USING (true)` |
| `RawSQLSecurityRule` | `using: "..."` | Custom USING/WITH CHECK clause |
| `RolesOnlySecurityRule` | (none of the above) | Roles-only, no row filter |

### Common Options (SecurityRuleBase)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | auto-generated | Human-readable policy name (must be unique per table) |
| `operation` | `SecurityOperation` | `"all"` | Single operation: `"select"`, `"insert"`, `"update"`, `"delete"`, `"all"` |
| `operations` | `SecurityOperation[]` | — | Multiple operations (generates one policy per operation) |
| `mode` | `"permissive" \| "restrictive"` | `"permissive"` | Permissive rules are OR'd; restrictive are AND'd |
| `roles` | `string[]` | — | Application-level roles (Rebase roles, NOT Postgres roles). Can be combined with any variant |
| `pgRoles` | `string[]` | `["public"]` | Advanced: native PostgreSQL database roles for the `TO` clause |

### SQL Context Functions

In raw SQL expressions (`using`, `withCheck`), these functions are available:
- `auth.uid()` — the current user's ID
- `auth.roles()` — comma-separated app role IDs
- `auth.jwt()` — full JWT claims as JSONB
- `{column_name}` — resolves to `table.column_name`

> **See full documentation:** [Security Rules](https://rebase.pro/docs/collections/security-rules)

## Dynamic Properties (Conditions)

For declarative, JSON-serializable dynamic behavior, use `conditions` instead of `dynamicProps`:

```typescript
discount_percentage: {
    name: "Discount %",
    type: "number",
    conditions: {
        // Only show when sale_enabled is true
        hidden: { "!": { "var": "values.sale_enabled" } },
        // Required when visible
        required: { "var": "values.sale_enabled" },
        // Min 0, max 100
        min: 0,
        max: 100
    }
}
```

Available condition fields: `disabled`, `disabledMessage`, `clearOnDisabled`, `hidden`, `readOnly`, `required`, `requiredMessage`, `min`, `max`, `defaultValue`, `enumConditions`, `allowedEnumValues`, `excludedEnumValues`, `referencePath`, `referenceFilter`, `canAddElements`, `sortable`, `acceptedFiles`, `maxFileSize`.

## Schema Migration Workflow

After modifying collections, apply changes to the database:

```bash
# All commands run from the project root directory unless noted

# 1. Regenerate the Drizzle schema from your collection definitions
rebase schema generate

# 2a. Development — push changes directly
rebase db push

# 2b. Production — generate and review migration files
rebase db generate
rebase db migrate
```

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
