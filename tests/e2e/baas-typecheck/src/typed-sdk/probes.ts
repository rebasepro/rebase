/**
 * What a typed client refuses and accepts, against a generated `Database`.
 *
 * Every `@ts-expect-error` below marks a call the server refuses (or one that is
 * silently wrong at runtime): tsc reporting it as unused means the types have
 * started accepting it again. The unmarked calls are the other half — what the
 * server accepts must compile, or developers cast around the SDK.
 *
 * One bad key per call: two in one literal collapse into a single error, and
 * the directive cannot say which of them it caught.
 *
 * `database.types.ts` is the codegen's output for `collections.ts`, kept in
 * step by `packages/codegen/test/baas-typecheck-fixture.test.ts`.
 */
import { createRebaseClient } from "@rebasepro/client";

import { collectionsDictionary, type Database } from "./database.types";

const client = createRebaseClient<Database>({
    baseUrl: "https://api.example.com",
    collections: collectionsDictionary,
    realtime: false
});

/**
 * `batch()` names a collection the way `client.data.<accessor>` does, and its
 * values are the collection's own `Insert` / `Update`.
 */
export async function batchProbes(): Promise<void> {
    // The accessor of a snake_case slug: the client sends `order_items`.
    await client.batch([{ op: "create", collection: "orderItems", values: { sku: "A-1" } }]);

    // A backward reference stands in for a value the server will know.
    await client.batch([
        { op: "create", collection: "authors", values: { name: "Ada" }, ref: "author" },
        { op: "create", collection: "posts", values: { title: "t", authorId: { $ref: "author.id" } } }
    ]);

    // A field operation on an update.
    await client.batch([{ op: "update", collection: "orderItems", id: 1, values: { quantity: { $inc: 1 } } }]);

    await client.batch([
        // @ts-expect-error — not a column of order_items (VALIDATION_UNKNOWN_FIELDS)
        { op: "create", collection: "orderItems", values: { sku: "A-1", skuu: "x" } }
    ]);

    await client.batch([
        // @ts-expect-error — `sku` is required on a create
        { op: "create", collection: "orderItems", values: { quantity: 1 } }
    ]);

    await client.batch([
        // @ts-expect-error — not a column of order_items, on an update either
        { op: "update", collection: "orderItems", id: 1, values: { skuu: "x" } }
    ]);
}
