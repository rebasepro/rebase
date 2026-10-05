import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * The server lets go of a socket whose peer has gone, and of one that does not
 * read what it is sent.
 *
 * A phone that loses signal or a laptop that sleeps leaves its socket open on
 * the server: no close frame, no FIN. Nothing pinged the socket, so the server
 * kept it — every subscription refetched on every write to its collection,
 * every frame serialised into a send buffer nobody drained — until the OS gave
 * up on the TCP connection, about two hours on Linux (measured: 20
 * subscriptions still held for a black-holed peer after 40 s, and 210 pool
 * acquisitions for 5 writes). Each socket is now pinged every 30 seconds, and
 * one that has not answered by the next ping is terminated. A socket whose
 * unsent backlog passes a ceiling is terminated too. Either way it goes the way
 * a closed one does: its subscriptions, channels and presence with it.
 *
 * Real sockets, so a terminated socket closes the way `ws` closes it; fake
 * timers for the 30-second clock, with the event loop's own I/O left real.
 */

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest: jest.fn(async () => [{ id: 1 }]),
        fetchOneForRest: jest.fn(async () => ({ id: 1 })),
        count: jest.fn(async () => 1),
        cursorFor: jest.fn().mockReturnValue(undefined)
    }))
}));

import http from "http";
import WebSocket from "ws";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";
import { createPostgresWebSocket } from "../src/websocket";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { MAX_SOCKET_BUFFERED_BYTES } from "../src/services/socket-liveness";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

const posts = {
    slug: "posts",
    name: "posts",
    table: "posts",
    properties: { id: { type: "number", isId: true } }
} as unknown as CollectionConfig;

type Frame = {
    type: string;
    subscriptionId?: string;
    channel?: string;
    joins?: Record<string, Record<string, unknown>>;
    leaves?: Record<string, Record<string, unknown>>;
};

/** One byte past the ceiling. */
const PAST_THE_CEILING = MAX_SOCKET_BUFFERED_BYTES + 1;

let service: RealtimeService;
let server: http.Server;
/** The server's end of each connection, in the order they connected. */
let onServer: WebSocket[];
let clients: WebSocket[];

/**
 * Let real I/O run until `condition` holds. Only `setImmediate` is used to
 * yield — the timers are fake.
 */
async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 20_000; i++) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`never happened: ${what}`);
}

beforeEach(async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    onServer = [];
    clients = [];
    const db = {
        execute: jest.fn(async () => ({ rows: [] })),
        transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(db))
    } as unknown as NodePgDatabase<Record<string, never>>;
    const registry = new PostgresCollectionRegistry();
    registry.registerMultiple([posts]);
    service = new RealtimeService(db, registry);
    service.setDataDriver({ callContextWithin: () => ({}) } as never);
    const addClient = service.addClient.bind(service);
    jest.spyOn(service, "addClient").mockImplementation((clientId: string, ws: WebSocket) => {
        onServer.push(ws);
        addClient(clientId, ws);
    });

    server = http.createServer();
    const driver = { key: "postgres", initialised: true } as unknown as PostgresBackendDriver;
    createPostgresWebSocket(server, service, driver, { requireAuth: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
    for (const ws of clients) ws.terminate();
    jest.useRealTimers();
    await service.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function open(options?: WebSocket.ClientOptions): Promise<{ ws: WebSocket; frames: Frame[]; send: (frame: unknown) => void }> {
    const { port } = server.address() as { port: number };
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, options);
    clients.push(ws);
    const frames: Frame[] = [];
    ws.on("message", (data) => frames.push(JSON.parse(data.toString()) as Frame));
    await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
    });
    const index = clients.length - 1;
    await until(() => onServer.length > index, "the server saw the connection");
    return { ws, frames, send: (frame) => ws.send(JSON.stringify(frame)) };
}

