# @rebasepro/common

Shared utilities, collection registry, data driver adapter, and fluent query builder used across Rebase packages.

## Installation

```bash
pnpm add @rebasepro/common
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. `require()` of it resolves only on Node 22.12+, which supports
`require(esm)`.

## What This Package Does

`@rebasepro/common` is the lowest-level shared logic layer in the Rebase frontend stack. It provides:

- **Collection utilities** — collection registry, default collection definitions, path resolution, navigation helpers
- **Data driver adapter** — `buildRebaseData()` bridges any `DataDriver` implementation into a `RebaseData` proxy with typed collection accessors
- **Query builder** — fluent `QueryBuilder` class plus `or()`, `and()`, `cond()` helpers for composing complex queries
- **Snapshot/property utilities** — snapshot resolution, enum helpers, permission checks, reference/relation helpers, storage path utils, callback utilities

This package has no React dependency — it's pure TypeScript and can be used in both client and server contexts.

## Key Exports

### Data

| Export | Description |
|---|---|
| `buildRebaseData(driver)` | Wraps a `DataDriver` in a `Proxy`-based `RebaseData` object. Property access like `data.products` returns a `CollectionAccessor` for that collection slug (camelCase → snake_case). |
| `QueryBuilder<M>` | Fluent query builder with `.where()`, `.orderBy()`, `.limit()`, `.offset()`, `.search()`, `.include()`, `.find()`, and `.listen()` |
| `or(...conditions)` | Create an OR logical condition |
| `and(...conditions)` | Create an AND logical condition |
| `cond(column, op, value)` | Create a single filter condition |

### Collections

| Export | Description |
|---|---|
| `CollectionRegistry` | Registry for managing collection definitions |
| Default collections | Pre-built collection configurations |

### Utilities

| Module | Contents |
|---|---|
| `collections` | Collection config helpers |
| `common` | General-purpose utilities |
| `snapshots` | Snapshot value resolution |
| `enums` | Enum type helpers |
| `paths` | Path parsing and manipulation |
| `resolutions` | Property and collection resolution |
| `permissions` | Permission evaluation |
| `references` | Reference property helpers |
| `relations` | Relation property helpers |
| `navigation_from_path` | Build navigation tree from a path |
| `parent_references_from_path` | Extract parent references |
| `builders` | Collection/property builder utilities |
| `storage` | Storage path utilities |
| `callbacks` | Callback composition utilities |
| `conditions` | Conditional logic helpers |
| `navigation_utils` | Navigation tree utilities |

## Quick Start

```ts
import { buildRebaseData, QueryBuilder, or, cond } from "@rebasepro/common";

// Wrap a DataDriver into a proxy-based data accessor
const data = buildRebaseData(myDriver);

// Access collections by name (camelCase auto-converts to snake_case)
const { data: products } = await data.products.find({ limit: 10 });
const snapshot = await data.products.findById("abc-123");

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

- [`@rebasepro/types`](../types) — `DataDriver`, `RebaseData`, `CollectionAccessor`, `Snapshot`, `FindResponse`, etc.
- [`@rebasepro/utils`](../utils) — Low-level utilities (`toSnakeCase`, etc.)
- [`@rebasepro/app`](../core) — Runtime layer that consumes `@rebasepro/common`
- [`@rebasepro/client`](../client) — HTTP client that re-exports and extends the `QueryBuilder`
