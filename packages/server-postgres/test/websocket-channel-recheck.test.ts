import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { Server } from "http";
import type { AuthAdapter } from "@rebasepro/types";

let mockWssInstance: { on: jest.Mock; clients: Set<unknown> } | null = null;

jest.mock("ws", () => ({
    WebSocketServer: jest.fn().mockImplementation(() => {
        mockWssInstance = { on: jest.fn(), clients: new Set() };
        return mockWssInstance;
    }),
    WebSocket: jest.fn()
}));

import { createPostgresWebSocket } from "../src/websocket";
import type { RealtimeService } from "../src/services/realtimeService";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

/**
 * The identity check before channel frames, when the auth store is busy.
 *
 * A load test of 100 rooms (800 sockets broadcasting game state) made the
 * per-frame check the busiest query on the pool, and once the pool was
 * saturated the checks failed: each failure dropped the frame — a join or a
 * broadcast the client never knew to resend — and every following frame asked
 * again. Channel frames now re-check at most every five seconds, a failed
 * check holds off the next for as long, and while the store cannot answer a
 * frame within a minute of the last confirmed check goes through.
 */

type Account = { uid: string; roles: string[] };

let accounts: Map<string, Account>;
let asked: string[];
/** While set, the auth store fails as a saturated pool does. */
let busy: boolean;
let delivered: string[];
let clientIds: Map<unknown, string>;

const adapter = {
    verifyToken: async (token: string) => {
        asked.push(token);
        if (busy) throw new Error("timeout exceeded when trying to connect");
        const account = accounts.get(token);
        return account ? { ...account, isAdmin: false } : null;
    },
    verifyRequest: async () => null,
    resolveUser: async () => null
} as unknown as AuthAdapter;

async function settle(): Promise<void> {
    for (let i = 0; i < 200; i++) await Promise.resolve();
}

function handler(event: string): (...args: unknown[]) => unknown {
    return mockWssInstance!.on.mock.calls.find((call) => call[0] === event)![1] as (...args: unknown[]) => unknown;
}

function connect() {
    const ws = { on: jest.fn(), send: jest.fn(), close: jest.fn() };
    handler("connection")(ws);
    const onMessage = ws.on.mock.calls.find((call) => call[0] === "message")![1] as (data: Buffer) => Promise<void>;
    return {
        ws,
        send: async (message: unknown) => { await onMessage(Buffer.from(JSON.stringify(message))); await settle(); },
        errors: () => ws.send.mock.calls
            .map((call) => JSON.parse(call[0] as string) as { type: string; payload?: { error?: { code?: string } } })
            .filter((frame) => frame.type === "ERROR")
            .map((frame) => frame.payload?.error?.code)
    };
}

async function signedIn(token: string) {
    const socket = connect();
    await socket.send({ type: "AUTHENTICATE", requestId: "auth", payload: { token } });
    return socket;
}

const broadcast = (n: number) => ({ type: "broadcast", payload: { channel: "room", event: "state", payload: { n } } });
const subscribe = { type: "subscribe_collection", requestId: "s", payload: { path: "posts", subscriptionId: "sub" } };

beforeEach(() => {
    jest.useFakeTimers();
    accounts = new Map([["t1", { uid: "u1", roles: ["user"] }]]);
    asked = [];
    busy = false;
    delivered = [];
    clientIds = new Map();
    mockWssInstance = null;
    const driver = { key: "postgres", initialised: true } as unknown as PostgresBackendDriver;
    const realtime = {
        addClient: jest.fn((clientId: string, ws: unknown) => clientIds.set(ws, clientId)),
        handleClientMessage: jest.fn(async (_clientId: string, message: { type: string }) => { delivered.push(message.type); }),
        rescopeClient: jest.fn(async () => undefined)
    } as unknown as RealtimeService;
    createPostgresWebSocket({} as Server, realtime, driver, { requireAuth: true }, adapter, { identityRecheckIntervalMs: 3_600_000 });
});

afterEach(() => {
    handler("close")();
    jest.useRealTimers();
});

describe("channel frames and the identity check", () => {
    it("asks the auth store at most once every five seconds", async () => {
        const socket = await signedIn("t1");
        asked = [];
        for (let i = 0; i < 4; i++) {
            jest.advanceTimersByTime(1_000);
            await socket.send(broadcast(i));
        }
        expect(asked).toEqual([]);
        jest.advanceTimersByTime(1_500);
        await socket.send(broadcast(9));
        expect(asked).toEqual(["t1"]);
        expect(delivered.filter((t) => t === "broadcast")).toHaveLength(5);
    });

    it("lets a channel frame through while the store is busy, within a minute of the last good check", async () => {
        const socket = await signedIn("t1");
        asked = [];
        busy = true;
        jest.advanceTimersByTime(6_000);
        await socket.send(broadcast(1));
        expect(asked).toEqual(["t1"]);
        expect(socket.errors()).toEqual([]);
        expect(delivered).toContain("broadcast");

        // the failed check holds off the next one
        jest.advanceTimersByTime(1_000);
        await socket.send(broadcast(2));
        expect(asked).toEqual(["t1"]);
        expect(delivered.filter((t) => t === "broadcast")).toHaveLength(2);
    });

    it("refuses channel frames once the last good check is over a minute old", async () => {
        const socket = await signedIn("t1");
        busy = true;
        jest.advanceTimersByTime(61_000);
        await socket.send(broadcast(1));
        expect(socket.errors()).toEqual(["ROLE_LOOKUP_FAILED"]);
        expect(delivered).not.toContain("broadcast");
    });

    it("gives data frames no grace: they are refused when the store cannot answer", async () => {
        const socket = await signedIn("t1");
        busy = true;
        jest.advanceTimersByTime(1_000);
        await socket.send(subscribe);
        expect(socket.errors()).toEqual(["ROLE_LOOKUP_FAILED"]);
        expect(delivered).not.toContain("subscribe_collection");
    });

    it("still ends the session at once when the store answers that the credential is gone", async () => {
        const socket = await signedIn("t1");
        accounts.delete("t1");
        jest.advanceTimersByTime(6_000);
        await socket.send(broadcast(1));
        expect(socket.ws.close).toHaveBeenCalledWith(4001, expect.any(String));
        expect(delivered).not.toContain("broadcast");
    });
});
