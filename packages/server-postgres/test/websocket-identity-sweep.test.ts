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
 * The sweep that re-reads the identity of sockets that only listen.
 *
 * Every 30 seconds each authenticated socket was re-checked against the auth
 * store, all of them in the same tick: S sockets were S concurrent lookups on
 * the pool every REST request shares, and a person with five tabs open was
 * five identical lookups of one token. The sweep now asks once per credential
 * and impersonation target, at most four at a time, and applies the answer to
 * every socket that holds that credential.
 *
 * What it must not do is let an answer stand in for a later one: the answer is
 * the sweep's own, dropped with it, so a credential revoked between two sweeps
 * is caught by the second; and a socket that signed in as somebody else while
 * the sweep was running is asked about its new credential, never handed its
 * old one's answer.
 */

const SWEEP_MS = 1_000;

type Account = { uid: string; roles: string[] };

let accounts: Map<string, Account>;
let users: Map<string, Account>;
/** Every token the auth store was asked to verify, in order. */
let asked: string[];
/** Every uid the auth store was asked to resolve (the impersonation path). */
let resolved: string[];
let inFlight: number;
let maxInFlight: number;
/** Tokens whose verification waits until the test releases it. */
let held: Set<string>;
let waiting: Array<() => void>;
/** Every rescope, as [clientId, uid]. */
let rescoped: Array<[string, string]>;
let clientIds: Map<unknown, string>;

const adapter = {
    verifyToken: async (token: string) => {
        asked.push(token);
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
            if (held.has(token)) await new Promise<void>(resolve => waiting.push(resolve));
            const account = accounts.get(token);
            return account ? { ...account, isAdmin: account.roles.includes("admin") } : null;
        } finally {
            inFlight--;
        }
    },
    verifyRequest: async () => null,
    resolveUser: async (uid: string) => {
        resolved.push(uid);
        return users.get(uid) ?? null;
    }
} as unknown as AuthAdapter;

/** Let every promise that can settle, settle. */
async function settle(): Promise<void> {
    for (let i = 0; i < 200; i++) await Promise.resolve();
}

/** Release the held verifications one at a time, until none is waiting. */
async function releaseAll(): Promise<void> {
    await settle();
    while (waiting.length > 0) {
        waiting.shift()!();
        await settle();
    }
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
        frames: () => ws.send.mock.calls.map((call) => JSON.parse(call[0] as string) as { type: string; payload?: { error?: { code?: string } } })
    };
}

async function signedIn(token: string, impersonate?: string) {
    const socket = connect();
    await socket.send({ type: "AUTHENTICATE", requestId: "auth", payload: { token, ...(impersonate ? { impersonate } : {}) } });
    expect(socket.frames().at(-1)?.type).toBe("AUTH_SUCCESS");
    return socket;
}

/** Run one sweep and wait for it to finish. */
async function sweep(): Promise<void> {
    jest.advanceTimersByTime(SWEEP_MS);
    await releaseAll();
}

beforeEach(() => {
    jest.useFakeTimers();
    accounts = new Map([
        ["t1", { uid: "u1", roles: ["user"] }],
        ["t2", { uid: "u2", roles: ["user"] }],
        ["admin", { uid: "boss", roles: ["admin"] }],
        ["x", { uid: "ux", roles: ["user"] }],
        ...Array.from({ length: 6 }, (_, i): [string, Account] => [`s${i}`, { uid: `solo-${i}`, roles: ["user"] }])
    ]);
    users = new Map([
        ["boss", { uid: "boss", roles: ["admin"] }],
        ["u9", { uid: "u9", roles: ["user"] }]
    ]);
    asked = [];
    resolved = [];
    inFlight = 0;
    maxInFlight = 0;
    held = new Set();
    waiting = [];
    rescoped = [];
    clientIds = new Map();
    mockWssInstance = null;

    const driver = { key: "postgres", initialised: true } as unknown as PostgresBackendDriver;
    const realtime = {
        addClient: jest.fn((clientId: string, ws: unknown) => clientIds.set(ws, clientId)),
        handleClientMessage: jest.fn(async () => undefined),
        rescopeClient: jest.fn(async (clientId: string, context: { uid: string }) => {
            rescoped.push([clientId, context.uid]);
        })
    } as unknown as RealtimeService;
    createPostgresWebSocket({} as Server, realtime, driver, { requireAuth: true }, adapter, { identityRecheckIntervalMs: SWEEP_MS });
});

afterEach(() => {
    // Closing the socket server stops the sweep.
    handler("close")();
    jest.useRealTimers();
});

