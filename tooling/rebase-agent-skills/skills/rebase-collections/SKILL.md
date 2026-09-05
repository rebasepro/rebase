---
name: rebase-collections
description: Comprehensive guide for defining Rebase collections, property types, validation, and schema configuration. Use this skill when the user needs help creating collections, adding properties, configuring field types, understanding the schema-as-code approach, making a collection searchable — including when search returns nothing for content stored in a map/JSONB property — or declaring indexes on a collection.
---

# Rebase Collections

Rebase collections are the core building blocks of your data model. They define the structure, validation, and UI configuration of your data — all in TypeScript.

## Core Concepts

### Collections

A collection is defined as a TypeScript object implementing the `PostgresCollectionConfig` interface from `@rebasepro/types`. Each collection maps to a database table (via the `table` property) and generates:
- Full CRUD REST endpoints at `/api/data/{slug}`
- Admin panel views (table, forms, cards, kanban, list)

### Properties

Properties define the fields of your collection. Rebase supports these built-in property types:

| Type | Description | PostgreSQL Column |
|------|-------------|-------------------|
| `string` | Text fields, URLs, emails, markdown, file uploads | `VARCHAR` / `TEXT` |
| `number` | Integers and decimals | `INTEGER` / `DOUBLE PRECISION` |
| `boolean` | True/false toggles | `BOOLEAN` |
| `date` | Date and datetime values | `TIMESTAMP` |
| `map` | Nested objects (JSON) | `JSONB` |
| `array` | Lists of values | `JSONB` or native arrays |
| `relation` | Foreign key to another collection (SQL JOINs) | FK column or junction table |
| `reference` | Legacy FK reference by collection slug (Firestore-style) | `UUID` with FK |
| `geopoint` | Latitude/longitude pairs | `JSONB` |
| `vector` | Embedding vectors for similarity search | `VECTOR` |
| `binary` | Raw bytes; crosses the API as a base64 string | `BYTEA` |

### Reference vs Relation

> **IMPORTANT FOR AGENTS:** Understand the difference between `reference` and `relation` — they are NOT interchangeable.

| Feature | `relation` (Recommended) | `reference` (Legacy) |
|---------|-------------------------|---------------------|
| Backend | SQL JOINs, FK constraints | Stores a collection path + entity ID |
| Cascade rules | `onDelete`, `onUpdate` | None |
| Junction tables | Yes (many-to-many) | No |
| Multi-hop joins | Yes (`joinPath`) | No |
| Inverse lookups | Yes (`kind: "hasMany"` / `"hasOne"`) | No |
| Where to use | **PostgresCollectionConfig** | FirebaseCollectionConfig or legacy |
| Stored value | FK column(s) managed by framework | `{ id, path }` object or string |

**Use `relation` for all new Postgres collections.** The `reference` type exists for backward compatibility with Firestore-style collections.

A `string` property can also act as a lightweight reference via its `reference` sub-property (stores just the ID string and renders a reference picker), but this does not create SQL JOINs.

### Schema-as-Code

Collections are defined as standalone TypeScript files under `config/collections/` relative to the project root. The visual Studio edits these files via AST manipulation — it never runs raw SQL. This preserves custom callbacks and complex configuration.

## Defining a Collection

```typescript
import { PostgresCollectionConfig } from "@rebasepro/types";

const productsCollection: PostgresCollectionConfig = {
    name: "Products",
    singularName: "Product",
    slug: "products",
    table: "products",
    description: "Product catalog with pricing and inventory",
    history: true,
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
            admin: { multiline: true }
        },
        published: {
            name: "Published",
            type: "boolean",
            defaultValue: false
        },
        createdAt: {
            name: "Created At",
            type: "date",
            mode: "date_time",
            autoValue: "on_create",
            admin: { readOnly: true, hideFromCollection: true }
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
    admin: {
        icon: "ShoppingBag",
        group: "E-Commerce",
        defaultViewMode: "table",
        enabledViews: ["table", "cards"],
        openEntityMode: "split",
        inlineEditing: true,
        exportable: true,
        selectionEnabled: true,
        propertiesOrder: [
            "name", "price", "category", "description",
            "published", "createdAt"
        ]
    }
};

export default productsCollection;

```

> **Presentation lives under `admin`.** Keys written `admin.x` below go inside a nested
> `admin: { … }` block, not at the top level. The backend never reads inside it, which is
> what lets a BaaS or headless project have no React in its dependency tree at all.
<!-- docs-verify: ignore -->
> **There is no `AdminCollectionConfig` wrapper type** — do not import one. The block is
> typed by a **program-level augmentation**: put one triple-slash reference in the config
> package,
>
> ```ts
> /// <reference types="@rebasepro/cms-types" />
> ```
>
> and `admin` is typed on every collection and every property from then on. An
> augmentation applies to a whole TypeScript *program*, and `config/` and `frontend/` are
> separate programs, which is why the reference belongs in `config/`. Without it, `admin`
> is opaque and a typo compiles.


### Collection Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | — | Display name (plural). E.g. `"Products"` |
| `singularName` | `string` | — | Singular display name. E.g. `"Product"` |
| `slug` | `string` | — | URL slug for API and routing |
| `table` | `string` | — | PostgreSQL table name |
| `schema` | `string` | `"public"` | PostgreSQL schema name |
| `description` | `string` | — | Description shown in the UI (supports Markdown) |
| `admin.icon` | `string \| ReactNode` | — | Lucide icon name or React element |
| `admin.group` | `string` | `"Views"` | Sidebar group heading |
| `dataSource` | `string` | `"(default)"` | Data-source key — routes the collection to a database declared with `database("<key>")` in `config/resources.ts`. See **Data sources & multiple backends** below. |
| `driver` | `string` | `undefined` | **Deprecated** — engine hint (`"postgres"`/`"firestore"`/`"mongodb"`). Prefer `dataSource`. When `dataSource` is omitted, `driver` doubles as the routing key. |
| `databaseId` | `string` | — | Physical DB/schema/Firestore-database within the engine |
| `history` | `boolean` | `false` | Enable entity audit trail (requires history plugin) |
| `admin.defaultViewMode` | `ViewMode` | `"table"` | Default view: `"table"`, `"cards"`, `"kanban"`, `"list"` |
| `admin.enabledViews` | `ViewMode[]` | `["table","cards","kanban"]` | Enabled view modes |
| `admin.openEntityMode` | `"split" \| "side_panel" \| "full_screen" \| "dialog"` | `"full_screen"` | How entities open when clicked |
| `admin.defaultEntityAction` | `"edit" \| "view"` | `"edit"` | Click behavior: open form or read-only view |
| `admin.kanban` | `{ columnProperty: string }` | — | Kanban column config (requires enum property). **Always pair with `admin.orderProperty`** — see **Kanban boards** below |
| `admin.propertiesOrder` | `string[]` | — | Field display order in forms and table |
| `admin.form` | `FormLayoutConfig` | — | Form layout: `sidebar`, `sections`, `showRecordMeta`. See **Form layout** below |
| `admin.entityViews` | `(string \| EntityCustomView)[]` | — | Custom tabs on entity detail |
| `admin.display` | `EntityDisplay` | derived | What fills each display role — `title`, `subtitle`, `image`, `status`, `date`, `tags`. Each takes a property path or a resolver (may be async). See **Entity display** below |
| `admin.previewProperties` | `string[]` | — | Properties shown when this collection is referenced |
| `admin.listProperties` | `string[]` | — | Columns to display in list view |
| `admin.selectionEnabled` | `boolean` | — | Enable row selection checkboxes |
| `admin.selectionController` | `SelectionController` | — | External selection state controller |
| `admin.inlineEditing` | `boolean` | — | Allow inline editing in collection table view |
| `admin.exportable` | `boolean \| ExportConfig` | — | Enable data export. `true` for default, or `ExportConfig` for custom fields |
| `admin.pagination` | `boolean \| number` | `true` (50) | Enable pagination. Set a number to customize page size |
| `admin.defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | — | Default rendered row size |
| `admin.fixedFilter` | `FilterValues` | — | Permanent filter that cannot be changed by users |
| `admin.defaultFilter` | `FilterValues` | — | Initial filter (can be changed by users) |
| `admin.filterPresets` | `FilterPreset[]` | — | Quick-access filter buttons in toolbar |
| `admin.sort` | `[string, "asc" \| "desc"]` | — | Default sort order. E.g. `["createdAt", "desc"]` |
| `admin.orderProperty` | `string` | — | Property key for drag-and-drop ordering (Kanban/general). Must name a **string** property — never a number. See **Kanban boards** below |
| `admin.formAutoSave` | `boolean` | `false` | Auto-save form on field change |
| `admin.formView` | `FormViewConfig` | — | Custom component replacing the default entity form |
| `admin.hideFromNavigation` | `boolean` | `false` | Hide from sidebar (still accessible via URL) |
| `admin.hideIdFromForm` | `boolean` | `false` | Hide ID field in entity form. Prefer `admin.form.showRecordMeta`, which moves the id to the metadata rail instead of hiding it |
| `admin.hideIdFromCollection` | `boolean` | `false` | Hide ID column in collection table |
| `admin.defaultSelectedView` | `string \| Function` | — | Auto-open a custom view/subcollection tab |
| `admin.sideDialogWidth` | `number \| string` | — | Width of side dialog in pixels |
| `admin.alwaysApplyDefaultValues` | `boolean` | `false` | Re-apply defaults on every update |
| `admin.includeJsonView` | `boolean` | `true` | Offer the raw values in the record inspector |
| `admin.localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | `"manual_apply"` | Local changes backup strategy |
| `admin.disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | — | Disable built-in actions |
| `admin.additionalFields` | `AdditionalFieldDelegate[]` | — | Virtual computed columns for views |
| `admin.entityActions` | `EntityAction[]` | — | Custom action buttons (see Entity Actions section) |
| `admin.Actions` | `ComponentRef[]` | — | Custom toolbar action components |
| `callbacks` | `CollectionCallbacks<M, USER>` | — | Lifecycle hooks (see Collection Callbacks section) |
| `relations` | `Relation[]` | — | Explicit relation definitions (usually auto-extracted from properties) |
| `securityRules` | `SecurityRule[]` | — | Row Level Security policies |
| `search` | `SearchConfig` | — | Opt in to ranked full-text search over named fields (Postgres only). See **Search** below |
| `childCollections` | `() => CollectionConfig[]` | — | Nested child collections (populated automatically) |
| `ownerId` | `string` | — | Owner user ID (for plugins/custom code) |
| `auth` | `boolean | AuthCollectionConfig` | — | Mark collection as authentication collection (user management, reset password, etc.) |
| `admin.components` | `CollectionComponentOverrideMap` | — | Collection-scoped UI component overrides |



## Kanban boards

A Kanban board is **three** decisions, not one. Ship all three together; each one
missing produces a board that renders, looks configured, and silently does not
reorder.

### 1. `kanban` and `orderProperty` are two halves of one feature

```ts
import { PostgresCollectionConfig } from "@rebasepro/types";

