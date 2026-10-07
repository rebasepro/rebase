/**
 * E2E: the derived foreign-key indexes a live table is missing, built after
 * the boot — against a real Postgres, because every claim here is about how
 * Postgres behaves under `CREATE INDEX CONCURRENTLY`.
 *
 * ## What must hold
 *
 * - Several instances building the same indexes at once all finish, the
 *   database ends with exactly one VALID index per name, and each was built
 *   once. The race is real: without the per-index claim, concurrent
 *   `CREATE INDEX CONCURRENTLY` calls deadlock on each other's transactions
 *   (40P01) and leave husks — measured on the first run of this test.
 * - The husk a cancelled build leaves (`indisvalid = false`) is found, dropped
 *   and built again — `IF NOT EXISTS` alone would skip it forever.
 * - A build outlives the pool's `statement_timeout`: it runs on a connection
 *   of its own with the timeout lifted, and the connection goes back to the
 *   pool with the timeout restored.
 * - A table another session holds is given up on within the boot's lock
 *   budget, leaving nothing behind, instead of queueing indefinitely.
 * - Reads and writes are not blocked while a build runs.
 * - The bootstrapper never builds them before it serves: `ensureCollectionTables`
 *   with `deferIndexBuilds` plans and leaves them.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureCollectionTables, readExistingSchema } from "../../src/schema/ensure-collection-tables.js";
import { generatePostgresDdl } from "../../src/schema/generate-postgres-ddl-logic.js";
import { buildDeferredIndexes, poolIndexBuildSession } from "../../src/schema/deferred-index-build.js";
import { planCollectionSchemaEnsure } from "../../src/schema/ensure-collection-tables.js";

const authors = {
    slug: "authors", table: "authors", name: "Authors",
    properties: { id: { type: "number", isId: "increment" }, name: { type: "string" } }
} as unknown as CollectionConfig;
const tags = {
    slug: "tags", table: "tags", name: "Tags",
    properties: { id: { type: "number", isId: "increment" }, name: { type: "string" } }
} as unknown as CollectionConfig;
const posts = {
    slug: "posts", table: "posts", name: "Posts",
    properties: {
        id: { type: "number", isId: "increment" },
        title: { type: "string" },
        author: { type: "relation", relation: { kind: "belongsTo", target: () => authors } },
        tags: { type: "relation", relation: { kind: "manyToMany", target: () => tags } }
    }
} as unknown as CollectionConfig;
const collections = [authors, tags, posts];

let container: PgContainer;
let database = 0;

/** A fresh database holding the schema an older release pushed: everything but the derived indexes. */
async function preUpgradeDatabase(rows: number): Promise<{ url: string; names: string[] }> {
    const name = `fk_${++database}`;
    const admin = new pg.Client({ connectionString: container.connectionString });
    await admin.connect();
    try {
        await admin.query(`CREATE DATABASE ${name}`);
    } finally {
        await admin.end();
    }
    const url = new URL(container.connectionString);
    url.pathname = `/${name}`;

    const ddl = generatePostgresDdl(collections);
    const names = [...ddl.matchAll(/CREATE INDEX "([^"]+_id_ix_[0-9a-f]{7})"/g)].map(m => m[1]);
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
        await client.query(
            "CREATE SCHEMA IF NOT EXISTS rebase;" +
            "CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text LANGUAGE sql STABLE AS $$ SELECT NULL::text $$;" +
            "CREATE OR REPLACE FUNCTION rebase.roles() RETURNS text LANGUAGE sql STABLE AS $$ SELECT ''::text $$;"
        );
        await client.query(ddl.split("\n").filter(line => !names.some(n => line.includes(`"${n}"`))).join("\n"));
        await client.query(
            "INSERT INTO authors (name) SELECT 'a' || g FROM generate_series(1, 1000) g;" +
            `INSERT INTO posts (title, author_id) SELECT 'p', 1 + (g % 1000) FROM generate_series(1, ${rows}) g;` +
            "INSERT INTO tags (name) SELECT 't' || g FROM generate_series(1, 100) g;" +
            `INSERT INTO posts_tags (post_id, tag_id) SELECT g, 1 + (g % 100) FROM generate_series(1, ${rows}) g;`
        );
    } finally {
        await client.end();
    }
    return { url: url.toString(), names };
}

