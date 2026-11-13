/**
 * E2E: a declared index adopts an identical index the database already has,
 * against a real Postgres (`schema/index-adoption.ts`).
 *
 * An application brought to Rebase declares the indexes it made by hand. The
 * boot and `db push` used to find a declared index only by its derived name,
 * so they built a twin beside the hand-made one and every write maintained
 * both. What must hold:
 *
 * - An identical index — same columns, order, direction, method, uniqueness —
 *   takes the derived name, and nothing is built.
 * - One that differs in any of those (here: direction) is left alone, and the
 *   declared index is built beside it.
 * - The next boot plans nothing; push's adoption plan agrees with the boot's.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureTables } from "../../src/schema/ensure-tables.js";
import { generatePostgresDdl } from "../../src/schema/generate-postgres-ddl-logic.js";
import { buildDeferredIndexes, poolIndexBuildSession } from "../../src/schema/deferred-index-build.js";
import { pushIndexAdoptions } from "../../src/schema/push-index-adoption.js";
import { compileSet } from "../helpers/plan-tables";

const events: CollectionConfig = {
    slug: "events", table: "events", name: "Events",
    properties: {
        id: { type: "number", isId: "increment" },
        kind: { type: "string" },
        at: { type: "date" },
        tags: { type: "array", columnType: "text[]", of: { type: "string" } }
    },
    indexes: [
        { on: ["kind", "at"], reason: "a kind's events by time" },
        { on: [{ prop: "at", direction: "desc" }], reason: "the latest events" },
        { on: ["tags"], using: "gin", reason: "events by tag" }
    ]
};

let container: PgContainer;

const queryable = (pool: pg.Pool) => ({
    query: async <T>(sql: string) => ({ rows: (await pool.query(sql)).rows as T[] })
});

async function boot(pool: pg.Pool) {
    const outcome = await ensureTables(queryable(pool), compileSet([events]), undefined, {
        deferIndexBuilds: true,
        lockTimeoutMs: 1_000,
        batchNewTables: true,
        databaseExtensions: [],
        openIndexBuildSession: poolIndexBuildSession(pool)
    });
    const background = await buildDeferredIndexes(poolIndexBuildSession(pool), outcome.deferredIndexes, { lockTimeoutMs: 1_000 });
    return { outcome, background };
}

/** Every index on `events` but the key's: `name → definition`. */
async function indexesOn(pool: pg.Pool): Promise<Record<string, string>> {
    const { rows } = await pool.query<{ name: string; def: string }>(
        "SELECT indexname AS name, indexdef AS def FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'events' AND indexname <> 'events_pkey' ORDER BY 1"
    );
    return Object.fromEntries(rows.map(row => [row.name, row.def]));
}

beforeAll(async () => {
    container = await startPgContainer();
}, 180_000);

afterAll(async () => {
    if (container) await stopPgContainer(container.containerName);
}, 120_000);

describe("adopting an identical existing index", () => {
    it("renames the identical ones to the declared names, builds beside the one that differs, and settles", async () => {
        const admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        await admin.query("CREATE DATABASE adoption");
        await admin.end();
        const url = new URL(container.connectionString);
        url.pathname = "/adoption";

        const ddl = generatePostgresDdl(compileSet([events]), { includePolicies: false });
        const declared = [...ddl.matchAll(/CREATE INDEX "(events_[a-z_]+_ix_[0-9a-f]{7})"/g)].map(match => match[1]);
        expect(declared).toHaveLength(3);

        const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
        try {
            await pool.query(ddl);
            await pool.query(declared.map(name => `DROP INDEX "${name}";`).join(" "));
            // What an application made by hand before declaring them: two
            // identical, and one over the same column in the other direction.
            await pool.query("CREATE INDEX events_kind_at ON public.events (kind, at)");
            await pool.query("CREATE INDEX events_tags ON public.events USING gin (tags)");
            await pool.query("CREATE INDEX events_at_asc ON public.events (at)");
            await pool.query("INSERT INTO public.events (kind, at, tags) SELECT 'k' || (g % 5), now() - g * interval '1 minute', ARRAY['t' || (g % 3)] FROM generate_series(1, 2000) g");

            const planned = await pushIndexAdoptions(queryable(pool), compileSet([events]));
            expect(planned.map(adoption => adoption.from).sort()).toEqual(["events_kind_at", "events_tags"]);

            const { outcome, background } = await boot(pool);
            expect(outcome.failures).toEqual([]);
            expect(background.failed).toEqual([]);

            const after = await indexesOn(pool);
            const kindAt = declared.find(name => name.startsWith("events_kind_at_"))!;
            const tags = declared.find(name => name.startsWith("events_tags_"))!;
            const atDesc = declared.find(name => name.startsWith("events_at_"))!;
            // Adopted: renamed, not rebuilt — the hand-made names are gone.
            expect(after[kindAt]).toMatch(/btree \(kind, at\)/);
            expect(after[tags]).toMatch(/gin \(tags\)/);
            expect(after.events_kind_at).toBeUndefined();
            expect(after.events_tags).toBeUndefined();
            // Not the same index (ascending, the declaration descends): kept,
            // and the declared one built beside it.
            expect(after.events_at_asc).toMatch(/btree \(at\)/);
            expect(after[atDesc]).toMatch(/btree \(at DESC\)/);
            expect(Object.keys(after)).toHaveLength(4);

            const next = await boot(pool);
            expect(next.outcome.deferredIndexes).toEqual([]);
            expect(await pushIndexAdoptions(queryable(pool), compileSet([events]))).toEqual([]);
        } finally {
            await pool.end();
        }
    }, 300_000);
});
