/**
 * "Simulate access" is read-only on every door that honours it.
 *
 * A write made while simulating ran as the simulated identity for real: the
 * row was saved as `u_1` holding `customer`, history named `u_1` the author,
 * and callbacks saw a role the account may not hold. Only the request log
 * named the administrator. Now a write, delete, batch, revert or non-GET
 * function call carrying a simulation header is refused with
 * `SIMULATION_READ_ONLY`, and nothing reaches the driver; reads — including
 * the `POST …/query` and `…/count` reads — still run as the simulated identity.
 *
 * Through the real adapter middleware, so the headers are decided as they are
 * in production.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { Hono } from "hono";
import type { AuthAdapter, AuthenticatedUser, DataDriver } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import type { ScopeIdentity } from "../src/auth/rls-scope";
import { fakeAuthAdapter } from "./helpers/server-b-g1-auth-adapter";
import type { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createAdapterAuthMiddleware } from "../src/auth/adapter-middleware";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { createHistoryRoutes, type HistoryService } from "../src/history/history-routes";
import { createFunctionScopeGuard } from "../src/auth/api-keys/api-key-middleware";
import { tablesFromCollections } from "./helpers/tables";
import { historyEntry } from "./helpers/history";

jest.mock("../src/utils/logger", () => ({
    logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() }
}));

const people: Record<string, AuthenticatedUser> = {
    "admin-1": { uid: "admin-1", roles: ["admin"], isAdmin: true } as AuthenticatedUser
};
const adapter: AuthAdapter = fakeAuthAdapter({
    verifyRequest: async (req: Request) =>
        (req.headers.get("authorization") === "Bearer admin-token" ? people["admin-1"] : null),
    resolveUser: async (uid: string) => people[uid] ?? null
});

const posts: LegacyCollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    history: true,
    properties: { id: { name: "ID", type: "string", isId: "uuid" }, title: { name: "Title", type: "string" } }
};

/** A driver that can scope by user (Postgres' `withAuth`, not on `DataDriver` itself). */
type ScopableDriver = DataDriver & { withAuth(user: ScopeIdentity): Promise<DataDriver> };

function build() {
    const writes: string[] = [];
    const driver: ScopableDriver = {
        key: "postgres",
        initialised: true,
        withAuth: async () => driver,
        fetchCollection: async () => [],
        fetchOne: async ({ id }) => ({ id, title: "t" }),
        count: async () => 0,
        save: async () => { writes.push("save"); return { id: "p1", values: {} }; },
        saveMany: async () => { writes.push("saveMany"); return []; },
        delete: async () => { writes.push("delete"); },
        batchWrite: async () => { writes.push("batch"); return []; },
        checkUniqueField: async () => true,
        admin: {}
    };

    const app = new Hono<HonoEnv>();
    app.onError(errorHandler);
    app.use("/*", createAdapterAuthMiddleware({ adapter, driver }));
    app.route("/data", new RestApiGenerator(tablesFromCollections([posts]), driver).generateRoutes());
    const historyService: HistoryService = {
        fetchHistory: async () => ({ data: [], total: 0 }),
        fetchHistoryEntry: async () => historyEntry({ id: "h1", entity_id: "p1", values: { title: "old" } })
    };
    app.route("/history", createHistoryRoutes({
        historyService,
        tables: () => tablesFromCollections([posts]),
        driver
    }));
    const functions = new Hono<HonoEnv>();
    functions.use("/*", createFunctionScopeGuard("/functions"));
    functions.all("/charge", (c) => { writes.push("function"); return c.json({ ok: true }); });
    app.route("/functions", functions);
    return { app, writes };
}

const SIMULATING = { Authorization: "Bearer admin-token", "x-rebase-simulate-role": "customer", "x-rebase-simulate-user-id": "u_1", "Content-Type": "application/json" };
const send = (app: Hono<HonoEnv>, method: string, path: string, body?: unknown, headers: Record<string, string> = SIMULATING) =>
    app.request(path, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("a request that simulates access", () => {
    it.each([
        ["POST", "/data/posts", { title: "x" }],
        ["PATCH", "/data/posts/p1", { title: "x" }],
        ["PUT", "/data/posts/p1", { title: "x" }],
        ["DELETE", "/data/posts/p1", undefined],
        ["POST", "/data/posts/bulk", { rows: [{ title: "x" }] }],
        ["PATCH", "/data/posts/bulk", { updates: [{ id: "p1", data: { title: "x" } }] }],
        ["POST", "/data/posts/bulk/delete", { ids: ["p1"] }],
        ["POST", "/data/_batch", { operations: [{ op: "create", table: "posts", values: { title: "x" } }] }],
        ["POST", "/history/posts/p1/history/h1/revert", undefined],
        ["POST", "/functions/charge", {}]
    ])("refuses %s %s with SIMULATION_READ_ONLY and writes nothing", async (method, path, body) => {
        const { app, writes } = build();
        const res = await send(app, method, path, body);
        expect(res.status).toBe(403);
        const error = (await res.json() as { error: { code: string; message: string } }).error;
        expect(error.code).toBe("SIMULATION_READ_ONLY");
        expect(error.message).toMatch(/simulat/i);
        expect(writes).toEqual([]);
    });

    it.each([
        ["GET", "/data/posts", undefined],
        ["GET", "/data/posts/p1", undefined],
        ["POST", "/data/posts/query", {}],
        ["POST", "/data/posts/count", {}],
        ["GET", "/data/posts/count", undefined],
        ["GET", "/functions/charge", undefined]
    ])("still answers the read %s %s", async (method, path, body) => {
        const { app } = build();
        const res = await send(app, method, path, body);
        expect(res.status).toBe(200);
    });

    it("leaves the administrator's own writes alone", async () => {
        const { app, writes } = build();
        const res = await send(app, "PATCH", "/data/posts/p1", { title: "x" },
            { Authorization: "Bearer admin-token", "Content-Type": "application/json" });
        expect(res.status).toBe(200);
        expect(writes).toEqual(["save"]);
    });
});
