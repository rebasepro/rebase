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
 * Only files git tracks. Build output, lint dumps and scaffolded test projects
 * quote old paths from past runs; they are not references to fix, and walking
 * the filesystem drowns the real hits in them.
 */
function trackedFiles() {
    return execSync("git ls-files -z", { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024 })
        .toString()
        .split("\0")
        .filter(Boolean)
        .filter((f) => !SKIP_FILES.has(f) && !SKIP_FILES.has(path.basename(f)));
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

    for (const [old, replacement] of Object.entries(RENAMED)) {
        // Only the forms that actually denote the package: the scoped
        // specifier, or a path into packages/. A bare "core" is too common a
        // word to match on.
        for (const pattern of [`@rebasepro/${old}`, `packages/${old}/`]) {
            if (!text.includes(pattern)) continue;
            const line = text.split("\n").findIndex((l) => l.includes(pattern)) + 1;
            hits.push({ file: rel, line, pattern, replacement });
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
