/**
 * E2E: with the database stopped, every surface gives the same honest answer.
 *
 * A tester stopped Postgres under a running API. The data API answered
 * `503 ROLE_LOOKUP_FAILED` "Could not verify your permissions", sign-in
 * answered `500 INTERNAL_ERROR`, and only the log said the database was gone.
 * Neither is what happened: nobody's permissions were in question and nothing
 * crashed. The database was unreachable, which is a 503 a client may retry,
 * and it should say so in the same words on every door.
 *
 * What runs here is the real boot, the built-in auth, the data router, the
 * admin routes and the realtime socket, against a real Postgres that is then
 * stopped.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { execa } from "execa";
import { WebSocket as NodeWebSocket } from "ws";
import pg from "pg";
import { Hono } from "hono";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "database-down-e2e-secret-that-is-long-enough-0123456789";
const SERVICE_KEY = "database-down-e2e-service-key-0123456789abcdef";

const notesCollection: CollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" }
    }
};

interface Answer {
    status: number;
    code: unknown;
    message: unknown;
    retryAfter: string | null;
}

describe("the database is down (E2E)", () => {
    let container: PgContainer;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const server = createServer();
    const sockets: NodeWebSocket[] = [];
    const originalNodeEnv = process.env.NODE_ENV;
    let userToken = "";
    let adminToken = "";
    const storageDir = mkdtempSync(path.join(tmpdir(), "rebase-database-down-storage-"));

    async function call(path: string, headers: Record<string, string>, init: { method?: string; body?: unknown } = {}): Promise<Answer> {
        const response = await app.request(path, {
            method: init.method ?? "GET",
            headers: { "Content-Type": "application/json", ...headers },
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        const text = await response.text();
        const json: unknown = text ? JSON.parse(text) : undefined;
        const error = typeof json === "object" && json !== null && "error" in json ? json.error : undefined;
        const field = (key: string) => typeof error === "object" && error !== null && key in error
            ? Reflect.get(error, key)
            : undefined;
        return { status: response.status, code: field("code"), message: field("message"), retryAfter: response.headers.get("Retry-After") };
    }

    const bearer = (credential: string) => ({ Authorization: `Bearer ${credential}` });

    type Frame = { type?: string; requestId?: string; payload?: { error?: { code?: string; message?: string } } };

    /** A socket to the booted server; `send` resolves with the frame answering it. */
    async function openSocket(): Promise<{ send: (type: string, payload: Record<string, unknown>) => Promise<Frame> }> {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        const waiting = new Map<string, (frame: Frame) => void>();
        ws.on("message", (data) => {
            const frame: Frame = JSON.parse(String(data));
            if (frame.requestId) waiting.get(frame.requestId)?.(frame);
        });
        let seq = 0;
        return {
            send: (type, payload) => new Promise((resolve, reject) => {
                const requestId = `${type}-${++seq}`;
                const timer = setTimeout(() => reject(new Error(`no answer to ${requestId}`)), 10_000);
                waiting.set(requestId, (frame) => {
                    clearTimeout(timer);
                    resolve(frame);
                });
                ws.send(JSON.stringify({ type, requestId, payload }));
            })
        };
    }

    let signedInSocket: Awaited<ReturnType<typeof openSocket>>;

    function expectDatabaseUnavailable(answer: Answer): void {
        expect(answer, JSON.stringify(answer)).toMatchObject({ status: 503, code: "DATABASE_UNAVAILABLE" });
        expect(String(answer.message)).toMatch(/database/i);
        expect(String(answer.message)).not.toMatch(/permission/i);
        expect(answer.retryAfter).not.toBeNull();
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app,
            server,
            collections: [notesCollection],
            database: createPostgresAdapter({
                connection: connection.db,
                connectionString: container.connectionString
            }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY },
            storage: { type: "local", basePath: storageDir },
            storageInsecureAllowAnyAuthenticated: true
        });

        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        const user = await repo.createUser({ email: "someone@down.test", emailVerified: true });
        const admin = await repo.createUser({ email: "admin@down.test", emailVerified: true });
        await repo.setUserRoles(admin.id, ["admin"]);
        userToken = await generateAccessToken(user.id, []);
        adminToken = await generateAccessToken(admin.id, ["admin"]);

        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));

        // Up: the same requests succeed, so what changes below is the database.
        expect((await call("/api/data/notes", bearer(userToken))).status).toBe(200);
        expect((await call("/api/storage/list?prefix=docs/", bearer(adminToken))).status).toBe(200);
        signedInSocket = await openSocket();
        expect((await signedInSocket.send("AUTHENTICATE", { token: userToken })).type).toBe("AUTH_SUCCESS");
        expect((await signedInSocket.send("FETCH_COLLECTION", { path: "notes" })).type).not.toBe("ERROR");

        // The container runs with --rm, so stopping it removes it as well.
        await execa("docker", ["stop", "-t", "1", container.containerName]);
    }, 180_000);

    afterAll(async () => {
        for (const ws of sockets) ws.terminate();
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
        rmSync(storageDir, { recursive: true, force: true });
    }, 60_000);

    it("answers a signed-in data request 503 DATABASE_UNAVAILABLE, not ROLE_LOOKUP_FAILED", async () => {
        expectDatabaseUnavailable(await call("/api/data/notes", bearer(userToken)));
    });

    it("answers a service-key data request the same", async () => {
        expectDatabaseUnavailable(await call("/api/data/notes", bearer(SERVICE_KEY)));
    });

    it("answers a sign-in the same, not 500 INTERNAL_ERROR", async () => {
        expectDatabaseUnavailable(await call("/api/auth/login", {}, {
            method: "POST",
            body: { email: "someone@down.test", password: "Whatever-Passw0rd" }
        }));
    });

    it("answers an admin route the same", async () => {
        expectDatabaseUnavailable(await call("/api/admin/users", bearer(adminToken)));
    });

    it("answers storage the same, not 401 UNAUTHORIZED for a valid admin token", async () => {
        expectDatabaseUnavailable(await call("/api/storage/list?prefix=docs/", bearer(adminToken)));
    });

    it("answers a signed-in socket's frame with the same code", async () => {
        // Authenticated while the database was up; the frame's re-check of the
        // session is what meets the stopped database.
        const answer = await signedInSocket.send("FETCH_COLLECTION", { path: "notes" });
        expect(answer, JSON.stringify(answer)).toMatchObject({ type: "ERROR", payload: { error: { code: "DATABASE_UNAVAILABLE" } } });
    });

    it("answers a socket signing in with an ERROR, not an AUTH_ERROR that sends the SDK to refresh a good session", async () => {
        const socket = await openSocket();
        const answer = await socket.send("AUTHENTICATE", { token: userToken });
        expect(answer, JSON.stringify(answer)).toMatchObject({ type: "ERROR", payload: { error: { code: "DATABASE_UNAVAILABLE" } } });
    });

    it("still reports the real database error in the pool's own connection", async () => {
        // A sanity check that the database really is gone, not merely refusing
        // this backend: a fresh client is refused too.
        const client = new pg.Client({ connectionString: container.connectionString, connectionTimeoutMillis: 2_000 });
        await expect(client.connect()).rejects.toThrow();
        await client.end().catch(() => {});
    });
});
