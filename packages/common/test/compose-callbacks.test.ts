import { describe, expect, it } from "@jest/globals";
import type { CollectionCallbacks, CollectionConfig, ReadQuery } from "@rebasepro/types";
import { composeCallbacks, createCallContext } from "../src";

/**
 * `composeCallbacks` combines sets the way the backend combines its global,
 * collection and property tiers. These pin each hook's rule on its own; the
 * parity test in server-postgres (`compose-callbacks-parity.test.ts`) runs the
 * same sets through the real driver both ways and compares.
 */

const posts: CollectionConfig = {
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: { title: { name: "Title", type: "string" } }
};

const base = { collection: posts, path: "posts", context: createCallContext() };
const query: ReadQuery = { limit: 10 };

describe("composeCallbacks", () => {
    it("chains beforeSave: each set sees the previous one's values, results shallow-merged", async () => {
        const seen: unknown[] = [];
        const composed = composeCallbacks(
            { beforeSave: ({ values }) => { seen.push(values); return { slug: "hello" }; } },
            { beforeSave: ({ values }) => { seen.push(values); return { ...values, title: "Hello!" }; } },
            { beforeSave: ({ values }) => { seen.push(values); return {}; } }
        );

        const result = await composed.beforeSave!({ ...base, status: "new", values: { title: "Hello" } });

        expect(result).toEqual({ title: "Hello!", slug: "hello" });
        expect(seen).toEqual([
            { title: "Hello" },
            { title: "Hello", slug: "hello" },
            { title: "Hello!", slug: "hello" }
        ]);
    });

    it("chains afterRead: each set sees the row the previous one returned", async () => {
        const composed = composeCallbacks(
            { afterRead: ({ row }) => ({ ...row, a: 1 }) },
            { afterRead: ({ row }) => ({ ...row, b: row.a }) }
        );

        expect(await composed.afterRead!({ ...base, row: { id: 1 } })).toEqual({ id: 1, a: 1, b: 1 });
    });

    it("ANDs beforeQuery narrowings, every set seeing the caller's query", async () => {
        const queries: ReadQuery[] = [];
        const composed = composeCallbacks(
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

        const narrowing = await composed.beforeQuery!({ ...base, operation: "list", query });

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
        const later = { beforeQuery: () => ({ filter: { a: ["==", 1] } }) } satisfies CollectionCallbacks;
        const composed = composeCallbacks({ beforeQuery: () => ({}) }, later);

        expect(await composed.beforeQuery!({ ...base, operation: "list", query })).toEqual({});
    });

    it("vetoes a delete when any set returns false, and still runs every set", async () => {
        const ran: string[] = [];
        const composed = composeCallbacks(
            { beforeDelete: () => { ran.push("a"); return false; } },
            { beforeDelete: () => { ran.push("b"); return true; } }
        );

        expect(await composed.beforeDelete!({ ...base, id: 1, row: {} })).toBe(false);
        expect(ran).toEqual(["a", "b"]);

        const allowed = composeCallbacks({ beforeDelete: () => true }, { beforeDelete: () => undefined });
        expect(await allowed.beforeDelete!({ ...base, id: 1, row: {} })).not.toBe(false);
    });

    it("runs afterSave and afterDelete in order, and a throw stops the rest", async () => {
        const ran: string[] = [];
        const composed = composeCallbacks(
            { afterSave: async () => { ran.push("a"); }, afterDelete: () => { ran.push("x"); throw new Error("refused"); } },
            { afterSave: () => { ran.push("b"); }, afterDelete: () => { ran.push("y"); } }
        );

        await composed.afterSave!({ ...base, id: 1, status: "new", values: {} });
        await expect(composed.afterDelete!({ ...base, id: 1, row: {} })).rejects.toThrow("refused");
        expect(ran).toEqual(["a", "b", "x"]);
    });

    it("propagates a beforeSave throw as it is, without running later sets", async () => {
        const error = new Error("Title is required");
        let later = false;
        const composed = composeCallbacks(
            { beforeSave: () => { throw error; } },
            { beforeSave: ({ values }) => { later = true; return values; } }
        );

        await expect(composed.beforeSave!({ ...base, status: "new", values: {} })).rejects.toBe(error);
        expect(later).toBe(false);
    });

    it("runs every afterSaveError even when one throws, then rethrows", async () => {
        const ran: string[] = [];
        const first = new Error("first");
        const composed = composeCallbacks(
            { afterSaveError: () => { ran.push("a"); throw first; } },
            { afterSaveError: () => { ran.push("b"); } }
        );

        await expect(composed.afterSaveError!({ ...base, status: "new", values: {}, error: new Error("save") }))
            .rejects.toBe(first);
        expect(ran).toEqual(["a", "b"]);

        const both = composeCallbacks(
            { afterSaveError: () => { throw new Error("one"); } },
            { afterSaveError: () => { throw new Error("two"); } }
        );
        await expect(both.afterSaveError!({ ...base, status: "new", values: {}, error: undefined }))
            .rejects.toBeInstanceOf(AggregateError);
    });

    it("has only the hooks some set has, and skips undefined sets", () => {
        const composed = composeCallbacks(undefined, { afterSave: () => undefined }, undefined);

        expect(Object.keys(composed)).toEqual(["afterSave"]);
        expect(composeCallbacks()).toEqual({});
    });

    it("calls each hook through its set, so `this` is the set", async () => {
        const set = {
            suffix: "!",
            beforeSave(this: { suffix: string }, { values }: { values: Record<string, unknown> }) {
                return { title: `${String(values.title)}${this.suffix}` };
            }
        };
        const composed = composeCallbacks(set);

        expect(await composed.beforeSave!({ ...base, status: "new", values: { title: "Hi" } })).toEqual({ title: "Hi!" });
    });
});
