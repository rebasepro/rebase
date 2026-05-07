import fs from 'fs';
import path from 'path';

const walkSync = (dir, filelist = []) => {
    fs.readdirSync(dir).forEach(file => {
        const filepath = path.join(dir, file);
        if (fs.statSync(filepath).isDirectory()) {
            filelist = walkSync(filepath, filelist);
        } else if (filepath.endsWith('.ts') || filepath.endsWith('.tsx')) {
            filelist.push(filepath);
        }
    });
    return filelist;
};

const files = walkSync('src');

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    let changed = false;

    if (content.includes('@dataki/common')) {
        const parts = file.split('/');
        const depth = parts.length - 2; // src/xxx.ts -> 0, src/hooks/xxx.ts -> 1
        const relativePath = depth === 0 ? './types' : '../'.repeat(depth) + 'types';
        content = content.replace(/from "@dataki\/common"/g, `from "${relativePath}"`);
        changed = true;
    }
    
    if (content.includes('@firecms/core')) {
        content = content.replace(/from "@firecms\/core"/g, `from "@rebasepro/utils"`);
        changed = true;
    }

    if (changed) {
        fs.writeFileSync(file, content, 'utf8');
        console.log(`Updated ${file}`);
    }
});
