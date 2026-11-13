/**
 * The in-process SDK (`buildSdkData(driver)` — `rebase.data`, a hook's
 * `context.data`) against a real Postgres (PGlite), over the surface
 * `wire-read-values` / `wire-write-values` do not pin: the find options,
 * reads by id on a single, a composite and a non-`id` key, a view, every
 * write door, and the first frame of a subscription.
 *
 * Pinned before the SDK stopped being derived from the admin's `Entity`
 * accessor: the row path must answer exactly this.
 */
import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { col, defineTable, defineView, type SDKTableClient } from "@rebasepro/types";
import { buildSdkData, compileSchema, cond, or } from "@rebasepro/common";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresTableRegistry } from "../src/model/PostgresTableRegistry";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const items = defineTable("items", {
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        title: col.text(),
        rank: col.integer(),
        status: col.enum(["draft", "live"])
    },
    rls: "admin-only"
});

const pairs = defineTable("pairs", {
    columns: { a: col.integer().primaryKey(), b: col.text().primaryKey(), note: col.text() },
    rls: "admin-only"
});

const codes = defineTable("codes", {
    columns: { code: col.text().primaryKey(), label: col.text() },
    rls: "admin-only"
});

const liveItems = defineView("live_items", {
    columns: { id: col.integer().primaryKey(), title: col.text() },
    query: "SELECT id, title FROM items WHERE status = 'live'"
});

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => ({ rows: (await db.query<T>(statement, values)).rows })
});

let db: PGlite;
let driver: PostgresBackendDriver;

beforeAll(async () => {
    db = new PGlite();
    await db.waitReady;
    const compiled = compileSchema([items, pairs, codes, liveItems]);
    await db.exec(renderPostgresDdl(planSchema(compiled, { databaseExtensions: [] }), {
        includePolicies: false, includeSearch: false, includeVector: false
    }));
    // The table DDL does not create views; `db push` does, from the same query.
    await db.exec("CREATE OR REPLACE VIEW live_items AS SELECT id, title FROM items WHERE status = 'live'");
    const catalogue = await readCatalogueSchema({ client: queryable(db), tables: compiled.map(t => t.descriptor), defaultSchema: "public" });
    const registry = new PostgresTableRegistry();
    registry.registerTables(compiled);
    for (const [name, table] of Object.entries(catalogue.tables)) registry.registerPgTable(table, name);
    const orm = pgliteNodePg(db, { schema: catalogue.tables });
    driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);

    await db.exec(`
        INSERT INTO items (title, rank, status) VALUES
            ('alpha', 3, 'live'), ('beta', 1, 'draft'), ('gamma', 2, 'live'), ('delta', 5, 'draft'), ('epsilon', 4, 'live');
        INSERT INTO pairs (a, b, note) VALUES (1, 'x', 'one-x'), (1, 'y', 'one-y'), (2, 'x', 'two-x');
        INSERT INTO codes (code, label) VALUES ('EUR', 'Euro'), ('USD', 'Dollar');
    `);
});

afterAll(async () => {
    await db.close();
});

const sdk = (slug: string): SDKTableClient => buildSdkData(driver).table(slug);

describe("find options", () => {
    it("filter, orderBy, limit, offset and the meta beside them", async () => {
        const res = await sdk("items").find({ where: { status: ["==", "live"] }, orderBy: ["rank", "desc"], limit: 2, offset: 1 });
        expect(res.data.map(r => r.title)).toEqual(["alpha", "gamma"]);
        expect(res.meta).toEqual({ total: 3, limit: 2, offset: 1, hasMore: false });
    });

    it("a logical group", async () => {
        const res = await sdk("items").find({ logical: or(cond("rank", "==", 1), cond("rank", "==", 5)), orderBy: ["rank", "asc"] });
        expect(res.data.map(r => r.title)).toEqual(["beta", "delta"]);
    });

    it("a cursor walk serves every row once, in order", async () => {
        const seen: unknown[] = [];
        let after: string | undefined;
        for (let page = 0; page < 5; page++) {
            const res = await sdk("items").find({ orderBy: ["rank", "asc"], limit: 2, ...(after ? { after } : {}) });
            seen.push(...res.data.map(r => r.rank));
            after = res.meta.nextCursor;
            if (!res.meta.hasMore) break;
        }
        expect(seen).toEqual([1, 2, 3, 4, 5]);
        expect(after).toBeUndefined();
    });

    it("fields narrow the row; distinct collapses it", async () => {
        const narrow = await sdk("items").find({ fields: ["title"], orderBy: ["rank", "asc"], limit: 1 });
        // The key rides along with the fields asked for.
        expect(narrow.data).toEqual([{ id: 2, title: "beta" }]);
        const distinct = await sdk("items").find({ fields: ["status"], distinct: true, orderBy: ["status", "asc"] });
        expect(distinct.data).toEqual([{ status: "draft" }, { status: "live" }]);
    });

    it("count and aggregates", async () => {
        expect(await sdk("items").count({ where: { status: ["==", "draft"] } })).toBe(2);
        const grouped = await sdk("items").aggregate({ select: [{ fn: "count" }, { fn: "sum", field: "rank" }], groupBy: ["status"], orderBy: ["status", "asc"] });
        expect(grouped).toEqual([{ status: "draft", count: 2, sum_rank: 6 }, { status: "live", count: 3, sum_rank: 9 }]);
    });

    it("a row with every column, keyed by its own columns", async () => {
        const res = await sdk("items").find({ orderBy: ["rank", "asc"], limit: 1 });
        expect(res.data).toEqual([{ id: 2, title: "beta", rank: 1, status: "draft" }]);
    });
});

