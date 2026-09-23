import { jest } from "@jest/globals";
import { OfflineManager, type LiveResult, type OfflineStatus, type RowSnapshotMeta } from "./offline";
import { MemoryOfflineStore, type PendingMutation } from "./offline-store";
import { RebaseApiError } from "./transport";
import type { CollectionClient } from "./collection";
import type { WriteOptions } from "@rebasepro/types";
import type { FindParams } from "./transport";
import { GeoPoint, type FindResult } from "@rebasepro/types";
import { matchesParams, runLocalQuery } from "./offline-query";

type Row = Record<string, unknown>;

/** Let queued microtasks (and the observers they feed) run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A fake backend that actually evaluates queries, so a test can tell the
 * difference between "the local engine answered" and "the server did".
 * `state.online` reproduces fetch's network failure, and `rejectWith` lets a
 * test make the server refuse one specific write — the case rollback exists for.
 */
function createFakeServer() {
    const state = { online: true };
    const tables = new Map<string, Map<string, Row>>();
    const calls: { collection: string; op: string; id?: unknown }[] = [];
    /** Keyed by `${op}:${id}`, or `${op}:*` for any row. */
    const rejections = new Map<string, RebaseApiError>();
    /** Ids the server insists on assigning itself, keyed by the client's id. */
    const idRewrites = new Map<string, string>();

    function table(slug: string): Map<string, Row> {
        if (!tables.has(slug)) tables.set(slug, new Map());
        return tables.get(slug)!;
    }

    /**
     * Requests parked mid-flight, keyed `${op}:${id}`. Holding a request open is
     * the only way to reproduce anything that goes wrong *while* an op is on the
     * wire — the queue treats an in-flight op differently from a queued one, and
     * a fake that returns immediately can never be in that state.
     */
    const gates = new Map<string, Promise<void>>();

    function guard(slug: string, op: string, id?: unknown) {
        calls.push({ collection: slug, op, id });
        if (!state.online) throw new RebaseApiError("Could not reach the server: fetch failed", { status: 0, code: "NETWORK_ERROR" });
        const rejection = rejections.get(`${op}:${String(id)}`) ?? rejections.get(`${op}:*`);
        if (rejection) throw rejection;
    }

    /** Await after `guard`, so a parked request has already been counted. */
    function hold(op: string, id?: unknown): Promise<void> | undefined {
        return gates.get(`${op}:${String(id)}`);
    }

    function client(slug: string): CollectionClient<Row> {
        const fake = {
            async find(params?: FindParams) {
                guard(slug, "find");
                return runLocalQuery([...table(slug).values()], params);
            },
            async findById(id: string | number) {
                guard(slug, "findById", id);
                return table(slug).get(String(id));
            },
            async create(data: Row, id?: string | number) {
                const wanted = id ?? data.id;
                guard(slug, "create", wanted);
                await hold("create", wanted);
                const rowId = idRewrites.get(String(wanted)) ?? wanted ?? `srv-${table(slug).size + 1}`;
                const row = { ...data, id: rowId };
                table(slug).set(String(rowId), row);
                return row;
            },
            async createMany(rows: Row[]) {
                guard(slug, "createMany");
                return rows.map((r) => {
                    const rowId = idRewrites.get(String(r.id)) ?? r.id ?? `srv-${table(slug).size + 1}`;
                    const row = { ...r, id: rowId };
                    table(slug).set(String(rowId), row);
                    return row;
                });
            },
            async update(id: string | number, data: Row) {
                guard(slug, "update", id);
                const existing = table(slug).get(String(id));
                if (!existing) throw new RebaseApiError("Not found", { status: 404 });
                const row = { ...existing, ...data, id };
                table(slug).set(String(id), row);
                return row;
            },
            async delete(id: string | number) {
                guard(slug, "delete", id);
                table(slug).delete(String(id));
            },
            async count(params?: FindParams) {
                guard(slug, "count");
                return [...table(slug).values()].filter((r) => matchesParams(r, params)).length;
            }
        };
        return fake as unknown as CollectionClient<Row>;
    }

    return {
        state,
        table,
        calls,
        client,
        rejections,
        idRewrites,
        gates,
        countCalls: (op: string) => calls.filter((c) => c.op === op).length
    };
}

function createManager(server: ReturnType<typeof createFakeServer>, options: {
    onSyncError?: (error: Error, mutation: PendingMutation) => void;
    store?: MemoryOfflineStore;
    /** Default 0 (no backoff suppression); pass a value to exercise backoff. */
    syncIntervalMs?: number;
    maxRetries?: number;
} = {}) {
    const store = options.store ?? new MemoryOfflineStore();
    const manager = new OfflineManager(
        {
            store,
            syncIntervalMs: options.syncIntervalMs ?? 0,
            maxRetries: options.maxRetries,
            onSyncError: options.onSyncError
        },
        (slug) => server.client(slug)
    );
    const wrap = (slug: string) => manager.wrap(slug, server.client(slug));
    return { manager, store, wrap };
}

