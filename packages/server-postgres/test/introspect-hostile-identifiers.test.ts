/**
 * What the generator writes when the database does not have tidy names.
 *
 * `rebase init` points at a Postgres database somebody else made and writes
 * TypeScript from what it finds. Every table name, column name, enum value and
 * comment in those files comes straight out of that database — Postgres
 * identifiers are only constrained by quoting, comments are free text, and enum
 * labels are whatever `CREATE TYPE` said. A value carrying a double quote must
 * not close the string literal it sits in and continue as code, in a file the
 * developer then imports and runs.
 *
 * These compile the output (and the customization beside it), because that is
 * the only assertion that catches it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

import { generateSchemaModules, type SchemaGeneration, type SchemaGenerationInput, type TableColumn } from "../src/schema/introspect-db-logic";
import { buildSchema, column as baseColumn, type SchemaSpec } from "./helpers/schema-metadata";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const column = (table: string, name: string, opts: Partial<TableColumn> = {}): TableColumn =>
    baseColumn(table, name, { data_type: "character varying", udt_name: "varchar", ...opts });
const uuidKey = (table: string): TableColumn => column(table, "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO" });

function generate(spec: SchemaSpec, extra: Partial<SchemaGenerationInput> = {}): SchemaGeneration {
    const { metadata } = buildSchema(spec);
    return generateSchemaModules({ metadata, cms: { tableImport: table => `./schema/${table}` }, ...extra });
}

/** Compile generated schema modules together, as a project would. */
function diagnostics(generation: SchemaGeneration): string[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-hostile-"));
    try {
        const entryFiles: string[] = [];
        for (const table of generation.tables) {
            const file = path.join(dir, `${table.identifier}.ts`);
            // Imports between modules name the table; the test files are named by identifier.
            fs.writeFileSync(file, table.schemaModule, "utf-8");
            entryFiles.push(file);
        }
        const program = ts.createProgram(entryFiles, {
            noEmit: true,
            strict: true,
            skipLibCheck: true,
            noResolve: false,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            esModuleInterop: true,
            baseUrl: REPO_ROOT,
            types: [],
            paths: {
                "@rebasepro/server/schema": [path.join(REPO_ROOT, "packages/types/src/schema/index.ts")],
                "@rebasepro/types": [path.join(REPO_ROOT, "packages/types/src")],
                "@rebasepro/utils": [path.join(REPO_ROOT, "packages/utils/src")]
            }
        });
        const generated = new Set(entryFiles);
        return ts.getPreEmitDiagnostics(program)
            .filter(d => d.file && generated.has(d.file.fileName))
            .map(d => `TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/** Every top-level statement a generated file holds. */
function topLevelStatements(source: string): string[] {
    const file = ts.createSourceFile("c.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    return file.statements.map(statement => {
        if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.map(d => d.name.getText(file)).join(",");
        if (ts.isImportDeclaration(statement)) return "import";
        return ts.SyntaxKind[statement.kind];
    });
}

describe("generated tables compile for identifiers Postgres allows", () => {
    jest.setTimeout(120_000);

    it("for column names that are not JavaScript identifiers", () => {
        const g = generate({
            tables: [{
                name: "things",
                columns: [
                    uuidKey("things"),
                    column("things", "full name"),
                    column("things", "order"),
                    column("things", "class"),
                    column("things", "créé à", { data_type: "timestamp with time zone", udt_name: "timestamptz" }),
                    column("things", "2fa_enabled", { data_type: "boolean", udt_name: "bool" })
                ]
            }]
        });
        expect(diagnostics(g)).toEqual([]);
        // The real column name survives — it is what the query layer uses.
        expect(g.tables[0].schemaModule).toContain("fullName: col.text(\"full name\")");
        expect(g.tables[0].schemaModule).toContain("\"2faEnabled\": col.boolean(\"2fa_enabled\")");
    });

    it("for a table name that is not a JavaScript identifier", () => {
        const g = generate({ tables: [{ name: "2024 archive", columns: [uuidKey("2024 archive")] }] });
        expect(diagnostics(g)).toEqual([]);
        expect(g.tables[0].identifier).toBe("t2024Archive");
        expect(g.tables[0].schemaModule).toContain("export const t2024Archive = defineTable(\"2024 archive\", {");
    });

    it("for enum values, comments and defaults carrying quotes and newlines", () => {
        const g = generate({
            tables: [{ name: "orders", columns: [uuidKey("orders"), column("orders", "state", { data_type: "USER-DEFINED", udt_name: "order_state", column_default: "'pending\"'::order_state" })] }],
            enumValues: [
                { enum_name: "order_state", enum_value: "pending\"", sort_order: 1 },
                { enum_name: "order_state", enum_value: "ship\\ped", sort_order: 2 },
                { enum_name: "order_state", enum_value: "done\nnow", sort_order: 3 }
            ],
            comments: [
                { table_name: "orders", column_name: null, comment: "Orders.\n\"Quoted\", and \\escaped\\." },
                { table_name: "orders", column_name: "state", comment: "The \"state\"." }
            ]
        });
        expect(diagnostics(g)).toEqual([]);
        // The named enum type is declared once, as Drizzle declares it: `const orderStateEnum = pgEnum(…)`.
        expect(topLevelStatements(g.tables[0].schemaModule)).toEqual(["import", "orderStateEnum", "orders"]);
    });

    it("does not let a database name add a declaration to the file", () => {
        // The threat is a schema the developer did not author — an imported
        // dump, a tenant's database, anything `rebase init` was pointed at.
        const payload = "x\"; })(); export const OWNED = globalThis.process?.env; const y = \"";
        const g = generate({
            tables: [{ name: "t", columns: [uuidKey("t"), column("t", payload), column("t", "state", { data_type: "USER-DEFINED", udt_name: "s" })] }],
            enumValues: [{ enum_name: "s", enum_value: payload, sort_order: 1 }]
        });
        expect(topLevelStatements(g.tables[0].schemaModule)).toEqual(["import", "sEnum", "t"]);
        expect(diagnostics(g)).toEqual([]);
    });

    it("does not let a table name escape the import specifier it is written into", () => {
        // A name no file can carry is left out by the CLI (`isUsableFileName`);
        // the printer refuses one that is not an identifier's source either way.
        const hostile = "a\"; import { x } from \"./y";
        const g = generate({
            tables: [
                { name: "child", columns: [uuidKey("child"), column("child", "parent_id", { data_type: "uuid", udt_name: "uuid" })] },
                { name: hostile, columns: [uuidKey(hostile)] }
            ],
            fks: [{ table_name: "child", column_name: "parent_id", foreign_table_name: hostile, foreign_column_name: "id" }]
        }, { leaveOut: new Set([hostile]) });
        const child = g.tables.find(t => t.table === "child");
        expect(child?.schemaModule).not.toContain("./y");
        expect(topLevelStatements(child?.schemaModule ?? "")).toEqual(["import", "child"]);
    });

    it("keeps a multi-line classification reason inside its comment", () => {
        const g = generate({ tables: [{ name: "audit_log", columns: [uuidKey("audit_log")] }] }, {
            classifications: new Map([["audit_log", { table: "audit_log", role: "lookup", reason: "append-only\nexport const OWNED = 1;" }]])
        });
        expect(topLevelStatements(g.tables[0].schemaModule)).toEqual(["import", "auditLog"]);
        expect(diagnostics(g)).toEqual([]);
        // The customization beside it carries the role as data.
        expect(topLevelStatements(g.tables[0].customization ?? "")).toEqual(["import", "import", "auditLogCms"]);
    });
});
