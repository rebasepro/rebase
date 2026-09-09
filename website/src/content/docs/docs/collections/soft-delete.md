---
title: Soft delete
sidebar_label: Soft delete
description: Turn delete into a timestamp, hide stamped rows from every read, and restore them with an ordinary update.
---

## What it changes

With `softDelete` on, a delete **stamps a column instead of removing the row**,
and every read filters the stamped rows out. Nothing else about the operation
moves: the same permission is required, `beforeDelete` can still veto it and
`afterDelete` still fires. From the caller's point of view the row was deleted;
how the table records that is this flag's business.

```typescript
import { defineCollection } from "@rebasepro/cms-types";

const invoices = defineCollection({
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    softDelete: true,
    properties: {
        reference: { name: "Reference", type: "string" },
        deletedAt: { name: "Deleted at", type: "date", admin: { readOnly: true } }
    }
});
```

`true` uses `deletedAt` (column `deleted_at`). The object form renames it:
`softDelete: { field: "archivedAt" }`.

:::caution[The column is yours to declare]
The flag says what a column *means*; it does not conjure one into existence.
A collection that turns `softDelete` on without declaring that `date` property
is refused at boot — deliberately early, because the alternative is the failure
landing on somebody trying to remove a row.
:::

Postgres only, like [search](/docs/backend/search) and
[indexes](/docs/backend/indexes).

## What a read sees

Stamped rows are hidden by default from `find`, `findById`, `count`, the
aggregates, the realtime refetch, and from this collection loaded through a
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

A **real** `DELETE` is `?hard=true` on the delete call. It needs exactly the
same permission an ordinary delete does: it is the same verb, and gating it
separately would be a second access-control surface for one operation. What it
changes is whether the row can come back. Only the literal `true` or `1` means
yes; a typo is a 400, because a caller who asked to purge and got a soft delete
believes the data is gone.

## Next Steps

- **[Defining Collections](/docs/collections)** — where `softDelete` is declared
- **[REST API](/docs/backend/api)** — the delete and query endpoints these parameters belong to
- **[Security Rules (RLS)](/docs/collections/security-rules)** — who may delete a row at all
