#!/usr/bin/env node
/**
 * Give the translation-freshness gate its input.
 *
 * `translate_docs.mjs` stamps every page it writes with `sourceHash` — the hash
 * of the English page it was made from — and
 * `docs-verify/check-translation-freshness.mjs` reads it back to find a
 * translation whose source has since changed. The stamp writer shipped; the
 * backfill never ran. So all 390 translated pages were unstamped, the gate's
 * only finding branch was unreachable, and the stage printed
 * "0 fresh, 390 unstamped, 50 missing ✓" for months while `backend/Dockerfile`
 * recipes and `localhost:3001` survived in five languages.
 *
 * This writes the *current* English hash into each translated page. That is a
 * deliberate reset, not a claim: it says "from here, an English edit without a
 * matching translation is a finding". It cannot say which English version any
 * of these files was actually made from — that is the information the missing
 * backfill destroyed — so the honest options were to reset or to leave the gate
 * blind, and a blind gate had already cost five locales two releases of drift.
 *
 * Run it once after replaying an English change into the locales by hand, or
 * with `--only <path>` for one page. `translate_docs.mjs` keeps the stamps
 * current on its own from then on.
 *
 *     node scripts/backfill_source_hashes.mjs [--dry-run] [--only docs/sdk/index.md]
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTENT = path.resolve(HERE, "..", "src", "content", "docs");
const LOCALES = ["es", "de", "fr", "it", "pt"];

/**
 * Mirrors EXCLUDED_DIRS / EXCLUDED_FILES in `translate_docs.mjs` and
 * `NOT_TRANSLATED` in the gate: `docs/ui` is regenerated wholesale from the
 * components' own types, and `docs/CHANGELOG.md` is mirrored from the repo root
 * on every build. A stamp on either is stale from the next regeneration.
 */
const NOT_TRANSLATED = [/^docs\/ui\//, /^docs\/CHANGELOG\.md$/];

/** Same digest as `translate_docs.mjs`'s `sourceHash`; keep the three in step. */
function sourceHash(content) {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

/** Writes (or replaces) the `sourceHash` line in a file's frontmatter. */
function stamp(text, hash) {
    const stripped = text.replace(/^(---\n[\s\S]*?)^sourceHash:.*\n([\s\S]*?^---\n)/m, "$1$2");
    if (!/^---\n/.test(stripped)) return null;      // no frontmatter to stamp
    return stripped.replace(/^---\n/, `---\nsourceHash: ${hash}\n`);
}

function walk(dir, base = dir) {
    /** @type {string[]} */
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full, base));
        else if (/\.(mdx|md)$/.test(entry.name)) out.push(path.relative(base, full).split(path.sep).join("/"));
    }
    return out;
}

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const onlyAt = argv.indexOf("--only");
const only = onlyAt === -1 ? null : argv[onlyAt + 1];

const sources = walk(path.join(CONTENT, "docs"))
    .map(rel => `docs/${rel}`)
    .filter(rel => !NOT_TRANSLATED.some(re => re.test(rel)))
    .filter(rel => !only || rel === only)
    .sort();

let stamped = 0;
let already = 0;
let missing = 0;
const unstampable = [];

for (const rel of sources) {
    const hash = sourceHash(fs.readFileSync(path.join(CONTENT, rel), "utf8"));
    for (const locale of LOCALES) {
        const file = path.join(CONTENT, locale, rel);
        if (!fs.existsSync(file)) { missing++; continue; }
        const text = fs.readFileSync(file, "utf8");
        const next = stamp(text, hash);
        if (next === null) { unstampable.push(`${locale}/${rel}`); continue; }
        if (next === text) { already++; continue; }
        if (!dryRun) fs.writeFileSync(file, next, "utf8");
        stamped++;
    }
}

console.log(
    `${dryRun ? "[dry run] " : ""}${stamped} stamped, ${already} already current, ` +
    `${missing} not translated${unstampable.length ? `, ${unstampable.length} with no frontmatter` : ""}.`
);
for (const f of unstampable) console.log(`  no frontmatter: ${f}`);
