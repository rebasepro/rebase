import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { col, defineTable, type AnyTableDef } from "@rebasepro/types";
import { generateSdkCommand } from "./generate_sdk";
import * as sdkGen from "@rebasepro/codegen";
import { scaffoldProject, workspaceModuleAliases } from "../../test/helpers/project";

// Only `generateSDK` is stubbed. Everything else the command imports comes from
// the real module — a factory that returned just the one export made this file
// fail whenever the command started using another, which says nothing about the
// loader these tests are actually about. The `--from` path, the credential
// guard and the real generated output are covered unmocked in
// `generate_sdk_from.test.ts`.
vi.mock("@rebasepro/codegen", async (importOriginal) => ({
    ...(await importOriginal<typeof sdkGen>()),
    generateSDK: vi.fn(() => [
        { path: "database.types.ts",
content: "export type Database = {};" },
        { path: "index.ts",
content: "export const a = 1;" }
    ])
}));

describe("generateSdkCommand", () => {
    let tmpDir: string;
    let consoleLogSpy: MockInstance<typeof console.log>;
    let processExitSpy: MockInstance<typeof process.exit>;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-sdk-test-"));
        vi.mocked(sdkGen.generateSDK).mockClear();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        processExitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
            throw new Error(`process.exit(${code})`);
        });
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true,
force: true });
        consoleLogSpy.mockRestore();
        processExitSpy.mockRestore();
    });

    const ALIASES = workspaceModuleAliases();

    /** The project's schema: one module per table and the index, as `rebase init` writes them. */
    function schemaWith(tables: AnyTableDef[]): string {
        scaffoldProject({ root: tmpDir, tables, backendDependencies: false });
        return path.join(tmpDir, "backend", "schema");
    }

    const table = (name: string) => defineTable(name, {
        columns: { id: col.uuid().primaryKey(), title: col.text() },
        rls: "admin-only"
    });

    const run = (schemaDir: string) => generateSdkCommand({
        schemaDir,
        output: path.join(tmpDir, "out"),
        cwd: tmpDir,
        projectRoot: tmpDir,
        moduleAliases: ALIASES
    });

    it("says there is nothing to generate from when there is no schema directory, and exits 0", async () => {
        // The headless scaffold has no `backend/schema` by design — its API is
        // introspected from the live database at boot — and it ships
        // `pnpm generate:sdk` anyway. A path in an error reads as a broken
        // install rather than a question with an answer.
        await run(path.join(tmpDir, "does-not-exist"));
        const printed = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("derives its API from the database");
        expect(printed).toContain("no backend/schema");
        expect(processExitSpy).not.toHaveBeenCalled();
        expect(sdkGen.generateSDK).not.toHaveBeenCalled();
    });

    it("orchestrates SDK generation from the tables and writes files to the output directory", async () => {
        const schemaDir = schemaWith([table("posts")]);
        const outputDir = path.join(tmpDir, "out");

        await run(schemaDir);

        expect(fs.existsSync(path.join(outputDir, "database.types.ts"))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, "index.ts"))).toBe(true);
        expect(fs.readFileSync(path.join(outputDir, "database.types.ts"), "utf-8")).toBe("export type Database = {};");
        expect(fs.readFileSync(path.join(outputDir, "schema.meta.ts"), "utf-8")).toMatch(/SCHEMA_VERSION = "v\d+:/);

        // The generator gets the compiled descriptors of what was loaded.
        // `toHaveBeenCalled()` alone left the loader free to regress to `[]`.
        expect(sdkGen.generateSDK).toHaveBeenCalledTimes(1);
        const [tables] = vi.mocked(sdkGen.generateSDK).mock.calls[0];
        expect(tables).toHaveLength(1);
        expect(tables[0]).toMatchObject({ slug: "posts", table: "posts", kind: "table" });
        expect(tables[0].columns.map(column => column.key)).toEqual(["id", "title"]);
    });

    it("gives the README the address this project's backend last bound", async () => {
        const schemaDir = schemaWith([table("posts")]);
        fs.mkdirSync(path.join(tmpDir, ".rebase"));
        fs.writeFileSync(path.join(tmpDir, ".rebase", "state.json"), JSON.stringify({ port: 3755 }));

        await run(schemaDir);

        const [, options] = vi.mocked(sdkGen.generateSDK).mock.calls[0];
        expect(options).toMatchObject({ baseUrl: "http://localhost:3755" });
    });

    it("gives the README the address rebase dev says its backend is starting on", async () => {
        // `rebase dev` regenerates the SDK at boot, before the backend binds —
        // so before `state.json` holds this run's port, and while it may still
        // hold another run's.
        const schemaDir = schemaWith([table("posts")]);
        fs.mkdirSync(path.join(tmpDir, ".rebase"));
        fs.writeFileSync(path.join(tmpDir, ".rebase", "state.json"), JSON.stringify({ port: 3755 }));
        vi.stubEnv("REBASE_DEV_BACKEND_URL", "http://localhost:3918");
        try {
            await run(schemaDir);
        } finally {
            vi.unstubAllEnvs();
        }

        const [, options] = vi.mocked(sdkGen.generateSDK).mock.calls[0];
        expect(options).toMatchObject({ baseUrl: "http://localhost:3918" });
    });

    it("passes every table through, sorted by slug for a stable SDK", async () => {
        await run(schemaWith([table("posts"), table("tags"), table("authors")]));

        const [tables] = vi.mocked(sdkGen.generateSDK).mock.calls[0];
        // Index order is deliberately not preserved: the command sorts by slug
        // so regenerating produces the same file for the same schema.
        expect(tables.map((t) => t.slug)).toEqual(["authors", "posts", "tags"]);
    });

    it("refuses a table the index does not export, as the backend refuses to boot on it", async () => {
        // The index is authoritative: a table defined beside it and not
        // exported has policies and no route (or the reverse). Typing the rest
        // would hand the client a schema the server will not serve.
        const schemaDir = schemaWith([table("posts")]);
        fs.writeFileSync(path.join(schemaDir, "drafts.ts"), [
            "import { defineTable, col } from \"@rebasepro/server/schema\";",
            "export const drafts = defineTable(\"drafts\", { columns: { id: col.uuid().primaryKey() }, rls: \"admin-only\" });",
            ""
        ].join("\n"));

        await expect(run(schemaDir)).rejects.toThrow("process.exit(1)");
        const printed = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
        expect(printed).toContain("drafts");
        expect(printed).toContain("does not export");
        expect(sdkGen.generateSDK).not.toHaveBeenCalled();
    });

    it("refuses a schema module that does not load rather than typing the rest", async () => {
        // `rebase dev` runs this on every save. Skipping the broken file would
        // overwrite good types with a Database silently short a table; boot
        // refuses the same file, so this does too.
        const schemaDir = schemaWith([table("posts")]);
        fs.writeFileSync(path.join(schemaDir, "broken.ts"), "export const broken = { columns: ;\n");

        await expect(run(schemaDir)).rejects.toThrow(/broken\.ts/);
        expect(sdkGen.generateSDK).not.toHaveBeenCalled();
    });

    it("keeps the --debug hint for a module that throws, whose stack is the project's own", async () => {
        // A file that fails on import is the project's code failing; `--debug`
        // prints the stack that points at the line, so this is not a Refusal.
        const schemaDir = schemaWith([table("posts")]);
        fs.writeFileSync(path.join(schemaDir, "broken.ts"), "export const broken = { columns: ;\n");

        await expect(run(schemaDir)).rejects.not.toMatchObject({ isRefusal: true });
    });

    it("refuses a project still on the collections layout, naming the codemod", async () => {
        const schemaDir = schemaWith([table("posts")]);
        fs.mkdirSync(path.join(tmpDir, "config", "collections"), { recursive: true });

        await expect(run(schemaDir)).rejects.toThrow(/rebase migrate collections-to-tables/);
        expect(sdkGen.generateSDK).not.toHaveBeenCalled();
    });
});
