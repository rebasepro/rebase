import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";

/**
 * Every socket that closes says who closed it.
 *
 * A close used to leave one debug line, and none in production, so "the
 * phones keep losing the room" had nothing to be read against: not whether
 * the server let the socket go, the client gave up on it or the network
 * dropped it, how old it was or what it was in. Each socket's open and close
 * is now an info line, and `/metrics` counts closes by who closed them and by
 * code, frames and bytes each way, and refused frames.
 *
 * Real sockets, so each close arrives with the code `ws` gives it.
 */

jest.mock("../src/services/dataService", () => ({
    DataService: jest.fn().mockImplementation(() => ({
        fetchCollectionForRest: jest.fn(async () => []),
        fetchOneForRest: jest.fn(async () => null),
        count: jest.fn(async () => 0),
        cursorFor: jest.fn().mockReturnValue(undefined)
    }))
}));

import http from "http";
import WebSocket from "ws";
import { logger } from "@rebasepro/server";
import { createPostgresWebSocket } from "../src/websocket";
import { RealtimeService } from "../src/services/realtimeService";
import { FixtureTableRegistry } from "./helpers/tables";
import { closeCodeLabel, socketStats } from "../src/services/socket-stats";
import { fakeDataDriver, fakeCallContextDriver } from "./helpers/spg-c-socket";
import { recordingDb } from "./helpers/spg-c-db";

let service: RealtimeService;
let server: http.Server;
let clients: WebSocket[];
let info: jest.SpiedFunction<typeof logger.info>;

async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 20_000; i++) {
        if (condition()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`never happened: ${what}`);
}

/** The fields of every info line with this message, in order. */
function lines(message: string): Array<Record<string, unknown>> {
    return info.mock.calls.filter(([msg]) => msg === message).map(([, data]) => data ?? {});
}

beforeEach(async () => {
    clients = [];
    info = jest.spyOn(logger, "info");
    const { db } = recordingDb();
    service = new RealtimeService(db, new FixtureTableRegistry());
    service.setDataDriver(fakeCallContextDriver());
    server = http.createServer();
    createPostgresWebSocket(server, service, fakeDataDriver(), { requireAuth: false });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
});

afterEach(async () => {
    for (const ws of clients) ws.terminate();
    await service.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    info.mockRestore();
});

