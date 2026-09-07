#!/usr/bin/env node
/**
 * The Studio docs' tool table matches the tools `RebaseStudio` registers.
 *
 * The table names each tool's slug and the drawer group it appears under, and
 * those are facts about one `useMemo` in `RebaseStudio.tsx` — not judgements.
 * They had already drifted: `cron-jobs.md` sent the reader to an **Automation**
 * section, and there has never been one; the tool is registered under
 * **Compute**. Nothing about a group name is discoverable from the docs side,
 * so the drift is invisible until somebody opens Studio and cannot find the
 * tool where the page said it would be.
 *
 * The descriptions are not checked. A one-line description is written for a
 * reader, and the docs table's wording is allowed to differ from the tooltip's.
 *
 *     pnpm check:studio-tools
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SOURCE = path.join(ROOT, "packages/studio/src/components/RebaseStudio.tsx");
const DOC = path.join(ROOT, "website/src/content/docs/docs/studio/index.md");
const EN = path.join(ROOT, "packages/app/src/locales/en.ts");
const NAVIGATION = path.join(ROOT, "packages/cms/src/hooks/navigation/utils.ts");

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/** `studio_group_database` → "Database", from the English locale. */
function groupLabels() {
    const source = fs.readFileSync(EN, "utf8");
    const labels = new Map();
    for (const m of source.matchAll(/^\s{4}(studio_group_[a-z_]+):\s*"([^"]+)",?\s*$/gm)) {
        labels.set(m[1], m[2]);
    }
    return labels;
}

/** `slug -> group label`, as `RebaseStudio` registers them. */
function registeredTools() {
    const source = fs.readFileSync(SOURCE, "utf8");
    const labels = groupLabels();
    const tools = new Map();
    // Each push is `{ slug: "x", …, group: "Group", … }` across several lines.
    for (const m of source.matchAll(/views\.push\(\{\s*slug:\s*"([a-z-]+)",([\s\S]*?)\}\);/g)) {
        const [, slug, body] = m;
        const group = body.match(/\bgroup:\s*"([^"]+)"/)?.[1]
            ?? labels.get(body.match(/\bgroup:\s*t\("([a-z_]+)"\)/)?.[1] ?? "");
        if (!group) throw new Error(`no group found for the "${slug}" tool`);
        tools.set(slug, group);
    }
    if (tools.size === 0) throw new Error("no tools parsed from RebaseStudio.tsx");
    return tools;
}

/** `slug -> group`, from the "Built-in tools" table. */
function documentedTools() {
    const doc = fs.readFileSync(DOC, "utf8");
    const tools = new Map();
    // | Tab | `slug` | Group | What it does |
    for (const m of doc.matchAll(/^\|[^|]+\|\s*`([a-z-]+)`\s*\|\s*([^|]+?)\s*\|/gm)) {
        tools.set(m[1], m[2]);
    }
    return tools;
}

/**
 * Group names the framework itself ships, from the navigation module.
 *
 * Read rather than listed, so a fourth one cannot be added without this
 * noticing. These are *identifiers* — the drawer keys its icons off them, the
 * home page orders by them, and `isBottomPinnedGroupName` compares them — so
 * they stay English in the source and only their heading is translated.
 */
function shippedGroupNames() {
    const source = fs.readFileSync(NAVIGATION, "utf8");
    const names = new Set();
    for (const m of source.matchAll(/^export const NAVIGATION_[A-Z_]+ = "([^"]+)";$/gm)) names.add(m[1]);
    for (const m of source.matchAll(/^export const NAVIGATION_BOTTOM_GROUP_NAMES = \[([^\]]+)\]/gm)) {
        for (const q of m[1].matchAll(/"([^"]+)"/g)) names.add(q[1]);
    }
    if (names.size === 0) throw new Error(`no group names parsed from ${path.relative(ROOT, NAVIGATION)}`);
    return names;
}

/** `useNavigationGroupLabel`'s key for a group name. Kept in step with it. */
function groupKey(name) {
    return `studio_group_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
}

const registered = registeredTools();
const documented = documentedTools();

const problems = [];

// The home page and the drawer both label a group through
// `useNavigationGroupLabel`, which answers a miss with the raw name — so a
// group with no key renders in English beside its translated neighbours. That
// is what `VISTAS / DATABASE / SETTINGS` was on the Spanish home page.
{
    const labels = groupLabels();
    const allGroups = new Set([...shippedGroupNames(), ...registered.values()]);
    for (const name of allGroups) {
        const key = groupKey(name);
        if (!labels.has(key)) {
            problems.push(`the "${name}" group has no \`${key}\` in en.ts, so its heading renders in English everywhere`);
        }
    }
}
for (const [slug, group] of registered) {
    if (!documented.has(slug)) problems.push(`the "${slug}" tool is registered but not in the table`);
    else if (documented.get(slug) !== group) {
        problems.push(`"${slug}" is registered under ${group}, the table says ${documented.get(slug)}`);
    }
}
for (const slug of documented.keys()) {
    // The collection editor is a Studio tool registered elsewhere; the page
    // says so in the paragraph under the table.
    if (slug === "schema") continue;
    if (!registered.has(slug)) problems.push(`the table has a "${slug}" row and nothing registers it`);
}

if (problems.length === 0) {
    console.log(green(`✓ Studio tools table: ${registered.size} tools, each under the group it registers.`));
    process.exit(0);
}

console.error(red(`\n✗ the Studio tools table disagrees with RebaseStudio.tsx:\n`));
for (const p of problems) console.error(`    ${p}`);
console.error(dim(
    `\n  ${path.relative(ROOT, DOC)} — the slug and the group are facts about\n` +
    "  the tool list, not judgements. A reader who cannot find a tool where the\n" +
    "  page put it has no way to discover where it actually is.\n"
));
process.exit(1);
