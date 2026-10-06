/**
 * A first boot builds its new tables in a few transactions, not one commit per
 * statement.
 *
 * The planner creates each table with its key only and then adds every column,
 * constraint, trigger and index as its own statement — one way to build a
 * column, whether the table is new or not. Run one autocommit at a time, a
 * first deploy of 200 collections was 3,767 commits: 11.7 s on a disk that
 * really flushes, before the runtime served anything. A table the run creates
 * has no rows and nobody using it, so those statements can share a
 * transaction — and if one fails, the batch is replayed one statement at a
 * time, so every failure ends exactly as it always did.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import { ensureCollectionTables, type Queryable } from "../src/schema/ensure-collection-tables";

function makeCollections(n: number): CollectionConfig[] {
    const cols: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
        const props: Record<string, unknown> = {
            id: { type: "string", isId: "uuid" },
            title: { type: "string", validation: { required: true } },
            status: { type: "string", enum: { draft: "Draft", published: "Published" } },
            count: { type: "number", validation: { integer: true } },
            tags: { type: "array", of: { type: "string" } },
            meta: { type: "map", properties: { a: { type: "string" } } },
            updatedAt: { type: "date", autoValue: "on_update" }
        };
        if (i > 0) {
            const prev = i - 1;
            props.parent = { type: "relation", relation: { kind: "belongsTo", target: () => cols[prev], relationName: "parent", localKey: "parent_id" } };
        }
        if (i % 5 === 4) {
            const target = i - 2;
            props.links = {
                type: "relation",
                relation: { kind: "manyToMany", target: () => cols[target], relationName: "links", through: { table: `c${i}_links`, sourceColumn: "src_id", targetColumn: "dst_id" } }
            };
        }
        cols.push({ name: `C${i}`, slug: `c${i}`, table: `c${i}`, properties: props });
    }
    return cols as unknown as CollectionConfig[];
}

/**
 * An empty database that records every statement that is not a catalogue read,
 * and — separately — the ones that took effect: a failed batch takes none.
 */
function emptyDb(fail: (text: string) => Error | undefined = () => undefined) {
    const ddl: string[] = [];
    const applied: string[] = [];
    const client: Queryable = {
        async query<T>(text: string): Promise<{ rows: T[] }> {
            if (/^\s*(SELECT|WITH)\b/i.test(text)) return { rows: [] };
            ddl.push(text);
            const error = fail(text);
            if (error) throw error;
            applied.push(text);
            return { rows: [] };
        }
    };
    return { client, ddl, applied };
}

/** Statements as one comparable text, however they were grouped. */
const normalized = (statements: string[]): string =>
    statements.map(s => s.trim().replace(/;?$/, ";")).join("\n").replace(/\s+/g, " ");

/** PGlite over `exec` — the simple protocol node-postgres speaks. */
const simpleProtocol = (db: PGlite): Queryable => ({
    async query<T>(text: string): Promise<{ rows: T[] }> {
        const results = await db.exec(text);
        return { rows: (results[results.length - 1]?.rows ?? []) as T[] };
    }
});

/** Everything the ensure builds, as comparable text. */
async function describeSchema(db: PGlite): Promise<string[]> {
    const queries = [
        `SELECT table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, '')
           FROM information_schema.columns WHERE table_schema = 'public'`,
        `SELECT conrelid::regclass::text || ' ' || conname || ' ' || pg_get_constraintdef(oid)
           FROM pg_constraint WHERE connamespace = 'public'::regnamespace`,
        "SELECT indexdef FROM pg_indexes WHERE schemaname = 'public'",
        "SELECT tgrelid::regclass::text || ' ' || pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal",
        "SELECT relname || ' rls=' || relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'",
        `SELECT t.typname || ' ' || string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid GROUP BY t.typname`
    ];
    const lines: string[] = [];
    for (const query of queries) {
        const { rows } = await db.query<Record<string, string>>(query);
        lines.push(...rows.map(row => Object.values(row)[0]));
    }
    return lines.sort();
}

describe("a first boot's new tables", () => {
    it("are built in a handful of transactions", async () => {
        const collections = makeCollections(20);
        const perStatement = emptyDb();
        await ensureCollectionTables(perStatement.client, collections, undefined, { databaseExtensions: [] });
        const batched = emptyDb();
        await ensureCollectionTables(batched.client, collections, undefined, { databaseExtensions: [], batchNewTables: true });

        // Today's one-per-statement count, for scale, and the batched one.
        expect(perStatement.ddl.length).toBeGreaterThan(250);
        expect(batched.ddl.length).toBeLessThanOrEqual(20);
        // The same statements, in the same order — only grouped.
        expect(normalized(batched.ddl)).toEqual(normalized(perStatement.ddl));
    });

    it("leave the database exactly as one statement at a time does", async () => {
        const collections = makeCollections(10);
        const one = new PGlite();
        const many = new PGlite();
        try {
            await ensureCollectionTables(simpleProtocol(one), collections, undefined, { databaseExtensions: [] });
            await ensureCollectionTables(simpleProtocol(many), collections, undefined, { databaseExtensions: [], batchNewTables: true });
            const expected = await describeSchema(one);
            expect(expected.length).toBeGreaterThan(50);
            expect(await describeSchema(many)).toEqual(expected);
        } finally {
            await one.close();
            await many.close();
        }
    }, 60_000);

    it("are replayed one statement at a time when a batch fails", async () => {
        // A foreign key that cannot be added is survivable: recorded, not fatal.
        // Inside a batch it fails the whole transaction; the replay must still
        // end with every other statement applied and that one failure recorded.
        const collections = makeCollections(3);
        const fkFails = (text: string) => (/ADD CONSTRAINT[^\n]*c2_parent_id/.test(text) ? new Error("fk refused") : undefined);
        const batched = emptyDb(fkFails);
        const outcome = await ensureCollectionTables(batched.client, collections, undefined, { databaseExtensions: [], batchNewTables: true });
        const perStatement = emptyDb(fkFails);
        const expected = await ensureCollectionTables(perStatement.client, collections, undefined, { databaseExtensions: [] });

        expect(outcome.failures.map(f => f.target)).toEqual(expected.failures.map(f => f.target));
        expect(outcome.failures).toHaveLength(1);
        // A batch was tried and refused...
        expect(batched.ddl.some(s => s.includes("\n") && /c2_parent_id/.test(s))).toBe(true);
        // ...and what took effect is exactly what one statement at a time does.
        expect(normalized(batched.applied)).toEqual(normalized(perStatement.applied));
    });
});
