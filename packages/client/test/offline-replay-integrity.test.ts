import { afterEach, describe, expect, it } from "@jest/globals";
import { RebaseApiError } from "@rebasepro/types";
import type { PendingMutation } from "../src/offline-store";
import { fakeServer, manager, networkError, restoreNavigator, setNavigatorOnLine } from "./support/offline-fake-server";

/**
 * What the offline queue does with a replay the server answered in a way the
 * engine has to interpret — docs/audits/34-offline-sync.md.
 */

afterEach(() => restoreNavigator());

describe("a replayed create answered 409 (H1)", () => {
    function queuedCreate() {
        const server = fakeServer();
        const errors: { error: Error; mutation: PendingMutation }[] = [];
        const { offline, posts } = manager(server, { onSyncError: (error, mutation) => errors.push({ error, mutation }) });
        return { server, errors, offline, posts };
    }

    const conflict = () => new RebaseApiError("duplicate key value violates unique constraint \"posts_email_key\"", { status: 409, code: "CONFLICT" });

    it("a conflict that is not this write's own first attempt is reported, not dropped as synced", async () => {
        const { server, errors, offline, posts } = queuedCreate();
        server.state.online = false;
        await posts.create({ email: "taken@example.com" });
        expect(offline.api.status().pending).toBe(1);

        server.state.online = true;
        // Another row already holds this email; nothing under our id exists.
        server.setReject((op) => op === "create" ? conflict() : undefined);
        const result = await offline.sync();

        expect(result).toEqual({ flushed: 0, remaining: 0 });
        expect(errors).toHaveLength(1);
        expect((errors[0].error as RebaseApiError).status).toBe(409);
        expect(offline.api.status().lastError).toContain("duplicate key");
        expect(await offline.api.pending()).toEqual([]);
        expect(server.rows.size).toBe(0);
    });

    it("a read-back that fails keeps the write queued instead of trusting a read that never happened", async () => {
        const { server, errors, offline, posts } = queuedCreate();
        server.state.online = false;
        await posts.create({ title: "lost ack" });

        server.state.online = true;
        server.setReject((op) => op === "create" ? conflict() : undefined);
        server.setFindByIdError(() => networkError());
        const result = await offline.sync();

        expect(result).toEqual({ flushed: 0, remaining: 1 });
        expect(errors).toEqual([]);
        expect(offline.api.status().lastSyncedAt).toBeUndefined();
    });

    it("the write's own earlier attempt is still adopted when the row reads back", async () => {
        const { server, errors, offline, posts } = queuedCreate();
        server.state.online = false;
        const created = await posts.create({ title: "lost ack" });

        // The first attempt landed; only its answer was lost.
        server.rows.set(String(created.id), { id: created.id, title: "lost ack", by_server: true });
        server.state.online = true;
        server.setReject((op) => op === "create" ? conflict() : undefined);
        const result = await offline.sync();

        expect(result).toEqual({ flushed: 1, remaining: 0 });
        expect(errors).toEqual([]);
        expect(await posts.findById(created.id as string)).toMatchObject({ by_server: true });
    });
});

describe("a skipped filter with offline support on (H4)", () => {
    it("a find with `{ status: undefined }` answers instead of throwing a TypeError", async () => {
        const server = fakeServer();
        server.rows.set("1", { id: "1", status: "a" });
        const { posts } = manager(server);
        const result = await posts.find({ where: { status: undefined } } as never);
        expect(result.data).toHaveLength(1);
    });
});

/**
 * A request that outlives a sign-out/sign-in (H3).
 *
 * The local database and the queue are partitioned per user, and the load
 * paths checked the user after their awaits — the write paths did not. A
 * response for user A that arrived after B had signed in was stored as B's.
 */
