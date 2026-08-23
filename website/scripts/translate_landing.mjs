import { promises as fs } from 'fs';
import path from 'path';
import { GoogleGenerativeAI } from '@google/generative-ai';

/**
 * Fills in the landing-page (marketing) translations.
 *
 * This is the sibling of `translate_docs.mjs`, which only walks
 * `src/content/docs`. The marketing pages under `src/pages/[...lang]/` do not
 * read markdown at all — every string is a key in `src/i18n/<lang>.ts`, so a
 * new section on the home page adds keys to `en.ts` and silently falls back to
 * English in every other locale until they are filled in here.
 *
 * Only MISSING keys are translated. A key already present in a target locale is
 * never re-sent — hand edits to the translations survive, and a re-run after a
 * partial failure resumes rather than restarting.
 */

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    console.error('Error: GEMINI_API_KEY environment variable is missing.');
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({
    model: 'gemini-3.7-flash',
    generationConfig: {
        // The prompt asks for a JSON object; constraining the response MIME type
        // removes the ```json fence that otherwise has to be stripped by hand.
        responseMimeType: 'application/json',
        temperature: 0.2,
    },
});

/**
 * Marketing locales, NOT doc locales.
 *
 * The docs ship 6 locales (en/es/de/fr/it/pt) but the marketing pages ship 4 —
 * `it` and `pt` have no `src/i18n/<lang>.ts` and are absent from the `languages`
 * map in `src/i18n/locales.ts`, so `/it` and `/pt` build docs only. Adding them
 * here without also registering them in `locales.ts` would produce two orphan
 * files that nothing imports.
 */
const TARGET_LANGUAGES = ['es', 'de', 'fr'];

const LANG_NAMES = {
    es: 'Spanish (Spain)',
    de: 'German',
    fr: 'French (France)',
};

const I18N_DIR = path.resolve('./src/i18n');
const SOURCE_LANG = 'en';

/** Keys per Gemini request. Values carry inline HTML, so keep batches small. */
const BATCH_SIZE = 10;

const localeFile = (lang) => path.join(I18N_DIR, `${lang}.ts`);

/**
 * Reads a locale module without a TypeScript loader.
 *
 * The files are plain object literals — `export const es = { "key": "value" }` —
 * so rewriting the export into a `return` makes the whole file a JS function
 * body. This keeps the reader honest about the real values: entries mix single
 * and double quotes and wrap across lines, which a line-based regex gets wrong.
 */
async function loadLocale(lang) {
    const source = await fs.readFile(localeFile(lang), 'utf-8');
    const body = source.replace(/export\s+const\s+\w+\s*=/, 'return');
    return new Function(body)();
}

/**
 * Renders one entry the way Prettier already formatted the file: on a single
 * line when it fits in 80 columns, otherwise with the value on its own line.
 */
function formatEntry(key, value) {
    const oneLine = `  ${JSON.stringify(key)}: ${JSON.stringify(value)},`;
    if (oneLine.length <= 80) return oneLine;
    return `  ${JSON.stringify(key)}:\n    ${JSON.stringify(value)},`;
}

async function translateBatch(entries, targetLang) {
    const payload = Object.fromEntries(entries);

    const prompt = `You are a professional translator localising the marketing website of Rebase, an open-source Postgres backend and admin panel for developers.

Translate the VALUES of the following JSON object into ${LANG_NAMES[targetLang]}. The audience is professional software developers, so use the register that developer tooling uses in that language — direct, concrete, not corporate marketing filler.

STRICT RULES:
1. Return a JSON object with EXACTLY the same keys, in the same order. Never add, drop or rename a key.
2. Translate only the human-readable text. Keep every HTML tag, attribute and CSS class byte-identical — <strong class="text-white font-medium">, <br class="hidden sm:block"/>, <a class="..." href="...">. Translate the text BETWEEN tags, never the markup itself.
3. Never translate URLs, paths or href values.
4. Never translate product, company or technology names: Rebase, Rebase Cloud, Postgres, PostgreSQL, Supabase, Firebase, Retool, Directus, Strapi, Hasura, Payload, Django, Docker, Fly, Railway, Hetzner, OVHcloud, Scaleway, GitHub, React, TypeScript, Node.js, Tailwind CSS, WebSocket, MIT, RLS, SDK, CLI, API, SSO, OIDC, SAML, MFA, rls-check, npm.
5. Keep shell commands, code identifiers and terminal output untranslated.
6. These are UI strings — buttons, badges, nav labels, headings. Keep them about as short as the English. A nav label must stay a nav label, not become a sentence.
7. Preserve the typography: em dashes stay em dashes, and use the target language's own quotation marks.
8. Return ONLY the JSON object.

JSON to translate:
${JSON.stringify(payload, null, 2)}`;

    const result = await model.generateContent(prompt);
    const translated = JSON.parse(result.response.text());

    // Verify the model returned the contract it was given. A dropped or renamed
    // key would otherwise be written as `undefined` and render as the raw key on
    // the page.
    const expected = entries.map(([key]) => key);
    const got = Object.keys(translated);
    const missing = expected.filter((key) => !(key in translated));
    const unexpected = got.filter((key) => !expected.includes(key));
    if (missing.length || unexpected.length) {
        throw new Error(
            `Key mismatch from model — missing [${missing.join(', ')}], unexpected [${unexpected.join(', ')}]`
        );
    }
    for (const key of expected) {
        if (typeof translated[key] !== 'string' || translated[key].trim() === '') {
            throw new Error(`Empty or non-string translation for "${key}"`);
        }
    }

    return translated;
}

