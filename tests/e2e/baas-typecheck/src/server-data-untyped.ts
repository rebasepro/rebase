/**
 * A project that registers no `Database` keeps untyped server-side data,
 * exactly as before `Register` existed: any collection by any name, open rows,
 * no column checks. The registered half is `../registered/` — its own program,
 * because a module augmentation reaches every file of the program it is in.
 *
 * Nothing here may need a cast or a type argument: this is what an existing
 * project's functions, crons and callbacks already look like.
 */
import { defineCron, defineFunction, rebase } from "@rebasepro/server";
import type { CollectionCallbacks, RebaseSdkData, RegisteredDatabase } from "@rebasepro/types";

import type { Database } from "./typed-sdk/database.types";

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const assertType = <T extends true>(): T | undefined => undefined;

assertType<Equal<RegisteredDatabase, unknown>>();

/** A callback's `context.data` is the untyped data object it always was. */
export const callbacks: CollectionCallbacks = {
    async beforeSave({ context, values }) {
        assertType<Equal<typeof context.data, RebaseSdkData>>();
        const { data: rows } = await context.data.anyCollection.find({ where: { anyColumn: ["==", 1] } });
        const open: Record<string, unknown> = rows[0];
        await context.data.collection("whatever").create({ whatever: true });
        await context.client.dataAsAdmin?.otherCollection.update("1", { field: "x" });
        return { ...values, seen: open.anyColumn };
    }
};

export async function singletonProbes(): Promise<void> {
    const { data } = await rebase.dataAsAdmin.sessions.find({ where: { expired: ["==", true] } });
    for (const session of data) {
        await rebase.dataAsAdmin.sessions.delete(session.id as string);
    }
}

export const fn = defineFunction((app, { rebase: ctxRebase }) => {
    app.get("/n", async (c) => {
        const row = await ctxRebase.dataAsAdmin.anything.findById("1");
        return c.json({ value: row?.value ?? null });
    });
});

export const cron = defineCron({
    name: "Untyped cron",
    schedule: "0 3 * * *",
    async handler({ rebase: ctxRebase, log }) {
        const n = await ctxRebase.dataAsAdmin.jobs.count?.();
        log(`jobs: ${n}`);
    }
});

/**
 * Without a registration, one function or cron can still name its own
 * `Database`: the type argument types that file alone.
 */
export const typedFn = defineFunction<Database>((app, { rebase: typed }) => {
    app.get("/t", async (c) => {
        const { data } = await typed.dataAsAdmin.tags.find();
        const label: string = data[0].label;
        // @ts-expect-error — no collection is called `tag`
        await typed.dataAsAdmin.tag.find();
        return c.json({ label });
    });
});

export const typedCron = defineCron<Database>({
    name: "Typed cron",
    schedule: "0 3 * * *",
    async handler({ rebase: typed }) {
        // @ts-expect-error — `sku` is required on a create
        await typed.dataAsAdmin.orderItems.create({ quantity: 1 });
    }
});
