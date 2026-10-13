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

<span class="since-badge" data-since="0.25">Since 0.25</span>

```bash
rebase generate-sdk --register
```

Besides the SDK in `generated/sdk/`, this writes two files to
`config/generated/`: a copy of `database.types.ts`, and a `register.ts` that
declares the registration:

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

They live in `config/` because your collection files are compiled twice, by the
backend (whose `tsconfig.json` includes `../config/`) and by the `config`
package's own `tsc`, and `config/` is the one directory both read. A
registration there that imported `../generated/sdk/` would pull a file from
outside `config/` into that package's compile, which TypeScript refuses. So one
registration types your functions, your cron jobs and the callbacks in your
collection files, in both compiles. It is a declaration only: the runtime does
exactly what it did before.

The flag is remembered in `rebase.json`, as `"registerDatabase": true` on the
backend app, so every later `rebase generate-sdk`, and `rebase dev` on each
collection change, keeps both files current. That holds on a fresh clone and in
CI too: the scaffold's `.gitignore` ignores `generated/` directories, and the
first `rebase generate-sdk` or `rebase dev` writes them again. A project with
no `rebase.json` keeps registering for as long as `config/generated/register.ts`
is there. To go back to untyped server-side data, remove `registerDatabase` and
delete `config/generated/`.

You can also write the registration yourself, in any file the backend compiles
(`backend/src/rebase-env.d.ts`, importing `../../generated/sdk/database.types`).
It then reaches the backend's compile only: in the `config` package's own `tsc`,
`context.data` stays the untyped object, so callbacks have to compile both ways.

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
