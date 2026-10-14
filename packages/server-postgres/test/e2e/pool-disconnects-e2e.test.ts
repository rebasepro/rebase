/**
 * E2E: the server ending a backend's idle connections is one WARN line.
 *
 * `rebase db branch create --force` closes the database it copies with
 * `pg_terminate_backend`, and each idle pool connection heard it as an error:
 * fifteen forced creates beside a running `rebase dev` printed 220
 * `❌ [ERROR] [pg-pool] Unexpected pool error` lines. Here a real backend's
 * main and direct pools hold idle connections, they are terminated the way
 * `BranchService` terminates them, and what the pools logged is counted. The
 * pool must then still answer.
 *
 * Requires Docker.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { logger } from "@rebasepro/server";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createDirectDatabaseConnection, createPostgresDatabaseConnection } from "../../src/connection.js";

describe("the server ends a backend's idle connections", () => {
    let container: PgContainer;

    beforeAll(async () => {
        container = await startPgContainer();
    }, 120_000);

    afterAll(async () => {
        if (container) await stopPgContainer(container.containerName);
    }, 30_000);

    it("says so once, at WARN, and the pools still answer", async () => {
        const main = createPostgresDatabaseConnection(container.connectionString, undefined, { max: 6 }, {});
        const direct = createDirectDatabaseConnection(container.connectionString, undefined, { max: 3 });
        try {
            // Every connection opened and handed back, so each is idle in its pool.
            const held = await Promise.all([
                ...Array.from({ length: 6 }, () => main.pool.connect()),
                ...Array.from({ length: 3 }, () => direct.pool.connect())
            ]);
            for (const client of held) client.release();

            const warn = vi.spyOn(logger, "warn");
            const error = vi.spyOn(logger, "error");
            const admin = new pg.Client({ connectionString: container.connectionString });
            await admin.connect();
            try {
                // What `BranchService` runs before `CREATE DATABASE … TEMPLATE`.
                const { rows } = await admin.query<{ ended: number }>(
                    `SELECT count(*)::int AS ended FROM (
                        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
                         WHERE datname = current_database() AND pid <> pg_backend_pid()
                     ) terminated`
                );
                expect(rows[0].ended).toBeGreaterThanOrEqual(9);
            } finally {
                await admin.end();
            }
            await vi.waitFor(() => expect(main.pool.idleCount + direct.pool.idleCount).toBe(0), { timeout: 5_000 });

            const said = [...warn.mock.calls, ...error.mock.calls].map(call => String(call[0])).filter(line => line.includes("pool"));
            expect(error.mock.calls.filter(call => String(call[0]).includes("pool"))).toEqual([]);
            expect(said).toHaveLength(1);
            expect(said[0]).toContain("The database ended this server's idle connections (terminating connection due to administrator command, 57P01)");

            expect((await main.pool.query<{ one: number }>("SELECT 1 AS one")).rows[0].one).toBe(1);
            expect((await direct.pool.query<{ one: number }>("SELECT 1 AS one")).rows[0].one).toBe(1);
        } finally {
            vi.restoreAllMocks();
            await main.pool.end();
            await direct.pool.end();
        }
    }, 60_000);
});
