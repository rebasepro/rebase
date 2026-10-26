/**
 * A queued create is marked `sent` before its replay goes out.
 *
 * Tail coalescing (an edit merged into the queued create) and cancel-out (a
 * delete that drops the queued create) both read "no `sent`" as "the server
 * cannot have this row". A replay whose create committed and whose answer was
 * lost left it unmarked, so the next edit merged into a create the server
 * already held — its replay answered 409, read the old row back and adopted it
 * as synced, and the edit was gone — and a delete dropped the create and was
 * never sent, leaving the row on the server for good. A folded
 * `replayBatchSize` run had the same hole for every member.
 */
import { afterEach, describe, expect, it } from "@jest/globals";
import { RebaseApiError } from "@rebasepro/types";
import { OfflineManager } from "../src/offline";
import { MemoryOfflineStore, type PendingMutation } from "../src/offline-store";
import { restoreNavigator, setNavigatorOnLine } from "./support/offline-fake-server";

type Row = Record<string, unknown>;
const networkError = () => new RebaseApiError("fetch failed", { status: 0, code: "NETWORK_ERROR" });

/** A server whose next write commits and then loses its answer, when `loseNext` is set. */
function fakeServer() {
    const state = { online: true, loseNext: false };
    const rows = new Map<string, Row>();
    const calls: { op: string; ids: unknown[] }[] = [];
    const insert = (data: Row) => {
        if (rows.has(String(data.id))) throw new RebaseApiError("duplicate key", { status: 409, code: "CONFLICT" });
        return { ...data };
    };
    const lose = () => {
        if (state.loseNext) {
            state.loseNext = false;
            throw networkError();
        }
    };
    const client = {
        async find() {
            if (!state.online) throw networkError();
            const data = [...rows.values()];
            return { data, meta: { total: data.length, limit: 20, offset: 0, hasMore: false } };
        },
        async findById(id: string | number) {
            if (!state.online) throw networkError();
            return rows.get(String(id));
        },
        async create(data: Row) {
            calls.push({ op: "create", ids: [data.id] });
            if (!state.online) throw networkError();
            const row = insert(data);
            rows.set(String(row.id), row);
            lose();
            return row;
        },
        async createMany(list: Row[]) {
            calls.push({ op: "createMany", ids: list.map(r => r.id) });
            if (!state.online) throw networkError();
            const written = list.map(insert);
            for (const r of written) rows.set(String(r.id), r);
            lose();
            return written;
        },
        async update(id: string | number, data: Row) {
            calls.push({ op: "update", ids: [id] });
            if (!state.online) throw networkError();
            const existing = rows.get(String(id));
            if (!existing) throw new RebaseApiError("Not found", { status: 404, code: "NOT_FOUND" });
            const row = { ...existing, ...data, id };
            rows.set(String(id), row);
            return row;
        },
        async delete(id: string | number) {
            calls.push({ op: "delete", ids: [id] });
            if (!state.online) throw networkError();
            if (!rows.delete(String(id))) throw new RebaseApiError("Not found", { status: 404, code: "NOT_FOUND" });
        },
        listen() {
            return () => undefined;
        }
    };
    return { state, rows, calls, client: client as never };
}

function setup(replayBatchSize?: number) {
    const server = fakeServer();
    const errors: { error: Error; m: PendingMutation }[] = [];
    const offline = new OfflineManager({
        store: new MemoryOfflineStore(),
        syncIntervalMs: 0,
        replayBatchSize,
        onSyncError: (error, m) => errors.push({ error, m })
    }, () => server.client);
    const posts = offline.wrap("posts", server.client);
    offline.setScope("u1");
    return { server, offline, posts, errors };
}

const off = (s: ReturnType<typeof fakeServer>) => {
    setNavigatorOnLine(false);
    s.state.online = false;
};
const on = (s: ReturnType<typeof fakeServer>) => {
    setNavigatorOnLine(true);
    s.state.online = true;
};

afterEach(() => restoreNavigator());

describe("a queued create whose replay answer was lost", () => {
    it("keeps an edit made afterwards: it replays as its own update", async () => {
        const { server, offline, posts, errors } = setup();
        off(server);
        const row = await posts.create({ title: "draft" });
        on(server);
        server.state.loseNext = true;
        await offline.sync();
        expect(server.rows.get(String(row.id))?.title).toBe("draft");

        off(server);
        await posts.update(row.id as string, { title: "final" });
        on(server);
        await offline.sync();

        expect(server.rows.get(String(row.id))?.title).toBe("final");
        expect(errors).toEqual([]);
        expect(await offline.api.pending()).toEqual([]);
    });

    it("sends a delete made afterwards instead of cancelling it out", async () => {
        const { server, offline, posts } = setup();
        off(server);
        const row = await posts.create({ title: "oops" });
        on(server);
        server.state.loseNext = true;
        await offline.sync();

        off(server);
        await posts.delete(row.id as string);
        on(server);
        await offline.sync();

        expect(await offline.api.pending()).toEqual([]);
        expect(server.calls.filter(c => c.op === "delete")).toHaveLength(1);
        expect(server.rows.has(String(row.id))).toBe(false);
    });

    it("sends a delete of a folded run's member instead of cancelling it out", async () => {
        const { server, offline, posts } = setup(10);
        off(server);
        const a = await posts.create({ title: "a" });
        const b = await posts.create({ title: "b" });
        on(server);
        server.state.loseNext = true;
        await offline.sync();
        expect(server.calls.map(c => c.op)).toEqual(["createMany"]);

        off(server);
        await posts.delete(b.id as string);
        on(server);
        await offline.sync();

        expect(await offline.api.pending()).toEqual([]);
        expect(server.rows.has(String(b.id))).toBe(false);
        expect(server.rows.get(String(a.id))?.title).toBe("a");
    });

    it("still merges an edit into a create that was never sent", async () => {
        const { server, offline, posts } = setup();
        off(server);
        const row = await posts.create({ title: "draft" });
        await posts.update(row.id as string, { title: "final" });
        expect(await offline.api.pending()).toHaveLength(1);
        on(server);
        await offline.sync();
        expect(server.calls.map(c => c.op)).toEqual(["create"]);
        expect(server.rows.get(String(row.id))?.title).toBe("final");
    });
});
