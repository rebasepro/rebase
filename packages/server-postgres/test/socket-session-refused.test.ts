/**
 * A session the server refuses is refused on the socket in the words the HTTP
 * routes use, and the SDK says so — once, promptly, and not as a connect.
 *
 * A Node script's `listen()` with a revoked session (R3-12):
 * - the socket answered `AUTH_ERROR INVALID_TOKEN "Invalid or expired token"`,
 *   where HTTP answers `401 SESSION_REVOKED` for the same token;
 * - the SDK logged `WebSocket connected without auth: Invalid or expired token`
 *   — which reads like a connect that went fine — then retried the same token
 *   three times with backoff, so `onError` heard nothing for over 3 s;
 * - its stdout opened with `Connected to PostgreSQL backend` and
 *   `WebSocket auto-authenticated`: `console.debug` is `console.log` in Node.
 *
 * Real sockets: the driver's socket server on a real `http.Server`, the
 * built-in auth adapter judging real tokens, the SDK's socket client dialling
 * it with Node's own WebSocket. The realtime service and the account store
 * are stand-ins.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket } from "ws";
import { configureJwt, createBuiltinAuthAdapter } from "@rebasepro/server";
import { RebaseWebSocketClient } from "@rebasepro/client";
import { generateAccessToken } from "../../server/src/auth/jwt";
import { createPostgresWebSocket } from "../src/websocket";
import type { RealtimeService } from "../src/services/realtimeService";
import type { PostgresBackendDriver } from "../src/PostgresBackendDriver";

type AccessState = { disabled: boolean; roles: string[]; tokensValidAfter: Date | null };

/** What the account store says about each user. */
const accounts = new Map<string, AccessState>();

const authRepository = {
    getAccountAccessState: async (uid: string) => accounts.get(uid) ?? null,
    getUserRoleIds: async (uid: string) => accounts.get(uid)?.roles ?? []
};

const servers: Server[] = [];
const clients: RebaseWebSocketClient[] = [];

beforeAll(() => {
    configureJwt({ secret: "socket-session-refused-test-secret-0123456789", accessExpiresIn: "1h" });
});

beforeEach(() => {
    accounts.clear();
    accounts.set("live-user", { disabled: false, roles: ["editor"], tokensValidAfter: null });
    // Signed out everywhere a minute from now: every token issued before is void.
    accounts.set("revoked-user", { disabled: false, roles: ["editor"], tokensValidAfter: new Date(Date.now() + 60_000) });
    accounts.set("disabled-user", { disabled: true, roles: ["editor"], tokensValidAfter: null });
});

