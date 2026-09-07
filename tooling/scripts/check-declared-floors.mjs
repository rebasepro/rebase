#!/usr/bin/env node
/**
 * Declared floors: what a package promises it will run on.
 *
 * Two of them, `engines.node` and the React peer range, held to one value each
 * because they decay the same way and cost the same thing when they are wrong.
 *
 * ## Node
 *
 * `engines.node` is a promise about what a package will run on, and this
 * repository was making seven different ones at the same time. Three packages
 * said `>=22.22.0`, eleven said `>=20`, seven said nothing at all, the dogfood
 * app said `>=18.0.0`, the headless overlay said `>=20`, and five translated
 * quickstarts told readers `Node.js 18+`. `.nvmrc` — the file every contributor
 * and every CI job actually installs from — said `22.22.0`.
 *
 * None of those numbers were wrong on purpose. They are what a floor decays
 * into: a package declares one when it is written and nothing revisits it, so
 * the value records the year rather than the requirement. `@rebasepro/cms` and
 * `app` were bumped to 22.22.0 when react-router 8 forced it, and the eleven
 * packages those two depend on kept promising 20 — a promise they cannot keep,
 * since installing them at the version they advertise produces a tree that
 * cannot run.
 *
 * A `>=20` that is really 22.22 is worse than no declaration. The number is
 * what tells someone on Node 20 to stop *before* an obscure syntax error
 * somewhere in a transitive dependency; understated, it lets them through and
 * moves the failure somewhere unrecognisable.
 *
 * This used to say "npm and pnpm check `engines` on install, so the number is
 * load-bearing". They do not, by default. pnpm 11 installs a project declaring
 * `>=99.0.0` silently and exits 0; so does a *dependency* declaring it. npm
 * prints `EBADENGINE` and also exits 0. So for as long as that sentence stood,
 * this gate was keeping a number in step that nothing enforced. Two things
 * enforce it now, and both read the same declaration: `bin/rebase.js` refuses
 * to run below the CLI's own floor before it imports anything, and the
 * scaffold sets `engineStrict` (`engine-strict` for npm), which turns both
 * managers' shrug into a refusal.
 *
 * So: `.nvmrc` is the source, and this gate holds everything else to it.
 *
 *   - Anything declaring `engines.node` must declare exactly `>=<.nvmrc>` —
 *     manifests, scaffold templates, the dogfood app.
 *   - Every publishable package under `packages/` must declare it. A published
 *     package that stays silent makes no promise at all, which is how seven of
 *     them ended up installable on Node 18.
 *
 * Prose is checked too: the quickstart is where a reader learns the floor, and
 * a translated copy saying `18+` is a wrong instruction in four languages.
 *
 * ## React
 *
 * The same decay, one dependency over. `@rebasepro/app` and `@rebasepro/cms`
 * were moved to `>=19.2.7` when react-router 8 made it mandatory; `ui`, `forms`,
 * `firebase`, `plugin-insights` and `cms-types` — which those two pull in —
 * stayed at `>=19.0.0`, a range whose lower half cannot satisfy the app that
 * depends on them. An installer picking 19.0.0 to satisfy `ui` produces a tree
 * that resolves cleanly and breaks at render.
 *
 * `^` rather than `>=`, and this is the part worth stating: an open-ended peer
 * range is a promise about versions that do not exist yet. `>=19.0.0` claims
 * React 20 compatibility, which nobody has tested and which for a component
 * library is exactly the claim that will be false. The caret says "19.x, at
 * least 19.2.7" — which is what is actually true.
 *
 * Run: pnpm run check:floors
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { publishablePackages } from "./publishable-packages.mjs";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const nvmrcPath = path.join(root, ".nvmrc");
if (!fs.existsSync(nvmrcPath)) {
    console.error("✗ no .nvmrc — this gate has no source of truth to compare against.");
    process.exit(1);
}
const floor = fs.readFileSync(nvmrcPath, "utf8").trim().replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(floor)) {
    console.error(`✗ .nvmrc holds ${JSON.stringify(floor)}, which is not an exact version.`);
    process.exit(1);
}
const expected = `>=${floor}`;
const major = floor.split(".")[0];

/**
 * Every manifest this repository owns.
 *
 * Templates included: a scaffold's `package.json` is a manifest the user then
 * owns, and `rebase init` writing `>=20` into it is this repo publishing a
 * stale floor by another route.
 */
function manifests(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
        const full = path.join(dir, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) manifests(full, out);
        else if (entry.name === "package.json") out.push(full);
    }
    return out;
}

const roots = ["packages", "tooling", "app", "examples", "infra", "website"]
    .map((d) => path.join(root, d))
    .filter((d) => fs.existsSync(d));

const found = [path.join(root, "package.json"), ...roots.flatMap((d) => manifests(d))];

/** The directories a release actually publishes, as repo-relative paths. */
const publishableDirs = new Set(publishablePackages(root).map((p) => p.dir));

const problems = [];

