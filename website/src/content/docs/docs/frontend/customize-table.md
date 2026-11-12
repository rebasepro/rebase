---
title: customizeTable
sidebar_label: customizeTable
description: "customizeTable states how one table's collection differs from what the CMS derives: labels, icon, views, kanban, display slots, form layout, actions, and per-field options with React components imported by value. Every option, with its type and effect."
---

<span class="since-badge" data-since="0.31">Since 0.31</span>

If you use the CMS, every table the backend serves already has a collection in
the panel, derived from the table itself (see
[how tables become collections](/docs/collections/)). `customizeTable` states
what should differ, and nothing else. It lives in the frontend, next to the rest
of your React code, so a custom field is a component you import like any other.

```tsx
// frontend/src/cms/posts.tsx
import { customizeTable, updateRecord } from "@rebasepro/cms";
import type { posts } from "../../../backend/schema/posts";
import { CustomMarkdownEditor } from "../components/CustomMarkdownEditor";

export const postsCms = customizeTable<typeof posts>("posts", {
    name: "Blog Posts",
    singularName: "Blog Post",
    icon: "FileText",
    group: "Content",

    defaultViewMode: "cards",
    enabledViews: ["table", "cards", "kanban"],
    kanban: { columnField: "status", orderField: "__order" },

    display: {
        title: "title",
        image: "heroImage",
        status: "status",
        date: "publishDate",
    },

    fields: {
        status: {
            enumLabels: {
                draft:        { label: "Draft", color: "gray" },
                needs_review: { label: "Needs Review", color: "orange" },
                published:    { label: "Published", color: "green" },
                archived:     { label: "Archived", color: "red" },
            },
        },
        title:   { multiline: true },
        content: { Field: CustomMarkdownEditor },
        orgId:   { hidden: true },
        __order: { hidden: true, disabled: true },
    },

    entityActions: [
        {
            key: "publish",
            name: "Publish",
            icon: "Send",
            collapsed: false,
            isEnabled: ({ row }) => row?.status !== "published",
            onClick: ({ id, context }) =>
                updateRecord(context, "posts", id, { status: "published", publishDate: new Date().toISOString() }, "Published"),
        },
    ],
});
```

Pass the result to `<RebaseCMS tableCustomizations={[postsCms]}/>`; see
[the frontend overview](/docs/frontend/#rebasecms-props).

:::note[Coming from collections?]
These are the presentation options of the old `admin` block, at the top level
and under a few new names (`fieldOrder`, `listFields`, `previewFields`,
`fields`, `kanban.columnField`, `kanban.orderField`). Using an old name throws
with the new one.
:::

## Where the files live

<span class="since-badge" data-since="0.31">Since 0.31</span>

```text
frontend/src/cms/
├── index.ts        # export const tableCustomizations = [postsCms, …]
├── posts.tsx       # customizeTable("posts", …)
└── events.ts       # defineFirestoreCollection(…), for Firestore
```

The names are a convention. What matters is that the results reach
`<RebaseCMS tableCustomizations>`. A table without a file is shown as derived.

The frontend imports the table's **type** only: `import type { posts }`. A type
import is erased when the bundle is built, so hooks and server code in
`backend/schema` never reach the browser. A value import from `backend/` in
frontend code is the one thing not to write. The backend never imports anything
from the frontend.

## The slug and the type

<span class="since-badge" data-since="0.31">Since 0.31</span>

The first argument is the table's slug: the name it was defined under, or the
`slug` it was given. With the table as the type argument, the slug, every key
that names a field and every enum value is checked against the table:

| Checked against `typeof posts` | A mistake is |
|---|---|
| the first argument | a type error unless it is the table's slug |
| `fields` keys | a column key or a relation name |
| `fieldOrder`, `listFields`, `form` entries | a field, a dotted path into one (`"seo.title"`), `subcollection:<relation>`, or an additional field's key |
| `display`, `sort`, `fixedFilter`, `defaultFilter`, `filterPresets` | a field or a path into one |
| `kanban.columnField` | a column holding one closed set of strings (`col.enum([...])`, or `.oneOf([...])`) |
| `kanban.orderField` | a text column |
| `enumLabels`, `enumOrder` | values the column can hold; a column with no closed set accepts neither |
| field options | those of the column's type: `multiline` on a text column, `format` on a number |
| `entityActions[].onClick` and friends | `row` is the table's `InferRow` |

`defineTable("blog_posts", { slug: "posts", … })` is customized as
`customizeTable<typeof posts>("posts", …)`: still one type argument. Without the
type argument, `customizeTable("posts", { … })` accepts the same options,
loosely typed.

## What is refused, and what is skipped

<span class="since-badge" data-since="0.31">Since 0.31</span>

`customizeTable` checks what the compiler cannot see when the module loads, and
throws with what to write instead:

- an unknown option, with the nearest known one, or with the new name of an old
  `admin` option;
- a component given as a string path, a lazy `() => import(…)` thunk or anything
  that is not a React component;
- an entity action without `name` or `onClick`, a custom view without
  `Builder`, a `kanban` without `columnField`, a `referenceTo` that is not a slug;
- `fields` inside a relation's `overrides`: restyle the target table with its
  own `customizeTable`.

```text
customizeTable("posts"): unknown options:
  - `propertiesOrder` — it is `fieldOrder` now
  - `iconn` — did you mean `icon`?
```

The result is frozen. Passing two customizations of the same slug to
`<RebaseCMS>` throws: which one wins would depend on import order.

What the server serves can differ from what you wrote against. A column may be
withheld from this caller (see [field access](/docs/collections/field-access/)),
or the table may have changed since. That is not an error at runtime. In
development the panel prints one warning per mismatch, and skips it:

- a customization whose slug matches no served table is ignored;
- a field, column entry, display slot, form entry or kanban field the table does
  not serve is dropped;
- an option that does not apply to the field's type (`format` on a text column,
  `enumLabels` on a field without a closed set) is ignored.

