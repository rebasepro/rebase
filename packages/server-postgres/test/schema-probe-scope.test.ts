/**
 * The schema read probes for rows only where the answer is used.
 *
 * Whether a table holds rows decides one thing: whether a NOT NULL or a
 * UNIQUE can arrive with a column being added to it. The read probed every
 * table in the schema on every boot — adopted and unmanaged ones included, a
 * full scan of a drained queue's dead tuples — for an answer a boot that
 * changes nothing never consults.
 */
import { PGlite } from "@electric-sql/pglite";
import type { CollectionConfig, PostgresProperties } from "@rebasepro/types";
import { ensureTables, type Queryable } from "../src/schema/ensure-tables";
import { compileSet } from "./helpers/plan-tables";

describe("the schema read's row probe", () => {
    const notes = (properties: PostgresProperties): CollectionConfig => ({
        slug: "notes", table: "notes", name: "Notes",
        properties: { id: { type: "string", isId: "uuid" }, body: { type: "string" }, ...properties }
    });
    const tags: CollectionConfig = {
        slug: "tags", table: "tags", name: "Tags",
        properties: { id: { type: "string", isId: "uuid" }, name: { type: "string" } }
    };

    it("probes only a table gaining a column, and still withholds NOT NULL where it holds rows", async () => {
        const pg = new PGlite();
        try {
            const ran: string[] = [];
            const queryable: Queryable = {
                async query<T>(text: string): Promise<{ rows: T[] }> {
                    ran.push(text);
                    const results = await pg.exec(text);
                    return { rows: (results[results.length - 1]?.rows ?? []) as T[] };
                }
            };
            const probes = () => ran.filter(text => /EXISTS\(SELECT 1 FROM/.test(text));
            await ensureTables(queryable, compileSet([notes({}), tags]));
            // An adopted table nobody declared, holding rows.
            await pg.exec(`CREATE TABLE public.legacy_archive (id int); INSERT INTO public.legacy_archive VALUES (1);
                           INSERT INTO public.notes (body) VALUES ('kept');`);

            ran.length = 0;
            const settled = await ensureTables(queryable, compileSet([notes({}), tags]));
            expect(settled.actions).toEqual([]);
            expect(probes()).toEqual([]);

            ran.length = 0;
            const changed = await ensureTables(queryable, compileSet([
                notes({ title: { type: "string", validation: { required: true } } }),
                tags
            ]));
            expect(probes()).toHaveLength(1);
            expect(probes()[0]).toMatch(/"public"\."notes"/);
            expect(probes()[0]).not.toMatch(/legacy_archive|"tags"/);
            // `notes` holds a row, so the required column arrives nullable.
            expect(changed.withheldConstraints.map(w => [w.target, w.kind])).toEqual([["public.notes.title", "not-null"]]);
        } finally {
            await pg.close();
        }
    }, 30_000);
});
