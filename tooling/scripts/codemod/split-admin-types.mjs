/**
 * Repoint imports of admin-only types from @rebasepro/types to @rebasepro/admin-types.
 *
 * Most import statements are mixed — `import { CollectionConfig, EntityAction }
 * from "@rebasepro/types"` names one type from each half — so this cannot be a
 * find-and-replace on the specifier. It parses the brace list, partitions the
 * symbols against the set that actually moved, and emits one statement per half.
 *
 * The moved set is derived from the files under packages/admin-types/src rather
 * than hardcoded, so it cannot drift from what the package really exports.
 *
 * Run: node tooling/scripts/codemod/split-admin-types.mjs [--dry] [paths...]
 */
import fs from "node:fs";
import path from "node:path";

const CORE = "@rebasepro/types";
const ADMIN = "@rebasepro/admin-types";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const targets = args.filter((a) => !a.startsWith("--"));

/** Every symbol exported from a file under packages/admin-types/src. */
function collectMovedSymbols() {
    const moved = new Set();
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (!/\.tsx?$/.test(entry.name) || entry.name === "index.ts") continue;
            const src = fs.readFileSync(full, "utf8");
            const re = /^export\s+(?:declare\s+)?(?:interface|type|function|const|class|enum)\s+(\w+)/gm;
            for (const m of src.matchAll(re)) moved.add(m[1]);
        }
    };
    walk(path.join(repoRoot, "packages", "admin-types", "src"));
    return moved;
}

const MOVED = collectMovedSymbols();

/** Parse one brace list into entries preserving `type` modifiers and aliases. */
function parseSpecifiers(list) {
    return list
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((raw) => {
            const withoutType = raw.replace(/^type\s+/, "");
            const name = withoutType.split(/\s+as\s+/)[0].trim();
            return { raw, name };
        });
}

function rewrite(source) {
    // `import [type] { … } from "@rebasepro/types"` and the `export … from` form.
    const re = new RegExp(
        String.raw`(^[ \t]*)(import|export)(\s+type)?\s*\{([^}]*)\}\s*from\s*["']` +
            CORE.replace("/", "\\/") +
            String.raw`["'];?`,
        "gm"
    );

    return source.replace(re, (whole, indent, kind, typeKeyword, list) => {
        const specs = parseSpecifiers(list);
        const adminSpecs = specs.filter((s) => MOVED.has(s.name));
        if (adminSpecs.length === 0) return whole;
        const coreSpecs = specs.filter((s) => !MOVED.has(s.name));

        const isMultiline = list.includes("\n");
        const render = (items, from) => {
            const kw = `${kind}${typeKeyword ?? ""}`;
            if (isMultiline) {
                const inner = items.map((s) => `    ${s.raw}`).join(",\n");
                return `${indent}${kw} {\n${inner}\n${indent}} from "${from}";`;
            }
            return `${indent}${kw} { ${items.map((s) => s.raw).join(", ")} } from "${from}";`;
        };

        const out = [];
        if (coreSpecs.length > 0) out.push(render(coreSpecs, CORE));
        out.push(render(adminSpecs, ADMIN));
        return out.join("\n");
    });
}

const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "build", "coverage"]);

function filesUnder(root) {
    const out = [];
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (SKIP_DIRS.has(entry.name)) continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) { walk(full); continue; }
            if (/\.tsx?$/.test(entry.name)) out.push(full);
        }
    };
    const stat = fs.statSync(root);
    if (stat.isDirectory()) walk(root); else out.push(root);
    return out;
}

const roots = targets.length > 0 ? targets : ["packages", "app", "examples", "e2e", "saas"];
let changedFiles = 0;
let changedStatements = 0;

for (const root of roots) {
    const abs = path.resolve(repoRoot, root);
    if (!fs.existsSync(abs)) continue;
    for (const file of filesUnder(abs)) {
        // admin-types' own sources import from core by design.
        if (file.includes(`${path.sep}packages${path.sep}admin-types${path.sep}`)) continue;
        const before = fs.readFileSync(file, "utf8");
        if (!before.includes(CORE)) continue;
        const after = rewrite(before);
        if (after === before) continue;
        changedStatements += (after.match(new RegExp(ADMIN, "g")) ?? []).length;
        changedFiles++;
        if (dryRun) console.log(`would rewrite ${path.relative(repoRoot, file)}`);
        else fs.writeFileSync(file, after);
    }
}

console.log(
    `${dryRun ? "[dry] " : ""}${changedFiles} file(s), ${changedStatements} statement(s) repointed to ${ADMIN}`
);
console.log(`${MOVED.size} moved symbols recognised`);
