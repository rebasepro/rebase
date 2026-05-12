const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'pages', '[...lang]');

const files = fs.readdirSync(dir);
files.forEach(file => {
    if (file.endsWith('.astro')) {
        const filePath = path.join(dir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        
        const finalContent = content.replace(/import "\.\.\/styles\/editor\.css";/g, 'import "../../styles/editor.css";');

        if (content !== finalContent) {
            fs.writeFileSync(filePath, finalContent);
            console.log(`Fixed styles import in ${file}`);
        }
    }
});
