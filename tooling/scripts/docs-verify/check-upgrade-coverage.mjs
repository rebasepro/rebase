/**
 * Every release that broke something has a section in the upgrade guide.
 *
 * `upgrading.mdx` stopped at 0.14 while the shipped release was 0.17.3 — three
 * minors, one of which (0.17.0) carries a `### Breaking` block with seven
 * entries including a package rename and a bundle format change that stops an
 * old build from booting. Under 0.x the minor *is* the breaking position, so
 * every one of those is a wall somebody hits on upgrade, and the page they
 * would go to for help did not mention the version they were moving to.
 *
 * Nothing connected the two files. The CHANGELOG is written at release time and
 * the guide is written when someone remembers, which is a gap that only ever
 * widens.
 *
 * The check is deliberately coarse: it asks whether the guide *names* the
 * version, not whether what it says is any good. A guard that tried to judge
 * completeness would be wrong often enough to be ignored, and the failure mode
 * here is not a thin section — it is no section at all.
 *
 * Run: node tooling/scripts/docs-verify/check-upgrade-coverage.mjs
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");
const CHANGELOG = "CHANGELOG.md";
// The guide is a hub plus one page per hop, so "the guide" is all of them:
// reading only the hub would call a version uncovered because its section
// moved to the page for its hop.
const GUIDE = "website/src/content/docs/docs/upgrading.mdx";
const GUIDE_PAGES = "website/src/content/docs/docs/upgrading/*.mdx";

const GREEN = "[0;32m";
const RED = "[0;31m";
const DIM = "[2m";
const NC = "[0m";

/**
 * Versions released before the guide begins. It opens at 0.12 → 0.13; asking it
 * to cover the archaeology behind that would be asking for pages nobody needs.
 */
const GUIDE_STARTS_AT = [0, 13, 0];

const parse = (v) => v.split(".").map(Number);
const isOlder = (a, b) => a[0] - b[0] < 0 || (a[0] === b[0] && (a[1] - b[1] < 0 || (a[1] === b[1] && a[2] < b[2])));

/**
 * @param {string} root
 * @returns {{ findings: {version: string, entries: number}[], scanned: number }}
 */
export function checkUpgradeCoverage(root = DEFAULT_ROOT) {
    const changelog = readFileSync(path.join(root, CHANGELOG), "utf8");
    const guide = [
        readFileSync(path.join(root, GUIDE), "utf8"),
        ...globSync(GUIDE_PAGES, { cwd: root }).map(f => readFileSync(path.join(root, f), "utf8"))
    ].join("\n");

    // Split the changelog into per-version blocks, then keep the ones that
    // declare a breaking change.
    const headings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)];
    const breaking = [];
    for (let i = 0; i < headings.length; i++) {
        const version = headings[i][1];
        const start = headings[i].index;
        const end = i + 1 < headings.length ? headings[i + 1].index : changelog.length;
        const block = changelog.slice(start, end);
        const entries = [...block.matchAll(/^### Breaking\s*$/gm)].length;
        if (entries > 0) breaking.push({ version, entries });
    }

    if (breaking.length === 0) {
        throw new Error("Found no `### Breaking` sections in the changelog — the guard is checking nothing.");
    }

    const findings = breaking
        .filter(({ version }) => !isOlder(parse(version), GUIDE_STARTS_AT))
        // The guide names a version if it appears anywhere in it — a heading, a
        // "Part N" line or a prose mention all count as covered.
        .filter(({ version }) => {
            const [major, minor] = parse(version);
            return !guide.includes(version) && !guide.includes(`${major}.${minor}`);
        });

    return { findings, scanned: breaking.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let result;
    try {
        result = checkUpgradeCoverage();
    } catch (error) {
        console.error(`${RED}✗ ${error.message}${NC}`);
        process.exit(2);
    }

    if (result.findings.length === 0) {
        console.log(`${GREEN}✓ All ${result.scanned} breaking release(s) are covered by the upgrade guide.${NC}`);
        process.exit(0);
    }

    console.error(`${RED}✗ ${result.findings.length} breaking release(s) missing from the upgrade guide:${NC}\n`);
    for (const { version, entries } of result.findings) {
        console.error(`  ${RED}${version}${NC} ${DIM}— declares a \`### Breaking\` section (${entries})${NC}`);
    }
    console.error(
        `\n${DIM}Under 0.x the minor is the breaking position, so each of these is a wall\n`
        + `somebody hits on upgrade. Add a section to ${GUIDE}, or\n`
        + `mention the version if the change needs no action.${NC}`
    );
    process.exit(1);
}
