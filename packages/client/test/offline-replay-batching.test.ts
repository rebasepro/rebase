import { afterEach, describe, expect, it } from "@jest/globals";
import { RebaseApiError } from "@rebasepro/types";
import type { CollectionClient } from "../src/collection";
import { OfflineManager } from "../src/offline";
import { MemoryOfflineStore, type PendingMutation } from "../src/offline-store";
import { restoreNavigator, setNavigatorOnLine } from "./support/offline-fake-server";

/**
 * `offline.replayBatchSize`: a run of creates queued offline drains as one
 * `createMany` instead of one round trip each — and anything the server does
 * not simply accept falls back to the one-at-a-time replay, so each write still
 * stands or falls on its own.
 */

type Row = Record<string, unknown>;

const networkError = () => new RebaseApiError("fetch failed", { status: 0, code: "NETWORK_ERROR" });

function fakeServer() {
    const state = {
        online: true,
        refuseBulk: undefined as Error | undefined,
        refuseTitle: undefined as string | undefined,
        bulkGate: undefined as Promise<void> | undefined
    };
    const tables = new Map<string, Map<string, Row>>();
    const calls: { collection: string; op: string; ids: unknown[]; key?: unknown }[] = [];
    const table = (slug: string) => {
        if (!tables.has(slug)) tables.set(slug, new Map());
        return tables.get(slug)!;
    };
    const insert = (slug: string, data: Row) => {
        if (state.refuseTitle !== undefined && data.title === state.refuseTitle) {
            throw new RebaseApiError("title refused", { status: 400, code: "VALIDATION_ERROR" });
        }
        if (table(slug).has(String(data.id))) throw new RebaseApiError("duplicate key", { status: 409, code: "CONFLICT" });
        const row = { ...data };
        return row;
    };
    function client(slug: string): CollectionClient<Row> {
        const fake = {
            async find() {
                if (!state.online) throw networkError();
                const data = [...table(slug).values()];
                return { data, meta: { total: data.length, limit: 20, offset: 0, hasMore: false } };
            },
            async create(data: Row, _id?: unknown, options?: { idempotencyKey?: string }) {
                calls.push({ collection: slug, op: "create", ids: [data.id], key: options?.idempotencyKey });
                if (!state.online) throw networkError();
                const row = insert(slug, data);
                table(slug).set(String(row.id), row);
                return row;
            },
            async createMany(rows: Row[], options?: { idempotencyKey?: string }) {
                calls.push({ collection: slug, op: "createMany", ids: rows.map((r) => r.id), key: options?.idempotencyKey });
                if (!state.online) throw networkError();
                if (state.refuseBulk) throw state.refuseBulk;
                if (state.bulkGate) await state.bulkGate;
                // One transaction: every row, or none.
                const written = rows.map((r) => insert(slug, r));
                for (const row of written) table(slug).set(String(row.id), row);
                return written;
            },
            async update(id: string | number, data: Row, options?: { idempotencyKey?: string }) {
                calls.push({ collection: slug, op: "update", ids: [id], key: options?.idempotencyKey });
                if (!state.online) throw networkError();
                const row = { ...table(slug).get(String(id)), ...data, id };
                table(slug).set(String(id), row);
                return row;
            },
            async findById(id: string | number) {
                if (!state.online) throw networkError();
                return table(slug).get(String(id));
            }
        };
        return fake as unknown as CollectionClient<Row>;
    }
    return { state, table, calls, client };
}

function setup(replayBatchSize?: number, onSyncError?: (error: Error, mutation: PendingMutation) => void) {
    const server = fakeServer();
    const offline = new OfflineManager(
        { store: new MemoryOfflineStore(), syncIntervalMs: 0, replayBatchSize, onSyncError },
        (slug) => server.client(slug)
    );
    const posts = offline.wrap("posts", server.client("posts"));
    const authors = offline.wrap("authors", server.client("authors"));
    offline.setScope("u1");
    return { server, offline, posts, authors };
}

/**
 * Go offline the way a browser says so: writes are queued without being
 * attempted, so none of them carries a request already sent.
 */
function goOffline(server: ReturnType<typeof fakeServer>) {
    setNavigatorOnLine(false);
    server.state.online = false;
}

function goOnline(server: ReturnType<typeof fakeServer>) {
    setNavigatorOnLine(true);
    server.state.online = true;
    server.calls.length = 0;
}

async function createOffline(posts: CollectionClient<Row>, server: ReturnType<typeof fakeServer>, titles: string[]) {
    goOffline(server);
    const rows: Row[] = [];
    for (const title of titles) rows.push(await posts.create({ title }));
    goOnline(server);
    return rows;
}

afterEach(() => restoreNavigator());

