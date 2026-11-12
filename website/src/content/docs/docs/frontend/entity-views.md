---
title: Entity Views
sidebar_label: Entity Views
description: Add custom tabs and views to entity detail pages for previews, analytics, related data, or custom UI.
---

## Overview

Entity views let you add custom **tabs** to the entity detail page alongside the default form. Use them for:

- Live **previews** (website preview, rendered content)
- **Related data** views (order items, child entities)
- **Analytics** or charts
- **Custom editors** (rich text, map editors)

## Adding Entity Views

<span class="since-badge" data-since="0.31">Since 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import { customizeTable } from "@rebasepro/cms";
import type { products } from "../../../backend/schema/products";
import { ArticlePreview } from "../components/ArticlePreview";

export const productsCms = customizeTable<typeof products>("products", {
    entityViews: [
        { key: "preview", name: "Preview", Builder: ArticlePreview, position: "start" },
        "related",   // registered once on <RebaseCMS entityViews>
    ],
});
```

An entry is a view, or the `key` of one registered once on
`<RebaseCMS entityViews>` (or `<Rebase entityViews>`), for tabs several tables
share. A registered view shows only on the tables that name its key.
`position: "start"` puts the tab before the form's; it goes after otherwise.

## Building an Entity View

<span class="since-badge" data-since="0.31">Since 0.31</span>

`Builder` is the component itself, imported by value:

```tsx
// frontend/src/components/ArticlePreview.tsx
import React from "react";
import type { EntityCustomViewParams } from "@rebasepro/cms-types";

export function ArticlePreview({ row, modifiedValues }: EntityCustomViewParams) {
    // modifiedValues has the unsaved, live form values; row is the saved
    // record. Both are open records, so narrow before rendering.
    const title = String(modifiedValues?.title ?? row?.title ?? "");
    const content = String(modifiedValues?.content ?? row?.content ?? "");

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### EntityCustomViewParams

| Prop | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | The saved record as the server sends the row: dates as ISO strings, a belongsTo as its foreign-key column, `id` only where the table has that column. Absent while a new one is being created |
| `id` | `string` | The saved record's id, beside `row`: its primary key as a string, a composite one's parts joined by `:::`. What `useSidePanel().open` and `useRowWrites().update` take. Absent while a new one is being created |
| `modifiedValues` | `EntityValues` | Current form values, unsaved edits included (live as user types), typed for the editor: a date is a `Date` |
| `formContext` | `FormContext` | Full form context |
| `collection` | `AdminCollection` | The collection as the CMS resolved it |

![Entity view with secondary form](/img/entity_view_secondary_form.png)

A table's to-many relations are tabs of the record too, without any of this;
see [Relations in the panel](/docs/collections/relations-in-the-admin-panel/).
`defaultSelectedView` in `customizeTable` sets the tab a record opens on.

## Next Steps

- **[Custom Fields](/docs/frontend/custom-fields)** — Build custom form fields
- **[Entity Actions](/docs/frontend/entity-actions)** — Custom action buttons
