/**
 * Every flag `rls-check` accepts has a row in `--help` and in both option
 * tables, neither table has a row for a flag the CLI does not accept, and no
 * page tells the reader to encode a character the tool accepts unencoded.
 *
 * The same failure as the check count next door, one level down. The docs table
 * on the website listed nine options against a CLI that accepts eleven: `--role`
 * and `--html` had shipped, and nothing in the repository could notice. `--role`
 * is the worse of the two to lose — it is the flag that decides whether a scan
 * covers the role your application connects as, so an undocumented `--role` is a
 * clean report of a database nobody looked at.
 *
 * The source of truth is `parseArgs` in `packages/rls-check/src/cli.ts`: the
 * switch that decides what the CLI actually accepts. Checking the docs against
 * `--help` alone would let a flag exist that neither of them mentions.
 *
 * Rows, not mentions. A flag named in a paragraph is not a flag a reader can
 * find, and matching prose would let the table rot behind an aside.
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** British spellings that are the same flag, not another one. */
const ALIASES = new Map([
    ["--colour", "--color"],
    ["--no-colour", "--no-color"]
]);

/** Conventional, and carried as `-h` / `-v` rows rather than long-flag rows. */
const NOT_IN_TABLES = new Set(["--help", "--version"]);

/**
 * `--color` has no row of its own anywhere: it is described inside the
 * `--no-color` row, which is where a reader looking for it will be.
 */
const DESCRIBED_INSIDE_ANOTHER_ROW = new Set(["--color"]);

/**
 * A markdown option table: `| \`--flag <arg>\` | meaning |`.
 * Anchored on the row shape so a `| --- |` separator and a flag mentioned in a
 * paragraph are both ignored.
 */
const MARKDOWN_ROW = /^\|\s*`(--[a-z0-9-]+)[^`]*`\s*\|/gm;

/**
 * A help-block option row: two spaces, the flag, its argument, then a gap wide
 * enough to be the description column. Excludes the example command lines,
 * which have a single space between arguments.
 */
const HELP_ROW = /^ {2}(--[a-z0-9-]+)(?: <[a-z]+>)?\s{2,}\S/gm;

const TABLES = [
    { file: "website/src/content/docs/docs/rls-check.md", row: MARKDOWN_ROW },
    { file: "packages/rls-check/README.md", row: HELP_ROW }
];

function rowFlags(text, pattern) {
    return new Set([...text.matchAll(pattern)].map((match) => ALIASES.get(match[1]) ?? match[1]));
}

function acceptedFlags(root) {
    const source = readFileSync(path.join(root, "packages/rls-check/src/cli.ts"), "utf8");
    const parseArgs = source.slice(source.indexOf("export function parseArgs"));
    if (parseArgs.length === 0) return null;

    const found = new Set();
    for (const match of parseArgs.matchAll(/case "(--[a-z0-9-]+)":/g)) {
        found.add(ALIASES.get(match[1]) ?? match[1]);
    }

    return found.size > 0 ? found : null;
}

// ---------------------------------------------------------------------------
// The connection-string paragraph
// ---------------------------------------------------------------------------

/**
 * Every rls-check page, in every locale. The English one carries no locale
 * segment; the five translations do. A missing translation is skipped (Starlight
 * falls back to English), but the English page missing is a finding — its path
 * moving is exactly how a rule like this goes quiet.
 */
const ENGLISH_PAGE = "website/src/content/docs/docs/rls-check.md";
const CONNECTION_PAGES = [
    ENGLISH_PAGE,
    ...["de", "es", "fr", "it", "pt"].map((locale) => `website/src/content/docs/${locale}/docs/rls-check.md`)
];

/**
 * `@` and `:` are the two characters this paragraph got wrong.
 *
 * `parseConnectionString` splits the userinfo at the LAST `@` and the user at
 * the FIRST `:`, exactly as libpq does, so a password containing either
 * connects unencoded — and the tool says so by name when it refuses a string it
 * genuinely cannot split. Six pages told the reader to encode them anyway,
 * which is the kind of advice that gets followed once and then blamed for the
 * *next* failure: an already-encoded `%40` in a password field is a different
 * password.
 *
 * `/`, `?` and `#` really do have to be encoded — they end the authority
 * section — so this cannot be a rule about the word "encode". It is a rule
 * about which characters the paragraph names.
 */
const MUST_NOT_DEMAND = ["`@`", "`:`"];

/** Characters that genuinely need encoding, and must still be named. */
const MUST_DEMAND = ["`/`", "`?`", "`#`"];

