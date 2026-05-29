#!/usr/bin/env node
/**
 * Migration script: rewrite lucide-react and @radix-ui imports to @rebasepro/ui
 *
 * Usage:  node scripts/migrate-to-ui-imports.mjs [--dry-run]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const DRY_RUN = process.argv.includes("--dry-run");

// Directories to scan (relative to ROOT)
const SCAN_DIRS = [
    "packages/admin/src",
    "packages/core/src",
    "packages/studio/src",
    "packages/client-firebase/src",
    "packages/plugin-data-enhancement/src",
    "packages/plugin-insights/src",
];

// ─── helpers ──────────────────────────────────────────────────────────────────

function walk(dir) {
    let results = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results = results.concat(walk(full));
        } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
            results.push(full);
        }
    }
    return results;
}

// Matches:  import { X, Y } from "lucide-react";
//           import { icons as lucideIcons } from "lucide-react";
//           import type { LucideIcon } from "lucide-react";
const LUCIDE_IMPORT_RE = /^(import\s+(?:type\s+)?)\{([^}]+)\}\s+from\s+["']lucide-react["'];?\s*$/;

// Matches:  import * as Portal from "@radix-ui/react-portal";
const RADIX_STAR_RE = /^import\s+\*\s+as\s+(\w+)\s+from\s+["'](@radix-ui\/react-\w+)["'];?\s*$/;

// Matches:  import { Slot } from "@radix-ui/react-slot";
const RADIX_NAMED_RE = /^import\s+\{([^}]+)\}\s+from\s+["'](@radix-ui\/react-\w+)["'];?\s*$/;

// Matches existing @rebasepro/ui import:  import { A, B } from "@rebasepro/ui";
const UI_IMPORT_RE = /^(import\s+(?:type\s+)?)\{([^}]+)\}\s+from\s+["']@rebasepro\/ui["'];?\s*$/;

// Radix packages we migrate
const RADIX_MAP = {
    "@radix-ui/react-portal": "Portal",
    "@radix-ui/react-popover": "PopoverPrimitive",
    "@radix-ui/react-slot": "Slot",
};

let totalFilesChanged = 0;
let totalImportsRewritten = 0;

function processFile(filePath) {
    const original = fs.readFileSync(filePath, "utf8");
    const lines = original.split("\n");

    // Collect imports to merge
    let lucideSymbols = [];           // named imports from lucide-react
    let lucideTypeSymbols = [];       // type imports from lucide-react
    let radixSymbols = [];            // radix symbols to add
    let lucideLineIndices = [];
    let radixLineIndices = [];
    let existingUiLineIndex = -1;
    let existingUiTypeLineIndex = -1;
    let existingUiSymbols = [];
    let existingUiTypeSymbols = [];
    let isTypeImport = false;

    // Special case: icons as lucideIcons
    let hasLucideIcons = false;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();

        // Check for existing @rebasepro/ui import
        const uiMatch = line.match(UI_IMPORT_RE);
        if (uiMatch) {
            const isType = line.startsWith("import type");
            const symbols = uiMatch[2].split(",").map(s => s.trim()).filter(Boolean);
            if (isType) {
                existingUiTypeLineIndex = i;
                existingUiTypeSymbols = symbols;
            } else {
                existingUiLineIndex = i;
                existingUiSymbols = symbols;
            }
        }

        // Check lucide-react imports
        const lucideMatch = line.match(LUCIDE_IMPORT_RE);
        if (lucideMatch) {
            isTypeImport = line.startsWith("import type");
            const symbols = lucideMatch[2].split(",").map(s => s.trim()).filter(Boolean);

            for (const sym of symbols) {
                if (sym === "icons as lucideIcons") {
                    hasLucideIcons = true;
                    if (isTypeImport) {
                        lucideTypeSymbols.push("lucideIcons");
                    } else {
                        lucideSymbols.push("lucideIcons");
                    }
                } else if (isTypeImport) {
                    lucideTypeSymbols.push(sym);
                } else {
                    lucideSymbols.push(sym);
                }
            }
            lucideLineIndices.push(i);
        }

        // Check @radix-ui star imports
        const radixStarMatch = line.match(RADIX_STAR_RE);
        if (radixStarMatch) {
            const localName = radixStarMatch[1];
            const pkg = radixStarMatch[2];
            if (RADIX_MAP[pkg]) {
                radixSymbols.push(RADIX_MAP[pkg]);
                radixLineIndices.push(i);
            }
        }

        // Check @radix-ui named imports
        const radixNamedMatch = line.match(RADIX_NAMED_RE);
        if (radixNamedMatch) {
            const pkg = radixNamedMatch[2];
            if (RADIX_MAP[pkg]) {
                const symbols = radixNamedMatch[1].split(",").map(s => s.trim()).filter(Boolean);
                radixSymbols.push(...symbols);
                radixLineIndices.push(i);
            }
        }
    }

    if (lucideLineIndices.length === 0 && radixLineIndices.length === 0) {
        return; // nothing to migrate
    }

    // Build the new merged import
    const allNewValueSymbols = [...new Set([...existingUiSymbols, ...lucideSymbols, ...radixSymbols])];
    const allNewTypeSymbols = [...new Set([...existingUiTypeSymbols, ...lucideTypeSymbols])];

    // Sort symbols alphabetically for consistency
    allNewValueSymbols.sort((a, b) => a.localeCompare(b));
    allNewTypeSymbols.sort((a, b) => a.localeCompare(b));

    // Lines to remove (old lucide + radix imports, and old UI import we'll replace)
    const linesToRemove = new Set([
        ...lucideLineIndices,
        ...radixLineIndices,
    ]);
    if (existingUiLineIndex >= 0) linesToRemove.add(existingUiLineIndex);
    if (existingUiTypeLineIndex >= 0) linesToRemove.add(existingUiTypeLineIndex);

    // Build new lines
    const newLines = [];
    let insertedNewImport = false;

    // Find the right place to insert the new import(s)
    // We insert at the position of the first removed line
    const sortedRemoved = [...linesToRemove].sort((a, b) => a - b);
    const insertAt = sortedRemoved[0];

    for (let i = 0; i < lines.length; i++) {
        if (linesToRemove.has(i)) {
            if (i === insertAt && !insertedNewImport) {
                insertedNewImport = true;
                if (allNewValueSymbols.length > 0) {
                    const symbolStr = allNewValueSymbols.join(", ");
                    if (symbolStr.length > 80) {
                        newLines.push(`import {`);
                        for (let j = 0; j < allNewValueSymbols.length; j++) {
                            const comma = j < allNewValueSymbols.length - 1 ? "," : "";
                            newLines.push(`    ${allNewValueSymbols[j]}${comma}`);
                        }
                        newLines.push(`} from "@rebasepro/ui";`);
                    } else {
                        newLines.push(`import { ${symbolStr} } from "@rebasepro/ui";`);
                    }
                }
                if (allNewTypeSymbols.length > 0) {
                    const symbolStr = allNewTypeSymbols.join(", ");
                    newLines.push(`import type { ${symbolStr} } from "@rebasepro/ui";`);
                }
            }
            // Skip the old line
            continue;
        }
        newLines.push(lines[i]);
    }

    // Edge case: if we didn't find any existing UI import and nothing was removed
    // to insert at, we need to add the import at the top
    if (!insertedNewImport && (allNewValueSymbols.length > 0 || allNewTypeSymbols.length > 0)) {
        // Find first non-comment, non-empty line
        let insertPos = 0;
        for (let i = 0; i < newLines.length; i++) {
            const l = newLines[i].trim();
            if (l.startsWith("import ") || l.startsWith("export ") || (l && !l.startsWith("//") && !l.startsWith("/*") && !l.startsWith("*") && !l.startsWith("\"use "))) {
                insertPos = i;
                break;
            }
        }
        if (allNewValueSymbols.length > 0) {
            newLines.splice(insertPos, 0, `import { ${allNewValueSymbols.join(", ")} } from "@rebasepro/ui";`);
            insertPos++;
        }
        if (allNewTypeSymbols.length > 0) {
            newLines.splice(insertPos, 0, `import type { ${allNewTypeSymbols.join(", ")} } from "@rebasepro/ui";`);
        }
    }

    const result = newLines.join("\n");
    if (result !== original) {
        totalFilesChanged++;
        totalImportsRewritten += lucideLineIndices.length + radixLineIndices.length;
        const rel = path.relative(ROOT, filePath);
        if (DRY_RUN) {
            console.log(`[DRY RUN] Would update: ${rel}`);
        } else {
            fs.writeFileSync(filePath, result, "utf8");
            console.log(`Updated: ${rel}`);
        }
    }
}

// ─── main ─────────────────────────────────────────────────────────────────────

console.log(`\n🔄 Migrating lucide-react and @radix-ui imports to @rebasepro/ui...\n`);
if (DRY_RUN) console.log("  (dry-run mode — no files will be modified)\n");

for (const dir of SCAN_DIRS) {
    const absDir = path.join(ROOT, dir);
    if (!fs.existsSync(absDir)) {
        console.log(`⏭  Skipping ${dir} (not found)`);
        continue;
    }
    const files = walk(absDir);
    console.log(`📁 Scanning ${dir} (${files.length} files)...`);
    for (const file of files) {
        processFile(file);
    }
}

console.log(`\n✅ Done! ${totalFilesChanged} files changed, ${totalImportsRewritten} imports rewritten.`);
if (DRY_RUN) console.log("   (no files were actually modified — remove --dry-run to apply)");
console.log("");
