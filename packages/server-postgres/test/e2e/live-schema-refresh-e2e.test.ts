/**
 * E2E: what a live schema apply adds is served by the Postgres driver at once,
 * without a restart.
 *
 * The apply (`POST /api/admin/schema/apply`) rewrites `backend/schema`,
 * commits, runs the DDL and the policies, and swaps what the server serves.
 * The server's half (descriptors, REST routes, `GET /api/schema/tables`) was
 * swapped already; the driver kept the drizzle tables it read from
 * `information_schema` at boot, and the registry it built over them, so a
 * table the apply created answered "table not found" — and a column it added
 * was never read — until the process restarted. `refreshTables` on the
 * driver reads the edited tables back, provisions change capture and grants
 * for a new table, and swaps registry and relational schema in one step.
 *
 * Driven through what the server mounts — the real boot over the real driver,
 * the built-in auth, the data routes, the realtime socket — against Postgres:
 * a new table with an `afterRead` hook, a relation to an existing table and a
 * many-to-many to another; a new column on an existing table; a rule change.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import pg from "pg";
import { Hono } from "hono";
import type { TablePatch } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { TableSourceEditor } from "../../../server/src/api/table-source-editor.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "live-schema-refresh-e2e-secret-long-enough-0123456789";
const SERVICE_KEY = "live-schema-refresh-e2e-service-key-0123456789abcdef";

/** The schema the server boots with: two related tables and a third to link to. */
const SCHEMA: Record<string, string> = {
    "index.ts": [
        "export { authors } from \"./authors\";",
        "export { posts } from \"./posts\";",
        "export { tags } from \"./tags\";",
        ""
    ].join("\n"),
    "authors.ts": [
        "import { defineTable, col, rel } from \"@rebasepro/types\";",
        "import { posts } from \"./posts\";",
        "",
        "export const authors = defineTable(\"authors\", {",
        "    columns: { id: col.serial().primaryKey(), name: col.text() },",
        "    relations: { posts: rel.hasMany(() => posts, { foreignKey: \"author_id\" }) },",
        "    rls: \"admin-only\"",
        "});",
        ""
    ].join("\n"),
    "posts.ts": [
        "import { defineTable, col, rel } from \"@rebasepro/types\";",
        "import { authors } from \"./authors\";",
        "",
        "export const posts = defineTable(\"posts\", {",
        "    columns: { id: col.serial().primaryKey(), title: col.text() },",
        "    relations: { author: rel.belongsTo(() => authors, { localKey: \"author_id\" }) },",
        "    rls: \"admin-only\"",
        "});",
        ""
    ].join("\n"),
    "tags.ts": [
        "import { defineTable, col } from \"@rebasepro/types\";",
        "",
        "export const tags = defineTable(\"tags\", {",
        "    columns: { id: col.serial().primaryKey(), label: col.text() },",
        "    rls: \"admin-only\"",
        "});",
        ""
    ].join("\n")
};

/** The table written by hand — hooks are code, which no schema edit carries — and served by the next apply. */
const NOTES = [
    "import { defineTable, col, rel } from \"@rebasepro/types\";",
    "import { posts } from \"./posts\";",
    "import { tags } from \"./tags\";",
    "",
    "export const notes = defineTable(\"notes\", {",
    "    columns: { id: col.serial().primaryKey(), body: col.text() },",
    "    relations: {",
    "        post: rel.belongsTo(() => posts, { localKey: \"post_id\" }),",
    "        tags: rel.manyToMany(() => tags)",
    "    },",
    "    rls: \"admin-only\",",
    "    hooks: {",
    "        afterRead: ({ values }) => ({ ...values, body: \"[masked]\" })",
    "    }",
    "});",
    ""
].join("\n");

type Row = Record<string, unknown>;
type Frame = { type: string; subscriptionId?: string; rows?: Row[]; payload?: { rows?: Row[] } };

