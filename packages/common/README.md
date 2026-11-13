# @rebasepro/common

The schema compiler, the table helpers, the data driver adapter and the fluent query builder shared across Rebase packages.

## Installation

```bash
pnpm add @rebasepro/common
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. It needs Node `>=22.22.0` (its `engines` floor), where `require()`
of it resolves too: Node has supported `require(esm)` since 22.12.

## What This Package Does

`@rebasepro/common` is the lowest-level shared logic layer in the Rebase frontend stack. It provides:

- **The schema compiler** — `compileTables` / `compileSchema` turn `defineTable` results into the descriptors the backend serves
- **Table helpers** — column codecs, write defaults and stamps, storage and user-column positions, field-operation bounds, read over a `TableDescriptor`
- **SDK data over a driver** — `buildSdkData()` turns any `DataDriver` into the SDK's data surface (`data.products.find()`, `data.table(slug)`), serving rows as the REST API does; `buildRoutedSdkData()` routes it across data sources
- **Query helpers** — `or()`, `and()`, `not()`, `cond()` for composing complex filters
- **Policy, tenant, storage and identity helpers** over table descriptors

This package has no React dependency — it's pure TypeScript and can be used in both client and server contexts.

## Key Exports

### Data

| Export | Description |
|---|---|
| `buildSdkData(driver, options?)` | The SDK's data surface over a `DataDriver` — what `rebase.data` and a hook's `context.data` are. Property access like `data.products` returns an `SDKTableClient` for that table's slug (camelCase → snake_case); `data.table(slug)` names one explicitly. Rows are served as the REST API serves them. |
| `buildRoutedSdkData(params)` | The same surface over several data sources, each table routed to its driver |
| `createDriverTableRows(driver, slug)` | Every read, write, count, aggregate, trash and listen of one table over a driver, rows as served — what `buildSdkData` is built on |
| `or(...conditions)` | Create an OR logical condition |
| `and(...conditions)` | Create an AND logical condition |
| `cond(column, op, value)` | Create a single filter condition |

### The schema compiler

| Export | Description |
|---|---|
| `compileTables(defs, options?)` | Compiles `defineTable` / `defineAuthTable` / `defineView` results into `TableDescriptor[]` — the form the backend serves, the SDK generator reads and the schema version hashes. Throws one `SchemaDefinitionError` naming every problem. New in 0.31. |
| `compileSchema(defs, options?)` | The same descriptors as `compileTables`, each with its definition and its server-only parts (hooks, column transforms, auth lifecycle): the `CompiledTable`s a driver opens on (`openRebase({ tables })`, `openPostgresDriver(config, { tables })`). New in 0.31. |
| `SchemaDefinitionError` | What the compiler throws: every table and key that is wrong, with what to write instead. New in 0.31. |

### Hooks

| Export | Description |
|---|---|
| `composeTableHooks(...sets)` | Combines several sets of table hooks into one, run in order, the way the backend combines its global and table tiers. New in 0.31. |
| `createCallContext(partial)` | Builds the `context` a table hook receives, so a test can call a hook directly; a missing `client`, `data` or `storageSource` throws on first use, naming itself. New in 0.25. |

### Deprecation

| Export | Description |
|---|---|
| `warnDeprecated(key, message)` | Prints `[Rebase] Deprecated: <message>` once per process per key. What Rebase's own deprecated aliases call, and usable by a plugin or library for its own. New in 0.25. |

### Table helpers

New in 0.31, each reading a `TableDescriptor`:

| Export | Description |
|---|---|
| `valueCodecOf`, `valueCodecOfType`, `restCodecOf` | How a column's value is written to and read from Postgres and the wire |
| `fieldOperationBounds` | The bounds a field operation (`$inc`, `$push`, `$pull`) must respect |
| `applyCreateDefaults`, `applyStamps` | The defaults and the `.onCreateNow()` / `.onUpdateUser()` … stamps a write gets, at any depth of a JSON column |
| `storagePositions`, `storageAt`, `userReferencePositions`, `referencesUsers` | Where a table holds storage keys and user ids |
| `checkTableOperation` | Whether a role may run an operation on a table |

### Migration (`@rebasepro/common/migrate`)

The lift from the 0.30 collection model (`collectionsToTableDefs`,
`collectionToTableDef`, `LiftNote`, `LiftResult`, `LiftOptions`), a frozen copy
of that model (`Legacy…` types) and `defineLegacyCollection`. What
`rebase migrate collections-to-tables` runs; nothing on a runtime path imports
it. New in 0.31.

### Utilities

| Module | Contents |
|---|---|
| `policy` | The policy compiler over table descriptors (`compilePolicyExpression`, the default admin policies, junction policies) |
| `relations` | Relation helpers over descriptors (`getTableVarName`, `getEnumVarName`) |
| `tenant` | Tenant scoping of reads and writes |
| `identity`, `email` | Identity and email-address helpers |
| `resumable-upload`, `download-url-cache` | Storage upload and download helpers |
| `internal-tables`, `sql-rows`, `sql-redaction` | Rebase's own tables, raw SQL rows, redacting SQL for logs |

The panel's helpers over the collection view model — conditions, permissions,
property resolution, relation resolution, the collection-shaped policy
helpers, `CollectionRegistry`, `composeCallbacks` — moved to
[`@rebasepro/cms-types`](https://www.npmjs.com/package/@rebasepro/cms-types)
in 0.31. Backend code composes a table's hooks with `composeTableHooks`.

## Quick Start

```ts
import { buildSdkData, or, cond } from "@rebasepro/common";

// The SDK's data surface over a DataDriver
const data = buildSdkData(myDriver);

// Access tables by name (camelCase auto-converts to snake_case)
const { data: products } = await data.products.find({ limit: 10 });
const product = await data.products.findById("abc-123");

// Fluent query builder
const { data: results } = await data.products
    .where("status", "==", "published")
    .orderBy("created_at", "desc")
    .limit(20)
    .find();

// Complex logical queries
const { data: filtered } = await data.products
    .where(or(
        cond("category", "==", "electronics"),
        cond("price", ">=", 100)
    ))
    .find();
```

## Related Packages

- [`@rebasepro/types`](../types) — `DataDriver`, `SDKTableClient`, `FindResult`, etc.
- [`@rebasepro/cms-types`](../cms-types) — the admin panel's accessor and view model: `buildRebaseData`, `QueryBuilder`, `Entity`, `TableAccessor`, `RebaseData` (moved here in 0.31)
- [`@rebasepro/utils`](../utils) — Low-level utilities (`toSnakeCase`, etc.)
- [`@rebasepro/app`](../app) — Runtime layer that consumes `@rebasepro/common`
- [`@rebasepro/client`](../client) — the HTTP client: the same SDK surface over REST