/** `name → valid` for every index in `public`. */
async function indexes(url: string): Promise<Record<string, boolean>> {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
        const { rows } = await client.query<{ name: string; valid: boolean }>(
            "SELECT c.relname AS name, i.indisvalid AS valid FROM pg_index i " +
            "JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace " +
            "WHERE n.nspname = 'public' AND c.relname LIKE '%\\_ix\\_%' ORDER BY 1"
        );
        return Object.fromEntries(rows.map(r => [r.name, r.valid]));
    } finally {
        await client.end();
    }
}

const queryable = (pool: pg.Pool) => ({
    query: async <T>(sql: string) => ({ rows: (await pool.query(sql)).rows as T[] })
});

beforeAll(async () => {
    container = await startPgContainer();
}, 180_000);

afterAll(async () => {
    if (container) await stopPgContainer(container.containerName);
}, 120_000);

describe("deferred foreign-key index builds", () => {
    it("the boot plans them and leaves them, so it never waits on a build", async () => {
        const { url, names } = await preUpgradeDatabase(1_000);
        const pool = new pg.Pool({ connectionString: url, max: 2 });
        try {
            const outcome = await ensureCollectionTables(queryable(pool), collections, undefined, {
                deferIndexBuilds: true, lockTimeoutMs: 1_000, batchNewTables: true
            });
            expect(outcome.deferredIndexes.map(d => d.indexName).sort()).toEqual([...names].sort());
            expect(await indexes(url)).toEqual({});
        } finally {
            await pool.end();
        }
    }, 120_000);

    it("five instances building at once end with one VALID index per name", async () => {
        const { url, names } = await preUpgradeDatabase(200_000);
        const pools = Array.from({ length: 5 }, () => new pg.Pool({ connectionString: url, max: 2 }));
        try {
            const deferred = planCollectionSchemaEnsure(
                collections, await readExistingSchema(queryable(pools[0]), ["public"])
            ).deferredIndexes;
            expect(deferred).toHaveLength(2);

            const outcomes = await Promise.all(pools.map(pool =>
                buildDeferredIndexes(poolIndexBuildSession(pool), deferred, { lockTimeoutMs: 1_000 })));

            expect(await indexes(url)).toEqual(Object.fromEntries(names.map(n => [n, true])));
            expect(outcomes.flatMap(o => o.failed)).toEqual([]);
            // One build per index: each is claimed, and the rest step aside.
            expect(outcomes.flatMap(o => o.built).sort()).toEqual(names.map(n => `public.${n}`).sort());

            // Nothing left that needs repair: the next boot finds the indexes
            // valid and plans nothing.
            const after = planCollectionSchemaEnsure(collections, await readExistingSchema(queryable(pools[0]), ["public"]));
            expect(after.deferredIndexes).toEqual([]);
        } finally {
            await Promise.all(pools.map(pool => pool.end()));
        }
    }, 300_000);

    it("finds the INVALID husk of a cancelled build, drops it and builds it again", async () => {
        const { url, names } = await preUpgradeDatabase(200_000);
        const pool = new pg.Pool({ connectionString: url, max: 2 });
        const killer = new pg.Client({ connectionString: url });
        await killer.connect();
        try {
            const deferred = planCollectionSchemaEnsure(collections, await readExistingSchema(queryable(pool), ["public"]))
                .deferredIndexes.find(d => d.table === "posts")!;
            // Cancel a real build part-way, the way a deploy replacing the pod
            // or a statement timeout does.
            const victim = new pg.Client({ connectionString: url });
            await victim.connect();
            await victim.query("SET statement_timeout = '30ms'");
            await expect(victim.query(deferred.sql)).rejects.toThrow(/statement timeout/);
            await victim.end();
            expect(await indexes(url)).toEqual({ [deferred.indexName]: false });

            // IF NOT EXISTS alone would call this done.
            const plan = planCollectionSchemaEnsure(collections, await readExistingSchema(queryable(pool), ["public"]));
            const husk = plan.deferredIndexes.find(d => d.indexName === deferred.indexName)!;
            expect(husk.invalid).toBe(true);

            const outcome = await buildDeferredIndexes(poolIndexBuildSession(pool), plan.deferredIndexes, { lockTimeoutMs: 1_000 });
            expect(outcome.failed).toEqual([]);
            expect(await indexes(url)).toEqual(Object.fromEntries(names.map(n => [n, true])));
        } finally {
            await killer.end();
            await pool.end();
        }
    }, 300_000);

    it("outlives the pool's statement_timeout, and hands the connection back with it restored", async () => {
        const { url, names } = await preUpgradeDatabase(300_000);
        // A timeout no build of this table fits in.
        const pool = new pg.Pool({ connectionString: url, max: 1, statement_timeout: 50 });
        try {
            const deferred = planCollectionSchemaEnsure(collections, await readExistingSchema(queryable(pool), ["public"]))
                .deferredIndexes;
            const outcome = await buildDeferredIndexes(poolIndexBuildSession(pool), deferred, { lockTimeoutMs: 1_000 });
            expect(outcome.failed).toEqual([]);
            expect(await indexes(url)).toEqual(Object.fromEntries(names.map(n => [n, true])));
            // `max: 1`: this is the very connection the builder used.
            const { rows } = await pool.query("SHOW statement_timeout");
            expect(rows[0].statement_timeout).toBe("50ms");
        } finally {
            await pool.end();
        }
    }, 300_000);

    it("gives up on a table another session holds within the lock budget, leaving nothing behind", async () => {
        const { url } = await preUpgradeDatabase(1_000);
        const pool = new pg.Pool({ connectionString: url, max: 2 });
        const holder = new pg.Client({ connectionString: url });
        await holder.connect();
        try {
            const deferred = planCollectionSchemaEnsure(collections, await readExistingSchema(queryable(pool), ["public"]))
                .deferredIndexes.filter(d => d.table === "posts");
            await holder.query("BEGIN");
            await holder.query("LOCK TABLE posts IN SHARE UPDATE EXCLUSIVE MODE");

            const started = Date.now();
            const outcome = await buildDeferredIndexes(poolIndexBuildSession(pool), deferred, {
                lockTimeoutMs: 100, attempts: 3, retryBudgetMs: 1_000, backoffMs: () => 50
            });
            expect(Date.now() - started).toBeLessThan(5_000);
            expect(outcome.failed).toEqual([expect.objectContaining({ error: expect.stringMatching(/stayed locked/) })]);
            expect(await indexes(url)).toEqual({});
        } finally {
            await holder.query("ROLLBACK").catch(() => undefined);
            await holder.end();
            await pool.end();
        }
    }, 120_000);

    it("does not block reads or writes while it builds", async () => {
        const { url } = await preUpgradeDatabase(1_000_000);
        const pool = new pg.Pool({ connectionString: url, max: 4 });
        try {
            const deferred = planCollectionSchemaEnsure(collections, await readExistingSchema(queryable(pool), ["public"]))
                .deferredIndexes.filter(d => d.table === "posts");
            const build = buildDeferredIndexes(poolIndexBuildSession(pool), deferred, { lockTimeoutMs: 1_000 });
            // Give the build time to take the table.
            await new Promise(resolve => setTimeout(resolve, 150));
            const writer = new pg.Client({ connectionString: url, statement_timeout: 2_000 });
            await writer.connect();
            try {
                const started = Date.now();
                await writer.query("INSERT INTO posts (title, author_id) VALUES ('during', 1)");
                await writer.query("SELECT count(*) FROM posts WHERE author_id = 1");
                expect(Date.now() - started).toBeLessThan(1_000);
            } finally {
                await writer.end();
            }
            const outcome = await build;
            expect(outcome.failed).toEqual([]);
            expect(outcome.built).toHaveLength(1);
        } finally {
            await pool.end();
        }
    }, 300_000);
});
