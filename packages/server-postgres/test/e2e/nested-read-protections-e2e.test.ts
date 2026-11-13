/**
 * E2E: every read protection holds at include depth 1, 2 and 3, through every
 * read door that takes an `include` (SEC-FIX-2 F-1).
 *
 * ## Why this is pinned
 *
 * `afterRead` masking (a table hook and a column `.transform`) ran one level
 * into an include and stopped: `GET /comments?include=post.author` served the
 * authors' masked columns in clear — on REST, `POST …/query`, the socket's
 * one-shot fetches, subscription frames and the in-process SDK. This file
 * drives each door × each protection × each depth, on the real boot against
 * Postgres with row-level security:
 *
 * - doors: REST list, REST get, `POST …/query`, REST search, socket
 *   `FETCH_COLLECTION` / `FETCH_ONE`, `subscribe_collection` (first frame and the
 *   frame a later change sends), the in-process SDK on a caller-scoped driver;
 * - protections on the deepest table (`people`): a table `afterRead` hook, a
 *   column transform, a private column, a per-field `access.read` (and both on a
 *   storage column, whose key a download is authorized by), soft delete,
 *   tenant scoping (a JWT claim);
 * - depth: `posts?include=author` (1), `comments?include=post.author` (2),
 *   `likes?include=comment.post.author` (3).
 *
 * SEC-FIX-3 adds two protections a link takes from its key column (D-2): a
 * `belongsTo` whose key is `access.read`-restricted (`people.manager`, by
 * `managerId`) is omitted from every include as a relation the caller cannot
 * read is, one level below each depth above (`posts?include=author.manager`
 * …); and the filter / sort / relation-path oracle and the include of a
 * link bound to a private key (`people.handler`, by `handlerId`) are refused
 * on every door exactly as the column itself would be.
 *
 * MCP read tools and history take no `include` (a row of one table, depth 0),
 * so their masking is pinned by `mcp-tools-e2e` and `history-served-as-read`.
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
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { testUser } from "./test-user.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "nested-read-protections-e2e-secret-long-enough-0123456789";
const SERVICE_KEY = "nested-read-protections-e2e-service-key-0123456789abcdef";

const publicRead: RlsPosture = [{ operation: "select", access: "public" }];
const publicAll: RlsPosture = [{ operation: "all", access: "public" }];

/** Who a person's links point at: names that must never reach a caller who cannot read the key. */
const staff = defineTable("staff", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    // The same hidden keys, read from the other side (SEC-FIX-4 R-1).
    relations: {
        managed: rel.hasMany(() => people, { foreignKey: "manager_id" }),
        handled: rel.hasMany(() => people, { foreignKey: "handler_id" })
    },
    rls: publicRead
});

/** The protected table: every protection lives here, at the end of each include. */
const people = defineTable("people", {
    columns: {
        id: col.serial().primaryKey(),
        name: col.text(),
        email: col.text(),
        phone: col.text().transform({ afterRead: ({ value }) => (value == null ? value : "PHONE-MASKED") }),
        salary: col.integer().access({ read: ["hr"] }),
        pin: col.text().private(),
        // A file the caller may not read, and one no caller may: their storage
        // keys are what a download is authorized by, so they must never leak.
        photo: col.storage({ path: "people/photos" }).access({ read: ["hr"] }),
        badge: col.storage({ path: "people/badges" }).private(),
        orgId: col.text(),
        deletedAt: col.timestamp({ withTimezone: true }),
        // A link is exactly as readable as its key (SEC-FIX-3 D-2).
        managerId: col.integer().access({ read: ["hr"] }),
        handlerId: col.integer().private()
    },
    relations: {
        manager: rel.belongsTo(() => staff, { localKey: "manager_id" }),
        handler: rel.belongsTo(() => staff, { localKey: "handler_id" }),
        managerVia: rel.via(() => staff, { cardinality: "one", steps: [{ table: "staff", on: { from: "manager_id", to: "id" } }] })
    },
    hooks: {
        afterRead: ({ values }) => ({ ...values, email: values.email == null ? values.email : "MASKED" })
    },
    softDelete: { field: "deletedAt" },
    tenant: { field: "orgId", from: { claim: "org_id" } },
    rls: publicRead
});