const tasksCollection: PostgresCollectionConfig = {
    name: "Tasks",
    slug: "tasks",
    table: "tasks",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        status: {
            name: "Status",
            type: "string",
            enum: [
                { id: "todo", label: "To do" },
                { id: "doing", label: "Doing" },
                { id: "done", label: "Done" }
            ]
        },
        // The order key. Machinery, not content — hide it.
        __order: {
            name: "Order",
            type: "string",
            admin: { disabled: true, hideFromCollection: true }
        }
    },
    admin: {
        defaultViewMode: "kanban",
        enabledViews: ["kanban", "table"],
        kanban: { columnProperty: "status" },
        orderProperty: "__order"      // ← never omit this
    }
};
```

Declaring `kanban` without `orderProperty` still gives you a draggable board:
moving a card between columns writes `columnProperty` and sticks. Its position
*within* a column has nowhere to be stored, so it snaps back on the next read,
and the board renders an amber "ordering is not configured" bar above the
columns. Nothing errors. Reviewing the config will not show you the bug — only
opening the board will.

### 2. The order property is a `string`

Reordering writes a `fractional-indexing` key — `"i0"`, `"i1"`, `"i0i"` — not an
index. Keys use the **base36, lower-case** alphabet
`0123456789abcdefghijklmnopqrstuvwxyz`: Postgres does the sorting and its default
collation is not byte ordering, so the library's default base62 output (`"a0"`,
mixing cases) sorts differently in the database than in the key.

Consequences worth knowing before you pick a type:

- `type: "number"` can never hold a key. A `sortOrder` number leaves the board
  permanently asking to be initialised, and the initialisation then fails writing
  a string into a numeric column.
- A plain counter in a string column — `"1"`, `"12"`, `"000001"` — is rejected
  just as hard. `fractional-indexing` cannot interpolate against it, so the board
  treats it as absent.
- `generateKeyBetween(a, b)` **without the alphabet argument** produces base62
  keys the board rejects. Always pass `ORDER_KEY_DIGITS`.

### 3. Rows created outside the admin need a key assigned

Nothing assigns an order key on insert — not the REST API, not the SDK, not a
cron, not a seed script, not a migration. Those rows land with `__order` null and
the board shows *"Some items don't have order values. Initialize to enable
drag-and-drop reordering."* Clicking **Initialize** backfills one page; the next
cron run brings the bar straight back.

**If a backend writes rows into a board collection, it assigns the key.**

```ts
import { generateKeyBetween } from "fractional-indexing";

const ORDER_KEY_DIGITS = "0123456789abcdefghijklmnopqrstuvwxyz";

const leads = client.data.collection("leads");

// The last key currently in use. `is-not-null` is not optional: a descending
// sort is NULLS FIRST in this driver, so without it this reads back one of the
// very rows that has no key, and every insert lands on the same "i0".
const { data: last } = await leads.find({
    where: { __order: ["is-not-null", null] },
    orderBy: ["__order", "desc"],
    limit: 1
});
let cursor: string | null = (last[0]?.__order as string | undefined) ?? null;

