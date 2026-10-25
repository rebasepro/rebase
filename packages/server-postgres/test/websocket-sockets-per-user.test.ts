import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { Server } from "http";
import type { AuthAdapter, RealtimeSocketOptions } from "@rebasepro/types";

let mockWssInstance: { on: jest.Mock; clients: Set<unknown> } | null = null;

jest.mock("ws", () => ({
    WebSocketServer: jest.fn().mockImplementation(() => {
        mockWssInstance = { on: jest.fn(), clients: new Set() };
        return mockWssInstance;
    }),
    WebSocket: jest.fn()
}));

import { createPostgresWebSocket, TOO_MANY_SOCKETS_CLOSE_CODE } from "../src/websocket";
import { parseMaxSocketsPerUser, type RealtimeService } from "../src/services/realtimeService";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

/**
 * `REALTIME_MAX_SOCKETS_PER_USER`: an opt-in ceiling on the sockets one
 * identity holds on a server.
 *
 * The per-socket subscription ceiling bounds what one socket costs, but not how
 * many sockets one account opens: a script in a loop, or a page that leaks a
 * client per render, held a socket each — every one a refetch per write to
 * whatever it subscribed to. With the ceiling set, the next `AUTHENTICATE` past
 * it is refused with `TOO_MANY_SOCKETS` (an `ERROR`, not an `AUTH_ERROR`: the
 * credential is fine, and an auth error sends the SDK to refresh the session)
 * and the socket is closed with 4002. Unset, nothing changes.
 */

const accounts = new Map([
    ["ada", { uid: "ada", roles: ["user"] }],
    ["bob", { uid: "bob", roles: ["user"] }],
    ["root", { uid: "root", roles: ["admin"] }]
]);
const adapter = {
    verifyToken: async (token: string) => {
        const account = accounts.get(token);
        return account ? { ...account, isAdmin: account.roles.includes("admin") } : null;
    },
    verifyRequest: async () => null,
    resolveUser: async (uid: string) => {
        const account = accounts.get(uid);
        return account ? { ...account, isAnonymous: false } : null;
    }
} as unknown as AuthAdapter;

function handler(event: string): (...args: unknown[]) => unknown {
    return mockWssInstance!.on.mock.calls.find((call) => call[0] === event)![1] as (...args: unknown[]) => unknown;
}

function start(options?: RealtimeSocketOptions) {
    const driver = { key: "postgres", initialised: true } as unknown as PostgresBackendDriver;
    const realtime = {
        addClient: jest.fn(),
        handleClientMessage: jest.fn(async () => undefined),
        rescopeClient: jest.fn(async () => undefined)
    } as unknown as RealtimeService;
    createPostgresWebSocket({} as Server, realtime, driver, { requireAuth: true }, adapter, options);
}

function connect() {
    const ws = { on: jest.fn(), send: jest.fn(), close: jest.fn() };
    handler("connection")(ws);
    const on = (event: string) => ws.on.mock.calls.find((call) => call[0] === event)![1] as (data?: Buffer) => Promise<void>;
    return {
        ws,
        authenticate: (token: string, impersonate?: string) => on("message")(Buffer.from(JSON.stringify({
            type: "AUTHENTICATE",
            requestId: "auth",
            payload: { token, ...(impersonate ? { impersonate } : {}) }
        }))),
        close: () => on("close")(),
        last: () => JSON.parse(ws.send.mock.calls.at(-1)![0] as string) as { type: string; requestId?: string; payload?: { error?: { code?: string } } }
    };
}

