import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SRC_DIR = path.join(__dirname, 'src');

const iconMap = {
    'AddIcon': 'Plus as AddIcon',
    'StorageIcon': 'Database as StorageIcon',
    'DeleteIcon': 'Trash2 as DeleteIcon',
    'CloseIcon': 'X as CloseIcon',
    'LinkIcon': 'Link as LinkIcon',
    'LinkOffIcon': 'Link2Off as LinkOffIcon',
    'CheckCircleIcon': 'CheckCircle as CheckCircleIcon',
    'MoreVertIcon': 'MoreVertical as MoreVertIcon',
    'CheckIcon': 'Check as CheckIcon',
    'CheckBoxIcon': 'CheckSquare as CheckBoxIcon',
    'CheckBoxOutlineBlankIcon': 'Square as CheckBoxOutlineBlankIcon',
    'RefreshIcon': 'RefreshCw as RefreshIcon',
    'ChevronRightIcon': 'ChevronRight as ChevronRightIcon',
    'FilterAltIcon': 'Filter as FilterAltIcon',
};

function processFile(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let originalContent = content;

    // 1. Process icon imports from @rebasepro/ui
    const iconNames = Object.keys(iconMap);
    for (const icon of iconNames) {
        const regex = new RegExp(`import\\s+\\{([^}]*)\\b${icon}\\b([^}]*)\\}\\s+from\\s+['"]@rebasepro/ui['"]`, 'g');
        content = content.replace(regex, (match, p1, p2) => {
            // Remove the icon from the original import
            let newRebaseImport = '';
            const remainingImports = [p1, p2].join('').split(',').map(s => s.trim()).filter(Boolean);
            if (remainingImports.length > 0) {
                newRebaseImport = `import { ${remainingImports.join(', ')} } from "@rebasepro/ui";\n`;
            }
            return `${newRebaseImport}import { ${iconMap[icon]} } from "lucide-react"`;
        });
        
        // Also catch if it's imported in a multi-line import
        const regexMultiline = new RegExp(`import\\s+\\{([^}]*)\\b${icon}\\b([^}]*)\\}\\s+from\\s+['"]@rebasepro/ui['"]`, 'g');
        content = content.replace(regexMultiline, (match, p1, p2) => {
            let newRebaseImport = '';
            const remainingImports = [p1, p2].join('').split(',').map(s => s.trim()).filter(Boolean);
            if (remainingImports.length > 0) {
                newRebaseImport = `import { ${remainingImports.join(', ')} } from "@rebasepro/ui";\n`;
            }
            return `${newRebaseImport}import { ${iconMap[icon]} } from "lucide-react"`;
        });
    }

    // Combine multiple lucide-react imports
    const lucideImports = [];
    const lucideRegex = /import\s+\{([^}]+)\}\s+from\s+["']lucide-react["']/g;
    let match;
    while ((match = lucideRegex.exec(content)) !== null) {
        lucideImports.push(...match[1].split(',').map(s => s.trim()).filter(Boolean));
    }
    if (lucideImports.length > 0) {
        content = content.replace(lucideRegex, '');
        const uniqueLucideImports = [...new Set(lucideImports)];
        content = `import { ${uniqueLucideImports.join(', ')} } from "lucide-react";\n` + content;
    }

    // Consolidate @rebasepro/ui imports
    const uiImports = [];
    const uiRegex = /import\s+\{([^}]+)\}\s+from\s+["']@rebasepro\/ui["']/g;
    while ((match = uiRegex.exec(content)) !== null) {
        uiImports.push(...match[1].split(',').map(s => s.trim()).filter(Boolean));
    }
    if (uiImports.length > 0) {
        content = content.replace(uiRegex, '');
        const uniqueUiImports = [...new Set(uiImports)];
        content = `import { ${uniqueUiImports.join(', ')} } from "@rebasepro/ui";\n` + content;
    }

    // Replace @rebasepro/utils missing members => @rebasepro/ui
    const utilsImportsToUi = ['CellRendererParams', 'VirtualTable', 'VirtualTableColumn', 'VirtualTableProps', 'VirtualTableRow'];
    const utilsRegex = /import\s+\{([^}]+)\}\s+from\s+["']@rebasepro\/utils["']/g;
    while ((match = utilsRegex.exec(content)) !== null) {
        const utilsImported = match[1].split(',').map(s => s.trim()).filter(Boolean);
        const movingToUi = utilsImported.filter(i => utilsImportsToUi.includes(i));
        const stayingInUtils = utilsImported.filter(i => !utilsImportsToUi.includes(i));
        
        let replaceWith = '';
        if (movingToUi.length > 0) {
            replaceWith += `import { ${movingToUi.join(', ')} } from "@rebasepro/ui";\n`;
        }
        if (stayingInUtils.length > 0) {
            replaceWith += `import { ${stayingInUtils.join(', ')} } from "@rebasepro/utils";\n`;
        }
        content = content.replace(match[0], replaceWith);
    }
    
    // Replace @rebasepro/core missing members => @rebasepro/types
    const coreImportsToTypes = ['User', 'Role'];
    const coreRegex = /import\s+\{([^}]+)\}\s+from\s+["']@rebasepro\/core["']/g;
    while ((match = coreRegex.exec(content)) !== null) {
        const coreImported = match[1].split(',').map(s => s.trim()).filter(Boolean);
        const movingToTypes = coreImported.filter(i => coreImportsToTypes.includes(i));
        const stayingInCore = coreImported.filter(i => !coreImportsToTypes.includes(i));
        
        let replaceWith = '';
        if (movingToTypes.length > 0) {
            replaceWith += `import { ${movingToTypes.join(', ')} } from "@rebasepro/types";\n`;
        }
        if (stayingInCore.length > 0) {
            replaceWith += `import { ${stayingInCore.join(', ')} } from "@rebasepro/core";\n`;
        }
        content = content.replace(match[0], replaceWith);
    }

    // Replace @rebasepro/core missing members => @rebasepro/ui
    const coreImportsToUi = ['CircularProgressCenter', 'ErrorBoundary'];
    const coreRegex2 = /import\s+\{([^}]+)\}\s+from\s+["']@rebasepro\/core["']/g;
    while ((match = coreRegex2.exec(content)) !== null) {
        const coreImported = match[1].split(',').map(s => s.trim()).filter(Boolean);
        const movingToUi = coreImported.filter(i => coreImportsToUi.includes(i));
        const stayingInCore = coreImported.filter(i => !coreImportsToUi.includes(i));
        
        let replaceWith = '';
        if (movingToUi.length > 0) {
            replaceWith += `import { ${movingToUi.join(', ')} } from "@rebasepro/ui";\n`;
        }
        if (stayingInCore.length > 0) {
            replaceWith += `import { ${stayingInCore.join(', ')} } from "@rebasepro/core";\n`;
        }
        content = content.replace(match[0], replaceWith);
    }
    
    // Replace @rebasepro/core missing members => @rebasepro/utils
    const coreImportsToUtils = ['randomString'];
    const coreRegex3 = /import\s+\{([^}]+)\}\s+from\s+["']@rebasepro\/core["']/g;
    while ((match = coreRegex3.exec(content)) !== null) {
        const coreImported = match[1].split(',').map(s => s.trim()).filter(Boolean);
        const movingToUtils = coreImported.filter(i => coreImportsToUtils.includes(i));
        const stayingInCore = coreImported.filter(i => !coreImportsToUtils.includes(i));
        
        let replaceWith = '';
        if (movingToUtils.length > 0) {
            replaceWith += `import { ${movingToUtils.join(', ')} } from "@rebasepro/utils";\n`;
        }
        if (stayingInCore.length > 0) {
            replaceWith += `import { ${stayingInCore.join(', ')} } from "@rebasepro/core";\n`;
        }
        content = content.replace(match[0], replaceWith);
    }

    // Replace AuthController with useAuthController
    content = content.replace(/\bAuthController\b/g, 'useAuthController');
    content = content.replace(/\buseuseAuthController\b/g, 'useAuthController');
    
    // Replace SnackbarController with useSnackbarController
    content = content.replace(/\bSnackbarController\b/g, 'useSnackbarController');
    content = content.replace(/\buseuseSnackbarController\b/g, 'useSnackbarController');

    // Replace ../utils/local_storage with empty string or comment out if we don't have it
    content = content.replace(/import\s+.*from\s+["']\.\.\/utils\/local_storage["'];?/g, '// import removed local_storage');

    // Clean up duplicate empty lines created by import replacements
    content = content.replace(/\n\s*\n\s*\n/g, '\n\n');

    if (content !== originalContent) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`Updated ${filePath}`);
    }
}

function traverse(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            traverse(fullPath);
        } else if (fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) {
            processFile(fullPath);
        }
    }
}

traverse(SRC_DIR);
