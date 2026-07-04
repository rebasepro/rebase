# @rebasepro/sdk-generator

Generates typed TypeScript definitions from Rebase collection definitions — produces `Database` interface with `Row`, `Insert`, and `Update` types for each collection.

## Installation

```bash
pnpm add @rebasepro/sdk-generator
```

### Peer Dependencies

- `@rebasepro/common`
- `@rebasepro/types`

## What This Package Does

`@rebasepro/sdk-generator` takes an array of `CollectionConfig` definitions and produces TypeScript type files that provide full autocompletion when used with `@rebasepro/client`. It handles property types, enums, relations, maps, arrays, geopoints, vectors, and validation-based optionality.

This is typically invoked via the CLI (`npx rebase generate-sdk`) rather than called directly.

## Key Exports

| Export | Type | Description |
|---|---|---|
| `generateSDK` | Function | Main entry — returns array of `GeneratedFile` objects |
| `generateTypedefs` | Function | Generates the `database.types.ts` content string |
| `GeneratedFile` | Interface | `{ path: string; content: string }` |
| `GenerateSDKOptions` | Interface | `{ includeReadme?: boolean }` (default: `true`) |
| `toPascalCase` | Function | `"my_collection"` → `"MyCollection"` |
| `toCamelCase` | Function | `"my_collection"` → `"myCollection"` |
| `toSafeIdentifier` | Function | Converts slugs to valid JS identifiers |
| `indent` | Function | Indent text by N spaces |

## Generated Output

`generateSDK()` produces:

1. **`database.types.ts`** — A `Database` interface where each collection slug is a key containing:
   - `Row` — Full snapshot type (read operations)
   - `Insert` — Type for creating snapshots (auto-ID fields are optional)
   - `Update` — All-optional partial type for updates

2. **`README.md`** — Usage instructions (opt out with `includeReadme: false`)

### Property Type Mapping

| Rebase Type | TypeScript Type |
|---|---|
| `string` | `string` (or union of enum values) |
| `number` | `number` (or union of enum values) |
| `boolean` | `boolean` |
| `date` | `string` (ISO 8601) |
| `geopoint` | `{ latitude: number; longitude: number }` |
| `reference` | `string \| number` |
| `relation` | Relation object type |
| `map` | Inline object type or `Record<string, any>` |
| `array` | `Array<T>` with inferred inner type |
| `vector` | `number[]` |
| `binary` | `string` |

## Quick Start

```typescript
import { generateSDK } from "@rebasepro/sdk-generator";
import type { CollectionConfig } from "@rebasepro/types";

const collections: CollectionConfig[] = [/* your collections */];

const files = generateSDK(collections);
// files = [
//   { path: "database.types.ts", content: "..." },
//   { path: "README.md", content: "..." }
// ]

for (const file of files) {
    fs.writeFileSync(path.join(outputDir, file.path), file.content);
}
```

## Related Packages

- `@rebasepro/client` — Consumes the generated types for typed API calls
- `@rebasepro/types` — Provides `CollectionConfig`, `Property`, and related type definitions
- `@rebasepro/common` — Provides `resolveCollectionRelations` used during generation
