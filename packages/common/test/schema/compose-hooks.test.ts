import { describe, expect, it } from "@jest/globals";
import { col, defineTable } from "@rebasepro/types";
import type { ReadQuery, TableDescriptor, TableHooks } from "@rebasepro/types";

import { createCallContext } from "../../src";
import { compileTables } from "../../src/schema/compile-tables";
import { composeTableHooks } from "../../src/schema/compose-hooks";

/**
 * `composeTableHooks` combines sets of table hooks the way the backend combines
 * its tiers, with the same rules as the legacy `composeCallbacks` — these are
 * its tests, ported hook by hook.
 */

const postsDef = defineTable("posts", {
    columns: { id: col.uuid().primaryKey(), title: col.text().notNull(), slug: col.text() },
    rls: "admin-only"
});
const [posts]: TableDescriptor[] = compileTables([postsDef]);

const base = { table: posts, path: "posts", context: createCallContext() };
const query: ReadQuery = { limit: 10 };

describe("composeTableHooks", () => {
    it("chains beforeSave: each set sees the previous one's values, results shallow-merged", async () => {
        const seen: unknown[] = [];
        const composed = composeTableHooks(
            { beforeSave: ({ values }) => { seen.push(values); return { slug: "hello" }; } },
            { beforeSave: ({ values }) => { seen.push(values); return { ...values, title: "Hello!" }; } },
            { beforeSave: ({ values }) => { seen.push(values); return {}; } }
        );

        const result = await composed.beforeSave?.({ ...base, status: "new", values: { title: "Hello" } });

        expect(result).toEqual({ title: "Hello!", slug: "hello" });
        expect(seen).toEqual([
            { title: "Hello" },
            { title: "Hello", slug: "hello" },
            { title: "Hello!", slug: "hello" }
        ]);
    });

    it("chains afterRead: each set sees the row the previous one returned", async () => {
        const composed = composeTableHooks(
            { afterRead: ({ values }) => ({ ...values, a: 1 }) },
            { afterRead: ({ values }) => ({ ...values, b: values.a }) }
        );

        expect(await composed.afterRead?.({ ...base, values: { id: 1 } })).toEqual({ id: 1, a: 1, b: 1 });
    });

    it("keeps the row when a (JavaScript) set returns nothing from afterRead or beforeSave", async () => {
        const nothing = (): undefined => undefined;
        const untyped: TableHooks = {};
        Object.assign(untyped, { afterRead: nothing, beforeSave: nothing });
        const composed = composeTableHooks(untyped, { afterRead: ({ values }) => ({ ...values, seen: true }) });

        expect(await composed.afterRead?.({ ...base, values: { id: 1 } })).toEqual({ id: 1, seen: true });
        expect(await composed.beforeSave?.({ ...base, status: "new", values: { title: "t" } })).toEqual({ title: "t" });
    });

    it("ANDs beforeQuery narrowings, every set seeing the caller's query", async () => {
        const queries: ReadQuery[] = [];
        const composed = composeTableHooks(
            {
                beforeQuery: ({ query: q }) => {
                    queries.push(q);
                    return { filter: { tenant: ["==", "t1"] }, logical: { type: "or", conditions: [] } };
                }
            },
            { beforeQuery: () => undefined },
            {
                beforeQuery: ({ query: q }) => {
                    queries.push(q);
                    return {
                        filter: { tenant: [["!=", "t2"], ["!=", "t3"]], status: ["==", "published"] },
                        logical: { type: "not", conditions: [{ column: "draft", operator: "==", value: true }] }
                    };
                }
            }
        );

        const narrowing = await composed.beforeQuery?.({ ...base, operation: "list", query });

        expect(queries).toEqual([query, query]);
        expect(narrowing).toEqual({
            filter: {
                tenant: [["==", "t1"], ["!=", "t2"], ["!=", "t3"]],
                status: ["==", "published"]
            },
            logical: {
                type: "and",
                conditions: [
                    { type: "or", conditions: [] },
                    { type: "not", conditions: [{ column: "draft", operator: "==", value: true }] }
                ]
            }
        });
    });

    it("answers an empty beforeQuery narrowing with itself, for the backend to refuse", async () => {
        const later = { beforeQuery: () => ({ filter: { a: ["==", 1] } }) } satisfies TableHooks;
        const composed = composeTableHooks({ beforeQuery: () => ({}) }, later);

        expect(await composed.beforeQuery?.({ ...base, operation: "list", query })).toEqual({});
    });

    it("vetoes a delete when any set returns false, and still runs every set", async () => {
        const ran: string[] = [];
        const composed = composeTableHooks(
            { beforeDelete: () => { ran.push("a"); return false; } },
            { beforeDelete: () => { ran.push("b"); return true; } }
        );

        expect(await composed.beforeDelete?.({ ...base, id: 1, values: {} })).toBe(false);
        expect(ran).toEqual(["a", "b"]);

        const allowed = composeTableHooks({ beforeDelete: () => true }, { beforeDelete: () => undefined });
        expect(await allowed.beforeDelete?.({ ...base, id: 1, values: {} })).not.toBe(false);
    });

    it("runs afterSave and afterDelete in order, and a throw stops the rest", async () => {
        const ran: string[] = [];
        const composed = composeTableHooks(
            { afterSave: async () => { ran.push("a"); }, afterDelete: () => { ran.push("x"); throw new Error("refused"); } },
            { afterSave: () => { ran.push("b"); }, afterDelete: () => { ran.push("y"); } }
        );

        await composed.afterSave?.({ ...base, id: 1, status: "new", values: {} });
        await expect(composed.afterDelete?.({ ...base, id: 1, values: {} })).rejects.toThrow("refused");
        expect(ran).toEqual(["a", "b", "x"]);
    });

    it("propagates a beforeSave throw as it is, without running later sets", async () => {
        const error = new Error("Title is required");
        let later = false;
        const composed = composeTableHooks(
            { beforeSave: () => { throw error; } },
            { beforeSave: ({ values }) => { later = true; return values; } }
        );

        await expect(composed.beforeSave?.({ ...base, status: "new", values: {} })).rejects.toBe(error);
        expect(later).toBe(false);
    });

    it("runs every afterSaveError even when one throws, then rethrows", async () => {
        const ran: string[] = [];
        const first = new Error("first");
        const composed = composeTableHooks(
            { afterSaveError: () => { ran.push("a"); throw first; } },
            { afterSaveError: () => { ran.push("b"); } }
        );

        await expect(composed.afterSaveError?.({ ...base, status: "new", values: {}, error: new Error("save") }))
            .rejects.toBe(first);
        expect(ran).toEqual(["a", "b"]);

        const both = composeTableHooks(
            { afterSaveError: () => { throw new Error("one"); } },
            { afterSaveError: () => { throw new Error("two"); } }
        );
        await expect(both.afterSaveError?.({ ...base, status: "new", values: {}, error: undefined }))
            .rejects.toBeInstanceOf(AggregateError);
    });

    it("has only the hooks some set has, and skips undefined sets", () => {
        const composed = composeTableHooks(undefined, { afterSave: () => undefined }, undefined);

        expect(Object.keys(composed)).toEqual(["afterSave"]);
        expect(composeTableHooks()).toEqual({});
    });

    it("calls each hook through its set, so `this` is the set", async () => {
        const set = {
            suffix: "!",
            beforeSave(this: { suffix: string }, { values }: { values: Record<string, unknown> }) {
                return { title: `${String(values.title)}${this.suffix}` };
            }
        };
        const composed = composeTableHooks(set);

        expect(await composed.beforeSave?.({ ...base, status: "new", values: { title: "Hi" } })).toEqual({ title: "Hi!" });
    });

    it("keeps the table's row and insert types, so the result is that table's `hooks`", () => {
        // Typed by the row (`InferRow<typeof table>` in a project): each set's
        // props are that row, and the composition is what `hooks` takes.
        const trim: TableHooks<{ id: string; title: string }> = {
            beforeSave: ({ values }) => ({ ...values, title: values.title?.trim() })
        };
        const stamp: TableHooks<{ id: string; title: string }> = { afterRead: ({ values }) => ({ ...values, title: values.title.toUpperCase() }) };
        const composed: TableHooks<{ id: string; title: string }> = composeTableHooks(trim, undefined, stamp);
        const table = defineTable("notes", {
            columns: { id: col.uuid().primaryKey(), title: col.text().notNull() },
            rls: "admin-only",
            hooks: composed
        });
        expect(Object.keys(composed)).toEqual(["beforeSave", "afterRead"]);
        expect(Object.keys(table.config.hooks ?? {})).toEqual(["beforeSave", "afterRead"]);
    });
});