async function open(query = "", options?: WebSocket.ClientOptions): Promise<WebSocket> {
    const { port } = server.address() as { port: number };
    const opened = lines("[WebSocket Server] Socket opened").length;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/${query}`, options);
    clients.push(ws);
    await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
    });
    await until(() => lines("[WebSocket Server] Socket opened").length > opened, "the server saw the connection");
    ids.set(ws, String(lines("[WebSocket Server] Socket opened")[opened].clientId));
    return ws;
}

/** The server's id for each client socket, from the line its open logged. */
const ids = new Map<WebSocket, string>();

/** Join `room` and wait until the server has it. */
async function inRoom(ws: WebSocket): Promise<void> {
    ws.send(JSON.stringify({ type: "join_channel", payload: { channel: "room" } }));
    const id = ids.get(ws)!;
    await until(() => service.describeClient(id).channels.includes("room"), "joined the room");
}

/** The line `ws`'s close logged, once it has. */
async function closedLine(ws: WebSocket): Promise<Record<string, unknown>> {
    const id = ids.get(ws);
    const find = () => lines("[WebSocket Server] Socket closed").find(line => line.clientId === id);
    await until(() => find() !== undefined, "the close was logged");
    return find()!;
}

describe("the line a socket's close logs", () => {
    it("names a client's close frame, its code and reason, its age, its channels and its traffic", async () => {
        const ws = await open("?affinity=ROOM1&rebase_caps=heartbeat");
        expect(lines("[WebSocket Server] Socket opened").at(-1)).toMatchObject({ affinity: "ROOM1", caps: "heartbeat" });
        await inRoom(ws);
        const other = await open();
        await inRoom(other);
        other.send(JSON.stringify({ type: "broadcast", payload: { channel: "room", event: "state", payload: { n: 1 } } }));
        await new Promise((resolve) => ws.once("message", resolve));

        ws.close(1000, "tab closed");
        const line = await closedLine(ws);

        expect(line).toMatchObject({
            closedBy: "client",
            code: 1000,
            reason: "tab closed",
            channelCount: 1,
            channels: ["room"],
            framesIn: 1,
            framesOut: 1
        });
        expect(line.ageMs).toEqual(expect.any(Number));
        expect(line.bytesIn).toBeGreaterThan(0);
        expect(line.bytesOut).toBeGreaterThan(0);
    });

    it("tells the client's own watchdog (4003) from a connection that just went (1006)", async () => {
        const watchdog = await open();
        watchdog.close(4003, "Two heartbeats missed");
        expect(await closedLine(watchdog)).toMatchObject({ closedBy: "client_watchdog", code: 4003 });

        const dropped = await open();
        dropped.terminate();
        expect(await closedLine(dropped)).toMatchObject({ closedBy: "network", code: 1006 });
    });

    it("says when this server let a socket go for a missed ping", async () => {
        // A server of its own, made under fake timers so its 30 s reaper can be run.
        jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
        const { db } = recordingDb();
        const reaped = new RealtimeService(db, new FixtureTableRegistry());
        reaped.setDataDriver(fakeCallContextDriver());
        const reaping = http.createServer();
        createPostgresWebSocket(reaping, reaped, fakeDataDriver(), { requireAuth: false });
        await new Promise<void>((resolve) => reaping.listen(0, "127.0.0.1", resolve));
        try {
            const { port } = reaping.address() as { port: number };
            const opened = lines("[WebSocket Server] Socket opened").length;
            const silent = new WebSocket(`ws://127.0.0.1:${port}`, { autoPong: false });
            clients.push(silent);
            await new Promise<void>((resolve) => silent.once("open", () => resolve()));
            await until(() => lines("[WebSocket Server] Socket opened").length > opened, "the server saw the connection");
            ids.set(silent, String(lines("[WebSocket Server] Socket opened")[opened].clientId));

            jest.advanceTimersByTime(60_000);
            expect(await closedLine(silent)).toMatchObject({ closedBy: "no_pong", code: 1006 });
        } finally {
            jest.useRealTimers();
            await reaped.destroy();
            await new Promise<void>((resolve) => reaping.close(() => resolve()));
        }
    });

    it("says when the server shut down", async () => {
        const ws = await open();
        await inRoom(ws);
        await service.destroy();
        expect(await closedLine(ws)).toMatchObject({ closedBy: "shutdown", code: 1001 });
    });
});

describe("the socket totals /metrics reads", () => {
    it("counts opens, closes by who and by code, frames each way and refusals", async () => {
        const before = socketStats.totals();
        const a = await open();
        const b = await open();
        await inRoom(a);
        await inRoom(b);
        a.send(JSON.stringify({ type: "broadcast", payload: { channel: "room", event: "op", payload: {} } }));
        await new Promise((resolve) => b.once("message", resolve));
        a.close(1000);
        b.terminate();
        await closedLine(a);
        await closedLine(b);

        const after = service.counts().socketTotals!;
        expect(after.opened - before.opened).toBe(2);
        expect((after.closedBy.client ?? 0) - (before.closedBy.client ?? 0)).toBe(1);
        expect((after.closedBy.network ?? 0) - (before.closedBy.network ?? 0)).toBe(1);
        expect((after.closeCodes["1000"] ?? 0) - (before.closeCodes["1000"] ?? 0)).toBe(1);
        expect((after.closeCodes["1006"] ?? 0) - (before.closeCodes["1006"] ?? 0)).toBe(1);
        expect(after.framesIn - before.framesIn).toBe(3);
        expect(after.framesOut - before.framesOut).toBeGreaterThanOrEqual(1);
        expect(after.bytesOut).toBeGreaterThan(before.bytesOut);
    });

    it("labels close codes without one label per application code", () => {
        expect(closeCodeLabel(1001)).toBe("1001");
        expect(closeCodeLabel(4001)).toBe("4001");
        expect(closeCodeLabel(4567)).toBe("other");
    });
});
