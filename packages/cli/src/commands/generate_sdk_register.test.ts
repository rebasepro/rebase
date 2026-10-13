import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import ts from "typescript";
import { generateSdkCommand, REGISTER_FILE } from "./generate_sdk";

/**
 * `rebase generate-sdk --register`: the generated `Database`, registered on
 * `@rebasepro/types`' `Register` where both compiles of a collection file see
 * it.
 *
 * A collection file is compiled twice: by the backend (whose tsconfig includes
 * `../config/**`) and by the `config` package's own `tsc`. A registration in
 * `config/` that imported `../generated/sdk/database.types` broke the second:
 * the file is outside `config/`, so TypeScript refuses it as not under the
 * package's `rootDir`. The registration and a copy of the types therefore go
 * to `config/generated/`, which both programs include.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.resolve(here, "../../templates/template");
const require = createRequire(import.meta.url);

/** A scaffolded project: the template's two tsconfigs and one collection file. */
function scaffold(root: string): string {
    fs.mkdirSync(path.join(root, "config/collections"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend/src"), { recursive: true });
    fs.copyFileSync(path.join(templateDir, "config/tsconfig.json"), path.join(root, "config/tsconfig.json"));
    fs.copyFileSync(path.join(templateDir, "backend/tsconfig.json"), path.join(root, "backend/tsconfig.json"));
    fs.writeFileSync(
        path.join(root, "config/collections/my-notes.ts"),
        "export default { slug: \"my-notes\", table: \"notes\", name: \"Notes\", " +
        "properties: { id: { type: \"string\", isId: true }, body: { type: \"string\", validation: { required: true } } } };\n"
    );
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
    return path.join(root, "config/collections");
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

/** A probe in `config/`: compiles only when `Register` holds the generated `Database`. */
const REGISTERED_PROBE =
    "import type { RegisteredDatabase } from \"@rebasepro/types\";\n" +
    "type Body = RegisteredDatabase extends { myNotes: { Row: { body: infer B } } } ? B : never;\n" +
    "export const body: Body = \"typed\";\n";

describe("generate-sdk --register", () => {
    let root: string;
    let logSpy: ReturnType<typeof vi.spyOn>;
    let exitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-register-")));
        logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
        logSpy.mockRestore();
        exitSpy.mockRestore();
    });

    const generate = (collectionsDir: string, register?: boolean) => generateSdkCommand({
        collectionsDir,
        output: path.join(root, "generated/sdk"),
        cwd: root,
        projectRoot: root,
        ...(register ? { register } : {})
    });

    const writeManifest = (backend: Record<string, unknown>) => fs.writeFileSync(
        path.join(root, "rebase.json"),
        JSON.stringify({ rebase: "^1", apps: { backend: { type: "backend", runtime: "managed", ...backend } }, telemetry: false })
    );
    const readManifest = () => JSON.parse(fs.readFileSync(path.join(root, "rebase.json"), "utf-8"));

    it("writes nothing into config/ without the flag", async () => {
        const collectionsDir = scaffold(root);
        await generate(collectionsDir);

        expect(fs.existsSync(path.join(root, "generated/sdk/database.types.ts"))).toBe(true);
        expect(fs.existsSync(path.join(root, "config/generated"))).toBe(false);
    });

    it("writes the types and the Register declaration into config/generated", async () => {
        const collectionsDir = scaffold(root);
        await generate(collectionsDir, true);

        const copied = fs.readFileSync(path.join(root, "config/generated/database.types.ts"), "utf-8");
        expect(copied).toBe(fs.readFileSync(path.join(root, "generated/sdk/database.types.ts"), "utf-8"));
        const register = fs.readFileSync(path.join(root, "config/generated", REGISTER_FILE), "utf-8");
        expect(register).toContain("declare module \"@rebasepro/types\"");
        expect(register).toContain("database: Database;");
        expect(register).toContain("from \"./database.types\"");
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("compiles under both the config package's tsc and the backend's, and types both", async () => {
        const collectionsDir = scaffold(root);
        await generate(collectionsDir, true);
        fs.writeFileSync(path.join(root, "config/collections/probe.ts"), REGISTERED_PROBE);

        expect(diagnostics(path.join(root, "config/tsconfig.json"))).toEqual([]);
        expect(diagnostics(path.join(root, "backend/tsconfig.json"))).toEqual([]);
    });

    it("the probe is refused without the registration", async () => {
        const collectionsDir = scaffold(root);
        await generate(collectionsDir);
        fs.writeFileSync(path.join(root, "config/collections/probe.ts"), REGISTERED_PROBE);

        expect(diagnostics(path.join(root, "config/tsconfig.json")).join("\n")).toMatch(/TS2322/);
    });

    it("keeps the registration current on a later run without the flag", async () => {
        const collectionsDir = scaffold(root);
        await generate(collectionsDir, true);
        fs.writeFileSync(
            path.join(collectionsDir, "tags.ts"),
            "export default { slug: \"tags\", name: \"Tags\", properties: { label: { type: \"string\" } } };\n"
        );

        await generate(collectionsDir);

        expect(fs.readFileSync(path.join(root, "config/generated/database.types.ts"), "utf-8")).toContain("tags");
    });

    it("remembers --register in rebase.json, keeping the rest of the file", async () => {
        const collectionsDir = scaffold(root);
        writeManifest({ functions: "backend/functions" });

        await generate(collectionsDir, true);

        const manifest = readManifest();
        expect(manifest.apps.backend.registerDatabase).toBe(true);
        expect(manifest.apps.backend.functions).toBe("backend/functions");
        expect(manifest.telemetry).toBe(false);
    });

    it("registers on a fresh clone, where only rebase.json remembers the choice", async () => {
        // `config/generated/` is gitignored: a clone has the manifest and no register.ts.
        const collectionsDir = scaffold(root);
        writeManifest({ registerDatabase: true });

        await generate(collectionsDir);

        expect(fs.readFileSync(path.join(root, "config/generated", REGISTER_FILE), "utf-8"))
            .toContain("database: Database;");
        expect(exitSpy).not.toHaveBeenCalled();
    });

    it("does not register when rebase.json leaves it off", async () => {
        const collectionsDir = scaffold(root);
        writeManifest({});

        await generate(collectionsDir);

        expect(fs.existsSync(path.join(root, "config/generated"))).toBe(false);
        expect(readManifest().apps.backend).not.toHaveProperty("registerDatabase");
    });

    it("writes no rebase.json into a project that has none", async () => {
        const collectionsDir = scaffold(root);

        await generate(collectionsDir, true);

        expect(fs.existsSync(path.join(root, "config/generated", REGISTER_FILE))).toBe(true);
        expect(fs.existsSync(path.join(root, "rebase.json"))).toBe(false);
    });

    it("leaves a register.ts it did not write alone", async () => {
        const collectionsDir = scaffold(root);
        fs.mkdirSync(path.join(root, "config/generated"));
        fs.writeFileSync(path.join(root, "config/generated", REGISTER_FILE), "// mine\n");

        await generate(collectionsDir, true);

        expect(fs.readFileSync(path.join(root, "config/generated", REGISTER_FILE), "utf-8")).toBe("// mine\n");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
