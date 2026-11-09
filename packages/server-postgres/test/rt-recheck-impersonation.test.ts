import { describe, it, expect, jest, beforeEach, afterEach } from "@jest/globals";
import type { Server } from "http";

let mockWssInstance: { on: jest.Mock; clients: Set<unknown> } | null = null;

jest.mock("ws", () => ({
    WebSocketServer: jest.fn().mockImplementation(() => {
        mockWssInstance = { on: jest.fn(), clients: new Set() };
        return mockWssInstance;
    }),
    WebSocket: jest.fn()
}));

import { createPostgresWebSocket } from "../src/websocket";
import { fakeAuthAdapter, fakeDataDriver, fakeSocketRealtime } from "./helpers/spg-c-socket";

/**
 * An identity check that was asked before a socket started — or stopped —
 * impersonating someone does not decide who the socket is afterwards.
 *
 * The check re-reads `(token, impersonate)` and, when the answer differs from
 * the session, applies it and re-scopes every subscription to it. A check that
 * set out before an `AUTHENTICATE` changed only `impersonate` — the same token
 * — came back with the identity the socket held before, found it different
 * from the one it holds now, and put it back: an administrator who had just
 * started impersonating a user went on reading as the administrator, and one
 * who had just stopped went on reading as the user, until the next check.
 */

const SWEEP_MS = 1_000;

type Account = { uid: string; roles: string[] };

const accounts = new Map<string, Account>([["admin", { uid: "boss", roles: ["admin"] }]]);
const users = new Map<string, Account>([
    ["boss", { uid: "boss", roles: ["admin"] }],
    ["u9", { uid: "u9", roles: ["user"] }]
]);

let held: boolean;
let waiting: Array<() => void>;
let rescoped: Array<[string, string]>;
let clientIds: Map<unknown, string>;

const adapter = fakeAuthAdapter({
    verifyToken: async (token: string) => {
        if (held) await new Promise<void>(resolve => waiting.push(resolve));
        const account = accounts.get(token);
        return account ? { ...account, email: "", isAdmin: account.roles.includes("admin") } : null;
    },
    resolveUser: async (uid: string) => {
        const user = users.get(uid);
        return user ? { ...user, email: "", isAdmin: user.roles.includes("admin") } : null;
    }
});

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
        id: () => clientIds.get(ws)!,
        send: (message: unknown) => onMessage(Buffer.from(JSON.stringify(message))),
        frames: () => ws.send.mock.calls.map((call) => JSON.parse(call[0] as string) as { type: string; payload?: { uid?: string } })
    };
}

/** Start a sweep whose lookup waits, then re-authenticate, then let the sweep's lookup answer last. */
async function sweepOvertakenBy(socket: ReturnType<typeof connect>, payload: Record<string, unknown>): Promise<void> {
    held = true;
    jest.advanceTimersByTime(SWEEP_MS);
    await settle();
    expect(waiting).toHaveLength(1);

    const reauth = socket.send({ type: "AUTHENTICATE", requestId: "again", payload });
    await settle();
    expect(waiting).toHaveLength(2);

    held = false;
    // The re-authentication answers first…
    waiting.splice(1, 1)[0]();
    await reauth;
    await settle();
    expect(socket.frames().at(-1)?.type).toBe("AUTH_SUCCESS");
    // …and the sweep's lookup, asked before it, last.
    waiting.shift()!();
    await settle();
}

beforeEach(() => {
    jest.useFakeTimers();
    held = false;
    waiting = [];
    rescoped = [];
    clientIds = new Map();
    mockWssInstance = null;
    const realtime = fakeSocketRealtime();
    realtime.addClient.mockImplementation((clientId, ws) => { clientIds.set(ws, clientId); });
    realtime.rescopeClient.mockImplementation(async (clientId, context) => {
        rescoped.push([clientId, context.uid]);
    });
    createPostgresWebSocket({} as Server, realtime, fakeDataDriver(), { requireAuth: true }, adapter, { identityRecheckIntervalMs: SWEEP_MS });
});

afterEach(() => {
    handler("close")();
    jest.useRealTimers();
});

describe("an identity check overtaken by an impersonation change", () => {
    it("leaves a socket that started impersonating reading as the user it impersonates", async () => {
        const socket = connect();
        await socket.send({ type: "AUTHENTICATE", requestId: "auth", payload: { token: "admin" } });
        expect(socket.frames().at(-1)?.type).toBe("AUTH_SUCCESS");
        rescoped = [];

        await sweepOvertakenBy(socket, { token: "admin", impersonate: "u9" });

        expect(rescoped).toEqual([[socket.id(), "u9"]]);
        expect(socket.ws.close).not.toHaveBeenCalled();
    });

    it("leaves a socket that stopped impersonating reading as its own identity", async () => {
        const socket = connect();
        await socket.send({ type: "AUTHENTICATE", requestId: "auth", payload: { token: "admin", impersonate: "u9" } });
        expect(socket.frames().at(-1)?.type).toBe("AUTH_SUCCESS");
        rescoped = [];

        await sweepOvertakenBy(socket, { token: "admin" });

        expect(rescoped).toEqual([[socket.id(), "boss"]]);
        expect(socket.ws.close).not.toHaveBeenCalled();
    });
});
