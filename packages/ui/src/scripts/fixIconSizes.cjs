#!/usr/bin/env node
/**
 * Migration script: fix lucide-react icon size props.
 *
 * Replaces string-based size props on lucide icon components
 * with numeric values from the iconSize map:
 *   "smallest" -> 16
 *   "small" -> 20
 *   "medium" -> 24
 *   "large" -> 28
 *
 * Only targets lines that match lucide icon component patterns
 * (PascalCase names ending with "Icon"), NOT IconButton/CircularProgress/etc.
 */

const fs = require("fs");
const path = require("path");

const SIZE_MAP = {
    smallest: 16,
    small: 20,
    medium: 24,
    large: 28,
};

const files = process.argv.slice(2);

if (files.length === 0) {
    console.error("Usage: node fixIconSizes.js <file1> <file2> ...");
    process.exit(1);
}

let totalReplacements = 0;

for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    let modified = content;
    let fileReplacements = 0;

    // Match patterns like: <SomeIcon size={"small"}/> or <SomeIcon size="small"/>
    // But NOT <IconButton, <CircularProgress, <CollectionSize, <AIIcon, <FileIcon, <IconForView
    // We target lines where the JSX tag name is a PascalCase name ending with "Icon"
    // preceded by < (opening tag)
    for (const [sizeStr, sizeNum] of Object.entries(SIZE_MAP)) {
        // Pattern: size={"sizeStr"} on Icon components (not IconButton etc.)
        // We replace size={"small"} -> size={20} only when it appears on a lucide icon line
        const patterns = [
            `size={"${sizeStr}"}`,
            `size="${sizeStr}"`,
        ];
        
        for (const pattern of patterns) {
            const replacement = `size={${sizeNum}}`;
            
            // Process line by line to check context
            const lines = modified.split("\n");
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (!line.includes(pattern)) continue;
                
                // Skip if this is IconButton, CircularProgress, or other non-lucide components
                if (/\<(IconButton|CircularProgress|Icon |AIIcon|FileIcon|IconForView|CollectionSize)/.test(line)) continue;
                
                // Check if this line contains a lucide-style icon component (PascalCase ending with Icon)
                if (/\<[A-Z][a-zA-Z0-9]+Icon/.test(line)) {
                    const newLine = line.replace(pattern, replacement);
                    if (newLine !== line) {
                        lines[i] = newLine;
                        fileReplacements++;
                    }
                }
            }
            modified = lines.join("\n");
        }
    }

    if (fileReplacements > 0) {
        // Check if file uses iconSize import, add if not
        if (modified.includes("iconSize") === false && /\bsize=\{(16|20|24|28)\}/.test(modified)) {
            // Add iconSize import — but actually we're using raw numbers, not iconSize references
            // So no import needed. The migration from previous session already set up the constants.
        }
        
        fs.writeFileSync(filePath, modified, "utf8");
        console.log(`✅ ${path.relative(process.cwd(), filePath)}: ${fileReplacements} replacement(s)`);
        totalReplacements += fileReplacements;
    } else {
        console.log(`⏭️  ${path.relative(process.cwd(), filePath)}: no changes`);
    }
}

console.log(`\nTotal: ${totalReplacements} replacements across ${files.length} files`);
