/**
 * What `rebase schema introspect` writes, for real schemas.
 *
 * Every project asserted here is generated from metadata a live PostgreSQL
 * server produced — chinook, northwind, pagila, musicbrainz, openstreetmap and
 * constraint-shapes, captured under `test/fixtures/real-schemas`. The output is
 * `backend/schema/<table>.ts` (the one table printer) and, beside a table whose
 * structure suggested how the panel should show it, `frontend/src/cms/<table>.tsx`.
 *
 * Four checks, strongest last:
 *
 * 1. the output, byte for byte, against its goldens in
 *    `test/fixtures/introspect-golden/<schema>/` (re-record with
 *    `UPDATE_INTROSPECT_GOLDEN=1` — the diff of the goldens IS the review);
 * 2. what the files say: the tables, relations, `rls`, customizations;
 * 3. every generated schema module typechecks against the workspace builders;
 * 4. the generated project, evaluated and planned through the same pipeline
 *    as `rebase db generate`, holds the same tables, columns, types, keys,
 *    constraints and policies as the frozen legacy generation of the same
 *    captures (`test/fixtures/plan-golden/real-schema.*`, planned from
 *    `test/fixtures/plan-corpus-legacy/real-schema/**`) — every difference is
 *    one of {@link INTENDED}, each named with why.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";

import { REAL_SCHEMAS, readGolden } from "./helpers/plan-corpus";
import {
    evaluateSchemaModules,
    generateRealSchema,
    planDefinitions,
    planDifferences,
    plannedSchemaOf,
    withoutCustomColumns,
    type CustomColumn
} from "./helpers/introspect-generation";
import { buildSchema, column, serialPk, type RealSchemaName } from "./helpers/schema-metadata";
import { generateSchemaModules, type SchemaGeneration } from "../src/schema/introspect-db-logic";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const GOLDEN_DIR = path.join(__dirname, "fixtures", "introspect-golden");
const UPDATE = process.env.UPDATE_INTROSPECT_GOLDEN === "1";

const generated = new Map<RealSchemaName, SchemaGeneration>(REAL_SCHEMAS.map(name => [name, generateRealSchema(name)]));
const of = (name: RealSchemaName): SchemaGeneration => {
    const found = generated.get(name);
    if (!found) throw new Error(`no generation for ${name}`);
    return found;
};
const moduleOf = (name: RealSchemaName, table: string): string => {
    const found = of(name).tables.find(t => t.table === table);
    if (!found) throw new Error(`no module for ${name}.${table}`);
    return found.schemaModule;
};
const customizationOf = (name: RealSchemaName, table: string): string | undefined =>
    of(name).tables.find(t => t.table === table)?.customization;

/** The files a generation writes, by path relative to the project root. */
function filesOf(generation: SchemaGeneration): Map<string, string> {
    const files = new Map<string, string>();
    for (const table of generation.tables) {
        files.set(`backend/schema/${table.table}.ts`, table.schemaModule);
        if (table.customization) files.set(`frontend/src/cms/${table.table}.tsx`, table.customization);
    }
    return files;
}

