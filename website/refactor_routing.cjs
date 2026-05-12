const fs = require('fs');
const path = require('path');

const pagesDir = path.join(__dirname, 'src', 'pages');
const langDir = path.join(pagesDir, '[...lang]');

if (!fs.existsSync(langDir)) {
    fs.mkdirSync(langDir);
}

const files = fs.readdirSync(pagesDir);

const getStaticPathsCode = `
import { languages, defaultLang, useTranslations } from '../../i18n/ui';

export function getStaticPaths() {
  return Object.keys(languages).map((lang) => ({
    params: { lang: lang === defaultLang ? undefined : lang },
  }));
}

const { lang } = Astro.params;
const currentLang = lang || defaultLang;
const t = useTranslations(currentLang as keyof typeof languages);
`;

files.forEach(file => {
    if (file.endsWith('.astro') && file !== '[...lang].astro' && file !== '404.astro') {
        const oldPath = path.join(pagesDir, file);
        const newPath = path.join(langDir, file);
        
        let content = fs.readFileSync(oldPath, 'utf8');
        
        // Update relative imports
        content = content.replace(/from ['"]\.\.\/layouts/g, "from '../../layouts");
        content = content.replace(/from ['"]\.\.\/components/g, "from '../../components");
        content = content.replace(/from ['"]\.\.\/i18n/g, "from '../../i18n");
        
        // Inject getStaticPaths
        if (!content.includes('getStaticPaths')) {
            content = content.replace('---', '---\n' + getStaticPathsCode);
        }
        
        fs.writeFileSync(newPath, content);
        fs.unlinkSync(oldPath);
        console.log(`Moved and updated ${file}`);
    }
});

// Rename [...lang].astro to [...lang]/index.astro
const oldIndex = path.join(pagesDir, '[...lang].astro');
if (fs.existsSync(oldIndex)) {
    let indexContent = fs.readFileSync(oldIndex, 'utf8');
    indexContent = indexContent.replace(/from ['"]\.\.\/layouts/g, "from '../../layouts");
    indexContent = indexContent.replace(/from ['"]\.\.\/components/g, "from '../../components");
    indexContent = indexContent.replace(/from ['"]\.\.\/i18n/g, "from '../../i18n");
    fs.writeFileSync(path.join(langDir, 'index.astro'), indexContent);
    fs.unlinkSync(oldIndex);
    console.log(`Moved [...lang].astro to [...lang]/index.astro`);
}

