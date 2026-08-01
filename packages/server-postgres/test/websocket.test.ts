import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { Server } from "http";

let mockWssInstance: any = null;

jest.mock("ws", () => {
    return {
        WebSocketServer: jest.fn().mockImplementation(() => {
            const instance = {
                on: jest.fn()
            };
            mockWssInstance = instance;
            return instance;
        }),
        WebSocket: jest.fn()
    };
});

/**
 * `extractUserFromToken` is the ONLY thing standing between an anonymous socket
 * and `EXECUTE_SQL` (arbitrary SQL against the admin connection), so it is a
 * per-test knob rather than a fixed "always admin" stub — a stub that always
 * returns an admin can only ever exercise the happy path.
 */
const mockExtractUserFromToken = jest.fn<(token: string) => unknown>();

jest.mock("@rebasepro/server", () => {
    return {
        extractUserFromToken: (token: string) => mockExtractUserFromToken(token),
        safeCompare: (a: string, b: string) => a === b,
        logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() }
    };
});

import { createPostgresWebSocket } from "../src/websocket";
import { RealtimeService } from "../src/services/realtimeService";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";

/**
 * Every message type the server gates behind `isAdminSession`. Kept in sync
 * with `ADMIN_ONLY_TYPES` in src/websocket.ts — the whole set is swept below so
 * that adding a privileged verb without a role check fails a test rather than
 * shipping.
 */
const ADMIN_ONLY_TYPES = [
    "EXECUTE_SQL",
    "FETCH_DATABASES",
    "FETCH_ROLES",
    "FETCH_UNMAPPED_TABLES",
    "FETCH_TABLE_METADATA",
    "FETCH_CURRENT_DATABASE",
    "CREATE_BRANCH",
    "DELETE_BRANCH",
    "LIST_BRANCHES"
];

