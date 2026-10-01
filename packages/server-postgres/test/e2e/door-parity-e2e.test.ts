/**
 * E2E: every door into the data plane answers one operation the same way.
 *
 * The table and the judge are in `packages/server/test/contract/door-parity-contract.ts`,
 * which says why they live apart from any one door's suite. This file is the
 * Postgres half: one real database, and the six doors a write can come in by —
 *
 *  - `rest`        `POST` / `PATCH` / `DELETE` / `GET` on `/api/data/docs[/:id]`
 *  - `rest-bulk`   `POST /bulk`, `PATCH /bulk`, `POST /bulk/delete`
 *  - `rest-batch`  `POST /_batch`
 *  - `socket`      the realtime socket's `SAVE`, `DELETE`, `FETCH_ONE`, `FETCH_COLLECTION`
 *  - `mcp`         the MCP tool handlers, called as the remote MCP route calls them
 *  - `data`        the in-process data plane, `driver.data.docs` — on the BASE
 *                  driver, with no request transaction around it, because that
 *                  is where a write that throws after committing stays committed
 *
 * — each built from the code the server mounts, not a stand-in. Every row of the
 * table runs through every door that can spell its operation, from a staged
 * starting state, and the judge compares the answer, the hooks that ran, the
 * history written and the row left behind.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket as NodeWebSocket } from "ws";
import type { CollectionConfig, DataDriver, SDKCollectionClient } from "@rebasepro/types";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import { HistoryService } from "../../src/history/HistoryService.js";
import { ensureHistoryTableExists } from "../../src/history/ensure-history-table.js";
import { createPostgresWebSocket } from "../../src/websocket.js";
import { RestApiGenerator } from "../../../server/src/api/rest/api-generator.js";
import { errorHandler } from "../../../server/src/api/errors.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { configureJwt, generateAccessToken } from "../../../server/src/auth/jwt.js";
import { MCP_TOOLS, McpToolError } from "../../../server/src/mcp/mcp-tools.js";
import {
    DOORS,
    PARITY_CASES,
    STORED_TITLE,
    judge,
    type Door,
    type DoorAnswer,
    type Observed,
    type Operation,
    type StartingState
} from "../../../server/test/contract/door-parity-contract";

const docsTable = pgTable("docs", {
    id: varchar("id").primaryKey(),
    title: varchar("title"),
    created_at: timestamp("created_at", { withTimezone: true, mode: "string" }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, mode: "string" })
});

/** Every collection hook that ran, in order; `afterRead` is left out (see the contract). */
const hookLog: string[] = [];

/**
 * Soft delete, history and a hook at every write stage: the three things a door
 * can skip without any other symptom. `created_at` is a date, so a door that
 * hands back the admin view model (`{ __type: "date" }`) shows it.
 */
const docsCollection = {
    slug: "docs",
    name: "Docs",
    table: "docs",
    history: true,
    softDelete: true,
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        created_at: { name: "Created", type: "date", autoValue: "on_create" },
        deletedAt: { name: "Deleted at", type: "date" }
    },
    callbacks: {
        beforeSave: ({ status, values }: { status: string; values: Record<string, unknown> }) => {
            hookLog.push(`beforeSave:${status}`);
            return values;
        },
        afterSave: ({ status }: { status: string }) => {
            hookLog.push(`afterSave:${status}`);
        },
        beforeDelete: () => {
            hookLog.push("beforeDelete");
        },
        afterDelete: () => {
            hookLog.push("afterDelete");
        }
    }
} as unknown as CollectionConfig;

const USER = { uid: "door-user", roles: ["admin"] };

/**
 * The doors with a spelling for a hard delete. `_batch` and MCP have none;
 * `data` has none until the SDK grows `delete(id, { hard })` (DD-9).
 */
const HARD_DELETE_DOORS = new Set<Door>(["rest", "rest-bulk", "socket"]);

/** A door's spelling of each operation, or `undefined` where it has none. */
type DoorAdapter = {
    [K in Operation["op"]]?: (id: string, operation: Extract<Operation, { op: K }>) => Promise<DoorAnswer>;
};

