/**
 * `link-worktree-modules.sh` must link every importer `pnpm-workspace.yaml`
 * declares. One it misses has no node_modules in the worktree, and every gate
 * that builds it fails there for a reason that is not the code: the stock
 * bundle's admin (`vite: command not found`) went unlinked from the day it
 * joined the workspace.
 *
 * The test builds a throwaway primary with a node_modules in every importer
 * this checkout has, runs a copy of the script from a throwaway worktree, and
 * checks each importer came out linked. `saas/*` is exempt: it is gitignored,
 * so a worktree never has it.
 *
 * Run: node --test tooling/scripts/test/worktree-link-importers.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(ROOT, "tooling", "scripts", "link-worktree-modules.sh");

/** The `packages:` entries of pnpm-workspace.yaml, expanded against this checkout. */
function workspaceImporters() {
    const yaml = fs.readFileSync(path.join(ROOT, "pnpm-workspace.yaml"), "utf8");
    const block = yaml.split(/^packages:\s*$/m)[1].split(/^\S/m)[0];
    const entries = [...block.matchAll(/^\s+-\s+['"]?([^'"\s#]+)['"]?/gm)].map((m) => m[1]);
    // `!pattern` entries exclude what the globs would otherwise pick up
    // (`!app/dist-bundle*`: build output carrying a package.json).
    const excluded = entries
        .filter((e) => e.startsWith("!"))
        .map((e) => new RegExp(`^${e.slice(1).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`));
    const importers = new Set(["."]);
    for (const entry of entries) {
        if (entry.startsWith("!") || entry.startsWith("saas")) continue;
        if (entry.endsWith("/*")) {
            const dir = path.join(ROOT, entry.slice(0, -2));
            if (!fs.existsSync(dir)) continue;
            for (const name of fs.readdirSync(dir)) {
                const rel = `${entry.slice(0, -2)}/${name}`;
                if (fs.existsSync(path.join(ROOT, rel, "package.json"))) importers.add(rel);
            }
        } else if (fs.existsSync(path.join(ROOT, entry, "package.json"))) {
            importers.add(entry);
        }
    }
    return [...importers].filter((rel) => !excluded.some((re) => re.test(rel)));
}

test("every workspace importer gets a node_modules in the worktree", () => {
    const importers = workspaceImporters();
    assert.ok(importers.includes("infra/stock-bundle/admin"), "the workspace list was read");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-link-"));
    const primary = path.join(dir, "primary");
    const worktree = path.join(dir, "worktree");
    try {
        for (const rel of importers) {
            fs.mkdirSync(path.join(primary, rel, "node_modules", "some-dep"), { recursive: true });
            fs.mkdirSync(path.join(worktree, rel), { recursive: true });
            fs.writeFileSync(path.join(worktree, rel, "package.json"), "{}\n");
        }
        fs.mkdirSync(path.join(worktree, "tooling", "scripts"), { recursive: true });
        const copy = path.join(worktree, "tooling", "scripts", "link-worktree-modules.sh");
        fs.copyFileSync(SCRIPT, copy);

        const run = spawnSync("bash", [copy, primary], { encoding: "utf8" });
        assert.equal(run.status, 0, `the script failed: ${run.stderr}`);

        const missing = importers.filter((rel) => !fs.existsSync(path.join(worktree, rel, "node_modules", "some-dep")));
        assert.deepEqual(missing, [], `importers the script does not link: ${missing.join(", ")}`);
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
