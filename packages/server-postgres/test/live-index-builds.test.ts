/**
 * Every index a table that already exists needs goes through the index
 * builder — declared, search and vector ones as well as the derived
 * foreign-key ones — and so does any of ours that a cancelled concurrent
 * build left INVALID.
 *
 * Boot used to issue declared, search and vector indexes on a live table as
 * `CREATE INDEX CONCURRENTLY IF NOT EXISTS` actions on the provisioning pool.
 * Two things went wrong with that:
 *
 * - The pool's 30 s `statement_timeout` cancelled any build that took longer.
 *   A cancelled `CONCURRENTLY` leaves the index behind marked
 *   `indisvalid = false`: maintained on every write and used by no query.
 * - `IF NOT EXISTS` checks the name. Every later boot found the husk by name and
 *   skipped it, so the index was never built and nothing said so.
 *
 * The builder runs on a connection of its own with no `statement_timeout`, reads
 * `pg_index.indisvalid`, and drops and rebuilds a husk once. On the boot it runs
 * after the server is serving, except for a UNIQUE index. A UNIQUE index is the
 * collection promising that two rows cannot share a value, so it is built
 * before the ensure returns and fails it when it cannot, as before.
 *
 * The real-Postgres half (a build longer than the pool's timeout) is
 * `test/e2e/live-index-build-e2e.test.ts`.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import { planSchema } from "../src/schema/plan/plan-schema";
import { diffPlanAgainstCatalogue, type ExistingSchema } from "../src/schema/plan/diff-plan";
import { ensureCollectionTables, planCollectionSchemaEnsure } from "../src/schema/ensure-collection-tables";

const notes = {
    slug: "notes",
    table: "notes",
    name: "Notes",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { type: "string" },
        slug: { type: "string" },
        embedding: { type: "vector", name: "Embedding", dimensions: 3 }
    },
    indexes: [
        { on: ["title"], reason: "title lookups" },
        { on: ["slug"], unique: true, reason: "one note per slug" }
    ],
    search: { fields: ["title"] }
} as unknown as CollectionConfig;

/** `notes` without the vector column, which PGlite cannot store without pgvector. */
const plainNotes = {
    ...(notes as unknown as Record<string, unknown>),
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { type: "string" },
        slug: { type: "string" }
    }
} as unknown as CollectionConfig;

/** A catalogue holding every table and column the plan wants, and no index. */
function liveCatalogue(collections: CollectionConfig[]): ExistingSchema {
    const plan = planSchema(collections, { databaseExtensions: [] });
    const tables = new Map<string, Set<string>>();
    for (const table of plan.tables) {
        const columns = new Set(table.columns.map(column => column.column));
        if (table.search) {
            columns.add(table.search.column);
            if (table.search.fuzzy) columns.add(table.search.fuzzy.column);
        }
        tables.set(table.qualified, columns);
    }
    return { tables, enums: new Set(), constraints: new Set(), indexes: new Set(), invalidIndexes: new Set() };
}

const indexNameOf = (sql: string): string => /INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?"([^"]+)"/.exec(sql)![1];

