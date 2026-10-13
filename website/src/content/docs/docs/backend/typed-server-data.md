---
title: Typed server-side data
sidebar_label: Typed server-side data
description: "Register your generated Database type once, and context.data, rebase.dataAsAdmin and the rebase a function or cron receives are typed from it: rows, filters, sorts, includes and write inputs."
---

The browser client is typed by passing your generated `Database` to
`createRebaseClient<Database>()` (see [Typed SDK Generation](/docs/sdk#typed-sdk-generation)).
The server-side data surfaces have no such call to pass it to:

- `context.data` in a [collection callback](/docs/collections/callbacks),
- `rebase.dataAsAdmin` on the `rebase` singleton,
- the `rebase` a [custom function](/docs/backend/custom-functions) or a
  [cron job](/docs/backend/cron-jobs) is handed.

So you tell TypeScript once, for the whole project, which `Database` they serve.
Until you do, they stay untyped: any collection by any name, rows as
`Record<string, unknown>`. Nothing changes for a project that registers nothing.

## Register the `Database`

Generate the types (`rebase dev` does it for you on every collection change, or
run `rebase generate-sdk`), then add one file to the backend:

```ts
// backend/src/rebase-env.d.ts
import type { Database } from "../../generated/sdk/database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

The file only has to be in the TypeScript program; nothing imports it. The
backend's `tsconfig.json` includes `src/`, `functions/`, `crons/` and
`../config/`, so one registration types your functions, your cron jobs and the
callbacks in your collection files. It is a declaration only: the runtime does
exactly what it did before.

A registration reaches the TypeScript program it is in, and no other. Your
collection files are also compiled by the `config` package's own `tsc`, which
does not read `backend/src/`, so in that compile `context.data` is still the
untyped object. Write callbacks that compile both ways: the backend's compile is
the one that catches a misspelt collection or column, and a value you need as a
specific type you check where you use it, as you would without types.

## What it types

```ts
// config/collections/orders.ts — a callback
callbacks: {
    async beforeSave({ context, values }) {
        const { data } = await context.data.customers.find({
            where: { email: ["==", "ada@example.com"] },  // `email` is a column of customers
        });
        data[0]?.email;                      // completes from the customers Row

        await context.data.customer.find();  // error: no collection `customer`
        return values;
    }
}
```

```ts
// backend/functions/stats.ts
import { defineFunction } from "@rebasepro/server/functions";

export default defineFunction((app, { rebase }) => {
    app.get("/", async (c) => {
        const { data } = await rebase.dataAsAdmin.orders.find({
            where: { status: ["==", "paid"] },   // `status` and its values are checked
        });
        return c.json({ paid: data.length });
    });
});
```

```ts
// backend/crons/cleanup.ts
import { defineCron } from "@rebasepro/server";

export default defineCron({
    name: "Cleanup",
    schedule: "0 3 * * *",
    async handler({ rebase }) {
        // `create` takes the collection's Insert type: required columns are required.
        await rebase.dataAsAdmin.auditLog.create({ action: "cleanup" });
    },
});
```

Each accessor is typed the way the browser client's is: `find`, `findById`
and `listen` return the collection's `Row`; `where` and `orderBy` are
keyed by its columns; `include` names its relations; `create` takes its
`Insert` and `update` its `Update`. Accessors are the camelCase names from the
generated file (`order_items` is `orderItems`).
The server resolves those names through the registered collections, so a
`my-notes` collection stored in a `notes` table is `context.data.myNotes`.

`collection(slug)` with a slug the `Database` declares is typed the same way:
`context.data.collection("my-notes")` is `context.data.myNotes`. A slug you
compute at runtime, or one the schema does not declare, gets the untyped
client.

## One function, without the registration

`defineFunction` and `defineCron` take the type as an argument too, which wins
over the registration. Use it to type a single file, or to try typed data before
registering:

```ts
import type { Database } from "../../generated/sdk/database.types";

export default defineFunction<Database>((app, { rebase }) => {
    // rebase.dataAsAdmin is typed from Database here
});
```

## Helpers that take the data object

A helper that receives `context.data` or `rebase.dataAsAdmin` names the
registered type, so it stays typed and accepts both:

```ts
import type { RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

export async function paidOrders(data: RebaseSdkData<RegisteredDatabase>) {
    return data.orders.find({ where: { status: ["==", "paid"] } });
}
```

A helper declared with a bare `RebaseSdkData` keeps the untyped type, and a
typed data object is not assignable to it. Change the parameter as above when
you register.