describe("a request in flight across a change of user (H3)", () => {
    it("a find answered after the switch does not land in the next user's local database", async () => {
        const server = fakeServer();
        const { offline, store, posts } = manager(server);
        offline.setScope("A");
        let release!: (rows: Record<string, unknown>[]) => void;
        server.setFindGate(new Promise((resolve) => { release = resolve; }));
        const pending = posts.find();
        while (!server.calls.some((call) => call.op === "find")) await new Promise((resolve) => setTimeout(resolve, 0));

        offline.setScope("B");
        release([{ id: "a-1", secret: "only A may see this" }]);
        await pending.catch(() => undefined);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect((await store.listCache("B|")).map((entry) => entry.key)).toEqual([]);
        server.state.online = false;
        server.setFindGate(undefined);
        await expect(posts.findById("a-1")).rejects.toMatchObject({ code: "OFFLINE" });
    });

    it("a write made by A and queued after the switch is A's, not replayed as B", async () => {
        const server = fakeServer();
        const { offline, store, posts } = manager(server);
        offline.setScope("A");
        server.state.online = false;
        await offline.api.pending();
        // The write starts as A…
        const writing = posts.create({ title: "A's note" });
        // …and B signs in before it reaches the queue.
        offline.setScope("B");
        await writing;
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(await offline.api.pending()).toEqual([]);
        expect(await store.listQueue("B|")).toEqual([]);
        expect(await store.listQueue("A|")).toHaveLength(1);
    });

    it("a replay ACKed after the switch is dequeued from A's queue, so it is not sent again", async () => {
        const server = fakeServer();
        const { offline, store, posts } = manager(server);
        offline.setScope("A");
        server.state.online = false;
        await posts.create({ title: "A's note" });
        expect(await store.listQueue("A|")).toHaveLength(1);
        const creates = () => server.calls.filter((call) => call.op === "create").length;
        const triedOnline = creates();

        server.state.online = true;
        let switched = false;
        server.setReject((op) => {
            // The request reaches the server; the user changes before the answer.
            if (op === "create" && !switched) {
                switched = true;
                offline.setScope("B");
            }
            return undefined;
        });
        await offline.sync();

        expect(await store.listQueue("A|")).toEqual([]);
        expect(creates()).toBe(triedOnline + 1);
        offline.setScope("A");
        await offline.sync();
        expect(creates()).toBe(triedOnline + 1);
    });
});

/**
 * Edits coalesced into one queued op are still separate edits (RTO-18).
 *
 * Consecutive offline edits to one row merge into the queued op, so a form
 * being typed into does not grow the queue. When the server refused the merged
 * op over one field — a column dropped by a schema change while the user was
 * offline — the whole op was rolled back, every other field the user edited
 * with it, and the refusals of the writes discarded along with it were
 * reported with the same error as the write that was actually refused.
 */
describe("a coalesced edit the server refuses over one field (RTO-18)", () => {
    const unknownField = () => new RebaseApiError("'posts' has no field 'legacy'.", { status: 400, code: "VALIDATION_UNKNOWN_FIELDS" });

    it("keeps the user's other edits, and reports only the refused one", async () => {
        const server = fakeServer();
        server.rows.set("1", { id: "1", title: "old", legacy: "l" });
        const errors: { error: Error; mutation: PendingMutation }[] = [];
        const { offline, posts } = manager(server, { onSyncError: (error, mutation) => errors.push({ error, mutation }) });
        await posts.findById("1");
        setNavigatorOnLine(false);
        await posts.update("1", { title: "new title" });
        await posts.update("1", { legacy: "x" });
        expect(await offline.api.pending()).toHaveLength(1);

        setNavigatorOnLine(true);
        server.setReject((op, _id, data) => op === "update" && data && "legacy" in (data as Record<string, unknown>)
            ? unknownField()
            : undefined);
        const result = await offline.sync();

        expect(result.remaining).toBe(0);
        expect(server.rows.get("1")).toMatchObject({ title: "new title", legacy: "l" });
        expect(await posts.findById("1")).toMatchObject({ title: "new title", legacy: "l" });
        expect(errors).toHaveLength(1);
        expect(errors[0].mutation.data).toEqual({ legacy: "x" });
        expect((errors[0].error as RebaseApiError).code).toBe("VALIDATION_UNKNOWN_FIELDS");
    });

    it("a write discarded because an earlier one was refused says so", async () => {
        const server = fakeServer();
        server.rows.set("1", { id: "1", title: "t" });
        server.rows.set("2", { id: "2", title: "u" });
        const errors: { error: Error; mutation: PendingMutation }[] = [];
        const { offline, posts } = manager(server, { onSyncError: (error, mutation) => errors.push({ error, mutation }) });
        await posts.findById("1");
        await posts.findById("2");
        setNavigatorOnLine(false);
        await posts.update("1", { title: "refused" });
        await posts.update("2", { title: "fine" });
        await posts.update("1", { title: "built on the refused one" });

        setNavigatorOnLine(true);
        server.setReject((op, id) => op === "update" && id === "1"
            ? new RebaseApiError("Forbidden by policy", { status: 403, code: "FORBIDDEN" })
            : undefined);
        await offline.sync();

        expect(errors.map(({ error }) => (error as RebaseApiError).code)).toEqual(["FORBIDDEN", "DEPENDENCY_REJECTED"]);
        expect(errors[1].error.message).toContain("Forbidden by policy");
        expect(server.rows.get("2")).toMatchObject({ title: "fine" });
    });
});
