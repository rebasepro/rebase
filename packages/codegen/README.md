# @rebasepro/codegen

Generates typed TypeScript definitions from Rebase table descriptors — produces `Database` interface with `Row`, `Insert`, and `Update` types for each collection.

## Installation

```bash
pnpm add @rebasepro/codegen
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

### Dependencies

- `@rebasepro/common` — a runtime dependency (naming helpers)
- `@rebasepro/types` — a peer dependency (types only)

## What This Package Does

`@rebasepro/codegen` takes the compiled table descriptors — `TableDescriptor[]`, what `compileTables` from `@rebasepro/common` returns and `GET /api/schema/tables` serves — and produces TypeScript type files that provide full autocompletion when used with `@rebasepro/client`. It handles every Postgres column type, enums and `.oneOf()` unions, relations and junction pivots, JSON documents typed from their shapes, geopoints, vectors, and insert optionality from defaults, identities and stamps.

This is typically invoked via the CLI (`pnpm rebase generate-sdk`) rather than called directly.

## Key Exports

| Export | Type | Description |
|---|---|---|
| `generateSDK` | Function | Main entry — returns array of `GeneratedFile` objects |
| `generateTypedefs` | Function | Generates the `database.types.ts` content string |
| `GeneratedFile` | Interface | `{ path: string; content: string }` |
| `GenerateSDKOptions` | Interface | `{ includeReadme?: boolean }` (default: `true`) |
| `toPascalCase` | Function | `"order_items"` → `"OrderItems"` |
| `toCamelCase` | Function | `"order_items"` → `"orderItems"` |
| `toSafeIdentifier` | Function | Converts a **slug** to a valid JS identifier (table accessors only — never column names) |
| `indent` | Function | Indent text by N spaces |
| `CodegenError` | Class | Thrown for a schema that cannot be expressed as valid TypeScript |

## Generated Output

`generateSDK()` produces:

1. **`database.types.ts`** — A `Database` interface keyed by each table's
   *accessor* (`my-notes` → `myNotes`, the property name on `client.data`),
   alongside a `tablesDictionary` const mapping each accessor back to the
   slug the wire uses, its `TablesDictionary` type and `TableName`, the union
   of every slug. Each entry contains:
   - `Row` — what a read serves, keyed by each column's **wire** key: a column
     keyed `createdAt` is `row.createdAt` whatever its SQL name, and a
     `belongsTo` named `author` gives `row.authorId`. Nullable columns are `T | null`,
     the primary key is always present, relations appear only when `include`
     names them, and `.private()` columns are absent.
   - `Insert` — what `create()` accepts. Server-assigned ids, defaults and
     stamps are optional; a `belongsTo` target may be named either way
     (`{ author: 5 }` or `{ authorId: 5 }`); `.private()` columns are absent
     here too. A view's is `never`.
   - `Update` — what `update()` accepts. Everything optional, primary key
     omitted, `.private()` columns absent. A view's is `never`.

`.private()` means one thing in all three: the API surface does not mention
the column, in either direction. The server refuses a write naming such a
field, with `VALIDATION_EXCLUDED_FIELDS`, and nothing generated names it, so a
generated client cannot offer a password
hash as something to read, filter or send.

2. **`README.md`** — Usage instructions (opt out with `includeReadme: false`)

### Names

A column key you wrote is emitted verbatim, quoted when it is not a valid
identifier (`"user id"?: string | null`), because `where` and `orderBy` are keyed
off `Row` — a renamed key makes the correct filter fail to compile and the wrong
one fail at runtime. Only the two derived names are transformed, both to
camelCase: the table accessor, and a foreign key that comes from a relation.

Generation **fails** rather than emitting a broken file when two slugs would
produce the same accessor: the interface would not compile, and
`tablesDictionary` would silently keep only one, routing one table's
reads to another.

### Untrusted schemas

`rebase generate-sdk --from <url>` generates from a remote contract, so slugs,
column names and enum values come from that server. Every one of them is emitted
as an escaped literal — untrusted input cannot add a declaration to the generated
file. There is a test that asserts exactly this.

### Column Type Mapping

| Column | TypeScript Type |
|---|---|
| `text`, `varchar`, `char`, `uuid` | `string` (or the union of its `.oneOf()` values) |
| `enum` | the union of its values |
| every integer, `real`, `doublePrecision`, `numeric` | `number` (or the union of its `.oneOf()` values) |
| `boolean` | `boolean` |
| `timestamptz`, `date`, `time` | `string` (ISO 8601) |
| `geopoint` | `{ latitude: number; longitude: number }` |
| `jsonb` / `json` with a shape | the shape's type; without one `Record<string, unknown>` |
| `array(inner)` | `Array<T>` of the inner column's type |
| `vector` | `number[]` |
| `bytea` | `string` (base64) |
| `custom` | `unknown` |
| a relation | the target's own `Row`, inlined (what `include` serves) |

## Quick Start

```typescript
import { generateSDK } from "@rebasepro/codegen";
import { compileTables } from "@rebasepro/common";
import { posts, users } from "./backend/schema";

const files = generateSDK(compileTables([posts, users]));
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
- `@rebasepro/types` — Provides `TableDescriptor` and the column and relation types it reads
- `@rebasepro/common` — Provides `compileTables`, which turns `defineTable` results into descriptors