// ═══════════════════════════════════════════════════════════════════════
// 1. Goldens
// ═══════════════════════════════════════════════════════════════════════
describe("the generated files match their goldens", () => {
    it.each(REAL_SCHEMAS)("%s, byte for byte", name => {
        const dir = path.join(GOLDEN_DIR, name);
        const files = filesOf(of(name));
        if (UPDATE) {
            fs.rmSync(dir, { recursive: true, force: true });
            for (const [file, content] of files) {
                const target = path.join(dir, `${file}.txt`);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, content);
            }
            return;
        }
        const recorded = new Map<string, string>();
        const walk = (current: string): void => {
            if (!fs.existsSync(current)) return;
            for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) walk(full);
                else recorded.set(path.relative(dir, full).split(path.sep).join("/").replace(/\.txt$/, ""), fs.readFileSync(full, "utf8"));
            }
        };
        walk(dir);
        expect([...files.keys()].sort()).toEqual([...recorded.keys()].sort());
        for (const [file, content] of files) expect({ file, content }).toEqual({ file, content: recorded.get(file) });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 2. What the files say
// ═══════════════════════════════════════════════════════════════════════
describe("tables generated from a real schema", () => {
    it("writes no file for a join table, and folds it into a manyToMany on the end that keys it", () => {
        const tables = (name: RealSchemaName) => of(name).tables.map(t => t.table);
        expect(tables("pagila")).not.toContain("film_actor");
        expect(tables("pagila")).not.toContain("film_category");
        expect(tables("northwind")).not.toContain("employee_territories");
        expect(tables("chinook")).not.toContain("playlist_track");
        expect(moduleOf("pagila", "actor")).toContain("film: rel.manyToMany(() => film, {");
        expect(moduleOf("pagila", "actor")).toContain("through: \"film_actor\"");
    });

    it("writes no file for a partition, and leaves out a partitioned table keyed on an instant, saying why", () => {
        expect(of("pagila").tables.filter(t => t.table.startsWith("payment_p"))).toEqual([]);
        expect(of("pagila").failed).toEqual([{ table: "payment", reason: expect.stringContaining("its key includes \"payment_date\" (timestamptz)") }]);
    });

    it("declares the foreign-key column and its belongsTo beside it", () => {
        const album = moduleOf("chinook", "album");
        expect(album).toContain("artistId: col.integer().notNull()");
        expect(album).toContain("artist: rel.belongsTo(() => artist, { onDelete: \"no action\" })");
        expect(album).toContain("track: rel.hasMany(() => track)");
    });

    it("gives a link whose column has no `_id` its own name, apart from the column", () => {
        expect(moduleOf("chinook", "employee")).toContain("reportsTo: col.integer()");
        expect(moduleOf("chinook", "employee")).toContain("reportsToRelation: rel.belongsTo(() => employee, { localKey: \"reports_to\", onDelete: \"no action\" })");
    });

    it("never imports the table it declares", () => {
        for (const name of REAL_SCHEMAS) {
            for (const table of of(name).tables) {
                expect({ table: table.table, selfImport: table.schemaModule.includes(`from "./${table.table}";`) }).toEqual({ table: table.table, selfImport: false });
            }
        }
    });

    it("keeps an enum's real type name, and a smallint a smallint", () => {
        expect(moduleOf("pagila", "film")).toContain("rating: col.enum([\"G\", \"PG\", \"PG-13\", \"R\", \"NC-17\"], { name: \"mpaa_rating\" }).default(\"G\")");
        expect(moduleOf("pagila", "film")).toContain("rentalDuration: col.smallint().notNull().default(3)");
    });

    it("declares a type no other builder names with col.custom, and says what that means for a push", () => {
        expect(moduleOf("chinook", "employee")).toContain("birthDate: col.custom(\"timestamp without time zone\")");
        expect(moduleOf("chinook", "employee")).toMatch(/^\/\/ {3}- "birth_date" is timestamp without time zone, declared with `col\.custom\(\)`/m);
    });

    it("carries a generated column, CHECK bounds and comments across", () => {
        const shapes = moduleOf("constraint-shapes", "constraint_shapes");
        // A generated column (the capture holds no expression): never written.
        expect(shapes).toContain("computedTotal: col.numeric().readOnly()");
        expect(shapes).toMatch(/\.validate\(\{[^)]*min: /);
        expect(shapes).toMatch(/\.describe\(/);
        expect(shapes).toMatch(/description: "/);
    });

    it("says which schema each table is in, when it is not public, and folds no junction outside public", () => {
        const crm = generateRealSchema("pagila", { pgSchema: "crm" });
        for (const table of crm.tables) expect(table.schemaModule).toContain("schema: \"crm\"");
        expect(crm.tables.map(t => t.table)).toContain("film_actor");
        for (const table of crm.tables) expect(table.schemaModule).not.toContain("rel.manyToMany");
        for (const table of of("pagila").tables) expect(table.schemaModule).not.toContain("schema: ");
    });

    it("is \"admin-only\" where the capture read no policy", () => {
        for (const table of of("chinook").tables) expect(table.schemaModule).toContain("rls: \"admin-only\"");
    });

    it("states the role it read and the evidence, for a table that is not an entity", () => {
        expect(moduleOf("northwind", "order_details")).toMatch(/^\/\/ Introspected as an owned-child: /m);
        expect(moduleOf("chinook", "album")).not.toContain("// Introspected as");
    });
});

describe("the panel customizations", () => {
    it("are written only where a heuristic fired", () => {
        expect(customizationOf("chinook", "artist")).toBeUndefined();
        expect(customizationOf("chinook", "album")).toContain("export const albumCms = customizeTable<typeof album>(\"album\", {");
        expect(customizationOf("chinook", "album")).toContain("import type { album } from \"../../../backend/schema/album\";");
    });

    it("carry the roles, titles, sorts, list caps and boards the structure suggests", () => {
        expect(customizationOf("northwind", "order_details")).toContain("hideFromNavigation: true");
        expect(customizationOf("pagila", "language")).toContain("group: \"Reference\"");
        expect(customizationOf("pagila", "film")).toContain("title: \"title\"");
        expect(customizationOf("pagila", "film")).toContain("sort: [\"lastUpdate\", \"desc\"]");
        expect(customizationOf("pagila", "film")).toContain("listFields: [");
        const boards = REAL_SCHEMAS.flatMap(name => of(name).tables.map(t => t.customization ?? "")).filter(c => c.includes("kanban: {") || c.includes("A board over"));
        expect(boards.length).toBeGreaterThan(0);
    });

    it("are not written for a project without a frontend", () => {
        expect(generateRealSchema("pagila", { cms: false }).tables.every(t => t.customization === undefined)).toBe(true);
    });

    it("use only keys customizeTable accepts", () => {
        const source = fs.readFileSync(path.join(REPO_ROOT, "packages/cms-types/src/table_customization.ts"), "utf8");
        const listed = (name: string): Set<string> => {
            const block = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\]`).exec(source);
            if (!block) throw new Error(`${name} moved`);
            return new Set([...block[1].matchAll(/"([^"]+)"/g)].map(match => match[1]));
        };
        const tableKeys = listed("TABLE_CUSTOMIZATION_KEYS");
        const fieldKeys = listed("FIELD_CUSTOMIZATION_KEYS");
        for (const name of REAL_SCHEMAS) {
            for (const table of of(name).tables) {
                if (!table.customization) continue;
                for (const [, key] of table.customization.matchAll(/^ {4}(\w+): /gm)) expect({ table: table.table, key, known: tableKeys.has(key) }).toEqual({ table: table.table, key, known: true });
                for (const [, key] of table.customization.matchAll(/^ {12}(\w+): /gm)) expect({ table: table.table, key, known: fieldKeys.has(key) }).toEqual({ table: table.table, key, known: true });
            }
        }
    });
});

describe("generating without a structural analysis", () => {
    it("still produces a table, with no derived panel options", () => {
        const { metadata } = buildSchema({
            tables: [{ name: "notes", columns: [serialPk("notes"), column("notes", "body", { data_type: "text" })] }]
        });
        const result = generateSchemaModules({ metadata, cms: { tableImport: t => `../../../backend/schema/${t}` } });
        expect(result.tables.map(t => t.table)).toEqual(["notes"]);
        expect(result.tables[0].schemaModule).toContain("export const notes = defineTable(\"notes\", {");
        expect(result.tables[0].customization).not.toContain("display:");
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 3. Typecheck
// ═══════════════════════════════════════════════════════════════════════
describe("generated schema modules typecheck", () => {
    jest.setTimeout(180_000);

    it("for every real schema, against the workspace builders", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-introspect-tc-"));
        try {
            const entryFiles: string[] = [];
            for (const name of REAL_SCHEMAS) {
                const schemaDir = path.join(dir, name);
                fs.mkdirSync(schemaDir);
                for (const table of of(name).tables) {
                    const file = path.join(schemaDir, `${table.table}.ts`);
                    fs.writeFileSync(file, table.schemaModule, "utf-8");
                    entryFiles.push(file);
                }
            }
            const program = ts.createProgram(entryFiles, {
                noEmit: true,
                strict: true,
                skipLibCheck: true,
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
            const files = new Set(entryFiles);
            const diagnostics = ts.getPreEmitDiagnostics(program)
                .filter(d => d.file && files.has(d.file.fileName))
                .map(d => `${path.relative(dir, d.file?.fileName ?? "")} TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
            expect(diagnostics).toEqual([]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});

// ═══════════════════════════════════════════════════════════════════════
// 4. Planned, against the frozen legacy generation
// ═══════════════════════════════════════════════════════════════════════

/**
 * Every way the generated project's plan may differ from the frozen legacy
 * generation's, each with why. The legacy generator wrote a document-shaped
 * property per column and the planner re-derived a type from it, so where a
 * property could not say the column, the push it led to changed the database;
 * the new generator states the column the catalogue holds.
 */
const INTENDED: { pattern: RegExp; reason: string }[] = [
    { pattern: /: type \{"kind":"integer"\} → \{"kind":"smallint"\}$/, reason: "a smallint stays a smallint (legacy widened it to integer: no property type named smallint)" },
    { pattern: /: type \{"kind":"bigint"\} → \{"kind":"integer"\}$/, reason: "a foreign-key column keeps the type the database gives it (legacy planned it as the target key's type)" },
    { pattern: /: type \{"kind":"numeric"\} → \{"kind":"numeric","precision":\d+,"scale":\d+\}$/, reason: "numeric(p, s) keeps its precision and scale" },
    { pattern: /: type \{"kind":"enum","schema":"public","name":"[^"]+","labels":(\[[^\]]*\])\} → \{"kind":"enum","schema":"public","name":"[^"]+","labels":\1\}$/, reason: "an enum keeps its real type name, shared between columns (legacy named one per column, `<table>_<column>`, and asked for a rename)" },
    { pattern: /^enum public\.[a-z_]+: (undefined → \[|\[.* → undefined$)/, reason: "the enum types that rename moves: the real one planned, the per-column one not" },
    { pattern: /: type \{"kind":"enum",[^}]*\} → \{"kind":"(text|varchar)"(,"length":\d+)?\}$/, reason: "a text column with CHECK (… IN …) stays text, the CHECK enforcing the set (legacy declared an enum type and asked for a conversion)" },
    { pattern: /: default \{"kind":"sql","expression":"(''::character varying|0)"\} → \{"kind":"literal","value":(""|0),"sql":"('')?0?"\}$/, reason: "a literal default is stated as the literal (the same DEFAULT, without the cast)" },
    { pattern: /: default undefined → \{"kind":"literal",/, reason: "a foreign-key column's DEFAULT is kept (a legacy relation property could not state one, so the push dropped it)" },
    { pattern: /^public\.(film_actor|film_category)\.last_update: column only in the new generation$/, reason: "a junction's own columns are its pivot (legacy declared none, so the push dropped them)" },
    { pattern: /^public\.(nodes|ways|relations): table only in the new generation$/, reason: "a composite key pointed at by another table is declared (legacy left it out); the links into it stay plain columns" },
    { pattern: /^public\.gps_points: table only in the legacy generation$/, reason: "a table with no primary key is not generated (legacy gave it an implicit `id`, which the push would have added)" }
];

describe("the generated project plans what the database holds", () => {
    jest.setTimeout(180_000);

    it.each(REAL_SCHEMAS)("%s: every difference from the legacy generation is intended", name => {
        const evaluated = evaluateSchemaModules(of(name).tables.map(t => t.schemaModule));
        const { defs, removed } = withoutCustomColumns(evaluated);
        const legacy = plannedSchemaOf(readGolden({ id: `real-schema.${name}`, collections: [], options: {} })["plan.json"]);
        const differences = planDifferences(legacy, planDefinitions(defs));
        const custom = new Set(removed.map((c: CustomColumn) => `public.${c.table}.${c.column}: column only in the legacy generation`));
        const unexplained = differences.filter(line => !custom.has(line) && !INTENDED.some(intended => intended.pattern.test(line)));
        expect(unexplained).toEqual([]);
    });

    it("leaves out of the plan only the col.custom() columns, which wait on `custom-sql-type`", () => {
        const removed = REAL_SCHEMAS.flatMap(name => withoutCustomColumns(evaluateSchemaModules(of(name).tables.map(t => t.schemaModule))).removed);
        const types = [...new Set(removed.map(c => c.sqlType))].sort();
        expect(types).toEqual(expect.arrayContaining(["timestamp without time zone"]));
        for (const type of types) expect(type).not.toMatch(/^(text|integer|uuid|jsonb?)$/);
    });
});
