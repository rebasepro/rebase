import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import ts from "typescript";
import { generateSdkCommand, REGISTER_FILE } from "./generate_sdk";
import { workspaceModuleAliases } from "../../test/helpers/project";

/**
 * `rebase generate-sdk --register`: the generated `Database`, registered on
 * `@rebasepro/types`' `Register` inside the backend's program, where hooks,
 * functions and crons compile against it.
 *
 * The registration and a copy of the types go to `backend/generated/`: a
 * registration that imported `../generated/sdk/database.types` would pull a
 * file from outside `backend/` into its program, which TypeScript refuses as
 * not under the backend's `rootDir`.
 *
 * The table is written as JavaScript, which the backend's `tsc` does not
 * compile (no `allowJs`), so the program proves the layout and not this
 * repository's type declarations; the loader reads it all the same.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, "../../templates/template");
const require = createRequire(import.meta.url);

/** A table module, as JavaScript. */
const tableModule = (identifier: string, name: string, extra: string) =>
    "import { defineTable, col } from \"@rebasepro/server/schema\";\n" +
    `export const ${identifier} = defineTable("${name}", { ${extra}columns: { id: col.text().primaryKey(), body: col.text().notNull() }, rls: "admin-only" });\n`;

/** A scaffolded project: the template's backend tsconfig and one table. */
function scaffold(root: string): string {
    fs.mkdirSync(path.join(root, "backend/schema"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend/src"), { recursive: true });
    fs.copyFileSync(path.join(templateDir, "backend/tsconfig.json"), path.join(root, "backend/tsconfig.json"));
    fs.writeFileSync(path.join(root, "backend/schema/index.js"), "export { notes } from \"./notes.js\";\n");
    fs.writeFileSync(path.join(root, "backend/schema/notes.js"), tableModule("notes", "notes", "slug: \"my-notes\", "));
    fs.writeFileSync(path.join(root, "backend/src/index.ts"), "export const ready = true;\n");

    // The two packages the programs resolve: `@types/node` (both tsconfigs pin
    // it) and a `@rebasepro/types` that declares `Register` the way the real
    // one does, so the proof is about the layout, not about this repo's build.
    fs.mkdirSync(path.join(root, "node_modules/@types"), { recursive: true });
    fs.symlinkSync(path.dirname(require.resolve("@types/node/package.json")), path.join(root, "node_modules/@types/node"));
    const typesDir = path.join(root, "node_modules/@rebasepro/types");
    fs.mkdirSync(typesDir, { recursive: true });
    fs.writeFileSync(path.join(typesDir, "package.json"), JSON.stringify({ name: "@rebasepro/types", types: "index.d.ts" }));
    fs.writeFileSync(path.join(typesDir, "index.d.ts"),
        "export interface Register {}\n" +
        "export type RegisteredDatabase = Register extends { database: infer DB } ? DB : unknown;\n");
    return path.join(root, "backend/schema");
}

/** What tsc reports for a tsconfig, as `file(line): TSxxxx message` lines. */
function diagnostics(tsconfig: string): string[] {
    const parsed = ts.getParsedCommandLineOfConfigFile(tsconfig, { noEmit: true }, {
        ...ts.sys,
        onUnRecoverableConfigFileDiagnostic: () => undefined
    });
    if (!parsed) throw new Error(`could not read ${tsconfig}`);
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
    return [...parsed.errors, ...ts.getPreEmitDiagnostics(program)].map((d) =>
        `${d.file ? path.basename(d.file.fileName) : "-"}: TS${d.code} ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
}

/** A probe in the backend: compiles only when `Register` holds the generated `Database`. */
const REGISTERED_PROBE =
    "import type { RegisteredDatabase } from \"@rebasepro/types\";\n" +
    "type Body = RegisteredDatabase extends { myNotes: { Row: { body: infer B } } } ? B : never;\n" +
    "export const body: Body = \"typed\";\n";

/** What the stubbed `process.exit` throws: it stops the command where it is called, as the real one does. */
class ExitCalled extends Error {
    constructor(readonly code: string | number | null | undefined) {
        super(`process.exit(${code})`);
    }
}

describe("generate-sdk --register", () => {
    let root: string;
    let logSpy: MockInstance<typeof console.log>;
    let exitSpy: MockInstance<typeof process.exit>;

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-register-")));
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new ExitCalled(code);
        });
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        logSpy.mockRestore();
        exitSpy.mockRestore();
    });

    const generate = (schemaDir: string, register?: boolean) => generateSdkCommand({
        schemaDir,
        output: path.join(root, "generated/sdk"),
        cwd: root,
        projectRoot: root,
        moduleAliases: workspaceModuleAliases(),
        ...(register ? { register } : {})
    });

    const writeManifest = (backend: Record<string, unknown>) => fs.writeFileSync(
        path.join(root, "rebase.json"),
        JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend", runtime: "managed", ...backend } }, telemetry: false })
    );
    const readManifest = () => JSON.parse(fs.readFileSync(path.join(root, "rebase.json"), "utf-8"));

    it("writes nothing into backend/generated without the flag", async () => {
        const schemaDir = scaffold(root);
        await generate(schemaDir);

        expect(fs.existsSync(path.join(root, "generated/sdk/database.types.ts"))).toBe(true);
        expect(fs.existsSync(path.join(root, "backend/generated"))).toBe(false);
    });

    it("writes the types and the Register declaration into backend/generated", async () => {
        const schemaDir = scaffold(root);
        await generate(schemaDir, true);

        const copied = fs.readFileSync(path.join(root, "backend/generated/database.types.ts"), "utf-8");
        expect(copied).toBe(fs.readFileSync(path.join(root, "generated/sdk/database.types.ts"), "utf-8"));
        const register = fs.readFileSync(path.join(root, "backend/generated", REGISTER_FILE), "utf-8");
        expect(register).toContain("declare module \"@rebasepro/types\"");
        expect(register).toContain("database: Database;");
        expect(register).toContain("from \"./database.types\"");
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("compiles under the backend's tsc, and types its code", async () => {
        const schemaDir = scaffold(root);
        await generate(schemaDir, true);
        fs.writeFileSync(path.join(root, "backend/src/probe.ts"), REGISTERED_PROBE);

        expect(diagnostics(path.join(root, "backend/tsconfig.json"))).toEqual([]);
    });

    it("the probe is refused without the registration", async () => {
        const schemaDir = scaffold(root);
        await generate(schemaDir);
        fs.writeFileSync(path.join(root, "backend/src/probe.ts"), REGISTERED_PROBE);

        expect(diagnostics(path.join(root, "backend/tsconfig.json")).join("\n")).toMatch(/TS2322/);
    });

    it("keeps the registration current on a later run without the flag", async () => {
        const schemaDir = scaffold(root);
        await generate(schemaDir, true);
        fs.writeFileSync(path.join(schemaDir, "tags.js"), tableModule("tags", "tags", ""));
        fs.appendFileSync(path.join(schemaDir, "index.js"), "export { tags } from \"./tags.js\";\n");

        await generate(schemaDir);

        expect(fs.readFileSync(path.join(root, "backend/generated/database.types.ts"), "utf-8")).toContain("tags");
    });

    it("remembers --register in rebase.json, keeping the rest of the file", async () => {
        const schemaDir = scaffold(root);
        writeManifest({ functions: "backend/functions" });

        await generate(schemaDir, true);

        const manifest = readManifest();
        expect(manifest.apps.backend.registerDatabase).toBe(true);
        expect(manifest.apps.backend.functions).toBe("backend/functions");
        expect(manifest.telemetry).toBe(false);
    });

    it("registers on a fresh clone, where only rebase.json remembers the choice", async () => {
        // `backend/generated/` is gitignored: a clone has the manifest and no register.ts.
        const schemaDir = scaffold(root);
        writeManifest({ registerDatabase: true });

        await generate(schemaDir);

        expect(fs.readFileSync(path.join(root, "backend/generated", REGISTER_FILE), "utf-8"))
            .toContain("database: Database;");
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("does not register when rebase.json leaves it off", async () => {
        const schemaDir = scaffold(root);
        writeManifest({});

        await generate(schemaDir);

        expect(fs.existsSync(path.join(root, "backend/generated"))).toBe(false);
        expect(readManifest().apps.backend).not.toHaveProperty("registerDatabase");
    });

    it("writes no rebase.json into a project that has none", async () => {
        const schemaDir = scaffold(root);

        await generate(schemaDir, true);

        expect(fs.existsSync(path.join(root, "backend/generated", REGISTER_FILE))).toBe(true);
        expect(fs.existsSync(path.join(root, "rebase.json"))).toBe(false);
    });

    it("leaves a register.ts it did not write alone", async () => {
        const schemaDir = scaffold(root);
        fs.mkdirSync(path.join(root, "backend/generated"));
        fs.writeFileSync(path.join(root, "backend/generated", REGISTER_FILE), "// mine\n");

        await expect(generate(schemaDir, true)).rejects.toBeInstanceOf(ExitCalled);

        expect(fs.readFileSync(path.join(root, "backend/generated", REGISTER_FILE), "utf-8")).toBe("// mine\n");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
