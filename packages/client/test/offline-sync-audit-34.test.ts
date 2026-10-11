import { afterEach, describe, expect, it } from "@jest/globals";
import type { PendingMutation } from "../src/offline-store";
import { fakeServer, manager, networkError, restoreNavigator, setNavigatorOnLine } from "./support/offline-fake-server";

/**
 * The open findings of docs/audits/34-offline-sync.md, one `describe` each.
 */

afterEach(() => restoreNavigator());

describe("an update only ever queued replays under a key (M1)", () => {
    it("a lost answer does not re-apply the edit over a colleague's later one", async () => {
        const server = fakeServer();
        server.rows.set("1", { id: "1", status: "draft" });
        const { offline, posts } = manager(server);
        await posts.findById("1");

        // The browser says there is no network: the edit is queued, never sent.
        setNavigatorOnLine(false);
        await posts.update("1", { status: "review" });
        setNavigatorOnLine(true);

        // The replay commits; its answer is lost.
        server.setAfterCommit((op) => op === "update" ? networkError() : undefined);
        expect(await offline.sync()).toEqual({ flushed: 0, remaining: 1 });
        server.setAfterCommit(undefined);

        // A colleague publishes in the meantime.
        server.rows.set("1", { id: "1", status: "published" });

        expect(await offline.sync()).toEqual({ flushed: 1, remaining: 0 });
        expect(server.rows.get("1")).toMatchObject({ status: "published" });
        const updates = server.calls.filter((call) => call.op === "update");
        expect(updates).toHaveLength(2);
        expect(updates[0].options?.idempotencyKey).toBeDefined();
        expect(updates[1].options?.idempotencyKey).toBe(updates[0].options?.idempotencyKey);
    });

    it("an edit made after a replay attempt is a write of its own, not merged into the keyed one", async () => {
        const server = fakeServer();
        server.rows.set("1", { id: "1", title: "a", status: "draft" });
        const { offline, posts } = manager(server);
        await posts.findById("1");

        setNavigatorOnLine(false);
        await posts.update("1", { title: "b" });
        setNavigatorOnLine(true);
        server.state.online = false;
        await offline.sync();
        server.state.online = true;

        setNavigatorOnLine(false);
        await posts.update("1", { status: "review" });
        setNavigatorOnLine(true);
        const queued: PendingMutation[] = await offline.api.pending();
        expect(queued).toHaveLength(2);

        expect(await offline.sync()).toEqual({ flushed: 2, remaining: 0 });
        expect(server.rows.get("1")).toMatchObject({ title: "b", status: "review" });
    });
});

describe("a replay answered 404: the row is gone on the server (M2)", () => {
    function withRow() {
        const server = fakeServer();
        server.rows.set("1", { id: "1", title: "a" });
        const errors: { error: Error; mutation: PendingMutation }[] = [];
        const { offline, posts } = manager(server, { onSyncError: (error, mutation) => errors.push({ error, mutation }) });
        return { server, errors, offline, posts };
    }

    it("a delete of a row someone else already deleted is done, not undone", async () => {
        const { server, errors, offline, posts } = withRow();
        await posts.findById("1");
        setNavigatorOnLine(false);
        await posts.delete("1");
        setNavigatorOnLine(true);
        server.rows.delete("1");

        expect(await offline.sync()).toEqual({ flushed: 1, remaining: 0 });
        expect(errors).toEqual([]);
        expect(offline.api.status().lastError).toBeUndefined();
        server.state.online = false;
        await expect(posts.findById("1")).resolves.toBeUndefined();
    });

    it("an edit of a row deleted elsewhere is reported, and the row does not come back", async () => {
        const { server, errors, offline, posts } = withRow();
        await posts.findById("1");
        setNavigatorOnLine(false);
        await posts.update("1", { title: "b" });
        setNavigatorOnLine(true);
        server.rows.delete("1");

        expect(await offline.sync()).toEqual({ flushed: 0, remaining: 0 });
        expect(errors).toHaveLength(1);
        expect(errors[0].mutation.type).toBe("update");
        server.state.online = false;
        await expect(posts.findById("1")).resolves.toBeUndefined();
    });
});

describe("a page answered from a snapshot keeps its limit (M6)", () => {
    function fullPage() {
        const server = fakeServer();
        for (const id of ["1", "2", "3"]) server.rows.set(id, { id, n: Number(id) });
        const { posts } = manager(server);
        return { server, posts };
    }

    it("a row created offline displaces the tail of a full page instead of extending it", async () => {
        const { posts } = fullPage();
        const online = await posts.find({ limit: 2 });
        expect(online.data).toHaveLength(2);

        setNavigatorOnLine(false);
        const created = await posts.create({ n: 0 });
        const page = await posts.find({ limit: 2 });

        expect(page.data).toHaveLength(2);
        expect(page.meta.limit).toBe(2);
        expect(page.meta.hasMore).toBe(true);
        expect(page.data.map((row) => row.id)).toContain(created.id);
    });

    it("an ordered page is cut where the order puts it", async () => {
        const { posts } = fullPage();
        await posts.find({ limit: 2, orderBy: ["n", "asc"] } as never);

        setNavigatorOnLine(false);
        await posts.create({ n: 0 });
        const page = await posts.find({ limit: 2, orderBy: ["n", "asc"] } as never);

        expect(page.data.map((row) => row.n)).toEqual([0, 1]);
        expect(page.meta.hasMore).toBe(true);
    });
});

describe("a walk the local database cannot answer page by page (M7)", () => {
    it("findAll() offline fails instead of returning a fraction of the collection as the whole", async () => {
        const server = fakeServer();
        for (let i = 1; i <= 30; i++) server.rows.set(String(i), { id: String(i), n: i });
        const { posts } = manager(server);
        // Only the first page was ever read here.
        await posts.find({ limit: 20 });

        setNavigatorOnLine(false);
        await expect(posts.findAll({ pageSize: 20 } as never)).rejects.toMatchObject({ code: "OFFLINE" });
    });

    it("a walk over pages the server answered here still works offline", async () => {
        const server = fakeServer();
        for (let i = 1; i <= 5; i++) server.rows.set(String(i), { id: String(i), n: i });
        const { posts } = manager(server);
        const online = await posts.findAll();

        setNavigatorOnLine(false);
        expect(await posts.findAll()).toHaveLength(online.length);
    });
});
