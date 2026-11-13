/**
 * `loadTables`: the driver's one door to `backend/schema`.
 *
 * Every driver command that reads the schema — `db generate`, each step of
 * `db push`, `schema generate`, `schema stale`, the doctor, `console` — calls
 * it, so what it returns is what gets generated, pushed and checked. Three
 * properties matter:
 *
 * - **Nothing is lost on the way through the files.** The derived-names fixture
 *   (every naming rule at once) is lifted into `defineTable`, printed as a real
 *   `backend/schema` directory, and loaded back: every file the generators
 *   write is byte-identical to lowering the same definitions in memory.
 * - **Slug order.** The generators emit in input order, so the loader hands
 *   the tables over sorted by slug, whatever the index's export order.
 * - **Fail closed.** A module that does not import, or a definition the
 *   compiler refuses, stops the load — the old CLI loader skipped a file that
 *   failed to import, and a table missing from `db generate` is a DROP planned.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { CompiledTable } from "@rebasepro/types";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import {
    isSchemaDefinitionError,
    compileSchema,
    sortTablesBySlug,
    printIndexModule,
    printTableModule,
    type PrintedTableImport
} from "@rebasepro/common";
import {
    collectionsToTableDefs
} from "@rebasepro/common/migrate";
import { isSchemaLoadError } from "@rebasepro/server";

import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import {
    generatePostgresDdl,
    generatePostgresPoliciesDdl,
    generatePostgresSearchDdl,
    generatePostgresTriggersDdl,
    generatePostgresVectorDdl,
    generatePostgresViewsDdl
} from "../src/schema/generate-postgres-ddl-logic";
import { loadTableSchema, loadTables } from "../src/schema/load-tables";
import { FIXTURE, FIXTURE_DATABASE_EXTENSIONS } from "../../../tooling/scripts/derived-names-fixture";

/** Builders from the types package: jest maps bare `@rebasepro/<pkg>` onto source, never a subpath. */
const SPECIFIER = "@rebasepro/types";

const scratch: string[] = [];
const makeProject = (): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-load-tables-"));
    scratch.push(root);
    const dir = path.join(root, "backend", "schema");
    fs.mkdirSync(dir, { recursive: true });
    return dir;
};