for (const candidate of shortlist) {
    cursor = generateKeyBetween(cursor, null, ORDER_KEY_DIGITS);
    await leads.create({ /* … */ status: "new", __order: cursor });
}
```

Note the `cursor` carried across the loop. Calling
`generateKeyBetween(null, null, …)` per row instead hands every row of the batch
the same key — valid enough to clear the warning bar, useless as an order.
Re-reading the max inside the loop is correct but costs a round-trip per row.

### The config validator checks two of these for you

`assertCollectionConfigs` runs wherever the collections are loaded — server
boot, `rebase schema generate`, `rebase doctor` — so you do not have to
remember:

- `kanban` (or a `kanban` entry in `enabledViews`/`defaultViewMode`) with no
  `orderProperty` → **warning**, naming the property to add. It boots: the board
  works, it just does not reorder.
- `orderProperty` naming a property that does not exist, or one that is not a
  `string` → **error**, and the boot fails. Both are unambiguously broken, and
  the fix is one line.

Nothing checks decision 3 — no static check can tell which code paths write to
a collection. That one is on you.

### Checklist

Before calling a Kanban collection done:

- [ ] `kanban.columnProperty` names an **enum** property
- [ ] `orderProperty` is set, and names a **string** property
- [ ] that property is hidden (`admin: { disabled: true, hideFromCollection: true }`)
- [ ] every code path that creates rows in this collection assigns an order key
- [ ] the property exists in `properties` — under `defineCollection` the key is
      checked against them, so a missing one narrows to `never` and fails to
      typecheck; under `PostgresCollectionConfig` it is a plain `string` and a
      typo goes through silently
- [ ] the schema was regenerated and pushed after adding it (**Schema Migration
      Workflow** below) — the column has to exist before anything can write a key

## Search

By default `.search("term")` is a case-insensitive **substring** match OR-ed
across the collection's top-level `string` properties. It cannot see inside
`map` (JSONB) or `array` properties, does not rank, and cannot use an index.

**This is the single most common "search is broken" report.** If a collection
keeps searchable content in a `map` — tags, certifications, a questionnaire, an
answers blob — none of it is reachable by the default, and the search box
returns nothing with no error. When a user says search finds nothing for content
they can plainly see on the record, check where that content lives before
anything else.

Declare a `search` block to fix it. Postgres only.

```typescript
const talents: PostgresCollectionConfig = {
    slug: "talents",
    table: "talents",
    name: "Candidates",
    properties: { /* … */ },
    search: {
        language: "spanish",     // stemming + stopwords; default "simple" (neither)
        unaccent: true,          // `auditoria` matches `auditoría`
        fuzzy: true,             // `iso14000` reaches `ISO 14001`
        fields: [
            { path: "full_name", weight: "A" },
            { path: "questionnaire.certifications", weight: "A" },  // into the JSONB
            "location",                                             // defaults to weight B
            "interests"                                             // a string[]
        ]
    }
};
```

Rows then come back with a sortable `_score`:

```typescript
client.data.talents.search("auditor iso 14001").orderBy("_score", "desc").find()
```

### Rules an agent must not get wrong

- **Nothing is inferred.** A field is indexed only if named in `fields`. A path
  that does not resolve is a **boot error**, not a warning — so a config that
  boots is a config whose search fields are all real.
- **A path may name** a `string` property, a `string[]` property, a `map`, or a
  dotted path inside a map (`"questionnaire.certifications"`). A map path
  indexes every string value at or below it, at any depth. JSON *keys* are never
  indexed.
- **Enums, UUIDs, `json` (not `jsonb`) columns and numeric arrays are refused.**
  Enums are a fixed vocabulary — filter them with `where`, which is exact and
  indexed.
- **`language` defaults to `"simple"`**, which does no stemming. Set it to the
  content's language deliberately; a stemmer applied to the wrong language
  silently mangles lexemes.
- **`unaccent` is not cosmetic** in an accented language. Postgres stems
  `auditoría` → `auditor` and `auditoria` → `auditori`, *different lexemes*, so
  without it a query typed without accents misses every row that has them.
- **Weights are `A`–`D`**, strongest to weakest, defaulting to `B`. Put names and
  identifiers at `A` and long free text at `D`, or a passing mention in a bio
  outranks the field the user actually meant.
- **Declaring it creates schema**: one generated `tsvector` column plus a GIN
  index (and, with `fuzzy`, a second column and a trigram index). Boot-ensure
  adds them; adding a stored generated column rewrites the table, so on a large
  live table treat it as a planned migration.
- **Do not add it to a Mongo or Firestore collection.** It is refused at boot.

### Explaining a match

`client.data.x.search(term, { explain: true })` returns `_matches` per row —
which declared field matched, plus a `<mark>`-highlighted snippet. This is
usually what someone means by "show me why this result appeared". Per-query, not
config: it costs a `ts_headline` per field per row.

### When *not* to reach for it

If the user wants exact matching on a known field, use `where` — it is exact,
indexed, and needs no schema. The `search` block is for free-text queries a
human types.

## Indexes

A collection declares the indexes its queries need, in `indexes`. Postgres only
— refused at boot on another engine, not silently ignored.

```typescript
const posts: PostgresCollectionConfig = {
    slug: "posts",
    table: "posts",
    name: "Blog posts",
    properties: { /* … */ },
    indexes: [
        // Filter by status, newest first. ONE index serves the filter and the
        // sort, because a btree can be read in order.
        { on: ["status", { prop: "publishDate", direction: "desc" }],
          reason: "admin list: filter by status, newest first" },
        // Partial: the index holds only published rows, and stays small as
        // drafts accumulate.
        { on: ["publishDate"],
          where: { prop: "status", op: "=", value: "published" },
          reason: "public feed is published-only" },
        // `author` is a belongsTo — it resolves to author_id.
        { on: ["author"], reason: "an author's posts, and the ON DELETE cascade" }
    ]
};
```

### Rules an agent must not get wrong

- **`on` takes property keys, never column names.** A `belongsTo` resolves to
  its `localKey`, so `author` → `author_id`. Writing `author_id` yourself works
  for most properties and is refused for a relation — and getting this backwards
  is how you index nothing on the one case people reach for. A `hasMany` or
  many-to-many property is refused: the foreign key is on the *other* table, so
  declare the index there.
- **`reason` is required**, and it is prose, not SQL. Say what query it serves.
  It is what gets printed beside "0 scans in 34 days, 412 MB" later, and it is
  deliberately not part of the index's identity, so rewording it rebuilds
  nothing.
- **Order is the index's identity.** Postgres uses a *leading subset* only:
  `["ownerId", "createdAt"]` serves a filter on `ownerId`, and on both, and
  **never** on `createdAt` alone. Do not reorder keys to "tidy" a declaration.
- **Do not declare a `desc` twin.** A btree is scanned backwards just as fast,
  so a lone `DESC` index is redundant with its `ASC` one. `direction` earns its
  place only when an `ORDER BY` mixes directions.
- **Never suggest a plain index for text search or embeddings.** Trigram search
  is the `search` block; ANN is a `vector` property's `index`. Both build their
  own index, and an index needing `gin_trgm_ops` or `vector_cosine_ops` is
  refused here at build time.
- **Do not add `unique: true` to a single column** whose property already has
  `validation.unique` — that is the same guarantee declared twice, and it is
  refused. Single-column uniqueness is `validation.unique`; `unique` here is for
  composites.
- **Do not index the primary key.** `<table>_pkey` already covers exactly those
  columns, and declaring it is refused.
- **Changing a declaration is a DROP and a CREATE**, no `CONCURRENTLY`, with a
  window in between where the index does not exist. Fine on a dev database; on a
  large live table, say so before suggesting the edit.

### The shape

| Field | Type | Notes |
|-------|------|-------|
| `on` | `(string \| IndexKey)[]` | **Required.** 1–5 keys. `IndexKey` is `{ prop, direction?, nulls? }`. |
| `reason` | `string` | **Required.** One line of prose. |
| `using` | `"btree" \| "gin" \| "brin"` | Default `btree`. No `gist`, no `hash`. |
| `where` | `IndexPredicate` | Partial index. See below. |
| `unique` | `boolean` | btree only, composites only. |
| `include` | `string[]` | btree only. Payload columns for index-only scans; may not overlap `on`. |

`where` is **structured, never a SQL string**: `{ prop, op, value }` with `op`
one of `=`, `!=`, `<`, `<=`, `>`, `>=`, `in`, `is null`, `is not null`, nested
under `{ and: [...] }`. There is no `or` — an OR predicate means the index
should probably not be partial; declare two indexes instead.

`gin` is containment over an `array` or JSONB `map`. `brin` is a
naturally-ordered column on an append-only table. Neither takes `direction` or
`nulls`.

### Why hand-written indexes were disappearing

Worth knowing when a user says an index they created is gone. `rebase db push`
is declarative, so an index on a managed table absent from `schema.sql` was
drift, and Atlas planned `DROP INDEX` — which is not a destructive pattern, so
the auto-approved apply took it silently.

Ownership is now decided by the name: `<table>_<columns>_ix_<7 hex>` (`_ux_` if
unique), which no other namer produces. A declaration you delete drops as
intended; an index Rebase did not create is excluded from the diff and never
touched. **Do not tell a user to re-create a hand-written index defensively, and
do not rename one to look generated** — the hash is over the index's semantics
and the name is frozen in `contracts/derived-names.txt`.

Declared indexes are created by `rebase db push` *and* by boot-time schema
ensure (`CREATE INDEX CONCURRENTLY IF NOT EXISTS`), so a deployment that never
runs `db push` still gets them.

## Data sources & multiple backends

A collection lives in a **data source** identified by `collection.dataSource`
(default `"(default)"`). A data source has an **engine** (`postgres`,
`mongodb`, `firestore`, custom → drives editor capabilities) and a **transport**:

- **`server`** — through the Rebase backend/client. Covers Postgres, MongoDB,
  and any server-mediated engine. This is the default; such collections need no
  registration.
- **`direct`** — straight from the client to an external backend via its SDK
  (e.g. Firestore). The Rebase backend is not in the data path.
- **`custom`** — a developer-supplied `DataDriver`.

Register the non-default (direct/custom) sources once; server engines ride the
client and only need a backend bootstrapper.

```tsx no-verify
// Frontend — register direct/custom sources (Postgres rides the client)
<Rebase
  client={rebaseClient}
  dataSources={[
    { key: "analytics", engine: "firestore", transport: "direct", driver: firestoreDriver }
  ]}
/>

// A collection opts in by key:
{ slug: "events", dataSource: "analytics", properties: { /* … */ } }
```

```ts no-verify
// Backend — multiple engines in one instance (Postgres + MongoDB)
// config/resources.ts — declare direct/custom sources so the backend skips
// server routes for them:
//   export const analytics = database("analytics", {
//       engine: "firestore", transport: "direct"
//   });
initializeRebaseBackend({
  bootstrappers: [pgBootstrapper /* isDefault */, mongoBootstrapper],
  collections: [
    { slug: "products" },                  // → Postgres (default)
    { slug: "orders", driver: "mongodb" }  // → MongoDB
  ],
});
```

Routing is automatic and resolved by collection path: list/entity views,
references, board, import/export, and `context.data` all hit the right backend
with no per-collection wiring. The data-source key matches the backend
bootstrapper id/type (e.g. `"mongodb"`). RLS is applied per-engine where
supported. The deprecated `drivers={{ key: driver }}` prop is a shorthand for a
single `direct` database declaration.

> **Migration note:** collection-level `driver` is deprecated in favor of
> `dataSource`. It still works (and provides the engine hint), so existing
> Firestore collections using `driver: "firestore"` keep functioning.

## Common Property Options (BaseProperty)

All property types share these base options:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | — | Display label for the field |
| `description` | `string` | — | Help text displayed under the field |
| `columnName` | `string` | auto from key | Explicit DB column name (bypasses snake_case conversion) |
| `validation` | `PropertyValidationSchema` | — | Validation rules (see below) |
| `defaultValue` | `unknown` | — | Default value for new entities |
| `propertyConfig` | `string` | — | Reuse a globally defined property config by key |
| `dynamicProps` | `(props) => Partial<Property>` | — | Dynamic property overrides based on entity values |
| `conditions` | `PropertyConditions` | — | JSON Logic-based declarative conditions |
| `callbacks` | `PropertyCallbacks` | — | Per-field `afterRead` and `beforeSave` hooks |

### UI Options (AdminPropertyOptions)

All property types support a `admin` object for display configuration:

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `admin.columnWidth` | `number` | — | Column width in pixels (table view) |
| `admin.hideFromCollection` | `boolean` | — | Hide from collection table view |
| `admin.readOnly` | `boolean` | — | Render as read-only preview |
| `admin.disabled` | `boolean \| PropertyDisabledConfig` | — | Disable editing |
| `admin.span` | `1 \| 2 \| 3 \| 4` | — | Field width over the four-column form grid |
| `admin.customProps` | `unknown` | — | Custom props passed to the field component |
| `admin.Field` | `ComponentRef` | — | Custom field component |
| `admin.Preview` | `ComponentRef` | — | Custom preview/cell component |

### Form layout

The entity form derives a two-column layout from the property types on its own:
the id and the audit timestamps go to a metadata rail, short enums, booleans,
dates and numbers take a narrow span, long text, markdown, arrays, maps and
storage fields take the full width, everything else takes half. A collection
that says nothing about layout still gets a form rather than one long run of
full-width inputs.

Reach for `admin.form` when that answer is wrong for the domain:

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const postsCollection = defineCollection({
    slug: "posts",
    table: "posts",
    name: "Posts",
    properties: {
        title: { name: "Title", type: "string" },
        body: { name: "Body", type: "string", admin: { markdown: true } },
        status: { name: "Status", type: "string" },
        publishedAt: { name: "Published at", type: "date" },
        notes: { name: "Notes", type: "string" }
    },
    admin: {
        form: {
            // Fields beside the main column rather than in it.
            sidebar: ["status", "publishedAt"],
            sections: [
                { key: "content", properties: ["title", "body"] },
                {
                    key: "internal",
                    title: "Internal",
                    properties: ["notes"],
                    collapsed: true
                }
            ],
            // id / created / updated at the foot of the rail. Default `true`.
            showRecordMeta: true
        }
    }
});
```

