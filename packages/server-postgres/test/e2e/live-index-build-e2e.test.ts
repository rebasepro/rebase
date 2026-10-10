/**
 * E2E: a declared index on a table that already exists, built by the boot
 * against a real Postgres.
 *
 * The boot used to issue it as a `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
 * action on the provisioning pool. The pool's `statement_timeout` cancelled any
 * build that took longer, and a cancelled `CONCURRENTLY` leaves the index
 * INVALID under its name, which every later boot's `IF NOT EXISTS` skipped.
 * So a large table never got its index, and nothing said so.
 *
 * Now it goes through the same builder as the derived foreign-key indexes: a
 * connection of its own with no `statement_timeout`, and an INVALID husk is
 * dropped and rebuilt. What must hold:
 *
 * - A build longer than the pool's `statement_timeout` completes, and the
 *   connection goes back to the pool with the timeout restored.
 * - The husk a cancelled build left is VALID after one boot.
 * - A UNIQUE index is built before the ensure returns, however long it takes.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureCollectionTables } from "../../src/schema/ensure-collection-tables.js";
import { generatePostgresDdl } from "../../src/schema/generate-postgres-ddl-logic.js";
import { buildDeferredIndexes, poolIndexBuildSession } from "../../src/schema/deferred-index-build.js";

const articles = {
    slug: "articles", table: "articles", name: "Articles",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        code: { type: "string" }
    },
    indexes: [
        { on: ["title"], reason: "title lookups" },
        { on: ["code"], unique: true, reason: "one article per code" }
    ]
} as unknown as CollectionConfig;

let container: PgContainer;
let database = 0;

/** A fresh database holding what `db push` makes of `articles`, minus its indexes, and `rows` rows. */
async function liveDatabase(rows: number): Promise<{ url: string; names: { title: string; code: string } }> {
    const name = `live_ix_${++database}`;
    const admin = new pg.Client({ connectionString: container.connectionString });
    await admin.connect();
    try {
        await admin.query(`CREATE DATABASE ${name}`);
    } finally {
        await admin.end();
    }
    const url = new URL(container.connectionString);
    url.pathname = `/${name}`;

    const ddl = generatePostgresDdl([articles], { includePolicies: false });
    const title = /CREATE INDEX "(articles_title_ix_[0-9a-f]{7})"/.exec(ddl)![1];
    const code = /CREATE UNIQUE INDEX "(articles_code_ux_[0-9a-f]{7})"/.exec(ddl)![1];
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
        await client.query(ddl);
        await client.query(`DROP INDEX "${title}"; DROP INDEX "${code}";`);
        await client.query(
            `INSERT INTO articles (title, code) SELECT md5(g::text) || md5((g * 7)::text), 'c' || g FROM generate_series(1, ${rows}) g`
        );
    } finally {
        await client.end();
    }
    return { url: url.toString(), names: { title, code } };
}

/** `name → valid` for the declared indexes in `public`. */
async function indexes(url: string): Promise<Record<string, boolean>> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        const { rows } = await client.query<{ name: string; valid: boolean }>(
            "SELECT c.relname AS name, i.indisvalid AS valid FROM pg_index i " +
            "JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace " +
            "WHERE n.nspname = 'public' AND (c.relname LIKE '%\\_ix\\_%' OR c.relname LIKE '%\\_ux\\_%') ORDER BY 1"
        );
        return Object.fromEntries(rows.map(r => [r.name, r.valid]));
    } finally {
        await client.end();
    }
}

const queryable = (pool: pg.Pool) => ({
    query: async <T>(sql: string) => ({ rows: (await pool.query(sql)).rows as T[] })
});

/** The boot: ensure with the builds deferred, then the background build it schedules. */
async function boot(pool: pg.Pool) {
    const outcome = await ensureCollectionTables(queryable(pool), [articles], undefined, {
        deferIndexBuilds: true,
        lockTimeoutMs: 1_000,
        batchNewTables: true,
        databaseExtensions: [],
        openIndexBuildSession: poolIndexBuildSession(pool)
    });
    const background = await buildDeferredIndexes(poolIndexBuildSession(pool), outcome.deferredIndexes, { lockTimeoutMs: 1_000 });
    return { outcome, background };
}

beforeAll(async () => {
    container = await startPgContainer();
}, 180_000);

afterAll(async () => {
    if (container) await stopPgContainer(container.containerName);
}, 120_000);

describe("declared indexes on a table that already exists", () => {
    it("are built past the pool's statement_timeout, the UNIQUE one before the ensure returns", async () => {
        const { url, names } = await liveDatabase(400_000);
        // A timeout no build of this table fits in; `max: 1`, so the builder's
        // connection is the one every later query gets.
        const pool = new pg.Pool({ connectionString: url, max: 1, statement_timeout: 50 });
        try {
            const { outcome, background } = await boot(pool);

            expect(outcome.failures).toEqual([]);
            expect(outcome.indexBuilds?.built).toEqual([`public.${names.code}`]);
            expect(outcome.deferredIndexes.map(d => d.indexName)).toEqual([names.title]);
            expect(background.failed).toEqual([]);
            expect(background.built).toEqual([`public.${names.title}`]);
            expect(await indexes(url)).toEqual({ [names.code]: true, [names.title]: true });

            const { rows } = await pool.query("SHOW statement_timeout");
            expect(rows[0].statement_timeout).toBe("50ms");
        } finally {
            await pool.end();
        }
    }, 300_000);

    it("repairs the INVALID husk a cancelled build left, in one boot", async () => {
        const { url, names } = await liveDatabase(400_000);
        // What the old boot did on a pool with a short timeout: start the build
        // concurrently and have it cancelled part-way.
        const victim = new pg.Client({ connectionString: url, statement_timeout: 30 });
        await victim.connect();
        try {
            await expect(victim.query(`CREATE INDEX CONCURRENTLY IF NOT EXISTS "${names.title}" ON public.articles ("title")`))
                .rejects.toThrow(/statement timeout/);
        } finally {
            await victim.end();
        }
        expect(await indexes(url)).toEqual({ [names.title]: false });

        const pool = new pg.Pool({ connectionString: url, max: 2, statement_timeout: 50 });
        try {
            const { outcome, background } = await boot(pool);
            expect(outcome.deferredIndexes).toEqual([expect.objectContaining({ indexName: names.title, invalid: true })]);
            expect(background.built).toEqual([`public.${names.title}`]);
            expect(await indexes(url)).toEqual({ [names.code]: true, [names.title]: true });

            // Settled: the next boot plans nothing.
            const next = await boot(pool);
            expect(next.outcome.deferredIndexes).toEqual([]);
            expect(next.outcome.indexBuilds).toBeUndefined();
        } finally {
            await pool.end();
        }
    }, 300_000);
});
