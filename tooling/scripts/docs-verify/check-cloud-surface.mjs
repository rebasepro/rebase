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
const ACTION_HELP_SOURCE = "packages/cli/src/commands/cloud/action-help.ts";
const CLOUD_PAGE = "website/src/content/docs/docs/deployment/cloud.md";
const CLI_PAGE = "website/src/content/docs/docs/cli/index.md";

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

    findings.push(...checkDocumentedInvocations(root, new Set(groups)));

    return { findings, scanned: groups.length };
}

/* ══════════════════════════════════════════════════════════════════
   The commands the docs tell a reader to type
   ══════════════════════════════════════════════════════════════════ */

/**
 * Each `ACTION_HELP` page's command and usage line, read from the source.
 *
 * Regex rather than an import, like everything else in this directory: these
 * scripts run on plain Node against a repository that may not be built.
 */
function actionHelpPages(root) {
    const source = read(root, ACTION_HELP_SOURCE);
    const pages = [];
    // `command: "cloud db backup",` … `usage: "cloud db backup <list|…> …",`
    for (const match of source.matchAll(/command:\s*"(cloud [^"]+)",\s*\n\s*usage:\s*"([^"]*)"/g)) {
        pages.push({ command: match[1],
usage: match[2] });
    }
    return pages;
}

/**
 * The alternatives a usage line puts immediately after its command words.
 *
 * Only the first token: a group later on the line is a flag's value
 * (`db create --type <managed|byodb>`), and refusing an unknown one of those is
 * the parser's job, not the dispatcher's. `[]` when there is no such group, or
 * when it holds a single word.
 */
function actionAlternatives(page) {
    const rest = page.usage.startsWith(page.command) ? page.usage.slice(page.command.length).trim() : "";
    const group = /^[[<]([a-z][a-z0-9|-]*)[\]>]/.exec(rest);
    if (!group) return [];
    const words = group[1].split("|");
    return words.length > 1 ? words : [];
}

/** A token that stands for a value rather than naming a command. */
function isPlaceholder(token) {
    return token.startsWith("-") || /[<>[\]…|]/.test(token) || token.includes("=");
}

/**
 * Every `rebase cloud …` line a page tells a reader to type, expanded.
 *
 * The docs write alternatives as `rebase cloud env list | set | unset`, with
 * spaces around the pipe — so a part after the first replaces the LAST word of
 * the first. Bracketed alternations (`[health|logs|…]`) have no spaces and are
 * left alone, because they are one token standing for a value.
 */
function cloudInvocations(text) {
    const lines = [];
    for (const raw of text.split("\n")) {
        const withoutComment = raw.split("#")[0];
        if (!/(^|[`\s])rebase cloud\b/.test(withoutComment)) continue;
        const start = withoutComment.indexOf("rebase cloud");
        const command = withoutComment.slice(start).replace(/`.*$/, "").trim();
        if (!command) continue;

        const parts = command.split(" | ").map(p => p.trim()).filter(Boolean);
        const base = parts[0].split(/\s+/).slice(2); // drop "rebase cloud"
        if (!base.length) continue;
        lines.push({ raw: parts[0],
words: base });
        for (const alternative of parts.slice(1)) {
            const words = base.slice(0, -1).concat(alternative.split(/\s+/));
            lines.push({ raw: `rebase cloud ${words.join(" ")}`,
words });
        }
    }
    return lines;
}

/**
 * The English pages that teach the cloud family, held to what it dispatches.
 *
 * `check-doc-commands.mjs` already refuses a `rebase cloud <word>` that is not a
 * subcommand, but it derives its list from every `case "x":` in the family's
 * dispatch — which unions the words of unrelated switches, so `releases`,
 * `database` and `info` all pass as groups. This is the strict form: the group
 * against `CLOUD_GROUPS`, which is the list `cloud --help` prints, and the word
 * after it against the action list on that command's own `--help` page.
 *
 * English only. The translated copies are generated from these and inherit
 * whatever they say; the freshness stage is what holds those, and scanning a
 * stale translation here would report the same sentence twice under a heading
 * that cannot fix it.
 */
function checkDocumentedInvocations(root, groups) {
    const findings = [];
    const pages = actionHelpPages(root);

    for (const file of [CLI_PAGE, CLOUD_PAGE]) {
        const text = read(root, file);
        for (const { raw, words } of cloudInvocations(text)) {
            const group = words[0];
            if (isPlaceholder(group)) continue;
            if (!groups.has(group)) {
                findings.push({
                    file,
                    line: 1,
                    message:
                        `\`${raw}\` — \`${group}\` is not one of the groups \`rebase cloud\` dispatches, ` +
                        "so it exits 1 for a reader who typed it."
                });
                continue;
            }

            // The most specific page whose command words this line starts with:
            // `db backup restore` is governed by "cloud db backup", not by the
            // `db` group page.
            let best = null;
            for (const page of pages) {
                const pageWords = page.command.split(" ").slice(1);
                if (pageWords.length > words.length) continue;
                if (!pageWords.every((word, i) => word === words[i])) continue;
                if (!best || pageWords.length > best.command.split(" ").length - 1) best = page;
            }
            if (!best) continue;

            const alternatives = actionAlternatives(best);
            if (!alternatives.length) continue;

            const next = words[best.command.split(" ").length - 1];
            if (next === undefined || isPlaceholder(next)) continue;
            if (!alternatives.includes(next)) {
                findings.push({
                    file,
                    line: 1,
                    message:
                        `\`${raw}\` — \`${best.command} --help\` lists ` +
                        `${alternatives.map(a => `\`${a}\``).join(", ")}, and \`${next}\` is not one of them.`
                });
            }
        }
    }

    return findings;
}
