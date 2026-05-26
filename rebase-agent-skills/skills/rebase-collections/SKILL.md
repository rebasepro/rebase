---
name: rebase-collections
description: Comprehensive guide for defining Rebase collections, property types, validation, and schema configuration. Use this skill when the user needs help creating collections, adding properties, configuring field types, or understanding the schema-as-code approach.
---

# Rebase Collections

Rebase collections are the core building blocks of your data model. They define the structure, validation, and UI configuration of your data — all in TypeScript.

## Core Concepts

### Collections

A collection is defined as a TypeScript object implementing the `PostgresCollection` interface from `@rebasepro/types`. Each collection maps to a database table (via the `table` property) and generates:
- Full CRUD REST endpoints at `/api/data/{slug}`
- Optional GraphQL queries and mutations
- Admin panel views (table, forms, cards, kanban, list)

### Properties

Properties define the fields of your collection. Rebase supports these built-in property types:

| Type | Description | PostgreSQL Column |
|------|-------------|-------------------|
| `string` | Text fields, URLs, emails, file uploads | `VARCHAR` / `TEXT` |
| `number` | Integers and decimals | `INTEGER` / `DOUBLE PRECISION` |
| `boolean` | True/false toggles | `BOOLEAN` |
| `date` | Date and datetime values | `TIMESTAMP` |
| `map` | Nested objects (JSON) | `JSONB` |
| `array` | Lists of values | `JSONB` |
| `relation` | Foreign key to another collection | FK column or junction table |
| `reference` | Legacy FK reference by collection slug | `UUID` with FK |
| `geopoint` | Latitude/longitude pairs | `JSONB` |

### Schema-as-Code

Collections are defined as standalone TypeScript files under `config/collections/` relative to the project root. The visual Studio edits these files via AST manipulation — it never runs raw SQL. This preserves custom callbacks and complex configuration.

## Defining a Collection

```typescript
import { PostgresCollection } from "@rebasepro/types";

const productsCollection: PostgresCollection = {
    name: "Products",
    singularName: "Product",
    slug: "products",
    table: "products",
    icon: "ShoppingBag",
    group: "E-Commerce",
    history: true,
    defaultViewMode: "table",
    enabledViews: ["table", "cards"],
    openEntityMode: "split",
    properties: {
        id: {
            name: "ID",
            type: "number",
            isId: "increment"
        },
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
            autoValue: "on_create",
            readOnly: true,
            hideFromCollection: true
        },
        category: {
            name: "Category",
            type: "string",
            enum: [
                { id: "electronics", label: "Electronics", color: "blue" },
                { id: "clothing", label: "Clothing", color: "purple" },
                { id: "books", label: "Books", color: "green" }
            ]
        }
    },
    propertiesOrder: [
        "name", "price", "category", "description",
        "published", "created_at"
    ]
};

export default productsCollection;
```

### Collection Options

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Display name (plural) |
| `singularName` | `string` | Singular display name |
| `slug` | `string` | URL slug for API and routing |
| `table` | `string` | PostgreSQL table name |
| `icon` | `string` | Lucide icon name |
| `group` | `string` | Sidebar group heading |
| `history` | `boolean` | Enable entity audit trail |
| `defaultViewMode` | `"table" \| "cards" \| "kanban" \| "list"` | Default view on open |
| `enabledViews` | `string[]` | Enabled view modes |
| `openEntityMode` | `"split" \| "side_panel" \| "full_screen"` | How entities open |
| `kanban` | `{ columnProperty: string }` | Kanban column config |
| `propertiesOrder` | `string[]` | Field display order in forms |
| `entityViews` | `string[] \| EntityView[]` | Custom tabs on entity detail |

## Property Validation

Every property supports a `validation` object:

```typescript
validation: {
    required: true,           // Field is mandatory
    min: 0,                   // Minimum value (numbers) or length (strings)
    max: 1000,                // Maximum value or length
    matches: /^[a-z]+$/,      // Regex pattern (strings)
    unique: true,             // Must be unique across all documents
    uniqueInArray: true,      // Must be unique within array
    requiredMessage: "...",   // Custom error message
}
```

## Enum Values

Use the `enum` property on `string` or `number` types to define picklist options:

```typescript
status: {
    name: "Status",
    type: "string",
    defaultValue: "draft",
    enum: [
        { id: "draft", label: "Draft", color: "gray" },
        { id: "published", label: "Published", color: "green" },
        { id: "archived", label: "Archived", color: "red" }
    ]
}
```

Each enum entry supports `id` (stored value), `label` (display text), `color` (optional chip color), and `disabled` (optional).

## Relations (Inline Property API)

Relations are defined **directly on the property** using `type: "relation"`. The framework automatically extracts these into the collection's internal `relations[]` at normalization time — you do **not** need a separate `relations[]` array.

### Many-to-One (Owning)

```typescript
import { PostgresCollection } from "@rebasepro/types";
import authorsCollection from "./authors";

const postsCollection: PostgresCollection = {
    name: "Posts",
    table: "posts",
    properties: {
        author: {
            name: "Author",
            type: "relation",
            target: () => authorsCollection,
            cardinality: "one",
            direction: "owning"
        }
    }
};
```

This automatically creates an `author_id` foreign key column on the `posts` table.

### Many-to-Many (Owning)

```typescript
tags: {
    name: "Tags",
    type: "relation",
    target: () => tagsCollection,
    cardinality: "many",
    direction: "owning"
}
```

This automatically creates a `posts_tags` junction table with `post_id` and `tag_id` columns.

### One-to-Many (Inverse)

```typescript
comments: {
    name: "Comments",
    type: "relation",
    target: () => commentsCollection,
    cardinality: "many",
    direction: "inverse",
    foreignKeyOnTarget: "post_id"
}
```

### Relation Property Options

| Option | Type | Description |
|--------|------|-------------|
| `target` | `() => EntityCollection` | Target collection (use a function for lazy resolution) |
| `cardinality` | `"one" \| "many"` | Whether this references one or many records |
| `direction` | `"owning" \| "inverse"` | Which side owns the FK or junction table |
| `localKey` | `string` | Column on this table storing the FK (auto-inferred) |
| `foreignKeyOnTarget` | `string` | Column on target table storing the FK (for inverse) |
| `through` | `{ table, sourceColumn, targetColumn }` | Custom junction table config |
| `onDelete` | `OnAction` | Cascade rule on delete |
| `onUpdate` | `OnAction` | Cascade rule on update |
| `widget` | `"select" \| "dialog"` | UI widget for selecting relations |
| `previewProperties` | `string[]` | Properties shown in relation preview (max 3) |

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
const jobSubmissionsCollection: PostgresCollection = {
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
const jobSubmissionsCollection: PostgresCollection = {
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

Entity views can be registered:
1. **Globally** in the `<RebaseCMS>` component via the `entityViews` prop
2. **Per-collection** by referencing view keys in the collection's `entityViews` array

```typescript
// Global registration in App.tsx
const entityViews = [
    {
        key: "blog_preview",
        name: "Preview",
        Builder: BlogEntryPreview,
        position: "start" as const
    }
];

<RebaseCMS collections={collections} entityViews={entityViews}/>

// Per-collection reference in collection definition
const postsCollection: PostgresCollection = {
    name: "Posts",
    table: "posts",
    entityViews: ["blog_preview"],  // References the global view by key
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
const postsCollection: PostgresCollection = {
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
# All commands run from the project root directory unless noted

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