The rest of the customization still applies.

## Table options

<span class="since-badge" data-since="0.31">Since 0.31</span>

Every key is optional. A key you leave out keeps what the panel derived.

### Identity and navigation

| Option | Type | Effect |
|---|---|---|
| `name` | `string` | The plural label: drawer, page heading. Derived from the table name otherwise. |
| `singularName` | `string` | The label of one record. |
| `description` | `string` | Shown under the heading and on the home card. |
| `metadata` | `Record<string, unknown>` | Your own data, merged over the table's `metadata`. |
| `icon` | `string \| ReactNode` | A Lucide icon name (`"FileText"`) or an element. |
| `group` | `string` | The navigation group. |
| `hideFromNavigation` | `boolean` | Not in the drawer. Still reachable by URL and as a reference target. |
| `hideFromEntityViews` | `boolean` | Not offered as a tab on the records of tables that relate to it. |

### Views

| Option | Type | Effect |
|---|---|---|
| `defaultViewMode` | `ViewMode` | The view a visitor lands on: `"list"`, `"table"`, `"cards"`, `"kanban"` or a custom view's key. `"table"` otherwise. |
| `enabledViews` | `ViewMode[]` | The views offered in the switcher. |
| `kanban` | `{ columnField, orderField? }` | The board: the column it groups by and the text column it stores order keys in. See [View modes](/docs/frontend/view-modes/#kanban). |
| `customViews` | `(string \| TableCustomView)[]` | More ways to render the rows: `{ key, name, Builder }`, or the key of one registered on `<RebaseCMS collectionViews>`. |
| `defaultSize` | `"xs" \| "s" \| "m" \| "l" \| "xl"` | The default row height. |

### Columns and slots

| Option | Type | Effect |
|---|---|---|
| `fieldOrder` | `TableColumnId[]` | The order fields are drawn in. Fields it leaves out follow, so nothing disappears. |
| `listFields` | `TableColumnId[]` | The columns of the list view. |
| `previewFields` | `TableFieldKey[]` | The fields shown when a record of this table is referenced from another. |
| `display` | `TableDisplay` | What fills a record's `title`, `subtitle`, `image`, `status`, `date` and `tags`: a field path or a resolver. See [display slots](/docs/frontend/view-modes/#display-slots). |
| `additionalFields` | `TableAdditionalField[]` | Computed columns. See [Additional columns](/docs/frontend/additional-columns/). |
| `hideIdFromCollection` | `boolean` | Hide the id column. |

A computed column is `{ key, name, width?, Builder?, dependencies?, value? }`:
`Builder` renders the cell from `{ row, id, context }`, `dependencies` names the
fields whose change re-renders it, and `value` gives the cell's value for
export. Name it in `fieldOrder` as `"key" as AdditionalFieldKey`.

### Query defaults

| Option | Type | Effect |
|---|---|---|
| `sort` | `OrderBySpec` | The default sort: `["publishDate", "desc"]`, or several keys in order. |
| `fixedFilter` | `FilterValues` | A filter the visitor cannot change. |
| `defaultFilter` | `FilterValues` | The filter a visitor starts from. |
| `filterPresets` | `FilterPreset[]` | One-click filters in the toolbar: `{ label?, filterValues, sort? }`. |
| `pagination` | `boolean \| number` | Load in pages (`true`, or the page size), or everything at once (`false`). |

See [Filters and sort](/docs/frontend/view-modes/#filters-presets-and-sort).

### Behaviour

| Option | Type | Effect |
|---|---|---|
| `inlineEditing` | `boolean` | Edit cells in place in the table. |
| `selectionEnabled` | `boolean` | Rows can be selected. |
| `selectionController` | `SelectionController` | A selection you hold outside the view (`useSelectionController`). |
| `exportable` | `boolean \| ExportConfig` | Whether the toolbar offers Export, and extra columns for it. See [Import and export](/docs/frontend/data-import-export/). |
| `openEntityMode` | `"side_panel" \| "full_screen" \| "split" \| "dialog"` | How a record opens. |
| `defaultEntityAction` | `"view" \| "edit"` | Whether clicking a record opens it to read or to edit. |
| `sideDialogWidth` | `number \| string` | The width of the side panel a record opens in. |
| `defaultSelectedView` | `string \| DefaultSelectedViewBuilder` | The tab a record opens on. |

### Form

| Option | Type | Effect |
|---|---|---|
| `form` | `{ sidebar?, sections?, showRecordMeta? }` | Sections, and the rail beside the form. See [Form layout](/docs/frontend/form-layout/). |
| `formView` | `{ Builder, includeActions? }` | A component that replaces the generated form. `includeActions` keeps Save and Discard in the record's bar. |
| `formAutoSave` | `boolean` | Save as the visitor types. |
| `alwaysApplyDefaultValues` | `boolean` | Fill declared defaults into a stored record's empty fields when it is opened. |
| `includeJsonView` | `boolean` | Add a tab with the record as JSON. |
| `localChangesBackup` | `"manual_apply" \| "auto_apply" \| false` | Keep unsaved edits in local storage. |
| `hideIdFromForm` | `boolean` | Hide the id from the form. |

A section is `{ key, title?, fields, collapsed?, collapsible?, readVariant? }`,
with `readVariant` `"grid"` or `"summary"`.

### Actions, views and overrides

| Option | Type | Effect |
|---|---|---|
| `entityActions` | `(string \| TableEntityAction)[]` | Actions on a record. An object, or the key of one registered on `<RebaseCMS entityActions>`. See [Entity actions](/docs/frontend/entity-actions/). |
| `disableDefaultActions` | `("edit" \| "copy" \| "delete")[]` | Built-in actions this table does not offer. |
| `entityViews` | `(string \| TableEntityView)[]` | Extra tabs on a record. See [Entity views](/docs/frontend/entity-views/). |
| `Actions` | `Component[]` | Components rendered in the collection's toolbar. |
| `components` | `TableComponentOverrides` | Collection-scoped component overrides, each `{ Component, wrap? }`. See [Component overrides](/docs/frontend/component-overrides/#collection-level-component-overrides). |
| `browserCallbacks` | `CollectionCallbacks` | Callbacks that run in the panel after the server's hooks. Presentation only: they ship to every visitor and secure nothing. See [React hooks](/docs/hooks/#data). |
| `fields` | `TableFields` | Per-field options, keyed by column or relation. Below. |

## Field options

<span class="since-badge" data-since="0.31">Since 0.31</span>

`fields.<key>` takes the options every field takes, plus those of its column
type. [Fields](/docs/collections/properties/) shows each with the widget it
changes.

### Every field

| Option | Type | Effect |
|---|---|---|
| `name` | `string` | The label. Derived from the key otherwise (`publishDate` → "Publish Date"). |
| `description` | `string` | Help text under the field. |
| `hidden` | `boolean` | Kept out of the table and card views. Still on the form, and still read and written by the API. |
| `hiddenInForm` | `boolean` | Kept off the form. Still in the views. |
| `disabled` | `boolean \| { disabledMessage?, clearOnDisabled? }` | The control is greyed out. `disabledMessage` says why, beside it; `clearOnDisabled` clears the value when it becomes disabled. |
| `readOnly` | `boolean` | The value is drawn as text, with no control. |
| `Field` | `Component` | Replaces the form control. The component itself. See [Custom fields](/docs/frontend/custom-fields/). |
| `Preview` | `Component` | Replaces how the value is drawn outside the form. |
| `Filter` | `Component` | Replaces the filter control for this field. |
| `columnWidth` | `number` | The column width in the table, in pixels. |
| `filledByServer` | `boolean` | A server hook fills it on create: the form lets a record be created without it. |
| `span` | `1 \| 2 \| 3 \| 4` | How many of the form grid's four columns it spans. |
| `customProps` | `unknown` | Passed untouched to your `Field` and `Preview`. |
| `filterOperators` | `WhereFilterOp[]` | Narrows the filter operators offered. `[]` turns filtering off for it. |
| `propertyConfig` | `string` | The key of a field type registered on `<Rebase propertyConfigs>`. |
| `conditions` | `PropertyConditions` | JSON-logic rules that hide, disable or require the field from the record's values. Form only. See [conditions](/docs/collections/validation-and-conditions/#conditional-fields). |
| `dynamicProps` | `(props) => options \| undefined` | Returns the field options that apply now, from the record being edited. Form only. |
| `metadata` | `Record<string, unknown>` | Your own data. |

### Text and uuid columns

| Option | Type | Effect |
|---|---|---|
| `multiline` | `boolean` | A multi-line input, growing with its content. |
| `markdown` | `boolean` | A markdown editor with a preview. |
| `previewAsTag` | `boolean` | Drawn as a chip rather than text. |
| `clearable` | `boolean` | Adds a control that sets the value to `null`. |
| `urlPreview` | `PreviewType \| boolean` | How a URL in the value is previewed: `"image"`, `"video"`, `"audio"`, `"file"`, or `true` for a link. |
| `referenceTo` | `string` | The column holds the key of a record in another collection, on any data source: it is drawn and picked as a reference to that collection's slug. See [Firestore](/docs/frontend/firebase/#from-a-table-to-firestore). |

### Columns with a closed set of values

A `col.enum([...])`, a `.oneOf([...])`, or an array of either:

| Option | Type | Effect |
|---|---|---|
| `enumLabels` | `{ [value]?: string \| EnumLabel }` | Labels for some of the values. Values left out keep their derived label and colour. |
| `enumOrder` | `value[]` | The order values are offered, and kanban columns drawn, in. The column's own order otherwise. |
| `previewAsTag` | `boolean` | On a `col.enum()`: drawn as a chip. |
| `clearable` | `boolean` | On a `col.enum()`: adds a control that sets the value to `null`. |

An `EnumLabel` is `{ label, color?, disabled? }`. `color` is a chip colour key
(`"green"`, `"orangeDark"`) or a `{ color, text }` scheme; `disabled` shows the
value without offering it for selection.

### Number columns

| Option | Type | Effect |
|---|---|---|
| `clearable` | `boolean` | Adds a control that sets the value to `null`. |
| `format` | `NumberFormatOptions` | Writes the number out as currency, a percentage, or with fixed decimals. |

`format` takes `style` (`"decimal"`, `"currency"`, `"percent"`), `currency` (an
ISO code, required with `"currency"`), `locale` (the viewer's otherwise),
`minimumFractionDigits`, `maximumFractionDigits` and `notation`
(`"standard"` or `"compact"`, which writes `12000` as `12K`). It changes what is
drawn, never what is stored.

### Date, timestamp and time columns

| Option | Type | Effect |
|---|---|---|
| `clearable` | `boolean` | Adds a control that sets the value to `null`. |
| `mode` | `"date" \| "date_time"` | Pick and show a day only, or a day and a time. Derived from the column type otherwise. |
| `timezone` | `string` | The IANA time zone the value is shown and picked in (`"Europe/Madrid"`). The viewer's otherwise. |

### Vector columns

| Option | Type | Effect |
|---|---|---|
| `clearable` | `boolean` | Adds a control that sets the value to `null`. |

### Storage columns

| Option | Type | Effect |
|---|---|---|
| `storage` | `StorageCustomization` | The upload functions that run in the browser. |
| `clearable` | `boolean` | Adds a control that sets the value to `null`. |
| `urlPreview` | `PreviewType \| boolean` | How the stored URL is previewed. |

`storage` takes `path(context)`, `fileName(context)`, `processFile(file)`,
`postProcess(pathOrUrl)` and `previewUrl(fileName)`. The serializable options
stay on `col.storage({ … })`; see [File uploads](/docs/collections/file-uploads/).

### Array columns

| Option | Type | Effect |
|---|---|---|
| `expanded` | `boolean` | Every item open on load. |
| `minimalistView` | `boolean` | Items without their frame and header. |
| `sortable` | `boolean` | Items can be reordered by dragging. |
| `canAddElements` | `boolean` | Items can be added. |
| `of` | field options | The options of each item. |
| `storage` | `StorageCustomization` | The upload functions, for `col.storage().multiple()`. |

`enumLabels` and `enumOrder` written on an array apply to its items.

### JSON columns

| Option | Type | Effect |
|---|---|---|
| `expanded` | `boolean` | The document's fields open on load. |
| `minimalistView` | `boolean` | The document's fields without their frame. |
| `spreadChildren` | `boolean` | The document's fields laid out as if they were the record's own. |
| `keyValue` | `boolean` | Edited as free key/value pairs. |
| `previewFields` | `string[]` | The document's keys shown in its preview. |
| `fields` | `{ [key]: field options }` | The options of each key of the document. |
| `fieldOrder` | `string[]` | The order the document's keys are shown in. |
| `of` | field options | The options of each item, for a document that is a list. |
| `oneOf` | `{ [variant]: field options }` | The options of each variant of a typed block (`json.oneOf`). |

With `col.jsonb<T>()` or a `json.object({…})` shape, `fields` and `fieldOrder`
are typed by the document's keys. See [Arrays and JSON](/docs/collections/arrays-and-maps/).

### Relations

| Option | Type | Effect |
|---|---|---|
| `previewFields` | `string[]` | The target's fields shown in the chip for a related row. At most three fit. |
| `widget` | `"select" \| "dialog"` | How a related row is picked. |
| `fixedFilter` | `FilterValues` | Offer only rows that pass this filter. |
| `includeId` | `boolean` | Show the related row's id in previews. |
| `includeEntityLink` | `boolean` | Show a link that opens the related row. |
| `renderInForm` | `boolean` | Also draw a to-many relation as a picker in the form, beside its tab. |
| `overrides` | table options without `fields` | How the target is presented in this relation's tab. |

See [Relations in the panel](/docs/collections/relations-in-the-admin-panel/).

## Next steps

<span class="since-badge" data-since="0.31">Since 0.31</span>

- [How tables become collections](/docs/collections/): what the panel derives before any of this
- [Fields](/docs/collections/properties/): each column type's widget and options
- [View modes](/docs/frontend/view-modes/): table, cards, kanban, display slots, filters
- [Entity actions](/docs/frontend/entity-actions/): `entityActions` and `updateRecord`
- [Firestore beside Postgres](/docs/frontend/firebase/): `externalCollections` and references across engines
