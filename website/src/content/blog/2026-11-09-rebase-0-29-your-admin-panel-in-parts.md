---
title: "Rebase 0.29: your admin panel, in parts"
description: "Claude now opens your admin panel's own views and builds apps from its parts. The same parts are yours for your own pages, and every hook hands you the server's row. Plus the breaking change to read before you upgrade."
pubDate: 2026-11-09
authors: francesco
---

Until this release the admin panel was one thing. You described your collections, and it drew them: a table, a form, a record page. If you wanted a page that was most of a collection view plus one button, you bent the configuration until it fit, or you rebuilt the view by hand and lost everything the panel already knew about your data.

0.29 takes the panel apart. The list, the form, the read-only record and a single drawn value are now components you place yourself, with props for the things people kept asking for. They are the same parts the admin is built from, and the same parts Claude reaches for when you ask it to build something on your data.

## The order desk

Here is the example we kept coming back to while building this. Someone runs fulfilment. They want the number of pending orders, a chart of orders by status, the pending orders themselves with a Ship button on each row, and a small form beside the list for the tracking number.

```tsx
import { useState } from "react";
import { useAggregate, useRowCount, useRowWrites } from "@rebasepro/app";
import { CollectionPanel, RecordForm } from "@rebasepro/cms";
import {
  BarChart, Button, ChartCard, KpiGrid, KpiTile, SplitView,
} from "@rebasepro/ui";

export function OrderDesk() {
  const [openId, setOpenId] = useState<string>();
  const pending = useRowCount("orders", { status: ["==", "pending"] });
  const byStatus = useAggregate("orders", {
    select: [{ fn: "count" }],
    groupBy: ["status"],
    orderBy: ["count", "desc"],
  });
  const bars = (byStatus.result ?? []).map((r) => ({
    key: String(r.status), label: String(r.status),
    value: Number(r.count),
  }));
  const { update, saving } = useRowWrites();

  const list = (
    <CollectionPanel collection="orders" toolbar="compact"
      where={{ status: ["==", "pending"] }} orderBy="placed_at:desc"
      fields={["number", "customer", "total"]}
      highlightedIds={openId ? [openId] : []}
      onRowClick={(row, id) => setOpenId(id)}
      rowActions={(row, id) => (
        <Button size="small" disabled={saving}
          onClick={() => update("orders", id, { status: "shipped" })}>
          Ship
        </Button>
      )} />
  );

  return (
    <div className="flex flex-col gap-4">
      <KpiGrid>
        <KpiTile label="Pending"
          value={pending.count} loading={pending.loading} />
      </KpiGrid>
      <ChartCard title="Orders by status">
        <BarChart bars={bars} loading={byStatus.loading} />
      </ChartCard>
      <div style={{ height: 560 }}>
        <SplitView master={list} selected={openId}
          onClearSelection={() => setOpenId(undefined)}
          detail={
            <RecordForm key={openId} collection="orders" id={openId}
              compact fields={["status", "tracking_number", "notes"]} />
          } />
      </div>
    </div>
  );
}
```

That is the whole page. The count and the chart are computed in the database, not by reading every order into the browser. The list is the admin's own collection view, narrowed by `where`, sorted by `orderBy`, showing only the `fields` you name, with your own button in the last column. A click on the button does not open the record; a click on the row hands you the row and its id instead of opening anything. The form is the admin's own form, with its validation and relation pickers, trimmed to three fields and drawn compact. `SplitView` puts the two side by side when its own container is at least 768px wide, and drills down with a back bar when it is narrower, whatever the window. When Ship writes, the list, the count and the chart follow, so the shipped order leaves the pending list by itself.

The `style={{ height: 560 }}` is deliberate, and the next section explains why.

## The same code, in Claude

Rebase has served MCP at `/mcp` for a while, so the people who use your app can connect Claude as themselves. In 0.29, in a client that renders MCP Apps, three of those tools draw things instead of returning rows.

- `show_collection` opens the collection view the admin draws (table, list, cards or kanban) with its search, filters, sorting and paging. A row opens its form.
- `show_record` opens one record's form, or a form for a new record that starts from values Claude filled in, for the person to check and save.
- `show_app` takes a React component Claude writes, and the collections it reads.

That last one is where the parts come in. The app imports `@rebasepro/app`, `@rebasepro/cms` and `@rebasepro/ui` by their real names: the row hooks, `CollectionPanel` and its toolbar pieces, `RecordForm`, `FormField`, `RecordDetail`, `FieldValue`, and the whole UI kit. Ask Claude for the order desk and what it writes is a file like the one above, which you can paste into your project. The one thing to know is styling: the view ships Tailwind's standard utilities, so an arbitrary value like `h-[560px]` does nothing there, and an exact size is a `style`.

The server compiles the app before it opens. A syntax error, or an import the view does not serve, comes back to Claude as the call's error, with its line. The first page and count of each collection the app names are read before the view opens, so its first render does not wait on the network.

The boundary is the part I care about most. Every read and write the app makes is one of your server's own tools, called as the person, under their row-level security and the scopes their connection was granted. An app's code can do nothing Claude could not do with the same tools. `useRowWrites` asks the person before it writes, so an app does not change data without their click. A write the server refuses is shown in the view with the server's reason, and Claude is told, even if the app's code dropped the rejection. Confirmations name a row by its title, `ORD-2026-0126`, not by its id.