describe("the local database", () => {
    it("answers findById for a row it only ever saw inside a list", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a" }, "p1");
        await posts.find();

        server.state.online = false;
        // A response cache keyed by request would have nothing to say here.
        expect(await posts.findById("p1")).toMatchObject({ title: "a" });
    });

    it("shows an edit made in one query in every other query holding that row", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a", status: "draft" }, "p1");
        const drafts: FindParams = { where: { status: ["==", "draft"] } };
        await posts.find();
        await posts.find(drafts);

        server.state.online = false;
        await posts.update("p1", { title: "edited" });

        expect((await posts.find()).data[0].title).toBe("edited");
        expect((await posts.find(drafts)).data[0].title).toBe("edited");
        expect(await posts.findById("p1")).toMatchObject({ title: "edited" });
    });

    it("answers a query the server has never been asked, from the rows it holds", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a", n: 1 }, "p1");
        await server.client("posts").create({ title: "b", n: 2 }, "p2");
        await posts.find();

        server.state.online = false;
        const result = await posts.find({ where: { n: [">", 1] }, orderBy: ["n", "desc"] });
        expect(result.data.map((r) => r.id)).toEqual(["p2"]);
    });

    it("does not resurrect a row the server says is gone", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a" }, "p1");
        await posts.find();

        server.table("posts").delete("p1");
        expect(await posts.findById("p1")).toBeUndefined();

        server.state.online = false;
        expect(await posts.findById("p1")).toBeUndefined();
    });

    it("does not blame an eviction on a deletion when reporting a total", async () => {
        const server = createFakeServer();
        const store = new MemoryOfflineStore();
        const manager = new OfflineManager(
            { store, syncIntervalMs: 0, maxCachedRowsPerCollection: 2 },
            (slug) => server.client(slug)
        );
        const posts = manager.wrap("posts", server.client("posts"));
        for (const id of ["p1", "p2", "p3"]) {
            await server.client("posts").create({ title: id }, id);
        }
        await posts.find();

        server.state.online = false;
        const result = await posts.find();
        // One row fell out of the cache to stay under the cap. The page is
        // short, but the server's count of what exists has not changed.
        expect(result.data.length).toBe(2);
        expect(result.meta.total).toBe(3);
        manager.dispose();
    });

    it("evicts the coldest rows past the cap but never one with unsent writes", async () => {
        const server = createFakeServer();
        const store = new MemoryOfflineStore();
        const manager = new OfflineManager(
            { store, syncIntervalMs: 0, maxCachedRowsPerCollection: 2 },
            (slug) => server.client(slug)
        );
        const posts = manager.wrap("posts", server.client("posts"));
        for (const id of ["p1", "p2", "p3"]) {
            await server.client("posts").create({ title: id }, id);
        }
        await posts.find();

        server.state.online = false;
        await posts.update("p1", { title: "pending edit" });
        // p1 is the oldest, and would go first if the queue were not consulted.
        await posts.find();

        expect(await posts.findById("p1")).toMatchObject({ title: "pending edit" });
        manager.dispose();
    });
});

describe("offline writes", () => {
    it("stops attempting the network once it knows the connection is gone", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server, { syncIntervalMs: 60_000 });
        const posts = wrap("posts");
        await posts.find();

        server.state.online = false;
        await posts.create({ title: "one" });
        const afterFirst = server.countCalls("create");

        await posts.create({ title: "two" });
        await posts.create({ title: "three" });

        // The first write learns the network is down; the rest must not each
        // pay for that lesson again.
        expect(afterFirst).toBe(1);
        expect(server.countCalls("create")).toBe(1);
    });

    it("keeps a write local when the connection has already failed", async () => {
        const server = createFakeServer();
        const { manager, wrap } = createManager(server, { syncIntervalMs: 60_000 });
        const posts = wrap("posts");
        await posts.find();
        server.state.online = false;
        await posts.create({ title: "one" });

        const row = await posts.create({ title: "two" });
        expect(row.title).toBe("two");
        expect(await manager.api.pending()).toHaveLength(2);
        expect((await posts.find()).data.map((r) => r.title).sort()).toEqual(["one", "two"]);
    });

    it("reports the queue depth and connectivity through status()", async () => {
        const server = createFakeServer();
        const { manager, wrap } = createManager(server);
        const posts = wrap("posts");
        const seen: OfflineStatus[] = [];
        manager.api.onStatusChange((status) => seen.push(status));
        await posts.find();

        expect(manager.api.status()).toMatchObject({ online: true, pending: 0, syncing: false });

        server.state.online = false;
        await posts.create({ title: "queued" });
        expect(manager.api.status()).toMatchObject({ online: false, pending: 1 });
        expect(seen.some((s) => s.online === false)).toBe(true);

        server.state.online = true;
        await manager.sync();
        expect(manager.api.status()).toMatchObject({ online: true, pending: 0, syncing: false });
        expect(manager.api.status().lastSyncedAt).toBeGreaterThan(0);
        // `syncing` has to be observable while it is true, or a spinner can
        // never be shown.
        expect(seen.some((s) => s.syncing)).toBe(true);
    });
});

