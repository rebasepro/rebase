---
title: Snapshot Views
sidebar_label: Snapshot Views
description: Add custom tabs and views to snapshot detail pages for previews, analytics, related data, or custom UI.
---

## Overview

Snapshot views let you add custom **tabs** to the snapshot detail page alongside the default form. Use them for:

- Live **previews** (website preview, rendered content)
- **Related data** views (order items, child snapshots)
- **Analytics** or charts
- **Custom editors** (rich text, map editors)

## Adding Snapshot Views

```typescript
const articlesCollection: CollectionConfig = {
    slug: "articles",
    name: "Articles",
    snapshotViews: [
        {
            key: "preview",
            name: "Preview",
            Builder: ArticlePreview
        },
        {
            key: "related",
            name: "Related Articles",
            Builder: RelatedArticlesView
        }
    ],
    properties: { /* ... */ }
};
```

## Building a snapshot View

```tsx
import { SnapshotCustomViewParams } from "@rebasepro/types";

function ArticlePreview({
    snapshot,
    modifiedValues,
    formContext
}: SnapshotCustomViewParams) {
    // modifiedValues has the unsaved, live form values
    const title = modifiedValues?.title ?? snapshot?.values?.title;
    const content = modifiedValues?.content ?? snapshot?.values?.content;

    return (
        <div className="p-8 max-w-2xl mx-auto">
            <h1 className="text-xl font-semibold tracking-[-0.01em]">{title}</h1>
            <div dangerouslySetInnerHTML={{ __html: content }} />
        </div>
    );
}
```

### SnapshotCustomViewParams

| Prop | Type | Description |
|------|------|-------------|
| `snapshot` | `Snapshot` | The saved snapshot (null for new snapshots) |
| `modifiedValues` | `SnapshotValues` | Current unsaved form values (live as user types) |
| `formContext` | `FormContext` | Full form context |
| `collection` | `CollectionConfig` | Collection definition |

![Snapshot view with secondary form](/img/snapshot_view_secondary_form.png)

## Controlling Position

Views appear as tabs. You can configure their position:

```typescript
snapshotViews: [
    {
        key: "preview",
        name: "Preview",
        Builder: ArticlePreview,
        position: "start"  // Appears before the default form tab
    }
]
```

## Next Steps

- **[Custom Fields](/docs/frontend/custom-fields)** — Build custom form fields
- **[Snapshot Actions](/docs/frontend/snapshot-actions)** — Custom action buttons