for (const file of found) {
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        continue; // a fixture with deliberately broken JSON is not this gate's business
    }
    const rel = path.relative(root, file);
    const declared = manifest.engines?.node;

    if (declared !== undefined && declared !== expected) {
        problems.push(`${rel}: engines.node is ${JSON.stringify(declared)}, expected ${JSON.stringify(expected)}`);
        continue;
    }

    // Published packages must say something. Private workspace members may stay
    // silent — nobody installs them, so they inherit the repo's floor.
    //
    // Derived from `publishablePackages()` rather than from the path, which
    // used to be `rel.startsWith("packages/")`. That exempted the one
    // publishable package outside that directory — `tooling/rebase-agent-skills`,
    // the package `check:publishable-set` exists BECAUSE it kept falling out of
    // things — so it shipped promising nothing at all.
    if (publishableDirs.has(path.dirname(rel)) && manifest.private !== true && declared === undefined) {
        problems.push(`${rel}: no engines.node — a published package that promises nothing is installable on anything`);
    }
}

/**
 * The React peer floor.
 *
 * A constant, because there is no `.nvmrc` for React: the number comes from
 * react-router 8's own requirement, which is what forced it. Move it here when
 * the floor genuinely moves, and the gate moves the eight packages with it.
 */
const REACT_FLOOR = "^19.2.7";
const REACT_PEERS = ["react", "react-dom"];

for (const file of found) {
    let manifest;
    try {
        manifest = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        continue;
    }
    const rel = path.relative(root, file);
    for (const dep of REACT_PEERS) {
        const declared = manifest.peerDependencies?.[dep];
        if (declared === undefined || declared === REACT_FLOOR) continue;
        problems.push(`${rel}: peerDependencies.${dep} is ${JSON.stringify(declared)}, expected ${JSON.stringify(REACT_FLOOR)}`);
    }
}

/**
 * The quickstart's prerequisite line, in every locale.
 *
 * The English one carried a carve-out ("a headless project needs only 20") that
 * stopped being true the moment the CLI itself moved to 22.22; the five
 * translations were three majors behind it.
 *
 * Containing the right number is not enough, and that is the half this gate
 * used to miss: the sentence with the carve-out in it contained `22.22`, so it
 * passed for months while telling `--headless` readers a second, wrong number.
 * A prerequisite line naming two Node versions cannot be right — the reader has
 * to decide which applies to them, and the scaffold they get declares one — so
 * any version number on that line other than the floor is a finding.
 */
const quickstarts = fs
    .globSync("website/src/content/docs/**/getting-started/quickstart.md", { cwd: root })
    .sort()
    .map((rel) => path.join(root, rel));

// `22.22`, not `22.22.0`: prose says "Node.js 22.22+", and demanding the patch
// there would be a gate insisting on a number no reader needs.
const prosefloor = floor.split(".").slice(0, 2).join(".");

for (const file of quickstarts) {
    const rel = path.relative(root, file);
    const line = fs
        .readFileSync(file, "utf8")
        .split("\n")
        .find((l) => /\*\*Node\.?js\*\*/i.test(l));
    if (!line) {
        problems.push(`${rel}: no **Node.js** prerequisite line — the floor is stated nowhere a reader will look`);
        continue;
    }
    if (!line.includes(prosefloor)) {
        problems.push(`${rel}: prerequisite says ${JSON.stringify(line.trim())}, expected it to name ${prosefloor}`);
        continue;
    }

    // Every version-shaped number on the line, with the floor's own spellings
    // removed first — `22.22+`, `>=22.22.0` and `22.22.0` are all the floor.
    // What is left is a second version somebody added, which is exactly how the
    // headless carve-out survived a gate that only looked for the right number.
    // A bare major counts: the carve-out that survived for months read "needs
    // only 20", and refusing to call that a version claim is precisely the
    // leniency that let it through.
    const others = [...line
        .replaceAll(`${floor}`, "")
        .replaceAll(prosefloor, "")
        .matchAll(/\b(\d+(?:\.\d+){0,2})\b/g)]
        .map((m) => m[1]);

    if (others.length > 0) {
        problems.push(
            `${rel}: prerequisite names ${others.length} other Node version(s) (${others.join(", ")}) `
            + `besides ${prosefloor} — ${JSON.stringify(line.trim())}. One floor, or the reader has `
            + "to guess which one is theirs."
        );
    }
}

if (problems.length > 0) {
    console.error("");
    console.error(`✗ ${problems.length} place(s) disagree with .nvmrc (${floor}):`);
    for (const p of problems) console.error(`    ${p}`);
    console.error("");
    console.error(`  One Node floor, from .nvmrc: set engines.node to "${expected}" (Node ${major}) everywhere,`);
    console.error("  or change .nvmrc if the floor itself is meant to move.");
    console.error(`  One React floor: peer ranges are "${REACT_FLOOR}", set in this file.`);
    console.error("");
    process.exit(1);
}

console.log(
    `✓ one Node floor (${expected}, from .nvmrc) and one React peer floor (${REACT_FLOOR}) ` +
    `across ${found.length} manifest(s) and ${quickstarts.length} quickstart(s).`
);
