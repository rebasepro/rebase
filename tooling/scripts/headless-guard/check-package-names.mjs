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
    auth: "app (folded in — it was one hook)",
    // 0.17.0: the panel's CMS half took a product name of its own, so "admin"
    // could stop meaning both the whole panel and the content half of it.
    // Deliberately NOT in BARE below: `admin` is an ordinary word here — an auth
    // role, the `admin:` collection config key, a dozen identifiers named after
    // that key — so only the anchored `@rebasepro/admin` and `packages/admin/`
    // forms denote the package that is gone.
    admin: "cms",
    "admin-types": "cms-types"
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
 *
 * A `.` after the name is excluded for the same reason `-` is: some files kept
 * a name their package no longer has, and citing one is naming a file that
 * exists rather than a package that does not. `packages/codegen/test/
 * sdk-generator.test.ts` is the case that found this — an audit doc pointing at
 * three assertions by line number, which is exactly the kind of reference this
 * check should leave alone.
 *
 * Deliberately narrow: only the extension forms real files here use, not a bare
 * `.`, so `sdk-generator.` ending a sentence in prose is still a hit.
 */
const FILE_SUFFIX = "(?!\\.(?:test|spec)\\.[jt]sx?)";

function patternsFor(old) {
    if (BARE.has(old)) {
        const sentenceInitial = old[0].toUpperCase() + old.slice(1);
        return [new RegExp(`(?<![\\w-])(?:${old}|${sentenceInitial})${FILE_SUFFIX}(?![\\w-])`)];
    }
    // Only the forms that actually denote the package.
    return [new RegExp(`@rebasepro/${old}(?![\\w-])`), new RegExp(`packages/${old}/`)];
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".astro", "pnpm-store"]);
// Changelogs record what shipped under the old names; the upgrade guide has to
// print the old→new rename table to be of any use; the architecture doc
// explains why `auth` is gone; the publish summary is a generated record. The
// two scripts below have to name the old packages to do their job — this one to
// find them, the other to deprecate them on npm — so they are the exceptions
// that make the rule enforceable.
//
// `llms.txt` is generated: `website/scripts/generate_llms_txt.js` concatenates
// every sidebar page, `upgrading.mdx` and its rename table included. Exempting
// the source but not the artifact left twelve permanent violations that no edit
// could clear — rewriting the table's left column would make it read
// `@rebasepro/app | @rebasepro/app`, and the next `prebuild` would restore it
// anyway. Nothing is lost by skipping it: it holds no text of its own, and the
// pages it is built from are scanned individually.
//
// `llms-full.txt` is the other half of that same write — the generator emits a
// short index of links to `llms.txt` and the whole corpus to `llms-full.txt`.
// Only the index was exempted, so the moment a sidebar change pulled
// `upgrading.mdx` into the corpus the table arrived with it and the guard went
// red on a file no edit can fix. Both halves are the same artifact of the same
// pages; neither is a place a name can go stale on its own.
const SKIP_FILES = new Set([
    "CHANGELOG.md",
    "upgrading.mdx",
    "pnpm-lock.yaml",
    "docs/MODULAR-ARCHITECTURE.md",
    "website/public/llms.txt",
    "website/public/llms-full.txt",
    "tooling/scripts/headless-guard/check-package-names.mjs",
    "tooling/scripts/deprecate-old-packages.sh",
    // A dated post narrating a debugging session, quoting the commands that
    // were actually typed during it — at a time when `@rebasepro/admin` was
    // the package's real name. Rewriting the quoted grep to today's name would
    // make the anecdote false, and the anecdote is the article: the point is
    // that a repo-wide grep skipped a gitignored file and read as a clean
    // sweep. Same exemption as CHANGELOG.md, and for the same reason — a
    // record of what was true then is not a stale reference.
    //
    // Deliberately this one file, not the blog directory: a post written now
    // should use the names that exist now, and only a post that quotes history
    // earns a line here.
    "website/src/content/blog/2026-09-01-nothing-matched-and-nothing-said-so.md"
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
