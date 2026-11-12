/**
 * `col.custom(sqlType)` end to end: a type no other builder names is planned.
 *
 * A table holding `inet`, `interval`, `timestamp`, a range and an `inet[]` is
 * created in one database, generated from it (`rebase schema introspect`'s
 * generator), and the generated definitions are then pushed into a fresh
 * database (`schema.sql`), booted over (`ensureCollectionTables`, which plans
 * nothing on the pushed tables and nothing more on a second boot), rendered as
 * a Drizzle file that compiles, and round-tripped through the runtime's codec
 * and catalogue-built table — every value passing through as the driver
 * returns it.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { lowerTables } from "@rebasepro/common";
import { col, defineTable, type AnyTableDef, type AnyViewDef } from "@rebasepro/types";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { renderDrizzleSchema } from "../src/schema/plan/render-drizzle";
import { ensureCollectionTables, readExistingSchema } from "../src/schema/ensure-collection-tables";
import { diffPlanAgainstCatalogue } from "../src/schema/plan/diff-plan";
import { readSchemaMetadata } from "../src/schema/introspect-db-queries";
import { generateSchemaModules } from "../src/schema/introspect-db-logic";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { parseColumnFromServer, serializeColumnToServer } from "../src/data-transformer";
import { columnAt, runtimeTableOfDef } from "./helpers/codec-columns";
import { customTypesAgree, normalizeFormatType } from "../src/schema/column-type-drift";
import { evaluateSchemaModules } from "./helpers/introspect-generation";

const PACKAGE_ROOT = path.resolve(__dirname, "..");

const SOURCE_DDL = `
    CREATE TABLE public.sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        address inet NOT NULL,
        lasted interval,
        started timestamp(3) without time zone DEFAULT now(),
        seats int4range,
        hops inet[]
    );
    ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
`;

const queryable = (db: PGlite) => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => {
        const result = await db.query<T>(statement, values);
        return { rows: result.rows };
    }
});

const ddlOf = (defs: readonly (AnyTableDef | AnyViewDef)[]): string =>
    renderPostgresDdl(planSchema(lowerTables(defs), { databaseExtensions: [] }), { includePolicies: false, includeSearch: false, includeVector: false });

function compileDiagnostics(source: string): string[] {
    const dir = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".schema-compile-"));
    try {
        const file = path.join(dir, "schema.generated.ts");
        fs.writeFileSync(file, source);
        const program = ts.createProgram([file], {
            strict: true, noEmit: true, target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler, esModuleInterop: true, skipLibCheck: true, types: []
        });
        return ts.getPreEmitDiagnostics(program)
            .filter(d => d.file?.fileName.endsWith("schema.generated.ts"))
            .map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

describe("col.custom(): generated from a database, pushed, booted and served", () => {
    let source: PGlite;
    let target: PGlite;
    let defs: (AnyTableDef | AnyViewDef)[];

    beforeEach(async () => {
        source = new PGlite();
        target = new PGlite();
        await Promise.all([source.waitReady, target.waitReady]);
        await source.exec(SOURCE_DDL);
        const metadata = await readSchemaMetadata(queryable(source), "public");
        const generation = generateSchemaModules({ metadata });
        defs = evaluateSchemaModules(generation.tables.map(table => table.schemaModule));
    });

    afterEach(async () => {
        await source.close();
        await target.close();
    });

    it("generates each such column as `col.custom()`, named as the catalogue prints it", () => {
        const [sessions] = defs;
        const types = Object.fromEntries(Object.entries(sessions.config.columns).map(([key, builder]) => [key, builder.def.type]));
        expect(types).toMatchObject({
            address: { kind: "other", sqlType: "inet" },
            lasted: { kind: "other", sqlType: "interval" },
            started: { kind: "other", sqlType: "timestamp(3) without time zone" },
            seats: { kind: "other", sqlType: "int4range" },
            hops: { kind: "other", sqlType: "inet[]" }
        });
    });

    it("plans and renders each type verbatim, in the DDL and the Drizzle file (which compiles)", () => {
        const plan = planSchema(lowerTables(defs), { databaseExtensions: [] });
        const columns = Object.fromEntries(plan.tables[0].columns.map(column => [column.column, column]));
        expect(columns.address).toMatchObject({ type: { kind: "custom", sqlType: "inet" }, nullable: false });
        expect(columns.hops.type).toEqual({ kind: "custom", sqlType: "inet[]" });
        expect(columns.started.default).toEqual({ kind: "sql", expression: "now()" });
        const ddl = ddlOf(defs);
        expect(ddl).toContain("\"address\" inet NOT NULL");
        expect(ddl).toContain("\"started\" timestamp(3) without time zone DEFAULT now()");
        expect(ddl).toContain("\"seats\" int4range");
        expect(ddl).toContain("\"hops\" inet[]");
        const drizzleFile = renderDrizzleSchema(plan, { policies: false });
        expect(drizzleFile).toContain("address: customType({ dataType() { return \"inet\"; } })(\"address\").notNull()");
        expect(compileDiagnostics(drizzleFile)).toEqual([]);
    }, 60_000);

    it("is pushed, then a boot finds nothing to do, twice; and a database whose type differs is reported", async () => {
        await target.exec(ddlOf(defs));
        const first = await ensureCollectionTables(queryable(target), lowerTables(defs), undefined, { databaseExtensions: [] });
        expect(first.failures).toEqual([]);
        expect(first.actions.map(action => `${action.kind} ${action.target}`)).toEqual([]);
        expect(first.columnTypeDrift).toEqual([]);
        const second = await ensureCollectionTables(queryable(target), lowerTables(defs), undefined, { databaseExtensions: [] });
        expect(second.actions).toEqual([]);

        // The same table, declared with another range type: reported, never altered.
        const [sessions] = defs;
        const changed = defineTable("sessions", {
            columns: { ...sessions.config.columns, seats: col.custom("int8range") },
            rls: "admin-only"
        });
        const existing = await readExistingSchema(queryable(target), ["public"]);
        const plan = diffPlanAgainstCatalogue(planSchema(lowerTables([changed]), { databaseExtensions: [] }), existing);
        expect(plan.columnTypeDrift).toEqual([{ table: "public.sessions", column: "seats", declared: "int8range", actual: "int4range" }]);
    });

    it("is created by a boot from nothing, as ADD COLUMN on an existing table", async () => {
        await target.exec("CREATE TABLE public.sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid());");
        const booted = await ensureCollectionTables(queryable(target), lowerTables(defs), undefined, { databaseExtensions: [] });
        expect(booted.failures).toEqual([]);
        const { rows } = await target.query<{ column_name: string; formatted: string }>(
            "SELECT a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS formatted FROM pg_attribute a " +
            "WHERE a.attrelid = 'public.sessions'::regclass AND a.attnum > 0 ORDER BY a.attnum");
        expect(rows.map(row => [row.column_name, row.formatted])).toEqual([
            ["id", "uuid"], ["address", "inet"], ["lasted", "interval"], ["started", "timestamp(3) without time zone"],
            ["seats", "int4range"], ["hops", "inet[]"]
        ]);
        const again = await ensureCollectionTables(queryable(target), lowerTables(defs), undefined, { databaseExtensions: [] });
        expect(again.actions).toEqual([]);
    });

    it("round-trips values through the codec and the catalogue-built table, as the driver returns them", async () => {
        await target.exec(ddlOf(defs));
        const [collection] = lowerTables(defs);
        const catalogue = await readCatalogueSchema({ client: queryable(target), collections: [collection], defaultSchema: "public" });
        const orm = drizzle(target, { schema: catalogue.tables });
        const written: Record<string, unknown> = {
            address: "10.0.0.1",
            lasted: "1 day 02:00:00",
            started: "2026-01-02 10:30:00.123",
            seats: "[1,5)",
            hops: ["10.0.0.2", "192.168.1.1"]
        };
        const values: Record<string, unknown> = {};
        const runtime = runtimeTableOfDef(defs[0]);
        for (const [key, value] of Object.entries(written)) values[key] = serializeColumnToServer(value, columnAt(runtime, key), key);
        const [row] = await orm.insert(catalogue.tables.sessions).values(values).returning();
        const read: Record<string, unknown> = {};
        for (const key of Object.keys(written)) read[key] = parseColumnFromServer(row[key], columnAt(runtime, key));
        expect(read).toEqual(written);
    });
});

describe("normalizeFormatType: a custom type compared with the catalogue's spelling", () => {
    it.each<[string, string]>([
        ["timestamp", "timestamp without time zone"],
        ["timestamp(3)", "timestamp(3) without time zone"],
        ["TIMESTAMPTZ", "timestamp with time zone"],
        ["time", "time without time zone"],
        ["varchar(20)", "character varying(20)"],
        ["geometry(Point, 4326)", "geometry(point,4326)"],
        ["public.citext", "citext"],
        ["inet []", "inet[]"],
        ["\"My Type\"", "\"My Type\""]
    ])("reads %s as %s", (declared, normalized) => {
        expect(normalizeFormatType(declared)).toBe(normalized);
    });

    it("tells two different custom types apart", () => {
        expect(customTypesAgree("int4range", "int8range")).toBe(false);
        expect(customTypesAgree("timestamp(3)", "timestamp(3) without time zone")).toBe(true);
        expect(customTypesAgree("timestamp", "timestamp with time zone")).toBe(false);
    });
});
