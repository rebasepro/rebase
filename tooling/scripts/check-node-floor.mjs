#!/usr/bin/env node
/**
 * One Node floor, stated once.
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
 * A `>=20` that is really 22.22 is worse than no declaration. npm and pnpm
 * check `engines` on install, so the number is load-bearing: it is what tells
 * someone on Node 20 to stop *before* an obscure syntax error somewhere in a
 * transitive dependency. Understated, it lets them through and moves the
 * failure somewhere unrecognisable.
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
 * Run: pnpm run check:node-floor
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

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
    const isPublishablePackage = rel.startsWith("packages/") && rel.split("/").length === 3;
    if (isPublishablePackage && manifest.private !== true && declared === undefined) {
        problems.push(`${rel}: no engines.node — a published package that promises nothing is installable on anything`);
    }
}

/**
 * The quickstart's prerequisite line, in every locale.
 *
 * The English one carried a carve-out ("a headless project needs only 20") that
 * stopped being true the moment the CLI itself moved to 22.22; the five
 * translations were three majors behind it.
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
    }
}

if (problems.length > 0) {
    console.error("");
    console.error(`✗ ${problems.length} place(s) disagree with .nvmrc (${floor}):`);
    for (const p of problems) console.error(`    ${p}`);
    console.error("");
    console.error(`  One floor, from .nvmrc. Set engines.node to "${expected}" (Node ${major}) everywhere, or`);
    console.error("  change .nvmrc if the floor itself is meant to move.");
    console.error("");
    process.exit(1);
}

console.log(`✓ one Node floor: ${expected}, from .nvmrc, across ${found.length} manifest(s) and ${quickstarts.length} quickstart(s).`);
