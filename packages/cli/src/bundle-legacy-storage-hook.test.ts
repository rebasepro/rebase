/**
 * `rebase build` says so when `config/index.ts` still exports `storageAuthorize`.
 *
 * 0.30 read the hook from the config package's index; 0.31 reads it from
 * `backend/storage.ts` (`entry.storage`) and nothing else. A project that kept
 * the old export built clean and deployed without it — no manifest entry, no
 * import, no warning — so storage ran under whatever `backend/storage.ts` said,
 * and with no such file, under no access model at all.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { createRequire } from "module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildBundle } from "./bundle";
import { workspaceModuleAliases } from "../test/helpers/project";

const require = createRequire(import.meta.url);

let scratch: string;
let printed: string[];

function write(relative: string, content: string): void {
    const file = path.join(scratch, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

const NOTES = "import { defineTable, col } from \"@rebasepro/server/schema\";\n" +
    "export const notes = defineTable(\"notes\", { slug: \"notes\", " +
    "columns: { id: col.text().primaryKey(), body: col.text().notNull() }, rls: \"admin-only\" });\n";

beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-legacy-hook-")));
    write("backend/schema/index.js", "export { notes } from \"./notes.js\";\n");
    write("backend/schema/notes.js", NOTES);
    // This repository's TypeScript, not whatever `tsc` is on the PATH.
    fs.mkdirSync(path.join(scratch, "node_modules/.bin"), { recursive: true });
    fs.symlinkSync(require.resolve("typescript/bin/tsc"), path.join(scratch, "node_modules/.bin/tsc"));
    printed = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { printed.push(args.map(String).join(" ")); });
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true,
force: true });
    vi.restoreAllMocks();
});

const build = () => buildBundle({
    projectRoot: scratch,
    appName: "backend",
    app: { type: "backend",
runtime: "managed" },
    runtimeRange: "^1",
    moduleAliases: workspaceModuleAliases()
});

const LEGACY_INDEX = "export const storageAuthorize = () => true;\n";

describe("a build with storageAuthorize left in config/index.ts", () => {
    it("warns that the bundle ships no storage access control when backend/storage.ts has none", async () => {
        write("config/index.ts", LEGACY_INDEX);

        const result = await build();

        const output = printed.join("\n");
        expect(output).toContain("config/index.ts exports `storageAuthorize`, and this bundle does not read it");
        expect(output).toContain("This bundle ships no storage access control");
        expect(output).toContain("backend/storage.ts");
        expect(result.manifest.storage?.authorize).toBe(false);
    });

    it("names backend/storage.ts as the hook deployed when it exports one too", async () => {
        write("config/index.ts", LEGACY_INDEX);
        write("backend/storage.ts", "export const storageAuthorize = () => false;\n");

        const result = await build();

        const output = printed.join("\n");
        expect(output).toContain("config/index.ts exports `storageAuthorize`, and this bundle does not read it");
        expect(output).toContain("exports one too, and that is the one deployed");
        expect(output).not.toContain("ships no storage access control");
        expect(result.manifest.storage?.authorize).toBe(true);
    });

    it("says nothing when the hook lives only in backend/storage.ts", async () => {
        write("config/index.ts", "export const APP_NAME = \"notes\";\n");
        write("backend/storage.ts", "export const storageAuthorize = () => false;\n");

        await build();

        expect(printed.join("\n")).not.toContain("does not read it");
    });
});
