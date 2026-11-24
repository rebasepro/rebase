/**
 * E2E: a server whose pools could take most of the database's connections
 * says so at boot.
 *
 * The hosted demo ran the default 20-connection main pool, three instances
 * deep, against a 25-connection database, and the first sign was SQLSTATE
 * 53300 "too many clients" in front of a user. Now the boot reads what the
 * database accepts and warns when one process may use more than half of it.
 *
 * The real boot against a real Postgres started with `max_connections=25`:
 * default pools warn, naming both numbers and the fix; `REBASE_DB_POOL_MAX=5`
 * — what the demo now runs — does not.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createServer } from "node:http";
import { Hono } from "hono";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { resetConnectionBudget } from "../../src/connection-budget.js";
import { initializeRebaseBackend, logger, _resetRebaseMock } from "../../../server/src/index.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import { tablesFrom } from "../helpers/tables.js";

const JWT_SECRET = "connection-budget-e2e-secret-that-is-long-enough-0123456789";

const notes: LegacyCollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" }
    }
};

const BUDGET_WARNING = /This process can open \d+ connections; PostgreSQL at .* accepts \d+/;

describe("the boot weighs its pools against max_connections (E2E)", () => {
    let container: PgContainer;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalPoolMax = process.env.REBASE_DB_POOL_MAX;
    let shutdown: (() => Promise<void>) | undefined;

    /** Boot a server the way `rebase-server` does, and return what it warned. */
    async function bootAndCollectWarnings(): Promise<string[]> {
        const warnings: string[] = [];
        vi.spyOn(logger, "warn").mockImplementation((message: string) => { warnings.push(String(message)); });
        const connection = createPostgresDatabaseConnection(container.connectionString);
        const backend = await initializeRebaseBackend({
            app: new Hono<HonoEnv>(),
            server: createServer(),
            ...tablesFrom([notes]),
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET }
        });
        shutdown = async () => {
            await backend.shutdown(1_000).catch(() => {});
            await connection.pool.end().catch(() => {});
        };
        return warnings.filter(message => BUDGET_WARNING.test(message));
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer({ args: ["-c", "max_connections=25"] });
    }, 180_000);

    afterEach(async () => {
        await shutdown?.();
        shutdown = undefined;
        vi.restoreAllMocks();
        _resetRebaseMock();
        resetConnectionBudget();
        if (originalPoolMax === undefined) delete process.env.REBASE_DB_POOL_MAX;
        else process.env.REBASE_DB_POOL_MAX = originalPoolMax;
    }, 60_000);

    afterAll(async () => {
        process.env.NODE_ENV = originalNodeEnv;
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("warns with default pools: 20 of the 22 usable slots is the main pool alone", async () => {
        delete process.env.REBASE_DB_POOL_MAX;
        const warnings = await bootAndCollectWarnings();
        expect(warnings, "one warning").toHaveLength(1);
        const [warning] = warnings;
        expect(warning).toContain("accepts 22");
        expect(warning).toContain("22 usable = max_connections 25 − 3 reserved for superusers");
        expect(warning).toContain("main pool 20");
        expect(warning).toMatch(/REBASE_DB_POOL_MAX=\d+/);
        expect(warning).not.toContain("rebase:rebase@");
    });

    it("stays quiet with REBASE_DB_POOL_MAX=5", async () => {
        process.env.REBASE_DB_POOL_MAX = "5";
        expect(await bootAndCollectWarnings()).toEqual([]);
    });
});
