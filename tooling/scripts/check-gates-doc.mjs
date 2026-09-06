/**
 * `docs/gates.md` and `package.json` describe the same set, or this fails.
 *
 * The table exists because the gate list had become something only CI knew:
 * twenty-five YAML steps, a shell script running a different and smaller
 * handful, and `check:browser-deps` sitting in package.json wired to nothing at
 * all for months. Writing the list down fixes that exactly once. What keeps it
 * fixed is that the list cannot be edited on one side only:
 *
 *   - a gate script with no row fails, so a new gate is documented when it is
 *     added, not in the sweep six months later;
 *   - a row naming a script that no longer exists fails, so the table cannot
 *     tell a contributor to run something that is gone;
 *   - a gate whose name breaks the `check:` / `verify:` / `test:` rule fails.
 *
 * The third has three named exceptions, each carrying its reason in this file
 * rather than slipping past a regular expression — so a fourth still fails, and
 * anyone adding one has to write down why.
 *
 *     pnpm check:gates-doc
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DOC = "docs/gates.md";

/**
 * The other file that says where a gate runs.
 *
 * `docs-verify/README.md` had its own three sentences about it, and all three
 * were wrong: it named a stage of a shell script that has no docs stage, a
 * workflow file that never mentions the command, and a warn-only local run that
 * has been strict since the sweep started delegating to `pnpm ci:static`. The
 * remedy it gave — "add `--strict` to that call" — pointed at a call that does
 * not exist.
 *
 * The section is now delimited, and every backticked `pnpm`-script name inside
 * it has to be a real script that `ci:static` actually runs. Prose still drifts;
 * a sentence naming a command nobody runs no longer can.
 */
const VERIFIER_README = "tooling/scripts/docs-verify/README.md";
const VERIFIER_README_SECTION = /<!-- gates:start -->([\s\S]*?)<!-- gates:end -->/;

/**
 * Scripts that are gates but do not carry a gate prefix.
 *
 * `typecheck` predates the convention and is the single most-run command in the
 * repository; renaming it to `check:types` would rewrite it in every README,
 * every CI file and every contributor's muscle memory to gain nothing.
 *
 * `rls:check` is the one the naming rule genuinely loses to: it is printed in
 * the docs site in six locales, in docs/compatibility.md and in the audit
 * notes, and the right change for those readers is not `check:rls` — it is to
 * stop pointing them at a monorepo script and give them the published
 * `npx @rebasepro/rls-check` binary. Renaming first would leave twelve
 * translated pages naming a command that does not exist.
 *
 * Not a list to grow. Every entry is the naming rule not applying.
 */
const NAMED_EXCEPTIONS = {
    typecheck: "predates the convention; renaming it buys nothing and rewrites every reference",
    "rls:check": "printed under this name in six locales; the fix for those pages is `npx @rebasepro/rls-check`, not a rename",
    test: "the root aggregate `pnpm -r test`, which is what the `test:` prefix is derived from"
};

/** Prefixes that mark a script as a gate. */
const GATE_PREFIXES = ["check:", "verify:", "test:"];

/** Prefixes that re-record a baseline rather than checking one. */
const WRITER_PREFIXES = ["write:", "fix:"];

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const scripts = Object.keys(pkg.scripts ?? {});

const isGate = (name) =>
    Object.hasOwn(NAMED_EXCEPTIONS, name) || GATE_PREFIXES.some((p) => name.startsWith(p));

const gates = scripts.filter(isGate);

const docPath = path.join(ROOT, DOC);
if (!fs.existsSync(docPath)) {
    console.error(red(`✗ ${DOC} is missing — it is the map of every gate in this repository.`));
    process.exit(1);
}
const doc = fs.readFileSync(docPath, "utf8");

/**
 * Script names in the first column of any table row.
 *
 * Deliberately positional: a script merely *mentioned* in prose (in the
 * "Bank / fix" column, say, or in the naming section) is not a row, and must
 * not satisfy the requirement that the gate has one.
 */
const documented = new Set(
    [...doc.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)]
        .map((m) => m[1])
        // The Naming section's first column holds the prefixes themselves
        // (`check:`, `verify:`, `test:`). A script name never ends in a colon.
        .filter((name) => !name.endsWith(":"))
);

const undocumented = gates.filter((name) => !documented.has(name));
const phantom = [...documented].filter((name) => !scripts.includes(name));
const misnamed = gates.filter(
    (name) => !Object.hasOwn(NAMED_EXCEPTIONS, name) && !GATE_PREFIXES.some((p) => name.startsWith(p))
);
// A writer masquerading as a gate row: `pnpm write:api-surface` belongs in the
// last column of the gate it banks, not in the first column as a gate.
const writersAsGates = [...documented].filter((name) =>
    WRITER_PREFIXES.some((p) => name.startsWith(p))
);

