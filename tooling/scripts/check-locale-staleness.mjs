#!/usr/bin/env node
/**
 * A translation is not left behind when its English changes.
 *
 * `check:locale-parity` asks whether every key exists in every bundle and is
 * not still English. It cannot see a key whose English was rewritten while the
 * six translations kept saying what the old English said: every bundle has the
 * key, every value is translated, and German now describes a button that no
 * longer does that. Nothing in a single checkout can tell; only the history can.
 *
 * So the history is stored. `locale-sources.json` holds, for every key, a short
 * hash of each bundle's value (`en` first) as it was when the bundles last
 * agreed. The check compares today's values with it:
 *
 *  - **English changed and a translation did not**: that translation was made
 *    from English that no longer exists. A failure, naming the key and the
 *    bundles. Update them, or, when the translation is still right (the
 *    English change was a typo or punctuation), say so for that key with
 *    `--accept <key>`.
 *  - **English and every translation changed, a key came or went**: nothing is
 *    stale, the record is behind. It is rewritten in place, so the file shows
 *    up beside the edit and goes into the same commit (as `check:api-surface`
 *    banks additions). Under GitHub Actions that is also a `::notice`.
 *  - A translation that changed on its own is recorded too: fixing German needs
 *    no English change.
 *
 * A bundle missing a key is `check:locale-parity`'s finding, not this one's.
 *
 * The baseline was recorded on 2026-10-25 from the bundles as they were; a
 * translation already stale that day is not known to be.
 *
 *     pnpm check:locale-staleness
 *     pnpm check:locale-staleness --accept <key>[,<key>...]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DIR = path.join(ROOT, "packages/app/src/locales");
const RECORD = path.join(ROOT, "tooling", "scripts", "locale-sources.json");
export const SOURCE = "en";
export const TARGETS = ["de", "es", "fr", "hi", "it", "pt"];
export const LANGUAGES = [SOURCE, ...TARGETS];

/** A `key: "value",` line, single- or double-quoted, as `check:locale-parity` reads it. */
const KEY_LINE = /^\s*([A-Za-z0-9_]+):\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')\s*,?\s*$/;

function literal(text) {
    if (text.startsWith("\"")) return JSON.parse(text);
    return JSON.parse(`"${text.slice(1, -1).replace(/\\'/g, "'").replace(/"/g, "\\\"")}"`);
}

/** A locale file's keys and values. */
export function readLocaleSource(source) {
    const out = new Map();
    for (const line of source.split("\n")) {
        const m = KEY_LINE.exec(line);
        if (m) out.set(m[1], literal(m[2]));
    }
    return out;
}

