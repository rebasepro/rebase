/**
 * The throwaway database `rebase db push` hands Atlas on the managed database.
 *
 * Atlas refuses a dev database that is not empty, and fails on a replay the
 * dev database cannot run. Both are checked against a real instance.
 */

import pg from "pg";
import { describe, expect, it } from "vitest";

import { startAtlasDevDatabase } from "./atlas-dev-database";

describe("startAtlasDevDatabase", () => {
    it("serves an empty database that takes the managed database's extensions, then goes away", async () => {
        const dev = await startAtlasDevDatabase();
        try {
            const client = new pg.Client({ connectionString: dev.url });
            await client.connect();
            try {
                const tables = await client.query(
                    "SELECT count(*)::int AS n FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')"
                );
                expect(tables.rows[0].n).toBe(0);
                // What a search or vector collection's schema replays.
                await client.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
                await client.query("CREATE EXTENSION IF NOT EXISTS vector");
                await client.query("CREATE TABLE probe (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), v vector(3))");
            } finally {
                await client.end();
            }
        } finally {
            await dev.stop();
            await dev.stop();
        }

        const after = new pg.Client({ connectionString: dev.url, connectionTimeoutMillis: 1000 });
        await expect(after.connect()).rejects.toThrow();
    }, 60_000);

    it("is a database of its own each time", async () => {
        const first = await startAtlasDevDatabase();
        const second = await startAtlasDevDatabase();
        try {
            expect(first.url).not.toBe(second.url);
        } finally {
            await first.stop();
            await second.stop();
        }
    }, 60_000);
});
