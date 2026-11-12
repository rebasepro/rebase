---
title: JSON documents
sidebar_label: JSON documents
description: "Type a jsonb column with col.jsonb<T>(), or give it a shape with json.* so the server validates nested fields, applies defaults and stamps, finds the files a document references and searches inside it."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

A `jsonb` column can be declared two ways. `col.jsonb<T>()` types the document
for TypeScript and tells the server nothing about it. `col.jsonb(shape)` takes a
shape built with `json.*`, which types the document the same way and also
describes it to the server.

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const pages = defineTable("pages", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),

        // Typed for TypeScript only.
        settings: col.jsonb<{ theme?: "light" | "dark"; pinned?: boolean }>(),

        // Typed, and known to the server.
        seo: col.jsonb(json.object({
            title:        json.string().validate({ max: 60 }).required(),
            canonicalUrl: json.string().validate({ url: true }),
            noIndex:      json.boolean().default(false),
        })),
    },
    rls: "admin-only",
});
```

With a shape, the server:

- **validates** each field before a write, with the same rules a column takes;
- **applies defaults** to fields that are absent on create;
- **stamps** date fields with `.onCreateNow()` and `.onUpdateNow()`;
- **runs** each field's `.transform()` hooks;
- **finds the files** a document references (`json.storage()`), so the orphan
  sweep counts them;
- **can search** inside the document: a `search` field may name a path such as
  `"seo.title"` (see [Search](/docs/backend/search/)).

The shape is served with the table's descriptor, so the CMS can build a form for
the document without being told how. `col.jsonb<T>()` gets a generic JSON editor
instead.

## Builders

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Builder | Holds | TypeScript type |
|---|---|---|
| `json.string()` | a string | `string` |
| `json.number()` | a number | `number` |
| `json.boolean()` | a boolean | `boolean` |
| `json.date()` | an instant, as an ISO string | `string` |
| `json.geopoint()` | a point on Earth | `{ latitude: number; longitude: number }` |
| `json.storage(options)` | the path of a stored file | `string` |
| `json.object(fields, { additional? })` | an object with known keys | an object type: required fields required, the rest optional |
| `json.array(of)` | an array of one shape | an array of `of`'s type |
| `json.oneOf(variants, { typeField?, valueField? })` | a typed block | a union of `{ type: "<variant>"; value: <its type> }` |
| `json.unknown()` | anything | `unknown` |

`json.storage()` takes the same options as [`col.storage()`](/docs/schema/columns/#storage-columns).
`json.object(fields, { additional: true })` also accepts keys it does not name.

## Modifiers

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Modifier | On | What it does |
|---|---|---|
| `.required()` | every field | The key must be present in the document. Makes the key non-optional in the type. |
| `.default(value)` | every field | The value written when the key is absent on create. |
| `.describe(text)` | every field | What the value is, for OpenAPI and MCP. |
| `.validate(rules)` | every field | The rules a column of the same kind takes: text rules on `json.string()`, numeric rules on `json.number()`, date bounds on `json.date()`, item counts on `json.array()`. See [Validation](/docs/schema/columns/#validation). |
| `.transform({ beforeSave?, afterRead? })` | every field | Field-level hooks, run on the server. `value` is `T \| undefined` unless `.required()` comes first. |
| `.oneOf(values)` | `json.string()`, `json.number()` | A closed set of accepted values, typed as their union. |
| `.onCreateNow()` | `json.date()` | The server writes the current time when the row is created. |
| `.onUpdateNow()` | `json.date()` | The server writes the current time on every write. |
| `.userId()` | `json.string()` | The value is a user's id: the panel offers a user picker, and a caller who may write the table may look users up to fill it. See [User columns](/docs/schema/columns/#user-columns). |

Fields are optional unless `.required()`. A required key is required in the
TypeScript type too:

```ts
import { col, json } from "@rebasepro/server/schema";

const address = json.object({
    street:  json.string().required(),
    city:    json.string().required(),
    country: json.string().validate({ length: 2, uppercase: true }).required(),
    notes:   json.string(),
});

// { street: string; city: string; country: string; notes?: string }
const shipping = col.jsonb(address);
```

## Arrays and typed blocks

<span class="since-badge" data-since="0.31">Since 0.31</span>

`json.array(of)` is a list of one shape. `json.oneOf(variants)` is a block whose
`type` key says which variant it is and whose `value` key holds that variant's
content. As the items of an array, it is the shape of a block editor:

```ts
import { defineTable, col, json } from "@rebasepro/server/schema";

export const articles = defineTable("articles", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        body: col.jsonb(json.array(json.oneOf({
            paragraph: json.string(),
            image:     json.storage({ path: "articles/images/", accept: ["image/*"] }),
            quote:     json.object({ text: json.string().required(), author: json.string() }),
        }))),
    },
    rls: "admin-only",
});
```

A row's `body` is then typed as an array of:

```ts
type Block =
    | { type: "paragraph"; value: string }
    | { type: "image"; value: string }
    | { type: "quote"; value: { text: string; author?: string } };
```

`typeField` and `valueField` rename the two keys, for documents that already use
other names: `json.oneOf({ … }, { typeField: "kind", valueField: "data" })`.

## `jsonb` or `json`

<span class="since-badge" data-since="0.31">Since 0.31</span>

`col.json()` takes the same arguments as `col.jsonb()`. It stores the text it was
given, key order and whitespace included, and cannot be indexed or searched the
way `jsonb` can. Use it only when the exact text matters; otherwise use
`col.jsonb()`.

A point on Earth has its own column builder, `col.geopoint()`, stored as `jsonb`.
A list of plain values that Postgres should index is often better as an array
column: `col.array(col.text())`. Nested lists belong in `jsonb`: `col.array()` of
an array is refused.

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Columns](/docs/schema/columns/): the column builders and their validation rules
- [Search](/docs/backend/search/): searching paths inside a document
- [Table hooks](/docs/collections/callbacks/): `.transform()` and the table-level hooks
