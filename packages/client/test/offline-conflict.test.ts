import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { RebaseApiError } from "@rebasepro/types";
import type { CollectionClient } from "../src/collection";
import { OfflineManager, type ConflictResolution } from "../src/offline";
import { MemoryOfflineStore, type PendingMutation } from "../src/offline-store";
import { restoreNavigator, setNavigatorOnLine } from "./support/offline-fake-server";

/**
 * `offline.onConflict`: an edit queued offline replays with `If-Match`, the
 * version of the row it was made against, and a row someone changed in the
 * meantime is the app's to decide — overwrite, or discard the edit.
 *
 * Without the option nothing changes: replay sends no precondition and the
 * last writer wins.
 */

type Row = Record<string, unknown>;

const networkError = () => new RebaseApiError("fetch failed", { status: 0, code: "NETWORK_ERROR" });

/** A row as a read that reports its version hands it over: the tag beside the row, not in it. */
function tagged(row: Row, etag: string): Row {
    const copy = { ...row };
    Object.defineProperty(copy, "__etag", { value: etag, enumerable: false, configurable: true, writable: true });
    return copy;
}

function fakeServer() {
    const state = { online: true };
    const rows = new Map<string, { row: Row; version: number }>();
    const updates: { id: unknown; data: Row; ifMatch?: string }[] = [];
    const frames: ((row: Row | null) => void)[] = [];
    const etag = (version: number) => `"v${version}"`;
    const read = (id: string | number) => {
        const stored = rows.get(String(id));
        return stored ? tagged(stored.row, etag(stored.version)) : undefined;
    };
    const client = {
        async find() {
            if (!state.online) throw networkError();
            // A list carries no row versions.
            const data = [...rows.values()].map((r) => ({ ...r.row }));
            return { data, meta: { total: data.length, limit: 20, offset: 0, hasMore: false } };
        },
        async findById(id: string | number) {
            if (!state.online) throw networkError();
            return read(id);
        },
        async update(id: string | number, data: Row, options?: { ifMatch?: string; idempotencyKey?: string }) {
            if (!state.online) throw networkError();
            updates.push({ id, data, ...(options?.ifMatch ? { ifMatch: options.ifMatch } : {}) });
            const stored = rows.get(String(id));
            if (!stored) throw new RebaseApiError("Not found", { status: 404, code: "NOT_FOUND" });
            if (options?.ifMatch && options.ifMatch !== etag(stored.version)) {
                throw new RebaseApiError("The row has changed", { status: 412, code: "PRECONDITION_FAILED" });
            }
            stored.row = { ...stored.row, ...data, id };
            stored.version++;
            return read(id)!;
        },
        listenById(_id: unknown, onUpdate: (row: Row | null) => void) {
            frames.push(onUpdate);
            return () => undefined;
        }
    };
    return {
        state,
        updates,
        frames,
        /** Another user's write, straight to the server. */
        put(row: Row) {
            const stored = rows.get(String(row.id));
            rows.set(String(row.id), { row: { ...stored?.row, ...row }, version: (stored?.version ?? 0) + 1 });
        },
        get: (id: string) => rows.get(id)?.row,
        frame: (id: string) => read(id) ?? null,
        client: client as unknown as CollectionClient<Row>
    };
}

function setup(options: {
    onConflict?: (error: RebaseApiError, mutation: PendingMutation) => ConflictResolution | Promise<ConflictResolution>;
    onSyncError?: (error: Error, mutation: PendingMutation) => void;
} = {}) {
    const server = fakeServer();
    const offline = new OfflineManager(
        { store: new MemoryOfflineStore(), syncIntervalMs: 0, ...options },
        () => server.client
    );
    const posts = offline.wrap("posts", server.client);
    offline.setScope("u1");
    return { server, offline, posts };
}

function goOffline(server: ReturnType<typeof fakeServer>) {
    setNavigatorOnLine(false);
    server.state.online = false;
}

function goOnline(server: ReturnType<typeof fakeServer>) {
    setNavigatorOnLine(true);
    server.state.online = true;
}

afterEach(() => restoreNavigator());

