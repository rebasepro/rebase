import { describe, it, expect, afterEach } from "@jest/globals";
import http from "http";
import WebSocket from "ws";
import type { AuthAdapter } from "@rebasepro/types";
import { RUNTIME_DEFAULT_MAX_BODY_SIZE } from "@rebasepro/server";
import { createDataRateLimitCheck } from "../../server/src/auth/rate-limiter";
import { MemoryRateLimitStore } from "../../server/src/auth/rate-limit-store";
import { createPostgresWebSocket } from "../src/websocket";
import type { RealtimeService } from "../src/services/realtimeService";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

/**
 * The socket carries the limits the data API has.
 *
 * It is the other door into the same rows, and it had neither of the HTTP
 * router's: no frame-size limit of its own, so `ws`'s 100 MiB default, and a
 * frame was buffered, stringified and JSON-parsed before the session was even
 * asked whether it had authenticated. And the only rate limit was a counter per
 * connection, so opening more connections bought more budget, where the same
 * `FETCH_COLLECTION` over HTTP counts in one bucket per person.
 *
 * Real sockets, not a mocked `ws`: the size limit is enforced by `ws` itself,
 * before any handler runs, and a close code is what the client sees.
 */

type Answer = { kind: "message"; frame: { type: string; payload?: { error?: { code?: string } } } } | { kind: "close"; code: number };

const servers: http.Server[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

async function start(options: {
    auth?: { requireAuth?: boolean; jwtSecret?: string };
    adapter?: AuthAdapter;
    limits?: Parameters<typeof createPostgresWebSocket>[5];
}): Promise<{ port: number; fetched: () => number }> {
    let fetched = 0;
    const driver = {
        key: "postgres",
        initialised: true,
        fetchCollection: async () => {
            fetched++;
            return [];
        },
        withAuth: async () => driver
    } as unknown as PostgresBackendDriver;
    const realtime = {
        addClient: () => undefined,
        handleClientMessage: async () => undefined,
        rescopeClient: async () => undefined
    } as unknown as RealtimeService;

    const server = http.createServer();
    servers.push(server);
    createPostgresWebSocket(server, realtime, driver, options.auth, options.adapter, options.limits);
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as { port: number };
    return { port, fetched: () => fetched };
}

async function open(port: number): Promise<WebSocket> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    sockets.push(ws);
    await new Promise<void>((resolve, reject) => {
        ws.once("open", () => resolve());
        ws.once("error", reject);
    });
    return ws;
}

/** Send one frame and wait for whatever comes back first: a frame or the close. */
function exchange(ws: WebSocket, frame: unknown): Promise<Answer> {
    return new Promise<Answer>((resolve) => {
        const onMessage = (data: WebSocket.RawData) => {
            ws.off("close", onClose);
            resolve({ kind: "message", frame: JSON.parse(data.toString()) });
        };
        const onClose = (code: number) => {
            ws.off("message", onMessage);
            resolve({ kind: "close", code });
        };
        ws.once("message", onMessage);
        ws.once("close", onClose);
        ws.send(JSON.stringify(frame));
    });
}

const fetchFrame = (requestId: string, extra: Record<string, unknown> = {}) => ({
    type: "FETCH_COLLECTION",
    requestId,
    payload: { path: "posts", ...extra }
});

const errorCode = (answer: Answer) => answer.kind === "message" ? answer.frame.payload?.error?.code : undefined;

describe("socket frame size", () => {
    it("closes a frame over the configured limit with 1009, before any handler reads it", async () => {
        const { port, fetched } = await start({ auth: { requireAuth: false }, limits: { maxPayload: 256 * 1024 } });
        const ws = await open(port);

        const answer = await exchange(ws, fetchFrame("r1", { pad: "x".repeat(300 * 1024) }));

        expect(answer).toEqual({ kind: "close", code: 1009 });
        expect(fetched()).toBe(0);
    });

    it("serves a frame under the limit", async () => {
        const { port, fetched } = await start({ auth: { requireAuth: false }, limits: { maxPayload: 256 * 1024 } });
        const ws = await open(port);

        const answer = await exchange(ws, fetchFrame("r1", { pad: "x".repeat(100 * 1024) }));

        expect(answer.kind === "message" && answer.frame.type).toBe("FETCH_COLLECTION_SUCCESS");
        expect(fetched()).toBe(1);
    });

    it("defaults to the data API's body limit, not ws's 100 MiB", async () => {
        const { port, fetched } = await start({ auth: { requireAuth: false } });
        const ws = await open(port);

        const answer = await exchange(ws, fetchFrame("r1", { pad: "x".repeat(RUNTIME_DEFAULT_MAX_BODY_SIZE + 1024) }));

        expect(answer).toEqual({ kind: "close", code: 1009 });
        expect(fetched()).toBe(0);
    }, 30_000);

    it("takes nothing larger than a token from a socket that has not authenticated", async () => {
        const { port } = await start({ auth: { requireAuth: true, jwtSecret: "s".repeat(32) } });
        const ws = await open(port);

        // Far under the body limit, far over any AUTHENTICATE frame.
        const answer = await exchange(ws, fetchFrame("r1", { pad: "x".repeat(200 * 1024) }));

        expect(answer).toEqual({ kind: "close", code: 1009 });
    });

    it("still answers a small unauthenticated frame with UNAUTHORIZED", async () => {
        const { port } = await start({ auth: { requireAuth: true, jwtSecret: "s".repeat(32) } });
        const ws = await open(port);

        expect(errorCode(await exchange(ws, fetchFrame("r1")))).toBe("UNAUTHORIZED");
    });
});