afterEach(async () => {
    for (const client of clients.splice(0)) client.disconnect(true);
    for (const server of servers.splice(0)) {
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    jest.restoreAllMocks();
});

function realtimeStub(): RealtimeService {
    return {
        addClient: jest.fn(),
        removeClient: jest.fn(),
        handleClientMessage: jest.fn(async () => undefined),
        rescopeClient: jest.fn(async () => undefined)
    } as unknown as RealtimeService;
}

async function socketServer(): Promise<number> {
    const server = createServer();
    servers.push(server);
    const adapter = createBuiltinAuthAdapter({ authRepository } as never);
    createPostgresWebSocket(server, realtimeStub(), {} as unknown as PostgresBackendDriver, { requireAuth: true }, adapter, {});
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    return (server.address() as AddressInfo).port;
}

/** One AUTHENTICATE on a raw socket: the reply's type, and its code when it has one. */
function authenticate(port: number, token: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/`);
        const timer = setTimeout(() => { socket.terminate(); reject(new Error("no answer")); }, 5000);
        socket.once("error", reject);
        socket.once("open", () => socket.send(JSON.stringify({ type: "AUTHENTICATE", requestId: "auth_1", payload: { token } })));
        socket.on("message", (data) => {
            const message = JSON.parse(String(data)) as { type?: string; requestId?: string; payload?: { error?: { code?: string } } };
            if (message.requestId !== "auth_1") return;
            clearTimeout(timer);
            socket.terminate();
            const code = message.payload?.error?.code;
            resolve(code ? `${message.type}:${code}` : String(message.type));
        });
    });
}

describe("the socket refuses a session as the HTTP routes do", () => {
    it("SESSION_REVOKED for a session signed out everywhere", async () => {
        const port = await socketServer();
        expect(await authenticate(port, await generateAccessToken("revoked-user", ["editor"]))).toBe("AUTH_ERROR:SESSION_REVOKED");
    });

    it("SESSION_REVOKED for an account that no longer exists", async () => {
        const port = await socketServer();
        expect(await authenticate(port, await generateAccessToken("deleted-user", ["editor"]))).toBe("AUTH_ERROR:SESSION_REVOKED");
    });

    it("ACCOUNT_DISABLED for a disabled account", async () => {
        const port = await socketServer();
        expect(await authenticate(port, await generateAccessToken("disabled-user", ["editor"]))).toBe("AUTH_ERROR:ACCOUNT_DISABLED");
    });

    it("INVALID_TOKEN, still, for a token that does not verify", async () => {
        const port = await socketServer();
        expect(await authenticate(port, "not-a-token")).toBe("AUTH_ERROR:INVALID_TOKEN");
    });

    it("and signs a live session in", async () => {
        const port = await socketServer();
        expect(await authenticate(port, await generateAccessToken("live-user", ["editor"]))).toBe("AUTH_SUCCESS");
    });
});

describe("the SDK in a Node script", () => {
    let stdout: string[];
    let warnings: string[];

    beforeEach(() => {
        stdout = [];
        warnings = [];
        const toStdout = (...args: unknown[]) => { stdout.push(args.map(String).join(" ")); };
        // Node writes all three to stdout.
        jest.spyOn(console, "log").mockImplementation(toStdout);
        jest.spyOn(console, "info").mockImplementation(toStdout);
        jest.spyOn(console, "debug").mockImplementation(toStdout);
        jest.spyOn(console, "warn").mockImplementation((...args: unknown[]) => { warnings.push(args.map(String).join(" ")); });
    });

    function socketClient(port: number, token: string): RebaseWebSocketClient {
        const client = new RebaseWebSocketClient({
            websocketUrl: `ws://127.0.0.1:${port}`,
            getAuthToken: async () => token,
            // A refresh the server refuses, as it refuses a revoked session's.
            onUnauthorized: async () => false
        });
        clients.push(client);
        return client;
    }

    it("says nothing on stdout about connecting and signing in", async () => {
        const port = await socketServer();
        const client = socketClient(port, await generateAccessToken("live-user", ["editor"]));

        const connected = new Promise<void>((resolve) => client.on("connect", () => resolve()));
        client.ensureConnected();
        await connected;
        await new Promise((resolve) => setTimeout(resolve, 100));

        expect(stdout).toEqual([]);
    });

    it("tells listen() the session was refused, at once, with the code, and warns once in words that say so", async () => {
        const port = await socketServer();
        const client = socketClient(port, await generateAccessToken("revoked-user", ["editor"]));

        const startedAt = Date.now();
        const refusal = await new Promise<Error & { code?: string }>((resolve) => {
            client.listenCollection({ path: "posts" }, () => undefined, (error) => resolve(error));
        });

        // No retries with backoff: a refused session is an answer.
        expect(Date.now() - startedAt).toBeLessThan(1000);
        expect(refusal.code).toBe("SESSION_REVOKED");

        expect(stdout).toEqual([]);
        expect(warnings.join("\n")).not.toMatch(/connected without auth/i);
        const refused = warnings.filter(line => line.startsWith("[Rebase] Realtime"));
        expect(refused).toHaveLength(1);
        expect(refused[0]).toMatch(/refused this session/);
        expect(refused[0]).toContain("SESSION_REVOKED");
        // One AUTHENTICATE for the one token, so the server judged it once.
        expect(warnings.filter(line => line.includes("[Security Audit] Refused an access token"))).toHaveLength(1);
    });

    it("names ACCOUNT_DISABLED for a disabled account", async () => {
        const port = await socketServer();
        const client = socketClient(port, await generateAccessToken("disabled-user", ["editor"]));

        const refusal = await new Promise<Error & { code?: string }>((resolve) => {
            client.listenCollection({ path: "posts" }, () => undefined, (error) => resolve(error));
        });

        expect(refusal.code).toBe("ACCOUNT_DISABLED");
        expect(warnings.filter(line => line.startsWith("[Rebase] Realtime"))[0]).toContain("ACCOUNT_DISABLED");
    });
});
