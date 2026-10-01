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

/**
 * A grouped aggregate is paged: `offset` is a parameter, and the result says
 * whether the groups were cut off.
 */
export async function aggregateProbes(): Promise<boolean> {
    const byStatus = await client.data.posts.aggregate({
        select: [{ fn: "count" }],
        groupBy: ["status"],
        limit: 50,
        offset: 50
    });
    const rows: Record<string, unknown>[] = byStatus;
    return rows.length > 0 && byStatus.meta?.hasMore === true;
}

const posts = client.data.posts;

/** SDK-24: a field nobody may write (`access: { write: [] }`) is not in Insert or Update. */
export async function neverWritableProbes(): Promise<void> {
    // @ts-expect-error — `computed` is never writable (VALIDATION_EXCLUDED_FIELDS)
    await client.data.authors.create({ name: "a", computed: "x" });
    // @ts-expect-error — nor on an update
    await client.data.authors.update(1, { computed: "x" });
    // A field writable by some role stays: the server judges the role.
    await client.data.authors.update(1, { salary: 1 });
}

/** SDK-6: a column that is not required can be cleared with `null`. */
export async function nullableProbes(): Promise<void> {
    await posts.update("p1", { subtitle: null });
    await posts.update("p1", { authorId: null });
    await posts.create({ title: "t", publishedAt: null });
    // @ts-expect-error — `title` is required; null is not one
    await posts.create({ title: null });
    // @ts-expect-error — nor can an update clear it
    await posts.update("p1", { title: null });
}

/** SDK-7: the to-many relations the server writes are writable, with their junction payload. */
export async function toManyWriteProbes(): Promise<number | null | undefined> {
    await posts.create({ title: "t", tags: ["tag-uuid"] });
    await posts.update("p1", { tags: [{ id: "tag-uuid" }] });
    await posts.update("p1", { tags: [{ id: "tag-uuid", _pivot: { position: 2 } }] });
    await client.data.authors.update(1, { posts: ["p1"] });
    // @ts-expect-error — a tag's id is a string
    await posts.create({ title: "t", tags: [1] });
    // @ts-expect-error — not a column of the junction
    await posts.update("p1", { tags: [{ id: "tag-uuid", _pivot: { positon: 2 } }] });
    // A read serves the payload on each target.
    const { data } = await posts.find({ include: ["tags"] });
    return data[0]?.tags?.[0]?._pivot?.position;
}

/** SDK-10: `returning: false` resolves to no row, so using one is a compile error. */
export async function returningProbes(): Promise<void> {
    const created = await posts.create({ title: "t" }, undefined, { returning: false });
    // @ts-expect-error — the server sent no row back
    void created.id;
    const updated = await posts.update("p1", { title: "t" }, { returning: false });
    // @ts-expect-error — nor here
    void updated.id;
    const written = await posts.create({ title: "t" });
    void written.id;
}

/** SDK-13: a typed client knows its collections. */
export function accessorProbes(): void {
    // @ts-expect-error — no such collection (UNKNOWN_COLLECTION)
    void client.data.nopeCollection;
    void client.data.collection("posts");
}

/** SDK-19: a collection reached by slug is typed, whatever the slug's spelling. */
export async function slugProbes(): Promise<string> {
    // Each of these is `unknown` — a compile error to assign — on an untyped row.
    const items = await client.data.collection("order_items").find();
    const sku: string = items.data[0].sku;
    const notes = await client.data.collection("my-notes").find();
    const body: string | null | undefined = notes.data[0].body;
    const top = await client.collection("order_items").find();
    const topSku: string = top.data[0].sku;
    return sku + body + topSku;
}

/** SDK-9: `include` names the collection's relations, at every level. */
export async function includeProbes(): Promise<void> {
    await posts.find({ include: ["author", "tags"] });
    await posts.find({ include: ["author.posts"] });
    await posts.find({ include: { tags: { limit: 5 }, author: { include: { posts: true } } } });
    await posts.include("author").where("views", ">", 1).find();
    await posts.where("views", ">", 1).include("tags").find();
    // @ts-expect-error — not a relation of posts (UNKNOWN_RELATION)
    await posts.find({ include: ["authr"] });
    // @ts-expect-error — nor through the builder
    posts.include("authr");
    // @ts-expect-error — nor after another builder step
    posts.where("views", ">", 1).include("authr");
    // @ts-expect-error — nested: not a relation of authors
    await posts.find({ include: { author: { include: { postz: true } } } });
}
