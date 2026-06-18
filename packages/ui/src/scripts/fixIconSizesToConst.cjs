#!/usr/bin/env node
/**
 * Replace raw numeric icon sizes with iconSize.xxx constants
 * and add the import if needed.
 *
 *   size={16} -> size={iconSize.smallest}
 *   size={20} -> size={iconSize.small}
 *   size={24} -> size={iconSize.medium}
 *   size={28} -> size={iconSize.large}
 */

const fs = require("fs");
const path = require("path");

const SIZE_MAP = {
    16: "iconSize.smallest",
    20: "iconSize.small",
    24: "iconSize.medium",
    28: "iconSize.large"
};

// Regex to match lucide icon components with raw numeric sizes
// e.g. <FilterIcon size={20}/> or <ArrowLeftIcon size={16}/>
const ICON_SIZE_RE = /<([A-Z][a-zA-Z0-9]*Icon)\b[^>]*\bsize=\{(16|20|24|28)\}/;

const files = process.argv.slice(2);
if (!files.length) {
    console.error("Usage: node fixIconSizesToConst.cjs <files...>");
    process.exit(1);
}

let totalReplacements = 0;

for (const filePath of files) {
    let content = fs.readFileSync(filePath, "utf8");
    let fileReplacements = 0;

    // Check if file has any lucide icon with raw numeric size
    if (!ICON_SIZE_RE.test(content)) {
        continue;
    }

    // Replace size={16|20|24|28} on Icon component lines
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Skip non-icon components
        if (/\<(IconButton|CircularProgress|Icon |AIIcon|FileIconComp|IconForView|CollectionSize)/.test(line)) continue;

        // Only target lucide icon components
        if (/<[A-Z][a-zA-Z0-9]*Icon\b/.test(line)) {
            let newLine = line;
            for (const [num, constant] of Object.entries(SIZE_MAP)) {
                newLine = newLine.replace(
                    new RegExp(`size=\\{${num}\\}`, "g"),
                    `size={${constant}}`
                );
            }
            if (newLine !== line) {
                lines[i] = newLine;
                fileReplacements += (line.match(/size=\{(16|20|24|28)\}/g) || []).length;
            }
        }
    }

    if (fileReplacements === 0) continue;

    content = lines.join("\n");

    // Add iconSize import if not already present
    if (!content.includes("iconSize")) {
        // This shouldn't happen since we just added it, but safety check
    }

    if (content.includes("iconSize") && !content.match(/import\s.*iconSize/)) {
        // Try to add to existing @rebasepro/ui import
        const uiImportRe = /import\s*\{([^}]+)\}\s*from\s*["']@rebasepro\/ui["']/;
        const match = content.match(uiImportRe);
        if (match) {
            const existingImports = match[1];
            if (!existingImports.includes("iconSize")) {
                content = content.replace(
                    uiImportRe,
                    `import {${existingImports}, iconSize } from "@rebasepro/ui"`
                );
            }
        } else {
            // Add new import after the last import line
            const importLines = content.split("\n");
            let lastImportIdx = -1;
            for (let i = 0; i < importLines.length; i++) {
                if (/^import\s/.test(importLines[i])) lastImportIdx = i;
            }
            if (lastImportIdx >= 0) {
                importLines.splice(lastImportIdx + 1, 0, 'import { iconSize } from "@rebasepro/ui";');
                content = importLines.join("\n");
            }
        }
    }

    fs.writeFileSync(filePath, content, "utf8");
    console.log(`✅ ${path.relative(process.cwd(), filePath)}: ${fileReplacements} replacement(s)`);
    totalReplacements += fileReplacements;
}

console.log(`\nTotal: ${totalReplacements} replacements`);
