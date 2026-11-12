---
title: Columns
sidebar_label: Columns
description: "Every col.* builder and modifier: the Postgres type each one creates, the type a client reads and writes, and what the API enforces — nullability, defaults, stamps, validation, closed value sets, access and storage."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

A column is a `col.*` builder, refined by modifiers. The builder decides the
Postgres type; the modifiers say everything else: whether the column may be
null, its default, its validation, who may read and write it.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const products = defineTable("products", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        sku:       col.varchar(32).notNull().unique(),
        name:      col.text().notNull().validate({ min: 2, max: 120, trim: true }),
        price:     col.numeric(10, 2).notNull().validate({ min: 0 }),
        status:    col.enum(["draft", "active", "retired"]).notNull().default("draft"),
        tags:      col.array(col.text()).validate({ maxItems: 10 }),
        photo:     col.storage({ path: "products/", accept: ["image/*"], maxBytes: "5MB" }),
        createdBy: col.uuid().onCreateUser().readOnly(),
        createdAt: col.timestamptz().notNull().onCreateNow(),
        updatedAt: col.timestamptz().notNull().onUpdateNow(),
    },
    rls: "admin-only",
});
```

Builders are immutable: every modifier returns a new builder, so a column can be
declared once and shared between tables.

## Builders

<span class="since-badge" data-since="0.31">Since 0.31</span>

One builder per Postgres type. The wire type is what a client reads in a row and
sends in a write, and what the SDK and [`InferRow`](/docs/schema/types/) type
the column as.

| Builder | Postgres type | Wire type | Notes |
|---|---|---|---|
| `col.uuid()` | `UUID` | `string` | `.defaultRandom()` for `gen_random_uuid()` |
| `col.text()` | `TEXT` | `string` | |
| `col.varchar(n?)` | `VARCHAR(n)` | `string` | `n` defaults to 255 |
| `col.char(n?)` | `CHAR(n)` | `string` | `n` defaults to 255 |
| `col.enum(values, { name? })` | a Postgres enum type | the union of `values` | the type is `<table>_<column>` unless `name` sets it; see [Closed value sets](#closed-value-sets) |
| `col.smallint()` | `SMALLINT` | `number` | |
| `col.integer()` | `INTEGER` | `number` | |
| `col.bigint()` | `BIGINT` | `number` | read and written as a JavaScript number |
| `col.smallserial()` | `SMALLSERIAL` | `number` | has a default; prefer `col.smallint().identity()` in a new schema |
| `col.serial()` | `SERIAL` | `number` | has a default; prefer `col.integer().identity()` |
| `col.bigserial()` | `BIGSERIAL` | `number` | has a default; prefer `col.bigint().identity()` |
| `col.real()` | `REAL` | `number` | |
| `col.doublePrecision()` | `DOUBLE PRECISION` | `number` | |
| `col.numeric(p?, s?)` | `NUMERIC`, `NUMERIC(p)`, `NUMERIC(p, s)` | `number` | a scale needs a precision |
| `col.boolean()` | `BOOLEAN` | `boolean` | |
| `col.timestamptz()` | `TIMESTAMPTZ` | `string` (ISO 8601) | a write also takes a `Date` |
| `col.date()` | `DATE` | `string` (`YYYY-MM-DD`) | a write also takes a `Date` |
| `col.time()` | `TIME` | `string` (`HH:MM:SS`) | a write also takes a `Date` |
| `col.jsonb<T>()` / `col.jsonb(shape)` | `JSONB` | `T`, or the shape's type | see [JSON documents](/docs/schema/json/) |
| `col.json<T>()` / `col.json(shape)` | `JSON` | `T`, or the shape's type | keeps the text it was given; prefer `jsonb` |
| `col.array(inner)` | `<inner>[]` | an array of the inner wire type | no arrays of arrays; see [Arrays](#arrays) |
| `col.vector(dims, { index? })` | `vector(dims)` (pgvector) | `number[]` | an HNSW cosine index unless `index` says otherwise; see [Vector search](/docs/backend/vector-search/) |
| `col.bytea()` | `BYTEA` | `string` (base64) | |
| `col.geopoint()` | `JSONB` | `{ latitude: number; longitude: number }` | |
| `col.storage(options)` | `TEXT` | `string` (the file's path) | `.multiple()` makes it `TEXT[]`; see [Storage columns](#storage-columns) |

## Modifiers

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every builder has the first group. The rest exist only on the builders they make
sense for; calling one elsewhere is a type error.

| Modifier | On | Database | API and types |
|---|---|---|---|
| `.notNull()` | every column | `NOT NULL` | never `null` on a row; required on create unless it has a default |
| `.primaryKey()` | every column | part of the primary key, `NOT NULL` | absent from the `Update` type |
| `.unique()` | every column | single-column `UNIQUE` | a duplicate is a `409` |
| `.default(value)` | every column | `DEFAULT <value>` | applied by the driver on create too; optional on create |
| `.defaultSql(expr)` | every column | `DEFAULT <expr>` | optional on create |
| `.dbDefault()` | every column | leaves the database's existing default alone | optional on create |
| `.generatedAs(expr)` | every column | `GENERATED ALWAYS AS (<expr>) STORED` | never writable, by anyone |
| `.column(name)` | every column | the SQL column name | the key stays the wire name |
| `.readOnly()` | every column | none | client writes refused; absent from `Insert` and `Update` |
| `.private()` | every column | none | never on the wire, in the SDK or in OpenAPI |
| `.access({ read?, write? })` | every column | none | per-role read and write; see [Field access](/docs/collections/field-access/) |
| `.describe(text)` | every column | none | the description in OpenAPI and MCP |
| `.validate(rules)` | every column | none | checked before every write; rules depend on the type, see [Validation](#validation) |
| `.transform({ beforeSave?, afterRead? })` | every column | none | field-level hooks; `value` is `T \| null` unless `.notNull()` comes first; see [Table hooks](/docs/collections/callbacks/#field-hooks-transform) |
| `.oneOf(values)` | text and numeric columns | none | only these values accepted; typed as their union |
| `.defaultRandom()` | `col.uuid()` | `DEFAULT gen_random_uuid()` | optional on create |
| `.identity()` | `col.smallint()`, `col.integer()`, `col.bigint()` | `GENERATED BY DEFAULT AS IDENTITY` | optional on create |
| `.onCreateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` | the server stamps the time on create |
| `.onUpdateNow()` | `timestamptz`, `date`, `time` | `DEFAULT now()` and a `BEFORE UPDATE` trigger | the server stamps the time on create and on every update |
| `.onCreateUser()` | text columns, `col.uuid()` | none | the server writes the caller's id on create |
| `.onUpdateUser()` | text columns, `col.uuid()` | none | the server writes the caller's id on every write |
| `.multiple()` | `col.storage()` | `TEXT[]` | the column holds several file paths |

## Null, required and defaults

<span class="since-badge" data-since="0.31">Since 0.31</span>

Columns are nullable by default. `.notNull()` and `.primaryKey()` make a column
`NOT NULL`, and the API then requires it on create unless it has a default. A
`NOT NULL` column is `T` on a row; any other column is `T | null`.

A default is any of `.default()`, `.defaultSql()`, `.dbDefault()`,
`.defaultRandom()`, `.identity()`, a stamp, or a serial builder. A column with a
default may be left out of a create:

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tickets = defineTable("tickets", {
    columns: {
        id:       col.integer().primaryKey().identity(),
        code:     col.text().notNull().defaultSql("gen_short_id()"),
        priority: col.smallint().notNull().default(3),
        legacy:   col.text().dbDefault(),
    },
    rls: "admin-only",
});
```

