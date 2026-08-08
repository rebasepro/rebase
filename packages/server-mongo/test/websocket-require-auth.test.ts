import { Server } from "http";

/**
 * How the Mongo realtime socket decides whether to require authentication.
 *
 * The flag has an inverted failure mode: the connection handler seeds each
 * session with `authenticated: !requireAuth`, so resolving `false` does not skip
 * a check, it marks every client that connects as already authenticated. That
 * makes the resolution itself worth pinning, separately from the gate it feeds.
 *
 * It was `authConfig?.requireAuth !== false && authConfig?.jwtSecret`, which
 * ANDs the one setting whose purpose is to demand authentication together with
 * the presence of a local secret — so `requireAuth: true` with auth configured
 * anywhere else evaluated to false and opened the socket to everyone. The
 * sibling Postgres socket carried the same defect and is fixed alongside this.
 *
 * Mongo has no row-level security to fall back on, and its `getScopedDelegate`
 * hands back the raw driver when a session carries no user, so an admitted
 * anonymous client reads through an unscoped driver. There is nothing behind
 * this gate.
 */

let mockWssInstance: any = null;

jest.mock("ws", () => ({
    WebSocketServer: jest.fn().mockImplementation(() => {
        const instance = { on: jest.fn() };
        mockWssInstance = instance;
        return instance;
    }),
    WebSocket: jest.fn()
}));

jest.mock("@rebasepro/server", () => ({
    extractUserFromToken: jest.fn(),
    logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
    // The real predicate, not a stub — this file exists to pin that the socket
    // answers exactly what the HTTP routes answer.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    resolveRequireAuth: require("../../server/src/auth/require-auth").resolveRequireAuth
}));

import { extractUserFromToken } from "@rebasepro/server";
import { createMongoWebSocket } from "../src/websocket";
import type { MongoRealtimeService } from "../src/services/MongoRealtimeService";
import type { MongoDriver } from "../src/services/MongoDriver";

