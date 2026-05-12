const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'src', 'pages', '[...lang]');

const files = fs.readdirSync(dir);
files.forEach(file => {
    if (file.endsWith('.astro')) {
        const filePath = path.join(dir, file);
        let content = fs.readFileSync(filePath, 'utf8');
        let modified = false;
        
        // Fix mismatched quotes
        const newContent = content.replace(/from '\.\.\/\.\.\/([^'"]*)['"];/g, "from '../../$1';");
        
        // Also if we missed any from '../assets' let's fix them to from '../../assets'
        const finalContent = newContent.replace(/from '\.\.\/assets/g, "from '../../assets")
                                      .replace(/from "\.\.\/assets/g, "from '../../assets");

        if (content !== finalContent) {
            fs.writeFileSync(filePath, finalContent);
            console.log(`Fixed ${file}`);
        }
    }
});