/** Eight hex characters of SHA-256: enough to tell two strings apart, short enough to read in a diff. */
export function valueHash(value) {
    return value === undefined ? "" : crypto.createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/** Every key of the source bundle, as the hashes of its value in each language (`LANGUAGES` order). */
export function hashBundles(bundles) {
    const out = {};
    for (const key of [...bundles[SOURCE].keys()].sort()) {
        out[key] = LANGUAGES.map(lang => valueHash(bundles[lang]?.get(key)));
    }
    return out;
}

/**
 * Compare today's hashes with the record.
 *
 * Returns the stale translations (`{ key, langs }`), and the record as it
 * should be written: every key that is not stale at today's hashes, and every
 * stale key at what the record had (it stays stale until fixed or accepted).
 */
export function compareWithRecord(recorded, current, accept = new Set()) {
    const stale = [];
    const next = {};
    for (const [key, hashes] of Object.entries(current)) {
        const before = recorded[key];
        if (!before || accept.has(key) || before[0] === hashes[0]) {
            next[key] = hashes;
            continue;
        }
        // English changed. Each translation that is present and unchanged
        // since the record was made from the English before this one.
        const langs = TARGETS.filter((lang, i) => {
            const now = hashes[i + 1];
            return now !== "" && now === before[i + 1];
        });
        if (langs.length === 0) {
            next[key] = hashes;
        } else {
            stale.push({ key, langs });
            next[key] = before;
        }
    }
    return { stale, next };
}

/** The record as written: one key per line, so a diff names the keys that moved. */
export function formatRecord(keys) {
    const lines = Object.keys(keys).sort().map(key => `    ${JSON.stringify(key)}: ${JSON.stringify(keys[key])}`);
    return `{\n  "languages": ${JSON.stringify(LANGUAGES)},\n  "keys": {\n${lines.join(",\n")}\n  }\n}\n`;
}

function readBundles() {
    const bundles = {};
    for (const lang of LANGUAGES) {
        const file = path.join(DIR, `${lang}.ts`);
        bundles[lang] = fs.existsSync(file) ? readLocaleSource(fs.readFileSync(file, "utf8")) : new Map();
    }
    return bundles;
}

function readRecord() {
    if (!fs.existsSync(RECORD)) return null;
    const parsed = JSON.parse(fs.readFileSync(RECORD, "utf8"));
    if (JSON.stringify(parsed.languages) !== JSON.stringify(LANGUAGES)) {
        throw new Error(`${path.relative(ROOT, RECORD)} lists languages ${JSON.stringify(parsed.languages)}, ` +
            `this check reads ${JSON.stringify(LANGUAGES)}. Delete the file to record a new baseline.`);
    }
    return parsed.keys;
}

function acceptedKeys(argv) {
    const keys = new Set();
    argv.forEach((arg, i) => {
        if (arg === "--accept" && argv[i + 1]) argv[i + 1].split(",").forEach(k => keys.add(k.trim()));
        else if (arg.startsWith("--accept=")) arg.slice("--accept=".length).split(",").forEach(k => keys.add(k.trim()));
    });
    return keys;
}

function main() {
    const red = (s) => `\x1b[31m${s}\x1b[0m`;
    const green = (s) => `\x1b[32m${s}\x1b[0m`;
    const dim = (s) => `\x1b[2m${s}\x1b[0m`;

    const bundles = readBundles();
    const current = hashBundles(bundles);
    const recorded = readRecord();
    const relRecord = path.relative(ROOT, RECORD);

    if (!recorded) {
        fs.writeFileSync(RECORD, formatRecord(current));
        console.log(`  No record yet; recorded ${Object.keys(current).length} keys in ${relRecord}. Commit it.`);
        // A checkout without the record has nothing to compare: in CI that
        // is the record deleted, not a first run.
        if (process.env.CI) {
            console.error(red(`✗ ${relRecord} is missing. Run pnpm check:locale-staleness and commit it.`));
            process.exit(1);
        }
        return;
    }

    const accept = acceptedKeys(process.argv.slice(2));
    const unknown = [...accept].filter(key => !(key in current));
    if (unknown.length) {
        console.error(red(`✗ --accept names key(s) en.ts does not have: ${unknown.join(", ")}`));
        process.exit(1);
    }

    const { stale, next } = compareWithRecord(recorded, current, accept);
    const written = formatRecord(next);
    const changed = written !== fs.readFileSync(RECORD, "utf8");
    if (changed) {
        fs.writeFileSync(RECORD, written);
        const message = `${relRecord} updated with the locale changes it had not seen — commit it with them.`;
        console.log(dim(`  ${message}`));
        if (process.env.GITHUB_ACTIONS) console.log(`::notice file=${relRecord}::${message}`);
    }

    if (stale.length === 0) {
        console.log(green(`✓ locale staleness: no translation is older than its English (${Object.keys(current).length} keys).`));
        return;
    }

    console.error(red(`\n✗ ${stale.length} key(s) whose English changed while some translations did not:\n`));
    for (const { key, langs } of stale) {
        console.error(`    ${key}  ${dim(`(${langs.join(", ")})`)}  en: ${JSON.stringify(bundles[SOURCE].get(key))}`);
    }
    console.error(dim(
        "\n  Each of those translations was made from English that has since changed.\n" +
        "  Update it in packages/app/src/locales/<lang>.ts. If the translation is still\n" +
        `  right (the English change was a typo), record that: pnpm check:locale-staleness --accept ${stale[0].key}\n`
    ));
    process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
