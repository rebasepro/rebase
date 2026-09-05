#!/usr/bin/env node
/**
 * Every `import { … } from "@rebasepro/…"` in a doc names something that exists.
 *
 * ## What this catches
 *
 * Documentation is the one consumer of the API that never gets compiled. A
 * skill, a guide or a changelog can go on instructing people to import a symbol
 * for months after it was deleted, and nothing notices — the code is a fenced
 * block, so `tsc` never sees it and the api-surface baseline never mentions it.
 *
 * It had two live instances on 2026-08-27:
 *
 *  - `rebase-backend-postgres`'s SKILL.md told people to
 *    `import { initializeRebaseBackend, configureJwt } from "@rebasepro/server"`
 *    as the FIX for a confusing dual-package error — and `configureJwt` was
 *    internal, so the remedy for a hard-to-diagnose failure was itself a failure.
 *    (Fixed by exporting it: the advice was right.)
 *  - `rebase-cron-jobs`'s SKILL.md declared `client` on `CronJobContext` in its
 *    type block while its own prose, eight lines up, said the name had been
 *    removed. A reader copying the type got the deleted property.
 *
 * ## How it decides
 *
 * `contracts/server.api.txt` is the recorded public surface of exactly the
 * packages the runtime provides, so it is the authority for those and for
 * nothing else. Imports from any other package — `@rebasepro/ui`,
 * `/admin`, `/server-postgres` — are skipped rather than guessed at: a check
 * that reports names it has no baseline for is a check people learn to ignore.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const RED = "\x1b[0;31m", GREEN = "\x1b[0;32m", DIM = "\x1b[2m", NC = "\x1b[0m";

/** The packages `contracts/server.api.txt` actually records. */
const COVERED = new Set([
    "@rebasepro/server",
    "@rebasepro/types",
    "@rebasepro/common",
    "@rebasepro/utils",
    "@rebasepro/client"
]);

const DOC_ROOTS = ["tooling/rebase-agent-skills/skills", "docs", "website/src/content/docs"];

/**
 * Files that describe the API's HISTORY rather than its present.
 *
 * A changelog saying "removed `buildCollection`" must name it, and a doc that
 * has to name a deleted symbol to explain its deletion is doing its job.
 */
const HISTORICAL = [/CHANGELOG\.md$/i, /\/audits\//];

const baseline = path.join(ROOT, "contracts", "server.api.txt");
if (!fs.existsSync(baseline)) {
    console.error(`${RED}✗ ${baseline} is missing — run \`pnpm write:api-surface\`.${NC}`);
    process.exit(1);
}
// `namespace`/`module` are how api-surface.mjs records a re-exported module
// namespace such as `export { z } from "zod"` — an import target like any other.
// It spelled the second `SourceFile` until the raw syntax kind was named; the
// two scripts have to agree, and a rename in one is a silent miss in the other.
const known = new Set(
    [...fs.readFileSync(baseline, "utf8")
        .matchAll(/^(?:function|const|class|interface|type|enum|namespace|module)\s+([A-Za-z_$][\w$]*)/gm)]
        .map(m => m[1])
);
if (known.size < 100) {
    // A floor, in the same sense as the other gates here: an empty or truncated
    // baseline would make this pass against anything.
    console.error(`${RED}✗ only ${known.size} exports parsed from the baseline — refusing to check against that.${NC}`);
    process.exit(1);
}

const files = [];
const walk = (dir) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(rel);
        else if (/\.mdx?$/.test(e.name)) files.push(rel);
    }
};
DOC_ROOTS.forEach(walk);

const problems = [];
for (const rel of files) {
    if (HISTORICAL.some(re => re.test(rel))) continue;
    const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
    for (const m of text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'](@rebasepro\/[a-z-]+)["']/g)) {
        if (!COVERED.has(m[2])) continue;
        for (let name of m[1].split(",")) {
            name = name.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
            // A wrapped or commented import list; not a name.
            if (!name || name.startsWith("//") || !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
            if (!known.has(name)) problems.push({ rel, name, pkg: m[2] });
        }
    }
}

console.log(`${DIM}Checked ${files.length} doc(s) against ${known.size} recorded exports.${NC}`);
if (problems.length === 0) {
    console.log(`${GREEN}✓ every documented import exists.${NC}`);
    process.exit(0);
}

console.error(`\n${RED}✗ ${problems.length} documented import(s) name something that does not exist:${NC}\n`);
for (const p of problems) console.error(`    ${p.name}  from ${p.pkg}\n      ${p.rel}`);
console.error(`
  A fenced code block is never compiled, so a doc can instruct people to import
  a deleted symbol indefinitely. Either the symbol should be exported — the
  guidance may well be right — or the doc is teaching an API that is gone.

  If the file exists to DESCRIBE a removal, add it to HISTORICAL in this script.
`);
process.exit(1);
