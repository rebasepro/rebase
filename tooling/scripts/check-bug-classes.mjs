#!/usr/bin/env node
/**
 * `docs/bug-classes.md`'s class numbers are unique and contiguous.
 *
 * The file had two `## 50.` sections, added months apart, and one of them
 * referred to the other as "class 49" — so a document whose entire purpose is
 * to be cited by number had two entries with the same citation. Nothing said
 * so, because a heading is not code and a duplicate heading is not a broken
 * link.
 *
 * Contiguity matters for the same reason: a gap means an entry was deleted, and
 * a deleted class is one whose sweep nobody will run again. If a class is
 * genuinely obsolete, the entry stays and says why.
 *
 * `## The discipline` is the one heading that is not a class — it is the
 * procedure the classes are for — and it is named here rather than matched by a
 * pattern, so a second unnumbered section still fails and whoever adds one has
 * to say what it is.
 *
 *     pnpm check:bug-classes
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DOC = "docs/bug-classes.md";

/** Headings that are sections of the document rather than numbered classes. */
const NOT_A_CLASS = new Set(["The discipline"]);

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const doc = fs.readFileSync(path.join(ROOT, DOC), "utf8");
const problems = [];
const seen = new Map();

doc.split("\n").forEach((line, index) => {
    if (!line.startsWith("## ")) return;
    const heading = line.slice(3).trim();
    const numbered = heading.match(/^(\d+)\.\s+(.+)$/);
    if (!numbered) {
        if (!NOT_A_CLASS.has(heading)) {
            problems.push(
                `${DOC}:${index + 1} — "## ${heading}" is neither a numbered class nor one of the ` +
                `named sections (${[...NOT_A_CLASS].join(", ")}). Number it, or name it in this script.`
            );
        }
        return;
    }
    const number = Number(numbered[1]);
    if (seen.has(number)) {
        problems.push(
            `${DOC}:${index + 1} — class ${number} is used twice ` +
            `(also at line ${seen.get(number)}). The file is cited by number.`
        );
        return;
    }
    seen.set(number, index + 1);
});

const numbers = [...seen.keys()].sort((a, b) => a - b);
for (let expected = 1; expected <= numbers.length; expected += 1) {
    if (numbers[expected - 1] !== expected) {
        problems.push(
            `${DOC} — class numbers are not contiguous: expected ${expected}, found ${numbers[expected - 1]}. ` +
            "A gap means an entry was deleted, and a deleted class is a sweep nobody runs again."
        );
        break;
    }
}

if (problems.length === 0) {
    console.log(green(`✓ ${numbers.length} bug class(es) in ${DOC}, numbered 1–${numbers.length} with no gaps or repeats.`));
    process.exit(0);
}

console.error(red(`\n✗ ${problems.length} problem(s) with the bug-class numbering.\n`));
for (const problem of problems) console.error(`  ${problem}`);
console.error(dim("\n  Every sweep in this repository cites a class by its number.\n"));
process.exit(1);