describe("WebSocket Server authorization", () => {
    let mockServer: Server;
    let mockRealtimeService: RealtimeService;
    let mockDriver: PostgresBackendDriver;

    /** Connect one client and hand back its `message` handler. */
    const connect = () => {
        const connectionCallback = mockWssInstance.on.mock.calls.find(
            (call: any[]) => call[0] === "connection"
        )[1];

        const mockWs = {
            on: jest.fn(),
            send: jest.fn()
        } as unknown as any;

        connectionCallback(mockWs);

        const messageCallback = mockWs.on.mock.calls.find(
            (call: any[]) => call[0] === "message"
        )[1];

        return { mockWs, messageCallback };
    };

    const send = (messageCallback: any, message: unknown) =>
        messageCallback(Buffer.from(JSON.stringify(message)));

    /** Last frame the server wrote to the socket, parsed. */
    const lastSent = (mockWs: any) =>
        JSON.parse(mockWs.send.mock.calls[mockWs.send.mock.calls.length - 1][0]);

    beforeEach(() => {
        jest.clearAllMocks();
        mockWssInstance = null;
        mockExtractUserFromToken.mockReturnValue({ uid: "admin-user", roles: ["admin"] });

        mockServer = {} as Server;
        mockRealtimeService = {
            addClient: jest.fn(),
            registerDataDriverSubscription: jest.fn()
        } as unknown as RealtimeService;

        // Mock PostgresBackendDriver admin capabilities
        mockDriver = {
            key: "postgres",
            initialised: true,
            admin: {
                executeSql: jest.fn(),
                fetchAvailableDatabases: jest.fn(),
                fetchAvailableRoles: jest.fn(),
                fetchApplicationRoles: jest.fn(),
                fetchCurrentDatabase: jest.fn(),
                fetchUnmappedTables: jest.fn(),
                fetchTableMetadata: jest.fn(),
                createBranch: jest.fn(),
                deleteBranch: jest.fn(),
                listBranches: jest.fn()
            }
        } as unknown as PostgresBackendDriver;

        // The jwtSecret is here so the cases below exercise the auth gate rather
        // than the admin gate. `requireAuth` is now honoured on its own as well;
        // that resolution is pinned in its own block at the end of this file.
        createPostgresWebSocket(mockServer, mockRealtimeService, mockDriver, {
            requireAuth: true,
            jwtSecret: "test-jwt-secret"
        });
    });

    describe("unauthenticated clients", () => {
        it("refuses EXECUTE_SQL from a socket that never authenticated", async () => {
            const { mockWs, messageCallback } = connect();

            await send(messageCallback, {
                type: "EXECUTE_SQL",
                requestId: "req-anon",
                payload: { sql: "SELECT 1" }
            });

            expect(mockDriver.admin.executeSql).not.toHaveBeenCalled();
            expect(lastSent(mockWs)).toEqual({
                type: "ERROR",
                requestId: "req-anon",
                payload: { error: { message: "Authentication required", code: "UNAUTHORIZED" } }
            });
        });

        it("refuses AUTHENTICATE with no token", async () => {
            const { mockWs, messageCallback } = connect();

            await send(messageCallback, {
                type: "AUTHENTICATE",
                requestId: "auth-empty",
                payload: {}
            });

            expect(lastSent(mockWs)).toEqual({
                type: "AUTH_ERROR",
                requestId: "auth-empty",
                payload: { error: { message: "Token is required", code: "INVALID_INPUT" } }
            });
        });

        it("refuses an invalid token and leaves the session unauthenticated", async () => {
            // A token the verifier rejects — the session must stay closed, not
            // fall through to the `!requireAuth` default.
            mockExtractUserFromToken.mockReturnValue(null);
            const { mockWs, messageCallback } = connect();

            await send(messageCallback, {
                type: "AUTHENTICATE",
                requestId: "auth-bad",
                payload: { token: "forged-token" }
            });

            expect(lastSent(mockWs)).toEqual({
                type: "AUTH_ERROR",
                requestId: "auth-bad",
                payload: { error: { message: "Invalid or expired token", code: "INVALID_TOKEN" } }
            });

            await send(messageCallback, {
                type: "EXECUTE_SQL",
                requestId: "req-after-bad-auth",
                payload: { sql: "DROP TABLE orders" }
            });

            expect(mockDriver.admin.executeSql).not.toHaveBeenCalled();
            expect(lastSent(mockWs)).toEqual({
                type: "ERROR",
                requestId: "req-after-bad-auth",
                payload: { error: { message: "Authentication required", code: "UNAUTHORIZED" } }
            });
        });
    });

    describe("authenticated non-admin clients", () => {
        /** Authenticate a client whose token carries no `admin` role. */
        const connectAsEditor = async () => {
            mockExtractUserFromToken.mockReturnValue({ uid: "editor-user", roles: ["editor"] });
            const { mockWs, messageCallback } = connect();

            await send(messageCallback, {
                type: "AUTHENTICATE",
                requestId: "auth-editor",
                payload: { token: "valid-editor-token" }
            });

            // Guard: the rest of the test is meaningless unless the socket
            // really is signed in — otherwise a FORBIDDEN below could just be
            // the auth gate firing.
            expect(lastSent(mockWs)).toEqual({
                type: "AUTH_SUCCESS",
                requestId: "auth-editor",
                payload: { uid: "editor-user", roles: ["editor"] }
            });
            mockWs.send.mockClear();

            return { mockWs, messageCallback };
        };

        it("refuses EXECUTE_SQL from a signed-in non-admin", async () => {
            const { mockWs, messageCallback } = await connectAsEditor();

            await send(messageCallback, {
                type: "EXECUTE_SQL",
                requestId: "req-editor",
                payload: { sql: "SELECT * FROM users", options: { role: "postgres" } }
            });

            expect(mockDriver.admin.executeSql).not.toHaveBeenCalled();
            expect(lastSent(mockWs)).toEqual({
                type: "ERROR",
                requestId: "req-editor",
                payload: { error: { message: "Admin access required for this operation", code: "FORBIDDEN" } }
            });
        });

        it.each(ADMIN_ONLY_TYPES)("refuses %s from a signed-in non-admin", async (type) => {
            const { mockWs, messageCallback } = await connectAsEditor();

            await send(messageCallback, {
                type,
                requestId: `req-${type}`,
                payload: { sql: "SELECT 1", name: "branch-x", branchName: "branch-x", tableName: "users" }
            });

            // No admin capability may be reached at all — a FORBIDDEN frame sent
            // *after* the work happened would still leak data/side effects.
            for (const fn of Object.values(mockDriver.admin as unknown as Record<string, jest.Mock>)) {
                expect(fn).not.toHaveBeenCalled();
            }
            expect(lastSent(mockWs)).toEqual({
                type: "ERROR",
                requestId: `req-${type}`,
                payload: { error: { message: "Admin access required for this operation", code: "FORBIDDEN" } }
            });
        });

        it("grants EXECUTE_SQL once the token actually carries the admin role", async () => {
            // Mirror image of the test above: same message, same client, the
            // only difference is the role in the token. Without this the
            // FORBIDDEN assertions could be satisfied by a server that refuses
            // everyone.
            mockExtractUserFromToken.mockReturnValue({ uid: "admin-user", roles: ["admin"] });
            (mockDriver.admin.executeSql as jest.Mock).mockResolvedValue({ rows: [] } as never);
            const { messageCallback } = connect();

            await send(messageCallback, {
                type: "AUTHENTICATE",
                requestId: "auth-admin",
                payload: { token: "valid-admin-token" }
            });
            await send(messageCallback, {
                type: "EXECUTE_SQL",
                requestId: "req-admin",
                payload: { sql: "SELECT * FROM users", options: { role: "postgres" } }
            });

            expect(mockDriver.admin.executeSql).toHaveBeenCalledWith("SELECT * FROM users", { role: "postgres" });
        });
    });
});

