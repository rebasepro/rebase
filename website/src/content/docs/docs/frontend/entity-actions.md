---
title: Entity Actions
sidebar_label: Entity Actions
description: Add custom action buttons to entities for archiving, publishing, exporting, cloning, and more.
---

## Overview

<span class="since-badge" data-since="0.31">Since 0.31</span>

Entity actions are buttons on a record: publish, archive, clone, or trigger an
outside workflow. They are declared per table in `customizeTable`, and
`updateRecord` covers the write most of them make.

## Defining Entity Actions

<span class="since-badge" data-since="0.31">Since 0.31</span>

```tsx
// frontend/src/cms/products.tsx
import React from "react";
import { customizeTable, updateRecord, resolveSelection } from "@rebasepro/cms";
import type { CollectionActionsProps } from "@rebasepro/cms-types";
import type { products } from "../../../backend/schema/products";

function PublishSelected({ selectionController, collection, context }: CollectionActionsProps) {
    const publish = async () => {
        // `selection` is the ticked rows, or a query standing for every row
        // that matches: resolveSelection reads them, a page at a time.
        const { ids } = await resolveSelection({
            selection: selectionController.selection,
            data: context.data,
            collection
        });
        for (const id of ids) await updateRecord(context, "products", id, { status: "active" });
        context.snackbarController?.open({ type: "success", message: `${ids.length} published` });
    };
    return <button onClick={publish}>Publish selected</button>;
}

export const productsCms = customizeTable<typeof products>("products", {
    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Upload",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "active",
            disabledReason: () => "Already active",
            onClick: ({ id, context }) =>
                updateRecord<typeof products>(context, "products", id,
                    { status: "active", publishedAt: new Date().toISOString() }, "Product published"),
        },
        {
            key: "clone",
            name: "Clone",
            icon: "Copy",
            onClick: async ({ row, context }) => {
                if (!row || !context) return;
                // `row` is the record as the server sends it: copy it, minus its id.
                const { id: _id, ...fields } = row;
                await context.data.products.create({ ...fields, name: `${fields.name} (Copy)` });
            },
        },
    ],
    Actions: [PublishSelected],
});
```

With the table as the type argument, `row` in `onClick`, `isEnabled` and
`disabledReason` is the table's row type, so `row?.status` is checked against
the column's values. An entry may also be a string: the `key` of an action
registered once on `<RebaseCMS entityActions>` (or `<Rebase entityActions>`),
for actions several tables share.

## `updateRecord`

<span class="since-badge" data-since="0.31">Since 0.31</span>

`updateRecord(context, slug, id, patch, message?)` writes `patch` onto one
record, then shows `message` as a success notification when given.

- It writes through `context.data`, the same request the form makes, so the
  server's hooks and row-level security apply, and every view of the table
  refreshes.
- It takes what an action's `onClick` receives as it is. A missing `context` or
  `id` (an action on a record not created yet) writes nothing.
- A refused write throws, and the action reports the error to the user.
- `updateRecord<typeof products>(…)` checks `patch` against what an update of
  the table accepts. A date goes in as its ISO string, as the server takes it.

## What an action is handed

Every callback of an action (`onClick`, `isEnabled`, `disabledReason`) receives the record it runs on:

| Prop | What it is |
|------|------------|
| `row` | The record as the server sends the row, the shape `useRows` and `context.data` return: dates as ISO strings, a belongsTo as its foreign-key column (`authorId`). Exactly the record's columns: `row.id` is an `id` column, where the table has one, with that column's type. Undefined while there is no saved record. |
| `id` | The record's id, as the admin addresses it: its primary key as a string, a composite key's parts joined by `:::` (`"5"` for an integer key `5`). |
| `path` | The collection path the record is at, subcollection segments included (`authors/7/posts`). |
| `collection`, `context` | The collection, and the admin's context: `context.data`, `context.snackbarController`, `context.dialogsController`, … |
| `formContext` | On an open record's edit form, the form: its `values` are the form's, unsaved edits included. Undefined in the collection and on the read-only view. |
| `view` | `"collection"` or `"form"`. |
| `highlightRow(id)`, `unhighlightRow(id)` | In the collection, highlight a row by its id, and remove the highlight. |
| `selectionController` | In the collection, its selection, by id: `isSelected(id)`, `toggleSelection(row, selected?)`, `selection` (the rows ticked, or the query "all matching" stands for). |

