# @rebasepro/inference

Infer Rebase collection property schemas from sample data: field types, enums, `required`, `email` / `url`, storage fields, and nested maps and arrays.

## Installation

```bash
pnpm add @rebasepro/inference
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

## What This Package Does

`@rebasepro/inference` examines arrays of data objects and produces `Properties` definitions compatible with the Rebase collection schema. It counts the types each field holds to pick one: a column that mixes numbers with text that is not exactly a number is a string. It also detects enum values and builds nested map/array structures. A `"reference"` property is built only when your `getType` returns `"reference"`; the default `inferTypeFromValue` never does. The admin's "create a collection from a file" import is its consumer in Rebase; database introspection does not use it.

## Key Exports

### Collection Builder

| Export | Type | Description |
|---|---|---|
| `buildEntityPropertiesFromData` | `(data: object[], getType: InferenceTypeBuilder, options?: { ignoreKey?: (key: string) => boolean }) => Promise<Properties>` | Main entry — infer full property schema from data. `ignoreKey` leaves top-level keys out (none by default) |
| `buildPropertyFromData` | `(data: unknown[], property: Property, getType: InferenceTypeBuilder) => Property` | Refine an existing property with new sample data |
| `buildPropertiesOrder` | `(properties: Properties, propertiesOrder?: string[], priorityKeys?: string[]) => string[]` | Sort property keys (title/name first, then images, then alphabetical) |
| `inferTypeFromValue` | `(value: unknown) => DataType` | Default type inference: string, number, boolean, date, array, map, vector |
| `InferenceTypeBuilder` | Type | `(value: unknown) => DataType` — pluggable type detector |

### String Utilities

| Export | Description |
|---|---|
| `parseReferenceString` | Parse `"path/entityId"` or `"db:::path/entityId"` format |
| `looksLikeReference` | Check if a string looks like a document reference |
| `findCommonInitialStringInPath` | Find shared collection path prefix in sample values |
| `removeInitialAndTrailingSlashes` | Path cleanup |
| `removeInitialSlash` / `removeTrailingSlash` | Path cleanup |

### General Utilities (re-exported from `@rebasepro/utils`)

| Export | Description |
|---|---|
| `extractEnumFromValues` | Extract enum entries from sample string values |
| `resolveEnumValues` | Normalize `EnumValues` to `EnumValueConfig[]` |
| `prettifyIdentifier` | `"snake_case"` → `"Snake Case"` |
| `unslugify` | `"my-slug"` → `"My Slug"` |
| `mergeDeep` | Deep merge objects |

## Quick Start

```typescript
import {
    buildEntityPropertiesFromData,
    inferTypeFromValue
} from "@rebasepro/inference";

const sampleData = [
    { name: "Alice", age: 30, active: true, role: "admin" },
    { name: "Bob", age: 25, active: false, role: "editor" },
    { name: "Carol", age: 28, active: true, role: "admin" },
    { name: "Dan", age: 41, active: true, role: "editor" },
    { name: "Eve", age: 35, active: false, role: "admin" },
    { name: "Frank", age: 52, active: true, role: "editor" },
    { name: "Grace", age: 23, active: true, role: "admin" },
];

const properties = await buildEntityPropertiesFromData(
    sampleData,
    inferTypeFromValue
);
// properties = {
//   name: { type: "string", name: "Name", validation: { required: true } },
//   age:  { type: "number", name: "Age", validation: { required: true } },
//   active: { type: "boolean", name: "Active", validation: { required: true } },
//   role: { type: "string", name: "Role", enum: [...], validation: { required: true } }
// }
// An enum is inferred when a column has fewer distinct values than a third of its values.
```

## Related Packages

- `@rebasepro/types` — Provides `Property`, `DataType`, `Properties`, and related types
- `@rebasepro/utils` — General utilities re-exported by this package