describe("planning the indexes of a table that already exists", () => {
    const plan = (existing: ExistingSchema, deferLiveIndexes?: boolean) =>
        diffPlanAgainstCatalogue(planSchema([notes], { databaseExtensions: [] }), existing, { deferLiveIndexes });

    it("hands every missing one to the builder, concurrently, and plans no index action", () => {
        const result = plan(liveCatalogue([notes]), true);

        expect(result.actions.filter(a => a.kind === "create-index")).toEqual([]);
        const names = result.deferredIndexes.map(d => d.indexName);
        expect(names).toEqual(expect.arrayContaining([
            expect.stringMatching(/^notes_title_ix_[0-9a-f]{7}$/),
            expect.stringMatching(/^notes_slug_ux_[0-9a-f]{7}$/),
            expect.stringMatching(/_gin$/),
            expect.stringMatching(/^notes_embedding_hnsw_/)
        ]));
        for (const deferred of result.deferredIndexes) {
            expect(deferred.sql).toMatch(/^CREATE (UNIQUE )?INDEX CONCURRENTLY IF NOT EXISTS "/);
            expect(deferred.invalid).toBe(false);
            expect(deferred.unique === true).toBe(deferred.indexName.includes("_ux_"));
        }
    });

    it("finds an INVALID husk under our name, which IF NOT EXISTS would skip forever", () => {
        const first = plan(liveCatalogue([notes]), true).deferredIndexes;
        const live = liveCatalogue([notes]);
        const all = first.map(d => `public.${d.indexName}`);
        const husk = all.find(name => name.includes("_title_ix_"))!;

        const result = plan({ ...live, indexes: new Set(all), invalidIndexes: new Set([husk]) }, true);
        expect(result.deferredIndexes).toEqual([
            expect.objectContaining({ indexName: husk.slice("public.".length), invalid: true })
        ]);
        // Every index present and valid: nothing to do.
        expect(plan({ ...live, indexes: new Set(all) }, true).deferredIndexes).toEqual([]);
    });

    it("leaves a table this plan creates to build its indexes with it", () => {
        const result = plan({ tables: new Map(), enums: new Set() }, true);
        expect(result.deferredIndexes).toEqual([]);
        expect(result.actions.filter(a => a.kind === "create-index").every(a => !/CONCURRENTLY/.test(a.sql))).toBe(true);
    });

    it("keeps them actions for the live schema editor, which applies statements as text", () => {
        const result = planCollectionSchemaEnsure([notes], liveCatalogue([notes]));
        const actions = result.actions.filter(a => a.kind === "create-index").map(a => a.sql);
        expect(actions).toHaveLength(4);
        expect(actions.every(sql => /CONCURRENTLY IF NOT EXISTS/.test(sql))).toBe(true);
        expect(result.deferredIndexes).toEqual([]);
    });
});

describe("building them on a database that already exists", () => {
    const asQueryable = (db: PGlite) => ({
        query: <R,>(text: string) => db.query<R>(text) as Promise<{ rows: R[] }>
    });

    /** `name → valid` for every index in `public` but the primary keys. */
    const indexesOf = async (db: PGlite): Promise<Record<string, boolean>> => {
        const { rows } = await db.query<{ name: string; valid: boolean }>(
            "SELECT c.relname AS name, i.indisvalid AS valid FROM pg_index i " +
            "JOIN pg_class c ON c.oid = i.indexrelid JOIN pg_namespace n ON n.oid = c.relnamespace " +
            "WHERE n.nspname = 'public' AND NOT i.indisprimary ORDER BY 1"
        );
        return Object.fromEntries(rows.map(r => [r.name, r.valid]));
    };

    /** What `db push` would make of `plainNotes`, with some rows in it. */
    const pushed = async (): Promise<{ db: PGlite; names: string[] }> => {
        const db = new PGlite();
        await db.exec(generatePostgresDdl([plainNotes], { includePolicies: false }));
        await db.exec(
            "INSERT INTO public.notes (id, title, slug) VALUES " +
            "('11111111-1111-1111-1111-111111111111', 'a', 'a'), ('22222222-2222-2222-2222-222222222222', 'b', 'b');"
        );
        return { db, names: Object.keys(await indexesOf(db)) };
    };

    it("repairs a declared index a cancelled build left INVALID", async () => {
        const { db, names } = await pushed();
        try {
            const title = names.find(name => name.includes("_title_ix_"))!;
            await db.exec(`UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public."${title}"'::regclass`);
            expect((await indexesOf(db))[title]).toBe(false);

            const outcome = await ensureCollectionTables(asQueryable(db), [plainNotes], undefined, { databaseExtensions: [] });

            expect(outcome.deferredIndexes).toEqual([expect.objectContaining({ indexName: title, invalid: true })]);
            expect(outcome.indexBuilds?.built).toEqual([`public.${title}`]);
            expect(await indexesOf(db)).toEqual(Object.fromEntries(names.map(name => [name, true])));

            // From then on there is nothing to do.
            const again = await ensureCollectionTables(asQueryable(db), [plainNotes], undefined, { databaseExtensions: [] });
            expect(again.deferredIndexes).toEqual([]);
            expect(again.actions).toEqual([]);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("repairs a search index a cancelled build left INVALID", async () => {
        const { db, names } = await pushed();
        try {
            const gin = names.find(name => name.endsWith("_gin"))!;
            await db.exec(`UPDATE pg_index SET indisvalid = false WHERE indexrelid = 'public."${gin}"'::regclass`);

            const outcome = await ensureCollectionTables(asQueryable(db), [plainNotes], undefined, { databaseExtensions: [] });

            expect(outcome.indexBuilds?.built).toEqual([`public.${gin}`]);
            expect((await indexesOf(db))[gin]).toBe(true);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("on a boot, leaves the missing ones to the background but builds a UNIQUE one first", async () => {
        const { db, names } = await pushed();
        try {
            for (const name of names) await db.exec(`DROP INDEX public."${name}"`);

            const outcome = await ensureCollectionTables(asQueryable(db), [plainNotes], undefined, {
                databaseExtensions: [], deferIndexBuilds: true
            });

            const slug = names.find(name => name.includes("_slug_ux_"))!;
            // Built before the ensure returned, so nothing serves without it.
            expect(outcome.indexBuilds?.built).toEqual([`public.${slug}`]);
            expect(await indexesOf(db)).toEqual({ [slug]: true });
            // The rest are the caller's, to build once it is serving.
            expect(outcome.deferredIndexes.map(d => d.indexName).sort())
                .toEqual(names.filter(name => name !== slug).sort());
            expect(outcome.actions.filter(a => a.kind === "create-index")).toEqual([]);
        } finally {
            await db.close();
        }
    }, 30_000);

    it("still fails the ensure when a UNIQUE index cannot be built — a promise, not a speedup", async () => {
        const { db, names } = await pushed();
        try {
            const slug = names.find(name => name.includes("_slug_ux_"))!;
            await db.exec(`DROP INDEX public."${slug}"`);
            await db.exec("UPDATE public.notes SET slug = 'same'");

            await expect(ensureCollectionTables(asQueryable(db), [plainNotes], undefined, {
                databaseExtensions: [], deferIndexBuilds: true
            })).rejects.toThrow(new RegExp(`${slug}[\\s\\S]*could not create unique index`));
        } finally {
            await db.close();
        }
    }, 30_000);
});
