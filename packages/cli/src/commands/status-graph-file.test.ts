/**
 * What `rebase status` says about `rebase.resources.json`.
 *
 * A fresh scaffold's `status` ended with
 *
 *     ○ rebase.resources.json is missing — rebase resources --write
 *
 * on a project nothing was wrong with. The file is written by `rebase build`,
 * every build, which says "commit it" when it changes, and by `rebase
 * resources --write`; the bundle carries the graph to a host either way. A
 * project that has never been built has simply not written it yet, and a status
 * view that flags that on every new project teaches its reader to skim past
 * the lines that matter. A file that is there and disagrees with the
 * declarations is still worth the line: that one is wrong.
 *
 * Fixtures live under the package root, as in `json-output-matrix.test.ts`: a
 * project under `os.tmpdir()` has no `node_modules` above it, so
 * `@rebasepro/types` would not resolve from its `resources.ts`.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { statusCommand } from "./status";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

let root: string;
let cwd: string;
let printed: string[];

beforeEach(() => {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-status-graph-"));
    cwd = process.cwd();
    printed = [];
    const capture = (...parts: unknown[]) => { printed.push(parts.map(String).join(" ")); };
    vi.spyOn(console, "log").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);

    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend"), { recursive: true });
    fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({
        rebase: "^1",
        apps: { backend: { type: "backend", runtime: "managed" } }
    }));
    // What the scaffold declares: the default database, written out.
    fs.writeFileSync(path.join(root, "config", "resources.ts"),
        "import { database } from \"@rebasepro/types\";\nexport const main = database();\n");
    process.chdir(root);
});

afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    process.exitCode = 0;
    fs.rmSync(root, { recursive: true, force: true });
});

describe("rebase status and rebase.resources.json", () => {
    it("does not flag a project that has never written it", async () => {
        await statusCommand(["node", "rebase", "status"]);

        const text = printed.join("\n");
        expect(text).toContain("databases");
        expect(text).not.toContain("rebase.resources.json is missing");
    });

    it("still flags one that disagrees with the declarations", async () => {
        fs.writeFileSync(path.join(root, "rebase.resources.json"), JSON.stringify({ version: 1, resources: [] }));

        await statusCommand(["node", "rebase", "status"]);

        expect(printed.join("\n")).toContain("rebase.resources.json is stale");
    });
});
