/**
 * What the generator writes when the database does not have tidy names.
 *
 * `rebase init` points at a Postgres database somebody else made and writes
 * TypeScript collection files from what it finds. Every table name, column
 * name, enum value and comment in those files comes straight out of that
 * database — and was interpolated into the output raw. Postgres identifiers are
 * only constrained by quoting, comments are free text, and enum labels are
 * whatever `CREATE TYPE` said.
 *
 * So a column named `order` or `full name` produced a file that did not
 * compile, and a value carrying a double quote could close the string literal
 * it was sitting in and continue as code — in a file the developer then imports
 * and runs. `quote()` existed in the generator and was applied to two of some
 * twenty-five interpolations.
 *
 * These compile the output, because that is the only assertion that could have
 * caught it: every substring the old tests looked for was present.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

import {
    generateCollectionFile,
    type TableColumn,
    type TableMeta,
    type ForeignKeyRow
} from "../src/schema/introspect-db-logic";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

const column = (table: string, name: string, opts: Partial<TableColumn> = {}): TableColumn => ({
    table_name: table,
    column_name: name,
    data_type: "character varying",
    udt_name: "varchar",
    is_nullable: "YES",
    column_default: null,
    ...opts
});

const table = (name: string, columns: TableColumn[], pks: string[] = ["id"], fks: ForeignKeyRow[] = []): TableMeta =>
    ({ name, columns, pks, fks });

/** Compile the generated files together, as a project would. */
function diagnostics(files: Map<string, string>): string[] {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-hostile-"));
    try {
        const entryFiles: string[] = [];
        for (const [name, source] of files) {
            const file = path.join(dir, `${name}.ts`);
            fs.writeFileSync(file, source, "utf-8");
            entryFiles.push(file);
        }
        entryFiles.push(path.join(REPO_ROOT, "packages/admin-types/src/augment.ts"));

        const program = ts.createProgram(entryFiles, {
            noEmit: true,
            strict: true,
            skipLibCheck: true,
            module: ts.ModuleKind.ESNext,
            target: ts.ScriptTarget.ESNext,
            moduleResolution: ts.ModuleResolutionKind.Bundler,
            jsx: ts.JsxEmit.ReactJSX,
            esModuleInterop: true,
            baseUrl: REPO_ROOT,
            types: [],
            paths: {
                "@rebasepro/types": [path.join(REPO_ROOT, "packages/types/src")],
                "@rebasepro/admin-types": [path.join(REPO_ROOT, "packages/admin-types/src")],
                "@rebasepro/common": [path.join(REPO_ROOT, "packages/common/src")],
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

/** Every top-level declaration the generated file introduces. */
function topLevelDeclarations(source: string): string[] {
    const file = ts.createSourceFile("c.ts", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
    return file.statements.map(statement => {
        if (ts.isVariableStatement(statement)) {
            return statement.declarationList.declarations.map(d => d.name.getText(file)).join(",");
        }
        if (ts.isImportDeclaration(statement)) return "import";
        if (ts.isExportAssignment(statement)) return "export=";
        return ts.SyntaxKind[statement.kind];
    });
}

describe("generated collections compile for identifiers Postgres allows", () => {
    jest.setTimeout(120_000);

    it("for column names that are not JavaScript identifiers", () => {
        // All legal quoted Postgres identifiers. `order` is also a reserved
        // word in enough contexts that real schemas hit it constantly.
        const meta = table("things", [
            column("things", "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
            column("things", "full name"),
            column("things", "order"),
            column("things", "class"),
            column("things", "créé à", { data_type: "timestamp without time zone", udt_name: "timestamp" }),
            column("things", "2fa_enabled", { data_type: "boolean", udt_name: "bool" })
        ]);

        const source = generateCollectionFile("things", meta, [], new Set(), new Map([["things", meta]]), new Map());
        expect(diagnostics(new Map([["things", source]]))).toEqual([]);
        // The real column name has to survive — it is what the query layer uses.
        expect(source).toContain('"full name"');
        expect(source).toContain('columnName: "full name"');
    });

    it("for a table name that is not a JavaScript identifier", () => {
        const meta = table("2024 archive", [
            column("2024 archive", "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })
        ]);

        const source = generateCollectionFile("2024 archive", meta, [], new Set(), new Map([["2024 archive", meta]]), new Map());
        expect(diagnostics(new Map([["t", source]]))).toEqual([]);
        expect(source).toContain('slug: "2024 archive"');
        expect(source).toContain('table: "2024 archive"');
    });

    it("for enum values, comments and defaults carrying quotes and newlines", () => {
        const meta = table("orders", [
            column("orders", "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
            column("orders", "state", { data_type: "USER-DEFINED", udt_name: "order_state" })
        ]);

        const source = generateCollectionFile(
            "orders",
            meta,
            [],
            new Set(),
            new Map([["orders", meta]]),
            new Map([["order_state", ['pending"', "ship\\ped", "done\nnow"]]]),
            undefined,
            {
                metadata: {
                    comments: [
                        { table_name: "orders", column_name: null, comment: 'Orders.\n"Quoted", and \\escaped\\.' },
                        { table_name: "orders", column_name: "state", comment: 'The "state".' }
                    ],
                    uniques: []
                }
            } as never
        );

        expect(diagnostics(new Map([["orders", source]]))).toEqual([]);
    });

    it("does not let a database name add a declaration to the file", () => {
        // The threat is a schema the developer did not author — an imported
        // dump, a tenant's database, anything `rebase init` was pointed at.
        const payload = 'x"; })(); export const OWNED = (globalThis as any).process?.env; const y = "';
        const meta = table("t", [
            column("t", "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
            column("t", payload),
            column("t", "state", { data_type: "USER-DEFINED", udt_name: "s" })
        ]);

        const source = generateCollectionFile(
            "t", meta, [], new Set(), new Map([["t", meta]]), new Map([["s", [payload]]])
        );

        expect(topLevelDeclarations(source)).toEqual(["import", "tCollection", "export="]);
        expect(diagnostics(new Map([["t", source]]))).toEqual([]);
    });

    it("does not let a table name escape the import specifier it is written into", () => {
        const hostile = 'a"; import { x } from "./y';
        const child = table("child", [
            column("child", "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO" }),
            column("child", "parent_id", { data_type: "uuid", udt_name: "uuid" })
        ], ["id"], [{ table_name: "child", column_name: "parent_id", foreign_table_name: hostile, foreign_column_name: "id" }]);
        const parent = table(hostile, [column(hostile, "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })]);

        const source = generateCollectionFile(
            "child", child, [], new Set(), new Map([["child", child], [hostile, parent]]), new Map()
        );

        // One import for the types package, one for the target, and nothing else.
        expect(topLevelDeclarations(source).filter(d => d === "import").length).toBeLessThanOrEqual(2);
        expect(topLevelDeclarations(source)).toEqual(["import", "import", "childCollection", "export="]);
    });

    it("keeps a multi-line classification reason inside its comment", () => {
        const meta = table("audit_log", [
            column("audit_log", "id", { data_type: "uuid", udt_name: "uuid", is_nullable: "NO" })
        ]);

        const source = generateCollectionFile(
            "audit_log", meta, [], new Set(), new Map([["audit_log", meta]]), new Map(), undefined,
            {
                classifications: new Map([["audit_log", {
                    role: "log",
                    reason: "append-only\nexport const OWNED = 1;"
                }]])
            } as never
        );

        expect(topLevelDeclarations(source)).toEqual(["import", "auditLogCollection", "export="]);
        expect(diagnostics(new Map([["audit_log", source]]))).toEqual([]);
    });
});
