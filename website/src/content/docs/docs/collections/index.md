---
title: Tables in the CMS
sidebar_label: Tables in the CMS
description: "How the CMS shows every Postgres table with no frontend configuration: labels, the widget each column type gets, required and read-only fields, relations, display slots, and Create, Edit and Delete controls that follow the table's row-level security."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

If you use the CMS, you do not describe your tables to it. When someone signs
in, the panel asks the backend for the tables that person may see, and shows
each one as a **collection**: a page in the navigation with a table view, a
form, filters and the record's related rows. A table is the backend object you
declare in [`backend/schema`](/docs/schema/); a collection is how the panel
shows it.

```tsx
// frontend/src/App.tsx: nothing about posts, users or tags here.
<Rebase client={rebaseClient} authController={authController}>
    <RebaseAuth/>
    <RebaseCMS/>
    <RebaseShell title="Acme"/>
</Rebase>
```

Everything below is derived from the table's descriptor: its columns with their
Postgres types, nullability, defaults, validation and storage rules, its
relations, and its row-level security posture. To change any of it, add a
[`customizeTable`](/docs/frontend/customize-table/) file; it states only what
differs.

:::note[Coming from collections?]
The panel used to read `config/collections` through a Vite plugin. It now reads
the tables the backend serves, and the presentation lives in
`frontend/src/cms/*.tsx`.
:::

## Where the tables come from

<span class="since-badge" data-since="0.31">Since 0.31</span>

`<RebaseCMS>` calls `client.schema.tables()`, which reads
`GET /api/schema/tables`. The answer is the list of table descriptors, redacted
for the caller: a table they may not read is absent, and so is a column their
roles may not read (see [Field access](/docs/collections/field-access/)). Hook
code never leaves the server; the descriptor only says which hooks exist.

- The panel asks once someone is signed in, and asks again when the signed-in
  user or their roles change. A signed-out visitor is not sent any table.
- The server tags the answer with an `ETag`. The client keeps the last answer
  and sends the tag back, so an unchanged schema costs a `304`.
- Refreshing the navigation asks again. The schema editor does this after it
  changes a table.

The same descriptors drive the Studio and the MCP apps, so the three agree on
what a table is.

## Labels

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every label is derived from an identifier, so a table reads the same for every
caller and on every load:

| Identifier | Label |
|---|---|
| column `first_name`, `firstName` or `FirstName` | First Name |
| column `author_id`, `photoUrl`, `apiKey` | Author ID, Photo URL, API Key |
| column `__order` | Order |
| table `order_items` | Order Items, one record: Order Item |
| table `addresses`, `status_updates` | Addresses / Address, Status Updates / Status Update |
| enum value `needs_review` | Needs Review |

The table's labels come from the name it was defined under, not its slug or SQL
name. `ID`, `IDs`, `URL`, `URLs`, `UUID`, `API` and `IP` keep their capitals. The
singular changes only the last word, and leaves words that merely end in `s`
alone (`Status`, `Analysis`, `Address`).

## The field each column gets

<span class="since-badge" data-since="0.31">Since 0.31</span>

| Column | Field in the form | Notes |
|---|---|---|
| `col.text()`, `col.varchar({ length })`, `col.char({ length })`, `col.uuid()` | text input | `varchar` and `char` cap the length |
| a text column with `.validate({ email: true })` | email input | validated as an email |
| a text column with `.validate({ url: true })` | URL input, with a link preview | validated as a URL |
| a text column with `{ enum: [...] }`, a number column with `.oneOf([...])` | select | one option per value |
| a text or uuid column with `.userId()` | user picker | the value is the user's id |
| `col.enum([...])`, a `pgEnum` column | select, drawn as a coloured chip | one colour per value, seeded by the value itself |
| `col.smallint()` … `col.bigserial({ mode: "number" })` | number input | whole numbers only |
| `col.real()`, `col.doublePrecision()`, `col.numeric({ precision, scale })` | number input | |
| `col.boolean()` | switch | |
| `col.timestamp({ withTimezone: true })` | date and time picker | |
| `col.date()` | date picker | |
| `col.time()` | time of day | |
| `col.storage(…)` | upload field with preview | `.multiple()` is a multi-file field |
| `<item>.array()` | repeatable list of the item's field | an array of `{ enum: [...] }` text is a multi-select |
| `col.jsonb().$type<T>()`, `col.json().$type<T>()` | key/value editor | the type `T` is erased at runtime |
| `col.jsonb(json.object({…}))` | a group of typed fields | lists, typed blocks and files inside, from the shape |
| `col.geopoint()` | latitude and longitude | |
| `col.vector({ dimensions })` | vector input | |
| `col.bytea()` | binary field | base64 on the wire |

An enum value keeps its colour wherever it appears: in the select, on the
table's chip and as a kanban column. The colour depends only on the value, so
adding a value never recolours the others. `customizeTable` can name the
labels and colours you want with `enumLabels`; a value you do not name keeps
its derived one.

A `jsonb` column declared with a [`json.*` shape](/docs/schema/json/) gets a
real form: an object is a group of fields, an array repeats its item, an array
of `json.oneOf` is a block editor, and `json.storage()` is an upload field inside
it. Without a shape the panel cannot know the document, and offers free
key/value editing.

Each column type, its widget, and the options that change it are on
[Fields](/docs/collections/properties/).

## Required, defaults and read-only fields

<span class="since-badge" data-since="0.31">Since 0.31</span>

