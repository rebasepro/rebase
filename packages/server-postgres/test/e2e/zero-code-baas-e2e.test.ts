/**
 * Real-PostgreSQL E2E for zero-code BaaS:
 *  1. Single-client `executeSqlTransaction` atomicity over a real `pg.Pool`
 *  2. Multi-replica `LISTEN rebase_schema_changed` live schema reload across two
 *     independent `initializeRebaseBackend` instances sharing one Postgres DB
 *  3. Automatic per-table history recording on a dynamically created zero-code table
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import { Hono } from "hono";
import { isSQLAdmin, type TableDescriptor } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import type { HonoEnv } from "../../../server/src/api/types.js";

const JWT_SECRET = "zero-code-baas-real-pg-e2e-secret-at-least-32-chars!!";

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 10_000, intervalMs = 100): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return;
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(`Condition did not become true within ${timeoutMs}ms`);
}

describe("Zero-code BaaS over real PostgreSQL (E2E)", () => {
    let container: PgContainer;
    let connA: ReturnType<typeof createPostgresDatabaseConnection>;
    let connB: ReturnType<typeof createPostgresDatabaseConnection>;
    let replicaA: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    let replicaB: Awaited<ReturnType<typeof initializeRebaseBackend>>;
    const appA = new Hono<HonoEnv>();
    const appB = new Hono<HonoEnv>();
    const originalNodeEnv = process.env.NODE_ENV;
    let authHeaders: Record<string, string>;

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();

        connA = createPostgresDatabaseConnection(container.connectionString, undefined, { max: 4 });
        connB = createPostgresDatabaseConnection(container.connectionString, undefined, { max: 4 });

        replicaA = await initializeRebaseBackend({
            app: appA,
            server: createServer(),
            database: createPostgresAdapter({
                connection: connA.db,
                connectionString: container.connectionString,
                directConnectionString: container.connectionString
            }),
            auth: {
                allowRegistration: true,
                jwtSecret: JWT_SECRET
            }
        });

        replicaB = await initializeRebaseBackend({
            app: appB,
            server: createServer(),
            database: createPostgresAdapter({
                connection: connB.db,
                connectionString: container.connectionString,
                directConnectionString: container.connectionString
            }),
            auth: {
                allowRegistration: true,
                jwtSecret: JWT_SECRET
            }
        });

        const regRes = await appA.request("/api/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                email: "founder@rebase.pro",
                password: "StrongPassword123!",
                displayName: "Founder"
            })
        });
        expect(regRes.status).toBe(201);
        const regBody = await regRes.json() as { tokens: { accessToken: string } };
        authHeaders = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${regBody.tokens.accessToken}`
        };
    }, 180_000);

    afterAll(async () => {
        await replicaB?.shutdown(2_000).catch(() => {});
        await replicaA?.shutdown(2_000).catch(() => {});
        _resetRebaseMock();
        process.env.NODE_ENV = originalNodeEnv;
        await connB?.pool.end().catch(() => {});
        await connA?.pool.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("executes multi-statement DDL atomically on a single pg.Pool client and rolls back on failure", async () => {
        const sqlAdmin = replicaA.driver.admin;
        expect(isSQLAdmin(sqlAdmin)).toBe(true);
        if (!isSQLAdmin(sqlAdmin) || !sqlAdmin.executeSqlTransaction) {
            throw new Error("Expected SQLAdmin with executeSqlTransaction");
        }

        await expect(sqlAdmin.executeSqlTransaction([
            `CREATE TABLE "public"."pool_atomic_fail" ("id" integer PRIMARY KEY)`,
            `ALTER TABLE "public"."nonexistent_table_xyz" ADD COLUMN "bad" text`
        ])).rejects.toThrow();

        const check = await sqlAdmin.executeSql(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'pool_atomic_fail'`
        );
        expect(check).toHaveLength(0);

        await sqlAdmin.executeSqlTransaction([
            `CREATE TABLE "public"."pool_atomic_ok" ("id" integer PRIMARY KEY)`,
            `ALTER TABLE "public"."pool_atomic_ok" ENABLE ROW LEVEL SECURITY`,
            `DROP TABLE "public"."pool_atomic_ok"`
        ]);
    });

    it("propagates live DDL + table_meta + column changes from replica A to replica B via Postgres LISTEN/NOTIFY", async () => {
        // 1. Replica B initially serves no `projects` — only built-in auth's
        //    users table, which every project on built-in auth serves.
        const initialB = await appB.request("/api/data/projects", { headers: authHeaders });
        expect(initialB.status).toBe(404);

        // 2. Replica A creates `projects` with RLS + policy + historyEnabled: true
        const createRes = await appA.request("/api/admin/db/tables", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
                name: "projects",
                columns: [
                    { name: "id", type: "uuid", primaryKey: true, default: "gen_random_uuid()" },
                    { name: "name", type: "text", nullable: false }
                ],
                enableRls: true,
                policies: [
                    {
                        name: "projects_auth_all",
                        operation: "ALL",
                        using: "true",
                        withCheck: "true"
                    }
                ],
                meta: {
                    description: "Synced across replicas",
                    historyEnabled: true
                }
            })
        });
        expect(createRes.status).toBe(201);

        // 3. Replica B automatically receives NOTIFY rebase_schema_changed and serves `projects`
        await waitForCondition(async () => {
            const res = await appB.request("/api/schema/tables", { headers: authHeaders });
            if (res.status !== 200) return false;
            const tables = await res.json() as TableDescriptor[];
            return tables.some((t) => t.slug === "projects" && t.description === "Synced across replicas");
        });

        // 4. Insert on Replica B, verify automatic history recording on Replica B
        const insertRes = await appB.request("/api/data/projects", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({ name: "EU BaaS" })
        });
        expect(insertRes.status).toBe(201);
        const inserted = await insertRes.json() as { id: string; name: string };
        expect(inserted.id).toBeTruthy();

        // 5. Add a column on Replica A -> Replica B hot-reloads and accepts PATCH on the new column
        const addColRes = await appA.request("/api/admin/db/tables/projects/columns", {
            method: "POST",
            headers: authHeaders,
            body: JSON.stringify({
                name: "region",
                type: "text",
                nullable: false,
                default: "'eu-central'"
            })
        });
        expect(addColRes.status).toBe(201);

        await waitForCondition(async () => {
            const res = await appB.request("/api/schema/tables", { headers: authHeaders });
            if (res.status !== 200) return false;
            const tables = await res.json() as TableDescriptor[];
            const projects = tables.find((t) => t.slug === "projects");
            return Boolean(projects?.columns.some((c) => c.key === "region"));
        });

        const patchRes = await appB.request(`/api/data/projects/${inserted.id}`, {
            method: "PATCH",
            headers: authHeaders,
            body: JSON.stringify({ region: "eu-west" })
        });
        expect(patchRes.status).toBe(200);
        const patched = await patchRes.json() as { region: string };
        expect(patched.region).toBe("eu-west");

        // 6. Verify history captured both create + update on Replica B
        const historyRes = await appB.request(`/api/data/projects/${inserted.id}/history`, {
            headers: authHeaders
        });
        expect(historyRes.status).toBe(200);
        const historyBody = await historyRes.json() as { data: Array<{ action: string }> };
        expect(historyBody.data.map((h) => h.action)).toEqual(expect.arrayContaining(["create", "update"]));
    });
});