## Where an action shows

An action appears on the record, both on its edit form and on its read-only view, and on the collection's table rows. By default it waits in the overflow menu (⋮) in both places.

Set `collapsed: false` on the action people open the record to run, and it gets a button of its own:

- **On the record**, it becomes a labelled button in the bar, ahead of Save (or Edit, on the read-only view). When the bar runs short of room, as in a side panel, a dialog or a narrow window, the buttons drop their labels first and keep the icon, with the name in a tooltip. If that is still too wide, the last ones you declared fold back into the menu, so declare the most important first.
- **On a table row**, it becomes an icon beside Edit while the row is hovered.

```typescript
{
    name: "Publish",
    icon: "Upload",
    collapsed: false, // a button on the record, an icon on the row
    onClick: async ({ row, context }) => { /* … */ }
}
```

Keep this for the one or two actions that are the reason the record is open. The rest read better in the menu, which lists them in three groups: the collection's own actions first, in the order you declared them; then Copy, History and Inspect; then Delete, last and set apart.

| Property | Default | Effect |
|----------|---------|--------|
| `collapsed` | `true` | `false` makes the action a button on the record and an icon on the table row |
| `includeInForm` | `true` | `false` keeps the action off the record and leaves it on the collection's rows |
| `showActionsInListView` | `false` | `true` shows the action as an icon on each row of the list view |
| `isEnabled` | — | Return `false` to show the action disabled, as a button or as a menu item |
| `disabledReason` | — | Says why a disabled action is unavailable: under its name in a menu, and as the tooltip of a disabled button or icon |
| `nameKey` | — | A translation key for the name. The admin shows its translation in the current language, and `name` where the key has none. The built-in actions set it, so Edit, Copy and Delete follow the admin language |

A disabled action that does not say why reads as broken. `disabledReason` receives the same props as `isEnabled`, so it can name what is missing:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ row }) => Boolean(row?.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ row, context }) => { /* … */ }
}
```

On the record, a button whose `onClick` returns a pending promise shows a spinner and cannot be pressed again until the promise settles. If the action throws or its promise rejects, the user sees the error in a notification. The read-only view has no form, so `formContext` is undefined there.

## Collection Actions

<span class="since-badge" data-since="0.31">Since 0.31</span>

`Actions` puts components of your own in the collection's toolbar, for work on
the whole collection or on the selected rows: `PublishSelected` above. It is a
list, so several compose.

An action is handed `CollectionActionsProps`. Each speaks rows as the server
sends them, the shape `useRows` returns:

| Prop | What it is |
|------|------------|
| `selectionController` | The view's selection. `selection` is `{ type: "rows", ids, rows }` for ticked rows, or `{ type: "query", query, excludedIds, count }` for "all matching"; `selectedCount`, `hasSelection`, `isSelected(id)`, `toggleSelection(row, selected?)`, `setSelectedRows(rows)`, `selectAllMatching(query, count?)`, `clearSelection()`. |
| `tableController` | The view's live query: `rows`, `loading`, `error`, and the filter, search and sort the toolbar shares (`filterValues`, `setFilterValues`, `searchString`, `sortBy`, …). |
| `path`, `collection`, `context` | Where the collection is, its config, and the admin's context. |
| `openNewDocument(defaults?)` | Open the new-record form, prefilled. |

To keep some rows selected after acting on the rest, hand the ones to keep to
`setSelectedRows`:

```ts
const { selection } = selectionController;
if (selection.type === "rows") {
    selectionController.setSelectedRows(selection.rows.filter((_row, i) => failed.has(selection.ids[i])));
}
```

![Collection actions](/img/collection_actions.png)

## Next Steps

- **[customizeTable](/docs/frontend/customize-table)** — Every table option
- **[Additional Columns](/docs/frontend/additional-columns)** — Computed table columns
- **[Custom Fields](/docs/frontend/custom-fields)** — Custom form fields
