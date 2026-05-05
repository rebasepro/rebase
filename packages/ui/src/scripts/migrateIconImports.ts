#!/usr/bin/env node
/**
 * Migrates `XxxIcon` imports from `@rebasepro/ui` to `lucide-react`.
 * Non-icon imports remain in `@rebasepro/ui`.
 */
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

// Get all files that import XxxIcon from @rebasepro/ui
const files = execSync(
    `grep -rln "from \\"@rebasepro/ui\\"" --include="*.tsx" --include="*.ts" packages/ app/ 2>/dev/null | grep -v node_modules | grep -v dist`,
    { cwd: "/Users/francesco/rebase", encoding: "utf-8" }
).trim().split("\n").filter(Boolean);

// Icons that are NOT from lucide-react (our own components)
const OUR_ICONS = new Set(["Icon", "IconButton", "HandleIcon", "GitHubIcon", "LabelWithIcon"]);
// Non-icon things that happen to end with Icon
const NOT_LUCIDE = new Set(["BrowserTitleAndIcon", "PopupIcon", "AIIcon", "DefaultIcon", "ViewModeIcon", "CircularProgressCenter"]);

const ICON_PATTERN = /^[A-Z][a-zA-Z0-9]*Icon$/;

let updated = 0;

for (const relFile of files) {
    const filePath = path.join("/Users/francesco/rebase", relFile);
    const content = fs.readFileSync(filePath, "utf-8");
    
    // Find all import lines from @rebasepro/ui
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*["']@rebasepro\/ui["'];?/g;
    let match;
    let newContent = content;
    
    while ((match = importRegex.exec(content)) !== null) {
        const fullImport = match[0];
        const importList = match[1];
        
        // Parse individual imports (handle type imports too)
        const imports = importList.split(",").map(s => s.trim()).filter(Boolean);
        
        const lucideImports = [];
        const uiImports = [];
        
        for (const imp of imports) {
            // Handle "type Foo" imports
            const isType = imp.startsWith("type ");
            const name = isType ? imp.replace("type ", "").trim() : imp.trim();
            
            if (ICON_PATTERN.test(name) && !OUR_ICONS.has(name) && !NOT_LUCIDE.has(name)) {
                lucideImports.push(imp);
            } else {
                uiImports.push(imp);
            }
        }
        
        if (lucideImports.length === 0) continue;
        
        // Build replacement
        let replacement = "";
        if (uiImports.length > 0) {
            replacement += `import { ${uiImports.join(", ")} } from "@rebasepro/ui";\n`;
        }
        replacement += `import { ${lucideImports.join(", ")} } from "lucide-react";`;
        
        newContent = newContent.replace(fullImport, replacement);
    }
    
    if (newContent !== content) {
        // Check if lucide-react import already exists and merge
        const existingLucideMatch = newContent.match(/import\s*\{([^}]+)\}\s*from\s*["']lucide-react["'];?/g);
        if (existingLucideMatch && existingLucideMatch.length > 1) {
            // Merge multiple lucide-react imports into one
            const allLucideImports = [];
            for (const m of existingLucideMatch) {
                const inner = m.match(/\{([^}]+)\}/)?.[1];
                if (inner) {
                    allLucideImports.push(...inner.split(",").map(s => s.trim()).filter(Boolean));
                }
            }
            // Remove all lucide imports
            for (const m of existingLucideMatch) {
                newContent = newContent.replace(m + "\n", "");
                newContent = newContent.replace(m, "");
            }
            // Add single merged import after the first @rebasepro/ui import or at the top imports area
            const uiImportMatch = newContent.match(/import\s*\{[^}]+\}\s*from\s*["']@rebasepro\/ui["'];?\n/);
            if (uiImportMatch) {
                newContent = newContent.replace(
                    uiImportMatch[0],
                    uiImportMatch[0] + `import { ${[...new Set(allLucideImports)].join(", ")} } from "lucide-react";\n`
                );
            } else {
                // Put at top after other imports
                const lastImport = newContent.lastIndexOf("import ");
                const lineEnd = newContent.indexOf("\n", lastImport);
                newContent = newContent.slice(0, lineEnd + 1) + 
                    `import { ${[...new Set(allLucideImports)].join(", ")} } from "lucide-react";\n` +
                    newContent.slice(lineEnd + 1);
            }
        }
        
        fs.writeFileSync(filePath, newContent);
        console.log(`✓ ${relFile}`);
        updated++;
    }
}

console.log(`\nDone: ${updated} files updated`);
