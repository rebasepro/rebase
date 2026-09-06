/**
 * E2E: the value REST serves for each property kind has the type the generated
 * SDK says it has.
 *
 * The generator writes `price: number` into `database.types.ts` for a property
 * declared `type: "number"`. Postgres stores that as `numeric`, sends `numeric`
 * as text, and node-postgres registers no parser for it — so the row that came
 * back said `"2.5"` while every type in the project said `2.5`. Nothing caught
 * it because no test compared the two: the codegen tests read the generated
 * text, and the driver tests read rows out of fixtures that never round-tripped
 * through a real column.
 *
 * So this test does exactly that comparison. It provisions the table from the
 * collection config (the runtime's own `ensureCollectionTables`, so the SQL
 * types are the ones a real boot produces), writes one row, reads it back
 * through the REST read path, and compares `typeof` — after the JSON trip a
 * client's response makes — against the TypeScript type `@rebasepro/codegen`
 * emits for the same property.
 *
 * The table is deliberately named `wire_types` (snake case) and registered in
 * the drizzle schema under `wireTypes` — that is what `rebase schema generate`
 * emits, and it is why the REST renderer's own numeric coercion never ran on
 * the collection the sweep found: drizzle's relational query builder is keyed by
 * the export name, so a snake-case table takes the `select` fallback, which does
 * not go through that renderer. The cast therefore has to live in the column
 * mapping, and this test pins it there.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { CollectionConfig } from "@rebasepro/types";
import { generateTypedefs } from "@rebasepro/codegen";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { ensureCollectionTables, type Queryable } from "../../src/schema/ensure-collection-tables.js";
import { introspectSchema } from "../../src/schema/introspect-runtime.js";
import { buildDrizzleTablesFromSchema } from "../../src/schema/dynamic-tables.js";
import { patchPgNumericToNumber } from "../../src/utils/pg-numeric-number-patch.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";

const wireTypes: CollectionConfig = {
    name: "Wire Types",
    slug: "wire-types",
    table: "wire_types",
    schema: "public",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        // The one the sweep found: `number` with no `validation.integer` is a
        // NUMERIC column.
        price: { name: "Price", type: "number" },
        quantity: { name: "Quantity", type: "number", validation: { integer: true } },
        ratio: { name: "Ratio", type: "number", columnType: "double precision" },
        active: { name: "Active", type: "boolean" },
        published: { name: "Published", type: "date" },
        meta: { name: "Meta", type: "map" },
        tags: { name: "Tags", type: "array", of: { name: "Tag", type: "string" } },
        scores: { name: "Scores", type: "array", of: { name: "Score", type: "number" } },
        secret: { name: "Secret", type: "string", excludeFromApi: true }
    }
} as unknown as CollectionConfig;

/** The TypeScript type `generate-sdk` writes for one property's `Row` field. */
function generatedRowType(typedefs: string, accessor: string, property: string): string {
    const block = new RegExp(`\\n  ${accessor}: \\{\\n    Row: \\{\\n([\\s\\S]*?)\\n    \\};`).exec(typedefs);
    if (!block) throw new Error(`no Row block for accessor "${accessor}" in the generated types`);
    const line = new RegExp(`^\\s*${property}\\??:\\s*(.+?);\\s*$`, "m").exec(block[1]);
    if (!line) throw new Error(`no property "${property}" in the Row of "${accessor}"`);
    return line[1].replace(/\s*\|\s*null$/, "").trim();
}

/** What `typeof` must answer for a value the generator typed `type`. */
function typeofFor(type: string): string {
    if (type === "number") return "number";
    if (type === "string") return "string";
    if (type === "boolean") return "boolean";
    return "object";
}

