/**
 * The cloud page's surface table against the groups `rebase cloud` dispatches.
 *
 * `deployment/cloud.md` ends with a table of every command group and, right
 * under it, the sentence "Every group in that table answers `--help`". That is a
 * claim about the table being complete, and nothing checked it: the table gave
 * `resources` the description of the *dials* — text left behind when `compute`
 * was split out of it — and omitted `compute` and `clusters` entirely. So the
 * page contradicted itself four lines apart, and the paragraph promising
 * completeness was promising it about a table missing two groups.
 *
 * The check is the same shape as the rest of this directory: read the authority
 * out of the source (`CLOUD_GROUPS` in `packages/cli/src/commands/cloud/index.ts`),
 * read the copy out of the doc, and hold them to each other. Exactly once, in
 * both directions — a group with no row is undiscoverable from the page, and a
 * row for a group that no longer dispatches sends the reader to a command that
 * exits 1.
 *
 * Only the *first* column counts. Descriptions mention flags and actions in
 * backticks (`list`, `--secret`), and reading those as group names would make
 * the check pass for reasons that have nothing to do with the table.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const CLOUD_INDEX = "packages/cli/src/commands/cloud/index.ts";
const CLOUD_PAGE = "website/src/content/docs/docs/deployment/cloud.md";

/** The heading whose table is the index of the family. */
const TABLE_HEADING = "## The rest of the surface";

/** Read a workspace file, or "" when it is not there. */
function read(root, rel) {
    try {
        return readFileSync(path.join(root, rel), "utf8");
    } catch {
        return "";
    }
}

/**
 * Every word `rebase cloud` dispatches, from `CLOUD_GROUPS`.
 *
 * Read from the array literal rather than from the dispatch switch: the switch
 * carries aliases and `--help` routing, and `CLOUD_GROUPS` is the list the help
 * index itself renders — which is the thing the doc's table claims to mirror.
 */
export function cloudGroupNames(root) {
    const source = read(root, CLOUD_INDEX);
    const literal = source.match(/export const CLOUD_GROUPS: HelpAction\[\] = \[([\s\S]*?)\n\];/);
    if (!literal) return [];
    return [...literal[1].matchAll(/\{\s*action:\s*"([a-z][a-z0-9-]*)"/g)].map(m => m[1]);
}

/** The backticked words in the first column of the surface table. */
function tableGroups(page) {
    const start = page.indexOf(TABLE_HEADING);
    if (start === -1) return null;
    const body = page.slice(start);
    const words = [];
    for (const line of body.split("\n")) {
        if (!line.startsWith("|")) {
            // The table ends at the first non-row line after it has begun.
            if (words.length) break;
            continue;
        }
        const first = line.split("|")[1] ?? "";
        if (/^\s*-+\s*$/.test(first)) continue;
        for (const cell of first.matchAll(/`([a-z][a-z0-9-]*)`/g)) words.push(cell[1]);
    }
    return words;
}

export function checkCloudSurface(root) {
    const findings = [];
    const groups = cloudGroupNames(root);
    if (!groups.length) {
        findings.push({
            file: CLOUD_INDEX,
            line: 1,
            message: "could not read CLOUD_GROUPS — the surface-table check has nothing to compare against."
        });
        return { findings, scanned: 0 };
    }

    const page = read(root, CLOUD_PAGE);
    const rows = tableGroups(page);
    if (rows === null) {
        findings.push({
            file: CLOUD_PAGE,
            line: 1,
            message: `no "${TABLE_HEADING}" section — the table this page promises is complete is gone.`
        });
        return { findings, scanned: 0 };
    }

    const counts = new Map();
    for (const word of rows) counts.set(word, (counts.get(word) ?? 0) + 1);

    for (const group of groups) {
        const seen = counts.get(group) ?? 0;
        if (seen === 0) {
            findings.push({
                file: CLOUD_PAGE,
                line: 1,
                message:
                    `\`rebase cloud ${group}\` dispatches and has a --help page, but no row in ` +
                    `"${TABLE_HEADING}" — the paragraph under that table says every group is in it.`
            });
        } else if (seen > 1) {
            findings.push({
                file: CLOUD_PAGE,
                line: 1,
                message: `\`${group}\` appears in ${seen} rows of "${TABLE_HEADING}"; it should appear in one.`
            });
        }
    }

    const known = new Set(groups);
    for (const word of new Set(rows)) {
        if (!known.has(word)) {
            findings.push({
                file: CLOUD_PAGE,
                line: 1,
                message:
                    `"${TABLE_HEADING}" lists \`${word}\`, which \`rebase cloud\` does not dispatch — ` +
                    "it would exit 1 for a reader who typed it."
            });
        }
    }

    return { findings, scanned: groups.length };
}
