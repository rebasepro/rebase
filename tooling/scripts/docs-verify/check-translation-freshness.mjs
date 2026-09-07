/**
 * A translated page still describes the English page it was made from.
 *
 * `website/scripts/translate_docs.mjs` used to ask one question — does the
 * target file exist — and skip if it did. So every page was translated once,
 * on the day it was written, and never again: five locales went on describing
 * the software as it had been, and nothing reported it, because a stale
 * translation is a *present* file and presence was the whole test.
 *
 * Each translated file now records `sourceHash` — the hash of the English
 * source it was generated from — and this reads it back. Three states:
 *
 *   - **stamped and matching** — fresh.
 *   - **stamped and different** — the English page changed after the
 *     translation was made. This is the finding. It is the one case where the
 *     translation is provably describing something that is no longer true, and
 *     the fix is one command.
 *   - **no stamp** — which English version it came from is unknowable. That was
 *     the whole tree for two releases: the writer shipped, the backfill never
 *     ran, and with 390 unstamped pages the finding branch above was
 *     unreachable, so the stage printed "0 fresh, 390 unstamped ✓" while
 *     `backend/Dockerfile` recipes survived in five languages.
 *     `website/scripts/backfill_source_hashes.mjs` closed it, and
 *     {@link UNSTAMPED_BUDGET} keeps it closed: an unstamped page is a finding
 *     above the budget, and the budget only ever goes down.
 *
 * A page with no translation at all is also counted rather than failed.
 * Starlight falls back to the English page per-locale, so it renders correctly
 * today — a gap in coverage, not a break, and closing it needs an API key this
 * check does not have.
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const CONTENT = "website/src/content/docs";
const LOCALES = ["es", "de", "fr", "it", "pt"];

/**
 * Mirrors EXCLUDED_DIRS / EXCLUDED_FILES in website/scripts/translate_docs.mjs:
 * `docs/ui` is regenerated wholesale by the AST generator and `docs/CHANGELOG.md`
 * is mirrored from the repo root on every build, so a translation of either is
 * stale from the next regeneration onwards.
 */
const NOT_TRANSLATED = [/^docs\/ui\//, /^docs\/CHANGELOG\.md$/];

/**
 * How many translated pages may carry no `sourceHash`.
 *
 * Zero, because `website/scripts/backfill_source_hashes.mjs` stamped all 390 of
 * them. A new translated page written by hand rather than by
 * `translate_docs.mjs` is the only way to add one, and it is a page whose
 * source version nobody can recover later — which is exactly the state that
 * made this whole check unable to fail. Run the backfill instead; never raise
 * this number.
 */
const UNSTAMPED_BUDGET = 0;

/** Same digest as the translator's `sourceHash`; keep the two in step. */
function sourceHash(content) {
    return crypto.createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

function readSourceHash(text) {
    const frontmatter = text.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) return null;
    const line = frontmatter[1].match(/^sourceHash:\s*([0-9a-f]+)\s*$/m);
    return line ? line[1] : null;
}

export function checkTranslationFreshness(root, { strict = false } = {}) {
    const sources = [
        ...globSync("docs/**/*.md", { cwd: path.join(root, CONTENT) }),
        ...globSync("docs/**/*.mdx", { cwd: path.join(root, CONTENT) })
    ]
        .filter(rel => !NOT_TRANSLATED.some(re => re.test(rel)))
        .sort();

    const findings = [];
    const missing = [];
    const unstamped = [];
    let fresh = 0;

    for (const rel of sources) {
        const english = readFileSync(path.join(root, CONTENT, rel), "utf8");
        const hash = sourceHash(english);

        for (const locale of LOCALES) {
            const file = path.join(CONTENT, locale, rel);
            if (!existsSync(path.join(root, file))) {
                missing.push(`${locale}/${rel}`);
                continue;
            }
            const stamped = readSourceHash(readFileSync(path.join(root, file), "utf8"));
            if (stamped === null) {
                unstamped.push(`${locale}/${rel}`);
                continue;
            }
            if (stamped !== hash) {
                findings.push({
                    file,
                    line: 1,
                    message:
                        `translated from ${stamped}, but ${CONTENT}/${rel} is now ${hash} — ` +
                        `re-translate it: pnpm -C website exec node scripts/translate_docs.mjs --only ${rel}`
                });
                continue;
            }
            fresh++;
        }
    }

    // Under `--strict` an unstamped page is a finding: a stamp nobody wrote is
    // a page this check cannot ever fail on, and 390 of them are how it spent
    // two releases reporting "✓".
    if (strict && unstamped.length > UNSTAMPED_BUDGET) {
        findings.push({
            file: "website/src/content/docs",
            line: 1,
            message:
                `${unstamped.length} translated page(s) carry no \`sourceHash\`, budget ` +
                `${UNSTAMPED_BUDGET} — this check cannot report drift on any of them. ` +
                "Run `node scripts/backfill_source_hashes.mjs` in website/ after replaying " +
                "the English change into the locale. The budget goes down, never up.\n      " +
                unstamped.slice(0, 8).join(", ") +
                (unstamped.length > 8 ? `, … and ${unstamped.length - 8} more` : "")
        });
    }

    return {
        findings, missing, unstamped, fresh,
        sources: sources.length, locales: LOCALES.length, budget: UNSTAMPED_BUDGET
    };
}