describe("rollback", () => {
    it("undoes a rejected update and puts the previous value back", async () => {
        const server = createFakeServer();
        const onSyncError = jest.fn();
        const { manager, wrap } = createManager(server, { onSyncError });
        const posts = wrap("posts");
        await server.client("posts").create({ title: "original" }, "p1");
        await posts.find();

        server.state.online = false;
        await posts.update("p1", { title: "optimistic" });
        expect(await posts.findById("p1")).toMatchObject({ title: "optimistic" });

        server.state.online = true;
        server.rejections.set("update:p1", new RebaseApiError("denied", { status: 403 }));
        await manager.sync();

        expect(await posts.findById("p1")).toMatchObject({ title: "original" });
        expect(onSyncError).toHaveBeenCalledTimes(1);
        expect(manager.api.status().lastError).toBe("denied");
    });

    it("removes a rejected create from the local database", async () => {
        const server = createFakeServer();
        const onSyncError = jest.fn();
        const { manager, wrap } = createManager(server, { onSyncError });
        const posts = wrap("posts");
        await posts.find();

        server.state.online = false;
        const row = await posts.create({ title: "doomed" });
        expect((await posts.find()).data).toHaveLength(1);

        server.state.online = true;
        server.rejections.set("create:*", new RebaseApiError("invalid", { status: 400 }));
        await manager.sync();

        expect((await posts.find()).data).toHaveLength(0);
        expect(await posts.findById(row.id as string).catch(() => undefined)).toBeUndefined();
        expect(await manager.api.pending()).toHaveLength(0);
    });

    it("restores a rejected delete", async () => {
        const server = createFakeServer();
        const { manager, wrap } = createManager(server, { onSyncError: () => undefined });
        const posts = wrap("posts");
        await server.client("posts").create({ title: "keep me" }, "p1");
        await posts.find();

        server.state.online = false;
        await posts.delete("p1");
        expect(await posts.findById("p1")).toBeUndefined();

        server.state.online = true;
        server.rejections.set("delete:p1", new RebaseApiError("denied", { status: 403 }));
        await manager.sync();

        expect(await posts.findById("p1")).toMatchObject({ title: "keep me" });
    });

    it("discards the edits that were built on a rejected create", async () => {
        const server = createFakeServer();
        const onSyncError = jest.fn();
        const { manager, wrap } = createManager(server, { onSyncError });
        const posts = wrap("posts");
        await posts.find();

        server.state.online = false;
        const row = await posts.create({ title: "doomed" }, "x1");
        // A different row in between stops the update coalescing into the
        // create, so this really is a second queued mutation.
        await posts.create({ title: "unrelated" }, "x2");
        await posts.update("x1", { title: "edited" });
        expect(await manager.api.pending()).toHaveLength(3);

        server.state.online = true;
        server.rejections.set("create:x1", new RebaseApiError("invalid", { status: 400 }));
        await manager.sync();

        // The edit could only have failed too, and keeping it would leave the
        // local database claiming a row the server does not have.
        expect(onSyncError.mock.calls.map((c) => (c[1] as PendingMutation).type)).toEqual(["create", "update"]);
        expect(server.table("posts").has("x1")).toBe(false);
        expect(server.table("posts").has("x2")).toBe(true);
        expect(await manager.api.pending()).toHaveLength(0);
        expect(row.id).toBe("x1");
    });

    it("keeps a later create that re-establishes the row on its own", async () => {
        const server = createFakeServer();
        const onSyncError = jest.fn();
        const { manager, wrap } = createManager(server, { onSyncError });
        const posts = wrap("posts");
        await posts.find();

        server.state.online = false;
        // Update a row the server does not have: this one is going to 404.
        await posts.update("p9", { title: "orphan edit" });
        await posts.create({ title: "recreated" }, "p9");

        server.state.online = true;
        await manager.sync();

        // The create overwrites the row outright, so it never depended on the
        // rejected update — dropping it would lose a write the server accepts.
        expect(server.table("posts").get("p9")).toMatchObject({ title: "recreated" });
        expect(onSyncError.mock.calls.map((c) => (c[1] as PendingMutation).type)).toEqual(["update"]);
    });
});

describe("replay", () => {
    it("moves the local row when the server assigns its own id", async () => {
        const server = createFakeServer();
        const { manager, wrap } = createManager(server);
        const posts = wrap("posts");
        await posts.find();

        server.state.online = false;
        const local = await posts.create({ title: "renamed" });
        server.idRewrites.set(String(local.id), "srv-99");

        server.state.online = true;
        await manager.sync();

        expect(await posts.findById("srv-99")).toMatchObject({ title: "renamed" });
        // The temporary id must not linger as a phantom row.
        expect((await posts.find()).data.map((r) => r.id)).toEqual(["srv-99"]);
    });

    it("re-points queued writes at the id the server chose", async () => {
        const server = createFakeServer();
        const { manager, wrap } = createManager(server);
        const posts = wrap("posts");
        await posts.find();

        server.state.online = false;
        const local = await posts.create({ title: "first" });
        await posts.create({ title: "other" }, "other");
        await posts.update(local.id as string, { title: "second" });
        server.idRewrites.set(String(local.id), "srv-7");

        server.state.online = true;
        await manager.sync();

        // The update was queued against an id that never existed server-side.
        expect(server.table("posts").get("srv-7")).toMatchObject({ title: "second" });
        expect(await manager.api.pending()).toHaveLength(0);
    });

    it("retries a mutation the server was merely too busy for", async () => {
        const server = createFakeServer();
        const onSyncError = jest.fn();
        const { manager, wrap } = createManager(server, { onSyncError });
        const posts = wrap("posts");
        await posts.find();

        server.state.online = false;
        await posts.create({ title: "later" }, "p1");

        server.state.online = true;
        server.rejections.set("create:p1", new RebaseApiError("slow down", { status: 429 }));
        expect(await manager.sync()).toMatchObject({ flushed: 0, remaining: 1 });
        expect(onSyncError).not.toHaveBeenCalled();

        server.rejections.clear();
        expect(await manager.sync()).toMatchObject({ flushed: 1, remaining: 0 });
        expect(server.table("posts").get("p1")).toMatchObject({ title: "later" });
    });

    it("gives up on a mutation that keeps being deferred", async () => {
        const server = createFakeServer();
        const onSyncError = jest.fn();
        const { manager, wrap } = createManager(server, { onSyncError, maxRetries: 2 });
        const posts = wrap("posts");
        await posts.find();

        server.state.online = false;
        await posts.create({ title: "stuck" }, "p1");

        server.state.online = true;
        server.rejections.set("create:*", new RebaseApiError("down", { status: 503 }));
        await manager.sync();
        expect(await manager.api.pending()).toHaveLength(1);
        await manager.sync();

        // Otherwise it jams every write queued behind it, forever.
        expect(await manager.api.pending()).toHaveLength(0);
        expect(onSyncError).toHaveBeenCalledTimes(1);
    });

    it("keeps an unsent edit visible while the write before it lands", async () => {
        const server = createFakeServer();
        const { manager, wrap } = createManager(server);
        const posts = wrap("posts");
        await posts.find();

        server.state.online = false;
        await posts.create({ title: "v1", n: 1 }, "p1");
        await posts.create({ title: "unrelated" }, "p2");
        await posts.update("p1", { title: "v2" });

        // Replay the create only, by making the update fail on the network.
        server.state.online = true;
        server.rejections.set("update:p1", new RebaseApiError("Could not reach the server: fetch failed", { status: 0, code: "NETWORK_ERROR" }));
        await manager.sync();

        // The create landed; the update has not — and the row must still show
        // it, or the user watches their edit snap back and then reappear.
        expect(await posts.findById("p1")).toMatchObject({ title: "v2", n: 1 });
        expect(await manager.api.pending()).toHaveLength(1);
    });
});

