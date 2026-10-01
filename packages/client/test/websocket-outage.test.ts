import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import { RebaseApiError } from "@rebasepro/types";
import { RebaseWebSocketClient } from "../src/websocket";
import { RebaseRealtimeChannel } from "../src/realtime-channel";
import { FaultServer } from "./support/fault-socket";

/**
 * An outage longer than the retry budget.
 *
 * The client used to make five attempts (2 + 4 + 8 + 16 + 30 s) and then stop,
 * failing only the subscriptions that had never loaded. A deploy, a crash loop
 * or a slow migration-on-boot that kept the server away for 70 s therefore left
 * every live view that *had* loaded frozen on its last rows for the life of the
 * page — the server came back, rows changed, nothing updated, and `onError` was
 * never called. A server restart fires no browser `online` event, and Node has
 * no `window` at all, so nothing ever redialled.
 *
 * Now: while anything is registered the client never stops retrying (capped
 * backoff with jitter); an outage that outlasts a blip is reported once to every
 * subscription's `onError` as `CONNECTION_LOST`; `client.ws.state` says where
 * the connection is; and when the socket is back every subscription is
 * re-subscribed, so its next `onUpdate` carries the rows written meanwhile.
 */

let clients: RebaseWebSocketClient[] = [];

function connect(server: FaultServer): RebaseWebSocketClient {
    const client = new RebaseWebSocketClient({ websocketUrl: "ws://test", WebSocket: server.WebSocket });
    client.ensureConnected();
    clients.push(client);
    return client;
}