| The column | In the form |
|---|---|
| `.notNull()` | required, with the `requiredMessage` of `.validate()` when it has one |
| `.default(literal)` | a new record opens with that value; still required on edit |
| `` .default(sql`…`) ``, `.defaultNow()`, `.dbDefault()` | may be left empty on create, for the database to fill |
| `.unique()` | the form checks the value is unused before it saves |
| a generated primary key (`.defaultRandom()`, `.generatedByDefaultAsIdentity()`, a serial) | not editable; a key without a default is typed in on create |
| `.onCreateNow()`, `.onUpdateNow()` | read-only, and left out of the default table columns |
| `.onCreateUser()`, `.onUpdateUser()` | read-only |
| `.readOnly()`, `.generatedAlwaysAs(…)` | read-only |
| the table's `tenant` field | filled by the server on create, and left out of the default table columns; still editable for a caller who may write it |
| `.private()` | never served, so never shown |

A column's `.validate()` rules are checked by the form before it saves, as the
server checks them on the way in. See
[Validation and conditions](/docs/collections/validation-and-conditions/).

The record's id and its `.onCreateNow()` and `.onUpdateNow()` stamps are shown
in the read-only block at the foot of the form's rail.

## Relations

<span class="since-badge" data-since="0.31">Since 0.31</span>

- A `belongsTo` is a picker of the related row, in place of its foreign-key
  column: the form shows **Author**, not **Author ID**. It is required when the
  foreign key is `NOT NULL` with no default. A foreign key that is part of the
  primary key stays a field of its own, beside the picker.
- A `hasOne` is a picker of the one related row.
- A `hasMany`, a `manyToMany` and a to-many `via` are **tabs** of the record,
  listing the related rows. The picker beside the tab is hidden.
- A `via` is read-only unless it is writable.
- A relation to a table the caller is not served is left out: the panel cannot
  open a table it does not have. A `belongsTo` then leaves its foreign key as a
  plain field, so the value stays visible.

See [Relations in the panel](/docs/collections/relations-in-the-admin-panel/).

## Display slots

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every surface that draws a record uses some of six slots: title, subtitle,
image, status, date and tags (see [display slots](/docs/frontend/view-modes/#display-slots)).
A slot is filled from a column only when the column plainly belongs there; the
first matching column, in declaration order, wins:

| Slot | Column |
|---|---|
| title | a text column with no closed set and no file, whose key is `title`, `name`, `label`, `displayName`, `fullName`, `heading`, `subject` or `username` (case and separators ignored) |
| image | a single `col.storage()` column whose `accept` names an image type |
| status | a column named `status` with a closed set of values |
| date | a date or timestamp column the server does not stamp (`publishDate`); failing that the update stamp, then the create stamp |

A slot no column fills is left to the panel's own reading of the record (for
the title: the first short text field). `display` in `customizeTable` sets any
slot explicitly.

## Who sees which controls

<span class="since-badge" data-since="0.31">Since 0.31</span>

The panel hides **Create**, **Edit** and **Delete** when the signed-in user may
not do them. It decides by evaluating the table's row-level security in the
browser, with the same policy model that is compiled to Postgres:

- the rules you declared in `rls`, plus the policies Rebase adds beside them:
  the admin baseline (unless `defaultPolicies: false`), the users table's
  self-read and admin write gate, and the tenancy rule
  (see [policies a table gets](/docs/collections/security-rules/#policies-a-table-gets-without-writing-them));
- `rls: "admin-only"`: only admins see the controls;
- a rule written in raw SQL cannot be judged in the browser, and neither can a
  clause the server withheld from this caller: the control is shown, and the
  database decides when the write arrives;
- a SQL view is read-only. A plain view is listed and the tables it reads
  decide which rows come back; a materialized view is listed for the roles it
  names (`["admin"]` when it names none).

This only decides what is drawn. Every write is checked again by Postgres, so a
control that should not have been shown leads to a refused write, never to a
write that should not have happened.

## Order and defaults

<span class="since-badge" data-since="0.31">Since 0.31</span>

Tables appear in the navigation in the order the backend serves them, the order
they are exported from `backend/schema/index.ts`. Each opens in the table view.
`customizeTable` sets `group`, `icon`, `defaultViewMode` and the rest; `<RebaseCMS
navigationGroupMappings>` arranges groups across tables.

## Loading and errors

<span class="since-badge" data-since="0.31">Since 0.31</span>

- **While the tables load**, a route to a collection shows the loading state,
  not "collection not found", and a deep link opens once the collection exists.
- **If the tables cannot be loaded**, the home page and the collection route say
  what failed and offer to retry. When the server no longer accepts the
  session, the message asks to sign in again.
- **A backend that serves no tables** (one without auth configured, or older
  than the route) is not an error: the panel shows the
  [external collections](/docs/frontend/firebase/) and nothing else.

Customizations that name a table the caller is not served are ignored, with a
warning in development. See
[what is refused and what is skipped](/docs/frontend/customize-table/#what-is-refused-and-what-is-skipped).

## Many tables

<span class="since-badge" data-since="0.31">Since 0.31</span>

Nothing caps the number of tables. The panel needs every collection to draw the
navigation, so the descriptors are fetched after sign-in, and what opening a
collection needs (the table, the record views, the form) loads only then. A
large schema slows `rebase db push` more than the panel: at 400 or more tables a
push takes tens of seconds; see
[how long a push takes](/docs/cli/schema#rebase-db-push).

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [customizeTable](/docs/frontend/customize-table/): change any of the above, per table
- [Fields](/docs/collections/properties/): every column type's widget and options
- [View modes](/docs/frontend/view-modes/): table, cards, kanban, display slots and filters
- [Relations in the panel](/docs/collections/relations-in-the-admin-panel/): tabs, pickers and pivots
- [Firestore beside Postgres](/docs/frontend/firebase/): collections from another data source
