---
title: Entity Callbacks
sidebar_label: Callbacks
slug: docs/collections/callbacks
description: Use lifecycle callbacks to run custom logic when entities are created, updated, read, or deleted.
---

## Overview

Callbacks let you hook into the entity lifecycle to:

- **Sync data between collections** — copy or move entities across tables on status changes
- **Transform data** before saving (computed fields, slugification)
- **Validate** business rules beyond schema validation
- **Trigger side effects** after writes (send emails, sync APIs, update caches)
- **Filter/transform** data after reading
- **Cascade operations** — clean up related records on delete

## Defining Callbacks

```typescript
const articlesCollection: EntityCollection = {
    slug: "articles",
    callbacks: {
        beforeSave: async ({ values, entityId, status }) => {
            // Auto-generate slug from title
            if (values.title) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }

            // Set timestamps
            if (status === "new") {
                values.created_at = new Date();
            }
            values.updated_at = new Date();

            return values;
        },

        afterSave: async ({ values, entityId }) => {
            // Send notification
            console.log(`Article ${entityId} saved: ${values.title}`);
        },

        beforeDelete: async ({ entityId }) => {
            // Prevent deletion of published articles
            // Throw to block the deletion
        },

        afterRead: async ({ entity }) => {
            // Transform data after loading
            return entity;
        }
    },
    properties: { /* ... */ }
};
```

## Callback Reference

### `beforeSave`

Called before an entity is written to the database. Return the modified values.

```typescript
beforeSave: async ({
    values,       // Entity values
    entityId,     // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updated_at: new Date() };
}
```

Throw an error to **block the save**:

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

### `afterSave`

Called after a successful save. Use for side effects.

```typescript
afterSave: async ({
    values,         // Saved values
    entityId,       // Entity ID
    previousValues, // Previous values (null for new entities)
    status,         // "new" | "existing" | "copy"
    context
}) => {
    // Send webhook
    await fetch("https://api.slack.com/webhook", {
        method: "POST",
        body: JSON.stringify({ text: `New article: ${values.title}` })
    });
}
```

### `afterSaveError`

Called when a save operation fails.

```typescript
afterSaveError: async ({
    values,
    entityId,
    error,
    context
}) => {
    console.error("Save failed:", error);
}
```

### `afterRead`

Called after reading entities from the database. Transform the data for display.

```typescript
afterRead: async ({
    entity,    // The entity to transform
    context
}) => {
    // Add computed fields
    return {
        ...entity,
        values: {
            ...entity.values,
            displayName: `${entity.values.first_name} ${entity.values.last_name}`
        }
    };
}
```

### `beforeDelete`

Called before an entity is deleted. Throw to block deletion.

```typescript
beforeDelete: async ({
    entityId,
    entity,
    context
}) => {
    if (entity.values.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Called after a successful deletion.

```typescript
afterDelete: async ({
    entityId,
    entity,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${entityId} deleted`);
}
```

## Property Callbacks

You can also define callbacks at the property level for field-specific transformations:

```typescript
properties: {
    email: {
        type: "string",
        name: "Email",
        callbacks: {
            beforeSave: ({ value }) => value?.toLowerCase().trim(),
            afterRead: ({ value }) => value // Could decrypt, etc.
        }
    }
}
```

## Syncing Data Between Collections

One of the most powerful uses of callbacks is **syncing data across collections**. For example, copying approved submissions to a published table:

```typescript
const submissionsCollection: EntityCollection = {
    slug: "job_submissions",
    callbacks: {
        afterSave: async ({ values, entityId, previousValues, context }) => {
            // When a submission is approved, create a published job
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const dataSource = context.dataSource;
                await dataSource.saveEntity({
                    path: "jobs",
                    entityId: undefined,
                    values: {
                        title: values.title,
                        description: values.description,
                        company_id: values.company_id,
                        status: "published",
                        source_submission_id: entityId,
                    },
                    collection: jobsCollection,
                    status: "new"
                });
            }
        }
    },
    properties: { /* ... */ }
};
```

Other cross-collection patterns:

- **Cascade delete**: Use `afterDelete` to remove related records in child collections
- **Denormalization**: Use `afterSave` to update summary fields in a parent collection
- **Audit logging**: Use `afterSave` / `afterDelete` to write to an audit log collection
- **Counters**: Use `afterSave` / `afterDelete` to update count fields on related entities

## Next Steps

- **[Security Rules](/docs/collections/security-rules)** — Row Level Security
- **[Entity History](/docs/backend/history)** — Audit trail