/** An error a door threw, as the answer it amounts to. */
function refusal(error: unknown): DoorAnswer {
    const e = error as { statusCode?: number; code?: string; message?: string };
    return {
        ok: false,
        status: typeof e?.statusCode === "number" ? e.statusCode : undefined,
        code: typeof e?.code === "string" ? e.code : undefined,
        message: String(e?.message ?? error)
    };
}

describe("door parity: one operation, one answer (E2E)", () => {
    let container: PgContainer;
    let observer: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;
    let realtime: RealtimeService;
    let server: Server;
    let socket: NodeWebSocket;
    const app = new Hono<HonoEnv>();
    const waiters = new Map<string, (frame: { type: string; payload?: any }) => void>();
    let seq = 0;

    function frame(type: string, payload: Record<string, unknown>): Promise<{ type: string; payload?: any }> {
        const requestId = `r-${++seq}`;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`No answer to ${type}`)), 20_000);
            waiters.set(requestId, (answer) => {
                clearTimeout(timer);
                resolve(answer);
            });
            socket.send(JSON.stringify({ type, requestId, payload }));
        });
    }

    async function http(method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> {
        const response = await app.request(`/api/data${path}`, {
            method,
            headers: body === undefined ? {} : { "Content-Type": "application/json" },
            body: body === undefined ? undefined : JSON.stringify(body)
        });
        const text = await response.text();
        return { status: response.status, json: text ? JSON.parse(text) : null };
    }

    /** An HTTP answer, normalized. */
    function fromHttp({ status, json }: { status: number; json: any }, pick?: (json: any) => {
        row?: Record<string, unknown>;
        rows?: Record<string, unknown>[];
    }): DoorAnswer {
        if (status >= 400) {
            return { ok: false, status, code: json?.error?.code, message: json?.error?.message ?? String(status) };
        }
        return { ok: true, status, ...(pick ? pick(json) : {}) };
    }

    /** A socket answer, normalized. The socket has no status; only the code says what kind of refusal. */
    function fromFrame(answer: { type: string; payload?: any }, pick?: (payload: any) => DoorAnswer): DoorAnswer {
        if (answer.type === "ERROR") {
            return { ok: false, code: answer.payload?.error?.code, message: answer.payload?.error?.message ?? "" };
        }
        return pick ? pick(answer.payload) : { ok: true };
    }

    const docs = () => driver.data.docs as unknown as SDKCollectionClient<Record<string, unknown>>;

    async function mcp(tool: string, args: Record<string, unknown>): Promise<DoorAnswer> {
        const definition = MCP_TOOLS.find(candidate => candidate.name === tool);
        if (!definition) throw new Error(`No MCP tool ${tool}`);
        try {
            const out = await definition.run(args, {
                driver: driver as unknown as DataDriver,
                collections: [docsCollection],
                caller: { ...USER, scope: "mcp:read mcp:write", clientId: "door-parity" }
            });
            return { ok: true, ...(tool === "delete_document" ? {} : { row: out as Record<string, unknown> }) };
        } catch (error) {
            // A tool error carries a message for the model and nothing else; the
            // one it raises for a row it cannot find is that row's 404.
            if (error instanceof McpToolError && /^No row with id/.test(error.message)) {
                return { ok: false, status: 404, code: "NOT_FOUND", message: error.message };
            }
            return refusal(error);
        }
    }

    /** Runs a door call, turning a throw into the refusal it is. */
    async function settle(call: () => Promise<DoorAnswer>): Promise<DoorAnswer> {
        try {
            return await call();
        } catch (error) {
            return refusal(error);
        }
    }

    const adapters: Record<Door, DoorAdapter> = {
        rest: {
            create: async (id, { values }) => {
                const answer = fromHttp(await http("POST", "/docs", { id, ...values }), json => ({ row: json }));
                return answer.ok ? { ...answer, created: answer.status === 201 } : answer;
            },
            update: async (id, { values }) => {
                const answer = fromHttp(await http("PATCH", `/docs/${id}`, values), json => ({ row: json }));
                return answer.ok ? { ...answer, created: answer.status === 201 } : answer;
            },
            upsert: async (id, { values }) =>
                fromHttp(await http("POST", "/docs?on_conflict=id", { id, ...values }), json => ({ row: json })),
            delete: async (id, { hard }) =>
                fromHttp(await http("DELETE", `/docs/${id}${hard ? "?hard=true" : ""}`)),
            get: async (id) => fromHttp(await http("GET", `/docs/${id}`), json => ({ row: json })),
            list: async (id, { include }) => fromHttp(
                await http("GET", `/docs?id=${encodeURIComponent(id)}${include ? `&include=${include.join(",")}` : ""}`),
                json => ({ rows: json.data })
            )
        },
        "rest-bulk": {
            create: async (id, { values }) =>
                fromHttp(await http("POST", "/docs/bulk", { rows: [{ id, ...values }] }), json => ({ row: json.data[0] })),
            update: async (id, { values }) =>
                fromHttp(await http("PATCH", "/docs/bulk", { updates: [{ id, data: values }] }), json => ({ row: json.data[0] })),
            upsert: async (id, { values }) =>
                fromHttp(await http("POST", "/docs/bulk", { rows: [{ id, ...values }], upsert: true }), json => ({ row: json.data[0] })),
            delete: async (id, { hard }) =>
                fromHttp(await http("POST", `/docs/bulk/delete${hard ? "?hard=true" : ""}`, { ids: [id] }))
        },
        "rest-batch": {
            create: async (id, { values }) => fromHttp(
                await http("POST", "/_batch", { operations: [{ op: "create", collection: "docs", values: { id, ...values } }] }),
                json => ({ row: json.data[0] })
            ),
            update: async (id, { values }) => fromHttp(
                await http("POST", "/_batch", { operations: [{ op: "update", collection: "docs", id, values }] }),
                json => ({ row: json.data[0] })
            ),
            upsert: async (id, { values }) => fromHttp(
                await http("POST", "/_batch", { operations: [{ op: "upsert", collection: "docs", values: { id, ...values } }] }),
                json => ({ row: json.data[0] })
            ),
            delete: async (id) =>
                fromHttp(await http("POST", "/_batch", { operations: [{ op: "delete", collection: "docs", id }] }))
        },
        socket: {
            create: async (id, { values }) => fromFrame(
                await frame("SAVE", { path: "docs", values: { id, ...values }, status: "new" }),
                payload => ({ ok: true, row: payload.row })
            ),
            update: async (id, { values }) => fromFrame(
                await frame("SAVE", { path: "docs", id, values, status: "existing" }),
                payload => ({ ok: true, row: payload.row })
            ),
            upsert: async (id, { values }) => fromFrame(
                await frame("SAVE", { path: "docs", values: { id, ...values }, status: "new", upsert: true }),
                payload => ({ ok: true, row: payload.row })
            ),
            delete: async (id, { hard }) => fromFrame(
                await frame("DELETE", { row: { id, path: "docs" }, ...(hard ? { hard: true } : {}) })
            ),
            get: async (id) => fromFrame(
                await frame("FETCH_ONE", { path: "docs", id }),
                payload => payload.row
                    ? { ok: true, row: payload.row }
                    : { ok: false, code: "NOT_FOUND", message: "FETCH_ONE answered row: null" }
            ),
            list: async (id, { include }) => fromFrame(
                await frame("FETCH_COLLECTION", { path: "docs", filter: { id: ["==", id] }, ...(include ? { include } : {}) }),
                payload => ({ ok: true, rows: payload.rows })
            )
        },
        mcp: {
            create: (id, { values }) => mcp("create_document", { collection: "docs", values: { id, ...values } }),
            update: (id, { values }) => mcp("update_document", { collection: "docs", id, values }),
            delete: (id) => mcp("delete_document", { collection: "docs", id }),
            get: (id) => mcp("get_document", { collection: "docs", id })
        },
        data: {
            create: (id, { values }) => settle(async () => ({ ok: true, row: await docs().create({ id, ...values }) })),
            update: (id, { values }) => settle(async () => ({ ok: true, row: await docs().update(id, values) })),
            upsert: (id, { values }) => settle(async () => ({ ok: true, row: await docs().upsert({ id, ...values }) })),
            delete: (id) => settle(async () => {
                await docs().delete(id);
                return { ok: true };
            }),
            get: (id) => settle(async () => {
                const row = await docs().findById(id);
                return row
                    ? { ok: true, row }
                    : { ok: false, status: 404, code: "NOT_FOUND", message: "findById answered undefined" };
            }),
            list: (id, { include }) => settle(async () => ({
                ok: true,
                rows: (await docs().find({ where: { id: ["==", id] }, ...(include ? { include } : {}) })).data
            }))
        }
    };

    async function stage(state: StartingState, id: string): Promise<void> {
        if (state === "absent") return;
        await observer.query(
            "INSERT INTO public.docs (id, title, created_at, deleted_at) VALUES ($1, $2, now(), $3)",
            [id, STORED_TITLE, state === "trashed" ? new Date().toISOString() : null]
        );
    }

    async function observe(id: string, answer: DoorAnswer): Promise<Observed> {
        const stored = await observer.query("SELECT title, deleted_at FROM public.docs WHERE id = $1", [id]);
        const history = await observer.query(
            `SELECT action, "values" FROM rebase.entity_history
             WHERE table_name = 'docs' AND entity_id = $1 ORDER BY updated_at`,
            [id]
        );
        const row = stored.rows[0];
        return {
            answer,
            hooks: [...hookLog],
            history: history.rows,
            state: !row ? "absent" : row.deleted_at === null ? "live" : "trashed",
            title: row?.title
        };
    }

    beforeAll(async () => {
        configureJwt({ secret: "door-parity-e2e-secret-0123456789abcdef", accessExpiresIn: "1h" });
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                observer = new pg.Client({ connectionString: container.connectionString });
                await observer.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        await observer.query(`
            CREATE TABLE public.docs (
                id varchar PRIMARY KEY,
                title varchar,
                created_at timestamptz,
                deleted_at timestamptz
            );
        `);

        pool = new pg.Pool({ connectionString: container.connectionString });
        const db = drizzle(pool);
        const historyInTransaction = await ensureHistoryTableExists(db as never);

        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([docsCollection]);
        registry.registerTable(docsTable, "docs");
        realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(
            db as never, realtime as never, registry,
            undefined, undefined, new HistoryService(db as never, undefined, { inTransaction: historyInTransaction })
        );
        realtime.setDataDriver(driver);

        // REST, as `init.ts` mounts it: every request on a driver scoped to its caller.
        app.onError(errorHandler);
        app.use("/api/data/*", async (c, next) => {
            c.set("user", USER as never);
            c.set("driver", await driver.withAuth(USER as never));
            await next();
        });
        app.route("/api/data", new RestApiGenerator([docsCollection], driver).generateRoutes());

        // The socket, signed in as the same caller.
        server = createServer();
        createPostgresWebSocket(server, realtime, driver, { requireAuth: true });
        await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
        socket = new NodeWebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
        await new Promise<void>((resolve, reject) => {
            socket.once("open", () => resolve());
            socket.once("error", reject);
        });
        socket.on("message", (data) => {
            const answer = JSON.parse(String(data));
            const waiter = answer.requestId && waiters.get(answer.requestId);
            if (waiter) {
                waiters.delete(answer.requestId);
                waiter(answer);
            }
        });
        const auth = await frame("AUTHENTICATE", { token: await generateAccessToken(USER.uid, USER.roles) });
        expect(auth.type).toBe("AUTH_SUCCESS");
    }, 120_000);

    afterAll(async () => {
        socket?.close();
        await realtime?.destroy();
        await new Promise<void>(resolve => (server ? server.close(() => resolve()) : resolve()));
        await observer?.end();
        await pool?.end();
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    let caseSeq = 0;
    for (const parity of PARITY_CASES) {
        describe(`given a ${parity.given} row, ${parity.name}${parity.finding ? ` (${parity.finding})` : ""}`, () => {
            for (const door of DOORS) {
                const run = adapters[door][parity.when.op] as
                    | ((id: string, operation: Operation) => Promise<DoorAnswer>)
                    | undefined;
                if (!run) continue;
                if (parity.when.op === "delete" && parity.when.hard && !HARD_DELETE_DOORS.has(door)) continue;
                const pending = parity.pending?.[door];
                const test = pending ? it.fails : it;
                test(`${door}${pending ? ` — pending: ${pending}` : ""}`, async () => {
                    const id = `${door}-${++caseSeq}`;
                    await stage(parity.given, id);
                    hookLog.length = 0;
                    const answer = await run(id, parity.when);
                    expect(judge(parity.then, await observe(id, answer))).toEqual([]);
                });
            }
        });
    }
});
