import { promises as fs } from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Initialize Gemini API
// Make sure to export GEMINI_API_KEY in your terminal before running this script
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('Error: GEMINI_API_KEY environment variable is missing.');
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(apiKey);
// Using gemini-3.7-flash as it's fast and excellent for translation tasks
const model = genAI.getGenerativeModel({ model: 'gemini-3.7-flash' });

const TARGET_LANGUAGES = ['es', 'de', 'fr', 'it', 'pt'];
const CONTENT_DIR = path.resolve('./src/content/docs');

/**
 * Directories that are generated, and must not be translated.
 *
 * `docs/ui/**` is written by the AST generator from the `.design-sync`
 * previews — it is regenerated wholesale, and nothing regenerates a
 * translation of it. Translating it once produces ~495 files (99 pages × 5
 * locales) that the generator does not own and will never update, so they
 * start drifting from the components they document on the next UI change.
 *
 * Starlight already falls back to English per-page, so an untranslated API
 * reference renders fine in every locale today. That fallback is the intended
 * behaviour here, not a gap.
 */
const EXCLUDED_DIRS = ['docs/ui'];

/**
 * Individual generated files, excluded for the same reason.
 *
 * `docs/CHANGELOG.md` is copied from the repo-root CHANGELOG by
 * `tooling/scripts/copy_changelog.js` on every `generate-all`, and `check:generated`
 * gates that it matches. Only the English copy is regenerated, so a translated
 * one is stale from the next release onward — and it is the one document where
 * being one release behind is worst.
 */
const EXCLUDED_FILES = ['docs/CHANGELOG.md'];

// Helper to recursively get all markdown files
async function getMarkdownFiles(dir, fileList = []) {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        
        if (entry.isDirectory()) {
            // Skip target language directories to avoid translating translations
            if (dir === CONTENT_DIR && TARGET_LANGUAGES.includes(entry.name)) {
                continue;
            }
            // Skip generated trees — see EXCLUDED_DIRS.
            const fromContentRoot = path.relative(CONTENT_DIR, fullPath);
            if (EXCLUDED_DIRS.some(excluded => fromContentRoot === excluded || fromContentRoot.startsWith(`${excluded}/`))) {
                console.log(`Skipping generated directory: ${fromContentRoot}`);
                continue;
            }
            await getMarkdownFiles(fullPath, fileList);
        } else if (entry.isFile() && (fullPath.endsWith('.md') || fullPath.endsWith('.mdx'))) {
            if (EXCLUDED_FILES.includes(path.relative(CONTENT_DIR, fullPath))) {
                console.log(`Skipping generated file: ${path.relative(CONTENT_DIR, fullPath)}`);
                continue;
            }
            fileList.push(fullPath);
        }
    }
    
    return fileList;
}