/**
 * The scripts `pnpm ci:static` runs, from its own list.
 */
function ciStaticGates() {
    const source = fs.readFileSync(path.join(ROOT, "tooling/scripts/ci-static.mjs"), "utf8");
    return new Set([...source.matchAll(/^\s*run:\s*"([^"]+)"/gm)].map((m) => m[1]));
}

/** Script names the verifier README's "Where it blocks" section claims. */
const readmeProblems = [];
{
    const readmePath = path.join(ROOT, VERIFIER_README);
    if (!fs.existsSync(readmePath)) {
        readmeProblems.push(`${VERIFIER_README} is missing — it is where the docs verifier says where it runs.`);
    } else {
        const section = fs.readFileSync(readmePath, "utf8").match(VERIFIER_README_SECTION);
        if (!section) {
            readmeProblems.push(
                `${VERIFIER_README} has no <!-- gates:start --> / <!-- gates:end --> section. ` +
                "That section is what this check holds; without the markers it cannot."
            );
        } else {
            const staticGates = ciStaticGates();
            const claimed = [...section[1].matchAll(/`(?:pnpm\s+)?((?:check|verify|test):[\w:-]+)`/g)]
                .map((m) => m[1]);
            if (claimed.length === 0) {
                readmeProblems.push(
                    `${VERIFIER_README}'s "Where it blocks" names no gate at all — it is supposed to ` +
                    "say which command makes a finding fail the build."
                );
            }
            for (const name of new Set(claimed)) {
                if (!scripts.includes(name)) {
                    readmeProblems.push(`${VERIFIER_README} names \`${name}\`, which is not a script in package.json.`);
                } else if (!staticGates.has(name) && !name.endsWith(":strict")) {
                    readmeProblems.push(
                        `${VERIFIER_README} names \`${name}\` as where it blocks, and ` +
                        "tooling/scripts/ci-static.mjs does not run it."
                    );
                }
            }
            const blocking = [...new Set(claimed)].filter((n) => staticGates.has(n));
            if (blocking.length === 0) {
                readmeProblems.push(
                    `${VERIFIER_README}'s "Where it blocks" names no gate that ci:static runs, so it ` +
                    "does not say where a finding actually fails the build."
                );
            }
        }
    }
}

const problems = undocumented.length + phantom.length + misnamed.length
    + writersAsGates.length + readmeProblems.length;

if (problems === 0) {
    console.log(green(
        `✓ ${gates.length} gate(s), every one with a row in ${DOC}` +
        ` (${Object.keys(NAMED_EXCEPTIONS).length} named naming-rule exceptions),` +
        ` and ${VERIFIER_README} says where it blocks.`
    ));
    process.exit(0);
}

console.error(red("\n✗ The gate map is out of step with the repository.\n"));

if (readmeProblems.length > 0) {
    console.error(red(`  ${readmeProblems.length} stale sentence(s) about where the docs verifier runs:`));
    for (const p of readmeProblems) console.error(`    ${p}`);
    console.error(dim(
        `\n    ${VERIFIER_README}, between the gates markers. A remedy naming a command\n` +
        "    that does not exist is worse than none: the reader follows it and nothing\n" +
        "    changes.\n"
    ));
}

if (undocumented.length > 0) {
    console.error(red(`  ${undocumented.length} gate(s) with no row:`));
    for (const name of undocumented) console.error(`    ${bold(`pnpm ${name}`)}`);
    console.error(dim(
        "\n    Add a row: the script in backticks in the first column, what it\n" +
        "    protects in the second, and how to bank its baseline in the third\n" +
        "    (or — when it has none).\n"
    ));
}

if (phantom.length > 0) {
    console.error(red(`  ${phantom.length} row(s) naming a script that does not exist:`));
    for (const name of phantom) console.error(`    ${bold(name)}`);
    console.error(dim("\n    Renamed or deleted. Fix the row, or drop it.\n"));
}

if (misnamed.length > 0) {
    console.error(red(`  ${misnamed.length} gate(s) breaking the naming rule:`));
    for (const name of misnamed) console.error(`    ${bold(name)}`);
    console.error(dim(
        `\n    A gate is named \`check:\`, \`verify:\` or \`test:\`. If this one genuinely\n` +
        "    cannot be, add it to NAMED_EXCEPTIONS in this script with the reason —\n" +
        "    which is a thing you have to write down, not a regex it slips past.\n"
    ));
}

if (writersAsGates.length > 0) {
    console.error(red(`  ${writersAsGates.length} baseline writer(s) listed as a gate:`));
    for (const name of writersAsGates) console.error(`    ${bold(name)}`);
    console.error(dim(
        "\n    `write:` and `fix:` re-record a baseline; they check nothing. They\n" +
        "    belong in the last column of the gate they bank.\n"
    ));
}

process.exit(1);
