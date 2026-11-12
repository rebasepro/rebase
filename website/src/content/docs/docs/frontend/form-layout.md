---
title: Form Layout
sidebar_label: Form Layout
description: "Arrange a record's form: field widths on a four-column grid, titled and collapsible sections, the metadata rail, and a component that replaces the generated form."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

The record form is generated from the table's columns and relations:

- the id and the creation and update stamps go to a read-only metadata rail;
- every other field takes the full width of the main column, except that two
  neighbouring fields with the same small editor (two numbers, two switches,
  two dates of the same mode, two selects with short options) share a row.

A field with a long label, help text over 60 characters, `conditions`, a
column-level [access rule](/docs/collections/field-access/), or a custom `Field`
is never paired, and neither is any free text: nothing in a schema tells a short
branch name from a long URL. Anything else is asked for in `customizeTable`,
field by field with `span`, and for the whole form with `form`.

```ts
// backend/schema/orders.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id:             col.uuid().primaryKey().defaultRandom(),
        reference:      col.text().notNull(),
        sku:            col.text(),
        status:         col.enum(["placed", "shipped", "delivered"]).notNull().default("placed"),
        placedAt:       col.timestamptz(),
        address:        col.text(),
        carrier:        col.text(),
        trackingNumber: col.text(),
        notes:          col.text(),
    },
    rls: "admin-only",
});
```

```tsx
// frontend/src/cms/orders.tsx
import { customizeTable } from "@rebasepro/cms";
import type { orders } from "../../../backend/schema/orders";

export const ordersCms = customizeTable<typeof orders>("orders", {
    form: {
        sidebar: ["status", "placedAt"],
        sections: [
            { key: "identity", fields: ["reference", "sku"] },
            { key: "shipping", title: "Shipping", fields: ["address", "carrier", "trackingNumber"] },
            { key: "internal", title: "Internal notes", fields: ["notes"], collapsed: true },
        ],
    },
    fields: {
        reference: { span: 3 },
        sku:       { name: "SKU", span: 1 },
        carrier:   { span: 2 },
        trackingNumber: { span: 2 },
        notes:     { multiline: true },
    },
});
```

## Field width

<span class="since-badge" data-since="0.31">Since 0.31</span>

A field's width is a **span** over a four-column grid; `4` is the full width of
the main column. Spans snap to the grid, which is what makes two fields line up
whatever order they were declared in.

Choose a span from what the field holds, not from its type. Two short values
that belong together share a row: start and end date, city and country, carrier
and tracking number at `2` each, or a value and its qualifier at `3` + `1`.
Numbers, booleans and short codes can take `1` beside their siblings. Anything
that reads long (names, URLs, emails, ids, descriptions, markdown, files) keeps
`4`. Rows fill in field order and nothing widens a field to close a gap, so put
pairs next to each other and make each row add up to 4.

On layouts too narrow for two columns (the side panel, the split pane, a phone)
the grid collapses to one column and spans are ignored.

## Sections

<span class="since-badge" data-since="0.31">Since 0.31</span>

`form.sections` groups the main column under headings. Each section is
`{ key, title?, fields, collapsed?, collapsible?, readVariant? }`. A titled
section can be collapsed; an untitled one cannot. `readVariant: "summary"`
stacks the section's fields as label and value rows on the record's read-only
view; the default, `"grid"`, uses the form's grid.

A field no section names is never dropped: it lands in the last untitled
section, or in an untitled trailing group when there is none. A column added to
the table cannot make a field silently disappear from the form. A validation
error inside a collapsed section expands it.

Every entry is checked against the table. An entry the server does not serve to
this caller, because they may not read that column, is skipped.

## The metadata rail

<span class="since-badge" data-since="0.31">Since 0.31</span>

`form.sidebar` moves fields out of the main column into a narrow rail beside it:
status, ownership, publication dates, flags. The rail does not use the grid, so
`span` is ignored there. Where there is no room for a rail it renders as an
ordinary leading section.

`form.showRecordMeta` puts the read-only record block (id, created, updated) at
the foot of the rail. It is `true` whenever a rail is shown. `sidebar: []` turns
the derived rail off and keeps every field in the main column. `hideIdFromForm`
hides the id from the form altogether.

## Replacing the form

<span class="since-badge" data-since="0.31">Since 0.31</span>

`formView` swaps the generated form for a component of your own, imported by
value. It receives the same `EntityCustomViewParams` an
[entity view](/docs/frontend/entity-views/) does. `includeActions: true` keeps
Save and Discard in the record's bar while it is on screen.

```tsx
import React from "react";
import { customizeTable } from "@rebasepro/cms";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";
import type { orders } from "../../../backend/schema/orders";

function OrderForm({ row, modifiedValues }: EntityCustomViewParams) {
    return <h2>{String(modifiedValues?.reference ?? row?.reference ?? "New order")}</h2>;
}

export const ordersCms = customizeTable<typeof orders>("orders", {
    formView: { Builder: OrderForm, includeActions: true },
});
```

For a smaller change, override one part of the form instead (`Entity.Form`, see
[Component overrides](/docs/frontend/component-overrides/)), or lay out some
fields yourself with `<RecordForm>` and `<FormField>` in a page of your own
(see [Panels](/docs/frontend/panels/)).

## Other form options

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Option | Effect |
|---|---|
| `formAutoSave` | Save as the visitor types. |
| `alwaysApplyDefaultValues` | Fill declared defaults into a stored record's empty fields when it is opened. |
| `includeJsonView` | Add a tab with the record as JSON. |
| `localChangesBackup` | Keep unsaved edits in local storage: `"manual_apply"`, `"auto_apply"` or `false`. |

## Related

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [Custom fields](/docs/frontend/custom-fields/): the fields a layout arranges
- [Entity views](/docs/frontend/entity-views/): a whole tab of your own next to the form
- [customizeTable](/docs/frontend/customize-table/#form): the form options in the reference