describe("live queries", () => {
    it("emits from the local database when the network cannot answer", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a" }, "p1");
        await posts.find();

        server.state.online = false;
        const results: LiveResult<Row>[] = [];
        const stop = posts.observe(undefined, (r) => results.push(r));
        await settle();

        // The subscription still delivers, and — once its own revalidation has
        // failed — says the rows came from the local database.
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].data.map((r) => r.id)).toEqual(["p1"]);
        expect(results[results.length - 1].fromCache).toBe(true);
        stop();
    });

    it("re-emits when a local write changes the rows it covers", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a" }, "p1");
        await posts.find();

        const results: LiveResult<Row>[] = [];
        const stop = posts.observe(undefined, (r) => results.push(r));
        await settle();
        const before = results.length;

        server.state.online = false;
        await posts.update("p1", { title: "edited" });
        await settle();

        expect(results.length).toBeGreaterThan(before);
        const last = results[results.length - 1];
        expect(last.data[0].title).toBe("edited");
        expect(last.hasPendingWrites).toBe(true);
        stop();
    });

    it("distinguishes a served-from-cache result from a fresh one", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a" }, "p1");

        const results: LiveResult<Row>[] = [];
        const stop = posts.observe(undefined, (r) => results.push(r));
        await settle();
        // The request completed, so this is the server's answer — a flag that
        // is always `true` tells an interface nothing.
        expect(results[results.length - 1].fromCache).toBe(false);

        server.state.online = false;
        await posts.find();
        await settle();
        expect(results[results.length - 1].fromCache).toBe(true);

        server.state.online = true;
        await posts.find();
        await settle();
        expect(results[results.length - 1].fromCache).toBe(false);
        stop();
    });

    it("reports a single observed row as fresh only while the server has confirmed it", async () => {
        const server = createFakeServer();
        const { manager, wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a" }, "p1");

        const seen: { fromCache: boolean; hasPendingWrites: boolean }[] = [];
        const stop = posts.observeById("p1", (_row, meta) => seen.push(meta));
        await settle();
        expect(seen[seen.length - 1]).toEqual({ fromCache: false, hasPendingWrites: false });

        server.state.online = false;
        await posts.update("p1", { title: "edited offline" });
        await settle();
        expect(seen[seen.length - 1]).toEqual({ fromCache: true, hasPendingWrites: true });

        server.state.online = true;
        await manager.sync();
        await settle();
        expect(seen[seen.length - 1]).toEqual({ fromCache: false, hasPendingWrites: false });
        stop();
    });

    it("does not call back when a refresh changes nothing", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a" }, "p1");
        await posts.find();

        const results: LiveResult<Row>[] = [];
        const stop = posts.observe(undefined, (r) => results.push(r));
        await settle();
        const settled = results.length;

        await posts.find();
        await settle();
        // Re-rendering a list that did not change is the difference between a
        // live query and a polling loop.
        expect(results.length).toBe(settled);
        stop();
    });

    it("stops emitting once unsubscribed", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await posts.find();

        const results: LiveResult<Row>[] = [];
        const stop = posts.observe(undefined, (r) => results.push(r));
        await settle();
        stop();
        const after = results.length;

        server.state.online = false;
        await posts.create({ title: "ignored" });
        await settle();
        expect(results.length).toBe(after);
    });

    it("reports a failed first read instead of emitting an empty list", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        server.state.online = false;

        const results: LiveResult<Row>[] = [];
        const errors: Error[] = [];
        const stop = posts.observe(undefined, (r) => results.push(r), (e) => errors.push(e));
        await settle();

        expect(results).toHaveLength(0);
        expect(errors).toHaveLength(1);
        stop();
    });

    it("observes a single row, including its disappearance", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a" }, "p1");
        await posts.findById("p1");

        const seen: (Row | undefined)[] = [];
        const stop = posts.observeById("p1", (row) => seen.push(row));
        await settle();
        expect(seen[seen.length - 1]).toMatchObject({ title: "a" });

        server.state.online = false;
        await posts.delete("p1");
        await settle();
        expect(seen[seen.length - 1]).toBeUndefined();
        stop();
    });

    it("empties on sign-out instead of leaving the previous user's rows on screen", async () => {
        const server = createFakeServer();
        const { manager, wrap } = createManager(server);
        const posts = wrap("posts");
        manager.setScope("user-a");
        await server.client("posts").create({ title: "a-private" }, "p1");
        await posts.find();

        const results: LiveResult<Row>[] = [];
        const stop = posts.observe(undefined, (r) => results.push(r));
        await settle();
        expect(results[results.length - 1].data).toHaveLength(1);

        server.state.online = false;
        manager.setScope(undefined);
        await settle();

        expect(results[results.length - 1].data).toHaveLength(0);
        stop();
    });

    it("flags a result the local database cannot vouch for", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "searchable" }, "p1");

        const results: LiveResult<Row>[] = [];
        const stop = posts.observe({ searchString: "search" }, (r) => results.push(r));
        await settle();

        // The server ran real full-text search; the local engine only ever
        // approximates it, so a cached answer must say so.
        expect(results[results.length - 1].partial).toBe(true);
        stop();
    });
});