describe("the per-user socket ceiling", () => {
    beforeEach(() => {
        mockWssInstance = null;
    });

    it("refuses the socket past the ceiling, and closes it", async () => {
        start({ maxSocketsPerUser: 2 });
        const sockets = [connect(), connect(), connect()];
        for (const socket of sockets) await socket.authenticate("ada");

        expect(sockets[0].last().type).toBe("AUTH_SUCCESS");
        expect(sockets[1].last().type).toBe("AUTH_SUCCESS");
        expect(sockets[2].last()).toMatchObject({ type: "ERROR", requestId: "auth", payload: { error: { code: "TOO_MANY_SOCKETS" } } });
        expect(sockets[2].ws.close).toHaveBeenCalledWith(TOO_MANY_SOCKETS_CLOSE_CODE, expect.any(String));
    });

    it("counts per identity, not per server", async () => {
        start({ maxSocketsPerUser: 1 });
        const ada = connect();
        const bob = connect();
        await ada.authenticate("ada");
        await bob.authenticate("bob");
        expect(ada.last().type).toBe("AUTH_SUCCESS");
        expect(bob.last().type).toBe("AUTH_SUCCESS");
    });

    it("a socket refreshing its own session does not count against itself", async () => {
        start({ maxSocketsPerUser: 1 });
        const socket = connect();
        await socket.authenticate("ada");
        await socket.authenticate("ada");
        expect(socket.last().type).toBe("AUTH_SUCCESS");
    });

    it("a closed socket frees its place", async () => {
        start({ maxSocketsPerUser: 1 });
        const first = connect();
        await first.authenticate("ada");
        await first.close();
        const second = connect();
        await second.authenticate("ada");
        expect(second.last().type).toBe("AUTH_SUCCESS");
    });

    it("counts each API key's sockets on their own, not against the key's owner", async () => {
        // Workers holding sockets under keys made by one account shared that
        // account's ceiling, and locked it (and each other) out.
        start({
            maxSocketsPerUser: 1,
            resolveApiKey: async (token) => ({ uid: "ada", roles: ["user"], scopes: ["data:read"], apiKey: { id: token.slice(3), rate_limit: null } })
        });
        const session = connect();
        const keyA = connect();
        const keyB = connect();
        const keyAAgain = connect();
        await session.authenticate("ada");
        await keyA.authenticate("rk_a");
        await keyB.authenticate("rk_b");
        await keyAAgain.authenticate("rk_a");

        expect(session.last().type).toBe("AUTH_SUCCESS");
        expect(keyA.last().type).toBe("AUTH_SUCCESS");
        expect(keyB.last().type).toBe("AUTH_SUCCESS");
        expect(keyAAgain.last()).toMatchObject({ type: "ERROR", payload: { error: { code: "TOO_MANY_SOCKETS" } } });
    });

    it("counts an impersonating admin's sockets against the admin, not the user they act as", async () => {
        // The administrator holds the credential: their impersonating sockets
        // are their traffic, as their rate-limit bucket already says. Counted
        // against the user, an admin checking on someone used up that user's
        // place — and could open any number of sockets by spreading them
        // over users.
        start({ maxSocketsPerUser: 2 });
        const ada = connect();
        const own = connect();
        const asAda = connect();
        const asBob = connect();
        await ada.authenticate("ada");
        await own.authenticate("root");
        await asAda.authenticate("root", "ada");
        await asBob.authenticate("root", "bob");

        expect(ada.last().type).toBe("AUTH_SUCCESS");
        expect(own.last().type).toBe("AUTH_SUCCESS");
        expect(asAda.last().type).toBe("AUTH_SUCCESS");
        // The admin's third socket, whoever it acts as.
        expect(asBob.last()).toMatchObject({ type: "ERROR", payload: { error: { code: "TOO_MANY_SOCKETS" } } });

        // Ada's own place was not spent by the admin acting as her.
        const adaAgain = connect();
        await adaAgain.authenticate("ada");
        expect(adaAgain.last().type).toBe("AUTH_SUCCESS");
    });

    it("unset, there is no ceiling", async () => {
        start();
        const sockets = Array.from({ length: 30 }, () => connect());
        for (const socket of sockets) await socket.authenticate("ada");
        expect(sockets.every((socket) => socket.last().type === "AUTH_SUCCESS")).toBe(true);
    });

    it("a mistyped ceiling stops the boot instead of becoming none", () => {
        expect(parseMaxSocketsPerUser("20", "REALTIME_MAX_SOCKETS_PER_USER")).toBe(20);
        for (const bad of ["0", "-1", "2.5", "twenty", 0]) {
            expect(() => parseMaxSocketsPerUser(bad, "REALTIME_MAX_SOCKETS_PER_USER")).toThrow(/REALTIME_MAX_SOCKETS_PER_USER must be a positive whole number/);
        }
    });
});
