import { jest } from "@jest/globals";
import { OfflineManager, type LiveResult, type OfflineStatus } from "./offline";
import { MemoryOfflineStore, type PendingMutation } from "./offline-store";
import { RebaseApiError } from "./transport";
import type { CollectionClient } from "./collection";
import type { FindParams } from "./transport";
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

    function guard(slug: string, op: string, id?: unknown) {
        calls.push({ collection: slug, op, id });
        if (!state.online) throw new TypeError("fetch failed");
        const rejection = rejections.get(`${op}:${String(id)}`) ?? rejections.get(`${op}:*`);
        if (rejection) throw rejection;
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
        server.rejections.set("update:p1", new TypeError("fetch failed"));
        await manager.sync();

        // The create landed; the update has not — and the row must still show
        // it, or the user watches their edit snap back and then reappear.
        expect(await posts.findById("p1")).toMatchObject({ title: "v2", n: 1 });
        expect(await manager.api.pending()).toHaveLength(1);
    });
});

describe("live queries", () => {
    it("emits from the local database before the network answers", async () => {
        const server = createFakeServer();
        const { wrap } = createManager(server);
        const posts = wrap("posts");
        await server.client("posts").create({ title: "a" }, "p1");
        await posts.find();

        const results: LiveResult<Row>[] = [];
        const stop = posts.observe(undefined, (r) => results.push(r));
        await settle();

        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].data.map((r) => r.id)).toEqual(["p1"]);
        expect(results[0].fromCache).toBe(true);
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
