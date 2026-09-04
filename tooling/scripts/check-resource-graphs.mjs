/**
 * Every project in this repository has a resource graph that matches its code.
 *
 * `rebase.resources.json` is generated from `config/resources.ts` and committed,
 * because a host reads it to decide what to provision *before* it runs
 * anything. `rebase build` rewrites it, so a project that builds is honest by
 * construction — and a `runtime: "custom"` project never runs `rebase build`.
 * It builds its own image. So for exactly the projects where the committed file
 * is the ONLY record of what they need, nothing was keeping it fresh.
 *
 * `rebase resources --check` is the command that answers this, and until now
 * nothing ran it: not CI, not a package script, not another gate. The comment
 * in `commands/build.ts` said it "is what keeps it honest".
 *
 * Declaring nothing is a pass. A backend has a default database and a default
 * bucket whether or not anyone says so, and requiring an empty file to say so
 * would fail this repository's own reference app and every scaffolded project.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Projects to check: a `rebase.json` with an installed config package beside it.
 *
 * The templates under `packages/cli/templates` are deliberately excluded. They
 * are skeletons with placeholder package names and no `node_modules`, so their
 * config cannot be evaluated — `check:templates` compiles them instead.
 */
function projects() {
    const found = [];
    for (const dir of ["app", "examples"]) {
        const base = path.join(ROOT, dir);
        if (!fs.existsSync(base)) continue;
        const candidates = fs.existsSync(path.join(base, "rebase.json"))
            ? [base]
            : fs.readdirSync(base, { withFileTypes: true })
                .filter(e => e.isDirectory())
                .map(e => path.join(base, e.name))
                .filter(p => fs.existsSync(path.join(p, "rebase.json")));
        for (const candidate of candidates) {
            if (fs.existsSync(path.join(candidate, "node_modules"))) found.push(candidate);
        }
    }
    return found;
}

const cli = path.join(ROOT, "packages", "cli", "bin", "rebase.js");
let failed = 0;
const checked = projects();

for (const project of checked) {
    const rel = path.relative(ROOT, project);
    const result = spawnSync(process.execPath, [cli, "resources", "--check"], {
        cwd: project,
        encoding: "utf8"
    });
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
    if (result.status === 0) {
        console.log(`  \x1b[32mok\x1b[0m   ${rel}`);
    } else {
        failed += 1;
        console.log(`  \x1b[31mFAIL\x1b[0m ${rel}`);
        for (const line of output.split("\n")) console.log(`       ${line}`);
    }
}

if (checked.length === 0) {
    console.log("  No installed projects with a rebase.json — nothing to check.");
}

if (failed > 0) {
    console.error(`\n✗ ${failed} project(s) have a stale or missing rebase.resources.json.`);
    console.error("  Regenerate with `rebase resources --write` in that project.\n");
    process.exit(1);
}

console.log(`\n✓ ${checked.length} project resource graph(s) match their declarations.`);
