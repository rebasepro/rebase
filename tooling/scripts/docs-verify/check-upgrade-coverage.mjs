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
 * `## [Unreleased]` is the exception, and it is the one that matters most. The
 * split ran on `^## \[\d+\.\d+\.\d+\]`, so the unreleased section was never
 * scanned — and the site publishes from `main`, so its breaking changes are live
 * on rebase.pro for weeks before the version that stamps them exists. The guide
 * reported "all 7 covered" while five `### Breaking` entries had no destination
 * at all. So `[Unreleased]` is a version here, its destination is
 * {@link NEXT_PAGE}, and that one page is held to a stricter rule than the
 * released hops: **one `## ` section per Breaking bullet**. A released page is
 * written once and then frozen; the unreleased one has bullets arriving under it
 * every week, and "names the version" is satisfied forever by the first section
 * anybody wrote. Counting is the cheapest thing that keeps it growing with them.
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
/** Where an `## [Unreleased]` breaking change has to land. */
const NEXT_PAGE = "website/src/content/docs/docs/upgrading/0-17-to-next.mdx";
/** The label the changelog gives the section that has no version yet. */
const UNRELEASED = "Unreleased";

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

/** How many `- **…**` bullets a `### Breaking` block holds. */
function breakingBullets(block) {
    const start = block.search(/^### Breaking\s*$/m);
    if (start === -1) return 0;
    const rest = block.slice(start).replace(/^### Breaking\s*$/m, "");
    const next = rest.search(/^### /m);
    return [...(next === -1 ? rest : rest.slice(0, next)).matchAll(/^- \*\*/gm)].length;
}

/**
 * @param {string} root
 * @returns {{ findings: {version: string, entries: number, reason?: string}[], scanned: number }}
 */
export function checkUpgradeCoverage(root = DEFAULT_ROOT) {
    const changelog = readFileSync(path.join(root, CHANGELOG), "utf8");
    const guide = [
        readFileSync(path.join(root, GUIDE), "utf8"),
        ...globSync(GUIDE_PAGES, { cwd: root }).map(f => readFileSync(path.join(root, f), "utf8"))
    ].join("\n");

    // Split the changelog into per-version blocks, then keep the ones that
    // declare a breaking change. `[Unreleased]` is one of them: its changes are
    // on the live docs site the day they merge, months before a version stamps
    // them.
    const headings = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+|Unreleased)\]/gm)];
    const breaking = [];
    for (let i = 0; i < headings.length; i++) {
        const version = headings[i][1];
        const start = headings[i].index;
        const end = i + 1 < headings.length ? headings[i + 1].index : changelog.length;
        const block = changelog.slice(start, end);
        const entries = [...block.matchAll(/^### Breaking\s*$/gm)].length;
        if (entries > 0) breaking.push({ version, entries, bullets: breakingBullets(block) });
    }

    if (breaking.length === 0) {
        throw new Error("Found no `### Breaking` sections in the changelog — the guard is checking nothing.");
    }

    /** @type {{version: string, entries: number, reason?: string}[]} */
    const findings = [];
    for (const { version, entries, bullets } of breaking) {
        if (version === UNRELEASED) {
            let page;
            try {
                page = readFileSync(path.join(root, NEXT_PAGE), "utf8");
            } catch {
                findings.push({
                    version, entries,
                    reason: `no ${NEXT_PAGE} — the breaking changes on it are live on rebase.pro now`
                });
                continue;
            }
            const sections = [...page.matchAll(/^## /gm)].length;
            if (sections !== bullets) {
                findings.push({
                    version, entries,
                    reason:
                        `${NEXT_PAGE} has ${sections} \`## \` section(s) for ${bullets} \`### Breaking\` `
                        + "bullet(s) — one section per bullet, each saying what to change"
                });
            }
            continue;
        }
        if (isOlder(parse(version), GUIDE_STARTS_AT)) continue;
        // The guide names a version if it appears anywhere in it — a heading, a
        // "Part N" line or a prose mention all count as covered.
        const [major, minor] = parse(version);
        if (!guide.includes(version) && !guide.includes(`${major}.${minor}`)) {
            findings.push({ version, entries });
        }
    }

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
    for (const { version, entries, reason } of result.findings) {
        console.error(
            `  ${RED}${version}${NC} ${DIM}— ${reason ?? `declares a \`### Breaking\` section (${entries})`}${NC}`
        );
    }
    console.error(
        `\n${DIM}Under 0.x the minor is the breaking position, so each of these is a wall\n`
        + `somebody hits on upgrade. Add a section to ${GUIDE}, or\n`
        + `mention the version if the change needs no action.${NC}`
    );
    process.exit(1);
}