A property no section names is never dropped — it lands in a trailing group, so
adding a column to the database cannot make a field silently invisible. A
validation error inside a collapsed section expands it. On layouts too narrow
for a rail (side panel, split pane, phone) the rail renders as a leading
section and spans are ignored.

## String Properties

```typescript
title: {
    name: "Title",
    type: "string",
    validation: { required: true, min: 3, max: 200 },
    multiline: false
}
```

### String-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columnType` | `"varchar" \| "text" \| "char" \| "uuid"` | `"varchar"` | Database column type |
| `isId` | `boolean \| "manual" \| "uuid" \| "cuid" \| string` | — | Mark as primary key with generation strategy |
| `enum` | `EnumValues` | — | Dropdown/picklist values |
| `admin.multiline` | `boolean` | `false` | Multi-line text area |
| `admin.markdown` | `boolean` | `false` | Markdown editor with preview. Uses the `RichTextEditor` component (`import { RichTextEditor } from "@rebasepro/cms/editor"`) — a full WYSIWYG editor supporting Markdown, JSON, and HTML output. |
| `url` | `boolean \| PreviewType` | — | Render as link. `PreviewType`: `"image"`, `"video"`, `"audio"`, `"file"` |
| `email` | `boolean` | — | Email field rendering |
| `storage` | `StorageConfig` | — | File upload configuration (see Storage section) |
| `userSelect` | `boolean` | — | Render as user picker (value = user ID) |
| `admin.previewAsTag` | `boolean` | — | Render value as a colored tag/chip |
| `reference` | `ReferenceProperty` | — | Lightweight reference to another collection by ID |

### String isId Strategies

| Value | Behavior |
|-------|----------|
| `true` / `"manual"` | User-defined ID, must be entered manually |
| `"uuid"` | Auto-generated UUID via `gen_random_uuid()` |
| `"cuid"` | Auto-generated CUID |
| Any other string | Raw SQL default expression, e.g. `"nanoid()"` |

### String Validation

```typescript
validation: {
    required: true,
    min: 3,            // Minimum string length
    max: 200,          // Maximum string length
    matches: /^[a-z]+$/,  // Regex pattern (string or RegExp)
    matchesMessage: "Only lowercase letters allowed",
    unique: true,
    uniqueInArray: true,
    requiredMessage: "Title is required",
    trim: true,        // Trim whitespace before validation
    lowercase: true,   // Transform to lowercase before validation
    uppercase: false,   // Transform to uppercase before validation
}
```

### Storage Configuration (File Uploads)

When a string property has `storage`, it becomes a file upload field. The stored value is the file path (or URL) in your storage provider.

```typescript
avatar: {
    name: "Avatar",
    type: "string",
    storage: {
        storagePath: "avatars/{entityId}",
        acceptedFiles: ["image/*"],
        maxSize: 5 * 1024 * 1024, // 5MB
        fileName: "{rand}_{file.name}.{file.ext}",
        metadata: { cacheControl: "max-age=31536000" },
        imageResize: {
            maxWidth: 400,
            maxHeight: 400,
            mode: "cover",
            format: "webp",
            quality: 80
        },
        previewUrl: (path) => `https://cdn.example.com/${path}`,
        processFile: async (file) => { /* transform before upload */ return file; },
        postProcess: async (pathOrUrl) => { /* transform saved value */ return pathOrUrl; }
    }
}
```

| StorageConfig Option | Type | Default | Description |
|---------------------|------|---------|-------------|
| `storagePath` | `string \| (ctx) => string` | **required** | Upload destination path. Placeholders: `{file}`, `{file.name}`, `{file.ext}`, `{rand}`, `{entityId}`, `{propertyKey}`, `{path}` |
| `acceptedFiles` | `FileType[]` | all | Allowed MIME types. E.g. `["image/*"]`, `["application/pdf"]` |
| `maxSize` | `number` | — | Max file size in bytes |
| `fileName` | `string \| (ctx) => string` | — | Custom filename. Same placeholders as `storagePath` |
| `metadata` | `Record<string, unknown>` | — | Upload metadata (e.g. Firebase `UploadMetadata`) |
| `imageResize` | `ImageResize` | — | Resize images before upload |
| `previewUrl` | `(fileName) => string` | — | Custom preview URL builder |
| `processFile` | `(file: File) => Promise<File>` | — | Transform file before upload |
| `postProcess` | `(pathOrUrl) => Promise<string>` | — | Transform saved path/URL after upload |
| `includeBucketUrl` | `boolean` | `false` | Include bucket URL in saved path |
| `storeUrl` | `boolean` | `false` | Save download URL instead of storage path |
| `storageSource` | `string` | `undefined` (default backend) | Named storage source key — routes uploads to a specific backend registered in the backend `storage` map or in `storageSources` on `<Rebase>`. Must match a `StorageSourceDefinition.key`. |

#### Per-Property Backend Binding

When using multiple storage backends, use `storageSource` to route a specific property's uploads to a named backend:

```typescript
// Route this property's uploads to Firebase Storage
image: {
    type: "string",
    storage: {
        storageSource: "firebase",
        storagePath: "products/{entityId}",
        acceptedFiles: ["image/*"],
    }
}
```

### ImageResize Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxWidth` | `number` | — | Max width in pixels |
| `maxHeight` | `number` | — | Max height in pixels |
| `mode` | `"contain" \| "cover"` | `"contain"` | Resize fitting mode |
| `format` | `"original" \| "jpeg" \| "png" \| "webp"` | `"original"` | Output format |
| `quality` | `number` (0-100) | `80` | Quality for JPEG/WebP |

## Number Properties

```typescript
price: {
    name: "Price",
    type: "number",
    validation: { required: true, min: 0, positive: true }
}
```

### Number-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columnType` | `"integer" \| "real" \| "double precision" \| "numeric" \| "bigint" \| "serial" \| "bigserial"` | auto | Database column type |
| `isId` | `boolean \| "manual" \| "increment" \| string` | — | Mark as primary key |
| `enum` | `EnumValues` | — | Dropdown values |

### Number isId Strategies

| Value | Behavior |
|-------|----------|
| `true` / `"manual"` | User-defined numeric ID |
| `"increment"` | Auto-incrementing integer (`GENERATED BY DEFAULT AS IDENTITY`) |
| Any other string | Raw SQL default expression |

### Number Validation

```typescript
validation: {
    required: true,
    min: 0,
    max: 1000,
    lessThan: 1001,
    moreThan: -1,
    positive: true,
    negative: false,
    integer: true,
    unique: true
}
```

## Boolean Properties

```typescript
published: {
    name: "Published",
    type: "boolean",
    defaultValue: false,
    validation: { required: true }
}
```

No additional options beyond `BaseProperty`.

## Date Properties

```typescript
createdAt: {
    name: "Created At",
    type: "date",
    mode: "date_time",
    autoValue: "on_create",
    clearable: false,
    admin: { readOnly: true }
}

updatedAt: {
    name: "Updated At",
    type: "date",
    mode: "date_time",
    autoValue: "on_update",
    admin: { readOnly: true }
}
```

### Date-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columnType` | `"timestamp" \| "date" \| "time"` | `"timestamp"` | Database column type (with timezone) |
| `mode` | `"date" \| "date_time"` | `"date_time"` | Date-only or date + time picker |
| `autoValue` | `"on_create" \| "on_update"` | — | Auto-set timestamp on create or every update |
| `timezone` | `string` | — | Timezone string for display |
| `admin.clearable` | `boolean` | `false` | Show clear button to set value to `null` |

### Date Validation

```typescript
validation: {
    required: true,
    min: new Date("2020-01-01"),
    max: new Date("2030-12-31")
}
```

## Map Properties (Nested Objects)

Maps store nested objects as `JSONB` in PostgreSQL. They can define their own inner properties schema.

```typescript no-verify
address: {
    name: "Address",
    type: "map",
    properties: {
        street: { name: "Street", type: "string" },
        city: { name: "City", type: "string", validation: { required: true } },
        zip: { name: "ZIP Code", type: "string" },
        country: { name: "Country", type: "string", enum: [
            { id: "US", label: "United States" },
            { id: "UK", label: "United Kingdom" }
        ]}
    },
    propertiesOrder: ["street", "city", "zip", "country"],
    admin: { expanded: true, spreadChildren: true }
}
```

