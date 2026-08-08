import { jest } from "@jest/globals";
import { isOfflineError, OfflineManager } from "./offline";
import { MemoryOfflineStore, PendingMutation } from "./offline-store";
import { RebaseApiError } from "./transport";
import type { CollectionClient } from "./collection";
import type { FindParams } from "./transport";

type Row = Record<string, unknown>;

/**
 * A fake collection client backed by an in-memory table, with a switch that
 * makes every call fail the way fetch does when the network is down. This is
 * exactly the failure the manager keys on, so the tests exercise the real
 * online/offline decision logic rather than a mock of it.
 */
function createFakeServer() {
    const state: { online: boolean; rejectNextCreate?: Error; rejectEveryCreate?: Error } = { online: true };
    const tables = new Map<string, Map<string, Row>>();
    const log: { collection: string; op: string; id?: unknown; ids?: unknown[]; upsert?: boolean }[] = [];

    function table(slug: string): Map<string, Row> {
        if (!tables.has(slug)) tables.set(slug, new Map());
        return tables.get(slug)!;
    }

    function assertOnline() {
        if (!state.online) throw new TypeError("fetch failed");
    }

    function client(slug: string): CollectionClient<Row> {
        const rows = () => [...table(slug).values()];
        const fake = {
            async find(_params?: FindParams) {
                assertOnline();
                const data = rows();
                return { data, meta: { total: data.length, limit: 20, offset: 0, hasMore: false } };
            },
            async findById(id: string | number) {
                assertOnline();
                return table(slug).get(String(id));
            },
            async create(data: Partial<Row>, id?: string | number) {
                assertOnline();
                // Lets a test answer the first replay the way a server does
                // when it is still holding this write's idempotency key.
                const injected = state.rejectNextCreate ?? state.rejectEveryCreate;
                if (injected) {
                    state.rejectNextCreate = undefined;
                    throw injected;
                }
                const rowId = id ?? data.id ?? `srv-${table(slug).size + 1}`;
                log.push({ collection: slug, op: "create", id: rowId });
                const row = { ...data, id: rowId };
                table(slug).set(String(rowId), row);
                return row;
            },
            async createMany(data: Partial<Row>[], options?: { upsert?: boolean }) {
                assertOnline();
                log.push({ collection: slug, op: "createMany", upsert: options?.upsert });
                return data.map((d) => {
                    const row = { ...d, id: d.id ?? `srv-${table(slug).size + 1}` };
                    table(slug).set(String(row.id), row);
                    return row;
                });
            },
            async update(id: string | number, data: Partial<Row>) {
                assertOnline();
                log.push({ collection: slug, op: "update", id });
                const existing = table(slug).get(String(id));
                if (!existing) {
                    throw new RebaseApiError("Not found", { status: 404 });
                }
                const row = { ...existing, ...data };
                table(slug).set(String(id), row);
                return row;
            },
            async updateMany(updates: { id: string | number; data: Partial<Row> }[]) {
                assertOnline();
                log.push({ collection: slug, op: "updateMany", ids: updates.map(u => u.id) });
                return updates.map(({ id, data }) => {
                    const existing = table(slug).get(String(id));
                    if (!existing) throw new RebaseApiError("Not found", { status: 404 });
                    const row = { ...existing, ...data };
                    table(slug).set(String(id), row);
                    return row;
                });
            },
            async delete(id: string | number) {
                assertOnline();
                log.push({ collection: slug, op: "delete", id });
                table(slug).delete(String(id));
            },
            async deleteMany(ids: (string | number)[]) {
                assertOnline();
                log.push({ collection: slug, op: "deleteMany", ids });
                for (const id of ids) {
                    if (!table(slug).has(String(id))) throw new RebaseApiError("Not found", { status: 404 });
                }
                for (const id of ids) table(slug).delete(String(id));
            },
            async count(_params?: FindParams) {
                assertOnline();
                return table(slug).size;
            }
        };
        return fake as unknown as CollectionClient<Row>;
    }

    return { state, table, log, client };
}

function createManager(server: ReturnType<typeof createFakeServer>, options: {
    onSyncError?: (error: Error, mutation: PendingMutation) => void;
    store?: MemoryOfflineStore;
} = {}) {
    const store = options.store ?? new MemoryOfflineStore();
    const manager = new OfflineManager(
        { store, syncIntervalMs: 0, onSyncError: options.onSyncError },
        (slug) => server.client(slug)
    );
    const wrap = (slug: string) => manager.wrap(slug, server.client(slug));
    return { manager, store, wrap };
}