describe("an outage longer than the retry budget", () => {
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

    it("a loaded live view is told once, keeps its registration, and updates when the server is back", async () => {
        const server = new FaultServer();
        server.setRows("items", [{ id: "1", title: "one" }]);
        const client = connect(server);
        const updates: number[] = [];
        const errors: RebaseApiError[] = [];
        client.listenCollection({ path: "items" }, rows => updates.push(rows.length), error => errors.push(error as RebaseApiError));
        await jest.advanceTimersByTimeAsync(20);
        expect(updates).toEqual([1]);

        // A deploy that takes ten minutes.
        server.down();
        server.current!.drop();
        await jest.advanceTimersByTimeAsync(10 * 60_000);

        expect(errors).toHaveLength(1);
        expect(errors[0]).toBeInstanceOf(RebaseApiError);
        expect(errors[0].code).toBe("CONNECTION_LOST");
        expect(client.state).toBe("disconnected");

        // The server is back, with a row written while this client was away.
        server.setRows("items", [{ id: "1", title: "one" }, { id: "2", title: "two" }]);
        server.up();
        await jest.advanceTimersByTimeAsync(31_000);

        expect(client.state).toBe("connected");
        expect(updates).toEqual([1, 2]);
        // Still once: the recovery is the fresh `onUpdate`, not another error.
        expect(errors).toHaveLength(1);

        // And it is live again, not just refreshed.
        server.broadcast({
            type: "collection_update",
            subscriptionId: String(server.receivedOfType("subscribe_collection").at(-1)!.payload!.subscriptionId),
            rows: [{ id: "1" }, { id: "2" }, { id: "3" }]
        });
        expect(updates).toEqual([1, 2, 3]);
    });

    it("never stops redialling while something is subscribed, and never waits more than 30s between dials", async () => {
        const server = new FaultServer();
        const client = connect(server);
        client.listenOne({ path: "items", id: "1" }, () => undefined, () => undefined);
        await jest.advanceTimersByTimeAsync(20);

        server.down();
        server.current!.drop();
        const dialsBefore = server.sockets.length;
        await jest.advanceTimersByTimeAsync(30 * 60_000);

        // 30 minutes at a 30 s ceiling: well over 50 dials, not five.
        expect(server.sockets.length - dialsBefore).toBeGreaterThan(50);
    });

    it("a blip shorter than the budget reports nothing", async () => {
        const server = new FaultServer();
        const client = connect(server);
        const errors: Error[] = [];
        client.listenCollection({ path: "items" }, () => undefined, error => errors.push(error));
        await jest.advanceTimersByTimeAsync(20);

        server.refuseNext(1);
        server.current!.drop();
        await jest.advanceTimersByTimeAsync(10_000);

        expect(client.state).toBe("connected");
        expect(errors).toEqual([]);
    });

    it("walks its states, and says so", async () => {
        const server = new FaultServer();
        const client = new RebaseWebSocketClient({ websocketUrl: "ws://test", WebSocket: server.WebSocket });
        clients.push(client);
        const seen: string[] = [];
        client.onStateChange(state => seen.push(state));
        expect(client.state).toBe("idle");

        client.listenCollection({ path: "items" }, () => undefined, () => undefined);
        await jest.advanceTimersByTimeAsync(20);
        server.down();
        server.current!.drop();
        await jest.advanceTimersByTimeAsync(5 * 60_000);
        server.up();
        await jest.advanceTimersByTimeAsync(31_000);
        client.disconnect(true);

        expect(seen).toEqual(["connecting", "connected", "reconnecting", "disconnected", "connected", "closed"]);
    });

    it("a listener that attaches during a reported outage is told at once", async () => {
        const server = new FaultServer();
        const client = connect(server);
        client.listenCollection({ path: "items" }, () => undefined, () => undefined);
        await jest.advanceTimersByTimeAsync(20);
        server.down();
        server.current!.drop();
        await jest.advanceTimersByTimeAsync(5 * 60_000);

        const errors: RebaseApiError[] = [];
        client.listenOne({ path: "items", id: "9" }, () => undefined, error => errors.push(error as RebaseApiError));
        await jest.advanceTimersByTimeAsync(0);
        expect(errors.map(error => error.code)).toEqual(["CONNECTION_LOST"]);
    });

    it("a joined channel is told too, and re-joins when the server is back", async () => {
        const server = new FaultServer();
        const client = connect(server);
        await jest.advanceTimersByTimeAsync(20);
        const channel = new RebaseRealtimeChannel("room", client);
        const errors: RebaseApiError[] = [];
        channel.onError(error => errors.push(error));
        await channel.join();

        server.down();
        server.current!.drop();
        await jest.advanceTimersByTimeAsync(5 * 60_000);
        expect(errors.map(error => error.code)).toEqual(["CONNECTION_LOST"]);

        server.up();
        await jest.advanceTimersByTimeAsync(31_000);
        expect(server.current!.written.map(frame => frame.type)).toContain("join_channel");
        await channel.leave();
    });

    it("with nothing registered it still stops after the budget, and a later subscribe dials again", async () => {
        const server = new FaultServer();
        const client = connect(server);
        await jest.advanceTimersByTimeAsync(20);

        server.down();
        server.current!.drop();
        await jest.advanceTimersByTimeAsync(10 * 60_000);
        const settled = server.sockets.length;
        await jest.advanceTimersByTimeAsync(10 * 60_000);
        expect(server.sockets).toHaveLength(settled);

        server.up();
        const updates: unknown[] = [];
        client.listenCollection({ path: "items" }, rows => updates.push(rows), () => undefined);
        await jest.advanceTimersByTimeAsync(20);
        expect(updates).toEqual([[]]);
        expect(client.state).toBe("connected");
    });

    it("a tab coming back to the foreground dials at once instead of waiting out the backoff", async () => {
        const target = new EventTarget();
        const documentStub = Object.assign(target, { visibilityState: "visible" as DocumentVisibilityState });
        const hadDocument = "document" in globalThis;
        const hadWindow = "window" in globalThis;
        if (!hadDocument) Object.defineProperty(globalThis, "document", { value: documentStub, configurable: true });
        if (!hadWindow) Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
        try {
            const server = new FaultServer();
            const client = connect(server);
            client.listenCollection({ path: "items" }, () => undefined, () => undefined);
            await jest.advanceTimersByTimeAsync(20);
            server.down();
            server.current!.drop();
            await jest.advanceTimersByTimeAsync(5 * 60_000);
            // Mid-wait: the next scheduled dial is up to 30 s away.
            await jest.advanceTimersByTimeAsync(1_000);

            server.up();
            const before = server.sockets.length;
            target.dispatchEvent(new Event("visibilitychange"));
            await jest.advanceTimersByTimeAsync(20);
            expect(server.sockets.length).toBe(before + 1);
            expect(client.state).toBe("connected");
        } finally {
            if (!hadDocument) delete (globalThis as { document?: unknown }).document;
            if (!hadWindow) delete (globalThis as { window?: unknown }).window;
        }
    });
});
