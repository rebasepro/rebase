import { promises as fs } from 'fs';
import path from 'path';
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
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
 * Two modes:
 *
 *   (default)         translate keys MISSING from a locale. A key already
 *                     present is never re-sent, so hand edits survive and a
 *                     re-run resumes after a partial failure.
 *
 *   --refresh-stale   also re-translate keys that are present but STALE — the
 *                     English was rewritten after the translation was made.
 *                     This overwrites existing copy, so it is opt-in.
 *
 * Add --dry-run to either mode to list the work without calling the API.
 */

const REFRESH_STALE = process.argv.includes('--refresh-stale');
const DRY_RUN = process.argv.includes('--dry-run');

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey && !DRY_RUN) {
    console.error('Error: GEMINI_API_KEY environment variable is missing.');
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(apiKey ?? 'dry-run');
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
 * Keys a refresh re-translated and got the same answer back for.
 *
 * The staleness walk reads value *changes*, so a key whose correct translation
 * is unchanged by an English edit — `nav.ai` survived "AI and agents" becoming
 * "AI & agents" — never records a change and stays flagged after every run.
 * Left alone that turns into ten permanent false positives, which is how a
 * check stops being read. Recording the English value it was confirmed against
 * clears it, and re-flags it the moment that English moves again.
 */
const CHECKPOINT_FILE = path.join(I18N_DIR, '.translation-checkpoint.json');
const fingerprint = (value) => createHash('sha1').update(value).digest('hex').slice(0, 12);

async function loadCheckpoint() {
    try {
        return JSON.parse(await fs.readFile(CHECKPOINT_FILE, 'utf-8'));
    } catch {
        return {};
    }
}

async function saveCheckpoint(checkpoint) {
    const ordered = Object.fromEntries(
        Object.keys(checkpoint).sort().map((lang) => [
            lang,
            Object.fromEntries(Object.keys(checkpoint[lang]).sort().map((k) => [k, checkpoint[lang][k]])),
        ])
    );
    await fs.writeFile(CHECKPOINT_FILE, JSON.stringify(ordered, null, 2) + '\n', 'utf-8');
}

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
 * Keys whose English was rewritten AFTER the locale's value was last written.
 *
 * A stale key is present in every locale with a plausible-looking translation,
 * so no key diff and no read of the files can see it — only their histories
 * can. `de76b857b` is the case this exists for: it rewrote 36 strings in
 * `en.ts` and touched no locale file, leaving 30 keys saying something the
 * English page had stopped saying, in all three languages at once.
 *
 * The walk replays every commit that touched `src/i18n/`, recording for each
 * (locale, key) the index of the commit where its value last changed. English
 * moving later than the translation is the definition of stale.
 */
function findStaleKeys(langs) {
    const repo = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim();
    const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8', maxBuffer: 1 << 28 });

    const commits = git('log', '--format=%h\t%ad\t%s', '--date=short', '--reverse', '--', 'website/src/i18n/')
        .trim().split('\n').filter(Boolean)
        .map((line) => { const [hash, date, ...rest] = line.split('\t'); return { hash, date, subject: rest.join('\t') }; });

    const all = [SOURCE_LANG, ...langs];
    const lastChanged = Object.fromEntries(all.map((l) => [l, {}]));
    const seen = Object.fromEntries(all.map((l) => [l, {}]));

    commits.forEach((commit, index) => {
        for (const lang of all) {
            let source;
            try { source = git('show', `${commit.hash}:website/src/i18n/${lang}.ts`); } catch { continue; }
            let obj;
            try { obj = new Function(source.replace(/export\s+const\s+\w+\s*=/, 'return'))(); } catch { continue; }
            for (const [key, value] of Object.entries(obj)) {
                if (seen[lang][key] !== value) { lastChanged[lang][key] = index; seen[lang][key] = value; }
            }
        }
    });

    const stale = {};
    for (const lang of langs) {
        stale[lang] = [];
        for (const key of Object.keys(seen[SOURCE_LANG])) {
            const enAt = lastChanged[SOURCE_LANG][key];
            const locAt = lastChanged[lang][key];
            if (locAt === undefined || enAt === undefined) continue;  // never translated → the missing-key path owns it
            if (enAt > locAt) stale[lang].push({ key, blame: commits[enAt] });
        }
    }
    return { stale, commits };
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

async function translateBatch(entries, targetLang, previous = null) {
    const payload = Object.fromEntries(entries);

    // When refreshing a stale key there is already a translation of the OLD
    // English. It is wrong about the content but right about the vocabulary the
    // rest of the file uses, so it goes in as terminology context — dropping it
    // makes the refreshed strings drift away from their neighbours.
    const previousBlock = previous
        ? `\nFor terminology and register only, here is the OUTDATED ${LANG_NAMES[targetLang]} translation of an EARLIER version of these strings. The English has since changed, so the MEANING below is wrong and must not be reused. Match its vocabulary and tone; translate the new English faithfully.\n\n${JSON.stringify(previous, null, 2)}\n`
        : '';

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
${previousBlock}
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
 * Rewrites the value of keys that already exist, leaving their position alone.
 *
 * Refreshing a stale key must not move it: the locale files are reviewed
 * against `en.ts` line by line, and a reordering diff would bury the one thing
 * that actually changed.
 */
async function replaceEntries(lang, keys, translations) {
    const file = localeFile(lang);
    let source = await fs.readFile(file, 'utf-8');

    for (const key of keys) {
        const keyToken = `\n  ${JSON.stringify(key)}:`;
        const start = source.indexOf(keyToken);
        const end = findEntryEnd(source, key);
        if (start === -1 || end === -1) {
            throw new Error(`Cannot locate entry "${key}" in ${lang}.ts to replace`);
        }
        source = source.slice(0, start + 1) + formatEntry(key, translations[key]) + source.slice(end);
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

/** Runs one set of keys through the model in batches. Returns null on failure. */
async function translateKeys(lang, keys, english, previousValues) {
    const translations = {};
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
        const slice = keys.slice(i, i + BATCH_SIZE);
        const batch = slice.map((key) => [key, english[key]]);
        const previous = previousValues
            ? Object.fromEntries(slice.map((key) => [key, previousValues[key]]))
            : null;
        const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
        const batchCount = Math.ceil(keys.length / BATCH_SIZE);
        console.log(`  batch ${batchNumber}/${batchCount} (${batch.length} keys)...`);

        try {
            Object.assign(translations, await translateBatch(batch, lang, previous));
        } catch (error) {
            console.error(`  ❌ [${lang}] batch ${batchNumber} failed: ${error.message}`);
            console.error('  Nothing written for this locale; re-run to retry.');
            return null;
        }

        // Stay under the free-tier rate limit.
        await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return translations;
}

async function main() {
    const english = await loadLocale(SOURCE_LANG);
    const englishKeys = Object.keys(english);
    console.log(`Source: ${SOURCE_LANG}.ts — ${englishKeys.length} keys`);

    const checkpoint = await loadCheckpoint();
    let checkpointDirty = false;

    let staleByLang = {};
    if (REFRESH_STALE) {
        console.log('Replaying src/i18n history to find stale keys...');
        ({ stale: staleByLang } = findStaleKeys(TARGET_LANGUAGES));

        // Drop anything a previous run confirmed against this exact English.
        for (const lang of TARGET_LANGUAGES) {
            const checked = checkpoint[lang] ?? {};
            staleByLang[lang] = staleByLang[lang].filter(
                ({ key }) => checked[key] !== fingerprint(english[key])
            );
        }
    }

    for (const lang of TARGET_LANGUAGES) {
        const existing = await loadLocale(lang);
        const missingKeys = englishKeys.filter((key) => !(key in existing));

        const orphaned = Object.keys(existing).filter((key) => !(key in english));
        if (orphaned.length) {
            console.warn(
                `⚠ [${lang}] ${orphaned.length} key(s) not in en.ts (removed upstream?): ${orphaned.join(', ')}`
            );
        }

        // Only refresh keys the model has not just written in this same run.
        const staleKeys = (staleByLang[lang] ?? [])
            .filter(({ key }) => key in existing && key in english)
            .map(({ key }) => key);

        if (REFRESH_STALE && staleKeys.length) {
            console.log(`\n[${lang}] ${staleKeys.length} stale key(s) — English changed after the translation:`);
            for (const { key, blame } of staleByLang[lang]) {
                if (staleKeys.includes(key)) console.log(`    ${key}  (en last changed in ${blame.hash} ${blame.date})`);
            }
        }


        if (missingKeys.length === 0 && staleKeys.length === 0) {
            console.log(`✔ [${lang}] up to date (${Object.keys(existing).length} keys)`);
            continue;
        }

        if (DRY_RUN) {
            console.log(`[${lang}] dry run — ${missingKeys.length} missing, ${staleKeys.length} stale; nothing written`);
            continue;
        }

        if (missingKeys.length) {
            console.log(`\n[${lang}] translating ${missingKeys.length} missing key(s)`);
            const translations = await translateKeys(lang, missingKeys, english, null);
            if (!translations) return;
            await insertEntries(lang, missingKeys, translations, englishKeys);
            console.log(`✅ [${lang}] inserted ${missingKeys.length} key(s)`);
        }

        if (staleKeys.length) {
            console.log(`\n[${lang}] refreshing ${staleKeys.length} stale key(s)`);
            const translations = await translateKeys(lang, staleKeys, english, existing);
            if (!translations) return;

            const rewritten = staleKeys.filter((key) => translations[key] !== existing[key]);
            const confirmed = staleKeys.filter((key) => translations[key] === existing[key]);

            if (rewritten.length) await replaceEntries(lang, rewritten, translations);
            if (confirmed.length) {
                checkpoint[lang] ??= {};
                for (const key of confirmed) checkpoint[lang][key] = fingerprint(english[key]);
                checkpointDirty = true;
            }
            console.log(
                `✅ [${lang}] rewrote ${rewritten.length} key(s)` +
                (confirmed.length ? `, confirmed ${confirmed.length} already correct` : '')
            );
        }
    }

    if (checkpointDirty) {
        await saveCheckpoint(checkpoint);
        console.log(`\nCheckpoint updated: ${path.relative(process.cwd(), CHECKPOINT_FILE)}`);
    }

    console.log('\nDone. Run `npx astro build` to verify the locale files still parse.');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
