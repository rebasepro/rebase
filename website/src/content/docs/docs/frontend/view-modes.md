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
const productsCollection: CollectionConfig = {
    slug: "products",
    // ...
    admin: {
        defaultViewMode: "table",            // Default view
        enabledViews: ["list", "table", "kanban"],    // Available views
        orderProperty: "sort_order",         // Property for drag-and-drop ordering
        kanban: {
            columnProperty: "status"         // Enum property for columns
        }
    }
};

```

## List View

![List View screenshot placeholder](/img/features/list-view.png)

The list view is the classic, clean CMS default view mode, showing entities in a straightforward list format without the density of a spreadsheet.

## Table View

![Table View screenshot placeholder](/img/features/table-view.png)

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

![Kanban View screenshot placeholder](/img/features/kanban-view.png)

Configure a Kanban board by specifying which enum property to use as columns:

```typescript
const tasksCollection: CollectionConfig = {
    slug: "tasks",
    properties: {
        title: { type: "string", name: "Title" },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "backlog", label: "Backlog", color: "grayDark" },
                { id: "in_progress", label: "In Progress", color: "blueDark" },
                { id: "review", label: "Review", color: "orangeDark" },
                { id: "done", label: "Done", color: "greenDark" }
            ]
        },
        sort_order: { type: "number", name: "Sort Order" }
    },
    admin: {
        defaultViewMode: "kanban",
        orderProperty: "sort_order",
        kanban: {
            columnProperty: "status"
        }
    }
};

```

Drag-and-drop between columns automatically updates the enum field and sort order.

## Cards View

![Cards View screenshot placeholder](/img/features/cards-view.png)

Cards display entities as visual cards — useful for image-heavy content:

```typescript
const articlesCollection: CollectionConfig = {
    slug: "articles",
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
};

```

## Next Steps

- **[Entity Views](/docs/frontend/entity-views)** — Custom tabs on entity forms
- **[Entity Actions](/docs/frontend/entity-actions)** — Custom entity actions
