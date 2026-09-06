---
title: View Modes
sidebar_label: View Modes
description: Configure table, cards, and Kanban board views for your collections.
---

## Overview

Every collection can be displayed in four view modes:

- **List** — Simple, clean list view (the classic CMS default)
- **Table** — Spreadsheet-style grid with inline editing, sorting, filtering
- **Cards** — Card grid for visual content (images, previews)
- **Kanban** — Drag-and-drop board grouped by an enum property

## Configuration

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const productsCollection = defineCollection({
    slug: "products",
    // `orderProperty` and `kanban.columnProperty` are checked against these
    // keys — with an empty `properties` block they narrow to `never`.
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        status: { name: "Status", type: "string" },
        // The order key. A *string*, never a number — see "Ordering" below.
        __order: {
            name: "Order",
            type: "string",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    name: "Products",
    table: "products",
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "__order",           // Property for drag-and-drop ordering
        kanban: {
            columnProperty: "status"         // Enum property for columns
        }
    }
});

```

## List View

The list view is the classic, clean CMS default view mode, showing entities in a straightforward list format without the density of a spreadsheet.

## Table View

The default view is a high-performance virtualized spreadsheet with:

- **Inline editing** — Click any cell to edit in-place
- **Column resizing** — Drag column headers
- **Column reordering** — Drag to rearrange
- **Sorting** — Click column headers
- **Text search** — Full-text search across string fields
- **Filtering** — Per-column filters
- **Multi-select** — Select entities for bulk actions

### Row Height

Control row height with `defaultSize`:

| Size | Pixels | Best for |
|------|--------|----------|
| `"xs"` | 40 | Dense data tables |
| `"s"` | 54 | Default |
| `"m"` | 80 | With image thumbnails |
| `"l"` | 120 | Cards with previews |
| `"xl"` | 260 | Rich content previews |

## Kanban View

Configure a Kanban board by specifying which enum property to use as columns:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const tasksCollection = defineCollection({
    slug: "tasks",
    name: "Tasks",
    table: "tasks",
    properties: {
        title: { type: "string", name: "Title" },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "backlog", label: "Backlog", color: "gray" },
                { id: "in_progress", label: "In Progress", color: "blue" },
                { id: "review", label: "Review", color: "orange" },
                { id: "done", label: "Done", color: "green" }
            ]
        },
        __order: {
            type: "string",
            name: "Order",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    admin: {
        defaultViewMode: "kanban",
        orderProperty: "__order",
        kanban: {
            columnProperty: "status"
        }
    }
});

```

Drag-and-drop between columns automatically updates the enum field and sort order.

### Ordering

`kanban` and `orderProperty` are two halves of one feature. Declare both, every
time — three mistakes here all produce a board that looks configured and is not.

**`orderProperty` is not optional.** Without it a card still drags between
columns, because that writes `columnProperty`. Its position *within* a column
has nowhere to be stored, so it resets on the next read, and the board renders an
amber bar telling you ordering is not configured.

**The property must be a `string`.** Reordering writes a
[fractional-indexing](https://github.com/rocicorp/fractional-indexing) key —
`"i0"`, `"i1"`, `"i0i"` — not an index. A `number` property can never hold one,
so a numeric `sortOrder` leaves the board asking to be initialised forever, and
the initialisation itself fails against a numeric column. Declare it hidden; it
is machinery, not content:

```typescript
__order: {
    type: "string",
    name: "Order",
    admin: { disabled: true, hideFromCollection: true }
}
```

**Rows created outside the admin arrive without a key.** Nothing assigns one on
insert. A row written by a cron, a seed script, a migration or the REST API lands
with `__order` null, and the board shows *"Some items don't have order values"*
with an **Initialize** button — one click backfills the first page, and the next
cron run brings the bar straight back. If a backend creates rows for a board, it
should append the key itself. Use the same alphabet the admin uses:

```typescript
import { generateKeyBetween } from "fractional-indexing";

// Base36, lower case. Postgres does the sorting and its default collation is
// not byte ordering, so the library's default base62 alphabet — which mixes
// cases — sorts differently in the database than in the key. Omitting this
// third argument produces keys like "a0" that the board rejects.
const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const tasks = client.data.collection("tasks");

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST, so without it this reads back one of the very rows that
// has no key and every insert lands on the same "i0".
const { data: last } = await tasks.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});

await tasks.create({
    title,
    status,
    __order: generateKeyBetween(
        (last[0]?.__order as string | undefined) ?? null,
        null,
        ORDER_KEY_DIGITS
    )
});
```

Rows created through the admin form arrive unkeyed too — the difference is only
that you see the bar the moment you add one. **Initialize** is the fix there; on
a board fed by a backend it is a fix that undoes itself every run.

## Cards View

Cards display entities as visual cards — useful for image-heavy content:

```typescript
import { defineCollection } from "@rebasepro/cms-types";
const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { type: "string", name: "Title" },
        cover: {
            type: "string",
            name: "Cover Image",
            storage: { storagePath: "covers", acceptedFiles: ["image/*"] }
        }
    },
    admin: {
        defaultViewMode: "cards"
    }
});

```

## Next Steps

- **[Entity Views](/docs/frontend/entity-views)** — Custom tabs on entity forms
- **[Entity Actions](/docs/frontend/entity-actions)** — Custom entity actions
