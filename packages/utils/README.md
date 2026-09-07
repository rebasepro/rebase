# @rebasepro/utils

Shared utility functions used across the Rebase ecosystem.

## Installation

```bash
pnpm add @rebasepro/utils
```

ESM-only: `"type": "module"` with no CommonJS build, so it is loaded with
`import`. `require()` of it resolves only on Node 22.12+, which supports
`require(esm)`.

## What This Package Does

A zero-dependency\* collection of pure utility functions for string manipulation, deep object operations, pluralization, hashing, and more. Used internally by most Rebase packages.

\*Runtime dependency: `object-hash` (for `getHashValue`). Peer dependency: `@rebasepro/types`.

## Key Exports

### Strings (`strings`)

| Export | Description |
|---|---|
| `toKebabCase(str)` | `"myString"` → `"my-string"` |
| `toSnakeCase(str)` | `"myString"` → `"my_string"` |
| `camelCase(str)` | `"my-string"` → `"myString"` |
| `slugify(text, separator?, lowercase?)` | URL/DB-safe slug. Default separator: `"_"` |
| `unslugify(slug)` | `"my_slug"` → `"My Slug"` |
| `prettifyIdentifier(input)` | `"imageURL"` → `"Image URL"`, `"my_field"` → `"My Field"` |
| `randomString(length?)` | Random alphanumeric string. Default length: 5 |
| `randomColor()` | Random hex color string |

### Objects (`objects`)

| Export | Description |
|---|---|
| `getIn(obj, path, default?)` | Deep-get by dot/bracket path: `getIn(obj, "a.b[0].c")` |
| `setIn(obj, path, value)` | Immutable deep-set by path |
| `clone(value)` | Shallow clone (arrays, plain objects) |
| `deepClone(value)` | Deep clone preserving functions and class instances |
| `mergeDeep(target, source, ignoreUndefined?)` | Deep merge with array-aware recursion, preserves class instances |
| `pick(obj, ...keys)` | Pick specified keys from an object |
| `isObject(item)` | Check if value is a non-null, non-array object |
| `isPlainObject(obj)` | Check if value is a plain `{}` object (not a class instance) |
| `getValueInPath(obj, path)` | Deep-get with array index support |
| `removeInPath(obj, path)` | Immutably remove a key at a nested path |
| `removeFunctions(obj)` | Strip all function values from an object tree |
| `removeUndefined(value, removeEmptyStrings?)` | Strip `undefined` values (and optionally empty strings) |
| `removeNulls(value)` | Strip `null` values recursively |
| `removePropsIfExisting(source, comparison)` | Remove properties from source that match comparison |
| `isEmptyObject(obj)` | Check if a plain object has no keys |
| `getHashValue(value)` | Hash any value using `object-hash` |
| `isEmptyArray`, `isFunction`, `isInteger`, `isNaN` | Type-check helpers |

### Arrays (`arrays`)

| Export | Description |
|---|---|
| `toArray(input)` | Normalize a value to an array: `T \| T[]` → `T[]` |

### Dates (`dates`)

| Export | Description |
|---|---|
| `defaultDateFormat` | `"MMMM dd, yyyy, HH:mm:ss"` |

### Hash (`hash`)

| Export | Description |
|---|---|
| `hashString(str)` | Fast 32-bit integer hash of a string |

### RegExp (`regexp`)

| Export | Description |
|---|---|
| `serializeRegExp(input)` | Serialize a `RegExp` to string |
| `hydrateRegExp(input)` | Parse a string back to `RegExp` |
| `isValidRegExp(input)` | Check if a string is a valid regular expression |

### Flatten (`flatten_object`)

| Export | Description |
|---|---|
| `flattenObject(obj, parentKey?)` | Flatten nested object to dot-notation keys: `{ a: { b: 1 } }` → `{ "a.b": 1 }` |
| `getArrayValuesCount(array)` | Map nested array paths to their maximum lengths across an array of objects |

### Plurals (`plurals`)

| Export | Description |
|---|---|
| `plural(word, amount?)` | English pluralization with irregular/uncountable support |
| `singular(word, amount?)` | English singularization with irregular/uncountable support |

### Names (`names`)

| Export | Description |
|---|---|
| `generateForeignKeyName(name)` | `"users"` → `"user_id"`, `"Product"` → `"product_id"` |

### Fields (`fields`)

| Export | Description |
|---|---|
| `isDefaultFieldConfigId(id)` | Check if a field config ID is one of the built-in types (text_field, number_input, file_upload, etc.) |

## Related Packages

- `@rebasepro/types` — Type definitions used by some utility functions (`GeoPoint`)
