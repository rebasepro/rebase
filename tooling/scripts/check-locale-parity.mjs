#!/usr/bin/env node
/**
 * Every key `en` declares exists in every other bundle, with a value that is
 * not still English.
 *
 * ## Why this is a separate check from `check:untranslated`
 *
 * `check:untranslated` looks at the *source*: a component that types out the
 * English of a key instead of calling `t()`. It is blind to the locale files
 * themselves, and that is where the admin was actually English.
 *
 * On 2026-09-06 the panel in Español showed "No API keys yet", "Create a key to
 * enable machine-to-machine authentication", "New", "Select an API key to view
 * details"; `/branches` showed "Select a branch to view details"; the users
 * reset-password dialog was entirely English apart from "Cancelar". Every one
 * of those keys existed in `es.ts` — holding the English string, byte for byte
 * — and `check:untranslated` was green, unchanged from its baseline, because
 * nothing in the components was wrong. The strings had been moved into keys and
 * the translations had not followed.
 *
 * Two failures, and they are different:
 *
 * 1. **A key `en` has and another bundle does not.** i18next answers a miss
 *    with the key itself, so the screen reads `reset_password_send_email`.
 *    41 keys were in this state — the whole user password-reset surface,
 *    the filter presets, `error_loading_data`, `user_menu`, `toggle_theme`.
 * 2. **A value byte-identical to English.** Which is what a copy-paste of
 *    `en.ts` leaves behind, and what a reader sees as an untranslated app.
 *
 * ## What is allowed to be identical
 *
 * A single word, because "Actions" is French for "Actions" and "Kanban" is
 * Kanban everywhere — a rule that flagged those would be one nobody could act
 * on. And the entries in {@link SHARED} below, which are SQL fragments and
 * product names: translating `SELECT * FROM` produces something that is not
 * SQL. Each one is listed by key, so adding to the list is a decision somebody
 * makes on purpose rather than a category that quietly swallows new strings.
 *
 *     pnpm check:locale-parity
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = path.join(ROOT, "packages/app/src/locales");
const SOURCE = "en";
const TARGETS = ["de", "es", "fr", "it", "pt", "hi"];

/**
 * Keys whose value is deliberately the same in every language.
 *
 * Keep this short and keep the reason with it. Anything here is a string a
 * reader will see in English, so it has to be one where English *is* the right
 * answer — not one nobody got round to.
 */
const SHARED = new Map([
    // SQL, shown as the statement the button will write. Not prose.
    ["studio_schema_select_all", "a SQL statement"],
    ["studio_schema_insert_into", "a SQL statement"],
    ["studio_schema_delete_from", "a SQL statement"],
    ["studio_sql_limit_1000", "the SQL LIMIT clause the toggle applies"]
]);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

/** A `key: "value",` line, single- or double-quoted, at any indentation. */
const KEY_LINE = /^\s*([A-Za-z0-9_]+):\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,?\s*$/;

/** Read a TypeScript string literal. */
function literal(text) {
    if (text.startsWith("\"")) return JSON.parse(text);
    return JSON.parse(`"${text.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, "\\\"")}"`);
}

function readLocale(lang) {
    const file = path.join(DIR, `${lang}.ts`);
    if (!fs.existsSync(file)) {
        console.error(red(`No locale file at ${path.relative(ROOT, file)}.`));
        process.exit(1);
    }
    const out = new Map();
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
        const m = KEY_LINE.exec(line);
        if (m) out.set(m[1], literal(m[2]));
    }
    return out;
}

/**
 * Is this value one a translation would have changed?
 *
 * Multi-word only. A one-word label is identical across languages often enough
 * that flagging it would bury the real findings — and `{{count}} columns` is
 * two words, so an interpolated string is still checked.
 */
function shouldDiffer(value) {
    return value.trim().split(/\s+/).length > 1;
}

const source = readLocale(SOURCE);
const problems = [];

for (const lang of TARGETS) {
    const target = readLocale(lang);
    const missing = [];
    const english = [];

    for (const [key, value] of source) {
        if (!target.has(key)) {
            missing.push(key);
            continue;
        }
        if (SHARED.has(key)) continue;
        if (target.get(key) === value && shouldDiffer(value)) english.push(key);
    }

    const extra = [...target.keys()].filter(key => !source.has(key));
    if (missing.length || english.length || extra.length) {
        problems.push({ lang, missing, english, extra });
    }
}

// A `SHARED` entry for a key that no longer exists is a stale exemption, and a
// stale exemption is how a list like this stops meaning anything.
const staleShared = [...SHARED.keys()].filter(key => !source.has(key));

if (problems.length === 0 && staleShared.length === 0) {
    console.log(green(
        `✓ locale parity: ${source.size} keys in ${SOURCE}, present and translated in ${TARGETS.join(", ")}.`
    ));
    process.exit(0);
}

for (const { lang, missing, english, extra } of problems) {
    console.error(red(`\n✗ ${lang}.ts`));
    if (missing.length) {
        console.error(`  ${bold(`${missing.length} key(s) missing`)} — i18next renders the key itself, so these show as \`snake_case\` on screen:`);
        for (const key of missing.slice(0, 20)) console.error(`    ${key}`);
        if (missing.length > 20) console.error(dim(`    …and ${missing.length - 20} more`));
    }
    if (english.length) {
        console.error(`  ${bold(`${english.length} value(s) still byte-identical to English`)}:`);
        for (const key of english.slice(0, 20)) {
            console.error(`    ${key}: ${JSON.stringify(source.get(key))}`);
        }
        if (english.length > 20) console.error(dim(`    …and ${english.length - 20} more`));
    }
    if (extra.length) {
        console.error(`  ${bold(`${extra.length} key(s) not in ${SOURCE}.ts`)} — nothing reads these:`);
        for (const key of extra) console.error(`    ${key}`);
    }
}

if (staleShared.length) {
    console.error(red(`\n✗ SHARED names ${staleShared.length} key(s) that ${SOURCE}.ts no longer has:`));
    for (const key of staleShared) console.error(`    ${key}`);
    console.error(dim("\n  Remove them from check-locale-parity.mjs.\n"));
}

console.error(dim(
    `\n  ${SOURCE}.ts is the source of truth: every key it declares has to exist in\n` +
    "  every other bundle, translated. A string that is genuinely the same in\n" +
    "  every language — a SQL fragment, a product name — goes in SHARED with the\n" +
    "  reason beside it.\n"
));
process.exit(1);
