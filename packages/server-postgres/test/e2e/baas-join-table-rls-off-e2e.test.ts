/**
 * E2E: a join table with row-level security off, in a project that declares no
 * collections, is not reachable by a caller.
 *
 * No collection is ever derived for a join table (`buildCollectionsFromSchema`),
 * so every door that starts from a collection has no address for it. Boot also
 * drops one with RLS off from the Drizzle schema and names it, so that skip is
 * not the only thing between a caller and its rows.
 *
 * It does not take `rebase_user`'s grants back. Nothing in the database stops
 * that role reading the table, and that is deliberate: a policy on a served
 * table commonly reads a join table in a subquery, and the subquery runs as the
 * caller. Revoking would turn every such read into `permission denied`. So what
 * this file pins is the doors: a served table's relations, a nested path, a
 * filter, a batch, the socket's frames — including one that hands the server a
 * collection of its own — and the admin plane, for a caller who does not hold it.
 *
 * `SENTINEL` is a project id only the two join tables reveal. The `projects`
 * policy hides it, so if it appears in any answer the join table is what served
 * it. The first test proves the sentinel is there to be found.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import pg from "pg";
import { Hono } from "hono";
import { WebSocket as NodeWebSocket } from "ws";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { openPostgresDriver } from "../../src/PostgresBootstrapper.js";
import { initializeRebaseBackend, _resetRebaseMock, logger } from "../../../server/src/index.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "baas-join-table-rls-off-e2e-secret-that-is-long-enough";
const SENTINEL = "acquisition-x";

type Frame = { type: string; requestId?: string; subscriptionId?: string; payload?: unknown; rows?: unknown };

describe("a BaaS join table with RLS off (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let connection: ReturnType<typeof createPostgresDatabaseConnection>;
    let backend: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const app = new Hono<HonoEnv>();
    const server = createServer();
    const sockets: NodeWebSocket[] = [];
    const originalNodeEnv = process.env.NODE_ENV;
    const warned: string[] = [];
    let token = "";

    async function call(path: string, init: { method?: string; body?: unknown } = {}) {
        const response = await app.request(path, {
            method: init.method ?? "GET",
            headers: { "Content-Type": "application/json",
Authorization: `Bearer ${token}` },
            ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {})
        });
        return { status: response.status,
text: await response.text() };
    }

    async function openSocket() {
        const ws = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        sockets.push(ws);
        await new Promise<void>((resolve, reject) => {
            ws.once("open", () => resolve());
            ws.once("error", reject);
        });
        const waiters = new Map<string, (raw: string) => void>();
        ws.on("message", (data) => {
            const raw = String(data);
            const frame = JSON.parse(raw) as Frame;
            const key = frame.requestId ?? frame.subscriptionId;
            const waiter = key ? waiters.get(key) : undefined;
            if (key && waiter) {
                waiters.delete(key);
                waiter(raw);
            }
        });
        let seq = 0;
        const send = (type: string, payload: Record<string, unknown>): Promise<string> => {
            const key = `${type}-${++seq}`;
            return new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error(`no answer to ${type}`)), 5_000);
                waiters.set(key, (raw) => {
                    clearTimeout(timer);
                    resolve(raw);
                });
                ws.send(JSON.stringify(type.startsWith("subscribe_")
                    ? { type,
payload: { ...payload,
subscriptionId: key } }
                    : { type,
requestId: key,
payload }));
            });
        };
        return send;
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query(`
            CREATE TABLE public.people (id text PRIMARY KEY, name text NOT NULL);
            CREATE TABLE public.projects (id text PRIMARY KEY, title text NOT NULL);
            -- The two shapes identifyJoinTables recognises: both keys as the
            -- primary key, and a surrogate id with a timestamp beside them.
            CREATE TABLE public.memberships (
                person_id text NOT NULL REFERENCES public.people(id),
                project_id text NOT NULL REFERENCES public.projects(id),
                PRIMARY KEY (person_id, project_id)
            );
            CREATE TABLE public.assignments (
                id text PRIMARY KEY,
                person_id text NOT NULL REFERENCES public.people(id),
                project_id text NOT NULL REFERENCES public.projects(id),
                created_at timestamptz NOT NULL DEFAULT now()
            );
            -- A served table with a foreign key INTO a join table.
            CREATE TABLE public.reviews (
                id text PRIMARY KEY,
                assignment_id text REFERENCES public.assignments(id),
                body text
            );
            -- A served table whose policy reads a join table, the reason the
            -- grants on one stay.
            CREATE TABLE public.briefs (
                id text PRIMARY KEY,
                project_id text NOT NULL REFERENCES public.projects(id),
                body text
            );
            -- The control: the filter this test is about, doing its job.
            CREATE TABLE public.ledger (id text PRIMARY KEY, memo text);

            ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
            CREATE POLICY people_read ON public.people FOR SELECT USING (true);
            ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
            CREATE POLICY projects_read ON public.projects FOR SELECT USING (id <> '${SENTINEL}');
            ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;
            CREATE POLICY reviews_read ON public.reviews FOR SELECT USING (true);
            ALTER TABLE public.briefs ENABLE ROW LEVEL SECURITY;
            CREATE POLICY briefs_read ON public.briefs FOR SELECT USING (EXISTS (
                SELECT 1 FROM public.memberships m
                 WHERE m.project_id = briefs.project_id
                   AND m.person_id = current_setting('app.user_id', true)
            ));

            INSERT INTO public.people VALUES ('alice', 'Alice'), ('bob', 'Bob');
            INSERT INTO public.projects VALUES ('open', 'Open'), ('${SENTINEL}', 'Quiet');
            INSERT INTO public.memberships VALUES ('alice', '${SENTINEL}'), ('bob', 'open');
            INSERT INTO public.assignments (id, person_id, project_id) VALUES ('a1', 'alice', '${SENTINEL}');
            INSERT INTO public.reviews VALUES ('r1', 'a1', 'fine');
            INSERT INTO public.briefs VALUES ('b-open', 'open', 'visible'), ('b-quiet', '${SENTINEL}', 'hidden');
            INSERT INTO public.ledger VALUES ('l1', '${SENTINEL}');
        `);

        connection = createPostgresDatabaseConnection(container.connectionString);
        const warn = vi.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        backend = await initializeRebaseBackend({
            app,
            server,
            collections: [],
            enableSwagger: true,
            database: createPostgresAdapter({
                connection: connection.db,
                connectionString: container.connectionString
            }),
            auth: { jwtSecret: JWT_SECRET }
        });
        warn.mockRestore();

        const repo = backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("the boot set up no auth repository");
        const caller = await repo.createUser({ email: "bob@join-table.test",
emailVerified: true });
        token = await generateAccessToken(caller.id, []);
        await admin.query("INSERT INTO public.people VALUES ($1, 'Caller')", [caller.id]);
        await admin.query("INSERT INTO public.memberships VALUES ($1, 'open')", [caller.id]);

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

    it("the database itself would hand the sentinel to rebase_user: the table is open, not merely empty", async () => {
        const { rows: posture } = await admin.query<{ relname: string; relrowsecurity: boolean; can_read: boolean; can_write: boolean }>(`
            SELECT relname, relrowsecurity,
                   has_table_privilege('rebase_user', oid, 'SELECT') AS can_read,
                   has_table_privilege('rebase_user', oid, 'INSERT') AS can_write
              FROM pg_class
             WHERE oid IN ('public.memberships'::regclass, 'public.assignments'::regclass)
             ORDER BY relname
        `);
        expect(posture).toEqual([
            { relname: "assignments",
relrowsecurity: false,
can_read: true,
can_write: true },
            { relname: "memberships",
relrowsecurity: false,
can_read: true,
can_write: true }
        ]);

        await admin.query("BEGIN");
        await admin.query("SET LOCAL ROLE rebase_user");
        const { rows } = await admin.query("SELECT project_id FROM public.memberships");
        await admin.query("ROLLBACK");
        expect(rows.map(row => row.project_id)).toContain(SENTINEL);
    });

    it("serves the protected tables to this caller, so a refusal below means the table and not the token", async () => {
        const people = await call("/api/data/people");
        expect(people.status).toBe(200);
        expect(people.text).toContain("Alice");

        const projects = await call("/api/data/projects");
        expect(projects.status).toBe(200);
        expect(projects.text).toContain("Open");
        expect(projects.text).not.toContain(SENTINEL);
    });

    it("excludes the RLS-off table that is not a join table, and says so at boot", async () => {
        expect((await call("/api/data/ledger")).status).toBe(404);
        expect(warned.some(message => message.includes("Not serving") && message.includes("ledger"))).toBe(true);
    });

    it("names the join tables at boot, apart from the tables it excludes", () => {
        const named = warned.filter(message => message.includes("join table"));
        expect(named).toHaveLength(1);
        expect(named[0]).toContain("assignments");
        expect(named[0]).toContain("memberships");
        expect(named[0]).toContain("rebase_user");

        // Enabling RLS would not serve one, so the line that says it would
        // must not name it.
        const excluded = warned.find(message => message.includes("Not serving"));
        expect(excluded).not.toContain("memberships");
        expect(excluded).not.toContain("assignments");
    });

    it("leaves a join table with RLS off out of the schema relations are built from", async () => {
        const opened = await openPostgresDriver(
            { connection: connection.db, connectionString: container.connectionString },
            { collections: [], introspectCollections: true, provision: false, realtime: false }
        );
        const { registry } = opened.internals;
        expect(registry.getTable("people")).toBeDefined();
        expect(registry.getTable("memberships")).toBeUndefined();
        expect(registry.getTable("assignments")).toBeUndefined();
    });

    it("keeps rebase_user's grants, so a served table's policy can still read a join table", async () => {
        const briefs = await call("/api/data/briefs");
        expect(briefs.status, briefs.text).toBe(200);
        expect(briefs.text).toContain("b-open");
        expect(briefs.text).not.toContain("b-quiet");
    });

    it.each([
        ["GET", "/api/data/memberships"],
        ["GET", "/api/data/memberships/alice"],
        ["GET", "/api/data/memberships/count"],
        ["GET", `/api/data/memberships?project_id=eq.${SENTINEL}`],
        ["GET", "/api/data/assignments"],
        ["GET", "/api/data/assignments/a1"],
        ["GET", "/api/data/assignments/count"],
        ["GET", "/api/data/people/alice/memberships"],
        ["GET", "/api/data/people/alice/assignments"],
        ["GET", `/api/data/projects/${SENTINEL}/memberships`],
        ["GET", "/api/data/reviews/r1/assignment"]
    ])("%s %s has no address", async (_method, path) => {
        const answer = await call(path);
        expect(answer.status).toBe(404);
        expect(answer.text).not.toContain(SENTINEL);
    });

    it.each([
        ["/api/data/memberships", { personId: "bob",
projectId: "open-2" }],
        ["/api/data/assignments", { id: "a2",
personId: "bob",
projectId: "open" }]
    ])("POST %s writes nothing", async (path, body) => {
        expect((await call(path, { method: "POST",
body })).status).toBe(404);
    });

    it("refuses a join table as an include, by name and through the wildcard's reach", async () => {
        for (const include of ["memberships", "assignments", "memberships.project", "assignment"]) {
            for (const path of [`/api/data/people?include=${include}`, `/api/data/people/alice?include=${include}`]) {
                const answer = await call(path);
                expect(answer.status, `${path} → ${answer.text}`).toBe(400);
                expect(answer.text).toContain("UNKNOWN_RELATION");
                expect(answer.text).not.toContain(SENTINEL);
            }
        }

        const wildcard = await call("/api/data/people/alice?include=*");
        expect(wildcard.status).toBe(200);
        expect(wildcard.text).not.toContain(SENTINEL);

        const review = await call("/api/data/reviews?include=*");
        expect(review.status).toBe(200);
        expect(review.text).not.toContain(SENTINEL);
    });

    it.each([
        `/api/data/people?memberships.project_id=eq.${SENTINEL}`,
        `/api/data/people?memberships=eq.${SENTINEL}`,
        `/api/data/people?where=${encodeURIComponent(JSON.stringify({ "memberships.project_id": ["==", SENTINEL] }))}`,
        "/api/data/people?orderBy=memberships",
        "/api/data/people?fields=memberships",
        "/api/data/people/aggregate?select=count()&groupBy=memberships"
    ])("gives no oracle on it through %s", async (path) => {
        const answer = await call(path);
        expect(answer.text).not.toContain(SENTINEL);
        // An error, or the whole listing unfiltered: never a listing narrowed
        // to the people the join table links to the sentinel.
        if (answer.status === 200 && answer.text.includes("Bob")) return;
        expect(answer.status, `${path} → ${answer.text}`).toBeGreaterThanOrEqual(400);
    });

    it("refuses a batch naming it", async () => {
        const answer = await call("/api/data/_batch", {
            method: "POST",
            body: { operations: [{ op: "create",
collection: "memberships",
values: { personId: "bob",
projectId: SENTINEL } }] }
        });
        expect(answer.status).toBe(400);
        expect(answer.text).toContain("unknown collection");
        const { rows } = await admin.query("SELECT 1 FROM public.memberships WHERE person_id = 'bob'");
        expect(rows).toHaveLength(1);
    });

    describe("over the socket", () => {
        /** Everything a client can spell to make a frame's own collection the one read. */
        const forged = {
            slug: "memberships",
            name: "Memberships",
            table: "memberships",
            schema: "public",
            properties: {
                personId: { name: "P",
type: "string",
columnName: "person_id",
isId: true },
                projectId: { name: "Q",
type: "string",
columnName: "project_id" }
            }
        };

        it.each([
            ["FETCH_COLLECTION", { path: "memberships" }],
            ["FETCH_COLLECTION", { path: "memberships",
collection: forged }],
            ["FETCH_COLLECTION", { path: "assignments" }],
            ["FETCH_ONE", { path: "memberships",
id: "alice" }],
            ["FETCH_ONE", { path: "memberships",
id: "alice",
collection: forged }],
            ["subscribe_collection", { path: "memberships" }],
            ["subscribe_collection", { path: "memberships",
collection: forged }]
        ])("%s %j answers nothing of it", async (type, payload) => {
            const send = await openSocket();
            const auth = JSON.parse(await send("AUTHENTICATE", { token })) as Frame;
            expect(auth.type).toBe("AUTH_SUCCESS");
            const raw = await send(type, payload);
            expect(raw).not.toContain(SENTINEL);
            expect(JSON.parse(raw).type).toMatch(/ERROR|error/);
        });

        it("keeps the SQL console and the catalogue frames from a caller without the admin plane", async () => {
            const send = await openSocket();
            await send("AUTHENTICATE", { token });
            const sql = await send("EXECUTE_SQL", { sql: "SELECT * FROM public.memberships",
options: { role: "rebase_user" } });
            expect(sql).not.toContain(SENTINEL);
            expect(JSON.parse(sql).type).not.toBe("EXECUTE_SQL_SUCCESS");

            const metadata = await send("FETCH_TABLE_METADATA", { tableName: "memberships" });
            expect(JSON.parse(metadata).type).not.toBe("FETCH_TABLE_METADATA_SUCCESS");
        });
    });

    it("does not name a join table in the API's description of itself", async () => {
        const docs = await call("/api/docs");
        expect(docs.status).toBe(200);
        expect(docs.text).toContain("/people");
        expect(docs.text).not.toContain("memberships");
    });
});