- **`.default(value)`** is written as the column's `DEFAULT` and also applied
  by the driver on create, so a row comes out the same whoever inserts it. A
  temporal column also takes a `Date`, stored as its ISO string. An enum
  column's default must be one of its values.
- **`.defaultSql(expression)`** is evaluated by Postgres. The expression is
  written into the DDL as is.
- **`.dbDefault()`** says the database already holds a default that the schema
  does not state. A create may omit the column, and a schema push does not drop
  the default.

`.generatedAs()` cannot have a default or a stamp: Postgres computes the column
on every write. A primary-key column cannot be `.private()`.

## Stamps

<span class="since-badge" data-since="0.31">Since 0.31</span>

A stamp is a value the server writes into a column on its own. It overwrites
whatever a client sends for that column.

| Stamp | Writes | When |
|---|---|---|
| `.onCreateNow()` | the current time | on create |
| `.onUpdateNow()` | the current time | on create and on every update |
| `.onCreateUser()` | the caller's user id | on create |
| `.onUpdateUser()` | the caller's user id | on create and on every update |

A column holds one stamp. Calling a second, different one throws when the
module loads; `.onUpdateNow()` alone already stamps the row when it is created.
Stamp columns stay nullable unless you write `.notNull()`.

`.onCreateUser()` is how a column that a row-level security rule compares with
the caller (`ownerField`) gets its value. A column the caller fills is a column
the caller can lie about.

