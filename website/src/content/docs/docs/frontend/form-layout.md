---
title: Form Layout
sidebar_label: Form Layout
description: Control how the entity form is arranged — column spans, sections, and the metadata rail.
---

## Overview

The entity form is generated from your properties. By default it derives a
two-column layout from the property types, so a collection that says nothing
about layout still gets a form that reads like a form rather than one long run
of full-width inputs:

- the id and the `createdAt` / `updatedAt` timestamps go to a metadata rail, read-only
- short enums, booleans, dates and numbers take a narrow span
- long text, markdown, arrays, maps and storage fields take the full width
- everything else takes half

Use `admin.form` when the derived answer is wrong for your domain.

## Field width

A field's width is a **span** over a four-column grid. `4` is the full width of
the main column.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const productsCollection = defineCollection({
    slug: "products",
    table: "products",
    name: "Products",
    properties: {
        sku: {
            name: "SKU",
            type: "string",
            admin: { span: 1 }
        },
        name: {
            name: "Product name",
            type: "string",
            admin: { span: 3 }
        },
        description: {
            name: "Description",
            type: "string",
            admin: { markdown: true, span: 4 }
        }
    }
});
```

Spans snap to a shared grid, which is what makes two fields line up regardless
of the order they were declared in. They replaced `admin.widthPercentage`,
whose raw percentages could not line up with anything; a collection still
carrying one should pick the nearest span (≤30 → `1`, ≤55 → `2`, ≤80 → `3`,
otherwise `4`).

On layouts too narrow for two columns — the side panel, the split pane, a phone
— the grid collapses to a single column and spans are ignored.

## Sections

`sections` groups the main column under headings. A titled section can be
collapsed; an untitled one cannot.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const ordersCollection = defineCollection({
    slug: "orders",
    table: "orders",
    name: "Orders",
    properties: {
        reference: { name: "Reference", type: "string" },
        placed_at: { name: "Placed at", type: "date" },
        address: { name: "Address", type: "string" },
        carrier: { name: "Carrier", type: "string" },
        tracking_number: { name: "Tracking number", type: "string" },
        notes: { name: "Notes", type: "string" }
    },
    admin: {
        form: {
            sections: [
                { key: "identity", properties: ["reference", "placed_at"] },
                {
                    key: "shipping",
                    title: "Shipping",
                    properties: ["address", "carrier", "tracking_number"]
                },
                {
                    key: "internal",
                    title: "Internal notes",
                    properties: ["notes"],
                    collapsed: true
                }
            ]
        }
    }
});
```

A property no section names is never dropped: it lands in the last untitled
section, or in an untitled trailing group if there is none. Adding a column to
the database therefore cannot make a field silently disappear from the form.

A validation error inside a collapsed section expands it, so an error can never
hide behind a closed heading.

## The metadata rail

`sidebar` moves fields out of the main column and into a narrow rail beside it —
status, ownership, publication dates, flags.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const postsCollection = defineCollection({
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string", admin: { markdown: true } },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published at", type: "date" },
        author: { name: "Author", type: "string" }
    },
    admin: {
        form: {
            sidebar: ["status", "publishedAt", "author"],
            showRecordMeta: true
        }
    }
});
```

The rail does not use the grid, so `span` is ignored for the fields in it. Where
there is no room for a rail it renders as an ordinary leading section, so
nothing is lost on a phone or in the side panel.

`showRecordMeta` puts the read-only record block — id, created, updated — at the
foot of the rail. It defaults to `true` whenever a rail is shown, and is what
replaces `hideIdFromForm` for most collections: the id stops being a field in
the middle of the form and becomes a copyable line of metadata.

Set `sidebar: []` to suppress the derived rail entirely and keep every field in
the main column.

## Reference

| Property | Type | Description |
|----------|------|-------------|
| `admin.span` | `1 \| 2 \| 3 \| 4` | Field width over the four-column form grid |
| `admin.form.sidebar` | `string[]` | Property keys shown in the metadata rail |
| `admin.form.sections` | `FormSection[]` | Titled groups for the main column |
| `admin.form.showRecordMeta` | `boolean` | Show id/created/updated at the foot of the rail |

`FormSection` is `{ key, title?, properties, collapsed?, collapsible? }`.