describe("reads by id", () => {
    it("a single key", async () => {
        expect(await sdk("items").findById(1)).toEqual({ id: 1, title: "alpha", rank: 3, status: "live" });
        expect(await sdk("items").findById("1")).toEqual({ id: 1, title: "alpha", rank: 3, status: "live" });
        expect(await sdk("items").findById(999)).toBeUndefined();
    });

    it("a composite key, addressed `a:::b`", async () => {
        expect(await sdk("pairs").findById("1:::y")).toEqual({ a: 1, b: "y", note: "one-y" });
        const page = await sdk("pairs").find({ orderBy: [["a", "asc"], ["b", "asc"]] });
        expect(page.data).toEqual([{ a: 1, b: "x", note: "one-x" }, { a: 1, b: "y", note: "one-y" }, { a: 2, b: "x", note: "two-x" }]);
    });

    it("a key not named id", async () => {
        expect(await sdk("codes").get("USD")).toEqual({ code: "USD", label: "Dollar" });
        await expect(sdk("codes").get("GBP")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    });

    it("a view", async () => {
        const res = await sdk("live_items").find({ orderBy: ["id", "asc"] });
        expect(res.data).toEqual([{ id: 1, title: "alpha" }, { id: 3, title: "gamma" }, { id: 5, title: "epsilon" }]);
    });
});

describe("writes", () => {
    it("create, update, delete", async () => {
        const created = await sdk("codes").create({ code: "JPY", label: "Yen" });
        expect(created).toEqual({ code: "JPY", label: "Yen" });
        expect(await sdk("codes").update("JPY", { label: "Japanese yen" })).toEqual({ code: "JPY", label: "Japanese yen" });
        await sdk("codes").delete("JPY");
        expect(await sdk("codes").findById("JPY")).toBeUndefined();
    });

    it("composite-key update", async () => {
        expect(await sdk("pairs").update("2:::x", { note: "changed" })).toEqual({ a: 2, b: "x", note: "changed" });
    });

    it("bulk: createMany, upsert, updateMany, updateWhere, deleteWhere, deleteMany", async () => {
        const made = await sdk("codes").createMany([{ code: "AAA", label: "a" }, { code: "BBB", label: "b" }]);
        expect(made).toEqual([{ code: "AAA", label: "a" }, { code: "BBB", label: "b" }]);
        expect(await sdk("codes").upsert({ code: "AAA", label: "a2" }, { onConflict: ["code"] })).toEqual({ code: "AAA", label: "a2" });
        expect(await sdk("codes").updateMany([{ id: "BBB", data: { label: "b2" } }])).toEqual([{ code: "BBB", label: "b2" }]);
        expect(await sdk("codes").updateWhere({ where: { label: ["==", "b2"] } }, { label: "b3" })).toEqual([{ code: "BBB", label: "b3" }]);
        expect(await sdk("codes").deleteWhere({ where: { code: ["==", "BBB"] } })).toBe(1);
        await sdk("codes").deleteMany(["AAA"]);
        expect((await sdk("codes").find({ orderBy: ["code", "asc"] })).data.map(r => r.code)).toEqual(["EUR", "USD"]);
    });
});

describe("realtime", () => {
    it("listen: the first frame is the read's rows", async () => {
        const frame = await new Promise<unknown>((resolve, reject) => {
            const stop = sdk("items").listen({ where: { status: ["==", "live"] }, orderBy: ["rank", "asc"], limit: 2 }, (res) => {
                stop();
                resolve(res);
            }, reject);
        });
        expect(frame).toEqual({
            data: [{ id: 3, title: "gamma", rank: 2, status: "live" }, { id: 1, title: "alpha", rank: 3, status: "live" }],
            meta: { total: 2, limit: 2, offset: 0, hasMore: true }
        });
    });

    it("listenById: the first frame is the row", async () => {
        const frame = await new Promise<unknown>((resolve, reject) => {
            const stop = sdk("items").listenById(2, (row) => {
                stop();
                resolve(row);
            }, reject);
        });
        expect(frame).toEqual({ id: 2, title: "beta", rank: 1, status: "draft" });
    });
});
