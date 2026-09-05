#!/usr/bin/env node
/**
 * Every workspace package declares a way to run its tests — once, and watching.
 *
 * `packages/firebase` is the one that does not, and the consequence is the
 * reason this gate exists rather than a lint rule: it *has* tests —
 * `test/firestore.test.ts`, five of them, importing `@jest/globals`, which is a
 * declared devDependency — and they have never executed. Not once, in any
 * pipeline. `pnpm -r test` walks the packages that define the script, so a
 * package without one is not reported as skipped; it is not reported at all.
 *
 * That is the whole failure: 28 source files shipped to npm at 0.13.0 with a
 * test directory that looks like coverage and is not.
 *
 * ## Why an allow-list rather than a fix
 *
 * Wiring a runner into `firebase` needs a new devDependency, which needs a
 * lockfile entry, which cannot be verified from a worktree — `pnpm install`
 * there rewrites the primary checkout's `node_modules`. An unverifiable fix to
 * a package is worse than a recorded gap, so the gap is recorded. Removing the
 * entry below is what "fix it" looks like, and the gate then keeps it fixed.
 *
 * The list is exact: a package that gains a test script fails until it is taken
 * off, so the file cannot quietly describe a repository that has moved on.
 *
 * ## And `test:watch`
 *
 * The same argument one step further. CONTRIBUTING now tells people to iterate
 * with `pnpm --filter @rebasepro/<pkg> test:watch`, and that sentence was false
 * for all twenty-one packages when it was written: not one declared the script,
 * so the documented loop was "run the whole suite again". An instruction nothing
 * checks is one that stops being true, so the gate checks it.
 *
 *     pnpm check:test-scripts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACKAGES = path.join(ROOT, "packages");

/**
 * Packages knowingly without a test script, and why.
 *
 * Not a place to add things. Every entry is tests that cannot run.
 */
const KNOWN_WITHOUT_TESTS = {
    firebase:
        "has test/firestore.test.ts (5 tests, written against @jest/globals) and no runner to execute " +
        "them. Needs `vitest` or `jest`+`ts-jest` as a devDependency, which needs a lockfile update."
};

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const missing = [];
const missingWatch = [];
const fixed = [];

for (const entry of fs.readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(PACKAGES, entry.name, "package.json");
    if (!fs.existsSync(manifest)) continue;

    const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
    const hasScript = Boolean(pkg.scripts?.test);
    const excused = Object.prototype.hasOwnProperty.call(KNOWN_WITHOUT_TESTS, entry.name);

    if (!hasScript && !excused) missing.push(entry.name);
    if (hasScript && excused) fixed.push(entry.name);
    // A package with no runner cannot have a watching one either; that gap is
    // already recorded above, so do not report it twice.
    if (hasScript && !pkg.scripts["test:watch"]) missingWatch.push(entry.name);
}

if (missing.length === 0 && missingWatch.length === 0 && fixed.length === 0) {
    const excused = Object.keys(KNOWN_WITHOUT_TESTS).length;
    console.log(green(
        `✓ every package declares \`test\` and \`test:watch\`${excused > 0 ? `, apart from ${excused} recorded` : ""}.`
    ));
    process.exit(0);
}

if (missing.length > 0) {
    console.error(red(`\n✗ ${missing.length} package(s) declare no \`test\` script.\n`));
    for (const name of missing) console.error(`  ${bold(`packages/${name}`)}`);
    console.error(dim(
        "\n  `pnpm -r test` walks the packages that define the script, so this does not\n" +
        "  show up as a skipped suite — it does not show up at all. If the package has\n" +
        "  test files, they have never run.\n"
    ));
}

if (missingWatch.length > 0) {
    console.error(red(`\n✗ ${missingWatch.length} package(s) declare no \`test:watch\` script.\n`));
    for (const name of missingWatch) console.error(`  ${bold(`packages/${name}`)}`);
    console.error(dim(
        "\n  CONTRIBUTING tells contributors to iterate with `test:watch`. Add it beside\n" +
        "  `test`: `vitest` for a vitest package (watching is its default, `run` is what\n" +
        "  turns it off), `jest --watch` for a jest one — without `--forceExit`, which\n" +
        "  kills the process the watcher exists to keep alive.\n"
    ));
}

if (fixed.length > 0) {
    console.error(green(`\n✓ ${fixed.join(", ")} can run tests now — nice.`));
    console.error(dim("\n  Remove it from KNOWN_WITHOUT_TESTS in this script so the gate keeps it that way.\n"));
}

process.exit(1);
