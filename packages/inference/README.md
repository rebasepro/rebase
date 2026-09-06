# @rebasepro/inference

Automatically infer Rebase collection property schemas from sample data — analyzes field types, detects enums, references, validation rules, and nested structures.

## Installation

```bash
pnpm add @rebasepro/inference
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. `require()` of it resolves only on Node 22.12+, which supports
`require(esm)`.

## What This Package Does

`@rebasepro/inference` examines arrays of data objects and produces `Properties` definitions compatible with the Rebase collection schema. It uses statistical analysis to determine the most probable type for each field, detect enum values, identify reference patterns, and build nested map/array structures. Used by the Rebase introspection pipeline and data import tools.

## Key Exports

### Collection Builder

| Export | Type | Description |
|---|---|---|
| `buildSnapshotPropertiesFromData` | `(data: object[], getType: InferenceTypeBuilder) => Promise<Properties>` | Main entry — infer full property schema from data |
| `buildPropertyFromData` | `(data: unknown[], property: Property, getType: InferenceTypeBuilder) => Property` | Refine an existing property with new sample data |
| `buildPropertiesOrder` | `(properties: Properties, propertiesOrder?: string[], priorityKeys?: string[]) => string[]` | Sort property keys (title/name first, then images, then alphabetical) |
| `inferTypeFromValue` | `(value: unknown) => DataType` | Default type inference: string, number, boolean, array, map, vector |
| `InferenceTypeBuilder` | Type | `(value: unknown) => DataType` — pluggable type detector |

### String Utilities

| Export | Description |
|---|---|
| `parseReferenceString` | Parse `"path/snapshotId"` or `"db:::path/snapshotId"` format |
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
    buildSnapshotPropertiesFromData,
    inferTypeFromValue
} from "@rebasepro/inference";

const sampleData = [
    { name: "Alice", age: 30, active: true, role: "admin" },
    { name: "Bob", age: 25, active: false, role: "editor" },
    { name: "Carol", age: 28, active: true, role: "admin" },
];

const properties = await buildSnapshotPropertiesFromData(
    sampleData,
    inferTypeFromValue
);
// properties = {
//   name: { type: "string", name: "Name", ... },
//   age:  { type: "number", name: "Age", ... },
//   active: { type: "boolean", name: "Active", ... },
//   role: { type: "string", name: "Role", enum: [...], ... }
// }
```

## Related Packages

- `@rebasepro/types` — Provides `Property`, `DataType`, `Properties`, and related types
- `@rebasepro/utils` — General utilities re-exported by this package
