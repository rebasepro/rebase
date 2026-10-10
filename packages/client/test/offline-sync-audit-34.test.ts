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