describe("WebSocket Server SQL error handling", () => {
    let mockServer: Server;
    let mockRealtimeService: RealtimeService;
    let mockDriver: PostgresBackendDriver;

    beforeEach(() => {
        jest.clearAllMocks();
        mockWssInstance = null;
        mockExtractUserFromToken.mockReturnValue({ uid: "admin-user", roles: ["admin"] });

        mockServer = {} as Server;
        mockRealtimeService = {
            addClient: jest.fn(),
            registerDataDriverSubscription: jest.fn()
        } as unknown as RealtimeService;

        // Mock PostgresBackendDriver admin capabilities
        mockDriver = {
            key: "postgres",
            initialised: true,
            admin: {
                executeSql: jest.fn()
            }
        } as unknown as PostgresBackendDriver;

        // See the note in the authorization suite: the jwtSecret is what makes
        // `requireAuth` take effect.
        createPostgresWebSocket(mockServer, mockRealtimeService, mockDriver, {
            requireAuth: true,
            jwtSecret: "test-jwt-secret"
        });
    });

    it("should handle EXECUTE_SQL errors cleanly and return ERROR message without throwing", async () => {
        expect(mockWssInstance).toBeDefined();
        expect(mockWssInstance.on).toHaveBeenCalledWith("connection", expect.any(Function));

        const connectionCallback = mockWssInstance.on.mock.calls.find(
            (call: any[]) => call[0] === "connection"
        )[1];

        // Simulate client connection
        const mockWs = {
            on: jest.fn(),
            send: jest.fn()
        } as unknown as any;

        connectionCallback(mockWs);

        // Retrieve the message callback
        expect(mockWs.on).toHaveBeenCalledWith("message", expect.any(Function));
        const messageCallback = mockWs.on.mock.calls.find(
            (call: any[]) => call[0] === "message"
        )[1];

        // 1. Authenticate first as an admin
        await messageCallback(
            Buffer.from(
                JSON.stringify({
                    type: "AUTHENTICATE",
                    requestId: "auth-req",
                    payload: {
                        token: "mock-admin-token"
                    }
                })
            )
        );

        expect(mockWs.send).toHaveBeenCalled();
        const authResponse = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(authResponse.type).toBe("AUTH_SUCCESS");

        // Clear mock send calls before executing SQL
        mockWs.send.mockClear();

        // Mock executeSql to throw a permission denied error
        (mockDriver.admin.executeSql as jest.Mock).mockRejectedValueOnce(
            new Error("permission denied for table orders") as never
        );

        // 2. Simulate receiving EXECUTE_SQL message
        await messageCallback(
            Buffer.from(
                JSON.stringify({
                    type: "EXECUTE_SQL",
                    requestId: "req-1",
                    payload: {
                        sql: "SELECT * FROM orders",
                        options: { role: "demo" }
                    }
                })
            )
        );

        // Verify executeSql was called
        expect(mockDriver.admin.executeSql).toHaveBeenCalledWith("SELECT * FROM orders", { role: "demo" });

        // Verify the client received a clean ERROR payload rather than crashing the socket
        expect(mockWs.send).toHaveBeenCalled();
        const sentMessage = JSON.parse(mockWs.send.mock.calls[0][0]);
        expect(sentMessage).toEqual({
            type: "ERROR",
            requestId: "req-1",
            payload: {
                error: {
                    message: "permission denied for table orders",
                    code: "SQL_ERROR"
                }
            }
        });
    });
});

