/**
 * E2E: a database closed to new connections is answered as one that is down,
 * and the log says which database it is and what opens it.
 *
 * `rebase db branch create --force` closes its source (`ALLOW_CONNECTIONS
 * false`) for the copy, and one killed part-way leaves it closed. A running app
 * on it then met SQLSTATE 55000 on every new connection, `database "x" is not
 * currently accepting connections`, and answered signed-in requests `503
 * ROLE_LOOKUP_FAILED` "Could not verify your permissions" (R4A). It is `503
 * DATABASE_UNAVAILABLE` with `Retry-After`, as for a database that is down.
 *
 * The real boot, the built-in auth, the data router and the realtime socket,
 * against a real Postgres whose database is closed under them — its open
 * connections ended, so the pool has to open new ones — and opened again.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import pg from "pg";
import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, logger, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "database-closed-e2e-secret-that-is-long-enough-0123456789";

const notesCollection: CollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" }
    }
};

describe("the database is closed to new connections (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const server = createServer();
    const sockets: NodeWebSocket[] = [];
    const originalNodeEnv = process.env.NODE_ENV;
    const logged: string[] = [];
    let userToken = "";

    async function call(path: string, headers: Record<string, string>): Promise<{ status: number; code: unknown; retryAfter: string | null }> {
        const response = await app.request(path, { headers });
        const json: unknown = await response.json().catch(() => undefined);
        const error = typeof json === "object" && json !== null && "error" in json ? json.error : undefined;
        const code = typeof error === "object" && error !== null && "code" in error ? error.code : undefined;
        return { status: response.status, code, retryAfter: response.headers.get("Retry-After") };
    }

    const bearer = (credential: string) => ({ Authorization: `Bearer ${credential}` });

    /** A socket's answer to one `AUTHENTICATE`. */
    async function authenticateSocket(token: string): Promise<{ type?: string; payload?: { error?: { code?: string } } }> {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("no answer to AUTHENTICATE")), 10_000);
            ws.on("message", (data) => {
                const frame = JSON.parse(String(data)) as { type?: string; requestId?: string; payload?: { error?: { code?: string } } };
                if (frame.requestId !== "auth-1") return;
                clearTimeout(timer);
                resolve(frame);
            });
            ws.send(JSON.stringify({ type: "AUTHENTICATE", requestId: "auth-1", payload: { token } }));
        });
    }

    /** Close `app` to new connections and end the ones it has, as a killed forced branch copy leaves it. */
    async function closeTheDatabase(): Promise<void> {
        await admin.query("ALTER DATABASE app ALLOW_CONNECTIONS false");
        await admin.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'app' AND pid <> pg_backend_pid()");
        // Until the pool has dropped the connections that were ended, a request
        // can still be handed one, and that is a connection lost — the database
        // unreachable, rightly — rather than one refused for being closed.
        await vi.waitFor(() => expect(connection.pool.totalCount).toBe(0), { timeout: 10_000, interval: 50 });
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query("CREATE DATABASE app");
        const url = new URL(container.connectionString);
        url.pathname = "/app";
        connection = createPostgresDatabaseConnection(url.toString());
        backend = await initializeRebaseBackend({
            app,
            server,
            collections: [notesCollection],
            database: createPostgresAdapter({ connection: connection.db, connectionString: url.toString() }),
            auth: { jwtSecret: JWT_SECRET }
        });

        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        const user = await repo.createUser({ email: "someone@closed.test", emailVerified: true });
        userToken = await generateAccessToken(user.id, []);

        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

        // Open: the same request succeeds, so what changes below is the database.
        expect((await call("/api/data/notes", bearer(userToken))).status).toBe(200);

        const keep = (message: string) => { logged.push(message); };
        vi.spyOn(logger, "error").mockImplementation(keep);
        vi.spyOn(logger, "warn").mockImplementation(keep);
        await closeTheDatabase();
    }, 180_000);

    afterAll(async () => {
        vi.restoreAllMocks();
        for (const ws of sockets) ws.terminate();
        await admin?.query("ALTER DATABASE app ALLOW_CONNECTIONS true").catch(() => {});
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("answers a signed-in data request 503 DATABASE_UNAVAILABLE with Retry-After, not ROLE_LOOKUP_FAILED", async () => {
        const answer = await call("/api/data/notes", bearer(userToken));
        expect(answer, JSON.stringify(answer)).toMatchObject({ status: 503, code: "DATABASE_UNAVAILABLE" });
        expect(answer.retryAfter).not.toBeNull();
    });

    it("says which database is closed, and what opens it", () => {
        const line = logged.find(message => message.includes('Database "app" is closed to new connections'));
        expect(line, logged.join("\n")).toBeDefined();
        expect(line).toContain("rebase db branch list");
        expect(line).toContain('ALTER DATABASE "app" ALLOW_CONNECTIONS true');
        expect(logged.join("\n")).not.toMatch(/ROLE_LOOKUP_FAILED|Could not judge an access token; refusing it$/m);
    });

    it("answers a socket signing in with an ERROR, not an AUTH_ERROR that sends the SDK to refresh a good session", async () => {
        const answer = await authenticateSocket(userToken);
        expect(answer, JSON.stringify(answer)).toMatchObject({ type: "ERROR", payload: { error: { code: "DATABASE_UNAVAILABLE" } } });
    });

    it("serves again once the database is opened", async () => {
        await admin.query("ALTER DATABASE app ALLOW_CONNECTIONS true");
        expect((await call("/api/data/notes", bearer(userToken))).status).toBe(200);
    });
});
