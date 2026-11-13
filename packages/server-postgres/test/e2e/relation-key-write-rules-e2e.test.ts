/**
 * E2E: a parent's `hasMany` / `hasOne` write cannot move child rows whose
 * foreign key the caller may not write (SEC-FIX-2 F-4).
 *
 * `PATCH /threads/1 { replies: [1, 2] }` re-parented reply 2 although
 * `replies.threadId` is `.readOnly()` and `PATCH /replies/2 { threadId: 1 }`
 * is refused: the write check judged the parent's relation key only. Now the
 * relation write is held to the child key's rules on REST, on the socket's
 * SAVE and on MCP's `update_row`, with the codes the direct write gets — and a
 * caller the key's `access.write` admits still writes it.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import pg from "pg";
import { Hono } from "hono";
import { col, defineTable, rel, type RlsPosture } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "relation-key-write-rules-e2e-secret-long-enough-01234";
const SERVICE_KEY = "relation-key-write-rules-e2e-service-key-0123456789ab";

const open: RlsPosture = [{ operation: "all", access: "authenticated" }];

const threads = defineTable("threads", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    relations: {
        replies: rel.hasMany(() => replies, { foreignKey: "threadId" }),
        pinned: rel.hasOne(() => pins, { foreignKey: "threadId" })
    },
    rls: open
});
const replies = defineTable("replies", {
    columns: { id: col.serial().primaryKey(), body: col.text(), threadId: col.integer().readOnly() },
    rls: open
});
const pins = defineTable("pins", {
    columns: { id: col.serial().primaryKey(), label: col.text(), threadId: col.integer().access({ write: ["moderator"] }) },
    rls: open
});

type Row = Record<string, unknown>;

describe("a relation write from the parent is held to the child key's rules (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const server = createServer();
    const sockets: NodeWebSocket[] = [];
    const callers = { editor: { token: "" }, moderator: { token: "" } };

    async function patch(who: keyof typeof callers, path: string, body: Row) {
        const response = await app.request(`/api/data${path}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${callers[who].token}` },
            body: JSON.stringify(body)
        });
        const text = await response.text();
        return { status: response.status, text };
    }

    const stored = async () => (await admin.query("SELECT 'r' || id AS row, thread_id FROM replies UNION ALL SELECT 'p' || id, thread_id FROM pins ORDER BY 1")).rows;

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app, server,
            tables: [threads, replies, pins],
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY }
        });
        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("no auth repository");
        for (const [who, roles] of [["editor", ["editor"]], ["moderator", ["moderator"]]] as const) {
            const user = await repo.createUser({ email: `${who}@relation-key.test`, emailVerified: true });
            await repo.setUserRoles(user.id, [...roles]);
            callers[who].token = await generateAccessToken(user.id, [...roles]);
        }
        await admin.query(`
            INSERT INTO threads (title) VALUES ('t1'), ('t2');
            INSERT INTO replies (body, thread_id) VALUES ('r1 on t1', 1), ('r2 on t2', 2);
            INSERT INTO pins (label, thread_id) VALUES ('p1 on t2', 2);
        `);
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    }, 180_000);

    afterAll(async () => {
        for (const ws of sockets) ws.terminate();
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("REST: the direct write and the write from the parent get the same refusal; nothing moves", async () => {
        const before = await stored();
        const direct = await patch("editor", "/replies/2", { threadId: 1 });
        expect(direct.status).toBe(400);
        expect(direct.text).toContain("VALIDATION_EXCLUDED_FIELDS");
        const fromParent = await patch("editor", "/threads/1", { replies: [1, 2] });
        expect(fromParent.status, fromParent.text).toBe(400);
        expect(fromParent.text).toContain("VALIDATION_EXCLUDED_FIELDS");
        const hasOne = await patch("editor", "/threads/1", { pinned: 1 });
        expect(hasOne.status, hasOne.text).toBe(400);
        expect(hasOne.text).toContain("FIELD_NOT_WRITABLE");
        expect(await stored()).toEqual(before);
    });

    it("REST: a caller the key's access.write admits still moves the row", async () => {
        const moved = await patch("moderator", "/threads/1", { pinned: 1 });
        expect(moved.status, moved.text).toBe(200);
        expect((await admin.query("SELECT thread_id FROM pins WHERE id = 1")).rows[0]?.thread_id).toBe(1);
    });

    it("the socket's SAVE refuses the same write", async () => {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
        const answers = new Map<string, (frame: Row) => void>();
        ws.on("message", (data) => {
            const frame: Row = JSON.parse(String(data));
            const id = typeof frame.requestId === "string" ? frame.requestId : undefined;
            const waiter = id ? answers.get(id) : undefined;
            if (id && waiter) { answers.delete(id); waiter(frame); }
        });
        const send = (type: string, requestId: string, payload: Row) => new Promise<Row>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`no answer to ${type}`)), 5_000);
            answers.set(requestId, (frame) => { clearTimeout(timer); resolve(frame); });
            ws.send(JSON.stringify({ type, requestId, payload }));
        });
        const auth = await send("AUTHENTICATE", "auth", { token: callers.editor.token });
        expect(auth.type).toBe("AUTH_SUCCESS");
        const before = await stored();
        const saved = await send("SAVE", "save", { path: "threads", id: "1", status: "existing", values: { replies: [1, 2] } });
        expect(saved.type).toBe("ERROR");
        expect(JSON.stringify(saved)).toContain("VALIDATION_EXCLUDED_FIELDS");
        expect(await stored()).toEqual(before);
    });
});
