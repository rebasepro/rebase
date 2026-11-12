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
import { col, defineTable, rel, type AnyTableDef } from "@rebasepro/types";

import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl } from "../src/schema/plan/render-ddl";
import { renderDrizzleSchema } from "../src/schema/plan/render-drizzle";
import type { ColumnPlan, SchemaPlan, TablePlan } from "../src/schema/plan/types";
import { ensureCollectionTables, type Queryable } from "../src/schema/ensure-collection-tables";
import { withPinnedPlannerWorld } from "../src/schema/render-outputs";
import { assertWritableColumns } from "../src/services/collection-helpers";
import { readCatalogueSchema } from "../src/schema/catalogue-schema";
import { parsePropertyFromServer, serializePropertyToServer } from "../src/data-transformer";
import { drizzle } from "drizzle-orm/pglite";
import {
    TABLE_FEATURES, codes, counters, days, grades, initials, keyed, lists, pairs, people, prices, slugs, switches, tallies, tickets
} from "./fixtures/table-features";

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

const queryable = (db: PGlite): Queryable & { query<T = unknown>(statement: string, values?: unknown[]): Promise<{ rows: T[] }> } => ({
    query: async <T = unknown>(statement: string, values?: unknown[]) => {
        const result = await db.query<T>(statement, values);
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

describe("table features: `.identity()` at any width, key or not", () => {
    it("plans GENERATED BY DEFAULT AS IDENTITY on the declared integer type", () => {
        const plan = planOf([counters, tallies]);
        expect(columnOf(plan, "counters", "id")).toMatchObject({ type: { kind: "bigint" }, primaryKey: true, default: { kind: "identity" } });
        expect(columnOf(plan, "counters", "sequence_no")).toMatchObject({ type: { kind: "integer" }, primaryKey: false, nullable: false, default: { kind: "identity" } });
        expect(columnOf(plan, "counters", "tick")).toMatchObject({ type: { kind: "smallint" }, nullable: true, default: { kind: "identity" } });
        expect(columnOf(plan, "tallies", "code")).toMatchObject({ type: { kind: "smallint" }, primaryKey: true, default: { kind: "identity" } });
    });

    it("types every column pointing at an identity key with the key's own width", () => {
        const plan = planOf([counters, tallies]);
        expect(columnOf(plan, "tallies", "counter_id")).toMatchObject({ type: { kind: "bigint" }, nullable: false, foreignKey: { targetTable: "counters", targetColumn: "id" } });
        expect(columnOf(plan, "tallies", "backup_id")).toMatchObject({ type: { kind: "bigint" }, nullable: true, foreignKey: { targetTable: "counters" } });
    });

    it("renders the identity on the right type in the DDL and on the right builder in the Drizzle file", () => {
        const ddl = ddlOf([counters, tallies]);
        expect(ddlLine(ddl, "id")).toBe("\"id\" BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,");
        expect(ddlLine(ddl, "sequence_no")).toBe("\"sequence_no\" INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL,");
        expect(ddlLine(ddl, "tick")).toBe("\"tick\" SMALLINT GENERATED BY DEFAULT AS IDENTITY,");
        expect(ddlLine(ddl, "code")).toBe("\"code\" SMALLINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,");
        expect(ddlLine(ddl, "counter_id")).toBe("\"counter_id\" BIGINT NOT NULL,");
        const drizzle = drizzleOf([counters, tallies]);
        expect(drizzleLine(drizzle, "id")).toBe("id: bigint(\"id\", { mode: \"number\" }).generatedByDefaultAsIdentity().primaryKey(),");
        expect(drizzleLine(drizzle, "sequenceNo")).toBe("sequenceNo: integer(\"sequence_no\").generatedByDefaultAsIdentity().notNull(),");
        expect(drizzleLine(drizzle, "tick")).toBe("tick: smallint(\"tick\").generatedByDefaultAsIdentity(),");
        expect(drizzleLine(drizzle, "code")).toBe("code: smallint(\"code\").generatedByDefaultAsIdentity().primaryKey(),");
    });

    it("numbers rows Postgres-side, each column from its own sequence", async () => {
        const db = new PGlite();
        try {
            await db.waitReady;
            await db.exec(ddlOf([counters, tallies]));
            await db.query("INSERT INTO counters (label) VALUES ('a'), ('b')");
            await db.query("INSERT INTO tallies (counter_id) VALUES (2)");
            const { rows } = await db.query<{ id: number; sequence_no: number; tick: number }>(
                "SELECT id::int AS id, sequence_no, tick FROM counters ORDER BY id");
            expect(rows).toEqual([{ id: 1, sequence_no: 1, tick: 1 }, { id: 2, sequence_no: 2, tick: 2 }]);
            const tally = await db.query<{ code: number }>("SELECT code FROM tallies");
            expect(tally.rows).toEqual([{ code: 1 }]);
        } finally {
            await db.close();
        }
    });
});

describe("table features: every scalar key type, and the links into it", () => {
    const KEYS = [codes, initials, grades, days, switches, prices, tickets, slugs, pairs, keyed];

    it("plans each key on its own type", () => {
        const plan = planOf(KEYS);
        expect(columnOf(plan, "codes", "code")).toMatchObject({ type: { kind: "varchar", length: 12 }, primaryKey: true, nullable: false });
        expect(columnOf(plan, "initials", "letter")).toMatchObject({ type: { kind: "char", length: 1 }, primaryKey: true });
        expect(columnOf(plan, "grades", "grade")).toMatchObject({ type: { kind: "enum", name: "grades_grade", labels: ["a", "b", "c"] }, primaryKey: true });
        expect(columnOf(plan, "days", "day")).toMatchObject({ type: { kind: "date" }, primaryKey: true });
        expect(columnOf(plan, "switches", "enabled")).toMatchObject({ type: { kind: "boolean" }, primaryKey: true });
        expect(columnOf(plan, "prices", "amount")).toMatchObject({ type: { kind: "numeric", precision: 10, scale: 2 }, primaryKey: true });
        expect(columnOf(plan, "tickets", "id")).toMatchObject({ type: { kind: "serial" }, primaryKey: true });
        expect(tableOf(plan, "pairs").primaryKey).toEqual(["left", "right"]);
        expect(columnOf(plan, "pairs", "left")).toMatchObject({ primaryKey: false, nullable: false });
    });

    it("types each link with the key it points at (a serial key as its plain integer)", () => {
        const plan = planOf(KEYS);
        const linkType = (column: string) => columnOf(plan, "keyed", column).type;
        expect(linkType("code_id")).toEqual({ kind: "varchar", length: 12 });
        expect(linkType("letter_id")).toEqual({ kind: "char", length: 1 });
        expect(linkType("grade_id")).toMatchObject({ kind: "enum", name: "grades_grade" });
        expect(linkType("day_id")).toEqual({ kind: "date" });
        expect(linkType("switch_id")).toEqual({ kind: "boolean" });
        expect(linkType("price_id")).toEqual({ kind: "numeric", precision: 10, scale: 2 });
        expect(linkType("ticket_id")).toEqual({ kind: "integer" });
        expect(linkType("slug_id")).toEqual({ kind: "text" });
        // One enum type, the key table's, typing both columns.
        expect(plan.enums.map(e => e.name)).toEqual(["grades_grade"]);
    });

    it("renders the composite key as one constraint, and Postgres accepts every key and link", async () => {
        const ddl = ddlOf(KEYS);
        expect(ddl).toContain("  PRIMARY KEY (\"left\", \"right\")\n");
        expect(ddlLine(ddl, "grade_id")).toBe("\"grade_id\" \"public\".\"grades_grade\",");
        expect(drizzleLine(drizzleOf(KEYS), "gradeId")).toBe(
            "gradeId: gradesGrade(\"grade_id\").references((): AnyPgColumn => grades.grade, { onDelete: \"set null\" }),");
        const db = new PGlite();
        try {
            await db.waitReady;
            await db.exec(ddl);
            await db.query("INSERT INTO grades VALUES ('b')");
            await db.query("INSERT INTO days VALUES ('2026-01-02')");
            await db.query("INSERT INTO keyed (grade_id, day_id) VALUES ('b', '2026-01-02')");
            await expect(db.query("INSERT INTO keyed (day_id) VALUES ('2026-01-03')")).rejects.toThrow(/foreign key/);
        } finally {
            await db.close();
        }
    });

    it("refuses a link into the composite key, naming the link", () => {
        const into = defineTable("into_pairs", {
            columns: { id: col.uuid().primaryKey() },
            relations: { pair: rel.belongsTo(() => pairs) },
            rls: "admin-only"
        });
        expect(() => planOf([pairs, into])).toThrow(/composite key/);
    });
});

describe("table features: `col.array(inner)` of every scalar element type", () => {
    it("plans an array of the element's own type, an enum array typed by its own enum", () => {
        const plan = planOf([lists]);
        const typeOf = (column: string) => columnOf(plan, "lists", column).type;
        expect(typeOf("ids")).toEqual({ kind: "array", of: { kind: "uuid" } });
        expect(typeOf("counts")).toEqual({ kind: "array", of: { kind: "bigint" } });
        expect(typeOf("smalls")).toEqual({ kind: "array", of: { kind: "smallint" } });
        expect(typeOf("amounts")).toEqual({ kind: "array", of: { kind: "numeric", precision: 8, scale: 2 } });
        expect(typeOf("labels")).toEqual({
            kind: "array",
            of: { kind: "enum", schema: "public", name: "lists_labels", varName: "listsLabels", labels: ["red", "green", "blue"] }
        });
        expect(typeOf("codes")).toEqual({ kind: "array", of: { kind: "varchar", length: 5 } });
        expect(typeOf("days")).toEqual({ kind: "array", of: { kind: "date" } });
        expect(typeOf("instants")).toEqual({ kind: "array", of: { kind: "timestamptz" } });
        expect(plan.enums).toEqual([expect.objectContaining({ name: "lists_labels", labels: ["red", "green", "blue"] })]);
    });

    it("renders `T[]` in the DDL and `.array()` on the element's builder in the Drizzle file", () => {
        const ddl = ddlOf([lists]);
        expect(ddl).toContain("CREATE TYPE \"public\".\"lists_labels\" AS ENUM ('red', 'green', 'blue');");
        expect(ddlLine(ddl, "ids")).toBe("\"ids\" UUID[],");
        expect(ddlLine(ddl, "counts")).toBe("\"counts\" BIGINT[],");
        expect(ddlLine(ddl, "amounts")).toBe("\"amounts\" NUMERIC(8, 2)[],");
        expect(ddlLine(ddl, "labels")).toBe("\"labels\" \"public\".\"lists_labels\"[],");
        expect(ddlLine(ddl, "codes")).toBe("\"codes\" VARCHAR(5)[],");
        expect(ddlLine(ddl, "instants")).toBe("\"instants\" TIMESTAMP WITH TIME ZONE[],");
        const drizzle = drizzleOf([lists]);
        expect(drizzleLine(drizzle, "ids")).toBe("ids: uuid(\"ids\").array(),");
        expect(drizzleLine(drizzle, "counts")).toBe("counts: bigint(\"counts\", { mode: \"number\" }).array(),");
        expect(drizzleLine(drizzle, "labels")).toBe("labels: listsLabels(\"labels\").array(),");
        expect(drizzleLine(drizzle, "codes")).toBe("codes: varchar(\"codes\", { length: 5 }).array(),");
        expect(drizzleLine(drizzle, "days")).toBe("days: date(\"days\", { mode: 'string' }).array(),");
    });

    it("round-trips every element type through the runtime's codec and its catalogue-built table", async () => {
        const db = new PGlite();
        try {
            await db.waitReady;
            await db.exec(ddlOf([lists]));
            const [collection] = lowered([lists]);
            const catalogue = await readCatalogueSchema({ client: queryable(db), collections: [collection], defaultSchema: "public" });
            const table = catalogue.tables.lists;
            const orm = drizzle(db, { schema: catalogue.tables });

            const written: Record<string, unknown> = {
                ids: ["a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11"],
                counts: [1, 9007199254740991],
                smalls: [3, -4],
                numbers: [5, 6],
                amounts: [1.5, 2.25],
                ratios: [0.5],
                labels: ["green", "red"],
                codes: ["ab", "cde"],
                words: ["it's", "a \"word\""],
                flags: [true, false],
                days: ["2026-01-02"],
                instants: ["2026-01-02T10:00:00.000Z"],
                times: ["09:30:00"]
            };
            const values: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(written)) {
                values[key] = serializePropertyToServer(value, collection.properties[key], key);
            }
            const [row] = await orm.insert(table).values(values).returning();
            const read: Record<string, unknown> = {};
            for (const key of Object.keys(written)) {
                read[key] = parsePropertyFromServer(row[key], collection.properties[key], collection, key);
            }
            // Each item comes back as a scalar column of its type does.
            const date = (iso: string) => ({ __type: "date", value: iso });
            expect(read).toEqual({
                ...written,
                days: [date("2026-01-02T00:00:00.000Z")],
                instants: [date("2026-01-02T10:00:00.000Z")],
                times: [date("1970-01-01T09:30:00.000Z")]
            });
        } finally {
            await db.close();
        }
    });
});