describe("OfflineManager", () => {
    describe("cached reads", () => {
        it("serves the last cached find result when the network fails", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "hello" }, "p1");

            const online = await posts.find();
            expect(online.data).toHaveLength(1);

            server.state.online = false;
            const offline = await posts.find();
            expect(offline.data).toEqual(online.data);
            expect(offline.meta.total).toBe(1);
        });

        it("reports an offline read that has nothing local to answer with", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            server.state.online = false;
            const error = await wrap("posts").find().catch((e) => e);
            // A typed, recognisable failure rather than fetch's bare TypeError:
            // "you are offline and I have nothing" is a distinct condition from
            // "the request blew up", and apps need to tell them apart.
            expect(isOfflineError(error)).toBe(true);
            expect(error.message).toContain("posts");
        });

        it("does not swallow server errors into the cache path", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            const posts = wrap("posts");
            await posts.find(); // caches an empty result
            await expect(posts.update("missing", { title: "x" })).rejects.toThrow(RebaseApiError);
        });

        it("serves a cached findById and count when offline", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "hello" }, "p1");

            expect(await posts.findById("p1")).toMatchObject({ title: "hello" });
            expect(await posts.count()).toBe(1);

            server.state.online = false;
            expect(await posts.findById("p1")).toMatchObject({ title: "hello" });
            expect(await posts.count()).toBe(1);
        });
    });

    describe("offline writes", () => {
        it("queues an offline create and returns an optimistic row with a generated id", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            server.state.online = false;

            const row = await posts.create({ title: "draft" });
            expect(row.title).toBe("draft");
            expect(typeof row.id).toBe("string");

            const pending = await manager.api.pending();
            expect(pending).toHaveLength(1);
            expect(pending[0]).toMatchObject({ collection: "posts", type: "create" });

            // The app immediately sees its own write.
            expect(await posts.findById(row.id as string)).toMatchObject({ title: "draft" });
        });

        it("overlays queued creates, updates and deletes onto cached finds", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "a" }, "p1");
            await server.client("posts").create({ title: "b" }, "p2");
            await posts.find();
            await posts.count();

            server.state.online = false;
            const created = await posts.create({ title: "c" });
            await posts.update("p1", { title: "a2" });
            await posts.delete("p2");

            const res = await posts.find();
            expect(res.data.map((r) => r.title).sort()).toEqual(["a2", "c"]);
            expect(res.meta.total).toBe(2);
            expect(res.data.find((r) => r.id === created.id)).toBeDefined();
            expect(await posts.count()).toBe(2);
        });

        it("puts an offline create into the filtered lists it belongs to, and only those", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "a", status: "draft" }, "p1");
            const drafts: FindParams = { where: { status: ["==", "draft"] } };
            const published: FindParams = { where: { status: ["==", "published"] } };
            await posts.find(drafts);
            await posts.find(published);

            server.state.online = false;
            await posts.create({ title: "b", status: "draft" });
            await posts.update("p1", { title: "a2" });

            const inDrafts = await posts.find(drafts);
            expect(inDrafts.data.map((r) => r.title).sort()).toEqual(["a2", "b"]);
            expect(inDrafts.meta.total).toBe(2);

            // The same row must not leak into a list whose filter it fails.
            expect((await posts.find(published)).data).toHaveLength(0);
        });

        it("takes a row out of a list when an offline edit moves it out of the filter", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "a", status: "draft" }, "p1");
            await server.client("posts").create({ title: "b", status: "draft" }, "p2");
            const drafts: FindParams = { where: { status: ["==", "draft"] } };
            await posts.find(drafts);

            server.state.online = false;
            await posts.update("p1", { status: "published" });

            const res = await posts.find(drafts);
            expect(res.data.map((r) => r.id)).toEqual(["p2"]);
            expect(res.meta.total).toBe(1);
        });

        it("reports a pending delete of a cached row as gone", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "a" }, "p1");
            await posts.findById("p1");

            server.state.online = false;
            await posts.delete("p1");
            expect(await posts.findById("p1")).toBeUndefined();
        });
    });

    describe("sync", () => {
        it("replays queued mutations in the order they were made", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "old" }, "p0");
            server.log.length = 0;

            // Two different rows, so tail coalescing (tested separately)
            // cannot collapse the queue and hide the ordering.
            server.state.online = false;
            const row = await posts.create({ title: "draft" });
            await posts.update("p0", { title: "final" });

            server.state.online = true;
            const result = await manager.sync();
            expect(result).toEqual({ flushed: 2, remaining: 0 });
            expect(server.log.map((l) => l.op)).toEqual(["create", "update"]);
            expect(server.table("posts").get(String(row.id))).toMatchObject({ title: "draft" });
            expect(server.table("posts").get("p0")).toMatchObject({ title: "final" });
            expect(await manager.api.pending()).toHaveLength(0);
        });

        it("keeps the queue when the network is still down", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            server.state.online = false;
            await wrap("posts").create({ title: "draft" });

            const result = await manager.sync();
            expect(result).toEqual({ flushed: 0, remaining: 1 });
            expect(await manager.api.pending()).toHaveLength(1);
        });

        it("drops a server-rejected mutation, reports it, and keeps flushing", async () => {
            const server = createFakeServer();
            const onSyncError = jest.fn<(error: Error, mutation: PendingMutation) => void>();
            const { manager, wrap } = createManager(server, { onSyncError });
            const posts = wrap("posts");

            server.state.online = false;
            await posts.update("does-not-exist", { title: "x" }); // will 404 on replay
            await posts.create({ title: "kept" }, "p9");

            server.state.online = true;
            const result = await manager.sync();
            expect(result).toEqual({ flushed: 1, remaining: 0 });
            expect(onSyncError).toHaveBeenCalledTimes(1);
            expect(onSyncError.mock.calls[0][1]).toMatchObject({ type: "update", id: "does-not-exist" });
            expect(server.table("posts").get("p9")).toMatchObject({ title: "kept" });
        });

        it("keeps a write the server is still answering, and lands it on the next flush", async () => {
            // `IDEMPOTENCY_KEY_IN_PROGRESS` means the server holds this write's
            // key and has not answered yet — the row may not exist at all. Read
            // as any other 409 it looked like "your row is already there": the
            // queue looked the row up, found nothing, decided there was nothing
            // left to do and deleted the write. The record survived only in the
            // local store and disappeared at the next reconciliation, silently.
            const server = createFakeServer();
            const onSyncError = jest.fn<(error: Error, mutation: PendingMutation) => void>();
            const { manager, wrap } = createManager(server, { onSyncError });

            server.state.online = false;
            await wrap("posts").create({ title: "queued" });

            server.state.online = true;
            server.state.rejectNextCreate = new RebaseApiError("still in progress", {
                status: 409,
                code: "IDEMPOTENCY_KEY_IN_PROGRESS"
            });

            const refused = await manager.sync();
            expect(refused).toEqual({ flushed: 0, remaining: 1 });
            expect(onSyncError).not.toHaveBeenCalled();
            expect(server.table("posts").size).toBe(0);

            // The claim expired (or its request finally answered): the same
            // queued write goes through untouched.
            const settled = await manager.sync();
            expect(settled).toEqual({ flushed: 1, remaining: 0 });
            expect([...server.table("posts").values()]).toMatchObject([{ title: "queued" }]);
        });

        it("outlasts the claim's lease rather than giving up on the default retry budget", async () => {
            // Retries double from a second, so the five a busy server gets are
            // spent inside half a minute — less than the lease the server gives
            // a claim whose process died. Spending them here would roll back
            // the write a few seconds before the key became free again.
            const server = createFakeServer();
            const onSyncError = jest.fn<(error: Error, mutation: PendingMutation) => void>();
            const { manager, wrap } = createManager(server, { onSyncError });

            server.state.online = false;
            await wrap("posts").create({ title: "queued" });

            server.state.online = true;
            server.state.rejectEveryCreate = new RebaseApiError("still in progress", {
                status: 409,
                code: "IDEMPOTENCY_KEY_IN_PROGRESS"
            });
            for (let attempt = 0; attempt < 8; attempt++) await manager.sync();

            expect(onSyncError).not.toHaveBeenCalled();
            expect(await manager.api.pending()).toHaveLength(1);

            server.state.rejectEveryCreate = undefined;
            expect(await manager.sync()).toEqual({ flushed: 1, remaining: 0 });
        });

        it("notifies queue-size listeners as writes queue and drain", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const counts: number[] = [];
            manager.api.onQueueChange((n) => counts.push(n));

            server.state.online = false;
            await wrap("posts").create({ title: "a" });
            server.state.online = true;
            await manager.sync();

            expect(counts).toContain(1);
            expect(counts[counts.length - 1]).toBe(0);
        });
    });

    describe("per-user scoping", () => {
        it("a scope switch during a slow queue load cannot leak the old user's queue", async () => {
            const server = createFakeServer();
            const store = new MemoryOfflineStore();

            // Seed user A's persisted queue from a previous "session".
            const seeder = createManager(server, { store });
            seeder.manager.setScope("user-a");
            server.state.online = false;
            await seeder.wrap("posts").create({ title: "a-op" }, "pa");
            seeder.manager.dispose();

            // A store whose queue load resolves only when released — the
            // scope switch lands while user A's load is still in flight.
            let release!: () => void;
            const gate = new Promise<void>((resolve) => { release = resolve; });
            const slowStore = Object.create(store) as MemoryOfflineStore;
            slowStore.listQueue = async (prefix: string) => {
                if (prefix === "user-a|") await gate;
                return store.listQueue(prefix);
            };

            const { manager } = createManager(server, { store: slowStore as MemoryOfflineStore });
            manager.setScope("user-a");
            const stalled = manager.api.pending(); // starts the gated load
            manager.setScope("user-b");
            const pendingB = await manager.api.pending();
            release();
            await stalled.catch(() => undefined);

            expect(pendingB).toHaveLength(0);
            expect(await manager.api.pending()).toHaveLength(0);
        });

        it("never serves one user's cache or queue to another", async () => {
            const server = createFakeServer();
            const store = new MemoryOfflineStore();
            const { manager, wrap } = createManager(server, { store });
            const posts = wrap("posts");

            manager.setScope("user-a");
            await server.client("posts").create({ title: "a-private" }, "p1");
            await posts.find();
            server.state.online = false;
            await posts.create({ title: "a-pending" });
            expect(await manager.api.pending()).toHaveLength(1);

            manager.setScope("user-b");
            expect(await manager.api.pending()).toHaveLength(0);
            expect(isOfflineError(await posts.find().catch((e) => e))).toBe(true);

            // Coming back, user A finds both again.
            manager.setScope("user-a");
            expect(await manager.api.pending()).toHaveLength(1);
            expect((await posts.find()).data.some((r) => r.title === "a-private")).toBe(true);
        });
    });

    describe("coalescing", () => {
        it("merges an update into the queued create it edits", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            server.state.online = false;

            const row = await posts.create({ title: "draft", status: "new" });
            await posts.update(row.id as string, { title: "draft 2" });
            await posts.update(row.id as string, { title: "draft 3" });

            const pending = await manager.api.pending();
            expect(pending).toHaveLength(1);
            expect(pending[0]).toMatchObject({ type: "create" });
            expect(pending[0].data).toMatchObject({ title: "draft 3", status: "new", id: row.id });

            server.state.online = true;
            await manager.sync();
            expect(server.log).toHaveLength(1);
            expect(server.table("posts").get(String(row.id))).toMatchObject({ title: "draft 3" });
        });

        it("merges consecutive updates to the same row", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "a", views: 0 }, "p1");
            server.state.online = false;

            await posts.update("p1", { title: "b" });
            await posts.update("p1", { views: 1 });

            const pending = await manager.api.pending();
            expect(pending).toHaveLength(1);
            expect(pending[0].data).toMatchObject({ title: "b", views: 1 });
        });

        it("never merges across an op for a different row — order is preserved", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "a" }, "pa");
            await server.client("posts").create({ title: "b" }, "pb");
            server.log.length = 0;
            server.state.online = false;

            await posts.update("pa", { title: "a1" });
            await posts.update("pb", { title: "b1" });
            await posts.update("pa", { title: "a2" });

            expect(await manager.api.pending()).toHaveLength(3);
            server.state.online = true;
            await manager.sync();
            expect(server.log.map((l) => l.id)).toEqual(["pa", "pb", "pa"]);
            expect(server.table("posts").get("pa")).toMatchObject({ title: "a2" });
        });

        it("cancels a queued create (and its updates) when the row is deleted offline", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            server.state.online = false;

            const row = await posts.create({ title: "ephemeral" });
            await posts.update(row.id as string, { title: "edited" });
            await posts.delete(row.id as string);

            expect(await manager.api.pending()).toHaveLength(0);
            server.state.online = true;
            expect(await manager.sync()).toEqual({ flushed: 0, remaining: 0 });
            expect(server.log).toHaveLength(0);
        });

        it("does not cancel out a create that reused a caller-supplied id — the delete must reach the server", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "original" }, "p1");
            server.log.length = 0;
            server.state.online = false;

            // The offline create's id names a row the server already has, so
            // dropping create+delete as a no-op pair would resurrect it.
            await posts.create({ title: "replacement" }, "p1");
            await posts.delete("p1");

            expect(await manager.api.pending()).toHaveLength(2);
            server.state.online = true;
            await manager.sync();
            expect(server.table("posts").has("p1")).toBe(false);
        });

        it("still queues the delete of a row the server already has", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "a" }, "p1");
            server.log.length = 0;
            server.state.online = false;

            await posts.update("p1", { title: "a1" });
            await posts.delete("p1");

            // No pending create for p1, so nothing cancels: the update and
            // the delete replay in order.
            expect(await manager.api.pending()).toHaveLength(2);
            server.state.online = true;
            await manager.sync();
            expect(server.log.map((l) => l.op)).toEqual(["update", "delete"]);
            expect(server.table("posts").has("p1")).toBe(false);
        });
    });

    describe("createMany", () => {
        it("queues a bulk create offline, overlays it, and replays it with its upsert flag", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            await posts.find();
            server.state.online = false;

            const rows = await posts.createMany([{ title: "a" }, { title: "b" }], { upsert: true });
            expect(rows).toHaveLength(2);
            expect(rows.every((r) => typeof r.id === "string")).toBe(true);

            const overlaid = await posts.find();
            expect(overlaid.data.map((r) => r.title)).toEqual(["a", "b"]);
            expect(overlaid.meta.total).toBe(2);
            expect(await posts.findById(rows[0].id as string)).toMatchObject({ title: "a" });

            server.state.online = true;
            await manager.sync();
            expect(server.log).toEqual([{ collection: "posts", op: "createMany", upsert: true }]);
            expect(server.table("posts").size).toBe(2);
        });
    });

    describe("updateMany / deleteMany", () => {
        it("queues a bulk update offline, overlays it, and replays it once", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            await posts.create({ title: "a" });
            await posts.create({ title: "b" });
            const seeded = (await posts.find()).data;

            server.state.online = false;
            const updated = await posts.updateMany(
                seeded.map((r) => ({ id: r.id as string, data: { title: `${r.title}!` } }))
            );
            expect(updated.map((r) => r.title)).toEqual(["a!", "b!"]);

            // The overlay is what a UI renders while the write is queued.
            const overlaid = await posts.find();
            expect(overlaid.data.map((r) => r.title).sort()).toEqual(["a!", "b!"]);

            server.state.online = true;
            await manager.sync();
            const bulk = server.log.filter((e) => e.op === "updateMany");
            expect(bulk).toHaveLength(1);
            expect([...server.table("posts").values()].map((r) => r.title).sort()).toEqual(["a!", "b!"]);
        });

        it("queues a bulk delete offline, hides the rows, and replays it once", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            await posts.create({ title: "a" });
            await posts.create({ title: "b" });
            await posts.create({ title: "c" });
            const seeded = (await posts.find()).data;

            server.state.online = false;
            await posts.deleteMany(seeded.slice(0, 2).map((r) => r.id as string));

            const overlaid = await posts.find();
            expect(overlaid.data.map((r) => r.title)).toEqual(["c"]);

            server.state.online = true;
            await manager.sync();
            const bulk = server.log.filter((e) => e.op === "deleteMany");
            expect(bulk).toHaveLength(1);
            expect([...server.table("posts").values()].map((r) => r.title)).toEqual(["c"]);
        });

        it("queues a bulk update whose rows have writes still pending", async () => {
            // Splitting the batch — some rows now, some later — would break the
            // one guarantee a batch makes, and would reorder a write against a
            // row whose own create has not landed yet.
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            await posts.find();

            server.state.online = false;
            const created = await posts.create({ title: "fresh" });
            await posts.updateMany([{ id: created.id as string, data: { title: "edited" } }]);

            server.state.online = true;
            await manager.sync();

            // The create ran first, then the batch — order preserved.
            expect(server.log.map((e) => e.op)).toEqual(["create", "updateMany"]);
            expect([...server.table("posts").values()][0].title).toBe("edited");
        });

        it("goes straight to the server when online", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            const posts = wrap("posts");
            const a = await posts.create({ title: "a" });

            await posts.updateMany([{ id: a.id as string, data: { title: "A" } }]);
            expect(server.table("posts").get(String(a.id))!.title).toBe("A");

            await posts.deleteMany([a.id as string]);
            expect(server.table("posts").size).toBe(0);
        });

        it("treats empty input as a no-op that touches neither queue nor server", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            const posts = wrap("posts");
            await posts.find();

            expect(await posts.updateMany([])).toEqual([]);
            await posts.deleteMany([]);
            expect(server.log.filter((e) => e.op.endsWith("Many"))).toHaveLength(0);
        });
    });

    describe("concurrency", () => {
        it("gives concurrent offline writes distinct, ordered mutation ids", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            server.state.online = false;

            await Promise.all([
                posts.create({ title: "one" }, "c1"),
                posts.create({ title: "two" }, "c2"),
                posts.create({ title: "three" }, "c3")
            ]);

            const pending = await manager.api.pending();
            expect(pending.map((m) => m.id)).toEqual(["c1", "c2", "c3"]);
            const ids = pending.map((m) => m.mutationId);
            expect([...new Set(ids)]).toHaveLength(3);
            // Lexicographic order is replay order — that is the whole contract
            // the store's prefix listing relies on.
            expect(ids).toEqual([...ids].sort());

            server.state.online = true;
            await manager.sync();
            expect(server.log.map((l) => l.id)).toEqual(["c1", "c2", "c3"]);
        });

        it("coalesces concurrent sync calls into one flush", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            server.state.online = false;
            await wrap("posts").create({ title: "a" }, "p1");

            server.state.online = true;
            const [first, second] = await Promise.all([manager.sync(), manager.sync()]);
            expect(first).toBe(second);
            expect(server.log).toHaveLength(1);
        });
    });

    describe("cache maintenance", () => {
        it("evicts the least recently written queries beyond the per-collection cap", async () => {
            const server = createFakeServer();
            const store = new MemoryOfflineStore();
            const manager = new OfflineManager(
                { store, syncIntervalMs: 0, maxCachedQueriesPerCollection: 2 },
                (slug) => server.client(slug)
            );
            const posts = manager.wrap("posts", server.client("posts"));
            await server.client("posts").create({ title: "a" }, "p1");

            await posts.find({ limit: 1 });
            await posts.find({ limit: 2 });
            await posts.find({ limit: 3 });

            const kept = (await store.listCache("anon|q|posts|")).map((e) => e.key).sort();
            expect(kept).toEqual(["anon|q|posts|?limit=2", "anon|q|posts|?limit=3"]);

            // Evicting a snapshot costs the server's page composition, not the
            // rows: the query still answers, from the local database.
            server.state.online = false;
            expect((await posts.find({ limit: 1 })).data).toHaveLength(1);
            expect((await posts.find({ limit: 2 })).data).toHaveLength(1);
        });

        it("eviction never touches another collection's queries or cached rows", async () => {
            const server = createFakeServer();
            const store = new MemoryOfflineStore();
            const manager = new OfflineManager(
                { store, syncIntervalMs: 0, maxCachedQueriesPerCollection: 1 },
                (slug) => server.client(slug)
            );
            const posts = manager.wrap("posts", server.client("posts"));
            const users = manager.wrap("users", server.client("users"));
            await server.client("posts").create({ title: "a" }, "p1");
            await server.client("users").create({ name: "u" }, "u1");

            await users.find();
            await posts.findById("p1");
            await posts.find({ limit: 1 });
            await posts.find({ limit: 2 }); // evicts posts {limit:1}, nothing else

            server.state.online = false;
            expect((await users.find()).data).toHaveLength(1);
            expect(await posts.findById("p1")).toMatchObject({ title: "a" });
        });

        it("clear() drops the queue and the cache together", async () => {
            const server = createFakeServer();
            const { manager, wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "a" }, "p1");
            server.log.length = 0;
            await posts.find();

            server.state.online = false;
            await posts.create({ title: "pending" });
            await manager.api.clear();

            expect(await manager.api.pending()).toHaveLength(0);
            expect(isOfflineError(await posts.find().catch((e) => e))).toBe(true);

            server.state.online = true;
            expect(await manager.sync()).toEqual({ flushed: 0, remaining: 0 });
            expect(server.log).toHaveLength(0);
        });

        it("an online update refreshes the cached row", async () => {
            const server = createFakeServer();
            const { wrap } = createManager(server);
            const posts = wrap("posts");
            await server.client("posts").create({ title: "old" }, "p1");
            await posts.findById("p1");
            await posts.update("p1", { title: "new" });

            server.state.online = false;
            expect(await posts.findById("p1")).toMatchObject({ title: "new" });
        });
    });

    describe("survives a restart", () => {
        it("replays a queue persisted by a previous manager instance", async () => {
            const server = createFakeServer();
            const store = new MemoryOfflineStore();
            const first = createManager(server, { store });
            server.state.online = false;
            await first.wrap("posts").create({ title: "from-last-session" }, "p1");
            first.manager.dispose();

            server.state.online = true;
            const second = createManager(server, { store });
            const result = await second.manager.sync();
            expect(result).toEqual({ flushed: 1, remaining: 0 });
            expect(server.table("posts").get("p1")).toMatchObject({ title: "from-last-session" });
        });

        it("randomized: coalescing + replay always ends in the state of a verbatim replay", async () => {
            // The invariant that keeps coalescing honest: for ANY offline op
            // sequence, syncing the (coalesced) queue must leave the server in
            // exactly the state of applying every op one-by-one, in order.
            // The oracle applies server semantics directly: create overwrites,
            // update on a missing row is rejected (a dropped 404 at replay),
            // delete of a missing row is a no-op.
            for (let seed = 1; seed <= 20; seed++) {
                let s = seed;
                const rnd = () => (s = (s * 48271) % 2147483647) / 2147483647;
                const pick = <T,>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

                const server = createFakeServer();
                const { manager, wrap } = createManager(server, { onSyncError: () => undefined });
                const posts = wrap("posts");
                await server.client("posts").create({ title: "seed-1" }, "r1");
                await server.client("posts").create({ title: "seed-2" }, "r2");

                const oracle = new Map<string, Row>();
                for (const [id, row] of server.table("posts")) oracle.set(id, { ...row });

                server.state.online = false;
                const ids = ["r1", "r2", "r3", "r4", "r5"];
                for (let i = 0; i < 30; i++) {
                    const id = pick(ids);
                    const type = pick(["create", "update", "delete", "update"] as const);
                    if (type === "create") {
                        if (rnd() < 0.5) {
                            // Generated id — the only kind that may cancel out
                            // against a later delete.
                            const row = await posts.create({ title: `c${i}` });
                            ids.push(String(row.id));
                            oracle.set(String(row.id), { title: `c${i}`, id: row.id });
                        } else {
                            await posts.create({ title: `c${i}` }, id);
                            oracle.set(id, { title: `c${i}`, id });
                        }
                    } else if (type === "update") {
                        await posts.update(id, { v: i });
                        const existing = oracle.get(id);
                        if (existing) oracle.set(id, { ...existing, v: i });
                    } else {
                        await posts.delete(id);
                        oracle.delete(id);
                    }
                }

                server.state.online = true;
                const { remaining } = await manager.sync();
                expect(remaining).toBe(0);

                const actual = Object.fromEntries(server.table("posts"));
                const expected = Object.fromEntries(oracle);
                expect(actual).toEqual(expected);
                manager.dispose();
            }
        });

        it("keeps replay order across a restart", async () => {
            const server = createFakeServer();
            const store = new MemoryOfflineStore();
            const first = createManager(server, { store });
            server.state.online = false;
            await first.wrap("posts").create({ title: "first" }, "p1");
            first.manager.dispose();

            const second = createManager(server, { store });
            await second.wrap("posts").create({ title: "second" }, "p2");

            const pending = await second.manager.api.pending();
            expect(pending.map((m) => m.id)).toEqual(["p1", "p2"]);
            expect(pending[0].mutationId < pending[1].mutationId).toBe(true);

            server.state.online = true;
            await second.manager.sync();
            expect(server.log.map((l) => l.id)).toEqual(["p1", "p2"]);
        });
    });
});
