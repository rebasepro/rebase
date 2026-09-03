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
import type { PostgresCollectionConfig } from "@rebasepro/types";

// The row shape. Without it every `values.x` below is `unknown`.
type Article = {
    title: string;
    slug: string;
    createdAt: string;
    updatedAt: string;
};

const articlesCollection: PostgresCollectionConfig<Article> = {
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { name: "Title", type: "string" },
        slug: { name: "Slug", type: "string" },
        createdAt: { name: "Created at", type: "string" },
        updatedAt: { name: "Updated at", type: "string" }
    },
    callbacks: {
        beforeSave: async ({ values, id, status }) => {
            // Auto-generate slug from title
            if (values.title) {
                values.slug = values.title
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/(^-|-$)/g, "");
            }

            // Set timestamps
            if (status === "new") {
                values.createdAt = new Date().toISOString();
            }
            values.updatedAt = new Date().toISOString();

            return values;
        },

        afterSave: async ({ values, id }) => {
            // Send notification
            console.log(`Article ${id} saved: ${values.title}`);
        },

        beforeDelete: async ({ id }) => {
            // Prevent deletion of published articles
            // Throw to block the deletion
        },

        afterRead: async ({ row }) => {
            // Transform data after loading
            return row;
        }
    },
    properties: { /* ... */ }
});
```

## Callback Reference

### `beforeSave`

Called before a entity is written to the database. Return the modified values.

```typescript
beforeSave: async ({
    values,       // Entity values
    id,           // Entity ID (null for new entities)
    status,       // "new" | "existing" | "copy"
    previousValues, // Previous values (for updates)
    context       // Full Rebase context
}) => {
    // Return modified values
    return { ...values, updatedAt: new Date() };
}
```

Throw an error to **block the save**. The write never reaches the database, and
the caller gets **400** with your message and the code `CALLBACK_REJECTED`:

```typescript
beforeSave: async ({ values }) => {
    if (values.price < 0) {
        throw new Error("Price cannot be negative");
    }
    return values;
}
```

```json
{ "error": { "message": "Price cannot be negative", "code": "CALLBACK_REJECTED",
             "details": { "stage": "beforeSave", "path": "products" } } }
```

To choose the status and code yourself — a 409 for a clash, a 422 for something
well-formed but unacceptable — throw a `RebaseApiError`:

```typescript
import { RebaseApiError } from "@rebasepro/types";

beforeSave: async ({ values }) => {
    if (await isTaken(values.slug)) {
        throw new RebaseApiError("That slug is taken", { status: 409, code: "SLUG_TAKEN" });
    }
    return values;
}
```

:::note
Import it from `@rebasepro/types`, not from `@rebasepro/server`. A collection file
is shared with the frontend — the admin panel's Vite build reads this same
directory — so it may only import packages that run in a browser. `RebaseApiError`
is the browser-safe one, and it is the same class the client SDK throws.
:::

### `afterSave`

Called after a successful save. Use for side effects.

```typescript
afterSave: async ({
    values,         // Saved values
    id,             // Entity ID
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
    id,
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
    row,    // The row to transform
    context
}) => {
    // Add computed fields
    return {
        ...row,
        displayName: `${row.first_name} ${row.last_name}`
    };
}
```

### `beforeDelete`

Called before a entity is deleted. Throw to block deletion.

```typescript
beforeDelete: async ({
    id,
    row,
    context
}) => {
    if (row.status === "published") {
        throw new Error("Cannot delete published articles. Unpublish first.");
    }
}
```

### `afterDelete`

Called after a successful deletion.

```typescript
afterDelete: async ({
    id,
    row,
    context
}) => {
    // Cleanup related data
    console.log(`Article ${id} deleted`);
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
| `.delete()` | `delete(id: string \| number) → void` | Delete a entity |
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
        orderBy: ["createdAt", "desc"]
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

### Security: which privileges `context.data` runs with

:::important
**`context.data` inherits the privileges of whatever triggered the callback.** It is not a fixed trust level.

- Triggered by a **user request** (REST, realtime, an admin-panel edit) → **user-scoped**. The callback runs inside the RLS-bound transaction opened for that request, so policies apply to reads *and* writes. A callback cannot see a row its caller could not.
- Triggered by **`rebase.dataAsAdmin` or a cron job** (the same singleton) → **admin-scoped**, not unscoped. That driver is scoped as `{ uid: "service", roles: ["admin"] }`, so the callback still runs on an RLS-bound transaction — your policies are evaluated, against that identity.
- Triggered by **the base driver** (built-in auth flows, migrations) → **unscoped**. It runs on the owner connection and bypasses RLS.
:::

This matters most in the direction that fails quietly. RLS *filters*, it does not raise — so a callback that reads a sibling row will find it when an admin task saves and may find nothing when an end user saves, with no error either way. Write callbacks that tolerate an empty result, or reach for the admin plane deliberately:

```typescript
afterSave: async ({ context }) => {
    // User-scoped when a user triggered this save: RLS applies.
    await context.data.audit_logs.create({ action: "approved" });

    // Deliberately admin-scoped — for work the caller genuinely may not see,
    // such as an audit trail they must not be able to read or edit. Note this
    // is an admin's reach, not a bypass: a collection whose only rule is
    // `policy.serverContext()` stays closed to it, since that compiles to
    // `rebase.uid() IS NULL` and this accessor's uid is `service`.
    await context.client.dataAsAdmin.audit_logs.create({ action: "approved" });
}
```

:::caution[This page used to say the opposite]
Earlier versions of this page stated that callbacks always bypass RLS and have "full database access regardless of the triggering user's permissions". That was wrong, and wrong in the unsafe direction — it invited callbacks written on the assumption that they could always see everything.

The behaviour above is verified end-to-end against Postgres by the `"scopes context.data to the caller when a callback runs on a user request"` case in `@rebasepro/server-postgres`' RLS-enforcement suite.
:::

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
        console.error(`Failed to promote job from submission ${id}:`, error);
        // Optionally: mark the submission as "promotion_failed"
        await context.data["job-submissions"].update(id, {
            promotion_status: "failed",
            promotion_error: String(error),
        });
    }
}
```

## Syncing Data Between Collections

One of the most powerful uses of callbacks is **syncing data across collections** using `context.data`:

```typescript
import type { PostgresCollectionConfig } from "@rebasepro/types";

type Submission = {
    title: string;
    description: string;
    company_id: string;
    status: string;
    promoted_job_id: string;
};

const submissionsCollection: PostgresCollectionConfig<Submission> = {
    slug: "job_submissions",
    name: "Job Submissions",
    table: "job_submissions",
    properties: {
        title: { name: "Title", type: "string" },
        description: { name: "Description", type: "string" },
        company_id: { name: "Company", type: "string" },
        status: { name: "Status", type: "string" },
        promoted_job_id: { name: "Promoted job", type: "string" }
    },
    callbacks: {
        afterSave: async ({ values, id, previousValues, context }) => {
            // When a submission is approved, create a published job
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const newJob = await context.data.collection<Record<string, unknown>>("jobs").create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: id,
                });

                // Update the submission with the promoted job reference
                await context.data.collection<Record<string, unknown>>("job_submissions").update(id, {
                    promoted_job_id: newJob.id,
                });
            }
        }
    },
    properties: { /* ... */ }
});
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
