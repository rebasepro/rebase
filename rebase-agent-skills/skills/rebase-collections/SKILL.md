---
name: rebase-collections
description: Comprehensive guide for defining Rebase collections, property types, validation, and schema configuration. Use this skill when the user needs help creating collections, adding properties, configuring field types, or understanding the schema-as-code approach.
---

# Rebase Collections

Rebase collections are the core building blocks of your data model. They define the structure, validation, and UI configuration of your data — all in TypeScript.

## Core Concepts

### Collections

A collection is defined as a TypeScript object implementing the `EntityCollection` interface. Each collection maps to a database table (via the `table` property) and generates:
- Full CRUD REST endpoints at `/api/data/{slug}`
- Optional GraphQL queries and mutations
- Admin panel views (spreadsheet, forms, cards, kanban)

### Properties

Properties define the fields of your collection. Rebase supports 20+ built-in property types:

| Type | Description | PostgreSQL Column |
|------|-------------|-------------------|
| `string` | Text fields, URLs, emails | `VARCHAR` / `TEXT` |
| `number` | Integers and decimals | `INTEGER` / `DOUBLE PRECISION` |
| `boolean` | True/false toggles | `BOOLEAN` |
| `date` | Date and datetime values | `TIMESTAMP` |
| `map` | Nested objects (JSON) | `JSONB` |
| `array` | Lists of values | `JSONB` |
| `reference` | Foreign key to another collection | `UUID` with FK |
| `geopoint` | Latitude/longitude pairs | `JSONB` |

### Schema-as-Code

Collections are defined as standalone TypeScript files. The visual Studio edits these files via AST manipulation — it never runs raw SQL. This preserves custom callbacks and complex configuration.

## Defining a Collection

The `table` property is **required** and specifies the PostgreSQL table name:

```typescript
import { EntityCollection } from "@rebasepro/core";

const productsCollection: EntityCollection = {
    name: "Products",
    table: "products",
    properties: {
        name: {
            name: "Product Name",
            type: "string",
            validation: { required: true }
        },
        price: {
            name: "Price",
            type: "number",
            validation: { required: true, min: 0 }
        },
        description: {
            name: "Description",
            type: "string",
            multiline: true
        },
        published: {
            name: "Published",
            type: "boolean",
            defaultValue: false
        },
        created_at: {
            name: "Created At",
            type: "date",
            mode: "date_time",
            autoValue: "on_create"
        },
        category: {
            name: "Category",
            type: "string",
            enumValues: [
                { id: "electronics", label: "Electronics" },
                { id: "clothing", label: "Clothing" },
                { id: "books", label: "Books" }
            ]
        }
    }
};

export default productsCollection;
```

## Property Validation

Every property supports a `validation` object:

```typescript
validation: {
    required: true,           // Field is mandatory
    min: 0,                   // Minimum value (numbers) or length (strings)
    max: 1000,                // Maximum value or length
    matches: /^[a-z]+$/,      // Regex pattern (strings)
    email: true,              // Must be valid email
    url: true,                // Must be valid URL
    unique: true,             // Must be unique across all documents
    uniqueInArray: true,      // Must be unique within array
    requiredMessage: "...",   // Custom error message
}
```

## Relations

Collections support two complementary relation systems:

### Reference Properties (UI Pickers)

Use `type: "reference"` in properties to render relation pickers in the admin UI:

```typescript
properties: {
    customer_id: {
        name: "Customer",
        type: "reference",
        path: "customers",     // References the customers collection by slug
        previewProperties: ["name", "email"]
    }
}
```

**Note:** The `path` property in references uses the collection's **slug** (not the database table name).

### Relations Array (Database-Level Foreign Keys)

Use the `relations` array to define database-level foreign keys, cascade rules, and many-to-many joins:

```typescript
const postsCollection: EntityCollection = {
    name: "Posts",
    table: "posts",
    relations: [
        // Many-to-One: each post has one author
        {
            relationName: "author",
            target: () => usersCollection,
            cardinality: "one",
            direction: "owning",
            localKey: "author_id",
            onDelete: "cascade"   // Delete posts when user is deleted
        },
        // One-to-Many (inverse): list comments on a post
        {
            relationName: "comments",
            target: () => commentsCollection,
            cardinality: "many",
            direction: "inverse",
            foreignKeyOnTarget: "post_id"
        }
    ],
    properties: {
        author: {
            type: "relation",
            name: "Author",
            relationName: "author",  // Must match a relation in relations[]
            widget: "select"
        },
        // ... other properties
    }
};
```

### Many-to-Many (Junction Table)

```typescript
relations: [
    {
        relationName: "tags",
        target: () => tagsCollection,
        cardinality: "many",
        direction: "owning",
        through: {
            table: "post_tags",         // Junction table
            sourceColumn: "post_id",
            targetColumn: "tag_id"
        }
    }
]
```

### Cascade Rules