describe("offline.onConflict", () => {
    it("off (the default): a queued edit replays with no precondition, and the last writer wins", async () => {
        const { server, offline, posts } = setup();
        server.put({ id: "p1", title: "first" });
        await posts.findById("p1");
        goOffline(server);
        await posts.update("p1", { title: "mine" });
        server.state.online = true;
        server.put({ id: "p1", title: "theirs" });
        goOnline(server);

        await offline.sync();

        expect(server.updates).toEqual([{ id: "p1", data: { title: "mine" } }]);
        expect(server.get("p1")?.title).toBe("mine");
    });

    it("a queued edit replays with the version its row was read at, and nothing is asked when it still matches", async () => {
        const onConflict = jest.fn<(error: RebaseApiError, mutation: PendingMutation) => ConflictResolution>();
        const { server, offline, posts } = setup({ onConflict });
        server.put({ id: "p1", title: "first" });
        await posts.findById("p1");
        goOffline(server);
        await posts.update("p1", { title: "mine" });
        goOnline(server);

        await offline.sync();

        expect(server.updates).toEqual([{ id: "p1", data: { title: "mine" }, ifMatch: "\"v1\"" }]);
        expect(onConflict).not.toHaveBeenCalled();
        expect(server.get("p1")?.title).toBe("mine");
    });

    it("\"overwrite\" sends the edit again without the precondition", async () => {
        const onSyncError = jest.fn();
        const onConflict = jest.fn((): ConflictResolution => "overwrite");
        const { server, offline, posts } = setup({ onConflict, onSyncError });
        server.put({ id: "p1", title: "first", body: "b" });
        await posts.findById("p1");
        goOffline(server);
        await posts.update("p1", { title: "mine" });
        server.state.online = true;
        server.put({ id: "p1", title: "theirs" });
        goOnline(server);

        await offline.sync();

        expect(onConflict).toHaveBeenCalledTimes(1);
        const [error, mutation] = onConflict.mock.calls[0] as unknown as [RebaseApiError, PendingMutation];
        expect(error.status).toBe(412);
        expect(mutation).toMatchObject({ type: "update", id: "p1", data: { title: "mine" } });
        expect(server.updates.map((u) => u.ifMatch)).toEqual(["\"v1\"", undefined]);
        expect(server.get("p1")?.title).toBe("mine");
        expect(onSyncError).not.toHaveBeenCalled();
        expect(await offline.api.pending()).toEqual([]);
    });

    it("\"discard\" drops the edit, unreported, and shows the row as the server has it", async () => {
        const onSyncError = jest.fn();
        const { server, offline, posts } = setup({ onConflict: async () => "discard" as const, onSyncError });
        server.put({ id: "p1", title: "first" });
        await posts.findById("p1");
        goOffline(server);
        await posts.update("p1", { title: "mine" });
        server.state.online = true;
        server.put({ id: "p1", title: "theirs" });
        goOnline(server);

        await offline.sync();

        expect(server.get("p1")?.title).toBe("theirs");
        expect(onSyncError).not.toHaveBeenCalled();
        expect(await offline.api.pending()).toEqual([]);
        goOffline(server);
        expect((await posts.findById("p1"))?.title).toBe("theirs");
    });

    it("a row last seen in a list has no version, so its edit replays without one", async () => {
        const { server, offline, posts } = setup({ onConflict: () => "discard" });
        server.put({ id: "p1", title: "first" });
        await posts.findById("p1");
        // A newer read with no version replaces what was known.
        await posts.find();
        goOffline(server);
        await posts.update("p1", { title: "mine" });
        goOnline(server);

        await offline.sync();

        expect(server.updates).toEqual([{ id: "p1", data: { title: "mine" } }]);
    });

    it("an edit on top of another queued write to the row has no version of its own", async () => {
        const { server, offline, posts } = setup({ onConflict: () => "discard" });
        server.put({ id: "p1", title: "first" });
        server.put({ id: "p2", title: "other" });
        await posts.findById("p1");
        await posts.findById("p2");
        goOffline(server);
        await posts.update("p1", { title: "one" });
        await posts.update("p2", { title: "two" });
        // Not the tail, so not merged: a write of its own, made on top of "one".
        await posts.update("p1", { title: "three" });
        goOnline(server);

        await offline.sync();

        expect(server.updates.map((u) => [u.id, u.ifMatch])).toEqual([
            ["p1", "\"v1\""],
            ["p2", "\"v1\""],
            ["p1", undefined]
        ]);
    });

    it("the version on a listenById frame is the one an edit is made against", async () => {
        const onConflict = jest.fn((): ConflictResolution => "overwrite");
        const { server, offline, posts } = setup({ onConflict });
        server.put({ id: "p1", title: "first" });
        await posts.findById("p1");
        posts.listenById("p1", () => undefined);
        server.put({ id: "p1", title: "edited elsewhere" });
        server.frames[0](server.frame("p1"));
        await new Promise((resolve) => setTimeout(resolve, 0));
        goOffline(server);
        await posts.update("p1", { title: "mine" });
        goOnline(server);

        await offline.sync();

        expect(server.updates.map((u) => u.ifMatch)).toEqual(["\"v2\""]);
        expect(onConflict).not.toHaveBeenCalled();
    });

    it("a caller's own ifMatch is kept on an edit that queues", async () => {
        const onConflict = jest.fn((): ConflictResolution => "discard");
        const { server, offline, posts } = setup({ onConflict });
        server.put({ id: "p1", title: "first" });
        server.put({ id: "p1", title: "second" });
        goOffline(server);
        await posts.update("p1", { title: "mine" }, { ifMatch: "\"v1\"" });
        goOnline(server);

        await offline.sync();

        expect(onConflict).toHaveBeenCalledTimes(1);
        expect(server.get("p1")?.title).toBe("second");
    });
});
