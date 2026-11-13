/**
 * What a backend with no `backend/schema` serves of a database, after the
 * lowering left the boot path.
 *
 * `lowerTables` used to sit between introspection and the runtime and refused
 * what the legacy shape could not hold; `compileIntrospectedTables` now decides
 * alone. A table keyed on a column no row can be addressed by (here `jsonb`)
 * is still dropped, with the reason — never refused at boot. A `jsonb[]`
 * column, which introspection states as the custom list type `jsonb[]`, is
 * served, and its values round-trip through the codec and the catalogue-built
 * table as the driver returns them.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

import { introspectTables } from "../src/schema/introspect-tables";
import { compileIntrospectedTables } from "../src/schema/introspect-runtime";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { serializeColumnToServer } from "../src/data-transformer";
import { toRestScalar } from "../src/services/row-pipeline";
import { columnAt, runtimeTableOfDef } from "./helpers/codec-columns";

const DDL = `
    CREATE TABLE public.notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        blocks jsonb[]
    );
    CREATE TABLE public.by_document (
        doc jsonb PRIMARY KEY,
        label text
    );
    ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.by_document ENABLE ROW LEVEL SECURITY;
    CREATE POLICY notes_all ON public.notes FOR ALL USING (true);
    CREATE POLICY by_document_all ON public.by_document FOR ALL USING (true);
`;

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => {
        const result = await db.query<T>(statement, values);
        return { rows: result.rows };
    }
});

describe("introspected tables the runtime serves, with the lowering gone", () => {
    let db: PGlite;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
        await db.exec(DDL);
    });

    afterEach(async () => {
        await db.close();
    });

    it("drops a table keyed on a jsonb column, naming why, and serves the rest", async () => {
        const { tables } = await introspectTables(queryable(db), "public");
        const servable = compileIntrospectedTables(tables);
        expect(servable.dropped).toEqual([{
            table: "by_document",
            reason: expect.stringContaining("doc: a `jsonb` column cannot be part of the key")
        }]);
        expect(servable.tables.map(table => table.slug)).toEqual(["notes"]);
    });

    it("serves a jsonb[] column as the list type it is: values round-trip through the codec and the catalogue table", async () => {
        const { tables } = await introspectTables(queryable(db), "public");
        const servable = compileIntrospectedTables(tables);
        const notes = servable.compiled.find(table => table.descriptor.slug === "notes");
        if (!notes) throw new Error("notes is not served");
        const runtime = runtimeTableOfDef(notes.def);
        const blocks = columnAt(runtime, "blocks");
        expect(blocks.type).toEqual({ kind: "other", sqlType: "jsonb[]" });

        const catalogue = await readCatalogueSchema({ client: queryable(db), tables: servable.tables, defaultSchema: "public" });
        const orm = drizzle(db, { schema: catalogue.tables });
        const written = [{ type: "text", value: "hello" }, { type: "list", value: [1, 2] }];
        const [row] = await orm.insert(catalogue.tables.notes)
            .values({ blocks: serializeColumnToServer(written, blocks, "blocks") })
            .returning();
        expect(toRestScalar(row.blocks, blocks)).toEqual(written);
        const { rows } = await db.query<{ second: unknown }>("SELECT blocks[2] AS second FROM public.notes");
        expect(rows[0].second).toEqual({ type: "list", value: [1, 2] });
    });
});
