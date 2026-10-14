/**
 * The cloud app's RLS policies as the framework compiles them, at two revisions.
 *
 * "Did this change the policies?" cannot be answered from a diff. A comment that
 * mentions a policy, a respelling the compiler undoes (`auth.uid()` →
 * `rebase.uid()`), a reordered import — all edit `securityRules` files and change
 * nothing. A shared constant edited three hundred lines from the rule that uses
 * it changes everything, on a line that names no policy at all. So this compiles
 * `config/collections` at both revisions with the same compiler the boot uses
 * (`planCollectionPolicies`) and compares what comes out.
 *
 * Each revision is copied to a temporary directory and compiled there, the base
 * from git and the working tree from disk, so the two are resolved the same way
 * and nothing is written into the checkout. `config/node_modules` is linked in so
 * `@rebasepro/types` resolves exactly as it does for the real package.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
const COMPILER = path.join(REPO, "packages", "server-postgres", "src", "schema", "generate-postgres-ddl-logic.ts");
const PRINTER = path.join(HERE, "print-cloud-policies.mjs");
const MARKER = "@@rebase-cloud-policies@@";
const COLLECTIONS = path.join("config", "collections");

/** Copy `config/collections` at `revision` (or as on disk, for `null`) into `dir`. */
function materialize(saasRoot, revision, dir) {
    const target = path.join(dir, COLLECTIONS);
    fs.mkdirSync(target, { recursive: true });

    if (revision === null) {
        const source = path.join(saasRoot, COLLECTIONS);
        if (fs.existsSync(source)) fs.cpSync(source, target, { recursive: true });
    } else {
        const listed = execFileSync("git", ["ls-tree", "-r", "--name-only", revision, "--", COLLECTIONS], {
            cwd: saasRoot,
            encoding: "utf8",
        });
        for (const file of listed.split("\n").filter(Boolean)) {
            const out = path.join(dir, file);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, execFileSync("git", ["show", `${revision}:${file}`], { cwd: saasRoot }));
        }
    }

    // `"type": "module"` and dependency resolution, as the real package has them.
    const manifest = path.join(saasRoot, "config", "package.json");
    fs.writeFileSync(
        path.join(dir, "config", "package.json"),
        fs.existsSync(manifest) ? fs.readFileSync(manifest) : JSON.stringify({ type: "module" }),
    );
    for (const [link, real] of [
        [path.join(dir, "config", "node_modules"), path.join(saasRoot, "config", "node_modules")],
        [path.join(dir, "node_modules"), path.join(saasRoot, "node_modules")],
    ]) {
        if (fs.existsSync(real)) fs.symlinkSync(real, link, "dir");
    }
}

/** `{ "<schema.table>": statements[] }` for `config/collections` at `revision` (`null` = working tree). */
function compileAt(saasRoot, revision) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-cloud-policies-"));
    try {
        materialize(saasRoot, revision, dir);
        const out = execFileSync(
            process.execPath,
            ["--import", "tsx", PRINTER, path.join(dir, COLLECTIONS, "index.ts"), COMPILER],
            // From the repo root, so `--import tsx` resolves the repo's own tsx.
            { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
        );
        const at = out.lastIndexOf(MARKER);
        if (at === -1) throw new Error("the policy compiler printed no result");
        return JSON.parse(out.slice(at + MARKER.length));
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

/**
 * The tables whose compiled policies differ between `base` and the working tree.
 *
 * Returns `{ changed: string[] }`, or `{ error }` when either side could not be
 * compiled — which the caller must treat as "may have changed", never as "same".
 */
export function compareCloudPolicies(saasRoot, base) {
    try {
        const before = compileAt(saasRoot, base);
        const after = compileAt(saasRoot, null);
        const tables = new Set([...Object.keys(before), ...Object.keys(after)]);
        const changed = [...tables]
            .filter((t) => JSON.stringify(before[t] ?? []) !== JSON.stringify(after[t] ?? []))
            .sort();
        return { changed };
    } catch (error) {
        const detail = `${error.stderr || ""}`.trim().split("\n").slice(-4).join(" ") || error.message;
        return { error: detail };
    }
}
