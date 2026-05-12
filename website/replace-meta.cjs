const fs = require('fs');
const path = require('path');

const pagesDir = path.join(__dirname, 'src', 'pages', '[...lang]');
const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.astro') && f !== 'index.astro' && f !== 'about.astro');

for (const file of files) {
  const filePath = path.join(pagesDir, file);
  let content = fs.readFileSync(filePath, 'utf8');
  
  const slug = file.replace('.astro', '');
  
  // Replace title
  content = content.replace(/const\s+title\s*=\s*(["'`])(.*?)\1;?/, `const title = t("${slug}.meta.title");`);
  // Replace description
  content = content.replace(/const\s+description\s*=\s*(["'`])(.*?)\1;?/, `const description = t("${slug}.meta.description");`);
  
  // Also we need to make sure breadcrumbs are translated.
  // The breadcrumbs usually look like: { name: "Home", url: ... }, { name: "Contact", url: ... }
  // So I'll do a simple regex:
  // name: "Text" -> name: t("breadcrumbs.text") -- Wait, maybe I'll skip breadcrumbs for this automated script and just do meta title/desc, then see.
  // Actually the breadcrumbs use hardcoded strings. We can extract them later if needed. Let's do title and desc first.
  
  fs.writeFileSync(filePath, content);
  console.log(`Updated ${file}`);
}
