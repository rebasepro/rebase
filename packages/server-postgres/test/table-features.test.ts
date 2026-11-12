/**
 * The schema features only the table model can state, end to end.
 *
 * Each was refused by `lowerTables` as a pending feature while the planner
 * re-derived every column from the legacy property; the planner now plans a
 * lowered column from its `ColumnDef`, so they are real. For each: the plan,
 * `schema.sql` (DDL) and `schema.generated.ts` (Drizzle) say it, Postgres
 * accepts the DDL (PGlite), the generated file compiles, and the boot planner
 * creates the same table and plans nothing more on a second boot.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { lowerTables, type LoweredCollection } from "@rebasepro/common";
import type { AnyTableDef } from "@rebasepro/types";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { renderDrizzleSchema } from "../src/schema/plan/render-drizzle";
import type { ColumnPlan, SchemaPlan, TablePlan } from "../src/schema/plan/types";
import { ensureCollectionTables, type Queryable } from "../src/schema/ensure-collection-tables";
import { withPinnedPlannerWorld } from "../src/schema/render-outputs";
import { assertWritableColumns } from "../src/services/collection-helpers";
import { TABLE_FEATURES, people } from "./fixtures/table-features";

const PACKAGE_ROOT = path.resolve(__dirname, "..");

function lowered(defs: readonly AnyTableDef[] = TABLE_FEATURES): LoweredCollection[] {
    return lowerTables(defs);
}

function planOf(defs: readonly AnyTableDef[] = TABLE_FEATURES): SchemaPlan {
    return withPinnedPlannerWorld(() => planSchema(lowered(defs), { databaseExtensions: [] }));
}

const ddlOf = (defs?: readonly AnyTableDef[]): string =>
    renderPostgresDdl(planOf(defs), { includePolicies: false, includeSearch: false, includeVector: false });

const drizzleOf = (defs?: readonly AnyTableDef[]): string => renderDrizzleSchema(planOf(defs), { policies: false });

function tableOf(plan: SchemaPlan, name: string): TablePlan {
    const table = plan.tables.find(candidate => candidate.table === name);
    if (!table) throw new Error(`the plan has no table "${name}"`);
    return table;
}

function columnOf(plan: SchemaPlan, table: string, column: string): ColumnPlan {
    const found = tableOf(plan, table).columns.find(candidate => candidate.column === column);
    if (!found) throw new Error(`the plan has no column "${table}.${column}"`);
    return found;
}

/** The one line of a `CREATE TABLE` that defines a column. */
function ddlLine(ddl: string, column: string): string | undefined {
    return ddl.split("\n").map(line => line.trim()).find(line => line.startsWith(`"${column}" `));
}

/** The one line of the Drizzle file that declares a column. */
function drizzleLine(source: string, key: string): string | undefined {
    return source.split("\n").map(line => line.trim()).find(line => line.startsWith(`${key}: `));
}

/** Every diagnostic `tsc --strict` reports for a generated schema. */
function compileDiagnostics(source: string): string[] {
    const dir = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".schema-compile-"));
    try {
        const file = path.join(dir, "schema.generated.ts");
        fs.writeFileSync(file, source);
        const program = ts.createProgram([file], {
            strict: true,
            noEmit: true,
            target: ts.ScriptTarget.ESNext,
            module: ts.ModuleKind.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            esModuleInterop: true,
            skipLibCheck: true,
            types: []
        });
        return ts.getPreEmitDiagnostics(program)
            .filter(d => d.file?.fileName.endsWith("schema.generated.ts"))
            .map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

const queryable = (db: PGlite): Queryable => ({
    query: async <T = unknown>(statement: string) => {
        const result = await db.query<T>(statement);
        return { rows: result.rows };
    }
});

describe("table features: the whole fixture", () => {
    let db: PGlite;

    beforeEach(async () => {
        db = new PGlite();
        await db.waitReady;
    });

    afterEach(async () => {
        await db.close();
    });

    it("is DDL Postgres accepts", async () => {
        await db.exec(ddlOf());
    });

    it("is a Drizzle file that compiles", () => {
        expect(compileDiagnostics(drizzleOf())).toEqual([]);
    }, 60_000);

    it("boots: the boot planner creates every table, and a second boot plans nothing", async () => {
        await db.exec("CREATE SCHEMA IF NOT EXISTS \"rebase\";");
        const first = await ensureCollectionTables(queryable(db), lowered(), undefined, { databaseExtensions: [] });
        expect(first.failures).toEqual([]);
        const second = await ensureCollectionTables(queryable(db), lowered(), undefined, { databaseExtensions: [] });
        expect(second.failures).toEqual([]);
        expect(second.actions.map(action => `${action.kind} ${action.target}`)).toEqual([]);
    });
});

describe("table features: `.generatedAs()`", () => {
    it("plans a STORED generated column, with no default, NOT NULL when declared", () => {
        const plan = planOf([people]);
        expect(columnOf(plan, "people", "full_name")).toMatchObject({
            key: "fullName",
            type: { kind: "text" },
            nullable: false,
            generated: { expression: "first_name || ' ' || last_name", stored: true },
            source: { kind: "property", propName: "fullName" }
        });
        expect(columnOf(plan, "people", "full_name").default).toBeUndefined();
        expect(columnOf(plan, "people", "initials")).toMatchObject({ type: { kind: "varchar", length: 2 }, nullable: true });
    });

    it("renders `GENERATED ALWAYS AS (…) STORED` in the DDL and `.generatedAlwaysAs()` in the Drizzle file", () => {
        expect(ddlLine(ddlOf([people]), "full_name")).toBe(
            "\"full_name\" TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED NOT NULL,");
        expect(ddlLine(ddlOf([people]), "initials")).toBe(
            "\"initials\" VARCHAR(2) GENERATED ALWAYS AS (left(first_name, 1) || left(last_name, 1)) STORED");
        expect(drizzleLine(drizzleOf([people]), "fullName")).toBe(
            "fullName: text(\"full_name\").generatedAlwaysAs(sql`first_name || ' ' || last_name`).notNull(),");
    });

    it("is computed by Postgres, and a create may leave it out", async () => {
        const db = new PGlite();
        try {
            await db.waitReady;
            await db.exec(ddlOf([people]));
            await db.query("INSERT INTO people (first_name, last_name) VALUES ('Ada', 'Lovelace')");
            const { rows } = await db.query<{ full_name: string; initials: string }>("SELECT full_name, initials FROM people");
            expect(rows).toEqual([{ full_name: "Ada Lovelace", initials: "AL" }]);
        } finally {
            await db.close();
        }
        // The runtime reads the lowered property: closed to writes, filled by the database.
        const [collection] = lowered([people]);
        expect(collection.properties.fullName).toMatchObject({ access: { write: [] }, databaseDefault: true, validation: { required: true } });
    });

    it("is refused in a write's values, for every caller", () => {
        const table = pgTable("people", {
            id: uuid("id").primaryKey(),
            firstName: text("first_name"),
            fullName: text("full_name").generatedAlwaysAs(sql`first_name`)
        });
        expect(() => assertWritableColumns({ firstName: "Ada", fullName: "x" }, table, "people"))
            .toThrow(/computes 'fullName' itself/);
        expect(() => assertWritableColumns({ firstName: "Ada" }, table, "people")).not.toThrow();
    });
});
