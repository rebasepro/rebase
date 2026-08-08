# @rebasepro/codegen

Generates typed TypeScript definitions from Rebase collection definitions — produces `Database` interface with `Row`, `Insert`, and `Update` types for each collection.

## Installation

```bash
pnpm add @rebasepro/codegen
```

### Dependencies

- `@rebasepro/common` — a runtime dependency (`resolveCollectionRelations`)
- `@rebasepro/types` — a peer dependency (types only)

## What This Package Does

`@rebasepro/codegen` takes an array of `CollectionConfig` definitions and produces TypeScript type files that provide full autocompletion when used with `@rebasepro/client`. It handles property types, enums, relations, maps, arrays, geopoints, vectors, and validation-based optionality.

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
| `toSafeIdentifier` | Function | Converts a **slug** to a valid JS identifier (collection accessors only — never column names) |
| `indent` | Function | Indent text by N spaces |
| `CodegenError` | Class | Thrown for a schema that cannot be expressed as valid TypeScript |

## Generated Output

`generateSDK()` produces:

1. **`database.types.ts`** — A `Database` interface keyed by each collection's
   *accessor* (`my-notes` → `myNotes`, the property name on `client.data`),
   alongside a `collectionsDictionary` const mapping each accessor back to the
   slug the wire uses. Each entry contains:
   - `Row` — what a read serves. Column names are the **real** ones, unchanged:
     a `created_at` column is `row.created_at`. Nullable columns are `T | null`,
     the primary key is always present, relations appear only when `include`
     names them, and `excludeFromApi` columns are absent.
   - `Insert` — what `create()` accepts. Server-assigned ids are optional; a
     `belongsTo` target may be named either way (`{ author: 5 }` or
     `{ author_id: 5 }`); `excludeFromApi` columns are absent here too.
   - `Update` — what `update()` accepts. Everything optional, primary key
     omitted, `excludeFromApi` columns absent.

`excludeFromApi` means one thing in all three: the API surface does not mention
the property, in either direction. The server still accepts such a field on a
write — this is what the generated types describe, not a new enforcement point —
but nothing generated names it, so a generated client cannot offer a password
hash as something to read, filter or send.

2. **`README.md`** — Usage instructions (opt out with `includeReadme: false`)

### Names

Only the collection accessor is transformed. Column names are emitted verbatim,
quoted when they are not valid identifiers (`"user id"?: string | null`), because
`where` and `orderBy` are keyed off `Row` — a renamed column makes the correct
filter fail to compile and the wrong one fail at runtime.

Generation **fails** rather than emitting a broken file when two slugs would
produce the same accessor: the interface would not compile, and
`collectionsDictionary` would silently keep only one, routing a collection's
reads to another's table.

### Untrusted schemas

`rebase generate-sdk --from <url>` generates from a remote contract, so slugs,
column names and enum values come from that server. Every one of them is emitted
as an escaped literal — untrusted input cannot add a declaration to the generated
file. There is a test that asserts exactly this.

### Property Type Mapping

| Rebase Type | TypeScript Type |
|---|---|
| `string` | `string` (or union of enum values) |
| `number` | `number` (or union of enum values) |
| `boolean` | `boolean` |
| `date` | `string` (ISO 8601) |
| `geopoint` | `{ latitude: number; longitude: number }` |
| `reference` | `string \| number` |
| `relation` | The target's own `Row`, inlined (what `include` serves) |
| `map` | Inline object type or `Record<string, unknown>` |
| `array` | `Array<T>` with inferred inner type |
| `vector` | `number[]` |
| `binary` | `string` |

## Quick Start

```typescript
import { generateSDK } from "@rebasepro/codegen";
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