const posts = defineTable("posts", {
    columns: { id: col.serial().primaryKey(), title: col.text() },
    relations: { author: rel.belongsTo(() => people) },
    rls: publicRead
});

const comments = defineTable("comments", {
    columns: { id: col.serial().primaryKey(), body: col.text() },
    relations: { post: rel.belongsTo(() => posts) },
    rls: publicRead
});

const likes = defineTable("likes", {
    columns: { id: col.serial().primaryKey(), note: col.text() },
    relations: { comment: rel.belongsTo(() => comments) },
    rls: publicAll
});

type Row = Record<string, unknown>;
type Frame = {
    type: string;
    requestId?: string;
    subscriptionId?: string;
    rows?: Row[];
    payload?: { rows?: Row[]; row?: Row | null; error?: { code?: string; message?: string } } & Row;
};

const isRow = (value: unknown): value is Row => typeof value === "object" && value !== null && !Array.isArray(value);
/** A list of rows, or one row, as a list; anything else is no rows. */
const asRows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter(isRow) : isRow(value) ? [value] : []);
/** `value[key]` when `value` is a row. */
const at = (value: unknown, key: string): unknown => (isRow(value) ? value[key] : undefined);

/** Values the protections hide: none may appear in any answer, at any depth. */
const HIDDEN = [
    "ada@real.example", "555-0100", "250000", "pin-ada",          // live person: masked / restricted / private
    "people/photos/r4nd_ada.png", "people/badges/r4nd_ada.png",   // live person's restricted and private file keys
    "Bea", "bea@other.example", "pin-bea",                          // another tenant's person
    "Cid", "cid@trash.example", "pin-cid",                          // a soft-deleted person
    "Max-manager", "Hal-handler"                                    // the rows behind a restricted and a private key
];

/** One row per depth, the same chain shape: id 1 → Ada (live), 2 → Bea (other org), 3 → Cid (trashed). */
const DEPTHS = [
    { depth: 1, path: "posts", include: "author", authorOf: (row: Row) => row.author },
    { depth: 2, path: "comments", include: "post.author", authorOf: (row: Row) => at(row.post, "author") },
    { depth: 3, path: "likes", include: "comment.post.author", authorOf: (row: Row) => at(at(row.comment, "post"), "author") }
] as const;

/**
 * The same chains with a person's link as the last hop: the link is at depth
 * 1, 2 and 3 (`people?include=manager`, `posts?include=author.manager`,
 * `comments?include=post.author.manager`). `personOf` reaches the person the
 * link hangs off.
 */
const LINK_DEPTHS = [
    { depth: 1, path: "people", through: "", personOf: (row: Row) => row },
    { depth: 2, path: "posts", through: "author.", personOf: (row: Row) => row.author },
    { depth: 3, path: "comments", through: "post.author.", personOf: (row: Row) => at(row.post, "author") }
] as const;

/** What the caller (org "a", role editor) must see of each chain's person. */
function expectProtected(rows: Row[], authorOf: (row: Row) => unknown, label: string): void {
    const byId = new Map(rows.map(row => [Number(row.id), row]));
    const ada = authorOf(byId.get(1) ?? {});
    expect(ada, `${label}: Ada is reached`).toMatchObject({ name: "Ada", email: "MASKED", phone: "PHONE-MASKED" });
    expect(ada, `${label}: access.read`).not.toHaveProperty("salary");
    expect(ada, `${label}: private`).not.toHaveProperty("pin");
    expect(ada, `${label}: restricted file`).not.toHaveProperty("photo");
    expect(ada, `${label}: private file`).not.toHaveProperty("badge");
    expect(ada, `${label}: a restricted key`).not.toHaveProperty("managerId");
    expect(ada, `${label}: a private key`).not.toHaveProperty("handlerId");
    if (byId.has(2)) expect(authorOf(byId.get(2) ?? {}) ?? null, `${label}: tenant`).toBeNull();
    if (byId.has(3)) expect(authorOf(byId.get(3) ?? {}) ?? null, `${label}: soft delete`).toBeNull();
    const text = JSON.stringify(rows);
    expect(HIDDEN.filter(value => text.includes(value)), `${label}: nothing hidden leaks`).toEqual([]);
}

