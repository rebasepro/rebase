/**
 * `databaseDefault: true` declares a DEFAULT somebody else wrote. The planner
 * writes none for it, so `schema.sql` had the column without one and Atlas
 * planned `DROP DEFAULT` on every push. The push now reads the live DEFAULT and
 * appends it to the desired state, so Atlas finds nothing to change.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig } from "@rebasepro/types";
import type { Queryable } from "../src/schema/ensure-collection-tables";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import {
    databaseOwnedDefaultColumns,
    keptDefaultStatements,
    readKeptDefaults,
    withKeptDefaults
} from "../src/schema/push-kept-defaults";

const items = {
    slug: "items",
    table: "items",
    name: "Items",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        code: { name: "Code", type: "string", validation: { required: true }, databaseDefault: true },
        refCode: { name: "Ref", type: "string", columnName: "ref_code_x", databaseDefault: true },
        seqno: { name: "Seq", type: "number", databaseDefault: true },
        owner: { name: "Owner", type: "string", databaseDefault: true },
        empty: { name: "Empty", type: "string", databaseDefault: true },
        stamped: { name: "Stamped", type: "string", databaseDefault: "sql`'stamp'`" }
    }
} as unknown as CollectionConfig;

const clientOf = (db: PGlite): Queryable => ({
    query: async <T,>(text: string) => ({ rows: (await db.query<T>(text)).rows })
});

/** `column → DEFAULT` of `public.items`, as the catalogue renders it. */
async function defaultsOf(db: PGlite): Promise<Record<string, string | null>> {
    const res = await db.query<{ column_name: string; column_default: string | null }>(
        "SELECT column_name, column_default FROM information_schema.columns " +
        "WHERE table_schema = 'public' AND table_name = 'items' ORDER BY column_name"
    );
    return Object.fromEntries(res.rows.map(row => [row.column_name, row.column_default]));
}

/** A database built from the collections, then given DEFAULTs by somebody else. */
async function liveDatabase(): Promise<PGlite> {
    const db = new PGlite();
    await db.exec(generatePostgresDdl([items], { includePolicies: false }));
    await db.exec(`
        CREATE SEQUENCE items_seqno_seq;
        CREATE FUNCTION my_owner() RETURNS text LANGUAGE sql AS $$ SELECT 'me' $$;
        ALTER TABLE items ALTER COLUMN code SET DEFAULT ('X-' || gen_random_uuid()::text);
        ALTER TABLE items ALTER COLUMN ref_code_x SET DEFAULT upper('r');
        ALTER TABLE items ALTER COLUMN seqno SET DEFAULT nextval('items_seqno_seq');
        ALTER TABLE items ALTER COLUMN owner SET DEFAULT my_owner();
        ALTER TABLE items ALTER COLUMN title SET DEFAULT 'not declared';
    `);
    return db;
}

describe("the DEFAULTs db push keeps for databaseDefault: true", () => {
    it("names the columns declared databaseDefault: true that the planner writes no DEFAULT for", () => {
        expect(databaseOwnedDefaultColumns([items])).toEqual([
            { schema: "public", table: "items", column: "code" },
            { schema: "public", table: "items", column: "ref_code_x" },
            { schema: "public", table: "items", column: "seqno" },
            { schema: "public", table: "items", column: "owner" },
            { schema: "public", table: "items", column: "empty" }
        ]);
    });

    it("reads nothing for collections without one", () => {
        const plain = { ...items, properties: { id: items.properties.id } } as unknown as CollectionConfig;
        expect(databaseOwnedDefaultColumns([plain])).toEqual([]);
    });

    it("reads the live DEFAULT of those columns, leaving out sequences, the database's own functions and undeclared columns", async () => {
        const db = await liveDatabase();
        try {
            const kept = await readKeptDefaults(clientOf(db), databaseOwnedDefaultColumns([items]));
            expect(kept).toEqual([
                { schema: "public", table: "items", column: "code", expression: "('X-'::text || (gen_random_uuid())::text)" },
                { schema: "public", table: "items", column: "ref_code_x", expression: "upper('r'::text)" }
            ]);
            // The read narrowed the search path inside its own transaction only.
            expect((await db.query<{ search_path: string }>("SHOW search_path")).rows[0].search_path)
                .toMatch(/public/);
        } finally {
            await db.close();
        }
    });

    it("leaves a desired state that loads into an empty database with exactly the DEFAULTs the live one has", async () => {
        const live = await liveDatabase();
        const scratch = new PGlite();
        try {
            const kept = await readKeptDefaults(clientOf(live), databaseOwnedDefaultColumns([items]));
            const desired = withKeptDefaults(generatePostgresDdl([items], { includePolicies: false }), kept);
            expect(desired).toContain('ALTER TABLE "public"."items" ALTER COLUMN "code" SET DEFAULT');

            // What Atlas does with `schema.sql`: run it in a scratch database
            // and compare that to the target.
            await scratch.exec(desired);
            const want = await defaultsOf(live);
            const got = await defaultsOf(scratch);
            expect(got.code).toBe(want.code);
            expect(got.ref_code_x).toBe(want.ref_code_x);
            // The expression form is the planner's own and is in `schema.sql` already.
            expect(got.stamped).toBe(want.stamped);
        } finally {
            await live.close();
            await scratch.close();
        }
    });

    it("quotes identifiers", () => {
        expect(keptDefaultStatements([{ schema: "s\"x", table: "t", column: "c", expression: "now()" }]))
            .toEqual(['ALTER TABLE "s""x"."t" ALTER COLUMN "c" SET DEFAULT now();']);
    });

    it("changes nothing when nothing is kept", () => {
        expect(withKeptDefaults("CREATE TABLE x ();\n", [])).toBe("CREATE TABLE x ();\n");
    });
});