/** The row as a caller receives it: through JSON, like every REST response. */
function overTheWire(row: unknown): Record<string, unknown> {
    return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

describe("property kinds: the wire value has the generated type (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    let driver: PostgresBackendDriver;
    let table: ReturnType<typeof buildDrizzleTablesFromSchema>[string];
    let db: ReturnType<typeof drizzle>;

    beforeAll(async () => {
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        pool = new pg.Pool({ connectionString: container.connectionString });
        const queryable: Queryable = {
            query: (text: string) => pool.query(text) as Promise<{ rows: unknown[] }>
        };

        // The runtime's own provisioning, so the column types are a real boot's.
        await ensureCollectionTables(queryable, [wireTypes]);

        const live = await introspectSchema(pool as never, "public");
        const built = buildDrizzleTablesFromSchema(live.tablesMap, "public");
        table = built["wire_types"];
        expect(table).toBeTruthy();

        // Keyed the way `schema.generated.ts` keys it — by the drizzle export
        // name, not by the SQL table name.
        const schema = { wireTypes: table };
        patchPgNumericToNumber(schema as Record<string, unknown>);

        db = drizzle(pool, { schema });
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([wireTypes]);
        registry.registerTable(table, "wire_types");

        const realtime = new RealtimeService(db as never, registry);
        driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);

        await admin.query(`
            INSERT INTO public.wire_types
                (id, title, price, quantity, ratio, active, published, meta, tags, scores, secret)
            VALUES
                ('w1', 'A thing', 2.5, 7, 0.25, true, now(), '{"a":1}'::jsonb,
                 ARRAY['a','b'], ARRAY[1.5, 2], 'hunter2');
        `);
    }, 180_000);

    afterAll(async () => {
        await pool?.end();
        await admin?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    it("serves NUMERIC as a number, not the string Postgres sends", async () => {
        const [row] = await driver.restFetchService.fetchCollectionForRest("wire-types", {});
        expect(overTheWire(row).price).toBe(2.5);
    });

    it("casts in the column mapping, so a plain select agrees with REST", async () => {
        // No REST renderer in this path at all: whatever `mapFromDriverValue`
        // produced is what a caller sees.
        const [raw] = await db.select().from(table);
        const row = raw as Record<string, unknown>;
        expect(typeof row.price).toBe("number");
        expect(row.price).toBe(2.5);
        expect(row.scores).toEqual([1.5, 2]);
    });

    it("every property kind reads back as the type the generated SDK declares", async () => {
        const typedefs = generateTypedefs([wireTypes]);
        const [fetched] = await driver.restFetchService.fetchCollectionForRest("wire-types", {});
        const row = overTheWire(fetched);

        const mismatches: string[] = [];
        for (const property of Object.keys(wireTypes.properties ?? {})) {
            // `excludeFromApi` is off the generated surface entirely, and off
            // the wire — asserted on its own below.
            if (property === "secret") continue;
            const declared = generatedRowType(typedefs, "wireTypes", property);
            const value = row[property];
            if (value === null || value === undefined) {
                mismatches.push(`${property}: no value came back to compare against \`${declared}\``);
                continue;
            }
            const actual = typeof value;
            const expected = typeofFor(declared);
            if (actual !== expected) {
                mismatches.push(
                    `${property}: generated \`${declared}\` but read back a ${actual} (${JSON.stringify(value)})`
                );
            }
        }

        expect(mismatches).toEqual([]);
    });

    it("withholds an excludeFromApi column on every REST read path", async () => {
        // The relational-query path renders through `toRestRow`, which strips
        // them. This collection cannot reach that path (snake-case table), and
        // neither can any read carrying a `searchString` or a vector search —
        // so the `select` fallback has to strip them too, or a password hash
        // ships to whoever types `?searchString=`.
        const [plain] = await driver.restFetchService.fetchCollectionForRest("wire-types", {});
        expect(plain).not.toHaveProperty("secret");

        const [searched] = await driver.restFetchService.fetchCollectionForRest(
            "wire-types",
            { searchString: "thing" }
        );
        if (searched) expect(searched).not.toHaveProperty("secret");

        const one = await driver.restFetchService.fetchOneForRest("wire-types", "w1");
        expect(one).not.toHaveProperty("secret");
    });
});
