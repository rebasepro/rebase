import { describe, expect, it, afterEach } from "@jest/globals";
import { Hono } from "hono";
import { createHash } from "node:crypto";
import path from "node:path";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver, SqlCursor } from "@rebasepro/types";

import { initializeRebaseBackend } from "../src/init";
import { generateAccessToken } from "../src/auth/jwt";
import { ApiError } from "../src/api/errors";

/**
 * `POST /api/admin/sql/csv` — the SQL console's "Download full result as CSV".
 *
 * The console keeps the first 10,000 rows of a result; this is the way to the
 * rest. It streams one query's result through `SQLAdmin.openSqlCursor`, a
 * batch per pull, so the server holds one batch however long the result is.
 * Who may call it is who may run SQL over the socket: the `database:write`
 * scope, behind the admin gate.
 */

const JWT_SECRET = "sql-export-route-test-secret-1234567890";
const CRONS_DIR = path.join(__dirname, "fixtures", "crons");
const SERVICE_API_KEY = "rk_non_admin_service_key";

const BATCH = 1000;
const TOTAL = 100_000;

/** What the fake cursor was asked for, and how far it ever ran ahead of the reader. */
const cursorLog = { opened: [] as { sql: string; options: unknown }[], batchesRead: 0, closed: 0 };
let failAfterBatches: number | undefined;
let refuse: Error | undefined;

function fakeCursor(): SqlCursor {
    let next = 0;
    let closed = false;
    return {
        columns: ["id", "note", "id"],
        async read() {
            if (closed || next >= TOTAL) return null;
            if (failAfterBatches !== undefined && cursorLog.batchesRead >= failAfterBatches) {
                throw new Error("canceling statement due to statement timeout");
            }
            cursorLog.batchesRead++;
            const rows = Array.from({ length: BATCH }, (_, index): (string | null)[] => {
                const id = String(next + index + 1);
                return [id, id === "1" ? "say \"hi\", twice\nthen stop" : null, id];
            });
            next += BATCH;
            return rows;
        },
        async close() {
            if (closed) return;
            closed = true;
            cursorLog.closed++;
        }
    };
}

function hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}

function stubDriver(withCursor: boolean) {
    const serviceKey = {
        id: "key-service", name: "service", key_prefix: SERVICE_API_KEY.slice(0, 11), key_hash: hash(SERVICE_API_KEY),
        permissions: [], admin: false, rate_limit: null, created_by: "test",
        created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-01T00:00:00.000Z",
        last_used_at: null, expires_at: null, revoked_at: null
    };
    return {
        fetchCollection: async () => ({ data: [], meta: { total: 0, hasMore: false } }),
        fetchEntity: async () => undefined,
        saveEntity: async () => ({}),
        deleteEntity: async () => undefined,
        countCollection: async () => 0,
        checkUniqueField: async () => true,
        healthCheck: async () => ({ healthy: true, latencyMs: 1 }),
        admin: {
            executeSql: async (sql: string, options?: { params?: unknown[] }) =>
                sql.includes("rebase.api_keys") && sql.includes("key_hash = $1") && options?.params?.[0] === hash(SERVICE_API_KEY)
                    ? [serviceKey]
                    : [],
            ...(withCursor ? {
                openSqlCursor: async (sql: string, options?: unknown) => {
                    cursorLog.opened.push({ sql, options });
                    if (refuse) throw refuse;
                    return fakeCursor();
                }
            } : {})
        }
    } as never;
}

const started: Array<() => void> = [];

async function boot(options: { withCursor?: boolean } = {}): Promise<Hono> {
    const bootstrapper = {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: stubDriver(options.withCursor ?? true), collections: [], internals: {} } as unknown as InitializedDriver;
        },
        // Roles and revocation are read off the database by the admin gate,
        // never off the token.
        async initializeAuth() {
            const authRepository = {
                getUserRoleIds: async (uid: string) => (uid.startsWith("admin") ? ["admin"] : ["editor"]),
                getTokensValidAfter: async () => null
            };
            return { userService: authRepository, authRepository };
        }
    } as unknown as BackendBootstrapper;
    const app = new Hono();
    const backend = await initializeRebaseBackend({
        app: app as never,
        server: {} as never,
        collections: [{ name: "jobs", slug: "jobs", table: "jobs", properties: { id: { name: "ID", type: "string", isId: "uuid" } } } as unknown as CollectionConfig],
        cronsDir: CRONS_DIR,
        cronPersistence: false,
        bootstrappers: [bootstrapper],
        enableSwagger: false,
        auth: { requireAuth: false, jwtSecret: JWT_SECRET }
    } as never);
    started.push(() => (backend as { cronScheduler?: { stop?: () => void } }).cronScheduler?.stop?.());
    return app;
}