## Validation

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.validate(rules)` takes the rules for the column's type. The API checks them
before a create or an update and refuses the write with a `400` naming the
column. Calling `.validate()` twice merges the rules.

| Rule | Text columns and `col.storage()` | Numeric columns | `timestamptz`, `date`, `time` | Arrays |
|---|---|---|---|---|
| `min`, `max` | length | inclusive bounds | earliest and latest value (ISO string or `Date`) | |
| `length` | exact length | | | |
| `matches`, `matchesFlags`, `matchesMessage` | a pattern (string or `RegExp`) and the error | | | |
| `email`, `url` | the value is an address or a URL | | | |
| `trim`, `lowercase`, `uppercase` | the value is normalized before it is stored | | | |
| `lessThan`, `moreThan` | | exclusive bounds | | |
| `positive`, `negative`, `integer` | | sign, whole number | | |
| `minItems`, `maxItems`, `uniqueItems` | | | | item count, no duplicates |
| `requiredMessage` | ✓ | ✓ | ✓ | ✓ |

`requiredMessage` is the error a create gets when it leaves out a `.notNull()`
column without a default. Every other column type (`uuid`, `enum`, `boolean`,
JSON, `vector`, `bytea`, `geopoint`) accepts `requiredMessage` alone.

A `RegExp` is stored as its source and flags, and a `Date` bound as its ISO
string, so the rules served on the wire are the rules the server checks.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const signups = defineTable("signups", {
    columns: {
        id:       col.uuid().primaryKey().defaultRandom(),
        email:    col.text().notNull().validate({ email: true, lowercase: true, trim: true, requiredMessage: "Enter your e-mail address." }),
        handle:   col.varchar(32).validate({ matches: /^[a-z0-9_]+$/, matchesMessage: "Lower-case letters, digits and _ only." }),
        age:      col.smallint().validate({ integer: true, min: 13 }),
        birthday: col.date().validate({ max: "2013-01-01" }),
    },
    rls: "admin-only",
});
```

On `col.varchar(n)` and `col.char(n)` the length is enforced by Postgres and by
the API. A `max` that differs from `n` contradicts it; state the length once.

## Closed value sets

<span class="since-badge" data-since="0.31">Since 0.31</span>

Two ways to accept only certain values:

- **`col.enum(values)`** creates a Postgres enum type, so the database enforces
  the set too. The type is named `<table>_<column>`; `{ name }` gives it another
  name, and two columns naming the same type share it and must list the same
  values in the same order.
- **`.oneOf(values)`** on a text or numeric column is checked by the API, with no
  Postgres type. It is the form for a closed set of numbers, and for an array of
  known strings: `col.array(col.text().oneOf(["a", "b"]))`.

Both type the column as the union of their values: `status` below is
`"draft" | "published"` on the row, and `rating` is `1 | 2 | 3 | 4 | 5`.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const reviews = defineTable("reviews", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
        rating: col.smallint().notNull().oneOf([1, 2, 3, 4, 5]),
        labels: col.array(col.text().oneOf(["bug", "praise", "question"])),
    },
    rls: "admin-only",
});
```

Labels and colors for the values are presentation. They belong to the CMS, not
to the table.

## Arrays

<span class="since-badge" data-since="0.31">Since 0.31</span>

`col.array(inner)` is a Postgres array of the inner column's type:
`col.array(col.text())` is `TEXT[]`, `col.array(col.integer())` is
`INTEGER[]`. The inner builder carries the rules for each item: its
`.validate()`, `.oneOf()`, storage options and `.transform()`. The array's own
`.validate()` takes `minItems`, `maxItems` and `uniqueItems`.

Modifiers that describe a column (`.notNull()`, a default, `.unique()`,
`.access()`) go on the array, not on the item. An array of arrays is refused;
use `col.jsonb()` for nested lists.

## Keys, identity and serials

<span class="since-badge" data-since="0.31">Since 0.31</span>

`.identity()` makes an integer column `GENERATED BY DEFAULT AS IDENTITY`. It is
the form for an integer key in a new schema. The serial builders
(`col.smallserial()`, `col.serial()`, `col.bigserial()`) exist for schemas that
already use them; a column pointing at a serial key is the plain integer of the
same width. See [Primary keys](/docs/schema/#primary-keys) for composite keys.

`col.bigint()` is read and written as a JavaScript `number`, which is exact up to
2⁵³ − 1. `col.numeric()` is a `number` too, so it carries the precision of a
double on the wire, whatever precision Postgres stores.

## Who may read and write a column

<span class="since-badge" data-since="0.31">Since 0.31</span>

Row-level security decides which rows a caller reaches. Three modifiers narrow
what they see of a row and may set:

- **`.readOnly()`** refuses every client write to the column, on create and on
  update, whatever the caller's role. The database (a default, a trigger) and
  server code still fill it. The column is absent from the `Insert` and `Update`
  types.
- **`.private()`** keeps the column on the server: absent from every row on the
  wire, from the SDK, from OpenAPI, and refused in filters and sorts. Hooks and
  server code still see it. A private column cannot also declare `.access()`.
- **`.access({ read, write })`** lists the roles that receive the column and the
  roles that may write it. An omitted list leaves that direction to the row; an
  empty list closes it to every caller.

[Field access](/docs/collections/field-access/) covers what a caller sees when
a column is withheld, and every door the rule applies to.

## Storage columns

<span class="since-badge" data-since="0.31">Since 0.31</span>

`col.storage(options)` holds the path of a file in a storage bucket. The upload
route enforces `accept` and `maxBytes`, and the orphan sweep counts the file as
referenced while a row holds its path. `.multiple()` makes the column hold
several paths (`TEXT[]`).

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const listings = defineTable("listings", {
    columns: {
        id:     col.uuid().primaryKey().defaultRandom(),
        cover:  col.storage({ path: "listings/{id}/", accept: ["image/*"], maxBytes: "10MB",
                              imageResize: { maxWidth: 1600, format: "webp", quality: 80 } }),
        photos: col.storage({ path: "listings/{id}/gallery/", accept: ["image/*"] }).multiple(),
        terms:  col.storage({ path: "listings/terms/", accept: ["application/pdf"], public: true }),
    },
    rls: "admin-only",
});
```