describe("counts", () => {
    it("folds queued writes into a server count", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a", status: "draft" }, "p1");
        const drafts: FindParams = { where: { status: ["==", "draft"] } };
        expect(await posts.count(drafts)).toBe(1);

        server.state.online = false;
        await posts.create({ title: "b", status: "draft" });
        await posts.create({ title: "c", status: "published" });

        // Only the row that matches the filter may move the number.
        expect(await posts.count(drafts)).toBe(2);
    });

    it("subtracts a queued delete", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a" }, "p1");
        await server.client("posts").create({ title: "b" }, "p2");
        await posts.find();
        expect(await posts.count()).toBe(2);

        server.state.online = false;
        await posts.delete("p1");
        expect(await posts.count()).toBe(1);
    });
});

describe("a write made while another is on the wire", () => {
    /**
     * `flush` awaits `replay(op)` with `op` still sitting at the head of the
     * queue, so for the whole duration of that request the in-flight op is also
     * the tail — and both of `enqueue`'s shortcuts reach for the tail.
     */
    it("does not swallow an edit that lands mid-request", async () => {
        const server = createFakeServer();
        const { wrap, manager } = createManager(server);
        const posts = wrap("posts");

        server.state.online = false;
        await posts.create({ title: "first" }, "p1");

        // Park the create so the edit below arrives while it is in flight.
        let release!: () => void;
        server.gates.set("create:p1", new Promise<void>((resolve) => { release = resolve; }));

        server.state.online = true;
        const syncing = manager.sync();
        await settle();

        await posts.update("p1", { title: "edited" });
        release();
        await syncing;
        await manager.sync();

        // Coalesced into the in-flight create, this edit was dropped with it on
        // ACK: never sent, and gone from the queue. The user's second keystroke
        // vanished with no error anywhere.
        expect(server.table("posts").get("p1")).toMatchObject({ title: "edited" });
    });

    it("does not strand a row when a delete cancels out an in-flight create", async () => {
        const server = createFakeServer();
        const { wrap, manager } = createManager(server);
        const posts = wrap("posts");

        server.state.online = false;
        const created = await posts.create({ title: "doomed" });
        const id = String((created as Row).id);

        let release!: () => void;
        server.gates.set(`create:${id}`, new Promise<void>((resolve) => { release = resolve; }));

        server.state.online = true;
        const syncing = manager.sync();
        await settle();

        // Cancel-out assumes the server never saw the create. It is reading it
        // right now, so the row lands — and if the delete is discarded with it,
        // nothing will ever remove it.
        await posts.delete(id);
        release();
        await syncing;
        await manager.sync();

        expect(server.table("posts").has(id)).toBe(false);
    });
});

describe("replaying a create whose response was lost", () => {
    it("keeps the row when the server says it is already there", async () => {
        const server = createFakeServer();
        const errors: Error[] = [];
        const { wrap, manager } = createManager(server, {
            onSyncError: (error) => errors.push(error)
        });
        const posts = wrap("posts");

        server.state.online = false;
        const created = await posts.create({ title: "saved" });
        const id = String((created as Row).id);

        // The first attempt committed; only the ACK was lost. The replay
        // therefore finds the row already present.
        server.table("posts").set(id, { id, title: "saved" });
        server.rejections.set(`create:${id}`, new RebaseApiError("duplicate key", { status: 409, code: "23505" }));

        server.state.online = true;
        await manager.sync();

        // Read with the network down, or this falls through to the server and
        // passes on the row seeded above no matter what the local store did —
        // which is exactly how this test first passed against the bug.
        server.state.online = false;
        // The old behaviour rolled the write back and deleted the local row —
        // the one case where the row genuinely exists on the server.
        expect(await posts.findById(id)).toMatchObject({ title: "saved" });
        expect(errors).toHaveLength(0);
        expect(manager.api.status().pending).toBe(0);
    });

    it("still reports a real conflict on a caller-supplied id", async () => {
        const server = createFakeServer();
        const errors: Error[] = [];
        const { wrap, manager } = createManager(server, {
            onSyncError: (error) => errors.push(error)
        });
        const posts = wrap("posts");

        server.state.online = false;
        // The caller chose this id, so a duplicate may well be someone else's
        // row. Swallowing that would hide a genuine collision.
        await posts.create({ title: "mine" }, "chosen-1");
        server.rejections.set("create:chosen-1", new RebaseApiError("duplicate key", { status: 409, code: "23505" }));

        server.state.online = true;
        await manager.sync();

        expect(errors).toHaveLength(1);
        expect(manager.api.status().pending).toBe(0);
    });
});

/**
 * A backend that keeps idempotency keys the way the real one does: a key is
 * claimed for one request — method, path and body — so the same key on the
 * same request replays the stored answer, and on a different one is refused
 * with 422 `IDEMPOTENCY_KEY_REUSED`. `loseNextAnswer` commits a write and
 * then fails the request as the network would: the row exists, the client
 * never hears so.
 */
