---
title: View Modes
sidebar_label: View Modes
description: "Show a table's rows as a list, a spreadsheet, cards or a kanban board; choose what fills each record's title, image, status and date; and set the default sort, filters and one-click filter presets."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every collection can be shown four ways, from the switcher in its toolbar:

- **Table**: a virtualized spreadsheet with inline editing, sorting, filtering
  and multi-select. Where a collection opens unless told otherwise.
- **List**: one line per record, with its image, title, subtitle, status and
  date.
- **Cards**: a grid of cards, for image-heavy content.
- **Kanban**: a board grouped by a column with a closed set of values.

A collection can also offer view modes you write (a calendar, a map, a
gallery) in the same switcher, driven by the same toolbar: see
[Custom view modes](/docs/frontend/extending#custom-view-modes).

## Choosing the views

<span class="since-badge" data-since="0.31">Since 0.31</span>

```ts
// backend/schema/tasks.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const tasks = defineTable("tasks", {
    columns: {
        id:      col.uuid().primaryKey().defaultRandom(),
        title:   col.text().notNull(),
        status:  col.enum(["backlog", "in_progress", "review", "done"]).notNull().default("backlog"),
        dueDate: col.date(),
        // The board's order key: text, never a number.
        __order: col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/tasks.tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    defaultViewMode: "kanban",
    enabledViews: ["table", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },
    fields: {
        status: {
            enumLabels: {
                backlog:     { label: "Backlog", color: "gray" },
                in_progress: { label: "In Progress", color: "blue" },
                review:      { label: "Review", color: "orange" },
                done:        { label: "Done", color: "green" },
            },
        },
        __order: { hidden: true, hiddenInForm: true },
    },
});
```

| Option | Effect |
|---|---|
| `defaultViewMode` | Where a visitor lands: `"table"`, `"list"`, `"cards"`, `"kanban"` or a custom view's key. |
| `enabledViews` | The views the switcher offers. |
| `kanban` | `{ columnField, orderField }`: the board. |
| `defaultSize` | The row height, below. |
| `customViews` | Views of your own, by value or by key. |

### Row height

| `defaultSize` | Pixels | Best for |
|------|--------|----------|
| `"xs"` | 36 | Dense data tables |
| `"s"` | 42 | Compact text rows |
| `"m"` | 48 | Default |
| `"l"` | 96 | Medium image thumbnails |
| `"xl"` | 160 | Large image thumbnails |

## Kanban

<span class="since-badge" data-since="0.31">Since 0.31</span>

`kanban.columnField` names the column the board groups by. It must hold one
closed set of strings, a `col.enum([...])` or a text column with
`.oneOf([...])`; anything else is a type error. The columns are drawn in the
column's own order, or in `enumOrder`, with the labels and colours of
`enumLabels`. Dragging a card to another column writes `columnField`.

`kanban.orderField` names where a card's position **within** a column is stored.
Declare it every time: three mistakes here all produce a board that looks
configured and is not.

**`orderField` is not optional.** Without it a card still drags between columns,
because that writes `columnField`. Its position within a column has nowhere to
be stored, so it resets on the next read, and the board shows an amber bar
saying ordering is not configured.

**The column must be text.** Reordering writes a
[fractional-indexing](https://github.com/rocicorp/fractional-indexing) key
(`"i0"`, `"i1"`, `"i0i"`), not an index. A number column can never hold one, so
`orderField` accepts only a text column. It is machinery, not content: hide it,
as above.

**Rows created outside the CMS arrive without a key.** Nothing assigns one on
insert. A row written by a cron, a seed script, a migration or the REST API
lands with `__order` null, and the board shows *"Some items don't have order
values"* with an **Initialize** button. One click backfills the first page, and
the next cron run brings the bar straight back. If a backend creates rows for a
board, it should append the key itself, with the alphabet the CMS uses:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await client.data.tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await client.data.tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Rows created through the form arrive unkeyed too; the difference is only that
you see the bar the moment you add one. **Initialize** is the fix there; on a
board fed by a backend it is a fix that undoes itself every run.

## Display slots

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every surface that draws a record uses some of six slots: **title**,
**subtitle**, **image**, **status**, **date** and **tags**. A list row is image +
title + subtitle + status + date, a card is the same with the image on top, a
reference picker is title + subtitle, and a page heading is the title alone.

The CMS fills some slots from the table's columns (see
[default display slots](/docs/collections/#display-slots)). `display` states any
of them, as a field path or as a function:

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    display: {
        title: "title",
        status: "status",
        date: "dueDate",
        subtitle: ({ row }) => row.dueDate ? `Due ${row.dueDate}` : undefined,
    },
});
```

A slot you leave out keeps its derived value.

A resolver is handed `{ row, id, context }`. `row` is the record as the server
sends it, typed as the table's row: dates as ISO strings, a belongsTo as its
foreign-key column. `id` is its primary key as a string, a composite key's parts
joined by `:::`. A relation the CMS loaded arrives nested under its name, as
REST's `include` returns it, so a resolver can read a related record's field with
no request of its own.

A resolver may be `async`, to read something the record does not carry. While
the promise is in flight the surface shows the derived value and swaps the
resolved one in when it lands: a title is never a spinner. Results are cached per
record and slot, and concurrent asks share one call.

Return `undefined` when a record has nothing for the slot; the surface falls
back to what it knows (a heading uses the singular collection name, a link uses
the id). A resolver that throws is treated as `undefined` and logged once.

Prefer a path whenever the value is on the record: a path keeps the field's own
rendering, so an enum status stays a coloured chip and a date stays formatted,
which a resolver returning a string cannot do.

When no slot names the title, the CMS picks one. With `fieldOrder`, the first
field in that order that can be a title: text, a single-cardinality relation or
a reference. Otherwise the candidates are ranked: text whose key names a label
(`name`, `title`, `label`…) first, then short text, an email, an enum, long text,
a relation and a reference. Keys, uuid columns, file fields and hidden fields
never qualify. Whatever the title holds is drawn as text: a date formatted, an
array joined, and a relation as the first of `name`, `title`, `label` or
`displayName` on the related row, falling back to its id.

## Filters, presets and sort

<span class="since-badge" data-since="0.31">Since 0.31</span>

```tsx
import { customizeTable } from "@rebasepro/cms";
import type { tasks } from "../../../backend/schema/tasks";

export const tasksCms = customizeTable<typeof tasks>("tasks", {
    sort: ["dueDate", "asc"],
    defaultFilter: { status: ["!=", "done"] },
    filterPresets: [
        { label: "In review", filterValues: { status: ["==", "review"] } },
        { label: "Overdue", filterValues: { dueDate: ["<", new Date().toISOString().slice(0, 10)] }, sort: ["dueDate", "asc"] },
    ],
});
```

| Option | Effect |
|---|---|
| `sort` | The default sort: one key and direction, or several in order. |
| `defaultFilter` | The filter a visitor starts from, and may change. |
| `fixedFilter` | A filter the visitor cannot change. Filters they apply on other fields are combined with it. |
| `filterPresets` | One-click filters in the toolbar: `{ label?, filterValues, sort? }`. Without a label, one is written from the filter. |
| `pagination` | Load in pages (`true`, or the page size), or everything at once (`false`). |

Every key is checked against the table's fields. A field's own `filterOperators`
narrows what can be filtered on it, and `[]` turns filtering on it off.

A `fixedFilter` narrows what the CMS *asks for*. It is not a boundary: what a
caller may read is decided by the table's
[row-level security](/docs/collections/security-rules/), for every caller.

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [customizeTable](/docs/frontend/customize-table/): every option
- [Customizing the admin](/docs/frontend/customizing/): your own view modes, pages and actions
- [Entity views](/docs/frontend/entity-views/): tabs on a record
- [Entity actions](/docs/frontend/entity-actions/): buttons on a record
