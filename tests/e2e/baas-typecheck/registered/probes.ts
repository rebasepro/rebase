/**
 * With a `Database` registered (see `register.ts`), every server-side data
 * surface is typed from it with no annotation at the call site: a collection
 * callback's `context.data`, the `rebase` singleton's `dataAsAdmin`, and the
 * `rebase` a function or a cron is handed.
 *
 * Each `@ts-expect-error` marks a call the registration must refuse; tsc
 * reporting one as unused means the surface went back to untyped. The
 * unmarked lines are what must keep compiling.
 */
import { defineCron, defineFunction, rebase } from "@rebasepro/server";
import type { CollectionCallbacks, RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

import type { Database } from "../src/typed-sdk/database.types";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <T extends true>(): T | undefined => undefined;

assertType<Equal<RegisteredDatabase, Database>>();

/** A collection callback: `context.data` is typed, without naming the type. */
export const callbacks: CollectionCallbacks = {
    async beforeSave({ context, values }) {
        const author = await context.data.authors.findById(1);
        // A typed row: `name` is a `string`, not `unknown`.
        const name: string | undefined = author?.name;

        // @ts-expect-error — `nmae` is not a column of authors
        await context.data.authors.find({ where: { nmae: ["==", "Ada"] } });

        // @ts-expect-error — no collection is called `autors`
        await context.data.autors.find();

        // @ts-expect-error — `name` is required on a create
        await context.data.authors.create({ salary: 1 });

        // The accessor of a snake_case slug.
        await context.data.orderItems.create({ sku: "A-1" });

        // `context.client.dataAsAdmin` is the same `Database`.
        await context.client.dataAsAdmin?.posts.find({ include: ["author"] });

        // A literal slug is typed through `collection()` as through its
        // accessor: the `my-notes` collection's rows, and its columns only.
        const note = await context.data.collection("my-notes").findById("n1");
        const body: string | null | undefined = note?.body;
        void body;
        // @ts-expect-error — `nmae` is not a column of authors
        await context.data.collection("authors").find({ where: { nmae: ["==", "Ada"] } });
        // @ts-expect-error — `sku` is required on a create of order_items
        await rebase.dataAsAdmin.collection("order_items").create({ quantity: 1 });

        // A slug the caller computes stays untyped, and so does one the
        // schema does not declare.
        const computed: string = String(values.kind);
        await context.data.collection(computed).find({ where: { anything: ["==", 1] } });
        await context.data.collection("audit_log").find({ where: { anything: ["==", 1] } });

        return { ...values, note: name };
    }
};

/** The `rebase` singleton imported anywhere server-side. */
export async function singletonProbes(): Promise<void> {
    const { data: posts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "published"] } });
    const title: string = posts[0].title;
    void title;

    // @ts-expect-error — "archived" is not one of the status values
    await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "archived"] } });

    // @ts-expect-error — `views` is a number column
    await rebase.dataAsAdmin.posts.update("p1", { views: "many" });
}

/** A function: `ctx.rebase` is typed from the registration. */
export const fn = defineFunction((app, { rebase: typed }) => {
    app.get("/n", async (c) => {
        const { data } = await typed.dataAsAdmin.tags.find();
        const label: string = data[0].label;
        // @ts-expect-error — no collection is called `tag`
        await typed.dataAsAdmin.tag.find();
        return c.json({ label });
    });
});

/** A cron: `ctx.rebase` is typed from the registration. */
export const cron = defineCron({
    name: "Typed cron",
    schedule: "0 3 * * *",
    async handler({ rebase: typed }) {
        const { data } = await typed.dataAsAdmin.orderItems.find();
        const sku: string = data[0].sku;
        // @ts-expect-error — `skuu` is not a column of order_items
        await typed.dataAsAdmin.orderItems.create({ sku, skuu: "x" });
    }
});

/**
 * A helper that takes the data object names `RebaseSdkData<RegisteredDatabase>`
 * — the type `context.data` and `rebase.dataAsAdmin` have — and stays typed.
 * (A typed data object is not an untyped one: the untyped index signature
 * would have to admit the object's own `collection` method.)
 */
const publishedCount = (data: RebaseSdkData<RegisteredDatabase>): Promise<number> | undefined =>
    data.posts.count?.({ where: { status: ["==", "published"] } });
export const helperProbes: CollectionCallbacks = {
    async afterSave({ context }) {
        await publishedCount(context.data);
        await publishedCount(rebase.dataAsAdmin);
    }
};
