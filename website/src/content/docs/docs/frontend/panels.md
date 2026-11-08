---
title: Panels in a page of your own
sidebar_label: Panels in your own pages
description: "Show one collection, one record's form, one record or one value in a page of your own: CollectionPanel, EntityFormPanel, EntityViewPanel, FieldValue and CollectionsProvider, with no admin shell around them."
---

On 0.24
`CollectionPanel` takes only a registered `path` and renders "Collection not
found" outside the full admin tree, and `EntityFormPanel` and
`CollectionsProvider` do not exist.

You do not need the whole admin to show one table. `<CollectionPanel>` takes
the collection as a value and works anywhere under `<Rebase>` and a React
Router router, with no `<RebaseCMS>`, `<RebaseNavigation>` or `<RebaseShell>`:

```tsx
import { Rebase, useRebaseAuthController } from "@rebasepro/app";
import { CollectionPanel } from "@rebasepro/cms";
import { postsCollection } from "../config/collections/posts";
// Plus BrowserRouter, or any other router, from "react-router".

export function App() {
    const authController = useRebaseAuthController({ client });

    return (
        <Rebase client={client} authController={authController}>
            <BrowserRouter>
                <MyPageLayout>
                    <CollectionPanel collection={postsCollection}/>
                </MyPageLayout>
            </BrowserRouter>
        </Rebase>
    );
}
```

A record opens over your page, in a side panel or a dialog, and never by URL:
no admin route serves the page, so `full_screen` and `split` open as a side
panel, and `useUrlController().routesMounted` is `false` for your own
components there. Any router works: a plain `<BrowserRouter>`, a
`<MemoryRouter>`, or a data router. A router is still required. A data router
also lets a record with unsaved changes stop in-app navigation; under the
others only the browser's leave-page prompt guards it. Wrap the panel in `<RebaseAuthGate>` if the page
should show Rebase's sign-in first.

## What a panel shows

<span class="since-badge" data-since="0.29">Since 0.29</span>
A panel draws the collection as the admin does. These props narrow it to what
your page needs; none of them changes the collection's own page.

```tsx
import {
    CollectionAddButton,
    CollectionFiltersButton,
    CollectionPanel,
    CollectionSearchBar,
    CollectionToolbar
} from "@rebasepro/cms";

<CollectionPanel
    collection={ordersCollection}
    viewMode="cards"
    fields={["number", "status", "total"]}
    toolbar={<CollectionToolbar
        start={<CollectionFiltersButton/>}
        end={<><CollectionSearchBar/><CollectionAddButton/></>}/>}
    onRowClick={(order, id) => setSelected(id)}
    className="max-h-[480px]"/>
```

- `fields` — the properties it shows, in this order, and nothing else. In the
  table they are the columns. In the list, on a card and on a kanban card they
  are what the row's places — title, image, subtitle, status, date, relation
  chips, the list's columns — are filled from, earlier ones first; a place none
  of them fills stays empty. For this panel it wins over `propertiesOrder`, the
  column order a user saved and `listProperties`. Column widths a user drags
  still persist; the order is yours, so columns are not dragged.
- `toolbar` — the full toolbar by default, `null` for none, or one composed of
  its pieces: `CollectionToolbar` (with `start` and `end`),
  `CollectionSearchBar`, `CollectionFiltersButton`, `CollectionViewModeToggle`
  and `CollectionAddButton`. They read the panel they are drawn in, and throw
  anywhere else. Plugin slots and the `Collection.Actions` override live in the
  default toolbar.
