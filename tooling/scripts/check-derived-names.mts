/**
 * The gate around `contracts/derived-names.txt`.
 *
 * `tooling/scripts/derived-names.mts` renders every identifier this framework derives and
 * writes into a database. This compares that rendering against the baseline and
 * classifies the difference, because the three kinds are not equally serious:
 *
 *   * MOVED   — an identifier disappeared and a new one appeared in its place.
 *               This is the 0.13 foreign-key rename, and it is a contract break:
 *               every database provisioned by an earlier release carries the old
 *               name, and no release can reach in and rename them all.
 *   * REMOVED — an identifier this framework used to emit, gone. Either the
 *               fixture lost a case (the gate quietly got weaker) or the schema
 *               stopped naming something it used to.
 *   * ADDED   — safe. New collections and new derivations are how the surface is
 *               meant to grow. Regenerate the baseline and commit it.
 *
 * A run that only adds still fails, so the baseline cannot drift underneath
 * anyone — but it fails with "regenerate", not with "you broke the contract".
 *
 *     pnpm check:derived-names
 *     pnpm write:derived-names                              # after an intentional change
 *
 * ## If this fails on a MOVED line
 *
 * The answer is almost never "regenerate the baseline". A derived name is frozen
 * once a release has emitted it (docs/compatibility.md, contract 6). The better
 * derivation belongs behind a naming strategy that applies to new collections
 * only. Regenerating here tells every deployed database it is wrong.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { render, BASELINE } from "./derived-names.mts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rel = (p: string): string => path.relative(ROOT, p);

/** Baseline lines, minus comments and blanks. */
const parse = (text: string): Set<string> =>
    new Set(
        text
            .split("\n")
            .map(line => line.trim())
            .filter(line => line && !line.startsWith("#"))
    );

/**
 * The identifier a line names, without its producer tag.
 *
 * `column public.products.category_id [boot,push]` → `column public.products.category_id`
 *
 * Split out so a line whose PRODUCERS changed is reported as a divergence rather
 * than as a rename of the identifier — boot and push disagreeing about a name is
 * its own defect, and a different one.
 */
const identifierOf = (line: string): string => line.replace(/\s*\[[a-z,]+\]$/, "");

if (!fs.existsSync(BASELINE)) {
    console.error(
        `No derived-names baseline at ${rel(BASELINE)}.\n` +
        "Create it with: node --import tsx tooling/scripts/derived-names.mts --write"
    );
    process.exit(2);
}

const baseline = parse(fs.readFileSync(BASELINE, "utf8"));

let current: Set<string>;
try {
    current = parse(await render());
} catch (error) {
    // A renderer that throws must not read as a clean gate. Exit 2, distinct
    // from a real finding, so CI can tell "the check did not run" from "the
    // check ran and found something".
    console.error("Could not render the derived-name surface:\n", error);
    process.exit(2);
}

if (current.size === 0) {
    console.error(
        "The renderer produced no identifiers at all.\n" +
        "That is a broken fixture, not an empty schema — failing rather than reporting a clean gate."
    );
    process.exit(2);
}

const removed = [...baseline].filter(line => !current.has(line));
const added = [...current].filter(line => !baseline.has(line));

// A rename shows up as one removal plus one addition. Pair them by the object
// they name — same kind, same table — so the report says "moved" instead of
// making a reader diff two unrelated-looking lists by eye.
const tableOf = (line: string): string => {
    const identifier = identifierOf(line);
    const parts = identifier.split(" ")[1]?.split(".") ?? [];
    return `${identifier.split(" ")[0]} ${parts.slice(0, 2).join(".")}`;
};

const moved: { from: string; to: string }[] = [];
const unmatchedRemovals = [...removed];
const unmatchedAdditions = [...added];
for (const removal of [...unmatchedRemovals]) {
    // Only pair a removal with an addition on the same table and of the same
    // kind. Anything looser invents renames out of coincidence.
    const match = unmatchedAdditions.find(addition => tableOf(addition) === tableOf(removal));
    if (!match) continue;
    moved.push({ from: identifierOf(removal), to: identifierOf(match) });
    unmatchedRemovals.splice(unmatchedRemovals.indexOf(removal), 1);
    unmatchedAdditions.splice(unmatchedAdditions.indexOf(match), 1);
}

// Producer divergence: the identifier is on both sides, only its tag moved.
const divergent = unmatchedAdditions.filter(addition =>
    [...baseline].some(line => identifierOf(line) === identifierOf(addition))
);

if (removed.length === 0 && added.length === 0) {
    console.log(`\x1b[32m✓\x1b[0m ${baseline.size} derived identifier(s) unchanged.`);
    process.exit(0);
}

const bullet = (lines: string[]): string => lines.map(l => `    ${l}`).join("\n");

console.error(`\n\x1b[1mDerived database identifiers changed\x1b[0m — ${rel(BASELINE)}\n`);

if (moved.length > 0) {
    console.error("\x1b[31m  MOVED — a contract break.\x1b[0m");
    console.error(bullet(moved.map(m => `${m.from}\n      → ${m.to}`)));
    console.error(
        "\n  Every database an earlier release provisioned carries the old name, and\n" +
        "  nothing this repo ships can rename them all. If the new derivation is\n" +
        "  genuinely better, it applies to collections created AFTER a naming-strategy\n" +
        "  bump — not retroactively. See docs/compatibility.md, contract 6.\n"
    );
}

const plainRemovals = unmatchedRemovals.filter(line => !divergent.some(d => identifierOf(d) === identifierOf(line)));
if (plainRemovals.length > 0) {
    console.error("\x1b[31m  REMOVED — this framework no longer emits these.\x1b[0m");
    console.error(bullet(plainRemovals));
    console.error(
        "\n  If the fixture lost a case, the gate just got weaker by exactly this much.\n" +
        "  If the schema stopped naming these, aged databases still have them.\n"
    );
}

if (divergent.length > 0) {
    console.error("\x1b[31m  DIVERGED — boot and `db push` disagree about who emits these.\x1b[0m");
    console.error(bullet(divergent));
    console.error(
        "\n  The two compile the same collections and must describe the same database.\n" +
        "  A project pushed once and booted later would end up with two schemas.\n"
    );
}

const plainAdditions = unmatchedAdditions.filter(line => !divergent.includes(line));
if (plainAdditions.length > 0) {
    console.error("\x1b[33m  ADDED — safe.\x1b[0m");
    console.error(bullet(plainAdditions));
}

console.error(
    "\n  If every change above is intended:\n" +
    "    pnpm write:derived-names\n"
);

process.exit(1);