It works against a self-hosted backend's `/mcp` (set `REBASE_MCP_ENABLED` and `REBASE_PUBLIC_URL`) and through the hosted connector. If you add `rebaseMcpViewPlugin()` from `@rebasepro/app/vitePlugin` to your frontend's Vite config (new projects have it), what Claude draws is your own admin app, with your custom fields, views, actions and plugins. The [remote MCP page](/docs/ai/remote-mcp/) has the details.

## The parts

Each of these works anywhere under `<Rebase>` and a router, without the admin shell around it. [Panels in your own pages](/docs/frontend/panels/) covers every prop.

- **`CollectionPanel`** takes `collection` by name or as a value, plus `where`, `orderBy`, `fields`, `toolbar` (`"full"`, `"compact"`, `"none"`, or one you compose from its pieces), `rowActions`, `onRowClick` and `highlightedIds`. `where` follows the prop, so a tab bar or a click on a chart bar can drive it from state.
- **`RecordForm`** takes `fields`, `compact`, and your own arrangement of `<FormField>`s as its children (below). A form that shows only some fields validates only those, and a form that creates a record but leaves out a required field with no default says which one, and does not save.
- **`RecordDetail`** is the read-only twin: it loads a record by id and draws it as the admin's record page does.
- **`FieldValue`** draws one value the way the admin draws it: an enum as its chip, a date in the property's timezone, a foreign key as the related record's title.
- **`SplitView`**, **`KpiTile`**, **`ChartCard`**, **`BarChart`** and **`TimeSeriesChart`** are in `@rebasepro/ui`. The charts are SVG with no chart library, drawn in the kit's tokens in both themes, with a keyboard readout and a table for screen readers.

A `<FormField>` places one field of a record form anywhere inside it, with the label, size and rules the generated form would give it, so the form can have your layout without losing the admin's behaviour:

```tsx
<RecordForm collection="orders" id={id} compact>
  <div className="grid grid-cols-2 gap-3">
    <FormField name="status" />
    <FormField name="tracking_number" />
  </div>
  <FormField name="notes" />
</RecordForm>
```

## One row shape

The hooks are where the quieter change lives. `useRows`, `useRow`, `useRowCount`, `useAggregate` and `useRowWrites` read and write the server's rows: the shape REST returns, the shape `client.data` returns, and the shape the backend's `context.data` hands your callbacks. Dates are ISO strings. A belongsTo is its foreign key.

```tsx
const { rows } = useRows("orders", {
  where: { status: ["==", "pending"] }, orderBy: ["placed_at", "desc"], limit: 5,
});

rows.map((order) => (
  <li key={String(order.id)}>
    <FieldValue collection="orders" field="customer" value={order.customerId} />
    <FieldValue collection="orders" field="placed_at" value={order.placed_at} />
  </li>
));
```

Before 0.29 the admin had its own shape for a record, `{ id, path, values }`, with dates as `Date` objects and relations as objects. A function written for a backend callback did not work in an admin callback without translating one into the other. Now a row is a row wherever you meet it, and when the admin hands you one it hands you its id beside it.

## What breaks

That last change is also the breaking one, and the worst part of it is the part no compiler catches.

**The admin's browser callbacks and the browser's `context.data` now receive rows.** `row.values.title` becomes `row.title`. `values.due` is an ISO string, not a `Date`. A belongsTo is `values.customerId`. No type error tells you: the code compiles, then throws or reads the wrong thing at run time. Search your `browserCallbacks` and anything that reads `context.data` in the browser before you upgrade.

The rest TypeScript will point out for you:

- The admin's Entity data hooks are internal. `useData`, `useFetch`, `useCollection` and their friends give way to `useRows`, `useRow`, `useRowWrites` and `context.data`.
- Row-level callbacks get `{ row, id }` instead of an entity: entity actions, `admin.display` resolvers, additional fields, entity views.
- "Which record" is `id` everywhere: `RecordForm` takes `id` for `entityId`, `useSidePanel().open({ path, id, onSaved })` for `entityId` and `onUpdate`, and saved panel links still open.
- Custom collection views get a table controller of rows: `.data` is `.rows`, `onEntityClick` is `onRowClick(row, id)`, selections are ids.

`EntityFormPanel` is now `RecordForm`, `<CollectionPanel path="orders"/>` is `collection="orders"`, and `sort` is `orderBy`. The old names still work and warn once. `useInsightsPlugin` is gone; its tiles and charts are the ones above.

The [upgrade guide](/docs/upgrading/0-27-to-next/) walks through each of these with before and after.

## Also in this release

On the server side: the runtime can run behind PgBouncer in transaction mode (`DATABASE_POOLED`), signed-in reads can be served by a read replica (`DATABASE_READ_URL`), `/metrics` reports the database pool and replica lag, and a database out of connections answers `503` with `Retry-After` instead of `500`. MCP gains `aggregate_documents`. The changelog has the full list.

The panel used to be something you configured. Now it is also something you build with, and something Claude can build with on your behalf, under the same rules your users already have.
