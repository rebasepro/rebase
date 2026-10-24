import { afterEach, describe, expect, it } from "@jest/globals";
import { RebaseApiError } from "@rebasepro/types";
import { etagOf } from "../src/collection";
import { OfflineManager, type OfflineConfig } from "../src/offline";
import { MemoryOfflineStore, type PendingMutation } from "../src/offline-store";
import { restoreNavigator, setNavigatorOnLine } from "./support/offline-fake-server";

/**
 * A precondition the caller asked for is always sent.
 *
 * With offline enabled, `update(id, data, { ifMatch })` kept the caller's tag
 * on the queued edit only when `onConflict` was configured, and a queued
 * `delete` carried none at all — so the write replayed unconditionally and
 * overwrote (or deleted) a row someone had changed since. And the offline
 * `findById` handed back the row without its version, so `etagOf(row)` was
 * `undefined` even online.
 */

type Row = Record<string, unknown>;
const networkError = () => new RebaseApiError("fetch failed", { status: 0, code: "NETWORK_ERROR" });

function fakeServer() {
    const state = { online: true };
    const rows = new Map<string, { row: Row; version: number }>();
    const calls: { op: string; id: unknown; ifMatch?: string }[] = [];
    const etag = (v: number) => `"v${v}"`;
    const read = (id: string | number) => {
        const s = rows.get(String(id));
        if (!s) return undefined;
        const copy = { ...s.row };
        Object.defineProperty(copy, "__etag", { value: etag(s.version), enumerable: false, configurable: true });
        return copy;
    };
    const client = {
        async find() {
            if (!state.online) throw networkError();
            const data = [...rows.values()].map(r => ({ ...r.row }));
            return { data, meta: { total: data.length, limit: 20, offset: 0, hasMore: false } };
        },
        async findById(id: string | number) {
            if (!state.online) throw networkError();
            return read(id);
        },
        async update(id: string | number, data: Row, o?: { ifMatch?: string }) {
            if (!state.online) throw networkError();
            calls.push({ op: "update", id, ...(o?.ifMatch ? { ifMatch: o.ifMatch } : {}) });
            const s = rows.get(String(id))!;
            if (o?.ifMatch && o.ifMatch !== etag(s.version)) throw new RebaseApiError("changed", { status: 412, code: "PRECONDITION_FAILED" });
            s.row = { ...s.row, ...data, id };
            s.version++;
            return read(id)!;
        },
        async delete(id: string | number, o?: { ifMatch?: string }) {
            if (!state.online) throw networkError();
            calls.push({ op: "delete", id, ...(o?.ifMatch ? { ifMatch: o.ifMatch } : {}) });
            const s = rows.get(String(id))!;
            if (o?.ifMatch && o.ifMatch !== etag(s.version)) throw new RebaseApiError("changed", { status: 412, code: "PRECONDITION_FAILED" });
            rows.delete(String(id));
        },
        listenById() {
            return () => undefined;
        }
    };
    return {
        state,
        calls,
        rows,
        put(row: Row) {
            const s = rows.get(String(row.id));
            rows.set(String(row.id), { row: { ...s?.row, ...row }, version: (s?.version ?? 0) + 1 });
        },
        client: client as never
    };
}

function setup(config: Partial<OfflineConfig> = {}) {
    const server = fakeServer();
    const errors: { error: Error; m: PendingMutation }[] = [];
    const offline = new OfflineManager({
        store: new MemoryOfflineStore(),
        syncIntervalMs: 0,
        onSyncError: (error, m) => errors.push({ error, m }),
        ...config
    }, () => server.client);
    const posts = offline.wrap("posts", server.client);
    offline.setScope("u1");
    server.put({ id: "p1", title: "first" });
    return { server, offline, posts, errors };
}

const goOffline = (server: ReturnType<typeof fakeServer>) => {
    setNavigatorOnLine(false);
    server.state.online = false;
};
const goOnline = (server: ReturnType<typeof fakeServer>) => {
    setNavigatorOnLine(true);
    server.state.online = true;
};

afterEach(() => restoreNavigator());

describe("a caller's own ifMatch with offline enabled", () => {
    it("an online findById keeps the row's version", async () => {
        const { posts } = setup();
        expect(etagOf(await posts.findById("p1"))).toBe("\"v1\"");
    });

    it("a queued update replays with it, and a refusal is reported, without onConflict", async () => {
        const { server, offline, posts, errors } = setup();
        const tag = etagOf(await posts.findById("p1"));
        goOffline(server);
        await posts.update("p1", { title: "mine" }, { ifMatch: tag });
        server.put({ id: "p1", title: "theirs" });
        goOnline(server);
        await offline.sync();

        expect(server.calls).toEqual([{ op: "update", id: "p1", ifMatch: "\"v1\"" }]);
        expect(server.rows.get("p1")!.row.title).toBe("theirs");
        expect(errors.map(e => (e.error as RebaseApiError).code)).toEqual(["PRECONDITION_FAILED"]);
        expect(await offline.api.pending()).toEqual([]);
    });

    it("a queued update behind another edit of the row keeps it", async () => {
        const { server, offline, posts } = setup();
        goOffline(server);
        await posts.update("p1", { title: "one" });
        await posts.update("p1", { body: "two" }, { ifMatch: "\"v1\"" });
        goOnline(server);
        await offline.sync();

        expect(server.calls).toEqual([
            { op: "update", id: "p1" },
            { op: "update", id: "p1", ifMatch: "\"v1\"" }
        ]);
    });

    it("a queued delete replays with it, and onConflict decides a refusal", async () => {
        const { server, offline, posts } = setup({ onConflict: () => "discard" });
        await posts.findById("p1");
        goOffline(server);
        await posts.delete("p1", { ifMatch: "\"v1\"" });
        server.put({ id: "p1", title: "theirs" });
        goOnline(server);
        await offline.sync();

        expect(server.calls).toEqual([{ op: "delete", id: "p1", ifMatch: "\"v1\"" }]);
        expect(server.rows.has("p1")).toBe(true);
        expect((await posts.findById("p1"))?.title).toBe("theirs");
    });

    it("a queued delete refused over it is reported without onConflict", async () => {
        const { server, offline, posts, errors } = setup();
        goOffline(server);
        await posts.delete("p1", { ifMatch: "\"v1\"" });
        server.put({ id: "p1", title: "theirs" });
        goOnline(server);
        await offline.sync();

        expect(server.rows.has("p1")).toBe(true);
        expect(errors.map(e => (e.error as RebaseApiError).code)).toEqual(["PRECONDITION_FAILED"]);
    });
});