function createKeyedServer() {
    const rows = new Map<string, Row>();
    const keys = new Map<string, { fingerprint: string; answer: unknown }>();
    const sent: { op: string; key?: string; body: unknown }[] = [];
    const state = { online: true, loseNextAnswer: false };
    let serial = 0;

    function keyed<T>(op: string, body: unknown, key: string | undefined, write: () => T): T {
        sent.push({ op, key, body });
        if (!state.online) throw new RebaseApiError("Could not reach the server: fetch failed", { status: 0, code: "NETWORK_ERROR" });
        const fingerprint = `${op} ${JSON.stringify(body)}`;
        const claimed = key ? keys.get(key) : undefined;
        if (claimed) {
            if (claimed.fingerprint !== fingerprint) {
                throw new RebaseApiError("Idempotency key reused", { status: 422, code: "IDEMPOTENCY_KEY_REUSED" });
            }
            return claimed.answer as T;
        }
        const answer = write();
        if (key) keys.set(key, { fingerprint, answer });
        if (state.loseNextAnswer) {
            state.loseNextAnswer = false;
            throw new RebaseApiError("Could not reach the server: socket hang up", { status: 0, code: "NETWORK_ERROR" });
        }
        return answer;
    }

    function insert(data: Row): Row {
        const id = data.id ?? `srv-${++serial}`;
        const row = { ...data, id };
        rows.set(String(id), row);
        return row;
    }

    const client = {
        async create(data: Row, id?: string | number, options?: WriteOptions) {
            const body = id === undefined ? { ...data } : { ...data, id };
            return keyed("create", body, options?.idempotencyKey, () => insert(body));
        },
        async createMany(data: Row[], options?: { upsert?: boolean; onConflict?: readonly string[] } & WriteOptions) {
            const body = {
                rows: data,
                ...(options?.upsert ? { upsert: true } : {}),
                ...(options?.onConflict?.length ? { onConflict: options.onConflict } : {})
            };
            return keyed("createMany", body, options?.idempotencyKey, () => data.map(insert));
        },
        async update(id: string | number, data: Row) {
            if (!state.online) throw new RebaseApiError("Could not reach the server: fetch failed", { status: 0, code: "NETWORK_ERROR" });
            const existing = rows.get(String(id));
            if (!existing) throw new RebaseApiError("Not found", { status: 404 });
            const row = { ...existing, ...data, id };
            rows.set(String(id), row);
            return row;
        },
        async delete(id: string | number) {
            if (!state.online) throw new RebaseApiError("Could not reach the server: fetch failed", { status: 0, code: "NETWORK_ERROR" });
            rows.delete(String(id));
        },
        async findById(id: string | number) {
            return rows.get(String(id));
        },
        async find() {
            return runLocalQuery([...rows.values()], undefined);
        },
        async count() {
            return rows.size;
        }
    };

    function manager(onSyncError?: (error: Error) => void, syncIntervalMs = 0) {
        const inner = client as unknown as CollectionClient<Row>;
        const offline = new OfflineManager({ store: new MemoryOfflineStore(), syncIntervalMs, onSyncError }, () => inner);
        return { offline, posts: offline.wrap("posts", inner) };
    }

    return { rows, sent, state, manager };
}

