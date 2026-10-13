/**
 * `rebase normalize-imports`, and above all its `--check`.
 *
 * `--check` is documented as "report what would change and exit 1 if anything
 * would", for CI. It rewrote the files it was reporting on: the check ran the
 * rewrite and only then looked at the flag. So a CI job that ran it fixed the
 * build output in place and failed, and the next run — or the next real
 * `normalize-imports` — then said every import was already complete. A
 * report-only mode that writes is a mode nobody can put in front of a
 * reviewer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { normalizeImportsCommand } from "./normalize-imports";

let dir: string;
let cwd: string;
let out: string[];
let err: string[];

beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-normalize-")));
    cwd = process.cwd();
    process.chdir(dir);
    process.exitCode = undefined;
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { out.push(args.map(String).join(" ")); });
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { err.push(args.map(String).join(" ")); });
});

afterEach(() => {
    process.chdir(cwd);
    process.exitCode = undefined;
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
});

function write(relative: string, content: string): void {
    const file = path.join(dir, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

const read = (relative: string): string => fs.readFileSync(path.join(dir, relative), "utf8");
const text = (lines: string[]): string => lines.join("\n");

async function run(...args: string[]): Promise<void> {
    await normalizeImportsCommand(["node", "rebase", "normalize-imports", ...args]);
}

describe("rebase normalize-imports --check", () => {
    it("reports an incomplete import, exits non-zero, and writes nothing", async () => {
        write("dist/index.js", "import { a } from \"./sub/a\";\n");
        write("dist/sub/a.js", "export const a = 1;\n");

        await run("dist", "--check");

        expect(process.exitCode).toBe(1);
        expect(read("dist/index.js")).toBe("import { a } from \"./sub/a\";\n");
        expect(text(err)).toMatch(/1 relative import\(s\) .*incomplete/);
        expect(text(err)).toContain("rebase normalize-imports dist");
    });

    it("leaves the work to the real run, which then has it to do", async () => {
        write("dist/index.js", "import { a } from \"./sub/a\";\n");
        write("dist/sub/a.js", "export const a = 1;\n");

        await run("dist", "--check");
        process.exitCode = undefined;
        out = [];
        await run("dist");

        expect(read("dist/index.js")).toBe("import { a } from \"./sub/a.js\";\n");
        expect(text(out)).toContain("completed 1 relative import(s)");
        expect(process.exitCode).toBeUndefined();
    });

    it("passes on complete output", async () => {
        write("dist/index.js", "import { a } from \"./sub/a.js\";\n");
        write("dist/sub/a.js", "export const a = 1;\n");

        await run("dist", "--check");

        expect(process.exitCode).toBeUndefined();
        expect(text(out)).toContain("every relative import in dist is complete");
    });

    it("says an import that resolves to no file is not this command's to fix", async () => {
        // It used to say "0 import(s) are incomplete … Run `rebase
        // normalize-imports dist`", which can complete nothing: there is no
        // file to point the import at.
        write("dist/index.js", "import { gone } from \"./missing\";\n");

        await run("dist", "--check");

        expect(process.exitCode).toBe(1);
        const said = text(err);
        expect(said).not.toMatch(/0 relative import\(s\)/);
        expect(said).toMatch(/resolve to no file/);
        expect(read("dist/index.js")).toBe("import { gone } from \"./missing\";\n");
    });
});