describe("read protections at include depth 1, 2 and 3, on every door (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const server = createServer();
    const sockets: NodeWebSocket[] = [];
    const caller = { uid: "", token: "", roles: ["editor"], claims: { org_id: "a" } };
    const hr = { uid: "", token: "", roles: ["hr"], claims: { org_id: "a" } };

    /** A request as `who`: its status and body, whatever they are. */
    async function answer(path: string, init: { method?: string; body?: unknown; as?: typeof caller } = {}): Promise<{ status: number; text: string }> {
        const response = await app.request(`/api/data${path}`, {
            method: init.method ?? "GET",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${(init.as ?? caller).token}` },
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        return { status: response.status, text: await response.text() };
    }

    async function call(path: string, init: { method?: string; body?: unknown } = {}): Promise<Row> {
        const { status, text } = await answer(path, init);
        if (status !== 200) throw new Error(`${path} answered ${status}: ${text.slice(0, 500)}`);
        const parsed: unknown = JSON.parse(text);
        if (!isRow(parsed)) throw new Error(`${path} answered ${text.slice(0, 200)}`);
        return parsed;
    }

    async function openSocket(who: typeof caller = caller) {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => { ws.once("open", () => resolve()); ws.once("error", reject); });
        const frames = new Map<string, Frame[]>();
        const waiters = new Map<string, { count: number; resolve: (frames: Frame[]) => void }>();
        ws.on("message", (data) => {
            const frame: Frame = JSON.parse(String(data));
            const key = frame.requestId ?? frame.subscriptionId;
            if (!key) return;
            const list = [...(frames.get(key) ?? []), frame];
            frames.set(key, list);
            const waiter = waiters.get(key);
            if (waiter && list.length >= waiter.count) { waiters.delete(key); waiter.resolve(list); }
        });
        let seq = 0;
        /** Send a frame; resolve with the first `count` answers under its id. */
        const send = (type: string, payload: Row, count = 1): { key: string; answers: Promise<Frame[]> } => {
            const key = `${type}-${++seq}`;
            const answers = new Promise<Frame[]>((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`No ${count} answer(s) to ${type}: ${JSON.stringify(frames.get(key))?.slice(0, 400)}`)), 8_000);
                waiters.set(key, { count, resolve: (list) => { clearTimeout(timer); resolve(list); } });
            });
            ws.send(JSON.stringify(type.startsWith("subscribe_")
                ? { type, payload: { ...payload, subscriptionId: key } }
                : { type, requestId: key, payload }));
            return { key, answers };
        };
        const [auth] = await send("AUTHENTICATE", { token: who.token }).answers;
        expect(auth.type).toBe("AUTH_SUCCESS");
        return send;
    }

    const rowsOf = (frame: Frame): Row[] => {
        if (frame.type === "ERROR") throw new Error(JSON.stringify(frame.payload?.error));
        const rows = frame.rows ?? frame.payload?.rows;
        if (rows) return rows;
        const row = frame.payload?.row ?? (frame.payload && "id" in frame.payload ? frame.payload : undefined);
        if (!row) throw new Error(`no rows in ${JSON.stringify(frame).slice(0, 400)}`);
        return [row];
    };

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
            app,
            server,
            tables: [staff, people, posts, comments, likes],
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY }
        });
        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("no auth repository");
        const user = await repo.createUser({ email: "editor@nested.test", emailVerified: true });
        await repo.setUserRoles(user.id, caller.roles);
        caller.uid = user.id;
        caller.token = await generateAccessToken(user.id, caller.roles, "aal1", caller.claims);
        const hrUser = await repo.createUser({ email: "hr@nested.test", emailVerified: true });
        await repo.setUserRoles(hrUser.id, hr.roles);
        hr.uid = hrUser.id;
        hr.token = await generateAccessToken(hrUser.id, hr.roles, "aal1", hr.claims);
        await admin.query(`
            INSERT INTO staff (name) VALUES ('Max-manager'), ('Hal-handler');
            INSERT INTO people (name, email, phone, salary, pin, photo, badge, org_id, manager_id, handler_id) VALUES
                ('Ada', 'ada@real.example', '555-0100', 250000, 'pin-ada', 'people/photos/r4nd_ada.png', 'people/badges/r4nd_ada.png', 'a', 1, 2);
            INSERT INTO people (name, email, phone, salary, pin, photo, badge, org_id) VALUES
                ('Bea', 'bea@other.example', '555-0200', 1, 'pin-bea', NULL, NULL, 'b');
            INSERT INTO people (name, email, phone, salary, pin, org_id, deleted_at) VALUES
                ('Cid', 'cid@trash.example', '555-0300', 2, 'pin-cid', 'a', now());
            INSERT INTO posts (title, author_id) VALUES ('p1', 1), ('p2', 2), ('p3', 3);
            INSERT INTO comments (body, post_id) VALUES ('c1', 1), ('c2', 2), ('c3', 3);
            INSERT INTO likes (note, comment_id) VALUES ('l1', 1), ('l2', 2), ('l3', 3);
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

    /** A JSON include tree for `a.b.c`, as `POST …/query` takes it. */
    const includeTree = (dotted: string): Row =>
        dotted.split(".").reduceRight<Row>((inner, key) => ({ [key]: Object.keys(inner).length ? { include: inner } : true }), {});

    for (const { depth, path, include, authorOf } of DEPTHS) {
        describe(`depth ${depth}: ${path}?include=${include}`, () => {
            it("REST list", async () => {
                const body = await call(`/${path}?include=${include}`);
                expectProtected(asRows(body.data), authorOf, "REST list");
            });

            it("REST get, each chain", async () => {
                const rows: Row[] = [];
                for (const id of [1, 2, 3]) rows.push(await call(`/${path}/${id}?include=${include}`));
                expectProtected(rows.map(row => (isRow(row.data) ? row.data : row)), authorOf, "REST get");
            });

            it("POST …/query", async () => {
                const body = await call(`/${path}/query`, { method: "POST", body: { include: includeTree(include) } });
                expectProtected(asRows(body.data), authorOf, "POST query");
            });

            it("REST search", async () => {
                const body = await call(`/${path}?searchString=${depth === 1 ? "p" : depth === 2 ? "c" : "l"}&include=${include}`);
                expectProtected(asRows(body.data), authorOf, "REST search");
            });

            it("socket FETCH_COLLECTION and FETCH_ONE", async () => {
                const send = await openSocket();
                const [list] = await send("FETCH_COLLECTION", { path, include: [include] }).answers;
                expectProtected(rowsOf(list), authorOf, "FETCH_COLLECTION");
                const ones: Row[] = [];
                for (const id of ["1", "2", "3"]) {
                    const [one] = await send("FETCH_ONE", { path, id, include: [include] }).answers;
                    ones.push(...rowsOf(one));
                }
                expectProtected(ones, authorOf, "FETCH_ONE");
            });

            it("subscribe_collection: the first frame and the frame a change sends", async () => {
                const send = await openSocket();
                const subscription = send("subscribe_collection", { path, include: [include] }, 2);
                // Let the first frame land, then change a row of the subscribed table
                // through the API, which notifies the subscription.
                await new Promise(resolve => setTimeout(resolve, 300));
                if (path === "likes") {
                    await call("/likes/1", { method: "PATCH", body: { note: "l1 edited" } });
                } else {
                    // posts / comments are read-only to the caller: change them as the owner and notify.
                    await admin.query(`UPDATE ${path} SET ${path === "posts" ? "title" : "body"} = ${path === "posts" ? "title" : "body"} || '!' WHERE id = 1`);
                    const driver = backend.driver;
                    if (!(driver instanceof PostgresBackendDriver)) throw new Error("not postgres");
                    await driver.realtimeService.notifyUpdate(path, "1", { _rebase_invalidated: true });
                }
                const frames = await subscription.answers;
                expect(frames).toHaveLength(2);
                for (const [index, frame] of frames.entries()) {
                    expect(frame.type, JSON.stringify(frame.payload?.error)).toBe("collection_update");
                    expectProtected(rowsOf(frame), authorOf, `subscription frame ${index}`);
                }
            });

            it("in-process SDK on a caller-scoped driver", async () => {
                const driver = backend.driver;
                if (!(driver instanceof PostgresBackendDriver)) throw new Error("not postgres");
                const scoped = await driver.withAuth(testUser(caller.uid, caller.roles, { claims: caller.claims }));
                const accessor = scoped.data[path];
                if (!accessor) throw new Error(`no SDK accessor for ${path}`);
                const found = await accessor.find({ include: [include] });
                expectProtected(asRows(found.data), authorOf, "SDK find");
                const one = await accessor.findById(1, { include: [include] });
                expectProtected(asRows(one), authorOf, "SDK findById");
            });
        });
    }

    /**
     * The oracle a link opened (SEC-FIX-3 D-2): a filter, a sort or a relation
     * path on a link whose key the caller cannot read answers hit or miss as
     * the key itself would. Each is refused as the column is on that door —
     * `FIELD_NOT_READABLE` for a role-restricted key, the unknown-name answer
     * for a private one — and a caller the key admits is answered.
     */
    describe("a link whose key the caller cannot read is no oracle, on every door", () => {
        const codeOf = (text: string): string | undefined => text.match(/"code":"([A-Z_]+)"/)?.[1];
        const unknownFilterCode = async () => codeOf((await answer("/people?nosuchfield=eq.1")).text);

        it("REST: filters, relation paths and sorts through the link answer as through the key", async () => {
            for (const path of ["/people?managerId=eq.1", "/people?manager=eq.1", "/people?manager.name=eq.Max-manager", "/people?orderBy=manager", "/posts?author.manager=eq.1"]) {
                const refused = await answer(path);
                expect(refused.status, `${path}: ${refused.text}`).toBe(400);
                expect(codeOf(refused.text), path).toBe("FIELD_NOT_READABLE");
            }
            for (const path of ["/people?handlerId=eq.2", "/people?handler=eq.2", "/people?handler.name=eq.Hal-handler"]) {
                const refused = await answer(path);
                expect(refused.status, `${path}: ${refused.text}`).toBe(400);
                expect(codeOf(refused.text), path).toMatch(/^UNKNOWN_/);
                expect(refused.text, path).not.toContain("Hal-handler\"");
            }
            expect(codeOf((await answer("/people?handler=eq.2")).text)).toBe(await unknownFilterCode());
        });

        it("POST …/query refuses the same filters", async () => {
            const restricted = await answer("/people/query", { method: "POST", body: { where: { manager: ["==", 1] } } });
            expect(codeOf(restricted.text), restricted.text).toBe("FIELD_NOT_READABLE");
            const hidden = await answer("/people/query", { method: "POST", body: { where: { handler: ["==", 2] } } });
            expect(hidden.status, hidden.text).toBe(400);
            expect(codeOf(hidden.text)).toMatch(/^UNKNOWN_/);
        });

        it("a caller the key admits filters and includes by the link", async () => {
            const hit = await answer("/people?manager=eq.1", { as: hr });
            expect(hit.status, hit.text).toBe(200);
            expect(hit.text).toContain("Ada");
            const included = await answer("/people/1?include=manager", { as: hr });
            expect(included.text).toContain("Max-manager");
        });

        it("socket FETCH_COLLECTION refuses the filter and the private include", async () => {
            const send = await openSocket();
            const [filtered] = await send("FETCH_COLLECTION", { path: "people", filter: { manager: ["==", 1] } }).answers;
            expect(filtered.type).toBe("ERROR");
            expect(JSON.stringify(filtered)).toContain("FIELD_NOT_READABLE");
            const [included] = await send("FETCH_COLLECTION", { path: "posts", include: ["author.handler"] }).answers;
            expect(included.type).toBe("ERROR");
            expect(JSON.stringify(included)).not.toContain("Hal-handler");
        });

        it("the in-process SDK on a caller-scoped driver refuses them too", async () => {
            const driver = backend.driver;
            if (!(driver instanceof PostgresBackendDriver)) throw new Error("not postgres");
            const scoped = await driver.withAuth(testUser(caller.uid, caller.roles, { claims: caller.claims }));
            // The SDK takes no filter on a link's name at all (an unknown
            // field for every caller); refused either way, it answers nothing.
            await expect(scoped.data.table("people").find({ where: { manager: ["==", 1] } })).rejects.toMatchObject({ code: expect.stringMatching(/^(FIELD_NOT_READABLE|UNKNOWN_FILTER_FIELD)$/) });
            await expect(scoped.data.table("people").find({ where: { managerId: ["==", 1] } })).rejects.toMatchObject({ code: "FIELD_NOT_READABLE" });
            await expect(scoped.data.table("posts").find({ where: { "author.manager": ["==", 1] } })).rejects.toMatchObject({ code: expect.stringMatching(/^(FIELD_NOT_READABLE|UNKNOWN_FILTER_FIELD)$/) });
            await expect(scoped.data.table("posts").find({ include: ["author.handler"] })).rejects.toMatchObject({ code: "UNKNOWN_RELATION" });
        });
    });

    /**
     * A link whose key the caller cannot read, at include depth 1, 2 and 3 —
     * omitted as a relation the caller cannot read is (role-restricted key),
     * or answered as an unknown relation (private key) — on every door that
     * takes an include.
     */
    for (const { depth, path, through, personOf } of LINK_DEPTHS) {
        describe(`a link whose key is closed, at depth ${depth}: ${path}?include=${through}manager`, () => {
            const include = `${through}manager`;
            const expectOmitted = (rows: Row[], label: string): void => {
                const ada = rows.map(personOf).find(person => at(person, "name") === "Ada");
                expect(ada, `${label}: Ada is reached`).toBeDefined();
                expect(ada, `${label}: the link`).not.toHaveProperty("manager");
                expect(ada, `${label}: its key`).not.toHaveProperty("managerId");
                expect(JSON.stringify(rows), `${label}: nothing behind it leaks`).not.toContain("Max-manager");
            };

            it("REST list, REST get and POST …/query omit it", async () => {
                expectOmitted(asRows((await call(`/${path}?include=${include}`)).data), "REST list");
                const one = await call(`/${path}/1?include=${include}`);
                expectOmitted([isRow(one.data) ? one.data : one], "REST get");
                expectOmitted(asRows((await call(`/${path}/query`, { method: "POST", body: { include: includeTree(include) } })).data), "POST query");
            });

            it("socket FETCH_COLLECTION and the first subscription frame omit it", async () => {
                const send = await openSocket();
                const [list] = await send("FETCH_COLLECTION", { path, include: [include] }).answers;
                expectOmitted(rowsOf(list), "FETCH_COLLECTION");
                const [first] = await send("subscribe_collection", { path, include: [include] }).answers;
                expectOmitted(rowsOf(first), "subscription");
            });

            it("the in-process SDK omits it", async () => {
                const driver = backend.driver;
                if (!(driver instanceof PostgresBackendDriver)) throw new Error("not postgres");
                const scoped = await driver.withAuth(testUser(caller.uid, caller.roles, { claims: caller.claims }));
                expectOmitted(asRows((await scoped.data.table(path).find({ include: [include] })).data), "SDK find");
            });

            it("an include of the link bound to a private key is an unknown relation (REST, POST …/query)", async () => {
                const privateInclude = `${through}handler`;
                const codeOf = (text: string): string | undefined => text.match(/"code":"([A-Z_]+)"/)?.[1];
                const rest = await answer(`/${path}?include=${privateInclude}`);
                expect(rest.status, rest.text).toBe(400);
                expect(codeOf(rest.text)).toBe("UNKNOWN_RELATION");
                const query = await answer(`/${path}/query`, { method: "POST", body: { include: includeTree(privateInclude) } });
                expect(query.status, query.text).toBe(400);
                expect(codeOf(query.text)).toBe("UNKNOWN_RELATION");
            });
        });
    }

    /**
     * SEC-FIX-4 R-1: the same hidden keys read from the other side — a
     * `hasMany` whose foreign key is `managerId` / `handlerId`, a `via` joined
     * on `manager_id` — answer as the `belongsTo` does, on every door, and the
     * schema does not describe them to a caller who cannot read the key.
     */
    describe("a relation joined on a hidden key, from the other side", () => {
        const codeOf = (text: string): string | undefined => text.match(/"code":"([A-Z_]+)"/)?.[1];
        const sdkAs = async (who: typeof caller) => {
            const driver = backend.driver;
            if (!(driver instanceof PostgresBackendDriver)) throw new Error("not postgres");
            return (await driver.withAuth(testUser(who.uid, who.roles, { claims: who.claims }))).data;
        };

        it("REST and POST …/query: the inverse is omitted from an include and refused in a filter; the private one is unknown", async () => {
            const listed = await call("/staff?include=managed");
            expect(JSON.stringify(listed)).not.toContain("Ada");
            for (const row of asRows(listed.data)) expect(row).not.toHaveProperty("managed");
            const queried = await call("/staff/query", { method: "POST", body: { include: { managed: { count: true } } } });
            expect(JSON.stringify(queried)).not.toContain("Ada");
            expect(JSON.stringify(queried)).not.toContain("\"managed\"");
            const filtered = await answer("/staff?managed.name=eq.Ada");
            expect(filtered.status, filtered.text).toBe(400);
            expect(codeOf(filtered.text)).toBe("FIELD_NOT_READABLE");
            const hidden = await answer("/staff?include=handled");
            expect(hidden.status, hidden.text).toBe(400);
            expect(codeOf(hidden.text)).toBe("UNKNOWN_RELATION");
            const viaInclude = await call("/people?include=managerVia");
            expect(JSON.stringify(viaInclude)).not.toContain("Max-manager");
        });

        it("a caller the key admits is served the inverse", async () => {
            const served = await answer("/staff?include=managed", { as: hr });
            expect(served.text).toContain("Ada");
            const filtered = await answer("/staff?managed.name=eq.Ada", { as: hr });
            expect(filtered.status, filtered.text).toBe(200);
            expect(filtered.text).toContain("Max-manager");
        });

        it("socket FETCH_COLLECTION, the first subscription frame and the SDK omit or refuse it", async () => {
            const send = await openSocket();
            const [list] = await send("FETCH_COLLECTION", { path: "staff", include: ["managed"] }).answers;
            expect(JSON.stringify(list)).not.toContain("Ada");
            const [first] = await send("subscribe_collection", { path: "staff", include: ["managed"] }).answers;
            expect(JSON.stringify(first)).not.toContain("Ada");
            const [filtered] = await send("FETCH_COLLECTION", { path: "staff", filter: { "managed.name": ["==", "Ada"] } }).answers;
            expect(filtered.type).toBe("ERROR");
            expect(JSON.stringify(filtered)).toContain("FIELD_NOT_READABLE");
            const data = await sdkAs(caller);
            expect(JSON.stringify((await data.table("staff").find({ include: ["managed"] })).data)).not.toContain("Ada");
            await expect(data.table("staff").find({ where: { "managed.name": ["==", "Ada"] } })).rejects.toMatchObject({ code: "FIELD_NOT_READABLE" });
        });

        it("GET /schema/tables does not describe it to the caller who cannot read the key", async () => {
            const described = async (who: typeof caller) => {
                const response = await app.request("/api/schema/tables/staff", { headers: { Authorization: `Bearer ${who.token}` } });
                const text = await response.text();
                expect(response.status, text).toBe(200);
                return text;
            };
            const forEditor = await described(caller);
            expect(forEditor).not.toContain("\"managed\"");
            expect(forEditor).not.toContain("\"handled\"");
            expect(await described(hr)).toContain("\"managed\"");
        });
    });
});