afterEach(() => {
    while (started.length) started.pop()!();
    cursorLog.opened = [];
    cursorLog.batchesRead = 0;
    cursorLog.closed = 0;
    failAfterBatches = undefined;
    refuse = undefined;
});

async function post(app: Hono, body: unknown, token?: string): Promise<Response> {
    return app.request("/api/admin/sql/csv", {
        method: "POST",
        headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body)
    });
}

describe("who may download a query's result", () => {
    it("refuses a request with no credential", async () => {
        const app = await boot();

        expect((await post(app, { sql: "SELECT 1" })).status).toBe(401);
        expect(cursorLog.opened).toHaveLength(0);
    });

    it("refuses a signed-in person without database:write, as the socket refuses them EXECUTE_SQL", async () => {
        const app = await boot();
        const res = await post(app, { sql: "SELECT 1" }, await generateAccessToken("editor-1", ["editor"]));

        expect(res.status).toBe(403);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("SCOPE_MISSING");
        expect(cursorLog.opened).toHaveLength(0);
    });

    it("refuses an API key without database:write", async () => {
        const app = await boot();

        expect((await post(app, { sql: "SELECT 1" }, SERVICE_API_KEY)).status).toBe(403);
        expect(cursorLog.opened).toHaveLength(0);
    });
});

describe("downloading a query's result as an admin", () => {
    it("streams every row as RFC 4180 CSV, one batch read per batch the reader takes", async () => {
        const app = await boot();
        const res = await post(app, { sql: "SELECT * FROM events", database: "app", role: "reader" }, await generateAccessToken("admin-1", ["admin"]));

        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toMatch(/^text\/csv/);
        expect(res.headers.get("content-disposition")).toMatch(/attachment/);
        expect(cursorLog.opened).toEqual([{ sql: "SELECT * FROM events", options: { database: "app", role: "reader" } }]);

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let text = "";
        let chunks = 0;
        let mostAhead = 0;
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks++;
            text += decoder.decode(value, { stream: true });
            // The header is the first chunk; every later one is a batch.
            mostAhead = Math.max(mostAhead, cursorLog.batchesRead - (chunks - 1));
        }

        // Never more than the batch the stream keeps ready ahead of the reader:
        // 100 batches did not sit in memory waiting for a slow download.
        expect(mostAhead).toBeLessThanOrEqual(2);
        expect(cursorLog.batchesRead).toBe(TOTAL / BATCH);
        const records = text.split("\r\n");
        expect(records[0]).toBe("id,note,id");
        expect(records[1]).toBe("1,\"say \"\"hi\"\", twice\nthen stop\",1");
        expect(records[2]).toBe("2,,2");
        expect(text.endsWith(`${TOTAL},,${TOTAL}\r\n`)).toBe(true);
        expect(cursorLog.closed).toBe(1);
    });

    it("answers the database's refusal of the query as an error, before any of the file", async () => {
        refuse = new ApiError(400, "SQL_ERROR", "Only a query that returns rows can be downloaded");
        const app = await boot();
        const res = await post(app, { sql: "DELETE FROM events" }, await generateAccessToken("admin-1", ["admin"]));

        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ error: { code: "SQL_ERROR", message: expect.stringMatching(/returns rows/) } });
    });

    it("fails the download rather than end it early when a batch fails part-way", async () => {
        failAfterBatches = 3;
        const app = await boot();
        const res = await post(app, { sql: "SELECT * FROM events" }, await generateAccessToken("admin-1", ["admin"]));

        expect(res.status).toBe(200);
        await expect(res.text()).rejects.toThrow(/statement timeout/);
        expect(cursorLog.closed).toBe(1);
    });

    it("gives the session back when the reader goes away", async () => {
        const app = await boot();
        const res = await post(app, { sql: "SELECT * FROM events" }, await generateAccessToken("admin-1", ["admin"]));

        const reader = res.body!.getReader();
        await reader.read();
        await reader.read();
        await reader.cancel();

        expect(cursorLog.closed).toBe(1);
        expect(cursorLog.batchesRead).toBeLessThan(5);
    });

    it("refuses a body without a query", async () => {
        const app = await boot();
        const res = await post(app, { sql: "  " }, await generateAccessToken("admin-1", ["admin"]));

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("INVALID_INPUT");
    });

    it("says so when the data source cannot stream a result", async () => {
        const app = await boot({ withCursor: false });
        const res = await post(app, { sql: "SELECT 1" }, await generateAccessToken("admin-1", ["admin"]));

        expect(res.status).toBe(501);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("SQL_EXPORT_UNSUPPORTED");
    });
});
