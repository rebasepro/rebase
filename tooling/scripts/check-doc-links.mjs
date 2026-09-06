#!/usr/bin/env node
/**
 * Every relative link in the repository's own markdown resolves to a file.
 *
 * `docs/README.md` names this exact hazard — "70 of them moved the last time
 * this was reorganised" — and nothing checked it, so it happened again: 62
 * links under `docs/plans/` and `docs/audits/` were `../packages/…` written
 * from a file one level deeper than the author had in mind, which resolves to
 * `docs/packages/…` and points at nothing. Every one of them is a reader
 * following a citation to an empty result, and none of them is visible in a
 * diff, in a test, or in the rendered page — a broken relative link in GitHub's
 * markdown viewer is a link that simply 404s when clicked.
 *
 * Scope is the markdown a *contributor* reads, not the docs site: `docs/**`,
 * `.agent/**`, `.github/**`, `README.md`, `CONTRIBUTING.md`. The website's own
 * pages are cross-checked by `verify:docs`, which understands its routing and
 * its locales; this one is about files on disk.
 *
 * Anchors are resolved as far as the file: `foo.md#bar` has to name a real
 * `foo.md`, and the heading half is left to `verify:docs`, which is where
 * heading knowledge lives.
 *
 *     pnpm check:doc-links
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Files and trees whose markdown is checked. */
const SCANNED = ["docs", ".agent", ".github", "README.md", "CONTRIBUTING.md"];

const SKIP_DIRECTORIES = new Set(["node_modules", "dist", ".git"]);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

function markdownFiles(target) {
    const abs = path.join(ROOT, target);
    if (!fs.existsSync(abs)) return [];
    if (fs.statSync(abs).isFile()) return abs.endsWith(".md") ? [abs] : [];
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (SKIP_DIRECTORIES.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (entry.name.endsWith(".md")) out.push(full);
        }
    };
    walk(abs);
    return out;
}

/**
 * A link target this check can resolve on disk.
 *
 * Skipped: absolute URLs, protocol-relative, `mailto:`, in-page anchors, and
 * site-absolute paths (`/docs/…`), which are routes on rebase.pro rather than
 * files here — `verify:docs` owns those.
 */
function isRelativePath(target) {
    if (!target) return false;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return false;
    if (target.startsWith("//") || target.startsWith("#") || target.startsWith("/")) return false;
    return true;
}

const findings = [];
let checked = 0;

for (const file of SCANNED.flatMap(markdownFiles)) {
    const rel = path.relative(ROOT, file);
    const source = fs.readFileSync(file, "utf8");
    // Fenced code is documentation of a command, not a link the reader clicks.
    const withoutFences = source.replace(/^```[\s\S]*?^```/gm, (block) => block.replace(/[^\n]/g, " "));
    const lines = withoutFences.split("\n");

    lines.forEach((line, index) => {
        // `[text](target)` and `[text](target "title")`, plus reference
        // definitions `[label]: target`.
        const targets = [
            ...[...line.matchAll(/\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)].map((m) => m[1]),
            ...[...line.matchAll(/^\[[^\]]+\]:\s*<?([^\s>]+)>?/g)].map((m) => m[1])
        ];
        for (const target of targets) {
            if (!isRelativePath(target)) continue;
            checked += 1;
            const [pathPart] = target.split("#");
            if (!pathPart) continue; // pure anchor after a split, e.g. `#top`
            const resolved = path.resolve(path.dirname(file), decodeURIComponent(pathPart));
            if (fs.existsSync(resolved)) continue;
            findings.push({ rel, line: index + 1, target, resolved: path.relative(ROOT, resolved) });
        }
    });
}

if (findings.length === 0) {
    console.log(green(`✓ ${checked} relative link(s) in the repository's own markdown all resolve.`));
    process.exit(0);
}

console.error(red(`\n✗ ${findings.length} relative link(s) resolve to nothing.\n`));
const byFile = new Map();
for (const finding of findings) {
    if (!byFile.has(finding.rel)) byFile.set(finding.rel, []);
    byFile.get(finding.rel).push(finding);
}
for (const [rel, list] of byFile) {
    console.error(`  ${bold(rel)} ${dim(`— ${list.length}`)}`);
    for (const { line, target, resolved } of list) {
        console.error(`    ${dim(`:${line}`)} ${target}  ${dim(`→ ${resolved}`)}`);
    }
}
console.error(dim(
    "\n  A relative link is resolved against the directory of the file it is written\n" +
    "  in, not against the repository root. `../packages/…` from `docs/plans/x.md`\n" +
    "  is `docs/packages/…`; from a file one level shallower it would have been\n" +
    "  right. The reader gets a 404 with nothing to search for.\n"
));
process.exit(1);