| Option | What it does |
|---|---|
| `path` | **Required.** Where files go, as a path template: `"posts/heroes/"`, `"users/{id}/"`. |
| `source` | The bucket, declared in `backend/resources.ts`. The default bucket when omitted. |
| `accept` | MIME types accepted, with wildcards: `["image/*", "application/pdf"]`. |
| `maxBytes` | The largest file accepted: a number of bytes, or a size such as `"10MB"`, `"512 kb"`, `"1.5GB"`. Binary multiples: 1 MB is 1,048,576 bytes. An unreadable size throws. |
| `imageResize` | Resize images before storing them: `maxWidth`, `maxHeight`, `mode` (`"contain"` or `"cover"`), `format` (`"original"`, `"jpeg"`, `"png"`, `"webp"`), `quality`. |
| `public` | Files are readable without a signed URL. |
| `fileName` | The stored file name, as a template. The uploaded name when omitted. |
| `metadata` | Metadata stored with every file. |
| `includeBucketUrl` | Store the bucket URL in front of the path. |
| `storeUrl` | Store the download URL instead of the path. |

A storage column takes the text column's validation rules. A file inside a JSON
document is `json.storage()`, with the same options; see
[JSON documents](/docs/schema/json/). Who may upload and download which paths is
[storage authorization](/docs/backend/storage-authorization/); serving and
caching the files is [Storage](/docs/backend/storage/).

## What is refused

<span class="since-badge" data-since="0.31">Since 0.31</span>

When the module loads, a builder throws on:

- `col.varchar(n)`, `col.char(n)` or `col.vector(n)` with `n` that is not a
  positive whole number, and `col.numeric(p, s)` with a scale and no precision;
- `col.enum([])`, and `col.array()` of an array;
- a second, different stamp on one column, and `.oneOf()` with a value that is
  not a string or a number;
- `.access()` whose `read` or `write` is not a list of non-empty role names;
- `col.storage()` without a `path`, or with a `maxBytes` that is not a size.

When the schema is compiled, the table is refused for:

- a default together with `.generatedAs()`, or a stamp together with it;
- `.identity()` on a non-integer column, `.defaultRandom()` on a non-`uuid`
  column, a time stamp on a non-temporal column, a user stamp on a column that
  is neither text nor `uuid`;
- a `.private()` primary key, or a `timestamptz` or `time` primary key;
- `.oneOf([])`, and `.oneOf()` on a column that is neither text nor numeric;
- an enum with a blank or repeated value, or a default that is not one of its
  values;
- two keys that resolve to the same SQL column, including once Postgres
  truncates the names to 63 bytes;
- a named enum type given two different lists of values.

Each refusal names the table, the column and what to write instead.

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [JSON documents](/docs/schema/json/): the shape of a `jsonb` column
- [Relations](/docs/collections/relations/): foreign keys come from `rel.*`, not from columns
- [Field access](/docs/collections/field-access/): `.access()`, `.private()` and `.readOnly()` in detail
- [Type inference](/docs/schema/types/): what each modifier does to `InferRow` and `InferInsert`
