import { afterEach, describe, expect, it } from "@jest/globals";
import { fakeServer, manager, restoreNavigator, setNavigatorOnLine, settle, type Row } from "./support/offline-fake-server";

/**
 * `listen` and `listenById` with offline support on (RTO-17).
 *
 * Both fed the local database on the way past and then handed the app the raw
 * server frame. `observe` answers from the local database, which folds the
 * queue in; these did not, so a realtime frame arriving before an offline edit
 * replayed showed the server's value over the user's own edit — while
 * `findById` beside it still returned the edit. And `listenById` ignored a
 * delete entirely, so a row deleted elsewhere stayed in the local database and
 * was served offline.
 */

afterEach(() => restoreNavigator());

describe("listen with offline support", () => {
    it("hands the app the row with the user's queued edit, not the raw server row", async () => {
        const server = fakeServer();
        server.rows.set("1", { id: "1", title: "server" });
        const { posts } = manager(server);
        await posts.findById("1");
        setNavigatorOnLine(false);
        await posts.update("1", { title: "my offline edit" });

        const seen: Row[][] = [];
        posts.listen!(undefined, (result: { data: Row[] }) => seen.push(result.data), () => undefined);
        server.listeners[0]({ data: [{ id: "1", title: "server v2", other: 1 }] });
        await settle();

        expect(seen).toHaveLength(1);
        expect(seen[0][0]).toMatchObject({ title: "my offline edit", other: 1 });
    });

    it("passes a frame through untouched when nothing is queued", async () => {
        const server = fakeServer();
        const { posts } = manager(server);
        const seen: Row[][] = [];
        posts.listen!(undefined, (result: { data: Row[] }) => seen.push(result.data), () => undefined);
        server.listeners[0]({ data: [{ id: "1", title: "a" }, { id: "2", title: "b" }] });
        await settle();
        expect(seen).toEqual([[{ id: "1", title: "a" }, { id: "2", title: "b" }]]);
    });
});

describe("listenById with offline support", () => {
    it("a delete delivered live removes the row from the local database", async () => {
        const server = fakeServer();
        server.rows.set("1", { id: "1", title: "t" });
        const { posts } = manager(server);
        await posts.findById("1");
        const seen: (Row | null)[] = [];
        posts.listenById!("1", (row: Row | null) => seen.push(row), () => undefined);

        server.rows.delete("1");
        server.byIdListeners[0](null);
        await settle();

        expect(seen).toEqual([null]);
        server.state.online = false;
        expect(await posts.findById("1")).toBeUndefined();
    });

    it("a delete does not remove a row with a queued write", async () => {
        const server = fakeServer();
        server.rows.set("1", { id: "1", title: "t" });
        const { posts } = manager(server);
        await posts.findById("1");
        posts.listenById!("1", () => undefined, () => undefined);
        setNavigatorOnLine(false);
        await posts.update("1", { title: "mine" });

        server.byIdListeners[0](null);
        await settle();

        server.state.online = false;
        expect(await posts.findById("1")).toMatchObject({ title: "mine" });
    });

    it("hands the app the row with the user's queued edit", async () => {
        const server = fakeServer();
        server.rows.set("1", { id: "1", title: "server" });
        const { posts } = manager(server);
        await posts.findById("1");
        setNavigatorOnLine(false);
        await posts.update("1", { title: "my offline edit" });

        const seen: (Row | null)[] = [];
        posts.listenById!("1", (row: Row | null) => seen.push(row), () => undefined);
        server.byIdListeners[0]({ id: "1", title: "server v2" });
        await settle();

        expect(seen).toHaveLength(1);
        expect(seen[0]).toMatchObject({ title: "my offline edit" });
    });
});
