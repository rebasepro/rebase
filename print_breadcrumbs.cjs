const fs = require('fs');
const path = require('path');

const componentsDir = path.join(__dirname, 'website', 'src', 'components', 'pages');
if (!fs.existsSync(componentsDir)) {
  console.log("No components dir");
  process.exit(1);
}

const files = fs.readdirSync(componentsDir).filter(f => f.endsWith('.astro'));

const results = {};

for (const file of files) {
  const content = fs.readFileSync(path.join(componentsDir, file), 'utf8');
  const match = content.match(/const breadcrumbs = (\[.*?\]);/s);
  if (match) {
    results[file] = match[1];
  }
}

console.log(JSON.stringify(results, null, 2));
