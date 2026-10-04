/**
 * `schema.generated.ts` has to compile. Nothing in this repo checked that.
 *
 * The generator's own test file is 1,700 lines of substring assertions, and one
 * of them is named "emits bigint columns that actually compile" — it checks for
 * the string `mode`. A real compile was never run, so six ordinary inputs
 * produced a file that TypeScript rejects:
 *
 *   • `columnType: "uuid"` on a plain string, in a project with no `isId: "uuid"`
 *     anywhere — `uuid` emitted, never imported (the import guard read `isId`
 *     and `autoValue` only);
 *   • `columnType: "smallint"` — in neither the import roster nor a heuristic;
 *   • a self-referential `belongsTo` — `.references(() => posts.id)` inside
 *     `posts` is TS7022;
 *   • every `hasOne` inverse — `one(t, { relationName })` is TS2345 against
 *     drizzle's `RelationConfig` (and throws at runtime besides);
 *   • `isId: "increment"` with `columnType: "bigserial"` —
 *     `generatedByDefaultAsIdentity` does not exist on a bigserial builder;
 *   • an empty `enum` — the column references an enum variable the file never
 *     declares.
 *
 * This is the class the bigint incident already taught: a file that will not
 * build gets hand-patched, then sits stale until a security fix misses
 * production. So the gate is a real `ts.createProgram`, not `parseDiagnostics`
 * — a parse is blind to every one of the six above.
 *
 * The program is built inside this package so that `drizzle-orm` resolves the
 * way it does for a real project: node module resolution walking up to
 * `packages/server-postgres/node_modules`.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import ts from "typescript";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { everything, groups } from "./fixtures/property-matrix-collections";
import type { CollectionConfig } from "@rebasepro/types";

const PACKAGE_ROOT = path.resolve(__dirname, "..");

const COMPILER_OPTIONS: ts.CompilerOptions = {
    strict: true,
    noEmit: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    esModuleInterop: true,
    // The declarations under test are the generated file's, not drizzle's.
    skipLibCheck: true,
    types: []
};

/** Every diagnostic `tsc --strict` would report for a generated schema. */
const compileDiagnostics = (source: string): string[] => {
    const dir = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".schema-compile-"));
    try {
        const file = path.join(dir, "schema.generated.ts");
        fs.writeFileSync(file, source);
        const program = ts.createProgram([file], COMPILER_OPTIONS);
        return ts.getPreEmitDiagnostics(program)
            .filter(d => d.file?.fileName === file.replace(/\\/g, "/") || d.file?.fileName.endsWith("schema.generated.ts"))
            .map(d => {
                const where = d.file && d.start !== undefined
                    ? `${ts.getLineAndCharacterOfPosition(d.file, d.start).line + 1}:`
                    : "";
                return `${where}TS${d.code}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`;
            });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

describe("the generated Drizzle schema compiles", () => {
    it("for a collection set covering every property option", async () => {
        const schema = await generateSchema(everything);
        expect(compileDiagnostics(schema)).toEqual([]);
    }, 60_000);

    // Per group as well as all together, because the whole set hides exactly
    // the bug the import list had: `uuid` was imported because *some other*
    // collection declared `isId: "uuid"`, so a project with only
    // `columnType: "uuid"` was the broken one.
    const isolated: [string, CollectionConfig[]][] = [
        ["uuidOnly", groups.uuidOnly],
        ["smallintOnly", groups.smallintOnly],
        ["relations", groups.relations],
        ["numIds", groups.numIds],
        ["strProps", groups.strProps],
        ["appSchema", groups.appSchema],
        ["indexed", groups.indexed],
        ["searched", groups.searched]
    ];

    it.each(isolated)("for the %s group on its own", async (_name, collections) => {
        const schema = await generateSchema(collections);
        expect(compileDiagnostics(schema)).toEqual([]);
    }, 60_000);

    // The file is what a project's relational queries are typed by, so the
    // types have to say what the database returns. A `hasOne` names its join
    // with this table's key, which is NOT NULL, and drizzle would infer from
    // that a related row that is always there. An author may have no profile.
    it("types a hasOne's related row as possibly absent", async () => {
        const schema = await generateSchema(groups.relations);
        const usage = [
            "import { drizzle } from 'drizzle-orm/node-postgres';",
            "const db = drizzle.mock({ schema: { ...tables, ...relations } });",
            "export async function profileOf() {",
            "    const author = await db.query.authors.findFirst({ with: { profile: true } });",
            "    if (!author) return undefined;",
            "    const absent: typeof author.profile = null;",
            "    return absent;",
            "}"
        ].join("\n");

        expect(compileDiagnostics(`${schema}\n${usage}\n`)).toEqual([]);

        // And the check can fail: the same `one()` without its type arguments
        // is typed as never null.
        const inferred = schema.replace(/one<typeof profiles, \[[^\]]*\]>\(profiles,/, "one(profiles,");
        expect(inferred).not.toBe(schema);
        expect(compileDiagnostics(`${inferred}\n${usage}\n`).join("\n")).toContain("TS2322");
    }, 60_000);

    // A green gate that cannot go red is not a gate. Both halves are checked:
    // a type error in the file, and a drizzle builder used without its import —
    // which is the exact shape of four of the six bugs above.
    it("reports a type error, so an empty result means something", async () => {
        const schema = await generateSchema(groups.uuidOnly);

        expect(compileDiagnostics(`${schema}\nexport const broken: number = "not a number";\n`))
            .toEqual([expect.stringContaining("TS2322")]);

        const withoutImport = schema.replace(/^import \{[^}]*\} from 'drizzle-orm\/pg-core';$/m, "");
        expect(compileDiagnostics(withoutImport).join("\n")).toContain("Cannot find name");
    }, 60_000);
});