| Action | Behavior |
|--------|----------|
| `"cascade"` | Propagate change to related rows |
| `"restrict"` | Prevent if related rows exist |
| `"set null"` | Set FK to NULL |
| `"no action"` | Defer to constraint check |
| `"set default"` | Set FK to default value |

> **See full documentation:** [Relations](https://rebase.pro/docs/collections/relations)

## Entity Callbacks (Lifecycle Hooks)

> **IMPORTANT FOR AGENTS**: Collections support **lifecycle callbacks** that let you run custom logic when entities are created, updated, read, or deleted. Use these to **sync data between collections**, transform data, validate business rules, or trigger side effects. **Do NOT use raw SQL triggers, cron jobs, or external scripts** when a callback can solve the problem.

Add a `callbacks` property to any collection definition:

```typescript
const jobSubmissionsCollection: EntityCollection = {
    name: "Job Submissions",
    table: "job_submissions",
    callbacks: {
        // Runs BEFORE saving — transform or validate data
        beforeSave: async ({ values, status }) => {
            if (values.title) {
                values.slug = values.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            }
            if (status === "new") {
                values.created_at = new Date();
            }
            return values;
        },

        // Runs AFTER saving — trigger side effects, sync other collections
        afterSave: async ({ values, entityId, previousValues, context }) => {
            // Example: When status changes to "approved", copy to the jobs table
            if (values.status === "approved" && previousValues?.status !== "approved") {
                const dataSource = context.dataSource;
                await dataSource.saveEntity({
                    path: "jobs",
                    entityId: undefined, // auto-generate new ID
                    values: {
                        title: values.title,
                        description: values.description,
                        company_id: values.company_id,
                        status: "published",
                        source_submission_id: entityId,
                    },
                    collection: jobsCollection, // reference to target collection
                    status: "new"
                });
            }
        },

        // Runs BEFORE deleting — block or validate
        beforeDelete: async ({ entity }) => {
            if (entity.values.status === "published") {
                throw new Error("Cannot delete published submissions");
            }
        },

        // Runs AFTER deleting — cleanup related data
        afterDelete: async ({ entityId, context }) => {
            console.log(`Submission ${entityId} deleted`);
        },

        // Runs AFTER reading — transform for display
        afterRead: async ({ entity }) => {
            return {
                ...entity,
                values: {
                    ...entity.values,
                    displayName: `${entity.values.title} (${entity.values.company_name})`
                }
            };
        }
    },
    properties: { /* ... */ }
};
```

### Available Callbacks

| Callback | When It Runs | Return Value | Can Block? |
|----------|-------------|--------------|------------|
| `beforeSave` | Before write to DB (after validation) | Modified `values` | Yes (throw to block) |
| `afterSave` | After successful write | `void` | No |
| `afterSaveError` | After a failed write | `void` | No |
| `afterRead` | After reading from DB | Modified `entity` | No |
| `beforeDelete` | Before deletion | `void` | Yes (throw to block) |
| `afterDelete` | After successful deletion | `void` | No |

### Common Use Cases

- **Syncing data between collections** — Use `afterSave` to copy/move entities from one collection to another (e.g., approved submissions → published jobs)
- **Computed fields** — Use `beforeSave` to generate slugs, timestamps, or derived values
- **Validation** — Use `beforeSave` to enforce business rules beyond schema validation
- **Notifications** — Use `afterSave` to send emails, Slack messages, or webhook calls
- **Cascade operations** — Use `afterDelete` to clean up related records in other collections
- **Data enrichment** — Use `afterRead` to add computed/virtual fields for display

### Callback Props Reference

All callbacks receive these properties:

| Prop | Available In | Description |
|------|-------------|-------------|
| `values` | `beforeSave`, `afterSave`, `afterSaveError` | Entity values being saved |
| `entityId` | All callbacks | Entity ID (`undefined` for new entities in `beforeSave`) |
| `previousValues` | `beforeSave`, `afterSave` | Previous values (for updates) |
| `status` | `beforeSave`, `afterSave` | `"new"`, `"existing"`, or `"copy"` |
| `entity` | `afterRead`, `beforeDelete`, `afterDelete` | Full entity object |
| `context` | All callbacks | Rebase context with `dataSource`, `authController`, etc. |
| `collection` | All callbacks | The collection definition |
| `path` | All callbacks | Collection path |

> **See full documentation:** [Entity Callbacks](https://rebase.pro/docs/collections/callbacks)

## Entity Actions (Custom UI Buttons)

> **IMPORTANT FOR AGENTS**: Collections support **custom action buttons** that appear in the collection table view and entity form. Use these for workflow actions like "Approve", "Send Email", "Export PDF", "Clone to Staging", etc. Do NOT build separate pages or scripts for common admin actions.

Add an `entityActions` array to any collection definition:

```typescript
const jobSubmissionsCollection: EntityCollection = {
    name: "Job Submissions",
    table: "job_submissions",
    entityActions: [
        {
            name: "Approve",
            icon: <CheckCircleIcon />,
            // Only show for pending submissions
            isEnabled: ({ entity }) => entity?.values.status === "pending",
            onClick: async ({ entity, context, onCollectionChange }) => {
                if (!entity) return;
                await context.dataSource.saveEntity({
                    path: "job_submissions",
                    entityId: entity.id,
                    values: { ...entity.values, status: "approved" },
                    collection: jobSubmissionsCollection,
                    status: "existing"
                });
                context.snackbarController?.open({
                    type: "success",
                    message: "Submission approved!"
                });
                onCollectionChange?.();
            }
        },
        {
            name: "Export PDF",
            collapsed: true,  // Show in overflow menu
            includeInForm: true,
            onClick: async ({ entity }) => {
                window.open(`/api/functions/export-pdf/${entity?.id}`);
            }
        }
    ],
    properties: { /* ... */ }
};
```

### EntityAction Interface

| Property | Type | Description |
|----------|------|-------------|
| `name` | `string` | Button label |
| `icon` | `ReactElement` | Optional icon |
| `onClick` | `(props) => void` | Action handler — receives `entity`, `context`, `formContext`, `selectionController` |
| `isEnabled` | `(props) => boolean` | Optional — disable the action conditionally |
| `collapsed` | `boolean` | If `true`, show in overflow menu (default: `true`) |
| `includeInForm` | `boolean` | Show in entity form view (default: `true`) |
| `key` | `string` | Override default actions (`"edit"`, `"delete"`, `"copy"`) |

### onClick Props

The `onClick` handler receives:
- `entity` — The current entity
- `context` — Full Rebase context (`dataSource`, `authController`, `snackbarController`, etc.)
- `formContext` — Form state and methods (when called from a form)
- `sideEntityController` — Side panel control (when in side panel)
- `selectionController` — Multi-select state (when in collection view)
- `view` — `"collection"` or `"form"`
- `onCollectionChange` — Call to refresh the collection view
- `navigateBack` — Navigate back (e.g., after deleting)

## Entity Custom Views (Tabs)

Collections support `entityViews` — custom React components that appear as **tabs** in the entity detail view. Use these for previews, analytics, related items, or any custom UI per entity.

```typescript
const productsCollection: EntityCollection = {
    name: "Products",
    table: "products",
    entityViews: [
        {
            key: "preview",
            name: "Preview",
            Builder: ({ entity, modifiedValues }) => (
                <div style={{ padding: 24 }}>
                    <h2>{modifiedValues?.name || entity?.values.name}</h2>
                    <p>{modifiedValues?.description || entity?.values.description}</p>
                    <span>Price: ${modifiedValues?.price || entity?.values.price}</span>
                </div>
            )
        },
        {
            key: "analytics",
            name: "Analytics",
            Builder: ({ entity }) => (
                <AnalyticsDashboard productId={entity?.id} />
            )
        }
    ],
    properties: { /* ... */ }
};
```

The `Builder` component receives:
- `entity` — The saved entity (may be `undefined` for new entities)
- `modifiedValues` — Current unsaved form values
- `formContext` — Form state and methods
- `collection` — The collection definition

## Security Rules (RLS)

Collections support **Row Level Security** via the `securityRules` array. This generates PostgreSQL RLS policies:

```typescript
const postsCollection: EntityCollection = {
    name: "Posts",
    table: "posts",
    securityRules: [
        // Anyone can read published posts
        { operation: "select", access: "public", using: "{status} = 'published'" },
        // Authors can see/edit their own
        { operations: ["select", "insert", "update"], ownerField: "author_id" },
        // Only admins can delete
        { operation: "delete", roles: ["admin"] }
    ],
    properties: { /* ... */ }
};
```

### Shortcut Options

| Option | Example | SQL Generated |
|--------|---------|---------------|
| `access: "public"` | Anyone can access | `USING (true)` |
| `access: "authenticated"` | Any logged-in user | `USING (auth.uid() IS NOT NULL)` |
| `ownerField: "user_id"` | Only the owner | `USING (user_id = auth.uid())` |
| `roles: ["admin"]` | Specific roles only | `USING ('admin' = ANY(auth.roles()))` |
| `using: "..."` | Raw SQL expression | Custom USING clause |
| `withCheck: "..."` | Raw SQL for writes | Custom WITH CHECK clause |

> **See full documentation:** [Security Rules](https://rebase.pro/docs/collections/security-rules)

## Schema Migration Workflow

After modifying collections, apply changes to the database:

```bash
# All commands run from the app/ directory unless noted

# 1. Regenerate the Drizzle schema from your collection definitions
rebase schema generate

# 2a. Development — push changes directly
rebase db push

# 2b. Production — generate and review migration files
rebase db generate
rebase db migrate
```

## References

- **Documentation:** [rebase.pro/docs](https://rebase.pro/docs)
- **GitHub:** [github.com/rebasepro/rebase](https://github.com/rebasepro/rebase)
