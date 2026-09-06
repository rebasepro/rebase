/**
 * Every `export const X` a page tells you to put in `config/index.ts` is a name
 * the managed runtime actually reads.
 *
 * The Backend Overview's option map is the one table a reader consults before
 * writing anything into a scaffolded project's config package, and for two
 * releases it named `dataSources` and `storageSources` there. Those keys stopped
 * being read when resources moved into `config/resources.ts`, and
 * `assertNoReplacedResourceConfig` does not ignore them — it *throws*, by name,
 * at boot. So the table did not merely teach a no-op: it taught an edit that
 * turns a working deployment into a container that will not start.
 *
 * Two directions, both from source:
 *
 *   1. A documented export must be in `READ_CONFIG_EXPORTS`
 *      (`packages/server/src/boot/bundle.ts`) — the set the runtime consults
 *      before it warns about an export nothing reads.
 *   2. It must not be in `REPLACED_CONFIG_KEYS`
 *      (`packages/server/src/boot/resource-adapters.ts`) — the keys boot
 *      refuses. Belt and braces: a key put back into both sets would satisfy
 *      (1) and still be a lie.
 *
 * Both sets are parsed out of the TypeScript rather than duplicated here, so
 * adding a genuinely new config export needs no edit to this file, and deleting
 * one fails every page that still names it.
 *
 * All six locales, because a stale translation of this cell is the same
 * un-bootable edit in another language.
 *
 * Run: node tooling/scripts/docs-verify/check-config-exports.mjs
 */
