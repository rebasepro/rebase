#!/usr/bin/env node
/**
 * Every `@rebasepro/<pkg>/<subpath>` this repo writes down is a path that
 * package actually exports.
 *
 * Two places recommended one that did not exist. `packages/studio/src/index.ts`
 * and its README both said "use deep imports:
 * `@rebasepro/studio/components/SQLEditor/SQLEditor`", and that package's
 * `exports` map has exactly `.` and `./package.json` — so following the advice
 * fails at resolution with ERR_PACKAGE_PATH_NOT_EXPORTED, with nothing the
 * reader can configure to fix it. `packages/cms/src/index.ts` said "import it
 * by path" about a component no subpath entry reached.
 *
 * A subpath is not visible from the importing file the way a named export is:
 * TypeScript resolves it against the *published* `exports` map, so a
 * recommendation in a comment or a README is unchecked by anything until
 * somebody tries it. This is that check.
 *
 *     pnpm check:subpath-imports
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES = path.join(ROOT, "packages");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/** `name -> Set of exported subpaths`, `*` kept as a wildcard segment. */
function exportMaps() {
    const maps = new Map();
    for (const dir of fs.readdirSync(PACKAGES)) {
        const manifest = path.join(PACKAGES, dir, "package.json");
        if (!fs.existsSync(manifest)) continue;
        const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
        if (!pkg.name?.startsWith("@rebasepro/")) continue;
        // No `exports` field at all means every path resolves — nothing to check.
        maps.set(pkg.name, pkg.exports ? new Set(Object.keys(pkg.exports)) : null);
    }
    return maps;
}

function matches(subpath, exported) {
    if (exported.has(subpath)) return true;
    for (const pattern of exported) {
        if (!pattern.includes("*")) continue;
        const [head, tail] = pattern.split("*");
        if (subpath.startsWith(head) && subpath.endsWith(tail)) return true;
    }
    return false;
}

const SKIP_DIRS = /node_modules|[/\\]dist[/\\]|[/\\]\.git[/\\]/;
const SCANNED = /\.(md|mdx|tsx?|mjs|json)$/;

function files(dir) {
    const out = [];
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (SKIP_DIRS.test(full + path.sep)) continue;
            if (entry.isDirectory()) walk(full);
            else if (SCANNED.test(entry.name)) out.push(full);
        }
    };
    walk(dir);
    return out;
}

const maps = exportMaps();
const findings = [];

/**
 * A module *specifier*, not a mention.
 *
 * Prose names these paths for other reasons — a changelog recording that a
 * type moved, a docblock saying where an implementation lives, a test asserting
 * on a `node_modules` path. None of those are resolved by anything, and
 * flagging them would bury the one line that is.
 */
const REFERENCE =
    /(?:from|import|require)\s*\(?\s*["'](@rebasepro\/([a-z0-9-]+)((?:\/[A-Za-z0-9_.-]+)+))["']/g;

for (const root of [PACKAGES, path.join(ROOT, "website", "src", "content", "docs"), path.join(ROOT, "docs")]) {
    if (!fs.existsSync(root)) continue;
    for (const file of files(root)) {
        const text = fs.readFileSync(file, "utf8");
        for (const m of text.matchAll(REFERENCE)) {
            const name = `@rebasepro/${m[2]}`;
            const subpath = `.${m[3]}`;
            const exported = maps.get(name);
            // Unknown package, or one that declares no `exports` map.
            if (exported === undefined || exported === null) continue;
            if (matches(subpath, exported)) continue;
            const line = text.slice(0, m.index).split("\n").length;
            findings.push({ file: path.relative(ROOT, file), line, specifier: m[1], name });
        }
    }
}

if (findings.length === 0) {
    console.log(green(`✓ subpath imports: every @rebasepro/*/… reference resolves against its package's exports.`));
    process.exit(0);
}

console.error(red(`\n✗ ${findings.length} reference(s) to a subpath the package does not export:\n`));
for (const f of findings) {
    console.error(`  ${bold(`${f.file}:${f.line}`)}`);
    console.error(`    ${f.specifier}`);
    console.error(dim(`    ${f.name} exports: ${[...maps.get(f.name)].join(", ")}`));
}
console.error(dim(
    "\n  Importing one of these fails with ERR_PACKAGE_PATH_NOT_EXPORTED, and\n" +
    "  there is nothing the reader can configure to make it work. Either add the\n" +
    "  subpath to the package's `exports` (with a `types` entry), or stop\n" +
    "  recommending it.\n"
));
process.exit(1);
