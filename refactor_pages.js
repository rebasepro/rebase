const fs = require('fs');
const path = require('path');

const pagesDir = path.join(__dirname, 'website/src/pages/[...lang]');
const componentsDir = path.join(__dirname, 'website/src/components/pages');

if (!fs.existsSync(componentsDir)) {
  fs.mkdirSync(componentsDir, { recursive: true });
}

const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.astro'));

for (const file of files) {
  const filePath = path.join(pagesDir, file);
  const content = fs.readFileSync(filePath, 'utf-8');

  // Regex to match frontmatter and body
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    console.warn(`Could not parse ${file}`);
    continue;
  }

  const frontmatter = match[1];
  const body = match[2];

  // Regex to match Layout tag and its content
  const layoutMatch = body.match(/<Layout([^>]*)>([\s\S]*)<\/Layout>/);
  if (!layoutMatch) {
    console.warn(`Could not find Layout in ${file}`);
    continue;
  }

  const layoutProps = layoutMatch[1];
  const layoutInner = layoutMatch[2];

  const componentName = file.split('.')[0].split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join('') + 'Content';
  
  // Parse frontmatter lines
  const fmLines = frontmatter.split('\n');
  const pageFMLines = [];
  const compFMLines = [];

  compFMLines.push(`const { lang, t } = Astro.props;`);

  let inGetStaticPaths = false;

  for (const line of fmLines) {
    if (line.includes('import Layout')) {
      pageFMLines.push(line);
    } else if (line.includes('import { languages') || line.includes('import { defaultLang') || line.includes('import { useTranslations') || line.includes('import { getLangFromUrl')) {
      pageFMLines.push(line);
      compFMLines.push(line); // just in case it's needed
    } else if (line.startsWith('export function getStaticPaths')) {
      inGetStaticPaths = true;
      pageFMLines.push(line);
    } else if (inGetStaticPaths) {
      pageFMLines.push(line);
      if (line === '}') {
        inGetStaticPaths = false;
      }
    } else if (line.includes('Astro.params') || line.includes('currentLang') || line.includes('= useTranslations(')) {
      pageFMLines.push(line);
    } else if (line.trim().startsWith('const title ') || line.trim().startsWith('const description ') || line.trim().startsWith('const keywords ')) {
      pageFMLines.push(line);
    } else if (line.trim().length === 0) {
      pageFMLines.push(line);
      compFMLines.push(line);
    } else {
      compFMLines.push(line);
    }
  }

  // Write new component
  const compContent = `---
${compFMLines.join('\n')}
---
${layoutInner}
`;

  fs.writeFileSync(path.join(componentsDir, `${componentName}.astro`), compContent);

  // Write new page
  const pageContent = `---
${pageFMLines.join('\n')}
import ${componentName} from '../../components/pages/${componentName}.astro';
---
<Layout${layoutProps}>
    <${componentName} lang={currentLang} t={t} />
</Layout>
`;

  fs.writeFileSync(filePath, pageContent);
  console.log(`Refactored ${file}`);
}