/** Everything a client can hold: a subscription, a channel, a presence. */
async function holdEverything(client: Awaited<ReturnType<typeof open>>, name: string): Promise<void> {
    client.send({ type: "subscribe_collection", payload: { path: "posts", subscriptionId: `sub-${name}` } });
    client.send({ type: "join_channel", payload: { channel: "room" } });
    client.send({ type: "presence_track", payload: { channel: "room", state: { name } } });
    await until(() => client.frames.some(f => f.subscriptionId === `sub-${name}`), `${name}'s first frame`);
}

const leftTheRoom = (frames: Frame[], name: string) =>
    frames.some(f => f.type === "presence_diff" && Object.values(f.leaves ?? {}).some(state => state.name === name));

describe("a socket that stops answering pings", () => {
    it("is terminated once it has missed a ping — not before — and leaves the way a closed socket does", async () => {
        const watcher = await open();
        const zombie = await open({ autoPong: false });
        const [watcherOnServer, zombieOnServer] = onServer;
        let watcherPongs = 0;
        watcherOnServer.on("pong", () => watcherPongs++);
        let zombiePings = 0;
        zombie.ws.on("ping", () => zombiePings++);
        const terminate = jest.spyOn(zombieOnServer, "terminate");

        await holdEverything(watcher, "watcher");
        await holdEverything(zombie, "zombie");
        expect(service.subscriptions.size).toBe(2);

        // Both re-track inside the presence timeout, as the SDK does, so a
        // departure announced later can only be the socket's own.
        const retrack = async () => {
            const diffs = () => watcher.frames.filter(f => f.type === "presence_diff").length;
            const seen = diffs();
            watcher.send({ type: "presence_track", payload: { channel: "room", state: { name: "watcher" } } });
            zombie.send({ type: "presence_track", payload: { channel: "room", state: { name: "zombie" } } });
            await until(() => diffs() >= seen + 2, "both re-tracked");
        };

        jest.advanceTimersByTime(20_000);
        await retrack();

        // The first ping goes out at 30 s; nobody has missed anything yet.
        jest.advanceTimersByTime(10_000);
        await until(() => watcherPongs === 1 && zombiePings === 1, "both pinged, the watcher answered");
        expect(terminate).not.toHaveBeenCalled();

        jest.advanceTimersByTime(10_000);
        await retrack();
        jest.advanceTimersByTime(19_999);
        expect(terminate).not.toHaveBeenCalled();
        expect(zombie.ws.readyState).toBe(WebSocket.OPEN);
        expect(leftTheRoom(watcher.frames, "zombie")).toBe(false);

        // The next ping, at 60 s, finds the first one never answered.
        jest.advanceTimersByTime(1);
        expect(terminate).toHaveBeenCalledTimes(1);
        await until(() => zombie.ws.readyState === WebSocket.CLOSED, "the zombie's connection closed");
        await until(() => service.subscriptions.size === 1, "the zombie's subscription dropped");
        await until(() => leftTheRoom(watcher.frames, "zombie"), "the room told the zombie left");

        expect([...service.subscriptions.values()].map(s => s.subscriptionId)).toEqual(["sub-watcher"]);
        expect(watcher.ws.readyState).toBe(WebSocket.OPEN);
        expect(leftTheRoom(watcher.frames, "watcher")).toBe(false);
    });

    it("keeps a socket that answers every ping", async () => {
        const watcher = await open();
        const [watcherOnServer] = onServer;
        let pongs = 0;
        watcherOnServer.on("pong", () => pongs++);
        const terminate = jest.spyOn(watcherOnServer, "terminate");

        for (let ping = 1; ping <= 5; ping++) {
            jest.advanceTimersByTime(30_000);
            await until(() => pongs === ping, `pong ${ping}`);
        }

        expect(terminate).not.toHaveBeenCalled();
        expect(watcher.ws.readyState).toBe(WebSocket.OPEN);
    });
});