describe("the identity sweep", () => {
    it("asks once per credential and impersonation target, at most four at a time", async () => {
        const sockets = [
            ...await Promise.all(Array.from({ length: 10 }, () => signedIn("t1"))),
            ...await Promise.all(Array.from({ length: 2 }, () => signedIn("t2"))),
            ...await Promise.all(Array.from({ length: 6 }, (_, i) => signedIn(`s${i}`))),
            ...await Promise.all(Array.from({ length: 3 }, () => signedIn("admin", "u9"))),
            await signedIn("admin")
        ];
        asked = [];
        resolved = [];
        rescoped = [];
        maxInFlight = 0;
        for (const token of accounts.keys()) held.add(token);

        jest.advanceTimersByTime(SWEEP_MS);
        await settle();
        // Ten different questions are due; four are being asked.
        expect(inFlight).toBe(4);
        await releaseAll();

        const count = (token: string) => asked.filter(t => t === token).length;
        expect(count("t1")).toBe(1);
        expect(count("t2")).toBe(1);
        for (let i = 0; i < 6; i++) expect(count(`s${i}`)).toBe(1);
        // The administrator's own sessions and their impersonating ones are
        // different questions.
        expect(count("admin")).toBe(2);
        expect(resolved.filter(uid => uid === "u9")).toHaveLength(1);
        expect(asked).toHaveLength(10);
        expect(maxInFlight).toBe(4);
        // The same identity for every socket, so nothing to rescope or end.
        expect(rescoped).toEqual([]);
        for (const socket of sockets) expect(socket.ws.close).not.toHaveBeenCalled();
    });

    it("keeps no answer from one sweep to the next: a credential revoked between them ends at the second", async () => {
        const sockets = await Promise.all(Array.from({ length: 3 }, () => signedIn("t1")));
        await sweep();
        for (const socket of sockets) expect(socket.ws.close).not.toHaveBeenCalled();

        accounts.delete("t1");
        asked = [];
        await sweep();

        expect(asked).toEqual(["t1"]);
        for (const socket of sockets) {
            expect(socket.frames().at(-1)?.payload?.error?.code).toBe("SESSION_ENDED");
            expect(socket.ws.close).toHaveBeenCalledWith(4001, expect.any(String));
        }
    });

    it("asks about the credential a socket holds now, not the one it was grouped by", async () => {
        const first = await signedIn("t1");
        const second = await signedIn("t1");
        rescoped = [];
        held.add("t1");

        // The sweep asks about t1 for both sockets, and waits on the answer.
        jest.advanceTimersByTime(SWEEP_MS);
        await settle();
        expect(asked.filter(t => t === "t1")).toHaveLength(3);

        // Meanwhile the second socket signs in as somebody else.
        await second.send({ type: "AUTHENTICATE", requestId: "again", payload: { token: "x" } });
        expect(second.frames().at(-1)?.type).toBe("AUTH_SUCCESS");
        expect(rescoped).toEqual([[second.id(), "ux"]]);

        await releaseAll();

        // Its next check asked about `x`, and it is still `ux` — never handed
        // the answer about `t1` the sweep had in hand.
        expect(asked.filter(t => t === "x")).toHaveLength(2);
        expect(rescoped).toEqual([[second.id(), "ux"]]);
        expect(first.ws.close).not.toHaveBeenCalled();
        expect(second.ws.close).not.toHaveBeenCalled();
    });
});

// Calls 2026-10-12 (S10, D-RT-6): every data frame re-reads the socket's
// identity before it runs. A client re-subscribing after a deploy sends its
// subscriptions at once, and each asked the auth store the same question
// concurrently — ten subscriptions, ten lookups. Frames that arrive while one
// check of the same credential is in flight now share it. Nothing outlives
// the flight: the next frame after it asks again.
describe("the per-frame identity check", () => {
    const subscribe = (i: number) => ({ type: "subscribe_collection", requestId: `s${i}`, payload: { path: "posts", subscriptionId: `sub-${i}` } });

    it("asks once for frames that arrive while a check is in flight", async () => {
        const socket = await signedIn("t1");
        asked = [];
        held.add("t1");

        const frames = Array.from({ length: 10 }, (_, i) => socket.send(subscribe(i)));
        await settle();
        expect(asked).toEqual(["t1"]);

        held.delete("t1");
        await releaseAll();
        await Promise.all(frames);
        expect(asked).toEqual(["t1"]);
        expect(socket.ws.close).not.toHaveBeenCalled();
    });

    it("keeps no answer past its flight: the next frame asks again", async () => {
        const socket = await signedIn("t1");
        asked = [];
        await socket.send(subscribe(1));
        await socket.send(subscribe(2));
        expect(asked).toEqual(["t1", "t1"]);
    });

    it("refuses every frame that waited on a check that found the credential revoked", async () => {
        const socket = await signedIn("t1");
        asked = [];
        held.add("t1");
        const frames = Array.from({ length: 3 }, (_, i) => socket.send(subscribe(i)));
        await settle();
        accounts.delete("t1");
        await releaseAll();
        await Promise.all(frames);

        expect(asked).toEqual(["t1"]);
        expect(socket.ws.close).toHaveBeenCalledWith(4001, expect.any(String));
        expect(socket.frames().some(f => f.payload?.error?.code === "SESSION_ENDED")).toBe(true);
    });

    it("shares a check only within one socket, never across sockets", async () => {
        const first = await signedIn("t1");
        const second = await signedIn("t1");
        asked = [];
        held.add("t1");
        const frames = [first.send(subscribe(1)), first.send(subscribe(2)), second.send(subscribe(3))];
        await settle();
        held.delete("t1");
        await releaseAll();
        await Promise.all(frames);
        expect(asked).toEqual(["t1", "t1"]);
    });
});
