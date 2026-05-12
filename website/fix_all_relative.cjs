const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'pages', '[...lang]');

const files = fs.readdirSync(dir);
files.forEach(file => {
    if (file.endsWith('.astro')) {
        const filePath = path.join(dir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        
        // This will find `from "../` or `from '../` or `import "../` or `import '../`
        // and replace it with `from "../../` etc.
        // Wait, what if it's already `from "../../` ? We don't want to replace `../` inside `../../`.
        // So we can use a regex that matches quotes followed by exactly `../` and NOT `../../`
        // Wait, Javascript doesn't have negative lookbehind until recently, but we can just match `['"]\.\.\/(?!\.\.\/)`
        
        const finalContent = content.replace(/(from|import) (['"])\.\.\/(?!\.\.\/)/g, '$1 $2../../');

        if (content !== finalContent) {
            fs.writeFileSync(filePath, finalContent);
            console.log(`Fixed relative imports in ${file}`);
        }
    }
});