describe("a live schema apply is served by the Postgres driver without a restart (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let root: string;
    let schemaDir: string;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>> | undefined;
    const app = new Hono<HonoEnv>();
    const server = createServer();
    const sockets: NodeWebSocket[] = [];
    const originalNodeEnv = process.env.NODE_ENV;
    const callers = { admin: { uid: "", token: "" }, reader: { uid: "", token: "" } };

    const git = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" }).toString().trim();
    const commitAll = (message: string) => {
        git("add", "-A");
        git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", message);
    };

    async function request(who: keyof typeof callers, url: string, init: { method?: string; body?: unknown } = {}) {
        const response = await app.request(url, {
            method: init.method ?? "GET",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${callers[who].token}` },
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        const text = await response.text();
        let body: Row = {};
        try {
            body = JSON.parse(text) as Row;
        } catch {
            body = { text };
        }
        return { status: response.status, body };
    }

    async function apply(patches: TablePatch[]) {
        const res = await request("admin", "/api/admin/schema/apply", { method: "POST", body: { patches } });
        if (res.status !== 200) throw new Error(`apply answered ${res.status}: ${JSON.stringify(res.body).slice(0, 800)}`);
        return res.body;
    }

    /** A signed-in socket, every frame it receives kept in order. */
    async function openSocket(who: keyof typeof callers) {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        sockets.push(ws);
        const frames: Frame[] = [];
        ws.on("message", (data) => frames.push(JSON.parse(String(data)) as Frame));
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        const waitFor = async (predicate: (frame: Frame) => boolean, what: string): Promise<Frame> => {
            for (let i = 0; i < 200; i++) {
                const found = frames.find(predicate);
                if (found) return found;
                await new Promise(r => setTimeout(r, 50));
            }
            throw new Error(`No ${what}; frames: ${JSON.stringify(frames).slice(0, 800)}`);
        };
        ws.send(JSON.stringify({ type: "AUTHENTICATE", requestId: "auth", payload: { token: callers[who].token } }));
        await waitFor(frame => frame.type === "AUTH_SUCCESS", "AUTH_SUCCESS");
        return { ws, frames, waitFor };
    }

    const rowsOf = (frame: Frame): Row[] => frame.rows ?? frame.payload?.rows ?? [];

    beforeAll(async () => {
        process.env.NODE_ENV = "development";
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

        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "live-schema-refresh-")));
        schemaDir = path.join(root, "backend", "schema");
        fs.mkdirSync(schemaDir, { recursive: true });
        for (const [name, text] of Object.entries(SCHEMA)) fs.writeFileSync(path.join(schemaDir, name), text);
        fs.writeFileSync(path.join(root, "rebase.json"), "{}\n");
        git("init", "-q");
        commitAll("init");

        connection = createPostgresDatabaseConnection(container.connectionString);
        backend = await initializeRebaseBackend({
            app,
            server,
            schemaDir,
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY }
        });
        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        for (const [who, roles] of [["admin", ["admin"]], ["reader", []]] as const) {
            const user = await repo.createUser({ email: `${who}@live-schema-refresh.test`, emailVerified: true });
            await repo.setUserRoles(user.id, [...roles]);
            callers[who].uid = user.id;
            callers[who].token = await generateAccessToken(user.id, [...roles]);
        }

        await admin.query(`
            INSERT INTO authors (name) VALUES ('Ada');
            INSERT INTO posts (title, author_id) VALUES ('First', 1);
            INSERT INTO tags (label) VALUES ('urgent');
        `);
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    }, 180_000);

    afterAll(async () => {
        for (const ws of sockets) ws.terminate();
        await backend?.shutdown(1_000).catch(() => {});
        process.env.NODE_ENV = originalNodeEnv;
        _resetRebaseMock();
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (root) fs.rmSync(root, { recursive: true, force: true });
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("serves a new table — its hook, its relations, its change capture — as soon as the apply returns", async () => {
        expect((await request("admin", "/api/data/notes")).status).toBe(404);

        fs.writeFileSync(path.join(schemaDir, "notes.ts"), NOTES);
        fs.appendFileSync(path.join(schemaDir, "index.ts"), "export { notes } from \"./notes\";\n");
        commitAll("notes, written by hand");

        const applied = await apply([{ op: "setOption", table: "notes", option: "description", value: "Notes, masked on the way out." }]);
        expect(applied).toMatchObject({ applied: true, serving: { status: "now" } });
        expect(String(applied.summary)).toContain("serves it now");

        // A socket subscribed before the first row: capture was attached to the new table.
        const socket = await openSocket("admin");
        socket.ws.send(JSON.stringify({ type: "subscribe_collection", payload: { path: "notes", subscriptionId: "notes-live" } }));
        await socket.waitFor(frame => frame.type === "collection_update" && frame.subscriptionId === "notes-live", "initial notes frame");

        // REST create and read, the hook masking.
        const created = await request("admin", "/api/data/notes", { method: "POST", body: { body: "the secret", post: 1 } });
        expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
        const listed = await request("admin", "/api/data/notes");
        expect(listed.status, JSON.stringify(listed.body)).toBe(200);
        const rows = listed.body.data as Row[];
        expect(rows).toHaveLength(1);
        expect(rows[0].body).toBe("[masked]");
        const noteId = rows[0].id;
        const one = await request("admin", `/api/data/notes/${noteId}`);
        expect(one.body.body).toBe("[masked]");

        // An include across the new belongsTo, and across the new junction.
        await admin.query(`INSERT INTO notes_tags (note_id, tag_id) VALUES (${Number(noteId)}, 1)`);
        const included = await request("admin", `/api/data/notes/${noteId}?include=post,tags`);
        expect(included.status, JSON.stringify(included.body)).toBe(200);
        expect(included.body.post).toMatchObject({ id: 1, title: "First" });
        expect(included.body.tags).toEqual([expect.objectContaining({ id: 1, label: "urgent" })]);

        // A write made outside the API reaches the subscriber: change capture.
        await admin.query("INSERT INTO notes (body) VALUES ('written in psql')");
        const changed = await socket.waitFor(
            frame => frame.subscriptionId === "notes-live" && rowsOf(frame).length === 2,
            "notes frame carrying the psql row"
        );
        expect(rowsOf(changed).map(row => row.body)).toEqual(["[masked]", "[masked]"]);

        // And the schema the server describes lists it.
        const described = await request("admin", "/api/schema/tables");
        expect(JSON.stringify(described.body)).toContain("\"slug\":\"notes\"");
    }, 120_000);

    it("reads and writes a column added to an existing table", async () => {
        const applied = await apply([{ op: "addColumn", table: "posts", key: "subtitle", column: { type: { kind: "text" } } }]);
        expect(applied).toMatchObject({ applied: true, serving: { status: "now" } });

        const saved = await request("admin", "/api/data/posts/1", { method: "PATCH", body: { subtitle: "A second line" } });
        expect(saved.status, JSON.stringify(saved.body)).toBe(200);
        const read = await request("admin", "/api/data/posts/1");
        expect(read.body).toMatchObject({ id: 1, title: "First", subtitle: "A second line" });
        // The include from the earlier table still resolves over the refreshed one.
        const viaNote = await request("admin", "/api/data/notes?include=post");
        expect((viaNote.body.data as Row[]).find(row => row.post)?.post).toMatchObject({ subtitle: "A second line" });
    }, 60_000);

    it("enforces and serves a rule change", async () => {
        expect((await request("reader", "/api/data/posts")).body.data ?? []).toEqual([]);
        const applied = await apply([{ op: "setRls", table: "posts", rls: [{ operation: "select", access: "public" }] }]);
        expect(applied).toMatchObject({ applied: true, policies: { status: "applied" }, serving: { status: "now" } });

        const read = await request("reader", "/api/data/posts");
        expect(read.status, JSON.stringify(read.body)).toBe(200);
        expect((read.body.data as Row[]).map(row => row.title)).toEqual(["First"]);
    }, 60_000);

    it("plans nothing on the next boot", async () => {
        const edited = await new TableSourceEditor(schemaDir).compileCurrent();
        expect(edited.tables.map(table => table.descriptor.slug).sort()).toEqual(["authors", "notes", "posts", "tags"]);
        const adapter = createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString });
        const planned: string[] = [];
        const outcome = await adapter.ensureTableSchema!(edited.tables, undefined, (message) => planned.push(message));
        expect(outcome.applied, planned.join("\n")).toBe(0);
    }, 60_000);
});