describe("a write whose answer was lost before it was queued", () => {
    it("replays a create under the key and request it was first sent with", async () => {
        const server = createKeyedServer();
        const errors: Error[] = [];
        const { offline, posts } = server.manager((error) => errors.push(error));

        // Committed on the server; the response never arrives.
        server.state.loseNextAnswer = true;
        const local = await posts.create({ title: "Hello" });
        await offline.sync();

        // One row, not two. The replay went out under the first attempt's
        // key; the server, holding that key for the request without the
        // locally minted id, refused it — and that request, sent again, was
        // answered from the server's record of the first.
        expect([...server.rows.values()]).toEqual([{ id: "srv-1", title: "Hello" }]);
        const key = server.sent[0].key;
        expect(key).toBeDefined();
        expect(server.sent.map((s) => s.key)).toEqual([key, key, key]);
        expect(server.sent[1].body).toEqual({ title: "Hello", id: (local as Row).id });
        expect(server.sent[2]).toEqual(server.sent[0]);
        expect(errors).toEqual([]);
        expect(offline.api.status().pending).toBe(0);
        // The local row has moved to the id the server gave it.
        expect(await posts.findById("srv-1")).toMatchObject({ title: "Hello" });
        expect(await posts.findById(String((local as Row).id))).toBeUndefined();
    });

    it("sends the caller's own write options, and replays under the caller's key", async () => {
        const server = createKeyedServer();
        const { offline, posts } = server.manager();

        server.state.loseNextAnswer = true;
        await posts.create({ title: "Hello" }, undefined, { idempotencyKey: "caller-key" });
        await offline.sync();

        expect(new Set(server.sent.map((s) => s.key))).toEqual(new Set(["caller-key"]));
        expect(server.rows.size).toBe(1);
    });

    it("keeps the id it was given here when the first attempt never arrived", async () => {
        const server = createKeyedServer();
        const errors: Error[] = [];
        const { offline, posts } = server.manager((error) => errors.push(error));

        server.state.online = false;
        const parent = await posts.create({ title: "Project" });
        // A later offline write can refer to the row by the id it was handed.
        await posts.create({ title: "Task", parent_id: (parent as Row).id });
        server.state.online = true;
        await offline.sync();

        expect(errors).toEqual([]);
        expect(server.rows.get(String((parent as Row).id))).toMatchObject({ title: "Project" });
        expect(server.sent[0].key).toBe(server.sent[2].key);
    });

    it("replays a createMany under the key and request it was first sent with", async () => {
        const server = createKeyedServer();
        const errors: Error[] = [];
        const { offline, posts } = server.manager((error) => errors.push(error));

        server.state.loseNextAnswer = true;
        await posts.createMany([{ title: "a" }, { title: "b" }]);
        await offline.sync();

        expect([...server.rows.values()].map((r) => r.title)).toEqual(["a", "b"]);
        expect(server.sent.at(-1)).toEqual(server.sent[0]);
        expect(errors).toEqual([]);
        expect((await posts.findById("srv-1"))?.title).toBe("a");
        expect((await posts.findById("srv-2"))?.title).toBe("b");
    });

    it("does not cancel it against a later delete: the server may already hold the row", async () => {
        const server = createKeyedServer();
        const { offline, posts } = server.manager();

        server.state.loseNextAnswer = true;
        const local = await posts.create({ title: "Hello" });
        // Offline now, so the delete is queued behind the create.
        await posts.delete((local as Row).id as string);
        await offline.sync();

        expect(server.rows.size).toBe(0);
        expect(offline.api.status().pending).toBe(0);
    });

    it("keeps an edit made after it as a write of its own", async () => {
        const server = createKeyedServer();
        const errors: Error[] = [];
        const { offline, posts } = server.manager((error) => errors.push(error));

        server.state.loseNextAnswer = true;
        const local = await posts.create({ title: "Hello" });
        await posts.update((local as Row).id as string, { title: "Hello, edited" });
        await offline.sync();

        expect(errors).toEqual([]);
        expect([...server.rows.values()]).toEqual([{ id: "srv-1", title: "Hello, edited" }]);
    });

    it("replays a natural-key upsert batch only as the request it was sent as", async () => {
        const server = createKeyedServer();
        const { offline, posts } = server.manager();

        server.state.loseNextAnswer = true;
        await posts.createMany([{ email: "a@b.c" }], { upsert: true, onConflict: ["email"] });
        await offline.sync();

        expect(server.sent).toHaveLength(2);
        expect(server.sent[1]).toEqual(server.sent[0]);
        expect(server.rows.size).toBe(1);
    });

    it("refuses a natural-key upsert batch it would have to invent ids for", async () => {
        const server = createKeyedServer();
        const { posts } = server.manager(undefined, 60_000);
        server.state.online = false;
        // Learn that the network is gone, so the next write is not attempted.
        await posts.create({ title: "x" });

        await expect(posts.createMany([{ email: "a@b.c" }], { upsert: true, onConflict: ["email"] }))
            .rejects.toMatchObject({ code: "OFFLINE_UPSERT_UNSUPPORTED" });
    });
});

/**
 * A backend that honours `fields` the way the real one does: only the columns
 * asked for, plus the key. `push` delivers a realtime frame to whoever is
 * listening, projected the same way.
 */
function createProjectingServer() {
    const rows = new Map<string, Row>([
        ["1", { id: 1, title: "A", body: "long text", author_id: 7 }],
        ["2", { id: 2, title: "B", body: "more text", author_id: 8 }]
    ]);
    const state = { online: true };
    const listeners: { params?: FindParams; onUpdate: (result: FindResult<Row>) => void }[] = [];

    function unreachable() {
        return new RebaseApiError("Could not reach the server: fetch failed", { status: 0, code: "NETWORK_ERROR" });
    }

    function project(row: Row, params?: FindParams): Row {
        if (!params?.fields?.length) return { ...row };
        const keep = new Set(["id", ...params.fields]);
        return Object.fromEntries(Object.entries(row).filter(([key]) => keep.has(key)));
    }

    function answer(params?: FindParams): FindResult<Row> {
        const result = runLocalQuery([...rows.values()], params);
        return { ...result, data: result.data.map((row) => project(row, params)) };
    }

    const client = {
        async find(params?: FindParams) {
            if (!state.online) throw unreachable();
            return answer(params);
        },
        async findById(id: string | number) {
            if (!state.online) throw unreachable();
            const row = rows.get(String(id));
            return row ? { ...row } : undefined;
        },
        async create(data: Row, id?: string | number) {
            if (!state.online) throw unreachable();
            const row = { ...data, id: id ?? data.id ?? rows.size + 1 };
            rows.set(String(row.id), row);
            return { ...row };
        },
        async update(id: string | number, data: Row) {
            if (!state.online) throw unreachable();
            const row = { ...rows.get(String(id)), ...data, id };
            rows.set(String(id), row);
            return { ...row };
        },
        async count() {
            return rows.size;
        },
        listen(params: FindParams | undefined, onUpdate: (result: FindResult<Row>) => void) {
            const entry = { params, onUpdate };
            listeners.push(entry);
            return () => { listeners.splice(listeners.indexOf(entry), 1); };
        }
    };

    function manager(store = new MemoryOfflineStore()) {
        const inner = client as unknown as CollectionClient<Row>;
        const offline = new OfflineManager({ store, syncIntervalMs: 0 }, () => inner);
        return { offline, store, posts: offline.wrap("posts", inner) };
    }

    return {
        rows,
        state,
        manager,
        push() { for (const { params, onUpdate } of [...listeners]) onUpdate(answer(params)); }
    };
}

