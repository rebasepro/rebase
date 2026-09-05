/**
 * The number of `rls-check` checks, asserted rather than remembered.
 *
 * The count is written out in prose in seven places — a hero, a CTA, a page
 * heading, a meta description, a sample terminal report, a compatibility table
 * and a docblock — and it is *rendered* from a data file in an eighth. On
 * 2026-09-04 a fifteenth check (`current-setting-throws`) had been added to the
 * package and copied into the website's data file, and none of the prose moved.
 * The result was a page whose heading said "The fourteen checks" directly above
 * a list of fifteen.
 *
 * Nobody forgot to be careful. A number in prose has no reference to the thing
 * it counts, so it cannot be wrong at the moment it is written and cannot be
 * checked afterwards except by someone counting. This is that count, once.
 *
 * Two assertions, and both matter for different reasons:
 *
 * 1. **The website's catalogue matches the package.** `src/data/rls-checks.ts`
 *    says of itself that it is copied from the tool's source "so the page and
 *    the terminal cannot describe the same check differently" — copied, with
 *    nothing holding the copy to the original.
 *
 * 2. **No prose states a different number.** Both digits and English words, in
 *    every locale, because the German page says "Vierzehn" and the count is the
 *    same fact in every language.
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

/** Number words the copy actually uses, in the four marketing locales. */
const NUMBER_WORDS = new Map([
    ["ten", 10], ["eleven", 11], ["twelve", 12], ["thirteen", 13], ["fourteen", 14],
    ["fifteen", 15], ["sixteen", 16], ["seventeen", 17], ["eighteen", 18], ["nineteen", 19], ["twenty", 20],
    ["zehn", 10], ["elf", 11], ["zwölf", 12], ["dreizehn", 13], ["vierzehn", 14],
    ["fünfzehn", 15], ["sechzehn", 16], ["siebzehn", 17], ["achtzehn", 18], ["neunzehn", 19], ["zwanzig", 20],
    ["diez", 10], ["once", 11], ["doce", 12], ["trece", 13], ["catorce", 14],
    ["quince", 15], ["dieciséis", 16], ["diecisiete", 17], ["dieciocho", 18], ["diecinueve", 19], ["veinte", 20],
    ["dix", 10], ["onze", 11], ["douze", 12], ["treize", 13], ["quatorze", 14],
    ["quinze", 15], ["seize", 16], ["dix-sept", 17], ["dix-huit", 18], ["dix-neuf", 19], ["vingt", 20]
]);

/** "checks" in the four marketing locales plus the docs' six. */
const CHECKS_WORD = "(?:checks|prüfungen|comprobaciones|contrôles|verifiche|verificações)";

function countPackageChecks(root) {
    const source = readFileSync(
        path.join(root, "packages/rls-check/src/checks/index.ts"), "utf8");
    const block = source.match(/export const CHECKS: Check\[\] = \[([\s\S]*?)\]/);
    if (!block) return null;

    return block[1].split(",").map(entry => entry.trim()).filter(Boolean).length;
}

function countWebsiteCatalogue(root) {
    const source = readFileSync(path.join(root, "website/src/data/rls-checks.ts"), "utf8");

    return [...source.matchAll(/\bid:\s*"[a-z0-9-]+"/g)].length;
}

/**
 * Files that talk about rls-check in prose.
 *
 * The CHANGELOG is excluded on purpose: "Fourteen checks" in the entry that
 * shipped the fourteenth was true when it was written, and a released changelog
 * is a record rather than a claim.
 */
function proseFiles(root) {
    return [
        ...globSync("website/src/i18n/*.ts", { cwd: root }),
        ...globSync("website/src/components/**/*.astro", { cwd: root }),
        ...globSync("website/src/data/rls-checks.ts", { cwd: root }),
        ...globSync("website/src/content/docs/**/*.md", { cwd: root }),
        // The root `docs/` is the SOURCE `copy_repo_docs.js` mirrors into the
        // website, so a stale count here is one that comes back on the next
        // mirror run. Scanning only the mirror would catch it once and then
        // watch it return.
        ...globSync("docs/**/*.md", { cwd: root }),
        ...globSync("README.md", { cwd: root }),
        ...globSync("packages/rls-check/README.md", { cwd: root })
    ].filter(rel => !/CHANGELOG/i.test(rel) && !rel.includes("/blog/") && !rel.startsWith("docs/audits/"));
}

export function checkRlsCheckCount(root) {
    const findings = [];
    const packageCount = countPackageChecks(root);
    const websiteCount = countWebsiteCatalogue(root);

    if (packageCount === null) {
        return { findings: [{ file: "packages/rls-check/src/checks/index.ts", line: 0,
            message: "Could not read the CHECKS array — this gate is now blind." }], packageCount, scanned: 0 };
    }

    if (websiteCount !== packageCount) {
        findings.push({
            file: "website/src/data/rls-checks.ts",
            line: 0,
            message: `The website catalogue lists ${websiteCount} checks; the package ships ${packageCount}. `
                + "The page renders this file, so the two must agree."
        });
    }

    const digits = new RegExp(`\\b(\\d{1,3})\\s+${CHECKS_WORD}\\b`, "gi");
    const words = new RegExp(`\\b([a-zà-ÿ-]+)\\s+${CHECKS_WORD}\\b`, "gi");
    // A sample `--json` run states the same number as a field, where no word
    // "checks" follows it — which is how `"checksRun": 14` sat in the README
    // through the fifteenth check. A pasted sample is a claim like any other.
    const jsonField = /\bchecksRun"?:\s*(\d{1,3})/g;

    let scanned = 0;
    for (const rel of proseFiles(root)) {
        const text = readFileSync(path.join(root, rel), "utf8");
        if (!/rls-check|row-level security|row level security/i.test(text)) continue;
        scanned += 1;

        const lines = text.split("\n");
        lines.forEach((line, index) => {
            for (const match of line.matchAll(digits)) {
                const stated = Number(match[1]);
                if (stated !== packageCount) {
                    findings.push({ file: rel, line: index + 1,
                        message: `States "${match[0].trim()}" — rls-check ships ${packageCount}.` });
                }
            }
            for (const match of line.matchAll(words)) {
                const stated = NUMBER_WORDS.get(match[1].toLowerCase());
                if (stated !== undefined && stated !== packageCount) {
                    findings.push({ file: rel, line: index + 1,
                        message: `States "${match[0].trim()}" — rls-check ships ${packageCount}.` });
                }
            }
            for (const match of line.matchAll(jsonField)) {
                if (Number(match[1]) !== packageCount) {
                    findings.push({ file: rel, line: index + 1,
                        message: `A sample --json run states checksRun ${match[1]} — rls-check ships ${packageCount}.` });
                }
            }
        });
    }

    return { findings, packageCount, scanned };
}
