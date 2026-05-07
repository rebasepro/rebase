const fs = require('fs');
const glob = require('glob');

const files = glob.sync('src/**/*.{ts,tsx}');

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    // Fix imports from @rebasepro/core to @rebasepro/utils
    if (content.includes('@rebasepro/core')) {
        let coreImportsMatch = content.match(/import\s+{([^}]+)}\s+from\s+['"]@rebasepro\/core['"]/g);
        if (coreImportsMatch) {
            coreImportsMatch.forEach(match => {
                let inner = match.match(/{([^}]+)}/)[1];
                let toUtils = [];
                let toUi = [];
                let keepCore = [];
                inner.split(',').map(s => s.trim()).filter(Boolean).forEach(i => {
                    if (['mergeDeep', 'randomString', 'slugify'].includes(i)) toUtils.push(i);
                    else if (i === 'ErrorBoundary') toUi.push(i);
                    else keepCore.push(i);
                });

                let replacement = '';
                if (keepCore.length > 0) replacement += `import { ${keepCore.join(', ')} } from "@rebasepro/core";\n`;
                if (toUtils.length > 0) replacement += `import { ${toUtils.join(', ')} } from "@rebasepro/utils";\n`;
                if (toUi.length > 0) replacement += `import { ${toUi.join(', ')} } from "@rebasepro/ui";\n`;
                
                content = content.replace(match, replacement.trim());
                changed = true;
            });
        }
    }

    // Fix icons
    const iconMappings = {
        'CodeIcon': 'Code',
        'CopyAllIcon': 'Copy',
        'ForumIcon': 'MessageSquare',
        'HistoryIcon': 'History',
        'Icon': 'Icon', // might be problematic, but we'll see
        'ShareIcon': 'Share',
        'TitleIcon': 'Type',
        'LockIcon': 'Lock',
        'Plus': 'Plus',
        'LineAxisIcon': 'TrendingUp',
        'AutoFixNormalIcon': 'Wand2',
        'DirectionsRunIcon': 'Play',
        'ClearIcon': 'X',
        'LoopIcon': 'RefreshCw',
        'CalendarMonthIcon': 'Calendar'
    };

    let lucideIconsToAdd = new Set();

    if (content.includes('@rebasepro/ui')) {
        let uiImportsMatch = content.match(/import\s+{([^}]+)}\s+from\s+['"]@rebasepro\/ui['"]/g);
        if (uiImportsMatch) {
            uiImportsMatch.forEach(match => {
                let inner = match.match(/{([^}]+)}/)[1];
                let keepUi = [];
                
                inner.split(',').map(s => s.trim()).filter(Boolean).forEach(i => {
                    let iconName = i.split(' as ')[0].trim();
                    if (iconMappings[iconName]) {
                        lucideIconsToAdd.add(iconMappings[iconName]);
                    } else if (['RefreshCw', 'X', 'Trash2', 'ArrowRight', 'GripVertical', 'Filter', 'Download', 'Settings', 'Clock', 'MoreVertical', 'Play', 'Calendar'].includes(iconName)) {
                        lucideIconsToAdd.add(iconName);
                    } else {
                        keepUi.push(i);
                    }
                });

                if (keepUi.length !== inner.split(',').filter(s => s.trim()).length) {
                    content = content.replace(match, `import { ${keepUi.join(', ')} } from "@rebasepro/ui"`);
                    changed = true;
                }
            });
        }
    }

    // Also find undefined icons in the code and add them to lucide
    let allLucideIcons = ['RefreshCw', 'X', 'Trash2', 'ArrowRight', 'GripVertical', 'Filter', 'Download', 'Settings', 'Clock', 'MoreVertical', 'Code', 'Copy', 'MessageSquare', 'History', 'Share', 'Type', 'Lock', 'Plus', 'TrendingUp', 'Wand2', 'Play', 'Calendar'];
    
    // Check if the component uses any icon mappings and replace them
    Object.keys(iconMappings).forEach(oldIcon => {
        if (oldIcon !== 'Icon' && content.includes(oldIcon)) {
            const regex = new RegExp(`\\b${oldIcon}\\b`, 'g');
            content = content.replace(regex, iconMappings[oldIcon]);
            lucideIconsToAdd.add(iconMappings[oldIcon]);
            changed = true;
        }
    });

    allLucideIcons.forEach(icon => {
        if (content.includes(`<${icon}`) || content.includes(`${icon} `) || content.includes(`${icon},`)) {
            lucideIconsToAdd.add(icon);
        }
    });

    if (lucideIconsToAdd.size > 0) {
        if (content.includes('from "lucide-react"')) {
            content = content.replace(/import\s+{([^}]+)}\s+from\s+['"]lucide-react['"]/, (match, inner) => {
                let current = new Set(inner.split(',').map(s => s.trim()).filter(Boolean));
                lucideIconsToAdd.forEach(i => current.add(i));
                return `import { ${Array.from(current).join(', ')} } from "lucide-react"`;
            });
        } else {
            content = `import { ${Array.from(lucideIconsToAdd).join(', ')} } from "lucide-react";\n` + content;
        }
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(file, content);
        console.log("Fixed " + file);
    }
});