/** Paragraphs, in order: blocks of consecutive non-blank lines. */
function paragraphs(text) {
    return text.split(/\n\s*\n/);
}

/**
 * The paragraph that tells the reader what to percent-encode, and the one after
 * it, which is where the exemption belongs.
 *
 * Found by the first block naming `#` next to "encod" — a substring every
 * locale keeps, either in its own verb (encode, encoding, encodez) or in the
 * loanword the Spanish, Italian and Portuguese pages carry ("percent-encoding",
 * "percent-encode"). Matching prose rather than a heading is deliberate: the
 * headings differ per locale, the characters do not.
 */
function encodingParagraphs(text) {
    const blocks = paragraphs(text);
    const index = blocks.findIndex((b) => /encod/i.test(b) && b.includes("`#`") && !b.startsWith("|"));
    return index === -1 ? null : { demand: blocks[index], exemption: blocks[index + 1] ?? "" };
}

function checkConnectionStringAdvice(root) {
    const findings = [];
    let scanned = 0;

    for (const file of CONNECTION_PAGES) {
        const full = path.join(root, file);
        if (!existsSync(full)) {
            // A locale that has not been translated yet falls back to English in
            // Starlight; it is a coverage gap, not a wrong sentence. The English
            // page is not optional.
            if (file === ENGLISH_PAGE) {
                findings.push({ file, message: "Missing — this rule has nothing to check against." });
            }
            continue;
        }
        scanned += 1;

        const found = encodingParagraphs(readFileSync(full, "utf8"));
        if (!found) {
            findings.push({
                file,
                message: "No paragraph says what to percent-encode — this rule is now blind here."
            });
            continue;
        }

        for (const char of MUST_NOT_DEMAND) {
            if (found.demand.includes(char)) {
                findings.push({
                    file,
                    message: `Tells the reader to encode ${char}, which the tool accepts unencoded ` +
                        `(the userinfo splits at the last @ and the user at the first :).`
                });
            }
        }

        for (const char of MUST_DEMAND) {
            if (!found.demand.includes(char)) {
                findings.push({
                    file,
                    message: `Does not name ${char}, which does have to be encoded — it ends the URL's authority.`
                });
            }
        }

        if (!(found.exemption.includes("`@`") && found.exemption.includes("`:`"))) {
            findings.push({
                file,
                message: "Does not go on to say that `@` and `:` need no encoding. Deleting the wrong " +
                    "advice is not the same as answering the question that produced it."
            });
        }
    }

    return { findings, scanned };
}

export function checkRlsCheckFlags(root) {
    const findings = [];
    const cli = readFileSync(path.join(root, "packages/rls-check/src/cli.ts"), "utf8");
    const accepted = acceptedFlags(root);

    if (accepted === null) {
        return {
            findings: [{
                file: "packages/rls-check/src/cli.ts",
                message: "Could not read the parseArgs switch — this gate is now blind."
            }],
            flags: [],
            scanned: 0
        };
    }

    const helpBlock = cli.slice(cli.indexOf("function helpText"), cli.indexOf("function usageText"));
    const sources = [{ file: "packages/rls-check/src/cli.ts (--help)", flags: rowFlags(helpBlock, HELP_ROW), reverse: true }];
    for (const table of TABLES) {
        sources.push({
            file: table.file,
            flags: rowFlags(readFileSync(path.join(root, table.file), "utf8"), table.row),
            reverse: true
        });
    }

    for (const source of sources) {
        const isHelp = source.file.endsWith("(--help)");
        for (const flag of accepted) {
            if (DESCRIBED_INSIDE_ANOTHER_ROW.has(flag)) continue;
            if (!isHelp && NOT_IN_TABLES.has(flag)) continue;
            // `--help` lists -h/--help and -v/--version as short-form rows.
            if (isHelp && NOT_IN_TABLES.has(flag)) continue;
            if (!source.flags.has(flag)) {
                findings.push({
                    file: source.file,
                    message: `${flag} is accepted by the CLI but has no row here.`
                });
            }
        }

        for (const flag of source.flags) {
            if (!accepted.has(flag)) {
                findings.push({
                    file: source.file,
                    message: `${flag} has a row here but the CLI does not accept it.`
                });
            }
        }
    }

    const connection = checkConnectionStringAdvice(root);
    findings.push(...connection.findings);

    return {
        findings,
        flags: [...accepted].sort(),
        scanned: sources.length,
        connectionPages: connection.scanned
    };
}
