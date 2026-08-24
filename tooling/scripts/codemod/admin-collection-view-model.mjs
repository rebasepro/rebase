/**
 * Retype the admin panel against `AdminCollection` — its flat view model.
 *
 * The panel reads presentation fields (`propertiesOrder`, `icon`, `kanban`, …) in
 * a few hundred places. Those fields now live under a collection's `admin` block,
 * but the panel does not read raw collections: it reads ones the registry has
 * already resolved, merging the declared config with the user's local overrides.
 * So the honest type there is the flat view model, not the authoring shape — the
 * same split `Entity` already has against flat rows.
 *
 * This swaps the *type reference* only. `resolveAdminCollection` at the registry
 * funnel is what makes the runtime match.
 *
 * Deliberately not applied to code that *writes* a collection — the collection
 * editor's persistence must emit the nested shape. Those files are listed in
 * KEEP_AUTHORING and left alone.
 *
 * Run: node tooling/scripts/codemod/admin-collection-view-model.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const dryRun = process.argv.includes("--dry");

const PACKAGES = ["packages/admin/src", "packages/app/src", "packages/studio/src", "packages/admin-types/src"];

/**
 * Files that mean the authoring shape, not the view model: anything that
 * serializes a collection back to disk or to the wire.
 */
const KEEP_AUTHORING = [
    // SerializableCollectionConfig is its own declared shape, not an alias of
    // CollectionConfig, so this file has nothing to retype.
    "collection_editor/serializable_types.ts",
    // Defines the mapping between the two shapes, so it must name both.
    "admin-types/src/admin_collection.ts"
];

/** `CollectionConfig` → `AdminCollection`, and the driver-specific variants. */
const RENAMES = new Map([
    ["CollectionConfig", "AdminCollection"],
    ["PostgresCollectionConfig", "AdminPostgresCollection"]
]);

let changedFiles = 0;
let changedRefs = 0;

function processFile(file) {
    const rel = path.relative(repoRoot, file);
    if (KEEP_AUTHORING.some((k) => rel.includes(k))) return;

    let src = fs.readFileSync(file, "utf8");
    const before = src;

    // Which names does this file actually reference?
    const present = [...RENAMES.keys()].filter((name) =>
        new RegExp(String.raw`\b${name}\b`).test(src)
    );
    if (present.length === 0) return;

    // Drop them from any @rebasepro/types import, then rename every reference.
    src = src.replace(
        /(^[ \t]*)(import|export)(\s+type)?\s*\{([^}]*)\}\s*from\s*"@rebasepro\/types";?/gm,
        (whole, indent, kind, tkw, list) => {
            const specs = list.split(",").map((s) => s.trim()).filter(Boolean);
            const kept = specs.filter((s) => {
                const name = s.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim();
                return !RENAMES.has(name);
            });
            if (kept.length === specs.length) return whole;
            if (kept.length === 0) return "";
            return `${indent}${kind}${tkw ?? ""} { ${kept.join(", ")} } from "@rebasepro/types";`;
        }
    );

    for (const [from, to] of RENAMES) {
        src = src.replace(new RegExp(String.raw`\b${from}\b`, "g"), to);
    }

    // Ensure the new names are imported from admin-types. Merge into an existing
    // admin-types import when there is one, so a file does not end up with two.
    const needed = present.map((n) => RENAMES.get(n));
    const existing = src.match(
        /^[ \t]*import(\s+type)?\s*\{([^}]*)\}\s*from\s*"@rebasepro\/admin-types";?/m
    );
    if (existing) {
        const already = existing[2].split(",").map((s) => s.trim());
        const missing = needed.filter(
            (n) => !already.some((a) => a.replace(/^type\s+/, "").split(/\s+as\s+/)[0].trim() === n)
        );
        if (missing.length > 0) {
            src = src.replace(
                existing[0],
                `import${existing[1] ?? ""} { ${[...already, ...missing].join(", ")} } from "@rebasepro/admin-types";`
            );
        }
    } else {
        // Place it after the last import so it cannot land above a "use client".
        const lines = src.split("\n");
        let lastImport = -1;
        for (let i = 0; i < lines.length; i++) {
            if (/^\s*(import|export)\b.*from\s*["']/.test(lines[i])) lastImport = i;
        }
        const statement = `import type { ${needed.join(", ")} } from "@rebasepro/admin-types";`;
        lines.splice(lastImport + 1, 0, statement);
        src = lines.join("\n");
    }

    // Collapse blank lines left by removed imports.
    src = src.replace(/\n{3,}/g, "\n\n");

    if (src === before) return;
    changedRefs += present.length;
    changedFiles++;
    if (dryRun) console.log(`would retype ${rel}`);
    else fs.writeFileSync(file, src);
}

for (const pkg of PACKAGES) {
    const abs = path.join(repoRoot, pkg);
    if (!fs.existsSync(abs)) continue;
    const walk = (dir) => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            if (entry.name === "node_modules" || entry.name === "dist") continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) walk(full);
            else if (/\.tsx?$/.test(entry.name)) processFile(full);
        }
    };
    walk(abs);
}

console.log(`${dryRun ? "[dry] " : ""}${changedFiles} file(s) retyped to the admin view model`);
