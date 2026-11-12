/**
 * With a schema module registered on `Register.tables` (see `register.ts`),
 * the data surfaces are typed from the `defineTable`s themselves — no
 * generated file: a call context's `data`, the `rebase` singleton, a
 * function's and a cron's `rebase`, and a client created over the registered
 * database.
 *
 * Each `@ts-expect-error` marks a call the registration must refuse; tsc
 * reporting one as unused means the surface went back to untyped.
 */
import { createRebaseClient } from "@rebasepro/client";
import { createCallContext, defineCron, defineFunction, rebase } from "@rebasepro/server";
import type { DatabaseOf, RegisteredDatabase } from "@rebasepro/types";

import type * as schema from "../src/typed-sdk/schema";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <T extends true>(): T | undefined => undefined;

assertType<Equal<RegisteredDatabase, DatabaseOf<typeof schema>>>();

/**
 * A call context — what a script or a test builds to call server code — is
 * typed from the registration: rows, filters, creates, includes, slugs.
 *
 * (A table's own hooks are typed from a generated `Database` only: typing a
 * schema's hooks from that same schema is a cycle TypeScript refuses, so with
 * `Register.tables` alone their `context.data` is untyped.)
 */
export async function callContextProbes(): Promise<void> {
    const context = createCallContext();
    const author = await context.data.authors.findById(1);
    const name: string | undefined = author?.name;
    void name;

    // @ts-expect-error — `nmae` is not a column of authors
    await context.data.authors.find({ where: { nmae: ["==", "Ada"] } });

    // @ts-expect-error — no table is called `autors`
    await context.data.autors.find();

    // @ts-expect-error — `name` is required on a create
    await context.data.authors.create({ salary: 1 });

    // @ts-expect-error — `passwordHash` is private: off every type
    await context.data.authors.find({ where: { passwordHash: ["==", "x"] } });

    // The accessor of a snake_case slug, and a kebab one by its slug.
    await context.data.orderItems.create({ sku: "A-1" });
    const note = await context.data.table("my-notes").findById("n1");
    const body: string | null | undefined = note?.body;
    void body;

    // `include` names relations that exist.
    await context.client.dataAsAdmin?.posts.find({ include: ["author"] });
    // @ts-expect-error — `authr` is not a relation of posts
    await context.client.dataAsAdmin?.posts.find({ include: ["authr"] });
}

/** The `rebase` singleton imported anywhere server-side. */
export async function singletonProbes(): Promise<void> {
    const { data: posts } = await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "published"] } });
    const title: string = posts[0].title;
    void title;

    // @ts-expect-error — "archived" is not one of the status values
    await rebase.dataAsAdmin.posts.find({ where: { status: ["==", "archived"] } });

    // @ts-expect-error — `views` is an integer column
    await rebase.dataAsAdmin.posts.update("p1", { views: "many" });

    // A required link is named on a create under either of its names.
    await rebase.dataAsAdmin.comments.create({ body: "b", post: "p1" });
    await rebase.dataAsAdmin.comments.create({ body: "b", postId: "p1" });
    // @ts-expect-error — the post must be named
    await rebase.dataAsAdmin.comments.create({ body: "b" });
    // @ts-expect-error — `reviewerId` is read-only, and the link goes with it
    await rebase.dataAsAdmin.comments.update(1, { reviewer: 2 });
}

/** A function and a cron: `rebase` is typed from the registration. */
export const fn = defineFunction((app, { rebase: typed }) => {
    app.get("/n", async (c) => {
        const { data } = await typed.dataAsAdmin.tags.find();
        const label: string = data[0].label;
        // @ts-expect-error — no table is called `tag`
        await typed.dataAsAdmin.tag.find();
        return c.json({ label });
    });
});

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
 * The client: `client.data.<accessor>` typed from the same registration, with
 * no generated `Database` or `tablesDictionary` (the client derives a
 * snake_case slug from the accessor; a kebab slug is reached by its slug).
 */
export async function clientProbes(): Promise<void> {
    const client = createRebaseClient<RegisteredDatabase>({ baseUrl: "https://api.example.com", realtime: false });
    const { data } = await client.data.posts.find({ where: { status: ["==", "draft"] } });
    const subtitle: string | null | undefined = data[0]?.subtitle;
    void subtitle;
    // @ts-expect-error — `title` is required on a create
    await client.data.posts.create({ subtitle: "s", author: 1 });
    // @ts-expect-error — a view-less table still refuses an unknown column
    await client.data.tags.create({ label: "l", colour: "red" });
    await client.data.table("my-notes").create({ id: "n1", body: "b" });
}
