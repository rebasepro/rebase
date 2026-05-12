const fs = require('fs');
const path = require('path');

const pagesDir = path.join(__dirname, 'src', 'pages', '[...lang]');
const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.astro'));

const results = {};

for (const file of files) {
  const content = fs.readFileSync(path.join(pagesDir, file), 'utf8');
  
  // Extract title
  const titleMatch = content.match(/const\s+title\s*=\s*(["'`])(.*?)\1/s);
  // Extract description
  const descMatch = content.match(/const\s+description\s*=\s*(["'`])(.*?)\1/s);
  
  if (titleMatch || descMatch) {
    const slug = file.replace('.astro', '');
    results[slug] = {
      title: titleMatch ? titleMatch[2].trim() : null,
      description: descMatch ? descMatch[2].trim() : null
    };
  }
}

console.log(JSON.stringify(results, null, 2));