- `onRowClick` — called with the clicked row and its id instead of the panel
  opening it, from a row, a card, a kanban card and the edit action. The row is
  the one the server sends, the shape `useRows`, `useRow` and `<FieldValue>`
  take: exactly its columns, ISO date strings (`YYYY-MM-DD` for a date-only
  column), and a belongsTo relation as its foreign key (`customerId`). A relation the panel loaded the
  target of arrives nested under its name, as REST's `include` returns it
  (`order.customer` is the customer's row); its foreign key is there too. The
  id is the string the admin addresses the record by — its primary key, a
  composite one's parts joined by `:::` — which `highlightedIds` and
  `useSidePanel().open` take. `row.id` is the record's `id` column, where the
  table has one, with that column's type: `5` for an integer key, whose id is
  `"5"`.
- `highlightedIds` — the ids of the rows drawn as selected, the one a page
  shows beside the list, say: `highlightedIds={selected ? [selected] : []}`.
  `[]` draws none. Without it the panel highlights the row last opened. Ids
  are compared as strings, so an integer key's `5` and `"5"` are one row.
- `where` — which rows it holds, as `useRows` takes it:
  `where={{ status: ["==", "pending"] }}`. Filters the person sets on other
  fields combine with it, and its own fields cannot be changed or cleared from
  the toolbar. It follows the prop, so a tab bar or a clicked chart bar can
  drive it from state. It goes over the collection's `fixedFilter`, field by
  field.
- `viewMode` — the mode it opens in, over the one in the URL and the one the
  person last picked. They can still switch.
- `title={false}` — no title above the panel, nor the list view's own heading.
- `updateUrl` — off by default: the panel neither reads nor writes the page's
  `__view`, filter and sort parameters.

The collection's `entityActions` draw on every row, card and kanban card, as
buttons when declared `collapsed: false` and in the row's menu otherwise — an
"Approve" on every card is one action.

A panel sizes to its rows. With no height from its parent, or only a
`max-height`, a short collection draws its toolbar and rows and a long one
scrolls inside the space it has, up to the window's height. Give it a height to
fill it. It lays itself out by its own width, not the window's: in a narrow
column it uses its compact layout, whatever the screen.

`propertiesOrder` reorders and never hides: a property it leaves out is drawn
after the ones it names. To hide one everywhere, set `admin.hideFromCollection`
on it; to show only some in one place, pass `fields`.

## One record's form

`<EntityFormPanel>` does the same for one record's form. It loads the record
by `id`, saves it through `<Rebase>`'s data layer as the admin's own
form does, and calls `onSaved` after every save with the saved record as the
server sends the row, `row`, and its `id`. Omit `id` to create a
record. `onClose` is called when the form asks to be left, for example after
its record is deleted:

```tsx
<EntityFormPanel
    collection={postsCollection}
    id={postId}
    onSaved={({ id }) => console.log("saved", id)}
    onClose={() => navigate("/posts")}/>
```

Like `CollectionPanel`, the form and `EntityViewPanel` take a registered
collection by `path`, with no config object in hand:
`<EntityFormPanel path="posts" id={postId}/>`. Under `<RebaseCMS>` or a
`CollectionsProvider` that registers it, that is all they need. With no scope
above, hand the collection over as a value, as here, and the panel brings its
own; one named by a path nothing registers says the record is not found.

If someone else deletes the record while the form is open, the form keeps
what was typed and says the record was deleted elsewhere. Its "Save as new"
action turns it into a form that creates a new record with those values;
`onSaved` then reports the new record.

<span class="since-badge" data-since="0.29">Since 0.29</span> The form can show
part of a record, or lay it out your way. `fields` shows only the fields it
names, in that order; sections and the rail keep their grouping. `layout`
replaces the generated fields with your own JSX, in which
`<FormField name="…"/>` draws one field with the label, size and rules the
generated form gives it:

```tsx
import { EntityFormPanel, FormField } from "@rebasepro/cms";

<EntityFormPanel
    collection={ordersCollection}
    id={orderId}
    layout={<div className="grid grid-cols-2 gap-4">
        <FormField name="customer"/>
        <FormField name="status"/>
        <div className="col-span-2"><FormField name="notes"/></div>
    </div>}/>
```

Either way the form validates only the fields it shows; the server still
checks the whole record. A form that creates a record and leaves out a
required field with no default value says so when it opens: an error names the
field, and Save stays blocked until the field is shown or given a default.
`collectionOverrides` changes the collection for this form only, as it does for
`CollectionPanel`.

Each form scopes its DOM ids, so two forms can share a page. To find a field
from a test, select `[data-form-field="title"]` inside the form's
`[data-form-path="posts"]`.

<span class="since-badge" data-since="0.29">Since 0.29</span>
`<EntityViewPanel>` is the read-only twin of `EntityFormPanel`. It loads the
record by `id` and draws it as the admin's record page does: the same
sections and labels, with each value as its preview, so an enum shows as its
chip, a date in its timezone and a relation as its target's title. It takes
`fields` and `collectionOverrides` as the form does, and leaves out the fields
the form leaves out: one a `conditions.hidden` rule hides for this record, and
one the signed-in user may not read.

```tsx
import { EntityViewPanel } from "@rebasepro/cms";

<EntityViewPanel
    collection={ordersCollection}
    id={orderId}
    fields={["customer", "status", "total"]}/>
```

`<FieldValue>` draws one value the same way, inside your own JSX. It takes the
whole row, as `useRows`, `useRow` and `client.data` return it, because a
belongsTo relation arrives under its foreign-key column (`customerId`), not
under the property's name; `field="customer"` finds it there. It needs the
collection registered above it, by `<RebaseCMS>` or a `CollectionsProvider`.
An unknown collection or field throws an error that names it.

```tsx
import { useRows } from "@rebasepro/app";
import { FieldValue } from "@rebasepro/cms";

function OrderList() {
    const { rows } = useRows("orders", { limit: 20 });
    return rows.map(row => (
        <div key={String(row.id)} className="flex gap-4">
            <FieldValue row={row} path="orders" field="customer"/>
            <FieldValue row={row} path="orders" field="status"/>
            <FieldValue row={row} path="orders" field="placedAt"/>
        </div>
    ));
}
```

## Several panels in one scope

The three panels bring their own `CollectionsProvider` when none is above them. That is
the step underneath, and you can mount it yourself to share one scope between
several panels, or to use the lower-level pieces (`CollectionViewBinding`,
`useSidePanel`) under it. Inside it, a panel can name its collection by `path`:

```tsx
import { CollectionPanel, CollectionsProvider } from "@rebasepro/cms";

const collections = [postsCollection, authorsCollection];

<CollectionsProvider collections={collections}>
    <CollectionPanel path="posts"/>
    <CollectionPanel path="authors"/>
</CollectionsProvider>
```

`CollectionsProvider` holds a registry of the collections you hand it, with
your plugins' `modifyCollection` and `injectCollections` applied as in the
admin, plus the side panels and dialogs records open in, and the
unsaved-changes guard. Keep the `collections` array stable: a module constant,
or `useMemo`.

## Next

- [Customizing the admin](/docs/frontend/customizing): the places a component
  of yours can go, and the recipes built from these panels.
- [Hooks](/docs/hooks): `useRows`, `useRow`, `useRowCount`, `useAggregate` and
  `useRowWrites`, the rows these panels and `FieldValue` read.
- [Component overrides](/docs/frontend/component-overrides): replace the view
  or the form a panel draws.
