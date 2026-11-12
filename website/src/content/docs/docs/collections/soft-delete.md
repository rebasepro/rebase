---
title: Soft delete
sidebar_label: Soft delete
description: "softDelete on a table turns delete into a timestamp, hides stamped rows from every read, and restores them with an ordinary update."
---

## What it changes

<span class="since-badge" data-since="0.31">Since 0.31</span>

With `softDelete` on, a delete **stamps a column instead of removing the row**,
and every read filters the stamped rows out. Nothing else about the operation
moves: the same permission is required, `beforeDelete` can still veto it and
`afterDelete` still fires. From the caller's point of view the row was deleted;
how the table records that is this flag's business.

```ts
import { defineTable, col } from "@rebasepro/server/schema";

export const invoices = defineTable("invoices", {
    columns: {
        id:        col.uuid().primaryKey().defaultRandom(),
        reference: col.text().notNull(),
        deletedAt: col.timestamptz(),
    },
    softDelete: true,
    rls: "admin-only",
});
```

`true` uses the `deletedAt` column (SQL `deleted_at`). The object form names
another one: `softDelete: { field: "archivedAt" }`. The field is checked against
the table's columns by the types.

:::caution[The column is yours to declare]
The flag says what a column *means*; it does not add one. A table that turns
`softDelete` on without declaring that column, or with a column that is not a
`timestamptz`, `date` or `time`, is refused when the schema is compiled — before
anyone tries to remove a row.
:::

## What a read sees

Stamped rows are hidden by default from `find`, `findById`, `count`, the
aggregates, the realtime refetch, and from this table loaded through a
relation. That default is the point: code written before the flag existed keeps
working, and nobody has to remember to filter.

Two query parameters open it up:

| Parameter | Answers |
|-----------|---------|
| `?deleted=include` | Live rows **and** stamped ones |
| `?deleted=only` | Stamped rows alone — the trash view |

Anything else is a 400 rather than a silent fallback. `?deleted=true` quietly
hiding every deleted row would look like it worked and answer the opposite
question.

## Restoring, and really deleting

A **restore** is an ordinary update setting the field back to `null`. There is
no special verb, because there is no special state — the row never went anywhere.
Over REST it is a `PATCH` — single, `/bulk` or `_batch` — whose body sets the
field to `null`:

```bash
curl -X PATCH /api/data/invoices/7 -d '{"deletedAt": null}'
```

That update is the one that reaches a stamped row. Any other edit of it answers
`404`, as the row does to every default read; restore it first.

The reverse is not an update. Setting the field to a value is refused with `400`
`FIELD_NOT_WRITABLE` — delete the row instead — so the `delete` permission,
`beforeDelete` and `afterDelete` always apply to it. An upsert may create a row
that is already stamped, but never stamps one that was stored.

Nor does an upsert write into a row in the trash: when its key belongs to a
stamped row, it is refused with `409` `ROW_IN_TRASH` and nothing is written.
Restore the row first, or purge it with `?hard=true` and upsert again.

A delete through a many-to-many path, like `DELETE /api/data/posts/1/tags/5`,
removes post 1's link to the tag. It does not soft-delete the tag, which other
posts still use.

A **real** `DELETE` is `?hard=true` on the delete call. It needs exactly the
same permission an ordinary delete does: it is the same verb, and gating it
separately would be a second access-control surface for one operation. What it
changes is whether the row can come back. Only the literal `true` or `1` means
yes; a typo is a 400, because a caller who asked to purge and got a soft delete
believes the data is gone.

## From the SDK

The typed client reaches the trash through `trash` on each table. It sends
the requests above: `?deleted=only` on the reads, the update to `null` for a
restore, and `?hard=true` for a purge.

```typescript
const trashed = await client.data.invoices.trash.find({ limit: 20 });
const howMany = await client.data.invoices.trash.count();

await client.data.invoices.trash.restore(7);       // PATCH { deletedAt: null }
await client.data.invoices.trash.restoreMany([8, 9]);

await client.data.invoices.trash.purge(7);         // DELETE ?hard=true
await client.data.invoices.trash.purgeMany([8, 9]);
```

`trash.find` and `trash.count` take the same parameters as `find` and `count`.
A restore sets `deletedAt` unless you name the field: a table declared
with `softDelete: { field: "archivedAt" }` restores with
`trash.restore(7, { field: "archivedAt" })`. The client cannot read the field
name from the server.

Use `trash` on a table that declares `softDelete`. On one that does not,
the server ignores `?deleted=`, so `trash.find` returns the live rows and
`trash.purge` is an ordinary delete.

Server code has the same `trash`: `context.data.invoices.trash` in a hook,
and `rebase.data.invoices.trash` in a function or a cron. It reads and purges
through the driver, with the caller's privileges, as the rest of
[`context.data`](/docs/collections/context-data-api) does.

With [offline](/docs/sdk/offline) enabled, the trash is never cached and nothing
in it is queued. Each call needs the server, and fails with the `OFFLINE` error
without it. A restored row joins the local database, and a purged one leaves it.

## Next Steps

- **[Tables](/docs/schema/)** — where `softDelete` is declared
- **[REST API](/docs/backend/api)** — the delete and query endpoints these parameters belong to
- **[Row-level security](/docs/collections/security-rules/)** — who may delete a row at all