### Map-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columnType` | `"json" \| "jsonb"` | `"jsonb"` | Database column type |
| `properties` | `Properties` | — | Nested property schema (same types as collection properties) |
| `propertiesOrder` | `string[]` | — | Display order of nested fields. Stays on the property, not in `admin` — `sortProperties` in `@rebasepro/common` reads it |
| `admin.previewProperties` | `string[]` | — | Properties shown in preview/collapsed state |
| `keyValue` | `boolean` | — | Render as key-value table with arbitrary keys (no `properties` needed) |

### Map UI Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `admin.expanded` | `boolean` | — | Expand map fields by default in forms |
| `admin.minimalistView` | `boolean` | — | Compact rendering |
| `admin.spreadChildren` | `boolean` | — | Spread child fields as if they were top-level form fields |

> **IMPORTANT FOR AGENTS:** If `validation.required` is not set on the map property itself, an empty object `{}` is considered valid even if inner properties have `required: true`. Always set `validation: { required: true }` on the map if the entire object is mandatory.

## Array Properties

Arrays can contain any element type (except nested arrays). They map to native Postgres arrays for primitives or `JSONB` for complex types.

```typescript
tags: {
    name: "Tags",
    type: "array",
    of: { type: "string" },
    validation: { min: 1, max: 10 }
}

gallery: {
    name: "Gallery",
    type: "array",
    of: {
        type: "string",
        storage: {
            storagePath: "products/{entityId}/gallery",
            acceptedFiles: ["image/*"]
        }
    }
}

metadata: {
    name: "Metadata",
    type: "array",
    of: {
        type: "map",
        properties: {
            key: { name: "Key", type: "string", validation: { required: true } },
            value: { name: "Value", type: "string" }
        }
    },
    admin: { expanded: true }
}
```

### Array-Specific Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `columnType` | `"json" \| "jsonb" \| "text[]" \| "integer[]" \| "boolean[]" \| "numeric[]"` | auto | Database column type. Primitives default to native arrays |
| `of` | `Property \| Property[]` | — | Element type definition. Use a single `Property` for homogeneous arrays |
| `oneOf` | `{ properties, propertiesOrder?, typeField?, valueField? }` | — | Discriminated union for heterogeneous arrays (e.g. blog blocks) |
| `admin.sortable` | `boolean` | `true` | Allow drag-and-drop reordering |
| `admin.canAddElements` | `boolean` | `true` | Allow adding new elements |

### Array UI Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `admin.expanded` | `boolean` | — | Expand array items by default |
| `admin.minimalistView` | `boolean` | — | Compact rendering |
| `admin.Field` | `ComponentRef` | — | Custom field component for the entire array |

### Array Validation

```typescript
validation: {
    required: true,
    min: 1,    // Minimum number of elements
    max: 20    // Maximum number of elements
}
```

### oneOf (Discriminated Union Arrays)

Use `oneOf` for content blocks with different types (e.g. blog content):

```typescript
content: {
    name: "Content Blocks",
    type: "array",
    oneOf: {
        typeField: "type",   // default: "type"
        valueField: "value", // default: "value"
        properties: {
            text: {
                name: "Text Block",
                type: "string",
                admin: { markdown: true }
            },
            image: {
                name: "Image",
                type: "string",
                storage: { storagePath: "blog/{entityId}/content" }
            },
            quote: {
                name: "Quote",
                type: "map",
                properties: {
                    text: { name: "Quote Text", type: "string" },
                    author: { name: "Author", type: "string" }
                }
            }
        }
    }
}
// Stored as: [{ type: "text", value: "# Hello" }, { type: "image", value: "path/to/img.jpg" }]
```

## Property Validation

Every property supports a `validation` object with these common options:

| Option | Type | Applies To | Description |
|--------|------|-----------|-------------|
| `required` | `boolean` | All | Field is mandatory |
| `requiredMessage` | `string` | All | Custom error message when required validation fails |
| `unique` | `boolean` | All | Value must be unique across all entities |
| `uniqueInArray` | `boolean` | All | Value must be unique within parent array |
| `min` | `number \| Date` | String (length), Number, Date, Array (count) | Minimum value/length/count/date |
| `max` | `number \| Date` | String (length), Number, Date, Array (count) | Maximum value/length/count/date |
| `matches` | `string \| RegExp` | String | Regex pattern |
| `matchesMessage` | `string` | String | Error message for regex mismatch |
| `trim` | `boolean` | String | Trim whitespace before validation |
| `lowercase` | `boolean` | String | Transform to lowercase |
| `uppercase` | `boolean` | String | Transform to uppercase |
| `length` | `number` | String | Exact string length |
| `lessThan` | `number` | Number | Value must be less than |
| `moreThan` | `number` | Number | Value must be greater than |
| `positive` | `boolean` | Number | Value must be positive |
| `negative` | `boolean` | Number | Value must be negative |
| `integer` | `boolean` | Number | Value must be an integer |

## Enum Values

Use the `enum` property on `string` or `number` types to define picklist options:

```typescript no-verify
status: {
    name: "Status",
    type: "string",
    defaultValue: "draft",
    enum: [
        { id: "draft", label: "Draft", color: "gray" },
        { id: "published", label: "Published", color: "green" },
        { id: "archived", label: "Archived", color: "red", disabled: true }
    ]
}
```

Each `EnumValueConfig` entry supports:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string \| number` | Stored value |
| `label` | `string` | Display text |
| `color` | `ColorKey \| ColorScheme` | Optional chip color |
| `disabled` | `boolean` | Option is visible but not selectable |

`EnumValues` can also be a `Record<string, string | EnumValueConfig>` for simpler definitions:

```typescript no-verify
enum: {
    draft: "Draft",
    published: { label: "Published", color: "green" }
}
```

### PostgreSQL Enum Database Constraints

When `rebase schema generate` is run, any `string` property configured with an `enum` array generates a corresponding PostgreSQL `ENUM` type (e.g. `CREATE TYPE "public"."collection_property" AS ENUM('val1', 'val2')`).

If you write custom server functions, backend callback handlers, or perform manual database updates:
1. **Validation Constraints**: Pushing or inserting a value that is NOT defined in the collection's enum options array will trigger a PostgreSQL database-level check constraint error (e.g., `invalid input value for enum`).
2. **Adding Enum Options**: Adding a new enum value in code requires generating and applying a database migration (e.g., `pnpm db:generate` followed by `pnpm db:migrate` or raw enum modification SQL). In development, using a raw SQL command to alter the enum may be necessary because modifying PostgreSQL enums dynamically can be restrictive.


## Relations (Inline Property API)

Relations are defined **directly on the property** using `type: "relation"`. The framework automatically extracts these into the collection's internal `relations[]` at normalization time — you do **not** need a separate `relations[]` array.

### Many-to-One (Owning)

```typescript
import { PostgresCollectionConfig } from "@rebasepro/types";
import authorsCollection from "./authors";

