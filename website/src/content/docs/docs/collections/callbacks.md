---
title: Entity Callbacks
sidebar_label: Callbacks
description: Use lifecycle callbacks to run custom logic when entities are created, updated, read, or deleted. Includes the context.data API for cross-collection operations.
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

## The `context.data` API

Every callback receives a `context` object that includes `context.data` — a unified data access layer for performing **cross-collection operations** from within lifecycle hooks.

### Accessing Collections

`context.data` uses a JavaScript Proxy, so you can access any collection by its slug as a property:

```typescript
afterSave: async ({ values, entityId, context }) => {
    // Dynamic property access — works for any collection slug
    const jobs = context.data.jobs;
    const users = context.data.users;

    // Alternatively, use the .collection() method for dynamic slugs
    const collectionName = "jobs";
    const accessor = context.data.collection(collectionName);
}
```

### Available Methods

Each collection accessor (`context.data.<slug>`) provides these methods:

| Method | Signature | Description |
|--------|-----------|-------------|
| `.find()` | `find(params?: FindParams) → FindResponse` | Query entities with filters, sorting, and pagination |
| `.findById()` | `findById(id: string \| number) → Entity \| undefined` | Fetch a single entity by ID |
| `.create()` | `create(data: Partial<Values>, id?: string) → Entity` | Create a new entity |
| `.update()` | `update(id: string \| number, data: Partial<Values>) → Entity` | Update an existing entity |
| `.delete()` | `delete(id: string \| number) → void` | Delete an entity |
| `.count()` | `count(params?: FindParams) → number` | Count matching entities |
| `.listen()` | `listen(params, onUpdate, onError?) → unsubscribe` | Real-time subscription (where supported) |
| `.listenById()` | `listenById(id, onUpdate, onError?) → unsubscribe` | Listen to a single entity |

### Querying with `.find()`

The `find()` method supports rich filtering:

```typescript
afterSave: async ({ values, context }) => {
    // Simple equality
    const { data: activeJobs } = await context.data.jobs.find({
        where: { status: "published" },
        limit: 10,
        orderBy: ["created_at", "desc"]
    });

    // PostgREST-style operators
    const { data: recentJobs } = await context.data.jobs.find({
        where: {
            status: "eq.published",
            salary: "gte.50000"
        }
    });

    // Tuple syntax
    const { data: expensiveJobs } = await context.data.jobs.find({
        where: {
            salary: [">=", 100000],
            role: ["in", ["admin", "manager"]]
        }
    });
}
```

### Creating Entities

```typescript
afterSave: async ({ values, entityId, previousValues, context }) => {
    // Promote an approved submission to a published job
    if (values.status === "approved" && previousValues?.status !== "approved") {
        const newJob = await context.data.jobs.create({
            title: values.title,
            description: values.description,
            company_id: values.company_id,
            status: "published",
            source_submission_id: entityId,
        });

        // Link back to the original submission
        await context.data["job-submissions"].update(entityId, {
            promoted_job_id: newJob.id,
        });
    }
}
```

### Security: RLS Bypass Behavior

:::important
**`context.data` operations in callbacks bypass Row Level Security (RLS).**

When callbacks execute on the backend, they run through the base `PostgresBackendDriver` — not the authenticated wrapper. This means `context.data` has **full database access** regardless of the triggering user's permissions.

This is intentional: server-side lifecycle hooks are trusted code that often needs to write to collections the end-user doesn't have direct access to (e.g., creating an audit log entry, updating a counter on a parent record).
:::

If you need RLS-scoped operations within a callback, use the authenticated driver directly:

```typescript
afterSave: async ({ context }) => {
    // This bypasses RLS (normal for callbacks):
    await context.data.audit_logs.create({ action: "approved" });

    // To enforce RLS, access the driver and call withAuth():
    const authDriver = await context.driver.withAuth(context.user);
    // authDriver.data operations respect RLS
}
```

### Transaction Semantics

:::warning
**`context.data` operations are NOT automatically wrapped in the same transaction as the triggering save.**

The original entity save completes its database transaction first. Then `afterSave` runs and any `context.data` calls open **separate transactions**. If a `context.data` operation fails in `afterSave`, the original save is **not rolled back**.
:::

This means:

- ✅ The triggering save always succeeds independently
- ⚠️ Side-effect writes may fail without affecting the original operation
- ⚠️ There is no atomicity guarantee between the original save and subsequent `context.data` calls

For operations that must be atomic, wrap them in error handling:

```typescript
afterSave: async ({ values, entityId, context }) => {
    try {
        await context.data.jobs.create({
            title: values.title,
            status: "published",
        });
    } catch (error) {
        // Log the failure — the original save already succeeded
        console.error(`Failed to promote job from submission ${entityId}:`, error);
        // Optionally: mark the submission as "promotion_failed"
        await context.data["job-submissions"].update(entityId, {
            promotion_status: "failed",
            promotion_error: String(error),
        });
    }
}
```

## Syncing Data Between Collections

One of the most powerful uses of callbacks is **syncing data across collections** using `context.data`:

```typescript
const submissionsCollection: EntityCollection = {
    slug: "job_submissions",
    callbacks: {
        afterSave: async ({ values, entityId, previousValues, context }) => {
            // When a submission is approved, create a published job
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const newJob = await context.data.jobs.create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: entityId,
                });

                // Update the submission with the promoted job reference
                await context.data["job-submissions"].update(entityId, {
                    promoted_job_id: newJob.id,
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

## Full Context Reference

Every callback receives a `context` object of type `RebaseCallContext`:

```typescript
interface RebaseCallContext {
    /** The authenticated user, if any */
    user?: User;
    /** The underlying data driver (PostgresBackendDriver) */
    driver: DataDriver;
    /** Unified data access — context.data.<slug>.create/update/find/delete */
    data: RebaseData;
}
```

## Next Steps

- **[Security Rules](/docs/collections/security-rules)** — Row Level Security
- **[Entity History](/docs/backend/history)** — Audit trail
- **[Custom Functions](/docs/backend/custom-functions)** — Add custom API endpoints