describe("a socket that does not read what it is sent", () => {
    it("is terminated at the next frame for it once its backlog passes the ceiling, and leaves the way a closed socket does", async () => {
        const watcher = await open();
        const slow = await open();
        await holdEverything(watcher, "watcher");
        await holdEverything(slow, "slow");
        const slowOnServer = onServer[1];
        const terminate = jest.spyOn(slowOnServer, "terminate");
        const send = jest.spyOn(slowOnServer, "send");
        Object.defineProperty(slowOnServer, "bufferedAmount", { configurable: true, get: () => PAST_THE_CEILING });

        // A write: both subscriptions are refetched, and a frame is due to each.
        await service.notifyUpdate("posts", "1", { id: 1 });
        jest.advanceTimersByTime(350);

        await until(() => terminate.mock.calls.length === 1, "the slow socket terminated");
        expect(send).not.toHaveBeenCalled();
        await until(() => slow.ws.readyState === WebSocket.CLOSED, "the slow connection closed");
        await until(() => service.subscriptions.size === 1, "the slow subscription dropped");
        await until(() => leftTheRoom(watcher.frames, "slow"), "the room told the slow socket left");
        expect(watcher.ws.readyState).toBe(WebSocket.OPEN);
    });

    it("is terminated by a channel broadcast for it, too", async () => {
        const sender = await open();
        const slow = await open();
        sender.send({ type: "join_channel", payload: { channel: "room" } });
        slow.send({ type: "join_channel", payload: { channel: "room" } });
        // A presence_state round trip proves each join was handled.
        sender.send({ type: "presence_state", payload: { channel: "room" } });
        slow.send({ type: "presence_state", payload: { channel: "room" } });
        await until(() => sender.frames.some(f => f.type === "presence_state") && slow.frames.some(f => f.type === "presence_state"), "both joined");
        const slowOnServer = onServer[1];
        const terminate = jest.spyOn(slowOnServer, "terminate");
        Object.defineProperty(slowOnServer, "bufferedAmount", { configurable: true, get: () => PAST_THE_CEILING });

        sender.send({ type: "broadcast", payload: { channel: "room", event: "cursor", payload: { x: 1 } } });

        await until(() => terminate.mock.calls.length === 1, "the slow member terminated");
        await until(() => slow.ws.readyState === WebSocket.CLOSED, "the slow connection closed");
    });

    it("is terminated at its next request once replies it has not read pass the ceiling", async () => {
        const slow = await open();
        const slowOnServer = onServer[0];
        const terminate = jest.spyOn(slowOnServer, "terminate");
        Object.defineProperty(slowOnServer, "bufferedAmount", { configurable: true, get: () => PAST_THE_CEILING });

        slow.send({ type: "COUNT", requestId: "r1", payload: { path: "posts" } });

        await until(() => terminate.mock.calls.length === 1, "the slow socket terminated");
        await until(() => slow.ws.readyState === WebSocket.CLOSED, "the slow connection closed");
        expect(slow.frames).toEqual([]);
    });

    it("keeps a socket whose backlog is at the ceiling, not past it", async () => {
        const reader = await open();
        await holdEverything(reader, "reader");
        const terminate = jest.spyOn(onServer[0], "terminate");
        Object.defineProperty(onServer[0], "bufferedAmount", { configurable: true, get: () => MAX_SOCKET_BUFFERED_BYTES });
        const before = reader.frames.length;

        await service.notifyUpdate("posts", "1", { id: 1 });
        jest.advanceTimersByTime(350);

        await until(() => reader.frames.length > before, "the frame after the write");
        expect(terminate).not.toHaveBeenCalled();
    });
});

describe("shutting the server down", () => {
    it("stops the ping clock with it", async () => {
        await open();
        for (const ws of clients) ws.terminate();
        await until(() => onServer.every(ws => ws.readyState === WebSocket.CLOSED), "the server side closed");
        await service.destroy();
        expect(jest.getTimerCount()).toBeGreaterThan(0);

        await new Promise<void>((resolve) => server.close(() => resolve()));

        expect(jest.getTimerCount()).toBe(0);
        // afterEach closes it again; a second listen keeps that harmless.
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    });
});
