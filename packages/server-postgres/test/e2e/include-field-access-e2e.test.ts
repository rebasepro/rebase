/**
 * E2E: a relation property the caller may not read is never embedded by an
 * `include`, nor counted — through every door that takes one.
 *
 * ## Why this is pinned
 *
 * Field access (`access.read`) withholds a property's value from a caller who
 * lacks the role. For a relation property the value is the related rows, and an
 * `include` is the way to ask for them. The row strip deletes a withheld key —
 * but the REST pipeline strips each row *before* the include loader runs
 * (`toRestRow`, then `loadIncludes`), so the loader wrote the related rows back
 * onto the key the strip had just removed. The REST check of an include
 * (`assertIncludeFieldsReadable`) judges the *target's* fields an include
 * filters or sorts on, never the relation property itself. So
 * `?include=members` handed a caller without `hr` every member of every
 * department, and `{ members: { count: true } }` how many.
 *
 * Every door is driven here through what the server mounts — the real boot, the
 * built-in auth, the data router's middleware, the realtime socket the boot
 * attaches, the in-process SDK on a request-scoped driver — against Postgres
 * with row-level security. Each case is asked twice: as a caller holding the
 * role (the relation is there — the harness can see it) and as one without it
 * (the relation is absent, and so is its total).
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import pg from "pg";
import { Hono } from "hono";
import type { CollectionConfig, DataDriver, User } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "include-field-access-e2e-secret-long-enough-0123456789";
const SERVICE_KEY = "include-field-access-e2e-service-key-0123456789abcdef";

const readable = [{ operation: "select" as const, access: "public" as const }];

const people = {
    name: "People", slug: "people", table: "people",
    securityRules: readable,
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

const tags = {
    name: "Tags", slug: "tags", table: "tags",
    securityRules: readable,
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" }
    }
} as unknown as CollectionConfig;

const staff: CollectionConfig = {
    name: "Staff", slug: "staff", table: "staff",
    securityRules: readable,
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        department: {
            name: "Department", type: "relation",
            relation: { kind: "belongsTo", target: () => departments, localKey: "department_id" }
        }
    }
} as unknown as CollectionConfig;

/**
 * One relation of each shape withheld from everyone without `hr`, and one
 * readable relation beside them as the control.
 */
const departments: CollectionConfig = {
    name: "Departments", slug: "departments", table: "departments",
    securityRules: readable,
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        lead: {
            name: "Lead", type: "relation",
            relation: { kind: "belongsTo", target: () => people, localKey: "lead_id" }
        },
        head: {
            name: "Head", type: "relation", access: { read: ["hr"] },
            relation: { kind: "belongsTo", target: () => people, localKey: "head_id" }
        },
        members: {
            name: "Members", type: "relation", access: { read: ["hr"] },
            relation: { kind: "hasMany", target: () => staff, foreignKeyOnTarget: "department_id" }
        },
        tags: {
            name: "Tags", type: "relation", access: { read: ["hr"] },
            relation: {
                kind: "manyToMany", target: () => tags,
                through: { table: "departments_tags", sourceColumn: "department_id", targetColumn: "tag_id" }
            }
        }
    }
} as unknown as CollectionConfig;

const ALL = [people, tags, departments, staff];

/** The relations a caller without `hr` must never be handed. */
const WITHHELD = ["head", "members", "tags"] as const;

type Row = Record<string, unknown>;

type Frame = {
    type: string;
    requestId?: string;
    subscriptionId?: string;
    payload?: { rows?: Row[]; error?: { code?: string; message?: string } };
    rows?: Row[];
};