// Function to translate text using Gemini
async function translateWithGemini(content, targetLang) {
    const langNames = {
        'es': 'Spanish',
        'de': 'German',
        'fr': 'French',
        'it': 'Italian',
        'pt': 'Portuguese'
    };

    const targetLangName = langNames[targetLang];

    const prompt = `You are a professional technical translator. Translate the following Markdown/MDX documentation file into ${targetLangName}.

STRICT RULES:
1. Preserve ALL Markdown and MDX formatting, tags, and structure exactly as they are.
2. DO NOT translate any code blocks (content between \`\`\`).
3. DO NOT translate frontmatter keys (the YAML at the top between ---).
4. You MAY translate the VALUES of frontmatter fields like "title" and "description".
5. DO NOT translate URLs or file paths.
6. Return ONLY the raw translated file content. Do not add any conversational text before or after the markdown.

File content to translate:
---
${content}
---`;

    try {
        const result = await model.generateContent(prompt);
        let translatedText = result.response.text();
        
        // Clean up markdown block if Gemini wraps it
        if (translatedText.startsWith('\`\`\`markdown')) {
            translatedText = translatedText.replace(/^\`\`\`markdown\n?/, '').replace(/\n?\`\`\`$/, '');
        } else if (translatedText.startsWith('\`\`\`mdx')) {
            translatedText = translatedText.replace(/^\`\`\`mdx\n?/, '').replace(/\n?\`\`\`$/, '');
        } else if (translatedText.startsWith('\`\`\`')) {
            translatedText = translatedText.replace(/^\`\`\`\n?/, '').replace(/\n?\`\`\`$/, '');
        }

        translatedText = translatedText.trim() + '\n';

        // Post-process: fix slug to include locale prefix
        translatedText = translatedText.replace(
            /^(slug:\s*)(.+)$/m,
            (match, prefix, slug) => {
                const trimmedSlug = slug.trim();
                if (!trimmedSlug.startsWith(`${targetLang}/`)) {
                    return `${prefix}${targetLang}/${trimmedSlug}`;
                }
                return match;
            }
        );

        // Post-process: quote description values containing `: ` to prevent YAML parse errors
        translatedText = translatedText.replace(
            /^(description:\s*)([^"'].+)$/m,
            (match, prefix, value) => {
                if (value.includes(': ')) {
                    const escaped = value.trim().replace(/"/g, '\\"');
                    return `${prefix}"${escaped}"`;
                }
                return match;
            }
        );

        return translatedText;
    } catch (error) {
        console.error(`Gemini API Error translating to ${targetLang}:`, error.message);
        throw error;
    }
}

/**
 * Rejects output Astro would refuse to load.
 *
 * The model occasionally opens the file with an empty fence — `---\n---\ntitle:
 * …` — which makes the real frontmatter part of the body and the entry fails
 * the content-collection schema with `title: Required`. Nothing here caught
 * that: the file was written, the run reported ✅, and the break only surfaced
 * later as a build error naming the *collection*, not the translator.
 *
 * Throwing instead lets the retry in the caller have another go, and a file
 * that never validates is simply not written — the missing translation falls
 * back to English, which is the intended behaviour anyway.
 */
function assertValidFrontmatter(text, sourceContent, label) {
    if (!sourceContent.startsWith('---')) return;   // source has no frontmatter; nothing to check

    if (!text.startsWith('---\n')) {
        throw new Error(`${label}: output does not open with a frontmatter fence`);
    }
    const match = text.match(/^---\n([\s\S]*?)\n?---\n/);
    if (!match) {
        throw new Error(`${label}: frontmatter fence is never closed`);
    }
    if (match[1].trim() === '') {
        throw new Error(`${label}: empty frontmatter block — the model doubled the opening ---`);
    }
    if (/^title:/m.test(sourceContent) && !/^title:\s*\S/m.test(match[1])) {
        throw new Error(`${label}: frontmatter has no title, but the English source does`);
    }

    // Fence parity: a dropped or invented ``` silently swallows the rest of the page.
    const fenceCount = (s) => (s.match(/^```/gm) || []).length;
    if (fenceCount(text) !== fenceCount(sourceContent)) {
        throw new Error(
            `${label}: ${fenceCount(text)} code fences against the source's ${fenceCount(sourceContent)}`
        );
    }
}

async function main() {
    console.log('Starting translation process...');
    console.log(`Target languages: ${TARGET_LANGUAGES.join(', ')}`);

    const allFiles = await getMarkdownFiles(CONTENT_DIR);
    console.log(`Found ${allFiles.length} source files to check.`);

    for (const sourceFilePath of allFiles) {
        // Calculate the relative path from CONTENT_DIR
        const relativePath = path.relative(CONTENT_DIR, sourceFilePath);
        
        const content = await fs.readFile(sourceFilePath, 'utf-8');

        for (const lang of TARGET_LANGUAGES) {
            // Construct target path, e.g., src/content/docs/es/docs/architecture/index.mdx
            const targetFilePath = path.join(CONTENT_DIR, lang, relativePath);
            const targetDir = path.dirname(targetFilePath);

            try {
                // Check if file already exists so we don't re-translate
                await fs.access(targetFilePath);
                console.log(`Skipping: [${lang}] ${relativePath} (already exists)`);
                continue;
            } catch (err) {
                // File doesn't exist, proceed with translation
            }

            console.log(`Translating: [${lang}] ${relativePath} ...`);
            
            try {
                // Ensure target directory exists
                await fs.mkdir(targetDir, { recursive: true });

                // Call Gemini. Validate before writing — a file that fails the
                // content-collection schema breaks the whole build, so two extra
                // attempts here are cheaper than a red build nobody traces back
                // to this script.
                const label = `[${lang}] ${relativePath}`;
                let translatedContent = null;
                for (let attempt = 1; attempt <= 3; attempt++) {
                    const candidate = await translateWithGemini(content, lang);
                    try {
                        assertValidFrontmatter(candidate, content, label);
                        translatedContent = candidate;
                        break;
                    } catch (invalid) {
                        console.warn(`  ⚠ attempt ${attempt}/3 rejected — ${invalid.message}`);
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
                if (!translatedContent) {
                    console.error(`❌ ${label}: no valid output after 3 attempts, leaving untranslated`);
                    continue;
                }

                // Write translated file
                await fs.writeFile(targetFilePath, translatedContent, 'utf-8');
                console.log(`✅ Saved: ${targetFilePath}`);

                // Add a small delay to avoid hitting rate limits
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.error(`❌ Failed to translate [${lang}] ${relativePath}: ${error.message}`);
                // Stop or continue depending on preference; here we continue to the next one
            }
        }
    }
    
    console.log('Translation process complete!');
}

main().catch(console.error);
