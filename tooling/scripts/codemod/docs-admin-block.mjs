/**
 * Nest presentation fields inside `admin` in documentation code fences.
 *
 * The same migration as `collections-admin-block.mjs`, but the input is markdown
 * rather than TypeScript, so ts-morph is not available — and the fences are
 * fragments, not parseable files.
 *
 * The rule that makes a line-based pass safe here: a collection literal in the
 * docs is always written at a known indentation, and a presentation key at the
 * *top level* of one sits at exactly four spaces (or two, in the terser
 * examples). Nested occurrences — `ui: { hideFromCollection }`, an array's
 * `sortable`, a `properties` entry named `group` — are deeper, so keying on the
 * indent of the surrounding literal distinguishes them.
 *
 * Only fences that actually declare a collection are touched, identified by a
 * `slug:` at the same indent. That is what keeps this from rewriting a fence that
 * merely mentions `icon` in some other object.
 *
 * Run: node tooling/scripts/codemod/docs-admin-block.mjs [--dry] <dir>...
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

function loadAdminKeys() {
    const file = path.join(repoRoot, "packages/types/src/types/admin_block.ts");
    const src = fs.readFileSync(file, "utf8");
    const block = src.slice(src.indexOf("export const ADMIN_COLLECTION_KEYS"));
    return [...block.matchAll(/^\s{4}"(\w+)",?$/gm)].map((m) => m[1]);
}

const ADMIN_KEYS = new Set(loadAdminKeys());

const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const targets = args.filter((a) => !a.startsWith("--"));

/**
 * Rewrite one fence body.
 *
 * Returns the new body, or null when nothing applied.
 */
function rewriteFence(body) {
    const lines = body.split("\n");

    // Find the indent of a collection literal: the indent of a `slug:` line.
    const slugLine = lines.find((l) => /^\s*slug:\s*["']/.test(l));
    if (!slugLine) return null;
    const indent = slugLine.match(/^(\s*)/)[1];
    if (indent.length === 0) return null;

    const keyAt = (line) => {
        const m = line.match(/^(\s*)([A-Za-z_$][\w$]*)\s*:/);
        if (!m || m[1] !== indent) return null;
        return m[2];
    };

    /** Does a line open a block that continues past it? */
    const opens = (line) => {
        const trimmed = line.replace(/\/\/.*$/, "").trimEnd();
        const open = (trimmed.match(/[[{(]/g) ?? []).length;
        const close = (trimmed.match(/[\]})]/g) ?? []).length;
        return open > close;
    };

    const moved = [];
    const kept = [];
    let i = 0;
    while (i < lines.length) {
        const key = keyAt(lines[i]);
        if (key === null || !ADMIN_KEYS.has(key)) { kept.push(lines[i]); i++; continue; }

        // Take the whole declaration, balancing brackets across lines.
        const chunk = [lines[i]];
        if (opens(lines[i])) {
            let depth = 0;
            const count = (line) => {
                const t = line.replace(/\/\/.*$/, "");
                depth += (t.match(/[[{(]/g) ?? []).length - (t.match(/[\]})]/g) ?? []).length;
            };
            count(lines[i]);
            i++;
            while (i < lines.length && depth > 0) {
                chunk.push(lines[i]);
                count(lines[i]);
                i++;
            }
        } else {
            i++;
        }
        moved.push(chunk);
    }

    if (moved.length === 0) return null;

    // Re-indent the moved declarations one level deeper.
    const step = "    ";
    const rendered = moved.map((chunk) =>
        chunk.map((l) => (l.trim() === "" ? l : step + l)).join("\n")
    );
    // Drop a trailing comma on the last entry: legal TypeScript, but the docs are
    // read as much as compiled.
    const last = rendered.length - 1;
    rendered[last] = rendered[last].replace(/,(\s*(?:\/\/[^\n]*)?)$/, "$1");
    const block = rendered.join("\n");

    // Find where the literal closes, so the block goes inside it.
    const closingIndent = indent.slice(0, -4);
    let closeAt = kept.length;
    for (let k = kept.length - 1; k >= 0; k--) {
        if (kept[k].startsWith(`${closingIndent}}`)) { closeAt = k; break; }
    }

    const head = kept.slice(0, closeAt);
    // Blank lines left where the moved declarations were would otherwise collect
    // just before the closing brace.
    while (head.length > 0 && head[head.length - 1].trim() === "") head.pop();

    // The property `admin` now follows must end with a comma. That line is often
    // the *closing* brace of a multi-line property (`properties: { … }`), which
    // still needs one — an earlier version skipped those and emitted `}` directly
    // followed by `admin: {`. Order matters here: computing this before knowing
    // where the literal closes put the comma on `};` instead.
    for (let k = head.length - 1; k >= 0; k--) {
        const trimmed = head[k].trim();
        if (trimmed === "" || trimmed.startsWith("//")) continue;
        const line = head[k].trimEnd();
        if (!/[,{[(]$/.test(line)) head[k] = line + ",";
        break;
    }

    const out = [...head, `${indent}admin: {`, block, `${indent}}`, ...kept.slice(closeAt)];
    return out.join("\n");
}

const FENCE = /^(```(?:ts|typescript|tsx)\b[^\n]*\n)([\s\S]*?)^(```)$/gm;

let changedFiles = 0;
let changedFences = 0;

for (const target of targets) {
    const abs = path.resolve(repoRoot, target);
    if (!fs.existsSync(abs)) continue;
    const files = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (/\.mdx?$/.test(entry.name)) files.push(full);
        }
    };
    if (fs.statSync(abs).isDirectory()) walk(abs); else files.push(abs);

    for (const file of files) {
        const before = fs.readFileSync(file, "utf8");
        let localFences = 0;
        const after = before.replace(FENCE, (whole, open, body, close) => {
            const rewritten = rewriteFence(body);
            if (rewritten === null) return whole;
            localFences++;
            return `${open}${rewritten}\n${close}`;
        });
        if (localFences === 0 || after === before) continue;
        changedFiles++;
        changedFences += localFences;
        if (dryRun) console.log(`would rewrite ${localFences} fence(s) in ${path.relative(repoRoot, file)}`);
        else fs.writeFileSync(file, after);
    }
}

console.log(
    `${dryRun ? "[dry] " : ""}${changedFences} fence(s) in ${changedFiles} file(s) nested under \`admin\``
);