describe("socket rate limits", () => {
    const adapter = {
        verifyToken: async (token: string) => ({ uid: token, roles: ["user"], isAdmin: false }),
        verifyRequest: async () => null
    } as unknown as AuthAdapter;

    const signIn = async (port: number, uid: string) => {
        const ws = await open(port);
        const answer = await exchange(ws, { type: "AUTHENTICATE", requestId: "auth", payload: { token: uid } });
        expect(answer.kind === "message" && answer.frame.type).toBe("AUTH_SUCCESS");
        return ws;
    };

    it("counts a person's data frames in one bucket across their sockets", async () => {
        const { port, fetched } = await start({
            adapter,
            limits: { dataRateLimit: createDataRateLimitCheck({ user: 3, store: new MemoryRateLimitStore(60_000) }) }
        });
        const first = await signIn(port, "u1");
        const second = await signIn(port, "u1");

        expect(errorCode(await exchange(first, fetchFrame("a")))).toBeUndefined();
        expect(errorCode(await exchange(second, fetchFrame("b")))).toBeUndefined();
        expect(errorCode(await exchange(first, fetchFrame("c")))).toBeUndefined();
        // The fourth, on a socket that has sent only one frame of its own.
        expect(errorCode(await exchange(second, fetchFrame("d")))).toBe("RATE_LIMITED");
        expect(fetched()).toBe(3);

        // Somebody else's budget is their own.
        const other = await signIn(port, "u2");
        expect(errorCode(await exchange(other, fetchFrame("e")))).toBeUndefined();
    });

    it("counts an API key's data frames at the key's own rate limit, across its sockets", async () => {
        // The limit the API keys panel shows. Bucketed as the key's uid, a key
        // limited to 2 got the per-user allowance on the socket.
        const { port, fetched } = await start({
            auth: { requireAuth: true, jwtSecret: "s".repeat(32) },
            limits: {
                resolveApiKey: async (token: string) => ({
                    uid: "api-key:k1",
                    roles: ["service"],
                    scopes: ["data:read"],
                    apiKey: { id: token === "rk_live_k1" ? "k1" : "k2", rate_limit: 2 }
                }),
                dataRateLimit: createDataRateLimitCheck({ user: 100, apiKey: 100, store: new MemoryRateLimitStore(60_000) })
            }
        });
        const signInWithKey = async (key: string) => {
            const ws = await open(port);
            const answer = await exchange(ws, { type: "AUTHENTICATE", requestId: "auth", payload: { token: key } });
            expect(answer.kind === "message" && answer.frame.type).toBe("AUTH_SUCCESS");
            return ws;
        };
        const first = await signInWithKey("rk_live_k1");
        const second = await signInWithKey("rk_live_k1");

        expect(errorCode(await exchange(first, fetchFrame("a")))).toBeUndefined();
        expect(errorCode(await exchange(second, fetchFrame("b")))).toBeUndefined();
        expect(errorCode(await exchange(first, fetchFrame("c")))).toBe("RATE_LIMITED");
        expect(fetched()).toBe(2);

        // Another key's allowance is its own.
        const other = await signInWithKey("rk_live_k2");
        expect(errorCode(await exchange(other, fetchFrame("d")))).toBeUndefined();
    });

    it("counts frames from a socket that has not authenticated against the connection's budget", async () => {
        const { port } = await start({ auth: { requireAuth: true, jwtSecret: "s".repeat(32) } });
        const ws = await open(port);

        const codes: Array<string | undefined> = [];
        ws.on("message", (data) => codes.push(JSON.parse(data.toString())?.payload?.error?.code));
        for (let i = 0; i < 2001; i++) ws.send(JSON.stringify(fetchFrame(`r${i}`)));
        await new Promise<void>((resolve) => {
            const poll = setInterval(() => {
                if (codes.length >= 2001) {
                    clearInterval(poll);
                    resolve();
                }
            }, 10);
        });

        expect(codes.filter(code => code === "UNAUTHORIZED")).toHaveLength(2000);
        expect(codes.filter(code => code === "RATE_LIMITED")).toHaveLength(1);
    }, 30_000);
});