/**
 * Writes new entries into an existing locale file, each one directly after the
 * key that precedes it in English.
 *
 * Appending everything at the end would work, but the locale files are read
 * side by side with `en.ts` when copy changes; keeping a new key next to its
 * neighbours is what makes the next diff reviewable.
 */
async function insertEntries(lang, orderedKeys, translations, englishKeys) {
    const file = localeFile(lang);
    let source = await fs.readFile(file, 'utf-8');

    for (const key of orderedKeys) {
        const entry = formatEntry(key, translations[key]);

        // Walk back through the English order until we hit a key this locale
        // already has, and insert after that key's entry.
        const englishIndex = englishKeys.indexOf(key);
        let anchor = null;
        for (let i = englishIndex - 1; i >= 0; i--) {
            const candidate = englishKeys[i];
            const found = findEntryEnd(source, candidate);
            if (found !== -1) {
                anchor = found;
                break;
            }
        }

        if (anchor === null) {
            // No preceding key exists here yet — put it at the top of the object.
            const objectStart = source.indexOf('{');
            const lineEnd = source.indexOf('\n', objectStart);
            source = `${source.slice(0, lineEnd + 1)}${entry}\n${source.slice(lineEnd + 1)}`;
        } else {
            source = `${source.slice(0, anchor)}\n${entry}${source.slice(anchor)}`;
        }
    }

    await fs.writeFile(file, source, 'utf-8');
}

/**
 * Offset just past the trailing comma of `key`'s entry, or -1 when absent.
 *
 * Entries wrap, so the end of the entry is not the end of the key's line. The
 * scan walks forward from the key to the first comma that is not inside a
 * string literal.
 */
function findEntryEnd(source, key) {
    const keyToken = `\n  ${JSON.stringify(key)}:`;
    const start = source.indexOf(keyToken);
    if (start === -1) return -1;

    let index = start + keyToken.length;
    let quote = null;
    while (index < source.length) {
        const char = source[index];
        if (quote) {
            if (char === '\\') {
                index += 2;
                continue;
            }
            if (char === quote) quote = null;
        } else if (char === '"' || char === "'" || char === '`') {
            quote = char;
        } else if (char === ',') {
            return index + 1;
        }
        index++;
    }
    return -1;
}

async function main() {
    const english = await loadLocale(SOURCE_LANG);
    const englishKeys = Object.keys(english);
    console.log(`Source: ${SOURCE_LANG}.ts — ${englishKeys.length} keys`);

    for (const lang of TARGET_LANGUAGES) {
        const existing = await loadLocale(lang);
        const missingKeys = englishKeys.filter((key) => !(key in existing));

        const stale = Object.keys(existing).filter((key) => !(key in english));
        if (stale.length) {
            console.warn(
                `⚠ [${lang}] ${stale.length} key(s) not in en.ts (removed upstream?): ${stale.join(', ')}`
            );
        }

        if (missingKeys.length === 0) {
            console.log(`✔ [${lang}] up to date (${Object.keys(existing).length} keys)`);
            continue;
        }

        console.log(`\n[${lang}] ${missingKeys.length} missing key(s) to translate`);

        const translations = {};
        for (let i = 0; i < missingKeys.length; i += BATCH_SIZE) {
            const batch = missingKeys.slice(i, i + BATCH_SIZE).map((key) => [key, english[key]]);
            const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
            const batchCount = Math.ceil(missingKeys.length / BATCH_SIZE);
            console.log(`  Translating batch ${batchNumber}/${batchCount} (${batch.length} keys)...`);

            try {
                Object.assign(translations, await translateBatch(batch, lang));
            } catch (error) {
                console.error(`  ❌ [${lang}] batch ${batchNumber} failed: ${error.message}`);
                console.error('  Nothing written for this locale; re-run to retry.');
                return;
            }

            // Stay under the free-tier rate limit.
            await new Promise((resolve) => setTimeout(resolve, 2000));
        }

        await insertEntries(lang, missingKeys, translations, englishKeys);
        console.log(`✅ [${lang}] wrote ${missingKeys.length} key(s) to ${lang}.ts`);
    }

    console.log('\nDone. Run `npx astro build` to verify the locale files still parse.');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
