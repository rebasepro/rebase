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
 * SEC-FIX-3 extends it to the one rule behind F-4: a restriction on a column
 * is a restriction on every spelling that writes it. Doors (REST PATCH / POST /
 * bulk / `_batch`, socket SAVE, MCP `update_row`, the in-process SDK on a
 * caller-scoped driver, history revert) × spellings (the key column, the
 * `belongsTo` bound to it, a to-one `via`, a `_pivot` field under
 * `strictWrites: false`) × rules (`.readOnly()`, `access.write`, `.private()`,
 * an `.onCreateUser()` stamp, the tenant) — every cell refuses or ignores
 * exactly as the column's own name does on that door. The in-process SDK is
 * server code: the API boundary's column rules are not its (as on `main`), the
 * identity rules (stamps, tenant, key) are.
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
import { MCP_TOOLS } from "../../../server/src/mcp/mcp-tools.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { testUser } from "./test-user.js";

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

// ── SEC-FIX-3: one column, every spelling ──
const people = defineTable("people", {
    columns: { id: col.text().primaryKey(), name: col.text() },
    rls: open
});
const docs = defineTable("docs", {
    columns: {
        id: col.serial().primaryKey(),
        title: col.text(),
        createdBy: col.text().onCreateUser(),
        reviewerId: col.text().readOnly(),
        approverId: col.text().access({ write: ["moderator"] }),
        informantId: col.text().private()
    },
    relations: {
        creator: rel.belongsTo(() => people, { localKey: "created_by" }),
        reviewer: rel.belongsTo(() => people, { localKey: "reviewer_id" }),
        approver: rel.belongsTo(() => people, { localKey: "approver_id" }),
        informant: rel.belongsTo(() => people, { localKey: "informant_id" })
    },
    history: true,
    rls: open
});
const orgs = defineTable("orgs", { columns: { id: col.text().primaryKey() }, rls: open });
const memos = defineTable("memos", {
    columns: { id: col.serial().primaryKey(), body: col.text(), orgId: col.text() },
    relations: { org: rel.belongsTo(() => orgs, { localKey: "org_id" }) },
    tenant: { field: "orgId", from: { claim: "org_id" } },
    history: true,
    rls: open
});
const badges = defineTable("badges", {
    columns: { id: col.serial().primaryKey(), label: col.text(), ownerId: col.integer().readOnly() },
    rls: open
});
const owners = defineTable("owners", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    relations: {
        badge: rel.via(() => badges, { steps: [{ table: "badges", on: { from: "id", to: "owner_id" } }], cardinality: "one" })
    },
    rls: open
});
const labels = defineTable("labels", { columns: { id: col.serial().primaryKey(), name: col.text() }, rls: open });
const loose = defineTable("loose", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    relations: {
        labels: rel.manyToMany(() => labels, { pivot: { grade: col.text().access({ write: ["moderator"] }), locked: col.text().readOnly() } })
    },
    strictWrites: false,
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
    const callers = {
        editor: { token: "", uid: "", roles: ["editor"], claims: { org_id: "a" } },
        moderator: { token: "", uid: "", roles: ["moderator"], claims: { org_id: "a" } },
        editorB: { token: "", uid: "", roles: ["editor"], claims: { org_id: "b" } }
    };

    async function request(who: keyof typeof callers, method: string, path: string, body?: unknown) {
        const response = await app.request(`/api/data${path}`, {
            method,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${callers[who].token}` },
            ...(body !== undefined ? { body: JSON.stringify(body) } : {})
        });
        const text = await response.text();
        return { status: response.status, text };
    }
    const patch = (who: keyof typeof callers, path: string, body: Row) => request(who, "PATCH", path, body);

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
            tables: [threads, replies, pins, people, docs, orgs, memos, badges, owners, labels, loose],
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY },
            history: true
        });
        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("no auth repository");
        for (const who of ["editor", "moderator", "editorB"] as const) {
            const caller = callers[who];
            const user = await repo.createUser({ email: `${who.toLowerCase()}@relation-key.test`, emailVerified: true });
            await repo.setUserRoles(user.id, caller.roles);
            caller.uid = user.id;
            caller.token = await generateAccessToken(user.id, caller.roles, "aal1", caller.claims);
        }
        await admin.query(`
            INSERT INTO threads (title) VALUES ('t1'), ('t2');
            INSERT INTO replies (body, thread_id) VALUES ('r1 on t1', 1), ('r2 on t2', 2);
            INSERT INTO pins (label, thread_id) VALUES ('p1 on t2', 2);
            INSERT INTO people (id, name) VALUES ('author', 'A'), ('victim', 'V'), ('r1', 'R1'), ('r2', 'R2');
            INSERT INTO docs (title, created_by, reviewer_id, approver_id, informant_id) VALUES ('d1', 'author', 'r1', 'r1', 'r1');
            INSERT INTO orgs (id) VALUES ('a'), ('b');
            INSERT INTO memos (body, org_id) VALUES ('m1 of a', 'a');
            INSERT INTO owners (name) VALUES ('o1'), ('o2');
            INSERT INTO badges (label, owner_id) VALUES ('b1 of o1', 1), ('b2 of o2', 2), ('b3 of o2', 2);
            INSERT INTO labels (name) VALUES ('l1');
            INSERT INTO loose (name) VALUES ('x1');
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

    /** A socket signed in as `who`; `send` answers the frame its request id gets. */
    async function openSocket(who: keyof typeof callers) {
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
        const auth = await send("AUTHENTICATE", "auth", { token: callers[who].token });
        expect(auth.type).toBe("AUTH_SUCCESS");
        return send;
    }

    it("the socket's SAVE refuses the same write", async () => {
        const send = await openSocket("editor");
        const before = await stored();
        const saved = await send("SAVE", "save", { path: "threads", id: "1", status: "existing", values: { replies: [1, 2] } });
        expect(saved.type).toBe("ERROR");
        expect(JSON.stringify(saved)).toContain("VALIDATION_EXCLUDED_FIELDS");
        expect(await stored()).toEqual(before);
    });

    // ── SEC-FIX-3: every spelling of a column, through every door ──

    const docRow = async () => (await admin.query("SELECT created_by, reviewer_id, approver_id, informant_id FROM docs WHERE id = 1")).rows[0];
    const codeOf = (text: string): string | undefined => {
        try {
            const parsed: unknown = JSON.parse(text);
            const error = typeof parsed === "object" && parsed !== null && "error" in parsed ? parsed.error : undefined;
            return typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
        } catch {
            return undefined;
        }
    };
    const errorCode = (error: unknown): string | undefined =>
        typeof error === "object" && error !== null && "code" in error ? String(error.code) : undefined;
    /**
     * The code an MCP tool's refusal stands for. A tool answers the model with
     * the message alone, which is the direct write's message word for word.
     */
    const mcpCode = (error: unknown): string => {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("cannot be written through the API")) return "VALIDATION_EXCLUDED_FIELDS";
        if (message.includes("is not writable with your roles")) return "FIELD_NOT_WRITABLE";
        return errorCode(error) ?? message;
    };

    /** Each door, as `who`, writing `values` to docs row 1; answers the refusal code, or `undefined` for a write that went through. */
    type Door = (who: keyof typeof callers, values: Row) => Promise<string | undefined>;
    const doors: Record<string, Door> = {
        "REST PATCH": async (who, values) => {
            const answer = await patch(who, "/docs/1", values);
            return answer.status === 200 ? undefined : codeOf(answer.text) ?? `HTTP ${answer.status}`;
        },
        "REST bulk PATCH": async (who, values) => {
            const answer = await request(who, "PATCH", "/docs/bulk", { updates: [{ id: 1, data: values }] });
            return answer.status === 200 ? undefined : codeOf(answer.text) ?? `HTTP ${answer.status}`;
        },
        "REST _batch": async (who, values) => {
            const answer = await request(who, "POST", "/_batch", { operations: [{ op: "update", table: "docs", id: 1, values }] });
            return answer.status === 200 ? undefined : codeOf(answer.text) ?? `HTTP ${answer.status}`;
        },
        "socket SAVE": async (who, values) => {
            const send = await openSocket(who);
            const frame = await send("SAVE", "save", { path: "docs", id: "1", status: "existing", values });
            if (frame.type !== "ERROR") return undefined;
            return JSON.stringify(frame).match(/"code":"([A-Z_]+)"/)?.[1] ?? "ERROR";
        },
        "MCP update_row": async (who, values) => {
            const tool = MCP_TOOLS.find(candidate => candidate.name === "update_row");
            if (!tool) throw new Error("no update_row tool");
            const caller = callers[who];
            try {
                await tool.run({ table: "docs", id: "1", data: values }, {
                    driver: backend.driver,
                    tables: backend.getTableDescriptors(),
                    caller: { uid: caller.uid, roles: caller.roles, scopes: ["data:read", "data:write"], clientId: "sec-fix-3" }
                });
                return undefined;
            } catch (error) {
                return mcpCode(error);
            }
        }
    };

    describe.each(Object.keys(doors))("%s", (door) => {
        it.each([
            ["reviewerId", "reviewer", "VALIDATION_EXCLUDED_FIELDS"],
            ["informantId", "informant", "VALIDATION_EXCLUDED_FIELDS"],
            ["approverId", "approver", "FIELD_NOT_WRITABLE"]
        ])("refuses the link as it refuses its key column %s (D-1)", async (column, link, code) => {
            const before = await docRow();
            expect(await doors[door]("editor", { [column]: "victim" })).toBe(code);
            expect(await doors[door]("editor", { [link]: "victim" })).toBe(code);
            expect(await docRow()).toEqual(before);
        });

        it("ignores a create stamp by either spelling: the row is not reattributed", async () => {
            expect(await doors[door]("editor", { createdBy: "victim" })).toBeUndefined();
            expect(await doors[door]("editor", { creator: "victim" })).toBeUndefined();
            expect((await docRow()).created_by).toBe("author");
        });
    });

    it("a caller the key's access.write admits writes the link", async () => {
        expect(await doors["REST PATCH"]("moderator", { approver: "r2" })).toBeUndefined();
        expect((await docRow()).approver_id).toBe("r2");
        expect(await doors["REST PATCH"]("moderator", { approver: "r1" })).toBeUndefined();
        expect((await docRow()).approver_id).toBe("r1");
    });

    /** The in-process SDK on a caller-scoped driver (a hook's `context.data`), as `who`. */
    async function sdkWrite(who: keyof typeof callers, path: string, id: number, values: Row): Promise<string | undefined> {
        const driver = backend.driver;
        if (!(driver instanceof PostgresBackendDriver)) throw new Error("not postgres");
        const caller = callers[who];
        const scoped = await driver.withAuth(testUser(caller.uid, caller.roles, { claims: caller.claims }));
        try {
            await scoped.data.table(path).update(id, values);
            return undefined;
        } catch (error) {
            return errorCode(error) ?? (error instanceof Error ? error.message : String(error));
        }
    }

    describe("the in-process SDK as the caller: a link name ≡ its key column, rule by rule", () => {
        it.each([
            [".readOnly()", "reviewerId", "reviewer", "reviewer_id"],
            ["access.write", "approverId", "approver", "approver_id"],
            [".private()", "informantId", "informant", "informant_id"]
        ])("%s is an API-boundary rule, not the SDK's: both spellings write, alike", async (_rule, column, link, sql) => {
            expect(await sdkWrite("editor", "docs", 1, { [column]: "r2" })).toBeUndefined();
            expect((await docRow())[sql]).toBe("r2");
            expect(await sdkWrite("editor", "docs", 1, { [link]: "r1" })).toBeUndefined();
            expect((await docRow())[sql]).toBe("r1");
        });

        it("an update drops a create stamp by either spelling", async () => {
            expect(await sdkWrite("editor", "docs", 1, { createdBy: "victim" })).toBeUndefined();
            expect(await sdkWrite("editor", "docs", 1, { creator: "victim" })).toBeUndefined();
            expect((await docRow()).created_by).toBe("author");
        });

        it("the tenant stays by either spelling", async () => {
            expect(await sdkWrite("editor", "memos", 1, { orgId: "b" })).toBe("TENANT_IMMUTABLE");
            expect(await sdkWrite("editor", "memos", 1, { org: "b" })).toBe("TENANT_IMMUTABLE");
            expect((await admin.query("SELECT org_id FROM memos WHERE id = 1")).rows[0].org_id).toBe("a");
        });
    });

    it("REST POST and bulk POST refuse a closed key by its link", async () => {
        for (const answer of [
            await request("editor", "POST", "/docs", { title: "new", reviewer: "victim" }),
            await request("editor", "POST", "/docs/bulk", { rows: [{ title: "new", reviewer: "victim" }] })
        ]) {
            expect(answer.status, answer.text).toBe(400);
            expect(codeOf(answer.text)).toBe("VALIDATION_EXCLUDED_FIELDS");
        }
        expect((await admin.query("SELECT count(*)::int AS n FROM docs WHERE reviewer_id = 'victim'")).rows[0].n).toBe(0);
    });

    it("a tenant written by its link is the tenant: TENANT_IMMUTABLE, as by the column (was a 500 from the trigger)", async () => {
        for (const values of [{ orgId: "b" }, { org: "b" }]) {
            const answer = await patch("editor", "/memos/1", values);
            expect(answer.status, answer.text).toBe(400);
            expect(codeOf(answer.text)).toBe("TENANT_IMMUTABLE");
        }
        expect((await admin.query("SELECT org_id FROM memos WHERE id = 1")).rows[0].org_id).toBe("a");
    });

    it("a to-one `via` cannot move target rows whose key is `.readOnly()` — REST, socket and MCP (D-3)", async () => {
        const badgesNow = async () => (await admin.query("SELECT id, owner_id FROM badges ORDER BY id")).rows;
        const before = await badgesNow();
        const direct = await patch("editor", "/badges/2", { ownerId: 1 });
        expect(codeOf(direct.text)).toBe("VALIDATION_EXCLUDED_FIELDS");
        const viaRest = await patch("editor", "/owners/1", { badge: 3 });
        expect(viaRest.status, viaRest.text).toBe(400);
        expect(codeOf(viaRest.text)).toBe("VALIDATION_EXCLUDED_FIELDS");
        const send = await openSocket("editor");
        const frame = await send("SAVE", "via", { path: "owners", id: "1", status: "existing", values: { badge: 3 } });
        expect(JSON.stringify(frame)).toContain("VALIDATION_EXCLUDED_FIELDS");
        const tool = MCP_TOOLS.find(candidate => candidate.name === "update_row");
        await expect(tool?.run({ table: "owners", id: "1", data: { badge: 3 } }, {
            driver: backend.driver,
            tables: backend.getTableDescriptors(),
            caller: { uid: callers.editor.uid, roles: callers.editor.roles, scopes: ["data:read", "data:write"], clientId: "sec-fix-3" }
        })).rejects.toThrow("Writing 'badge' on 'owners' sets 'ownerId' on the rows of 'badges': 'ownerId' on table 'badges' cannot be written through the API");
        expect(await badgesNow()).toEqual(before);
    });

    it("`_pivot` fields are judged under `strictWrites: false` (D-4)", async () => {
        const grade = await patch("editor", "/loose/1", { labels: [{ id: 1, _pivot: { grade: "A+" } }] });
        expect(codeOf(grade.text)).toBe("FIELD_NOT_WRITABLE");
        const locked = await patch("editor", "/loose/1", { labels: [{ id: 1, _pivot: { locked: "no" } }] });
        expect(codeOf(locked.text)).toBe("VALIDATION_EXCLUDED_FIELDS");
        expect((await admin.query("SELECT count(*)::int AS n FROM labels_loose")).rows[0].n).toBe(0);
        const allowed = await patch("moderator", "/loose/1", { labels: [{ id: 1, _pivot: { grade: "A+" } }] });
        expect(allowed.status, allowed.text).toBe(200);
    });

    describe("history revert (history on)", () => {
        const entries = async (who: keyof typeof callers, path: string): Promise<Row[]> => {
            const answer = await request(who, "GET", `${path}/history`);
            expect(answer.status, answer.text).toBe(200);
            const parsed: unknown = JSON.parse(answer.text);
            const data = typeof parsed === "object" && parsed !== null && "data" in parsed ? parsed.data : undefined;
            return Array.isArray(data) ? data : [];
        };

        it("cannot write back a column the caller may not write", async () => {
            // Two versions with different approvers, written by a caller who may.
            expect((await patch("moderator", "/docs/1", { approverId: "r1", title: "v1" })).status).toBe(200);
            expect((await patch("moderator", "/docs/1", { approverId: "r2", title: "v2" })).status).toBe(200);
            const list = await entries("editor", "/docs/1");
            const v1 = list.find(entry => {
                const values = entry.values;
                return typeof values === "object" && values !== null && "title" in values && values.title === "v1";
            });
            expect(v1, JSON.stringify(list).slice(0, 600)).toBeDefined();
            const reverted = await request("editor", "POST", `/docs/1/history/${String(v1?.id)}/revert`);
            expect(reverted.status, reverted.text).toBe(400);
            expect(codeOf(reverted.text)).toBe("FIELD_NOT_WRITABLE");
            expect((await docRow()).approver_id).toBe("r2");
            // The caller who may write it reverts.
            const allowed = await request("moderator", "POST", `/docs/1/history/${String(v1?.id)}/revert`);
            expect(allowed.status, allowed.text).toBe(200);
            expect((await docRow()).approver_id).toBe("r1");
        });

        it("cannot revive another tenant's row", async () => {
            const created = await request("editorB", "POST", "/memos", { body: "m of b", orgId: "b" });
            expect(created.status, created.text).toBe(201);
            const id = Number(JSON.parse(created.text).id);
            expect((await patch("editorB", `/memos/${id}`, { body: "m of b, edited" })).status).toBe(200);
            const list = await entries("editorB", `/memos/${id}`);
            expect(list.length).toBeGreaterThan(0);
            const answer = await request("editor", "POST", `/memos/${id}/history/${String(list[list.length - 1].id)}/revert`);
            expect(answer.status, answer.text).toBe(404);
            expect((await admin.query(`SELECT body, org_id FROM memos WHERE id = ${id}`)).rows[0]).toEqual({ body: "m of b, edited", org_id: "b" });
        });
    });
});
