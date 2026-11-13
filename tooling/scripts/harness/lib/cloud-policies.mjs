/**
 * The cloud app's RLS policies as the framework compiles them, at two revisions.
 *
 * "Did this change the policies?" cannot be answered from a diff. A comment that
 * mentions a policy, a respelling the compiler undoes (`auth.uid()` →
 * `rebase.uid()`), a reordered import — all edit rule files and change nothing.
 * A shared constant edited three hundred lines from the rule that uses it
 * changes everything, on a line that names no policy at all. So this compiles
 * the schema at both revisions with the same compiler the boot uses and
 * compares what comes out.
 *
 * Two layouts, decided per revision, because a comparison across the commit
 * that migrates the cloud app compares one of each:
 *
 * - `backend/schema/index.ts` (0.31 on): loaded with `loadBackendSchema` and
 *   compiled with `compileLoadedSchema` — the one path boot, the runtime and
 *   the CLI take — and the result planned with `planCollectionPolicies`.
 * - `config/collections/index.ts` (before): its `collections` export, lifted
 *   into tables (`collectionsToTableDefs`, the codemod's core), compiled, and
 *   planned the same way.
 *
 * Each revision is copied to a temporary directory and compiled there, the base
 * from git and the working tree from disk, so the two are resolved the same way
 * and nothing is written into the checkout. The package's `node_modules` is
 * linked in so `@rebasepro/*` resolves exactly as it does for the real package.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..", "..", "..");
const COMPILER = path.join(REPO, "packages", "server-postgres", "src", "schema", "generate-postgres-ddl-logic.ts");
const LOADER = path.join(REPO, "packages", "server", "src", "schema", "load-schema.ts");
const LIFTER = path.join(REPO, "packages", "common", "src", "migrate", "index.ts");
const PRINTER = path.join(HERE, "print-cloud-policies.mjs");
const MARKER = "@@rebase-cloud-policies@@";

/**
 * The two layouts: the package directory that is copied (with its manifest and
 * `node_modules`), and the entry inside it the printer reads.
 */
export const LAYOUTS = [
    { kind: "tables", pkg: "backend", entry: path.join("backend", "schema", "index.ts") },
    { kind: "collections", pkg: "config", entry: path.join("config", "collections", "index.ts") }
];

/** Tracked files under `dir` at `revision`. */
function trackedAt(saasRoot, revision, dir) {
    return execFileSync("git", ["ls-tree", "-r", "--name-only", revision, "--", dir], { cwd: saasRoot, encoding: "utf8" })
        .split("\n").filter(Boolean);
}

/** Which layout `revision` (or the working tree, for `null`) has; `null` when neither. */
function layoutAt(saasRoot, revision) {
    for (const layout of LAYOUTS) {
        const present = revision === null
            ? fs.existsSync(path.join(saasRoot, layout.entry))
            : trackedAt(saasRoot, revision, layout.entry).length > 0;
        if (present) return layout;
    }
    return null;
}

/**
 * Copy the layout's package at `revision` (or as on disk, for `null`) into
 * `dir`. The whole package, not only the schema directory: a table file
 * imports its neighbours (`../resources`, `../lib/…`) and a collection file its
 * helpers.
 */
function materialize(saasRoot, revision, dir, layout) {
    const target = path.join(dir, layout.pkg);
    fs.mkdirSync(target, { recursive: true });

    if (revision === null) {
        const source = path.join(saasRoot, layout.pkg);
        fs.cpSync(source, target, {
            recursive: true,
            filter: (src) => !/[\\/](node_modules|dist)([\\/]|$)/.test(path.relative(source, src))
        });
    } else {
        for (const file of trackedAt(saasRoot, revision, layout.pkg)) {
            const out = path.join(dir, file);
            fs.mkdirSync(path.dirname(out), { recursive: true });
            fs.writeFileSync(out, execFileSync("git", ["show", `${revision}:${file}`], { cwd: saasRoot }));
        }
    }

    // `"type": "module"` and dependency resolution, as the real package has them.
    const manifest = path.join(target, "package.json");
    if (!fs.existsSync(manifest)) fs.writeFileSync(manifest, JSON.stringify({ type: "module" }));
    for (const [link, real] of [
        [path.join(target, "node_modules"), path.join(saasRoot, layout.pkg, "node_modules")],
        [path.join(dir, "node_modules"), path.join(saasRoot, "node_modules")],
    ]) {
        if (fs.existsSync(real) && !fs.existsSync(link)) fs.symlinkSync(real, link, "dir");
    }
}

/** `{ "<schema.table>": statements[] }` for the schema at `revision` (`null` = working tree). */
function compileAt(saasRoot, revision) {
    const layout = layoutAt(saasRoot, revision);
    if (!layout) return {};
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-cloud-policies-"));
    try {
        materialize(saasRoot, revision, dir, layout);
        const out = execFileSync(
            process.execPath,
            ["--import", "tsx", PRINTER, layout.kind, path.join(dir, layout.entry), COMPILER, LOADER, LIFTER],
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