describe("Mongo WebSocket requireAuth resolution", () => {
    let mockServer: Server;
    let realtimeService: MongoRealtimeService;
    let driver: MongoDriver;

    /**
     * Connect one client, send a plain data message without authenticating, and
     * report whether the server refused it.
     *
     * `FETCH_COLLECTION` deliberately is not one of the admin-only types: the
     * admin gate is a separate check further down, and a privileged verb would
     * let it refuse the message on its own and pass a test the auth gate is
     * failing.
     */
    const anonymousIsRefused = async () => {
        const connectionCallback = mockWssInstance.on.mock.calls.find(
            (call: any[]) => call[0] === "connection"
        )[1];
        const mockWs = { on: jest.fn(), send: jest.fn() } as any;
        connectionCallback(mockWs);
        const messageCallback = mockWs.on.mock.calls.find(
            (call: any[]) => call[0] === "message"
        )[1];

        await messageCallback(Buffer.from(JSON.stringify({
            type: "FETCH_COLLECTION",
            requestId: "req-probe",
            payload: { path: "posts" }
        })));

        const frames = mockWs.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
        return frames.some((f: any) => f.payload?.error?.code === "UNAUTHORIZED");
    };

    beforeEach(() => {
        jest.clearAllMocks();
        mockWssInstance = null;
        mockServer = {} as Server;
        realtimeService = {
            addClient: jest.fn(),
            registerDataDriverSubscription: jest.fn()
        } as unknown as MongoRealtimeService;
        driver = {
            fetchCollection: jest.fn(async () => [])
        } as unknown as MongoDriver;
    });

    it("honours `requireAuth: true` with no jwtSecret — asking for auth must not grant it", async () => {
        createMongoWebSocket(mockServer, realtimeService, driver, { requireAuth: true } as never);

        expect(await anonymousIsRefused()).toBe(true);
        expect(driver.fetchCollection).not.toHaveBeenCalled();
    });

    it("requires auth when a jwtSecret is configured and requireAuth is unset", async () => {
        createMongoWebSocket(mockServer, realtimeService, driver, { jwtSecret: "s" } as never);

        expect(await anonymousIsRefused()).toBe(true);
    });

    /**
     * The mirror image. Without it, "refuses everyone unconditionally" satisfies
     * both assertions above — a socket that is always closed is not the fix.
     */
    it("admits an anonymous client only when auth is switched off explicitly", async () => {
        createMongoWebSocket(
            mockServer, realtimeService, driver,
            { requireAuth: false, jwtSecret: "s" } as never
        );

        expect(await anonymousIsRefused()).toBe(false);
        expect(driver.fetchCollection).toHaveBeenCalled();
    });

    /**
     * `resolveRequireAuth(undefined)` is `true`: the HTTP data routes answer 401
     * to every read when no auth is configured. This socket's own copy returned
     * `false` for the same input, so what REST refused, realtime served.
     */
    it("requires auth when nothing about auth is configured — matching the HTTP routes", async () => {
        createMongoWebSocket(mockServer, realtimeService, driver, {} as never);

        expect(await anonymousIsRefused()).toBe(true);
        expect(driver.fetchCollection).not.toHaveBeenCalled();
    });

    /**
     * Sessions used to live in a module-level Map shared by every socket this
     * factory built. Two servers in one process — a hot reload, or a test file
     * like this one — then read each other's sessions, so an authenticated
     * client on one could satisfy the gate on the other. Each server must start
     * with an empty map of its own.
     */
    it("does not share sessions between two servers in one process", async () => {
        createMongoWebSocket(mockServer, realtimeService, driver, { requireAuth: true } as never);
        const firstWss = mockWssInstance;

        createMongoWebSocket(mockServer, realtimeService, driver, { requireAuth: true } as never);

        expect(mockWssInstance).not.toBe(firstWss);
        expect(await anonymousIsRefused()).toBe(true);
    });

    /**
     * `BackendBootstrapper.initializeWebsockets` declares five parameters and
     * `init.ts` passes five; `MongoBootstrapper` accepted four, so the adapter
     * was dropped between two individually consistent signatures. The socket
     * then verified with the built-in JWT path only, and on a backend using an
     * AuthAdapter — Clerk, Auth0, the documented way to unify identity — every
     * realtime AUTHENTICATE answered "Invalid or expired token".
     */
    describe("with an AuthAdapter", () => {
        const authenticateWith = async (token: string) => {
            const connectionCallback = mockWssInstance.on.mock.calls.find(
                (call: any[]) => call[0] === "connection"
            )[1];
            const mockWs = { on: jest.fn(), send: jest.fn() } as any;
            connectionCallback(mockWs);
            const messageCallback = mockWs.on.mock.calls.find(
                (call: any[]) => call[0] === "message"
            )[1];

            await messageCallback(Buffer.from(JSON.stringify({
                type: "AUTHENTICATE",
                requestId: "req-auth",
                payload: { token }
            })));

            return mockWs.send.mock.calls.map((c: any[]) => JSON.parse(c[0]));
        };

        const adapter = {
            verifyRequest: jest.fn(),
            verifyToken: jest.fn(async (token: string) =>
                token === "adapter-token" ? { uid: "u-clerk",
roles: ["editor"],
isAdmin: false } : null)
        } as any;

        it("verifies the token with the adapter", async () => {
            createMongoWebSocket(mockServer, realtimeService, driver, undefined, undefined, adapter);

            const frames = await authenticateWith("adapter-token");
            expect(frames.some((f: any) => f.type === "AUTH_SUCCESS" && f.payload.uid === "u-clerk")).toBe(true);
            // The built-in JWT path must not be consulted when an adapter is present.
            expect(extractUserFromToken).not.toHaveBeenCalled();
        });

        it("still refuses a token the adapter rejects", async () => {
            createMongoWebSocket(mockServer, realtimeService, driver, undefined, undefined, adapter);

            const frames = await authenticateWith("not-a-token");
            expect(frames.some((f: any) => f.payload?.error?.code === "INVALID_TOKEN")).toBe(true);
        });

        it("requires auth because an adapter is configured, with no jwtSecret anywhere", async () => {
            createMongoWebSocket(mockServer, realtimeService, driver, undefined, undefined, adapter);

            expect(await anonymousIsRefused()).toBe(true);
        });
    });
});
