import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RebaseApiError } from "@rebasepro/types";
import { RebaseWebSocketClient } from "../src/websocket";
import { FaultServer } from "./support/fault-socket";

/**
 * Socket requests are at-most-once.
 *
 * A request frame that was written to the socket may have reached the server
 * and run, whatever happens to its answer. The client used to move every
 * pending request back into the send queue when the socket closed, so on
 * reconnect `SAVE`, `DELETE`, `EXECUTE_SQL` and `CREATE_BRANCH` went out a
 * second time: one `save()` made two rows, and an `UPDATE … SET balance =
 * balance - 100` typed into the Studio SQL editor ran twice while the editor
 * showed one success.
 *
 * Now a written request whose socket closes is rejected with
 * `CONNECTION_LOST` and never re-sent; only frames that were never written
 * wait for the next socket, and they wait against the same deadline a sent
 * one has.
 */

let clients: RebaseWebSocketClient[] = [];

function connect(server: FaultServer): RebaseWebSocketClient {
    const client = new RebaseWebSocketClient({ websocketUrl: "ws://test", WebSocket: server.WebSocket });
    client.ensureConnected();
    clients.push(client);
    return client;
}

/** Settle a promise into a value, so a rejection can be asserted after timers run. */
function outcome<T>(promise: Promise<T>): Promise<{ ok: T } | { error: unknown }> {
    return promise.then(ok => ({ ok }), error => ({ error }));
}

function errorOf(result: { ok: unknown } | { error: unknown }): RebaseApiError {
    if (!("error" in result)) throw new Error(`expected a rejection, got ${JSON.stringify(result.ok)}`);
    expect(result.error).toBeInstanceOf(RebaseApiError);
    return result.error as RebaseApiError;
}

describe("socket requests are at-most-once", () => {
    beforeEach(() => {
        clients = [];
        jest.useFakeTimers();
        for (const level of ["log", "debug", "warn", "error"] as const) {
            jest.spyOn(console, level).mockImplementation(() => undefined);
        }
    });

    afterEach(() => {
        for (const client of clients) client.disconnect(true);
        jest.clearAllTimers();
        jest.useRealTimers();
        jest.restoreAllMocks();
    });

    it("a SAVE whose answer is lost to a dropped socket runs once and is reported lost", async () => {
        const server = new FaultServer();
        const client = connect(server);
        await jest.advanceTimersByTimeAsync(20);

        server.dropNextAfterSend(frame => frame.type === "SAVE");
        const saved = outcome(client.save({ path: "items", values: { title: "pay invoice 42" }, status: "new" }));
        // The socket comes back on its own.
        await jest.advanceTimersByTimeAsync(5_000);

        const error = errorOf(await saved);
        expect(error.code).toBe("CONNECTION_LOST");
        expect(server.current?.readyState).toBe(1);
        expect(server.receivedOfType("SAVE")).toHaveLength(1);
        expect(server.rows("items")).toHaveLength(1);
    });

    it("the Studio SQL editor's statement is never replayed", async () => {
        const server = new FaultServer();
        const client = connect(server);
        await jest.advanceTimersByTimeAsync(20);

        server.dropNextAfterSend(frame => frame.type === "EXECUTE_SQL");
        const ran = outcome(client.executeSql("UPDATE accounts SET balance = balance - 100 WHERE id = 7"));
        await jest.advanceTimersByTimeAsync(5_000);

        expect(errorOf(await ran).code).toBe("CONNECTION_LOST");
        expect(server.receivedOfType("EXECUTE_SQL")).toHaveLength(1);
        // And nothing written on the new socket either.
        expect(server.current!.written.filter(frame => frame.type === "EXECUTE_SQL")).toHaveLength(0);
    });

    it("a request queued while the server is down times out instead of waiting forever", async () => {
        const server = new FaultServer();
        server.down();
        const client = connect(server);

        const ran = outcome(client.executeSql("DELETE FROM sessions"));
        await jest.advanceTimersByTimeAsync(30_000);
        expect(errorOf(await ran).code).toBe("REQUEST_TIMEOUT");

        // When the server comes back, the abandoned statement is not sent.
        server.up();
        client.ensureConnected();
        await jest.advanceTimersByTimeAsync(60_000);
        expect(server.current?.readyState).toBe(1);
        expect(server.receivedOfType("EXECUTE_SQL")).toHaveLength(0);
    });

    it("a queued request's deadline runs from the call, not from when it was finally written", async () => {
        const server = new FaultServer(frame => frame.type === "EXECUTE_SQL" ? [] : []);
        server.refuseNext(2); // first dial + first retry refused: open at ~6s
        const client = connect(server);

        const ran = outcome(client.executeSql("SELECT pg_sleep(60)"));
        await jest.advanceTimersByTimeAsync(10_000);
        // Written by now, and the server will never answer it.
        expect(server.receivedOfType("EXECUTE_SQL")).toHaveLength(1);

        await jest.advanceTimersByTimeAsync(20_001);
        expect(errorOf(await ran).code).toBe("REQUEST_TIMEOUT");
    });

    it("a frame that was never written still goes out once the socket opens", async () => {
        const server = new FaultServer();
        server.refuseNext(1);
        const client = connect(server);

        const fetched = outcome(client.fetchCollection({ path: "items" }));
        await jest.advanceTimersByTimeAsync(5_000);

        expect(await fetched).toEqual({ ok: [] });
        expect(server.receivedOfType("FETCH_COLLECTION")).toHaveLength(1);
    });

    it("a half-open socket times the request out, and a later close does not resend it", async () => {
        const server = new FaultServer();
        const client = connect(server);
        await jest.advanceTimersByTimeAsync(20);

        server.halfOpen();
        const ran = outcome(client.executeSql("INSERT INTO audit VALUES (1)"));
        await jest.advanceTimersByTimeAsync(30_000);
        expect(errorOf(await ran).code).toBe("REQUEST_TIMEOUT");

        // The OS finally notices and closes it; the client redials.
        server.current!.drop();
        await jest.advanceTimersByTimeAsync(5_000);
        const written = server.sockets.flatMap(socket => socket.written).filter(frame => frame.type === "EXECUTE_SQL");
        expect(written).toHaveLength(1);
    });
});
