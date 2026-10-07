---
title: Entity Actions
sidebar_label: Entity Actions
description: Add custom action buttons to entities for archiving, publishing, exporting, cloning, and more.
---

## Overview

Entity actions are custom buttons that appear on individual entities. Use them for operations like publishing, archiving, cloning, or triggering external workflows.

## Defining Entity Actions

```typescript
import { defineCollection } from "@rebasepro/cms-types";
import { resolveSelection } from "@rebasepro/cms";
import { iconSize } from "@rebasepro/ui";
import { Copy, Upload } from "lucide-react";

const articlesCollection = defineCollection({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published At", type: "date" }
    },
    admin: {
        entityActions: [
            {
                name: "Publish",
                icon: <Upload size={iconSize.small}/>,
                onClick: async ({ entity, context }) => {
                    if (!entity || !context) return;
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .update(entity.id, { status: "published", publishedAt: new Date() });
                    context.snackbarController?.open({
                        type: "success",
                        message: "Article published!"
                    });
                }
            },
            {
                name: "Clone",
                icon: <Copy size={iconSize.small}/>,
                onClick: async ({ entity, context }) => {
                    if (!entity || !context) return;
                    const { id, ...values } = entity.values;
                    await context.data.collection<Record<string, unknown>>(entity.path)
                            .create({ ...values, name: values.name + " (Copy)" });
                }
            }
        ]
    }
});

```

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
    onClick: async ({ entity, context }) => { /* … */ }
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

A disabled action that does not say why reads as broken. `disabledReason` receives the same props as `isEnabled`, so it can name what is missing:

```typescript
{
    name: "Resend to Shopify",
    isEnabled: ({ entity }) => Boolean(entity?.values.shopify_id),
    disabledReason: () => "This customer has no Shopify account",
    onClick: async ({ entity, context }) => { /* … */ }
}
```

On the record, a button whose `onClick` returns a pending promise shows a spinner and cannot be pressed again until the promise settles. If the action throws or its promise rejects, the user sees the error in a notification. The read-only view has no form, so `formContext` is undefined there.

## Collection Actions

For toolbar-level actions that work on the collection or selected entities:

```tsx
import { defineCollection } from "@rebasepro/cms-types";
import { useData } from "@rebasepro/app";
import { resolveSelection } from "@rebasepro/cms";
function PublishSelectedAction({ selectionController, path }: CollectionActionsProps) {
    const data = useData();
    const handlePublish = async () => {
        // `selection` is either the rows that were ticked or a query standing
        // for every row that matches — `resolveSelection` reads them, one page
        // at a time, and refuses rather than returning a prefix.
        const selected = await resolveSelection({
            selection: selectionController.selection,
            accessor: data.collection(path)
        });
        for (const entity of selected) {
            await data.collection(entity.path).update(entity.id, { status: "published" });
        }
    };

    return (
        <button onClick={handlePublish}>
            Publish {selectionController.selectedCount ?? "all"} selected
        </button>
    );
}

// Register — `Actions` is an array, so several can be composed.
const collection = defineCollection({
    slug: "products",
    name: "Products",
    table: "products",
    properties: { /* … */ },
    admin: {
        Actions: [PublishSelectedAction]
    }
});
```

![Collection actions](/img/collection_actions.png)

## Next Steps

- **[Additional Columns](/docs/frontend/additional-columns)** — Computed table columns
- **[Custom Fields](/docs/frontend/custom-fields)** — Custom form fields
