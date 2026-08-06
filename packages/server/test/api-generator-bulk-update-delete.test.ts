import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * `PATCH /<collection>/bulk` and `POST /<collection>/bulk/delete`.
 *
 * The audit that produced these noted that an ETL job could insert 1000 rows in
 * one transaction and then had to delete them one HTTP request at a time —
 * `createMany` existed with no counterpart on either side.
 *
 * The shapes under test are the ones that were decided rather than inherited:
 * `{ id, data }` entries instead of flat rows (a flat row on a table keyed on a
 * `sku` cannot say whether a column is the address or a value), ids instead of a
 * filter (a mistyped condition that empties a table is not reviewable at the
 * call site), and a POST for delete instead of a DELETE body (proxies drop
 * those, and several OpenAPI generators ignore them — a generated client would
 * send no ids, and deleting nothing is the *good* outcome of that).
 */
describe("bulk update and delete routes", () => {
    let driver: jest.Mocked<DataDriver>;
    let updated: { path: string; updates: { id: string | number; values: Record<string, unknown> }[] }[];
    let deleted: { path: string; ids: (string | number)[] }[];

    function harness(overrides?: Partial<DataDriver>) {
        updated = [];
        deleted = [];
        driver = {
            key: "postgres",
            initialised: true,
            admin: {} as never,
            async updateMany(props: never) {
                const p = props as unknown as { path: string; updates: { id: string | number; values: Record<string, unknown> }[] };
                updated.push(p);
                return p.updates.map(u => ({ id: u.id, ...u.values }));
            },
            async deleteMany(props: never) {
                const p = props as unknown as { path: string; ids: (string | number)[] };
                deleted.push(p);
            },
            ...overrides
        } as unknown as jest.Mocked<DataDriver>;

        const collections = [{
            slug: "posts", name: "Posts", singularName: "Post",
            properties: { title: { name: "Title", type: "string" } }
        }] as unknown as CollectionConfig[];

        const app = new Hono();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", driver);
            c.set("user", { uid: "user-1" });
            await next();
        });
        app.route("/", new RestApiGenerator(collections, driver, undefined, 3).generateRoutes());
        return app;
    }

    const patchBulk = (app: Hono, body: unknown) =>
        app.request("/posts/bulk", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

    const deleteBulk = (app: Hono, body: unknown) =>
        app.request("/posts/bulk/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body)
        });

    describe("PATCH /posts/bulk", () => {
        it("updates every entry in one driver call", async () => {
            const app = harness();
            const res = await patchBulk(app, {
                updates: [
                    { id: "p1", data: { title: "one" } },
                    { id: "p2", data: { title: "two" } }
                ]
            });

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({
                data: [{ id: "p1", title: "one" }, { id: "p2", title: "two" }],
                meta: { written: 2 }
            });
            // One call, not one per row — the whole point of the endpoint.
            expect(updated).toHaveLength(1);
            expect(updated[0].updates).toEqual([
                { id: "p1", values: { title: "one" } },
                { id: "p2", values: { title: "two" } }
            ]);
        });

        it("rejects an entry with no id", async () => {
            const app = harness();
            const res = await patchBulk(app, { updates: [{ data: { title: "x" } }] });
            expect(res.status).toBe(400);
            expect((await res.json()).error.message).toContain("missing `id`");
            expect(updated).toHaveLength(0);
        });

        it("rejects an entry whose data is not an object", async () => {
            const app = harness();
            const res = await patchBulk(app, { updates: [{ id: "p1", data: "nope" }] });
            expect(res.status).toBe(400);
            expect(updated).toHaveLength(0);
        });

        it("rejects an unknown field before opening the transaction", async () => {
            // Named by row index: one bad field in ten thousand rows should not
            // be found by rolling the other 9,999 back.
            const app = harness();
            const res = await patchBulk(app, {
                updates: [{ id: "p1", data: { title: "ok" } }, { id: "p2", data: { nope: 1 } }]
            });
            expect(res.status).toBe(400);
            expect(updated).toHaveLength(0);
        });

        it("enforces the row cap", async () => {
            const app = harness();
            const res = await patchBulk(app, {
                updates: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, data: { title: "x" } }))
            });
            expect(res.status).toBe(400);
            expect((await res.json()).error.code).toBe("BULK_TOO_LARGE");
        });

        it("reports BULK_UNSUPPORTED rather than looping single writes", async () => {
            const app = harness({ updateMany: undefined });
            const res = await patchBulk(app, { updates: [{ id: "p1", data: { title: "x" } }] });
            expect(res.status).toBe(400);
            expect((await res.json()).error.code).toBe("BULK_UNSUPPORTED");
        });

        it("treats an empty list as a no-op", async () => {
            const app = harness();
            const res = await patchBulk(app, { updates: [] });
            expect(res.status).toBe(200);
            expect(updated).toHaveLength(0);
        });

        it("does not shadow PATCH /posts/:id", async () => {
            // `bulk` is registered first so it is never read as an id, and the
            // id route must still work for everything else.
            const app = harness({
                fetchOne: (async () => ({ id: "p9", title: "old" })) as never,
                save: (async ({ values }: { values: Record<string, unknown> }) => ({ id: "p9", ...values })) as never
            });
            const res = await app.request("/posts/p9", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "new" })
            });
            expect(res.status).toBe(200);
            expect(updated).toHaveLength(0);
        });
    });

    describe("POST /posts/bulk/delete", () => {
        it("deletes every id in one driver call", async () => {
            const app = harness();
            const res = await deleteBulk(app, { ids: ["p1", "p2", 3] });

            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ meta: { deleted: 3 } });
            expect(deleted).toHaveLength(1);
            expect(deleted[0].ids).toEqual(["p1", "p2", 3]);
        });

        it("rejects ids that are neither strings nor numbers", async () => {
            // An object here is almost always a row the caller meant to map over
            // — accepting it would stringify to "[object Object]" and delete
            // nothing, silently.
            const app = harness();
            const res = await deleteBulk(app, { ids: [{ id: "p1" }] });
            expect(res.status).toBe(400);
            expect(deleted).toHaveLength(0);
        });

        it("rejects a missing ids array", async () => {
            const app = harness();
            const res = await deleteBulk(app, { rows: ["p1"] });
            expect(res.status).toBe(400);
            expect((await res.json()).error.code).toBe("INVALID_BULK_BODY");
        });

        it("enforces the row cap", async () => {
            const app = harness();
            const res = await deleteBulk(app, { ids: ["a", "b", "c", "d"] });
            expect(res.status).toBe(400);
            expect((await res.json()).error.code).toBe("BULK_TOO_LARGE");
        });

        it("reports BULK_UNSUPPORTED when the driver cannot", async () => {
            const app = harness({ deleteMany: undefined });
            const res = await deleteBulk(app, { ids: ["p1"] });
            expect(res.status).toBe(400);
            expect((await res.json()).error.code).toBe("BULK_UNSUPPORTED");
        });

        it("treats an empty list as a no-op", async () => {
            const app = harness();
            const res = await deleteBulk(app, { ids: [] });
            expect(res.status).toBe(200);
            expect(deleted).toHaveLength(0);
        });
    });
});