import { readFileSync } from "node:fs";
import { globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");

const BUNDLE = "packages/server/src/boot/bundle.ts";
const ADAPTERS = "packages/server/src/boot/resource-adapters.ts";

const DOC_GLOBS = [
    // English lives one level up from the locales: `docs/docs/**` against
    // `docs/<locale>/docs/**`. A single `*/docs/**` glob silently covers only
    // the five translations — which is exactly how the cell this guard exists
    // for went unchecked.
    "website/src/content/docs/docs/**/*.md",
    "website/src/content/docs/docs/**/*.mdx",
    "website/src/content/docs/de/docs/**/*.md",
    "website/src/content/docs/de/docs/**/*.mdx",
    "website/src/content/docs/es/docs/**/*.md",
    "website/src/content/docs/es/docs/**/*.mdx",
    "website/src/content/docs/fr/docs/**/*.md",
    "website/src/content/docs/fr/docs/**/*.mdx",
    "website/src/content/docs/it/docs/**/*.md",
    "website/src/content/docs/it/docs/**/*.mdx",
    "website/src/content/docs/pt/docs/**/*.md",
    "website/src/content/docs/pt/docs/**/*.mdx",
    "tooling/rebase-agent-skills/**/*.md"
];

/**
 * Pages whose job is to say the old export is gone.
 *
 * An upgrade guide has to write the dead name — that is the whole point of it —
 * and so does the changelog entry that retired it.
 */
const HISTORY_PAGES = [/\/upgrading(\.mdx|\/)/, /\/CHANGELOG\.md$/];

const GREEN = "[0;32m";
const RED = "[0;31m";
const DIM = "[2m";
const NC = "[0m";

/**
 * The names between `const NAME = new Set([` and its closing `]);`.
 *
 * @param {string} source
 * @param {string} constName
 * @returns {Set<string>}
 */
function parseStringSet(source, constName) {
    const start = source.indexOf(`const ${constName} = new Set([`);
    if (start === -1) throw new Error(`${constName} is not a \`new Set([…])\` in ${BUNDLE}.`);
    const end = source.indexOf("]);", start);
    if (end === -1) throw new Error(`${constName} in ${BUNDLE} has no closing \`]);\`.`);
    const body = source.slice(start, end);
    return new Set([...body.matchAll(/"([A-Za-z_$][\w$]*)"/g)].map(m => m[1]));
}

/**
 * The top-level keys of `const NAME: Record<string, string> = { … }`.
 *
 * @param {string} source
 * @param {string} constName
 * @returns {Set<string>}
 */
function parseRecordKeys(source, constName) {
    const start = source.indexOf(`const ${constName}: Record<string, string> = {`);
    if (start === -1) {
        throw new Error(`${constName} is not a \`Record<string, string>\` literal in ${ADAPTERS}.`);
    }
    const end = source.indexOf("\n};", start);
    if (end === -1) throw new Error(`${constName} in ${ADAPTERS} has no closing \`};\`.`);
    const body = source.slice(start, end);
    return new Set([...body.matchAll(/^ {4}([A-Za-z_$][\w$]*):/gm)].map(m => m[1]));
}

/**
 * @param {string} root
 * @returns {{ findings: Array<{ file: string, line: number, name: string, message: string }>, read: string[], replaced: string[], scanned: number, cells: number }}
 */
export function checkConfigExports(root = DEFAULT_ROOT) {
    const bundle = readFileSync(path.join(root, BUNDLE), "utf8");
    const adapters = readFileSync(path.join(root, ADAPTERS), "utf8");

    const read = parseStringSet(bundle, "READ_CONFIG_EXPORTS");
    const replaced = parseRecordKeys(adapters, "REPLACED_CONFIG_KEYS");

    if (read.size === 0) throw new Error("READ_CONFIG_EXPORTS parsed empty — the guard is checking nothing.");
    if (replaced.size === 0) throw new Error("REPLACED_CONFIG_KEYS parsed empty — the guard is checking nothing.");

    const files = [...new Set(DOC_GLOBS.flatMap(g => globSync(g, { cwd: root })))].sort();
    /** @type {Array<{ file: string, line: number, name: string, message: string }>} */
    const findings = [];
    let cells = 0;

    for (const file of files) {
        if (HISTORY_PAGES.some(re => re.test(`/${file}`))) continue;
        const lines = readFileSync(path.join(root, file), "utf8").split("\n");
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            // A prose or table cell, not a code fence: the name is backticked
            // and `config/index.ts` is named on the same line.
            if (!line.includes("config/index.ts")) continue;
            for (const m of line.matchAll(/`export\s+const\s+([A-Za-z_$][\w$]*)/g)) {
                const name = m[1];
                cells += 1;
                if (replaced.has(name)) {
                    findings.push({
                        file, line: i + 1, name,
                        message:
                            `\`${name}\` is in REPLACED_CONFIG_KEYS (${ADAPTERS}): a config still ` +
                            "exporting it is refused at boot, by name. Declare the resource in " +
                            "`config/resources.ts` instead."
                    });
                } else if (!read.has(name)) {
                    findings.push({
                        file, line: i + 1, name,
                        message:
                            `\`${name}\` is not in READ_CONFIG_EXPORTS (${BUNDLE}): the managed ` +
                            "runtime reads only " +
                            [...read].filter(n => n !== "default" && n !== "__esModule")
                                .map(n => `\`${n}\``).join(", ") + " out of " +
                            "`config/index.ts`."
                    });
                }
            }
        }
    }

    // `default` and `__esModule` are module machinery, not something a page
    // would ever tell a reader to export; keep them out of the human-facing list.
    const named = [...read].filter(n => n !== "default" && n !== "__esModule");
    return { findings, read: named, replaced: [...replaced], scanned: files.length, cells };
}

// Runnable on its own, so the check can be reproduced without the whole verifier.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let result;
    try {
        result = checkConfigExports();
    } catch (error) {
        console.error(`${RED}✗ ${error.message}${NC}`);
        process.exit(2);
    }

    console.log(
        `${DIM}${result.cells} documented \`config/index.ts\` export(s) across ${result.scanned} file(s); ` +
        `the runtime reads ${result.read.join(", ")}.${NC}`
    );
    if (result.findings.length === 0) {
        console.log(`${GREEN}✓ Every documented config export is one the runtime reads.${NC}`);
        process.exit(0);
    }

    console.error(`${RED}✗ ${result.findings.length} documented export(s) the runtime does not read:${NC}\n`);
    for (const f of result.findings) {
        console.error(`  ${RED}${f.file}:${f.line}${NC}`);
        console.error(`      ${DIM}${f.message}${NC}`);
    }
    process.exit(1);
}