const postsCollection: PostgresCollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        author: {
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo", target: () => authorsCollection }
        }
    }
};
```

This automatically creates an `author_id` foreign key column on the `posts` table,
served on the wire as `authorId`.

### Many-to-Many

```typescript
tags: {
    name: "Tags",
    type: "relation",
    relation: { kind: "manyToMany", target: () => tagsCollection }
}
```

This automatically creates a `posts_tags` junction table with `post_id` and `tag_id` columns.

### One-to-Many

```typescript
comments: {
    name: "Comments",
    type: "relation",
    relation: {
        kind: "hasMany",
        target: () => commentsCollection,
        foreignKeyOnTarget: "post_id"
    }
}
```

### Relation Property Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
The link goes under `relation`, and its `kind` decides which fields apply.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `kind` | `"belongsTo" \| "hasOne" \| "hasMany" \| "manyToMany" \| "via"` | — | **Required.** Which kind of link |
| `target` | `() => CollectionConfig` | — | Target collection (a thunk, to survive circular imports) |
| `localKey` | `string` | `<relationName>_id` | `belongsTo` only — column on THIS table |
| `foreignKeyOnTarget` | `string` | `<thisCollection>_id` | `hasOne`/`hasMany` only — column on the TARGET's table |
| `through` | `{ table?, sourceColumn?, targetColumn? }` | derived | `manyToMany` only; `sourceColumn` names THIS collection |
| `joinPath` | `JoinStep[]` | — | `via` only; read-only |
| `cardinality` | `"one" \| "many"` | — | `via` only — a join chain cannot imply it |
| `relationName` | `string` | property key | The name it is addressed by: `include`, admin tab, nested path segment |
| `onDelete` | `OnAction` | — | Cascade rule on delete |
| `onUpdate` | `OnAction` | — | Cascade rule on update |
| `overrides` | `Partial<CollectionConfig>` | — | Override target collection config when rendered as subcollection tab |
| `admin.fixedFilter` | `FilterValues` | — | Filter applied when selecting related entities |
| `admin.includeId` | `boolean` | `true` | Show entity ID in the reference preview |
| `admin.includeEntityLink` | `boolean` | `true` | Show link to open the related entity |
| `isId` | `boolean` | — | Mark as primary key |
| `validation` | `{ required?: boolean }` | — | Relation-level validation |

### Relation UI Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `admin.widget` | `"select" \| "dialog"` | `"select"` | UI widget for selecting relations |
| `admin.previewProperties` | `string[]` | — | Properties shown in relation preview (max 3) |

### Cascade Rules (OnAction)

| Action | Behavior |
|--------|----------|
| `"cascade"` | Propagate change to related rows |
| `"restrict"` | Prevent if related rows exist |
| `"set null"` | Set FK to NULL |
| `"no action"` | Defer to constraint check |
| `"set default"` | Set FK to default value |

### Multi-Hop Joins (joinPath)

Use `joinPath` for advanced relationships that traverse multiple tables. When set, it overrides `localKey`, `foreignKeyOnTarget`, and `through`.

Each `JoinStep` defines one JOIN operation:

```typescript
interface JoinStep {
    table: string;          // Table to join TO
    on: {
        from: string | string[];  // Column(s) on the PREVIOUS table
        to: string | string[];    // Column(s) on THIS table
    };
}
```

**Example: Users → Permissions through Roles (4-table join)**

```typescript
permissions: {
    name: "Permissions",
    type: "relation",
    relation: {
        kind: "via",
        target: () => permissionsCollection,
        cardinality: "many",
        joinPath: [
            {
                table: "user_roles",
                on: { from: "id", to: "user_id" }          // users.id = user_roles.user_id
            },
            {
                table: "roles",
                on: { from: "role_id", to: "id" }          // user_roles.role_id = roles.id
            },
            {
                table: "role_permissions",
                on: { from: "id", to: "role_id" }          // roles.id = role_permissions.role_id
            },
            {
                table: "permissions",
                on: { from: "permission_id", to: "id" }    // role_permissions.permission_id = permissions.id
            }
        ]
    }
}
```

**Example: Composite key join**

```typescript
customer: {
    name: "Customer",
    type: "relation",
    relation: {
        kind: "via",
        target: () => customersCollection,
        cardinality: "one",
        joinPath: [
            {
                table: "customers",
                on: {
                    from: ["company_code", "region_id"],  // orders table columns
                    to: ["code", "region_id"]             // customers table columns
                }
            }
        ]
    }
}
```

A `via` relation is read-only: a join chain does not say which row to write.

> **See full documentation:** [Relations](https://rebase.pro/docs/collections/relations)

## Collection Callbacks (Lifecycle Hooks)

> **IMPORTANT FOR AGENTS**: Collections support **lifecycle callbacks** that let you run custom logic when entities are created, updated, read, or deleted. Use these to **sync data between collections**, transform data, validate business rules, or trigger side effects. **Do NOT use raw SQL triggers, cron jobs, or external scripts** when a callback can solve the problem.

### Generic Type Parameters

`CollectionCallbacks<M, USER>` accepts two generic type parameters:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `M` | `Record<string, unknown>` | Entity values type — maps to your collection's property schema |
| `USER` | `User` | User type — extends the base `User` type with custom fields |

```typescript
import { PostgresCollectionConfig, CollectionCallbacks } from "@rebasepro/types";

// A `type`, not an `interface`: only a type alias gets the implicit index
// signature that satisfies `Record<string, unknown>`.
type Product = {
    name: string;
    price: number;
    slug: string;
    status: string;
};

