import { describe, expect, it } from "@jest/globals";
import { buildSdkData, withETag } from "../src";
import { DataDriver, RebaseApiError, RebaseClientError, RebaseSdkData, SDKTableClient, isUnsupported, type RestFetchService } from "@rebasepro/types";

/**
 * What the in-process SDK (`buildSdkData(driver)` — `rebase.data`, a hook's
 * `context.data`) hands back and refuses, pinned before it stopped being
 * derived from the admin's `Entity` accessor. Each case here is a behaviour
 * the Entity detour produced and that the row path must keep: the copy of each
 * row, the metadata it drops, the realtime frames, the stubs and their
 * sentences, the bulk refusals.
 *
 * The other SDK pins: `sdk-symmetry`, `sdk-param-fidelity`, `sdk-trash`,
 * `sdk-write-options`, `page-with-offset`, `paginate` (this package) and the
 * PGlite oracles in `server-postgres` (`wire-read-values`, `wire-write-values`,
 * `sdk-rows-pglite`).
 */

type Row = Record<string, unknown>;

interface Call { method: string; args: unknown[] }

/** A driver with every capability, recording what it was asked. */
function fullDriver(rows: Row[] = [{ id: 1, title: "a" }, { id: 2, title: "b" }]) {
    const calls: Call[] = [];
    const record = (method: string, ...args: unknown[]) => { calls.push({ method, args }); };
    let listenFrame: ((rows: Row[]) => void) | undefined;
    let listenOneFrame: ((row: Row | null) => void) | undefined;
    const rest: RestFetchService = {
        async fetchCollectionForRest(path, options, include) {
            record("fetchCollectionForRest", path, options, include);
            return rows;
        },
        cursorFor(path, row, orderBy) {
            record("cursorFor", path, row, orderBy);
            return `cursor:${String(row.id)}`;
        },
        async aggregate(path, options) {
            record("aggregate", path, options);
            return [{ count: 2 }];
        },
        async fetchOneForRest(path, id, include) {
            record("fetchOneForRest", path, id, include);
            return rows.find(row => row.id === id) ?? null;
        }
    };
    const driver: DataDriver = {
        restFetchService: rest,
        async fetchCollection(props) { record("fetchCollection", props); return rows; },
        async fetchOne(props) { record("fetchOne", props); return rows[0]; },
        async save(props) { record("save", props); return { id: props.id ?? 9, ...props.values }; },
        async saveMany(props) { record("saveMany", props); return props.rows.map((row, i) => ({ id: i + 10, ...row })); },
        async updateMany(props) { record("updateMany", props); return props.updates.map(u => ({ id: u.id, ...u.values })); },
        async updateWhere(props) { record("updateWhere", props); return [{ id: 1, ...props.values }]; },
        async deleteWhere(props) { record("deleteWhere", props); return 3; },
        async delete(props) { record("delete", props); },
        async deleteMany(props) { record("deleteMany", props); },
        async refreshView(path, options) { record("refreshView", path, options); },
        async count(props) { record("count", props); return 7; },
        async checkUniqueField() { return true; },
        listenCollection(props) {
            record("listenCollection", props);
            listenFrame = props.onUpdate;
            return () => record("unlisten");
        },
        listenOne(props) {
            record("listenOne", props);
            listenOneFrame = props.onUpdate;
            return () => record("unlistenOne");
        },
        async batchWrite(props) { record("batchWrite", props); return [{ id: 1 }]; }
    };
    return {
        driver,
        calls,
        push: (frame: Row[]) => listenFrame?.(frame),
        pushOne: (frame: Row | null) => listenOneFrame?.(frame)
    };
}

/** A driver with only the required methods. */
function bareDriver(rows: Row[] = [{ id: 1, title: "a" }]) {
    const calls: Call[] = [];
    const driver: DataDriver = {
        async fetchCollection(props) { calls.push({ method: "fetchCollection", args: [props] }); return rows; },
        async fetchOne(props) { calls.push({ method: "fetchOne", args: [props] }); return rows[0]; },
        async save(props) { calls.push({ method: "save", args: [props] }); return { id: props.id ?? 1, ...props.values }; },
        async delete(props) { calls.push({ method: "delete", args: [props] }); },
        async checkUniqueField() { return true; }
    };
    return { driver, calls };
}

