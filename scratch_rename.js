const fs = require('fs');
const path = require('path');
const execSync = require('child_process').execSync;

const query = `find packages -type f -name "*.ts" -o -name "*.tsx" | grep -v dist/`;
const files = execSync(query).toString().split('\n').filter(Boolean);

let filesModified = 0;

for (const file of files) {
    if (file.includes('types/src/types/slots.tsx') || file.includes('types/src/types/entity_views.tsx') || file.includes('types/src/types/collections.ts') || file.includes('types/src/types/plugins.tsx') || file.includes('types/src/controllers/data_driver.ts') || file.includes('types/src/controllers/collection_registry.ts')) {
        continue; // Already processed
    }

    let content = fs.readFileSync(file, 'utf8');
    let original = content;

    // 1. Rename the destructured props
    content = content.replace(/parentCollectionIds,/g, 'parentCollectionSlugs, parentEntityIds,');
    
    // 2. Rename empty array passings (parentCollectionIds={[]})
    content = content.replace(/parentCollectionIds=\{\[\]\}/g, 'parentCollectionSlugs={[]} parentEntityIds={[]}');
    
    // 3. Rename parentCollectionIds to parentCollectionSlugs for usages
    // But be careful not to duplicate if we already did it above!
    // Let's do a smarter replace.
    // Instead of regex, let's just do a blanket replace of parentCollectionIds with parentCollectionSlugs
    // EXCEPT for cases where we need to inject parentEntityIds.
    
    // We can do this in two passes:
    // First, find lines that have `parentCollectionIds: string[]` or `parentCollectionIds?: string[]` and add `parentEntityIds`
    content = content.replace(/parentCollectionIds\s*:\s*string\[\]/g, 'parentCollectionSlugs: string[], parentEntityIds: string[]');
    content = content.replace(/parentCollectionIds\s*\?\s*:\s*string\[\]/g, 'parentCollectionSlugs?: string[], parentEntityIds?: string[]');
    
    // Then replace occurrences of `parentCollectionIds={parentCollectionIds}` with `parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}`
    content = content.replace(/parentCollectionIds=\{parentCollectionIds\??\}/g, 'parentCollectionSlugs={parentCollectionSlugs} parentEntityIds={parentEntityIds}');
    content = content.replace(/parentCollectionIds=\{parentCollectionIds \?\? EMPTY_ARRAY\}/g, 'parentCollectionSlugs={parentCollectionSlugs ?? EMPTY_ARRAY} parentEntityIds={parentEntityIds ?? EMPTY_ARRAY}');
    
    content = content.replace(/parentCollectionIds: parentCollectionIds \?\? EMPTY_ARRAY/g, 'parentCollectionSlugs: parentCollectionSlugs ?? EMPTY_ARRAY, parentEntityIds: parentEntityIds ?? EMPTY_ARRAY');
    content = content.replace(/parentCollectionIds: parentCollectionIds/g, 'parentCollectionSlugs: parentCollectionSlugs, parentEntityIds: parentEntityIds');
    
    // Replace const parentCollectionIds = ...getParentCollectionIds
    content = content.replace(/const parentCollectionIds = (.*)getParentCollectionIds(.*);/g, 'const parentCollectionSlugs = $1getParentCollectionSlugs$2;\n    const parentEntityIds = $1getParentEntityIds$2;');
    
    // Finally, blanket replace the remaining `parentCollectionIds` with `parentCollectionSlugs`
    content = content.replace(/parentCollectionIds/g, 'parentCollectionSlugs');
    content = content.replace(/getParentCollectionIds/g, 'getParentCollectionSlugs');
    
    if (content !== original) {
        fs.writeFileSync(file, content, 'utf8');
        filesModified++;
        console.log('Modified', file);
    }
}

console.log(`Modified ${filesModified} files.`);
