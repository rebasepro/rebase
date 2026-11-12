---
title: Typed server-side data
sidebar_label: Typed server-side data
description: "Register your generated Database type once, and context.data, rebase.dataAsAdmin and the rebase a function or cron receives are typed from it: rows, filters, sorts, includes and write inputs."
---

The browser client is typed by passing your generated `Database` to
`createRebaseClient<Database>()` (see [Typed SDK Generation](/docs/sdk#typed-sdk-generation)).
The server-side data surfaces have no such call to pass it to:

- `context.data` in a [table hook](/docs/collections/callbacks),
- `rebase.dataAsAdmin` on the `rebase` singleton,
- the `rebase` a [custom function](/docs/backend/custom-functions) or a
  [cron job](/docs/backend/cron-jobs) is handed.

So you tell TypeScript once, for the whole project, which `Database` they serve.
Until you do, they stay untyped: any table by any name, rows as
`Record<string, unknown>`. Nothing changes for a project that registers nothing.

There are two ways to register: the generated `Database`, which is exact, or
your `backend/schema` module itself, which needs no codegen run.

## Register the generated `Database`

<span class="since-badge" data-since="0.31">Since 0.31</span>

```bash
rebase generate-sdk --register
```

Besides the SDK in `generated/sdk/`, this writes two files to
`backend/generated/`: a copy of `database.types.ts`, and a `register.ts` that
declares the registration:

```ts
import type { Database } from "./database.types";

declare module "@rebasepro/types" {
    interface Register {
        database: Database;
    }
}
```

They live in `backend/` because that is the program the hooks, functions and
crons they type are compiled in, and the types are copied in beside the
registration rather than imported from `generated/sdk/`, which is outside the
backend's `rootDir`. It is a declaration only: the runtime does exactly what
it did before. `--register` refuses to overwrite a `register.ts` it did not
write.

The flag is remembered in `rebase.json`, as `"registerDatabase": true` on the
backend app, so every later `rebase generate-sdk`, and `rebase dev` on each
change under `backend/schema/`, keeps both files current. The scaffold's
`.gitignore` ignores `generated/` directories, so a fresh clone has neither
file until something writes them again. `rebase build` (and
`rebase cloud deploy`, which builds the same bundle) writes them from the
tables before it compiles, so a CI job that runs `rebase build` on a fresh
clone compiles typed hooks. A CI step that compiles the backend some other way
(`tsc`, `pnpm build`) still needs `rebase generate-sdk` first, or hooks that
read typed rows compile against the untyped `context.data` and fail. A project
with no `rebase.json` keeps registering for as long as
`backend/generated/register.ts` is there. To go back to untyped server-side
data, remove `registerDatabase` and delete `backend/generated/`.

## Register the schema, with no codegen

<span class="since-badge" data-since="0.31">Since 0.31</span>

A project that has not generated anything registers its schema module instead,
and is typed straight from its `defineTable`s:

```ts
// backend/rebase-env.d.ts
declare module "@rebasepro/types" {
    interface Register {
        tables: typeof import("./schema");
    }
}
```

Every export of the module that is a table or a view is typed under its
accessor (`orderItems` for `order_items`), with the `Row`, `Insert` and `Update`
the generator would emit — exact for every declared column. It is looser on
relations, because a relation's target is behind an untyped thunk: a derived
foreign key is `string | number`, an included row is `Record<string, unknown>`,
and a nested `include` is unchecked. The generated `Database` is exact for all
of these, and wins when both are registered. [Inferred
types](/docs/schema/types/) covers what `DatabaseOf` can and cannot know.

One surface is typed only from the generated `Database`: `context.data` inside
the table hooks of that same schema, because typing a schema's hooks from the
schema is a cycle TypeScript refuses.

## What it types

```ts
// backend/schema/orders.ts — a hook
import { defineTable, col } from "@rebasepro/server/schema";

export const orders = defineTable("orders", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        total: col.numeric().notNull(),
    },
    rls: "admin-only",
    hooks: {
        async beforeSave({ context, values }) {
            const { data } = await context.data.customers.find({
                where: { email: ["==", "ada@example.com"] },  // `email` is a column of customers
            });
            data[0]?.email;                      // completes from the customers Row
            return values;
        },
    },
});
```

With the generated `Database` registered, `context.data.customer` (no such
table) in that hook is a type error.

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
        // `create` takes the table's Insert type: required columns are required.
        await rebase.dataAsAdmin.auditLog.create({ action: "cleanup" });
    },
});
```

Each accessor is typed the way the browser client's is: `find`, `findById`
and `listen` return the table's `Row`; `where` and `orderBy` are
keyed by its columns; `include` names its relations; `create` takes its
`Insert` and `update` its `Update`. Accessors are the camelCase names from the
generated file (`order_items` is `orderItems`).
The server resolves those names through the served tables, so a table whose
slug is `my-notes` (stored in a `notes` table) is `context.data.myNotes`.

`table(slug)` with a slug the `Database` declares is typed the same way:
`context.data.table("my-notes")` is `context.data.myNotes`. A slug you
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