afterAll(() => {
    for (const dir of scratch.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Everything the generators write for a set of compiled tables, by file. */
const generatedFiles = async (tables: CompiledTable[]): Promise<Record<string, string>> => ({
    "schema.sql": generatePostgresDdl(tables, { includePolicies: false, includeSearch: false, includeVector: false }),
    "policies.sql": generatePostgresPoliciesDdl(tables),
    "search.sql": generatePostgresSearchDdl(tables),
    "vector.sql": generatePostgresVectorDdl(tables, { extensions: FIXTURE_DATABASE_EXTENSIONS }),
    "triggers.sql": generatePostgresTriggersDdl(tables),
    "views.sql": generatePostgresViewsDdl(tables),
    "schema.generated.ts": await generateSchema(tables)
});

describe("a backend/schema directory, loaded", () => {
    // The fixture's collections are data; the lift is the codemod's own conversion.
    const lifted = collectionsToTableDefs(FIXTURE.map(entry => entry as LegacyCollectionConfig));

    /** The lifted fixture as files, the index exporting them in REVERSE slug order. */
    const writeFixture = (): string => {
        const dir = makeProject();
        const exported: PrintedTableImport[] = [];
        for (const def of lifted.tables) {
            const file = def.name;
            fs.writeFileSync(path.join(dir, `${file}.ts`), printTableModule(def, { specifier: SPECIFIER }));
            const identifier = /export const (\w+) =/.exec(printTableModule(def, { specifier: SPECIFIER }))?.[1];
            if (!identifier) throw new Error(`printed ${def.name} without an export`);
            exported.push({ identifier, importPath: `./${file}` });
        }
        exported.reverse();
        const index = printIndexModule(exported, lifted.defaultRls !== undefined ? { defaultRls: lifted.defaultRls } : {});
        fs.writeFileSync(path.join(dir, "index.ts"), index);
        return dir;
    };

    it("generates exactly what the same definitions lowered in memory generate", async () => {
        const dir = writeFixture();
        const fromDisk = await loadTables(dir);
        const inMemory = sortTablesBySlug(compileSchema(lifted.tables, lifted.defaultRls !== undefined ? { defaultRls: lifted.defaultRls } : {}));

        expect(fromDisk.map(t => t.descriptor.slug)).toEqual(inMemory.map(t => t.descriptor.slug));
        expect(await generatedFiles(fromDisk)).toEqual(await generatedFiles(inMemory));
    });

    it("hands the tables over in slug order, whatever order the index exports them in", async () => {
        const slugs = (await loadTables(writeFixture())).map(t => t.descriptor.slug);
        expect(slugs).toEqual([...slugs].sort((a, b) => a.localeCompare(b)));
        expect(slugs).toHaveLength(lifted.tables.length);
    });

    it("returns the compiled descriptors beside the lowered tables, in the same order", async () => {
        const { collections, descriptors } = await loadTableSchema(writeFixture());
        expect(descriptors.map(d => d.slug)).toEqual(collections.map(c => c.slug));
    });
});

describe("a schema the loader refuses", () => {
    const table = (name: string, extra = ""): string =>
        `import { col, defineTable } from "${SPECIFIER}";\n\n` +
        `export const ${name} = defineTable("${name}", {\n` +
        "    columns: { id: col.uuid().primaryKey().defaultRandom() }" + (extra ? `,\n    ${extra}` : "") + "\n});\n";

    it("stops on a module that does not import, naming the file", async () => {
        const dir = makeProject();
        fs.writeFileSync(path.join(dir, "posts.ts"), table("posts", 'rls: "admin-only"'));
        fs.writeFileSync(path.join(dir, "broken.ts"), 'throw new Error("broken.ts did not evaluate");\nexport {};\n');
        fs.writeFileSync(path.join(dir, "index.ts"), 'export { posts } from "./posts";\n');

        const failure = await loadTables(dir).then(() => undefined, (error: unknown) => error);
        expect(isSchemaLoadError(failure)).toBe(true);
        expect(failure instanceof Error ? failure.message : "").toContain(path.join(dir, "broken.ts"));
        expect(failure instanceof Error ? failure.message : "").toContain("did not evaluate");
    });

    it("stops on a table with no `rls`, naming it, rather than generating it unprotected", async () => {
        const dir = makeProject();
        fs.writeFileSync(path.join(dir, "posts.ts"), table("posts"));
        fs.writeFileSync(path.join(dir, "index.ts"), 'export { posts } from "./posts";\n');

        // `defineTable` itself refuses it, so the module does not import.
        const failure = await loadTables(dir).then(() => undefined, (error: unknown) => error);
        expect(isSchemaLoadError(failure)).toBe(true);
        expect(failure instanceof Error ? failure.message : "").toMatch(/defineTable\("posts", …\)` has no usable `rls`/);
    });

    it("stops on `rls: \"inherit\"` with no `defaultRls`, one problem per line, the table named", async () => {
        const dir = makeProject();
        fs.writeFileSync(path.join(dir, "posts.ts"), table("posts", 'rls: "inherit"'));
        fs.writeFileSync(path.join(dir, "index.ts"), 'export { posts } from "./posts";\n');

        const failure = await loadTables(dir).then(() => undefined, (error: unknown) => error);
        expect(isSchemaDefinitionError(failure)).toBe(true);
        if (!isSchemaDefinitionError(failure)) return;
        expect(failure.problems.map(problem => problem.table)).toEqual(["posts"]);
        expect(failure.message.split("\n").filter(line => line.startsWith("  - posts"))).toHaveLength(1);
    });
});

describe("a schema directory that is not there", () => {
    it("declares no tables — the headless layout — and says so once", async () => {
        const missing = path.join(os.tmpdir(), "rebase-load-tables-nowhere", "backend", "schema");
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            expect(await loadTables(missing)).toEqual([]);
            expect(await loadTables(missing)).toEqual([]);
            const said = warn.mock.calls.map(call => String(call[0]));
            expect(said).toHaveLength(1);
            expect(said[0]).toContain("No schema directory");
            expect(said[0]).toContain("--schema-dir");
        } finally {
            warn.mockRestore();
        }
    });
});
