import { afterEach, describe, expect, it } from "@jest/globals";
import { RebaseApiError } from "@rebasepro/types";
import type { PendingMutation } from "../src/offline-store";
import { fakeServer, manager, networkError, restoreNavigator } from "./support/offline-fake-server";

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