describe("an include never embeds or counts a relation the caller may not read (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const server = createServer();
    const sockets: NodeWebSocket[] = [];
    const originalNodeEnv = process.env.NODE_ENV;

    const caller = {
        hr: { uid: "", token: "", roles: ["hr"] },
        plain: { uid: "", token: "", roles: ["editor"] }
    };
    type Who = keyof typeof caller;

    async function call(who: Who, path: string, init: { method?: string; body?: unknown } = {}) {
        const response = await app.request(`/api/data${path}`, {
            method: init.method ?? "GET",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${caller[who].token}` },
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        const text = await response.text();
        if (response.status !== 200) throw new Error(`${path} answered ${response.status}: ${text.slice(0, 500)}`);
        return JSON.parse(text) as { data?: Row[] } & Row;
    }

    async function openSocket(who: Who) {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        const waiters = new Map<string, (frame: Frame) => void>();
        ws.on("message", (data) => {
            const frame = JSON.parse(String(data)) as Frame;
            const key = frame.requestId ?? frame.subscriptionId;
            const waiter = key && waiters.get(key);
            if (waiter) {
                waiters.delete(key);
                waiter(frame);
            }
        });
        let seq = 0;
        const send = (type: string, payload: Row): Promise<Frame> => new Promise((resolve, reject) => {
            const key = `${type}-${++seq}`;
            const timer = setTimeout(() => reject(new Error(`No answer to ${type}`)), 5_000);
            waiters.set(key, (frame) => {
                clearTimeout(timer);
                resolve(frame);
            });
            ws.send(JSON.stringify(type.startsWith("subscribe_")
                ? { type, payload: { ...payload, subscriptionId: key } }
                : { type, requestId: key, payload }));
        });
        const auth = await send("AUTHENTICATE", { token: caller[who].token });
        expect(auth.type).toBe("AUTH_SUCCESS");
        return send;
    }

    /**
     * The in-process SDK on a driver scoped to the caller, as a function or a
     * hook gets it. It serves flat rows, as the HTTP API does.
     */
    async function sdk(who: Who) {
        const driver = backend.driver as DataDriver & { withAuth(user: User): Promise<DataDriver> };
        const scoped = await driver.withAuth({ uid: caller[who].uid, roles: caller[who].roles } as unknown as User);
        const data = (scoped as unknown as { data: Record<string, {
            find(params: Row): Promise<{ data: Row[] }>;
        }> }).data;
        return data.departments;
    }

    /** The first department, as each door shapes it. */
    const first = (rows: Row[] | undefined): Row => {
        const row = rows?.find(r => Number(r.id) === 1);
        if (!row) throw new Error(`department 1 not in ${JSON.stringify(rows)?.slice(0, 300)}`);
        return row;
    };

    /**
     * The caller holding `hr` is handed every relation; the one without it
     * none of the withheld ones — no rows, no total — and still the readable
     * `lead` beside them.
     */
    function expectWithheld(row: Row, { lead = true }: { lead?: boolean } = {}): void {
        for (const key of WITHHELD) expect(row, `'${key}' reached a caller without hr`).not.toHaveProperty(key);
        expect(row).not.toHaveProperty("headId");
        expect(row).not.toHaveProperty("head_id");
        const counts = row._count as Row | undefined;
        for (const key of WITHHELD) expect(counts?.[key], `the total of '${key}' reached a caller without hr`).toBeUndefined();
        if (lead) expect(row.lead).toBeTruthy();
    }

    function expectServed(row: Row, { lead = true }: { lead?: boolean } = {}): void {
        expect(row.head).toBeTruthy();
        expect(Array.isArray(row.members) && row.members.length).toBeGreaterThan(0);
        expect(Array.isArray(row.tags) && row.tags.length).toBeGreaterThan(0);
        if (lead) expect(row.lead).toBeTruthy();
    }

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
            collections: ALL,
            database: createPostgresAdapter({
                connection: connection.db,
                connectionString: container.connectionString
            }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY }
        });

        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        for (const who of Object.keys(caller) as Who[]) {
            const user = await repo.createUser({ email: `${who}@include-access.test`, emailVerified: true });
            await repo.setUserRoles(user.id, caller[who].roles);
            caller[who].uid = user.id;
            caller[who].token = await generateAccessToken(user.id, caller[who].roles);
        }

        await admin.query(`
            INSERT INTO people (name) VALUES ('Ada'), ('Grace');
            INSERT INTO tags (name) VALUES ('payroll'), ('restructuring');
            INSERT INTO departments (name, lead_id, head_id) VALUES ('Research', 1, 2), ('Sales', 2, 1);
            INSERT INTO staff (name, department_id) VALUES ('s1', 1), ('s2', 1), ('s3', 1), ('s4', 2);
            INSERT INTO departments_tags (department_id, tag_id) VALUES (1, 1), (1, 2), (2, 1);
        `);

        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    }, 180_000);

    afterAll(async () => {
        for (const ws of sockets) ws.terminate();
        await backend?.shutdown(1_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connection?.pool.end().catch(() => {});
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    const NAMED = "lead,head,members,tags";
    const COUNTED = JSON.stringify({
        lead: true, head: true,
        members: { limit: 1, count: true },
        tags: { limit: 1, count: true }
    });

    describe("REST", () => {
        it("GET a listing with the relations named", async () => {
            expectServed(first((await call("hr", `/departments?include=${NAMED}`)).data));
            expectWithheld(first((await call("plain", `/departments?include=${NAMED}`)).data));
        });

        it("GET a listing with `*`", async () => {
            expectServed(first((await call("hr", "/departments?include=*")).data));
            expectWithheld(first((await call("plain", "/departments?include=*")).data));
        });

        it("GET one row with the relations named", async () => {
            expectServed(await call("hr", `/departments/1?include=${NAMED}`));
            expectWithheld(await call("plain", `/departments/1?include=${NAMED}`));
        });

        it("GET with a counted, limited include: no rows and no total", async () => {
            const served = first((await call("hr", `/departments?include=${encodeURIComponent(COUNTED)}`)).data);
            expect(served._count).toEqual({ members: 3, tags: 2 });
            const withheld = first((await call("plain", `/departments?include=${encodeURIComponent(COUNTED)}`)).data);
            expectWithheld(withheld);
            expect(withheld).not.toHaveProperty("_count");
        });

        it("POST …/query with the include in the body", async () => {
            const body = { include: JSON.parse(COUNTED) };
            expectServed(first((await call("hr", "/departments/query", { method: "POST", body })).data));
            const withheld = first((await call("plain", "/departments/query", { method: "POST", body })).data);
            expectWithheld(withheld);
            expect(withheld).not.toHaveProperty("_count");
        });

        it("a nested include reaching a withheld relation one level down", async () => {
            const served = (await call("hr", "/staff?include=department.head,department.members")).data ?? [];
            const department = served.find(r => Number(r.id) === 1)?.department as Row;
            expect(department.head).toBeTruthy();
            expect(Array.isArray(department.members)).toBe(true);

            const withheld = (await call("plain", "/staff?include=department.head,department.members")).data ?? [];
            const plainDepartment = withheld.find(r => Number(r.id) === 1)?.department as Row;
            expect(plainDepartment).toBeTruthy();
            expect(plainDepartment).not.toHaveProperty("head");
            expect(plainDepartment).not.toHaveProperty("members");
        });
    });

    /**
     * The same relation reached without `include`: a nested URL names it as a
     * path segment, and an aggregate sort orders the parents by it. Both are
     * refused as naming a withheld field in `?fields=` or `?orderBy=` is —
     * `FIELD_NOT_READABLE` — rather than answered, which handed the caller the
     * related rows (or their order by count) the include no longer does.
     */
    describe("the relation named outside an include", () => {
        async function status(who: Who, path: string): Promise<{ status: number; code?: string }> {
            const response = await app.request(`/api/data${path}`, {
                headers: { Authorization: `Bearer ${caller[who].token}` }
            });
            const json = await response.json() as { error?: { code?: string } };
            return { status: response.status, code: json.error?.code };
        }

        const NESTED = [
            "/departments/1/members", "/departments/1/tags", "/departments/1/head",
            "/departments/1/members/1", "/departments/1/tags/1"
        ];

        it.each(NESTED)("GET %s", async (path) => {
            expect((await status("hr", path)).status).toBe(200);
            expect(await status("plain", path)).toEqual({ status: 400, code: "FIELD_NOT_READABLE" });
        });

        it("a nested URL through a readable relation still answers", async () => {
            expect((await status("plain", "/departments/1/lead")).status).toBe(200);
        });

        it.each(["count(members)", "count(tags)"])("GET ?orderBy=%s", async (key) => {
            const path = `/departments?orderBy=${encodeURIComponent(`${key}:desc`)}`;
            expect((await status("hr", path)).status).toBe(200);
            expect(await status("plain", path)).toEqual({ status: 400, code: "FIELD_NOT_READABLE" });
        });
    });

    describe("the in-process SDK on a request-scoped driver", () => {
        it("find() with the relations named, and counted", async () => {
            for (const include of [NAMED.split(","), JSON.parse(COUNTED)]) {
                const served = (await (await sdk("hr")).find({ include })).data;
                expectServed(first(served));
                const withheld = (await (await sdk("plain")).find({ include })).data;
                const row = first(withheld);
                expectWithheld(row);
                expect(row).not.toHaveProperty("_count");
            }
        });
    });

    describe("the realtime socket", () => {
        it("FETCH_COLLECTION with the relations named", async () => {
            const include = NAMED.split(",");
            const served = await (await openSocket("hr"))("FETCH_COLLECTION", { path: "departments", include });
            expectServed(first(served.payload?.rows), { lead: false });
            const withheld = await (await openSocket("plain"))("FETCH_COLLECTION", { path: "departments", include });
            expect(withheld.type, JSON.stringify(withheld.payload?.error)).not.toBe("ERROR");
            expectWithheld(first(withheld.payload?.rows), { lead: false });
        });

        it("subscribe_collection with the relations named, and counted", async () => {
            for (const include of [NAMED.split(","), JSON.parse(COUNTED)]) {
                const served = await (await openSocket("hr"))("subscribe_collection", { path: "departments", include });
                expect(served.type).toBe("collection_update");
                expectServed(first(served.rows ?? served.payload?.rows));

                const withheld = await (await openSocket("plain"))("subscribe_collection", { path: "departments", include });
                expect(withheld.type, JSON.stringify(withheld.payload?.error)).toBe("collection_update");
                const row = first(withheld.rows ?? withheld.payload?.rows);
                expectWithheld(row);
                expect(row).not.toHaveProperty("_count");
            }
        });
    });
});