describe("offline.replayBatchSize", () => {
    it("by default every queued create is a request of its own", async () => {
        const { server, offline, posts } = setup();
        await createOffline(posts, server, ["a", "b", "c"]);

        await offline.sync();

        expect(server.calls.map((c) => c.op)).toEqual(["create", "create", "create"]);
    });

    it("folds a run of creates into createMany calls of at most the batch size, in order", async () => {
        const { server, offline, posts } = setup(2);
        const rows = await createOffline(posts, server, ["a", "b", "c", "d", "e"]);

        expect(await offline.sync()).toEqual({ flushed: 5, remaining: 0 });

        expect(server.calls.map((c) => [c.op, c.ids])).toEqual([
            ["createMany", [rows[0].id, rows[1].id]],
            ["createMany", [rows[2].id, rows[3].id]],
            ["create", [rows[4].id]]
        ]);
        expect([...server.table("posts").values()].map((r) => r.title)).toEqual(["a", "b", "c", "d", "e"]);
        expect(await offline.api.pending()).toEqual([]);
    });

    it("a run never crosses a write of another kind or another collection", async () => {
        const { server, offline, posts, authors } = setup(10);
        goOffline(server);
        const a = await posts.create({ title: "a" });
        await authors.create({ name: "x" });
        const b = await posts.create({ title: "b" });
        await posts.update(b.id as string, { title: "b2" });
        const c = await posts.create({ title: "c" });
        const d = await posts.create({ title: "d" });
        goOnline(server);

        await offline.sync();

        expect(server.calls.map((call) => [call.collection, call.op, call.ids])).toEqual([
            ["posts", "create", [a.id]],
            ["authors", "create", [expect.any(String)]],
            // `b` absorbed its edit (tail coalescing), so it is still a create.
            ["posts", "createMany", [b.id, c.id, d.id]]
        ]);
    });

    it("a create that references another member's minted id starts a new run", async () => {
        const { server, offline, posts } = setup(10);
        goOffline(server);
        const parent = await posts.create({ title: "parent" });
        const child = await posts.create({ title: "child", parent_id: parent.id });
        goOnline(server);

        await offline.sync();

        expect(server.calls.map((c) => [c.op, c.ids])).toEqual([
            ["create", [parent.id]],
            ["create", [child.id]]
        ]);
    });

    it("a refused run replays one write at a time, so only the refused write is rolled back", async () => {
        const errors: unknown[] = [];
        const { server, offline, posts } = setup(10, (_error, mutation) => errors.push((mutation.data as Row).title));
        const rows = await createOffline(posts, server, ["a", "bad", "c"]);
        server.state.refuseTitle = "bad";

        await offline.sync();

        expect(server.calls.map((c) => c.op)).toEqual(["createMany", "create", "create", "create"]);
        expect([...server.table("posts").values()].map((r) => r.title)).toEqual(["a", "c"]);
        expect(errors).toEqual(["bad"]);
        goOffline(server);
        const local = (await posts.find()).data;
        expect(local.map((r) => r.id)).not.toContain(rows[1].id);
        expect(local.map((r) => r.title).sort()).toEqual(["a", "c"]);
    });

    it("a run whose answer was lost is sent again under the same key", async () => {
        const { server, offline, posts } = setup(10);
        await createOffline(posts, server, ["a", "b"]);
        server.state.online = false;

        await offline.sync();
        server.state.online = true;
        await offline.sync();

        const runs = server.calls.filter((c) => c.op === "createMany");
        expect(runs).toHaveLength(2);
        expect(runs[1].key).toBe(runs[0].key);
        expect(runs[1].ids).toEqual(runs[0].ids);
    });

    it("a row the lost answer did commit is recognised as its own, not refused", async () => {
        const errors: unknown[] = [];
        const { server, offline, posts } = setup(10, (error) => errors.push(error));
        const rows = await createOffline(posts, server, ["a", "b"]);
        // The first run committed and its answer was lost; a third create has
        // joined the run since, so it is a different request.
        server.table("posts").set(String(rows[0].id), { ...rows[0] });
        server.table("posts").set(String(rows[1].id), { ...rows[1] });
        goOffline(server);
        await posts.create({ title: "c" });
        goOnline(server);

        await offline.sync();

        expect(errors).toEqual([]);
        expect(await offline.api.pending()).toEqual([]);
        expect([...server.table("posts").values()].map((r) => r.title)).toEqual(["a", "b", "c"]);
    });

    it("an edit made while the run is on the wire is not merged into it", async () => {
        const { server, offline, posts } = setup(10);
        const rows = await createOffline(posts, server, ["a", "b"]);
        let open!: () => void;
        server.state.bulkGate = new Promise<void>((resolve) => { open = resolve; });

        const drain = offline.sync();
        await new Promise((resolve) => setTimeout(resolve, 0));
        // `b` is the queue's tail and is being sent: the edit queues behind it.
        await posts.update(rows[1].id as string, { title: "b2" });
        open();
        await drain;
        await offline.sync();

        expect(server.calls.map((c) => c.op)).toEqual(["createMany", "update"]);
        expect(server.table("posts").get(String(rows[1].id))?.title).toBe("b2");
    });

    it("a busy server defers the run to the one-at-a-time replay and its retry budget", async () => {
        const { server, offline, posts } = setup(10);
        await createOffline(posts, server, ["a", "b"]);
        server.state.refuseBulk = new RebaseApiError("busy", { status: 503, code: "SERVICE_UNAVAILABLE" });

        expect(await offline.sync()).toEqual({ flushed: 2, remaining: 0 });
        expect(server.calls.map((c) => c.op)).toEqual(["createMany", "create", "create"]);
    });
});