describe("a projected read", () => {
    it("does not overwrite the full rows every other query shows", async () => {
        const server = createProjectingServer();
        const { posts, store } = server.manager();
        const emissions: Row[][] = [];
        const stop = posts.observe(undefined, (result) => emissions.push(result.data as Row[]));
        await settle();
        expect(Object.keys(emissions.at(-1)![0]).sort()).toEqual(["author_id", "body", "id", "title"]);

        // A dropdown elsewhere asks for titles only.
        const titles = await posts.find({ fields: ["title"] });
        await settle();

        expect(titles.data).toEqual([{ id: 1, title: "A" }, { id: 2, title: "B" }]);
        expect(emissions.at(-1)).toEqual([...server.rows.values()]);
        stop();

        // …and nothing narrower was written to disk either.
        server.state.online = false;
        const reopened = server.manager(store).posts;
        expect(await reopened.findById(1)).toEqual(server.rows.get("1"));
    });

    it("answers from the server's projection, and serves it again offline", async () => {
        const server = createProjectingServer();
        const { posts } = server.manager();

        expect((await posts.find({ fields: ["title"] })).data).toEqual([{ id: 1, title: "A" }, { id: 2, title: "B" }]);

        server.state.online = false;
        const cached = await posts.find({ fields: ["title"] });
        expect(cached.data).toEqual([{ id: 1, title: "A" }, { id: 2, title: "B" }]);
        // A projection is not a row: nothing was stored to answer this from.
        await expect(posts.findById(1)).rejects.toThrow(/not in the local database/);
    });

    it("refreshes the columns it carries on rows already held", async () => {
        const server = createProjectingServer();
        const { posts } = server.manager();
        await posts.find();
        server.rows.set("1", { ...server.rows.get("1"), title: "A, renamed" });

        await posts.find({ fields: ["title"] });

        server.state.online = false;
        expect(await posts.findById(1)).toEqual({ id: 1, title: "A, renamed", body: "long text", author_id: 7 });
    });

    it("shows a local edit in the shape the server answered", async () => {
        const server = createProjectingServer();
        const { posts } = server.manager();
        await posts.find();
        await posts.find({ fields: ["title"] });

        server.state.online = false;
        await posts.update(1, { title: "A, edited offline" });
        const cached = await posts.find({ fields: ["title"] });

        expect(cached.data).toEqual([{ id: 1, title: "A, edited offline" }, { id: 2, title: "B" }]);
    });

    it("lists a row created here in a projected list it belongs to, narrowed like the rest", async () => {
        const server = createProjectingServer();
        const { posts } = server.manager();
        await posts.find({ fields: ["title"] });

        server.state.online = false;
        const created = await posts.create({ title: "C", body: "drafted offline" });
        const cached = await posts.find({ fields: ["title"] });

        expect(cached.data).toEqual([{ id: 1, title: "A" }, { id: 2, title: "B" }, { id: (created as Row).id, title: "C" }]);
    });

    it("says a projection is partial when a row created here cannot be placed in it", async () => {
        const server = createProjectingServer();
        const { posts } = server.manager();
        // Ordered on a column the projection does not carry.
        const params: FindParams = { fields: ["title"], orderBy: [["author_id", "asc"]] };
        await posts.find(params);

        server.state.online = false;
        await posts.create({ title: "C", author_id: 1 });
        const results: LiveResult<Row>[] = [];
        const stop = posts.observe(params, (result) => results.push(result));
        await settle();
        stop();

        expect(results.at(-1)?.data.map((row) => row.title)).toEqual(["A", "B"]);
        expect(results.at(-1)?.partial).toBe(true);
    });

    it("keeps a projected answer across a reload, values revived", async () => {
        const server = createProjectingServer();
        server.rows.set("1", { ...server.rows.get("1"), where: new GeoPoint(41.9, 12.5) });
        const { posts, store } = server.manager();
        await posts.find({ fields: ["where"] });

        server.state.online = false;
        const reopened = server.manager(store).posts;
        const cached = await reopened.find({ fields: ["where"] });

        expect(cached.data[0].where).toBeInstanceOf(GeoPoint);
        expect(cached.data[0]).toEqual({ id: 1, where: new GeoPoint(41.9, 12.5) });
    });

    it("does not vouch for a whole row it carried only part of", async () => {
        const server = createProjectingServer();
        const first = server.manager();
        await first.posts.find();
        // A reload: the rows are on disk, none of them confirmed this session.
        const { posts } = server.manager(first.store);
        await posts.find({ fields: ["title"] });

        server.state.online = false;
        const metas: RowSnapshotMeta[] = [];
        const stop = posts.observeById(1, (_row, meta) => metas.push(meta));
        await settle();
        stop();

        expect(metas.at(-1)?.fromCache).toBe(true);
    });

    it("re-emits a projected live query when the server's values change", async () => {
        const server = createProjectingServer();
        const { posts } = server.manager();
        const emissions: Row[][] = [];
        const stop = posts.observe({ fields: ["title"] }, (result) => emissions.push(result.data as Row[]));
        await settle();
        expect(emissions.at(-1)).toEqual([{ id: 1, title: "A" }, { id: 2, title: "B" }]);

        server.rows.set("2", { ...server.rows.get("2"), title: "B, renamed" });
        server.push();
        await settle();

        expect(emissions.at(-1)).toEqual([{ id: 1, title: "A" }, { id: 2, title: "B, renamed" }]);
        stop();
    });

    it("keeps full rows when a realtime frame carries a projection", async () => {
        const server = createProjectingServer();
        const { posts } = server.manager();
        await posts.find();
        const frames: Row[][] = [];
        const stop = posts.listen({ fields: ["title"] }, (result) => frames.push(result.data as Row[]));

        server.push();
        await settle();
        stop();

        expect(frames).toEqual([[{ id: 1, title: "A" }, { id: 2, title: "B" }]]);
        server.state.online = false;
        expect(await posts.findById(2)).toEqual(server.rows.get("2"));
    });
});