/**
 * How `requireAuth` is resolved from the config and the auth adapter.
 *
 * This is a security decision with an inverted failure mode. `requireAuth` does
 * not merely gate a check: the connection handler seeds each session with
 * `authenticated: !requireAuth`, so computing `false` marks every client that
 * connects as already authenticated. A misresolution therefore does not close
 * the socket, it opens it — and nothing in the protocol says so.
 *
 * It used to be `authConfig.requireAuth !== false && !!authConfig.jwtSecret`,
 * which had two ways to reach that state: an explicit `requireAuth: true` was
 * ANDed away when no local secret existed, and the AuthAdapter — the argument
 * that is supposed to make the socket secure by default — was dropped in transit
 * by `DatabaseAdapter.initializeWebsockets`, whose signature declared only four
 * parameters while the caller passed five.
 *
 * Each case below asserts the observable consequence (does an anonymous client
 * get through?) rather than the flag, because the flag is not what ships.
 */
describe("WebSocket Server requireAuth resolution", () => {
    let mockServer: Server;
    let mockRealtimeService: RealtimeService;
    let mockDriver: PostgresBackendDriver;

    const connectAndProbe = () => {
        const connectionCallback = mockWssInstance.on.mock.calls.find(
            (call: any[]) => call[0] === "connection"
        )[1];
        const mockWs = { on: jest.fn(), send: jest.fn() } as any;
        connectionCallback(mockWs);
        const messageCallback = mockWs.on.mock.calls.find(
            (call: any[]) => call[0] === "message"
        )[1];
        return { mockWs, messageCallback };
    };

    /**
     * Send a plain data message without authenticating first and report whether
     * the server refused it. `FETCH_COLLECTION` is deliberately *not* an
     * admin-only type: the admin gate is a separate check, and using a privileged
     * verb here would let the admin gate pass a test the auth gate is failing.
     */
    const anonymousIsRefused = async () => {
        const { mockWs, messageCallback } = connectAndProbe();
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
        mockRealtimeService = {
            addClient: jest.fn(),
            registerDataDriverSubscription: jest.fn()
        } as unknown as RealtimeService;
        mockDriver = {
            key: "postgres",
            initialised: true,
            // No `withAuth`, so an admitted client falls through to the raw
            // driver — which makes "was it admitted?" unambiguous.
            fetchCollection: jest.fn(async () => []),
            admin: { executeSql: jest.fn() }
        } as unknown as PostgresBackendDriver;
    });

    it("honours `requireAuth: true` with no jwtSecret — asking for auth must not grant it", async () => {
        createPostgresWebSocket(mockServer, mockRealtimeService, mockDriver, { requireAuth: true });

        expect(await anonymousIsRefused()).toBe(true);
        expect(mockDriver.fetchCollection).not.toHaveBeenCalled();
    });

    it("requires auth when an AuthAdapter is present, with no jwtSecret in config", async () => {
        createPostgresWebSocket(
            mockServer,
            mockRealtimeService,
            mockDriver,
            {},
            { name: "test-adapter" } as never
        );

        expect(await anonymousIsRefused()).toBe(true);
        expect(mockDriver.fetchCollection).not.toHaveBeenCalled();
    });

    it("requires auth when a jwtSecret is configured and requireAuth is unset", async () => {
        createPostgresWebSocket(mockServer, mockRealtimeService, mockDriver, { jwtSecret: "s" });

        expect(await anonymousIsRefused()).toBe(true);
    });

    /**
     * The mirror image. Without it, "refuses everyone unconditionally" would
     * satisfy every assertion above — a socket that is always closed is not the
     * fix, it is a different bug.
     */
    it("admits an anonymous client only when auth is switched off explicitly", async () => {
        createPostgresWebSocket(mockServer, mockRealtimeService, mockDriver, {
            requireAuth: false,
            jwtSecret: "s"
        });

        expect(await anonymousIsRefused()).toBe(false);
        expect(mockDriver.fetchCollection).toHaveBeenCalled();
    });

    it("admits an anonymous client when nothing about auth is configured at all", async () => {
        createPostgresWebSocket(mockServer, mockRealtimeService, mockDriver, {});

        expect(await anonymousIsRefused()).toBe(false);
    });
});
