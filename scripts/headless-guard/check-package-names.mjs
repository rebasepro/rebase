#!/usr/bin/env node
/**
 * Fail if a package name that no longer exists is still referenced.
 *
 * The renames leaked repeatedly in places a codemod cannot see, because the
 * name appears without its scope or a path: a bare `"auth"` in an array of
 * workspace directories, a `.astro` file the extension list missed, an
 * extensionless `.env.example`. Each one failed somewhere unhelpful — a test
 * suite, a template a user scaffolds, or npm at publish time.
 *
 * Run: pnpm run check:names
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim();

/** Removed name -> what replaced it. */
const RENAMED = {
    "server-core": "server",
    "server-postgresql": "server-postgres",
    "server-mongodb": "server-mongo",
    "client-postgresql": "client-postgres",
    "client-firebase": "firebase",
    "plugin-data-enhancement": "plugin-ai",
    "schema-inference": "inference",
    "sdk-generator": "codegen",
    "mcp-server": "mcp",
    formex: "forms",
    core: "app",
    auth: "app (folded in — it was one hook)"
};

/**
 * Names distinctive enough to match on their own, with no scope or path to
 * anchor them.
 *
 * `core` and `auth` are ordinary words, and `formex` outlived its package as
 * an API name (`useFormex`, `formexController`) — matching those bare is all
 * false positives. The rest denote nothing but a package that no longer
 * exists, so a bare mention is a stale mention, and every form that leaked
 * past the anchored patterns was bare: a `server-core` label rendered on the
 * marketing site, a `path.join(root, "packages", "server-core")` no codemod
 * could see because the name was split across arguments, a `](../formex)`
 * link that 404s from a README already published to npm, and a directory
 * tree in the agent skill listing twelve names that had all moved.
 */
const BARE = new Set([
    "server-core",
    "server-postgresql",
    "server-mongodb",
    "client-postgresql",
    "client-firebase",
    "plugin-data-enhancement",
    "schema-inference",
    "sdk-generator",
    "mcp-server"
]);

/**
 * How a given old name is allowed to be spelled before it counts as a hit.
 *
 * `-` joins the boundary class so `rebase-mcp-server` — the MCP server's own
 * advertised name — is not read as a stale `mcp-server`.
 *
 * Bare names match in two spellings: as written, and with the first letter
 * capitalized — `Server-core specific types` opens a sentence and still names
 * the package. Not case-insensitively, though: German capitalizes the parts of
 * a compound noun, so `MCP-Server` and `SDK-Generator` in the German docs are
 * the words "MCP server" and "SDK generator", not the packages that once bore
 * those names. Capitalizing the first letter only tells the two apart.
 */
function patternsFor(old) {
    if (BARE.has(old)) {
        const sentenceInitial = old[0].toUpperCase() + old.slice(1);
        return [new RegExp(`(?<![\\w-])(?:${old}|${sentenceInitial})(?![\\w-])`)];
    }
    // Only the forms that actually denote the package.
    return [new RegExp(`@rebasepro/${old}(?![\\w-])`), new RegExp(`packages/${old}/`)];
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".astro", "pnpm-store"]);
// Changelogs record what shipped under the old names; the architecture doc
// explains why `auth` is gone; the publish summary is a generated record.
const SKIP_FILES = new Set([
    "CHANGELOG.md",
    "pnpm-lock.yaml",
    "pnpm-publish-summary.json",
    "MODULAR-ARCHITECTURE.md",
    "scripts/headless-guard/check-package-names.mjs"
]);

/**
 * Files git tracks — here and in any nested repository.
 *
 * Build output, lint dumps and scaffolded test projects quote old paths from
 * past runs, and walking the filesystem drowns the real hits in them. But
 * `saas/` is its own git repo, so the outer `git ls-files` cannot see it: a
 * stale import there built fine until vite failed at chunk-rendering. Nested
 * repos are asked for their own tracked files.
 */
function nestedRepos() {
    return fs
        .readdirSync(repoRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name))
        .filter((e) => fs.existsSync(path.join(repoRoot, e.name, ".git")))
        .map((e) => e.name);
}

function trackedFiles() {
    const roots = [{ cwd: repoRoot, prefix: "" }, ...nestedRepos().map((r) => ({ cwd: path.join(repoRoot, r), prefix: `${r}/` }))];
    const files = [];
    for (const { cwd, prefix } of roots) {
        const out = execSync("git ls-files -z", { cwd, maxBuffer: 64 * 1024 * 1024 }).toString();
        for (const f of out.split("\0").filter(Boolean)) files.push(prefix + f);
    }
    return files.filter((f) => !SKIP_FILES.has(f) && !SKIP_FILES.has(path.basename(f)));
}

const hits = [];
for (const rel of trackedFiles()) {
    const file = path.join(repoRoot, rel);
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    } catch {
        continue; // unreadable
    }
    // A NUL byte means binary; utf8 of it is noise, not references.
    if (text.includes("\u0000")) continue;

    const lines = text.split("\n");
    for (const [old, replacement] of Object.entries(RENAMED)) {
        for (const pattern of patternsFor(old)) {
            // Every occurrence, not just the first: `check-packages.sh` held
            // four stale names, and reporting one at a time meant each fix
            // revealed the next. Nothing here is expensive enough to ration.
            lines.forEach((l, i) => {
                if (pattern.test(l)) hits.push({ file: rel, line: i + 1, pattern: old, replacement });
            });
        }
    }
}

// ── Manifest sanity ──────────────────────────────────────────────────────
// Folding one package into another collapses two dependency entries onto the
// same key. JSON.parse keeps the last silently, so a scaffolded project can
// ship a manifest listing the same dependency twice.
const dupKeyHits = [];
const DEP_BLOCKS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];
for (const rel of trackedFiles()) {
    if (path.basename(rel) !== "package.json") continue;
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, rel), "utf8"));
    const text = fs.readFileSync(path.join(repoRoot, rel), "utf8");

    // Scoped per block: the same package appearing in both peerDependencies and
    // peerDependenciesMeta is correct, not a duplicate.
    for (const block of DEP_BLOCKS) {
        if (!manifest[block]) continue;
        const declared = Object.keys(manifest[block]).length;
        const blockStart = text.indexOf(`"${block}"`);
        if (blockStart === -1) continue;
        // Count key lines between this block's braces.
        const open = text.indexOf("{", blockStart);
        let depth = 0, end = open;
        for (let i = open; i < text.length; i++) {
            if (text[i] === "{") depth++;
            else if (text[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
        }
        const body = text.slice(open, end);
        const keys = [...body.matchAll(/^\s*"([^"]+)":/gm)].map((m) => m[1]);
        // JSON.parse collapses duplicates, so more lines than keys means one repeats.
        if (keys.length > declared) {
            const seen = new Set();
            for (const k of keys) {
                if (seen.has(k)) dupKeyHits.push({ file: rel, key: k, block });
                seen.add(k);
            }
        }
    }
}

if (dupKeyHits.length > 0) {
    console.error(`\n${dupKeyHits.length} duplicate dependency key(s):\n`);
    for (const h of dupKeyHits) {
        console.error(`  ${h.file}: "${h.key}" listed twice in ${h.block}`);
    }
    console.error("");
}

if (hits.length > 0 || dupKeyHits.length > 0) {
    if (hits.length > 0) {
        console.error(`${hits.length} reference(s) to renamed packages:\n`);
        for (const h of hits) {
            console.error(`  ${h.file}:${h.line}`);
            console.error(`    ${h.pattern}  ->  ${h.replacement}\n`);
        }
    }
    process.exit(1);
}

console.log("No references to renamed packages.");