const callbacks: CollectionCallbacks<Product> = {
    beforeSave: async ({ values, status }) => {
        // `values` is typed as Partial<Product>
        if (values.name) {
            values.slug = values.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
        }
        return values;
    }
};
```

### RebaseCallContext\<USER\>

All callbacks receive a `context` property of type `RebaseCallContext<USER>`. This is the subset of the full `RebaseContext` that is available in both frontend and backend (server-side) execution:

| Property | Type | Description |
|----------|------|-------------|
| `context.client` | `RebaseClient` | Invoke backend functions, access APIs |
| `context.data` | `RebaseData` | Unified data access — `context.data.products.create(...)` |
| `context.storageSource` | `StorageSource` | File storage operations |
| `context.user` | `USER \| undefined` | Authenticated user (set by backend in server-side callbacks) |

### Reserved `context.user` Values

The `context.user` object is populated by the auth middleware. In server-side callbacks, it contains one of these reserved identities:

| Caller | `context.user.uid` | `context.user.roles` |
|---|---|---|
| JWT-authenticated end-user | Real user ID (e.g. `"abc123"`) | Their assigned roles (e.g. `["viewer"]`) |
| Server-side `rebase.dataAsAdmin` (cron jobs, custom functions) | `"service"` | `["admin"]` |
| API key (default) | `"api-key:{id}"` | `["service"]` |
| API key (admin) | `"api-key:{id}"` | `["admin", "service"]` |
| Anonymous (no auth, `requireAuth: false`) | `"anon"` | `["anon"]` |
| Anonymous REST (no token) | `undefined` | N/A — `context.user` is not set; only the DataDriver is scoped |

> **IMPORTANT FOR AGENTS:** `rebase.dataAsAdmin` calls (used in cron jobs, afterSave side-effects, custom functions) run through the native driver scoped as the service identity, so callbacks see `uid: "service"`, `roles: ["admin"]`. Use this to gate behavior — e.g., skip PII masking for admin/service reads:
>
> ```typescript
> afterRead: async ({ row, context }) => {
>     // Server-side reads (cron jobs, admin) see real values
>     if (context.user?.roles?.includes("admin")) return row;
>     // End-user reads get masked values
>     return { ...row, email: "***@***.***" };
> }
> ```

> **WARNING FOR AGENTS:** Do NOT confuse `RebaseCallContext` (available in callbacks, both client & server) with `RebaseContext` (full context available only on the frontend, includes `authController`, `snackbarController`, `sidePanelController`, etc.). Entity callbacks always receive `RebaseCallContext`.

### Callback Example

```typescript
const jobSubmissionsCollection: PostgresCollectionConfig<{
    title: string;
    slug: string;
    status: string;
    description: string;
    company_id: string;
    createdAt: string;
}> = {
    name: "Job Submissions",
    slug: "job_submissions",
    table: "job_submissions",
    callbacks: {
        // Runs BEFORE saving — transform or validate data
        beforeSave: async ({ values, status }) => {
            if (values.title) {
                values.slug = values.title.toLowerCase().replace(/[^a-z0-9]+/g, "-");
            }
            if (status === "new") {
                values.createdAt = new Date().toISOString();
            }
            return values;
        },

        // Runs AFTER saving — trigger side effects, sync other collections
        afterSave: async ({ values, id, previousValues, context }) => {
            if (values.status === "approved" && previousValues?.status !== "approved") {
                await context.data.collection<Record<string, unknown>>("jobs").create({
                    title: values.title,
                    description: values.description,
                    company_id: values.company_id,
                    status: "published",
                    source_submission_id: id,
                });
            }
        },

        // Runs BEFORE deleting — block or validate
        beforeDelete: async ({ row }) => {
            if (row.status === "published") {
                throw new Error("Cannot delete published submissions");
            }
        },

        // Runs AFTER deleting — cleanup related data
        afterDelete: async ({ id, context }) => {
            console.log(`Submission ${id} deleted`);
        },

        // Runs AFTER reading — transform for display
        afterRead: async ({ row }) => {
            return {
                ...row,
                displayName: `${row.title} (${row.company_name})`
            };
        }
    },
    properties: { /* ... */ }
};
```

### Available Callbacks

| Callback | When It Runs | Return Value | Can Block? |
|----------|-------------|--------------|------------|
| `beforeSave` | Before write to DB (after validation) | Modified `values` (`Partial<EntityValues<M>>`) | Yes (throw to block) |
| `afterSave` | After successful write | `void` | No |
| `afterSaveError` | After a failed write | `void` | No |
| `afterRead` | After reading from DB | Modified row (`Record<string, unknown>`) | No |
| `beforeDelete` | Before deletion | `void \| boolean` | Yes (throw to block) |
| `afterDelete` | After successful deletion | `void` | No |

### `callbacks` runs on the server. `admin.browserCallbacks` runs in the panel.

Same six hooks, same props, different runtime — and `callbacks` is almost always
the one you want. It runs on every path that reaches the server (REST, the SDK,
realtime, `dataAsAdmin`), and its bodies are stripped out of the admin bundle,
so a secret read inside one never leaves the machine.

`admin.browserCallbacks` is for a collection on a `direct`/`custom` transport,
which the panel reads and writes itself with no server in the path — nothing
server-side sees those operations, so `callbacks` can never fire for them. It
ships to every visitor in full: no secrets in it, and redaction written there is
presentation, not security. On a normal server-backed collection it runs *in
addition* to the server's, so anything written there must be idempotent.

```typescript
admin: {
    browserCallbacks: {
        afterRead: ({ row }) => ({ ...row, label: [row.city, row.code].join(" · ") })
    }
}
```

### Callback Props Reference

**`beforeSave` / `afterSave` / `afterSaveError` Props:**

| Prop | Type | Description |
|------|------|-------------|
| `values` | `Partial<EntityValues<M>>` | Entity values being saved |
| `id` | `string \| number` (optional in `beforeSave`) | Entity ID (`undefined` for new entities in `beforeSave`) |
| `previousValues` | `Partial<EntityValues<M>> \| undefined` | Previous values (for updates) |
| `status` | `EntityStatus` | `"new"`, `"existing"`, or `"copy"` |
| `collection` | `CollectionConfig<M>` | The collection definition |
| `path` | `string` | Collection path |
| `context` | `RebaseCallContext<USER>` | Context with `client`, `data`, `storageSource`, `user` |

**`afterRead` Props:**

| Prop | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | The fetched row (flat — `{ id, ...columns }`) |
| `collection` | `CollectionConfig<M>` | The collection definition |
| `path` | `string` | Collection path |
| `context` | `RebaseCallContext<USER>` | Context |

**`beforeDelete` / `afterDelete` Props:**

| Prop | Type | Description |
|------|------|-------------|
| `row` | `Record<string, unknown>` | The row being deleted (flat — `{ id, ...columns }`) |
| `id` | `string \| number` | Entity ID |
| `collection` | `CollectionConfig<M>` | The collection definition |
| `path` | `string` | Collection path |
| `context` | `RebaseCallContext<USER>` | Context |

### Property-Level Callbacks

Individual properties also support `callbacks` with `afterRead` and `beforeSave`:

```typescript
title: {
    name: "Title",
    type: "string",
    callbacks: {
        beforeSave: async ({ value, values }) => {
            // Transform just this property's value before saving
            return value?.trim().replace(/\s+/g, " ");
        },
        afterRead: async ({ value }) => {
            // Transform just this property's value after reading
            return value?.toUpperCase();
        }
    }
}
```

### Common Use Cases

- **Syncing data between collections** — Use `afterSave` to copy/move entities from one collection to another (e.g., approved submissions → published jobs)
- **Computed fields** — Use `beforeSave` to generate slugs, timestamps, or derived values
- **Validation** — Use `beforeSave` to enforce business rules beyond schema validation
- **Notifications** — Use `afterSave` to send emails, Slack messages, or webhook calls
- **Cascade operations** — Use `afterDelete` to clean up related records in other collections
- **Data enrichment** — Use `afterRead` to add computed/virtual fields for display

> **See full documentation:** [Collection Callbacks](https://rebase.pro/docs/collections/callbacks)

## Entity Actions (Custom UI Buttons)

> **IMPORTANT FOR AGENTS**: Collections support **custom action buttons** that appear in the collection table view and entity form. Use these for workflow actions like "Approve", "Send Email", "Export PDF", "Clone to Staging", etc. Do NOT build separate pages or scripts for common admin actions.

Add an `entityActions` array to any collection definition:

```tsx
const jobSubmissionsCollection: PostgresCollectionConfig = {
    name: "Job Submissions",
    slug: "job_submissions",
    table: "job_submissions",
    properties: { /* ... */ },
    admin: {
        entityActions: [
            {
                name: "Approve",
                icon: <CheckCircleIcon />,
                // Only show for pending submissions
                isEnabled: ({ entity }) => entity?.values.status === "pending",
                onClick: async ({ entity, context, onCollectionChange }) => {
                    if (!entity || !context) return;
                    await context.data.collection<Record<string, unknown>>("job_submissions").update(entity.id, {
                        status: "approved"
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
        ]
    }
};

```

### EntityAction Interface

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | — | Button label |
| `key` | `string` | — | Override default actions: `"edit"`, `"delete"`, `"copy"` |
| `admin.icon` | `ReactElement` | — | Optional icon |
| `onClick` | `(props: EntityActionClickProps) => void \| Promise<void>` | — | Action handler |
| `isEnabled` | `(props: EntityActionClickProps) => boolean` | — | Conditionally disable the action |
| `collapsed` | `boolean` | `true` | If `true`, show in overflow menu |
| `includeInForm` | `boolean` | `true` | Show in entity form view |
| `showActionsInListView` | `boolean` | `false` | Show inline on each row in list view |

### EntityActionClickProps

The `onClick` and `isEnabled` handlers receive:

| Prop | Type | Description |
|------|------|-------------|
| `entity` | `Entity<M> \| undefined` | The current entity |
| `context` | `RebaseContext<USER>` | Full context (includes `snackbarController`, `authController`, etc.) |
| `path` | `string \| undefined` | Collection path |
| `collection` | `AdminCollection<M> \| undefined` | Collection definition |
| `formContext` | `FormContext \| undefined` | Form state (when called from a form) |
| `sidePanelController` | `SidePanelController \| undefined` | Side panel control |
| `selectionController` | `SelectionController \| undefined` | Multi-select state (collection view) |
| `view` | `"collection" \| "form"` | Where the action was triggered |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | How the entity form is opened |
| `highlightEntity` | `(entity) => void` | Highlight a entity row |
| `unhighlightEntity` | `(entity) => void` | Remove highlight |
| `navigateBack` | `() => void` | Navigate back (e.g., after deleting) |
| `onCollectionChange` | `() => void` | Refresh the collection view |

## Entity Custom Views (Tabs)

Collections support `entityViews` — custom React components that appear as **tabs** in the entity detail view. Use these for previews, analytics, related items, or any custom UI per entity.

Entity views can be registered:
1. **Globally** in the `<RebaseCMS>` component via the `entityViews` prop
2. **Per-collection** by referencing view keys in the collection's `entityViews` array

```tsx
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
const postsCollection: PostgresCollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: { /* ... */ },
    admin: {
        entityViews: ["blog_preview"]  // References the global view by key
    }
};

```

The `Builder` component receives:
- `entity` — The saved entity (may be `undefined` for new entities)
- `modifiedValues` — Current unsaved form values
- `formContext` — Form state and methods
- `collection` — The collection definition

### TypeScript Strict Checks in Custom Views

Under strict TypeScript checks (`strictNullChecks: true`), since `entity` is typed as optional (`entity?: Entity<M>`), accessing `entity.id` or `entity.values` directly will cause compilation errors like:
`error TS18048: 'entity' is possibly 'undefined'.`

Always add a guard clause at the very beginning of your custom view component to handle the undefined state:
```typescript
function MyCustomView({ entity }: { entity?: { id: string; values: Record<string, unknown> } }) {
    if (!entity) {
        return null; // or show a loading/error state
    }
    // …`entity` is narrowed from here on
}
```
This narrows the type of `entity` for the remainder of the component, allowing safe property access (e.g. `entity.id`, `entity.values.field`).

## Entity Preview & Title Resolution

### Entity display

Six roles — `title`, `subtitle`, `image`, `status`, `date`, `tags` — fill every
surface that draws a record. Each is derived from the properties, and each can be
stated as a property path or as a function:

```typescript
admin: {
    display: {
        title: "name",
        image: "cover",
        subtitle: ({ entity }) => `in ${entity.values.city}`,
        // A resolver may be async: this reads a document the record does not carry.
        status: async ({ entity, context }) =>
            (await context.data.audits.get(`${entity.id}/latest`))?.state
    }
}
```

While an async resolver is in flight the surface shows the derived value and swaps
the resolved one in; results are cached per record and per role. Return
`undefined` when a record has nothing for a role — the surface picks its own
fallback. Prefer a path when the value is on the record: it keeps the property's
own rendering (an enum stays a chip, a date stays formatted).

`admin.titleProperty` was the old name of `display.title`. It has been removed;
`display.title` takes the same string.

### Title Property Selection
When `display.title` is not set, the property used as the entity's display title (previews, headers) is resolved as follows:
1. If `propertiesOrder` is explicitly defined on the collection, the first non-ID property that is either a `relation` or `string` type is chosen as the title key.
2. If no `propertiesOrder` is defined, the framework searches the properties in order and picks the first string type property.

### Relation Previews in Tables
When `propertiesOrder` is explicitly set, relation properties are *not* automatically filtered out of the default preview columns (whereas they are excluded from unordered defaults to avoid slow join operations).

### resolveTitleToString Utility
Rebase provides a `resolveTitleToString(title: any): string` helper to turn complex entity title values (including dates, arrays, or relation shapes like `{ __type: "relation", id, data: { values } }`) into clean, renderable strings. It prioritizes common fields like `name`, `title`, `label`, and `displayName` from nested relation data, falling back to stringified IDs or JSON representations.

## Collection-Scoped Component Overrides

You can override built-in UI components for a specific collection by adding a `components` map to its definition. This is a collection-level implementation of Docusaurus-style swizzling.

Only collection-scoped components can be overridden here. App-level components (such as `Shell.AppBar` or `HomePage`) must be overridden globally at the `<Rebase>` root.

```tsx
import { PostgresCollectionConfig } from "@rebasepro/types";

const productsCollection: PostgresCollectionConfig = {
    name: "Products",
    slug: "products",
    table: "products",
    properties: { ... },
    admin: {
        components: {
            // Eject Mode: Replace the empty state view entirely
            "Collection.EmptyState": { Component: ProductCustomEmptyState },
        
            // Wrap Mode: Wrap the built-in form, augmenting it
            "Entity.Form": {
                // `OriginalComponent` is injected at runtime when `wrap: true`; the
                // override slot's type does not model it, hence the cast.
                Component: (({ OriginalComponent, ...props }: {
                    OriginalComponent: React.ComponentType<Record<string, unknown>>
                }) => (
                    <div>
                        <div className="bg-amber-100 p-2 text-amber-800 text-sm">Editing Product</div>
                        <OriginalComponent {...props} />
                    </div>
                )) as unknown as React.ComponentType<Record<string, unknown>>,
                wrap: true
            }
        }
    }
};

```

### Collection-Scoped Overridable Components

The keys are the `CollectionComponentName` union in
`@rebasepro/cms-types`. They are string keys, not exported components — see the
**rebase-admin** skill.

| Component Key | Description |
|---|---|
| `"Collection.View"` | The entire collection landing page |
| `"Collection.Table"` | The default table view |
| `"Collection.Card"` | The card view item wrapper |
| `"Collection.EmptyState"` | Displayed when a collection has no items |
| `"Collection.Actions"` | Toolbar buttons above the table/cards |
| `"Collection.FilterField"` | The per-property filter input |
| `"Entity.Form"` | The detail form for creating/updating |
| `"EditView.FormActions"` | Form submission/cancel button bar |
| `"DetailView"` | Read-only detail view |
| `"Entity.SidePanel"` | The side panel container for form/detail |
| `"EntityPreview"` | Inline reference/relation chip preview |
| `"Entity.MissingReference"` | Rendered when a referenced entity is deleted or missing |

> **IMPORTANT FOR AGENTS:** three of these do **not** carry the `Entity.` prefix
> the others do — `"DetailView"`, `"EntityPreview"` and `"EditView.FormActions"`.
> Writing `"Entity.DetailView"`, `"Entity.Preview"` or `"Entity.FormActions"`
> type-errors against `CollectionComponentName`, and in plain JavaScript it is a
> key nothing ever reads: the override silently does not apply.

App-scoped keys (set on `<Rebase>` rather than per collection) are
`"Shell.AppBar"`, `"Shell.Drawer"`, `"Shell.DrawerNavigationItem"`,
`"Shell.DrawerNavigationGroup"`, `"HomePage"`, `"HomePage.CollectionCard"` and
`"Auth.LoginView"`.

## Authentication Collection Configuration (auth)

You can mark a collection as an authentication collection by setting the `auth` property to `true` (shorthand for `{ enabled: true }`) or providing an `AuthCollectionConfig` object.

This is the collection used for user credentials, password hashing, and user management. Rebase auto-injects required auth actions (like resetting passwords) and routes them through this config.

```typescript
import { PostgresCollectionConfig } from "@rebasepro/types";

const customUsersCollection: PostgresCollectionConfig = {
    name: "Members",
    slug: "members",
    table: "members",
    auth: {
        enabled: true,
        // Override default user creation flow
        onCreateUser: async (values, ctx) => {
            const hash = await ctx.hashPassword("welcome123");
            return {
                values: { ...values, passwordHash: hash, emailVerified: true },
                temporaryPassword: "welcome123"
            };
        },
        // Override default password reset flow
        onResetPassword: async (userId, ctx) => {
            if (ctx.emailConfigured) {
                const tempPassword = "reset_" + Math.random().toString(36).substring(2, 8);
                const hash = await ctx.hashPassword(tempPassword);
                // Custom email sending or persistence
                return { temporaryPassword: tempPassword, invitationSent: false };
            }
            return { invitationSent: false };
        },
        // Override/disable default user management actions
        actions: {
            resetPassword: true // Or false to disable, or a custom EntityAction to replace the UI
        }
    },
    properties: { ... }
};
```

## Vector Properties

For similarity search and AI embeddings:

```typescript
embedding: {
    name: "Embedding",
    type: "vector",
    dimensions: 1536  // Required — must match your model's output dimensions
}
```

| Option | Type | Description |
|--------|------|-------------|
| `dimensions` | `number` | **Required.** Number of dimensions in the vector |
| `index` | `VectorIndexConfig \| false` | ANN index. Omitted, one HNSW index for cosine distance. `false` creates none. |

**Every vector column gets an ANN index by default** — HNSW, cosine — so
`vectorSearch` is approximate and fast rather than an exact scan. Cosine because
that is what `vectorSearch` measures with unless a `distance` is passed, and
**an index serves exactly one operator**: an `l2` query against a cosine-only
index quietly goes back to scanning. Index several by naming several, at the
cost of a separate build and separate storage each:

```typescript
embedding: {
    name: "Embedding",
    type: "vector",
    dimensions: 1536,
    index: {
        method: "hnsw",              // or "ivfflat"
        distance: ["cosine", "l2"],  // one index each
        m: 24,                       // hnsw
        efConstruction: 128          // hnsw
        // lists: 200                // ivfflat only
    }
}
```

- `ivfflat` partitions by centroid, so an index built on an empty or tiny table
  has useless partitions — build it after the data is loaded, and set `lists`.
  `hnsw` needs no training data and works on an empty table, which is why it is
  the default.
- `index: false` keeps the exact scan deliberately.
- **Above 2000 dimensions pgvector can index neither type**, so the column is
  created unindexed and the boot says so. A 3072-dimension embedding does not
  fail to boot; it scans.
- pgvector itself is a prerequisite. The scaffold's database image ships it; a
  database someone else provisioned needs the extension available and a role
  that can run `CREATE EXTENSION vector;` once.

## Geopoint Properties

```typescript
location: {
    name: "Location",
    type: "geopoint"
}
// Stored as JSONB: { latitude: number, longitude: number }
```

## Security Rules (RLS)

Collections support **Row Level Security** via the `securityRules` array. This generates PostgreSQL RLS policies:

```typescript
const postsCollection: PostgresCollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    securityRules: [
        // Anyone can read published posts
        { operation: "select", using: "{status} = 'published'" },
        // Authors can see/edit their own
        { operations: ["select", "insert", "update"], ownerField: "authorId" },
        // Only admins can delete
        { operation: "delete", roles: ["admin"] }
    ],
    properties: { /* ... */ }
};
```

### Security Rule Types

Rules are a discriminated union — you must use exactly one of: `ownerField`, `access: "public"`, raw `using`/`withCheck`, or roles-only. They cannot be mixed (enforced at the type level).

| Variant | Key Field | Generates |
|---------|-----------|-----------|
| `OwnerSecurityRule` | `ownerField: "user_id"` | `USING (user_id = rebase.uid())` |
| `PublicSecurityRule` | `access: "public"` | `USING (true)` |
| `RawSQLSecurityRule` | `using: "..."` | Custom USING/WITH CHECK clause |
| `RolesOnlySecurityRule` | (none of the above) | Roles-only, no row filter |

### Common Options (SecurityRuleBase)

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | auto-generated | Human-readable policy name (must be unique per table) |
| `operation` | `SecurityOperation` | `"all"` | Single operation: `"select"`, `"insert"`, `"update"`, `"delete"`, `"all"` |
| `operations` | `SecurityOperation[]` | — | Multiple operations (generates one policy per operation) |
| `mode` | `"permissive" \| "restrictive"` | `"permissive"` | Permissive rules are OR'd; restrictive are AND'd |
| `roles` | `string[]` | — | Application-level roles (Rebase roles, NOT Postgres roles). Can be combined with any variant |
| `pgRoles` | `string[]` | `["public"]` | Advanced: native PostgreSQL database roles for the `TO` clause |

### SQL Context Functions

In raw SQL expressions (`using`, `withCheck`), these functions are available:
- `rebase.uid()` — the current user's ID
- `rebase.roles()` — comma-separated app role IDs
- `rebase.jwt()` — full JWT claims as JSONB
- `{column_name}` — resolves to `table.column_name`

> The pre-1.0 spellings `auth.uid()` / `auth.roles()` / `auth.jwt()` are still
> rewritten to the `rebase.*` ones on compile, so old rules keep working — but
> the backend names the collections carrying them at boot. Write `rebase.*`.

> **See full documentation:** [Security Rules](https://rebase.pro/docs/collections/security-rules)

## Dynamic Properties (Conditions)

For declarative, JSON-serializable dynamic behavior, use `conditions` instead of `dynamicProps`:

```typescript
discount_percentage: {
    name: "Discount %",
    type: "number",
    conditions: {
        // Only show when sale_enabled is true
        hidden: { "!": { "var": "values.sale_enabled" } },
        // Required when visible
        required: { "var": "values.sale_enabled" },
        // Min 0, max 100
        min: 0,
        max: 100
    }
}
```

Available condition fields: `disabled`, `disabledMessage`, `clearOnDisabled`, `hidden`, `readOnly`, `required`, `requiredMessage`, `min`, `max`, `defaultValue`, `enumConditions`, `allowedEnumValues`, `excludedEnumValues`, `referencePath`, `referenceFilter`, `canAddElements`, `sortable`, `acceptedFiles`, `maxFileSize`.

`hidden`, `readOnly` and `disabled` also take a plain `true` for the
unconditional case — the field is never shown, never editable — instead of a
rule that is always true:

```typescript
internal_note: {
    name: "Internal note",
    type: "string",
    conditions: { hidden: true }   // keep it in the collection, out of the form
}
```

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