const table = (data: RebaseSdkData, slug = "posts"): SDKTableClient => data.table(slug);

describe("in-process SDK rows (characterization)", () => {
    describe("the rows it serves", () => {
        it("serves each row as a copy, without the search-explain `_matches`", async () => {
            const served = { id: 1, title: "a", _matches: [{ field: "title", snippet: "<b>a</b>" }] };
            const { driver } = fullDriver([served]);
            const { data } = await table(buildSdkData(driver)).find({ searchString: "a", searchExplain: true });
            expect(data).toEqual([{ id: 1, title: "a" }]);
            expect(data[0]).not.toBe(served);
            expect("_matches" in data[0]).toBe(false);
        });

        it("serves no etag in-process: the version the read reported does not survive", async () => {
            const served = withETag({ id: 1, title: "a" }, "\"v1\"");
            const { driver } = fullDriver([served]);
            const posts = table(buildSdkData(driver));
            const byId = await posts.findById(1);
            expect(byId).toEqual({ id: 1, title: "a" });
            expect(Object.getOwnPropertyDescriptor(byId, "__etag")).toBeUndefined();
            const got = await posts.get(1);
            expect(Object.getOwnPropertyDescriptor(got, "__etag")).toBeUndefined();
        });

        it("findById forwards include to the REST read, and answers undefined for a missing row", async () => {
            const { driver, calls } = fullDriver();
            const posts = table(buildSdkData(driver));
            expect(await posts.findById(2, { include: ["author"] })).toEqual({ id: 2, title: "b" });
            expect(calls.at(-1)).toEqual({ method: "fetchOneForRest", args: ["posts", 2, ["author"]] });
            expect(await posts.findById(99)).toBeUndefined();
        });

        it("findById without a REST pipeline reads `fetchOne` with the address only (include is not forwarded)", async () => {
            const { driver, calls } = bareDriver();
            await table(buildSdkData(driver)).findById(1, { include: ["author"] });
            expect(calls).toEqual([{ method: "fetchOne", args: [{ path: "posts", id: 1 }] }]);
        });

        it("get() of a missing row is a 404 NOT_FOUND naming the id and the table", async () => {
            const { driver } = fullDriver();
            const error = await table(buildSdkData(driver)).get(99).catch((e: unknown) => e);
            expect(error).toBeInstanceOf(RebaseApiError);
            expect(error).toMatchObject({ status: 404, code: "NOT_FOUND", message: "No record with id \"99\" in \"posts\"." });
        });
    });

    describe("find", () => {
        it("forwards fields, distinct, searchExplain and include, and issues the next cursor", async () => {
            const { driver, calls } = fullDriver([{ id: 1 }, { id: 2 }, { id: 3 }]);
            const res = await table(buildSdkData(driver)).find({
                limit: 2, fields: ["id"], distinct: true, searchString: "x", searchExplain: true, include: ["author"], orderBy: ["id", "asc"]
            });
            expect(res.data).toEqual([{ id: 1 }, { id: 2 }]);
            // distinct is not counted: one row past the page answers hasMore.
            expect(res.meta).toEqual({ total: 2, limit: 2, offset: 0, hasMore: true, nextCursor: "cursor:2" });
            const read = calls.find(c => c.method === "fetchCollectionForRest");
            expect(read?.args).toEqual(["posts", {
                filter: undefined, logical: undefined, limit: 3, offset: undefined, startAfter: undefined,
                orderBy: [["id", "asc"]], searchString: "x", searchExplain: true, vectorSearch: undefined,
                fields: ["id"], distinct: true
            }, ["author"]]);
            expect(calls.some(c => c.method === "count")).toBe(false);
        });

        it("counts beside the page when it can, and reports the count as the total", async () => {
            const { driver, calls } = fullDriver();
            const res = await table(buildSdkData(driver)).find({ where: { title: ["==", "a"] }, limit: 10 });
            // `hasMore` is the arithmetic on the count: 2 served of 7 counted.
            expect(res.meta).toEqual({ total: 7, limit: 10, offset: 0, hasMore: true, nextCursor: "cursor:2" });
            expect(calls.find(c => c.method === "count")?.args).toEqual([{
                path: "posts", filter: { title: ["==", "a"] }, logical: undefined, searchString: undefined, vectorSearch: undefined
            }]);
        });

        it("pages by a cursor it was handed, without an offset", async () => {
            const { driver, calls } = fullDriver([{ id: 1 }, { id: 2 }]);
            const first = await table(buildSdkData(driver)).find({ limit: 1, orderBy: ["id", "asc"], count: "none" });
            expect(first.meta.nextCursor).toBe("cursor:1");
            calls.length = 0;
            // Not a cursor this test's driver issued (it issues `cursor:<id>`): a real
            // one, from the codec, is what `after` decodes.
            const { encodeCursor } = await import("../src/data/cursor");
            const after = encodeCursor([["id", "asc"]], { id: 1 }, 1);
            if (!after) throw new Error("no cursor");
            await table(buildSdkData(driver)).find({ limit: 1, after });
            const read = calls.find(c => c.method === "fetchCollectionForRest");
            const options = read?.args[1] as Record<string, unknown>;
            expect(options.offset).toBeUndefined();
            expect(options.startAfter).toEqual({ id: 1, values: { id: 1 } });
            expect(options.orderBy).toEqual([["id", "asc"]]);
            expect(options.limit).toBe(2);
        });

        it("the fluent builder ends in the same flat rows", async () => {
            const { driver } = fullDriver();
            const res = await table(buildSdkData(driver)).where("title", "==", "a").orderBy("id", "desc").limit(5).find();
            expect(res.data).toEqual([{ id: 1, title: "a" }, { id: 2, title: "b" }]);
        });

        it("the `search` shortcut does not forward the explain option; the builder's `search` does", async () => {
            const { driver, calls } = fullDriver();
            const posts = table(buildSdkData(driver));
            await posts.search("a").find();
            const shortcut = calls.filter(c => c.method === "fetchCollectionForRest").at(-1)?.args[1] as Record<string, unknown>;
            expect(shortcut.searchExplain).toBeUndefined();
            await posts.where("title", "==", "a").search("a", { explain: true }).find();
            const chained = calls.filter(c => c.method === "fetchCollectionForRest").at(-1)?.args[1] as Record<string, unknown>;
            expect(chained.searchExplain).toBe(true);
        });

        it("findAll walks every page", async () => {
            const { driver } = fullDriver([{ id: 1 }, { id: 2 }]);
            expect(await table(buildSdkData(driver)).findAll({ pageSize: 5 })).toEqual([{ id: 1 }, { id: 2 }]);
        });
    });

    describe("aggregate and refresh", () => {
        it("an ungrouped aggregate is the driver's answer, no meta", async () => {
            const { driver, calls } = fullDriver();
            const result = await table(buildSdkData(driver)).aggregate({ select: [{ fn: "count" }] });
            expect(result).toEqual([{ count: 2 }]);
            expect(Object.getOwnPropertyDescriptor(result, "meta")).toBeUndefined();
            expect(calls.at(-1)?.args[0]).toBe("posts");
        });

        it("refresh forwards to refreshView", async () => {
            const { driver, calls } = fullDriver();
            await table(buildSdkData(driver)).refresh({ concurrently: true });
            expect(calls.at(-1)).toEqual({ method: "refreshView", args: ["posts", { concurrently: true }] });
        });
    });

    describe("writes", () => {
        it("create / update / delete reach save and delete with the address and status", async () => {
            const { driver, calls } = fullDriver();
            const posts = table(buildSdkData(driver));
            expect(await posts.create({ title: "n" })).toEqual({ id: 9, title: "n" });
            expect(await posts.create({ title: "m" }, 5)).toEqual({ id: 5, title: "m" });
            expect(await posts.update(1, { title: "u" })).toEqual({ id: 1, title: "u" });
            await posts.delete(1);
            expect(calls.map(c => c.args[0])).toEqual([
                { path: "posts", values: { title: "n" }, id: undefined, status: "new" },
                { path: "posts", values: { title: "m" }, id: 5, status: "new" },
                { path: "posts", values: { title: "u" }, id: 1, status: "existing" },
                { row: { id: 1, path: "posts" } }
            ]);
        });

        it("createMany / upsert / updateMany / updateWhere / deleteWhere / deleteMany forward their options", async () => {
            const { driver, calls } = fullDriver();
            const posts = table(buildSdkData(driver));
            expect(await posts.createMany([{ title: "x" }], { upsert: true, onConflict: ["slug"], where: { title: ["==", "x"] }, ignoreDuplicates: true }))
                .toEqual([{ id: 10, title: "x" }]);
            expect(await posts.upsert({ title: "y" }, { onConflict: ["slug"] })).toEqual({ id: 10, title: "y" });
            expect(await posts.updateMany([{ id: 1, data: { title: "z" } }])).toEqual([{ id: 1, title: "z" }]);
            expect(await posts.updateWhere({ where: { title: ["==", "a"] } }, { title: "w" })).toEqual([{ id: 1, title: "w" }]);
            expect(await posts.deleteWhere({ where: { title: ["==", "a"] } })).toBe(3);
            await posts.deleteMany([1, 2]);
            expect(calls.map(c => c.args[0])).toEqual([
                { path: "posts", rows: [{ title: "x" }], upsert: true, onConflict: ["slug"], conflictWhere: { title: ["==", "x"] }, ignoreDuplicates: true },
                { path: "posts", rows: [{ title: "y" }], upsert: true, onConflict: ["slug"] },
                { path: "posts", updates: [{ id: 1, values: { title: "z" } }] },
                { path: "posts", filter: { title: ["==", "a"] }, logical: undefined, values: { title: "w" } },
                { path: "posts", filter: { title: ["==", "a"] }, logical: undefined },
                { path: "posts", ids: [1, 2] }
            ]);
        });

        it("empty bulk calls touch nothing; non-arrays are INVALID_BULK_BODY", async () => {
            const { driver, calls } = fullDriver();
            const posts = table(buildSdkData(driver));
            expect(await posts.createMany([])).toEqual([]);
            expect(await posts.updateMany([])).toEqual([]);
            await posts.deleteMany([]);
            expect(calls).toEqual([]);
            // What an untyped caller (a JavaScript function) can hand it.
            const notArray: unknown = "x";
            const asList = <T>(value: unknown): T[] => value as T[];
            for (const call of [() => posts.createMany(asList(notArray)), () => posts.updateMany(asList(notArray)), () => posts.deleteMany(asList(notArray))]) {
                const error = await call().catch((e: unknown) => e);
                expect(error).toBeInstanceOf(RebaseClientError);
                expect(error).toMatchObject({ code: "INVALID_BULK_BODY" });
            }
        });

        it("a driver without bulk writes refuses each bulk call by name", async () => {
            const { driver } = bareDriver();
            const posts = table(buildSdkData(driver));
            await expect(posts.createMany([{ title: "x" }])).rejects.toThrow(
                "Bulk writes are not supported by this table's data source. Fall back to create() per record.");
            await expect(posts.upsert({ title: "x" })).rejects.toThrow(
                "Upsert is not supported by this table's data source: it needs a bulk write, which this driver does not implement. Fall back to create() or update().");
            await expect(posts.updateMany([{ id: 1, data: {} }])).rejects.toThrow(
                "Bulk updates are not supported by this table's data source. Fall back to update() per record.");
            await expect(posts.updateWhere({ where: {} }, {})).rejects.toThrow(
                "Filtered updates are not supported by this table's data source. Read the rows, then updateMany() them.");
            await expect(posts.deleteWhere({ where: {} })).rejects.toThrow(
                "Filtered deletes are not supported by this table's data source. Read the rows, then deleteMany() their ids.");
            await expect(posts.deleteMany([1])).rejects.toThrow(
                "Bulk deletes are not supported by this table's data source. Fall back to delete() per record.");
        });

        it("an upsert the conflict rule kept answers undefined; without a rule an empty answer throws", async () => {
            const { driver } = fullDriver();
            const empty: DataDriver = { ...driver, async saveMany() { return []; } };
            const posts = table(buildSdkData(empty));
            expect(await posts.upsert({ title: "x" }, { ignoreDuplicates: true })).toBeUndefined();
            await expect(posts.upsert({ title: "x" })).rejects.toThrow("Upsert into \"posts\" returned no row.");
        });

        it("batch() names each table by its slug and answers the driver's rows", async () => {
            const { driver, calls } = fullDriver();
            const result = await buildSdkData(driver).batch([{ op: "update", table: "blogPosts", id: 1, values: { title: "x" } }]);
            expect(result).toEqual({ data: [{ id: 1 }], meta: { operations: 1 } });
            expect(calls.at(-1)?.args[0]).toEqual({ operations: [{ op: "update", path: "blog_posts", id: 1, values: { title: "x" } }] });
            expect(await buildSdkData(driver).batch([])).toEqual({ data: [], meta: { operations: 0 } });
            await expect(buildSdkData(bareDriver().driver).batch([{ op: "delete", table: "posts", id: 1 }]))
                .rejects.toMatchObject({ code: "BATCH_UNSUPPORTED" });
        });
    });

    describe("realtime", () => {
        it("listen delivers flat rows (copies, no `_matches`) with a lower-bound total", () => {
            const { driver, calls, push } = fullDriver();
            const frames: unknown[] = [];
            const stop = table(buildSdkData(driver)).listen({ limit: 2, offset: 4, where: { title: ["==", "a"] } }, frame => frames.push(frame));
            expect(calls[0].method).toBe("listenCollection");
            expect(calls[0].args[0]).toMatchObject({ path: "posts", limit: 2, offset: 4, filter: { title: ["==", "a"] } });
            const row = { id: 1, title: "a", _matches: [] };
            push([row, { id: 2, title: "b" }]);
            expect(frames).toEqual([{ data: [{ id: 1, title: "a" }, { id: 2, title: "b" }], meta: { total: 6, limit: 2, offset: 4, hasMore: true } }]);
            stop();
            expect(calls.at(-1)?.method).toBe("unlisten");
        });

        it("listenById delivers the row, or undefined, and forwards include", () => {
            const { driver, calls, pushOne } = fullDriver();
            const frames: unknown[] = [];
            table(buildSdkData(driver)).listenById(1, row => frames.push(row), undefined, { include: ["author"] });
            expect(calls[0].args[0]).toMatchObject({ path: "posts", id: 1, include: ["author"] });
            pushOne({ id: 1, title: "a" });
            pushOne(null);
            expect(frames).toEqual([{ id: 1, title: "a" }, undefined]);
        });
    });

    describe("what a data source cannot do is a stub that says so", () => {
        it("count, listen, listenById, listenCount, aggregate and refresh on a bare driver (trash reads through fetchCollection)", async () => {
            const posts = table(buildSdkData(bareDriver().driver));
            expect(isUnsupported(posts.trash.find)).toBe(false);
            for (const method of [posts.count, posts.listen, posts.listenById, posts.listenCount, posts.aggregate, posts.refresh]) {
                expect(isUnsupported(method)).toBe(true);
            }
            expect(() => posts.listen(undefined, () => undefined)).toThrow(
                "Realtime is not available for \"posts\": its data source does not support subscriptions.");
            await expect(Promise.resolve().then(() => posts.count())).rejects.toThrow(
                "Counting is not available for \"posts\": its data source does not support it.");
            await expect(Promise.resolve().then(() => posts.aggregate({ select: [{ fn: "count" }] }))).rejects.toThrow(
                "Aggregates are not available for \"posts\": its data source does not implement them.");
            await expect(Promise.resolve().then(() => posts.refresh())).rejects.toThrow(
                "\"posts\" cannot be refreshed: its data source has no materialized views.");
        });

        it("listenCount is a stub even on a driver that subscribes", () => {
            const posts = table(buildSdkData(fullDriver().driver));
            expect(isUnsupported(posts.listenCount)).toBe(true);
            expect(isUnsupported(posts.listen)).toBe(false);
        });
    });

    describe("the proxy", () => {
        it("names a table by its accessor, the resolver first", () => {
            const { driver } = fullDriver();
            const data = buildSdkData(driver, { resolveAccessor: (p) => p === "notes" ? "my-notes" : p });
            expect(data.notes).toBe(data.table("my-notes"));
            const plain = buildSdkData(driver);
            expect(plain.blogPosts).toBe(plain.table("blog_posts"));
            const probe: Record<string | symbol, unknown> = plain;
            expect(probe.then).toBeUndefined();
            expect(probe.toJSON).toBeUndefined();
            expect(probe[Symbol.iterator]).toBeUndefined();
        });
    });
});
