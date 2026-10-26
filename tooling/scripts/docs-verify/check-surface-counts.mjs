/**
 * How many MCP tools and agent skills the prose says there are.
 *
 * The tool tables are generated (`check-mcp-tool-tables.mjs`), but the
 * sentences around them are not, and a count in a sentence is the first thing
 * to go stale: the 2026-10-24 sweep found "42 tools, in nine groups" on five
 * pages after the server had registered 44 in ten, and "21 skills" over a bundle
 * of 23 — on the pages that introduce both surfaces, in all six languages.
 *
 * The check is deliberately scoped to the files that state these counts
 * (`COUNT_FILES`, English sources only — the locales are held to English by the
 * translation gate) and to numbers of ten or more, so "two tools" in passing is
 * not a claim about the whole surface. Both spellings are read: "44 tools" and
 * "forty-four tools".
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";
import { loadMcpTools } from "./mcp-tools.mjs";

/** The pages that state the size of the MCP server or the skills bundle. */
export const COUNT_FILES = [
    "website/src/content/docs/docs/ai/index.md",
    "website/src/content/docs/docs/ai/mcp.md",
    "website/src/content/docs/docs/ai/mcp-tool-reference.md",
    "website/src/content/docs/docs/ai/skills.md",
    "docs/compatibility.md",
    "packages/mcp/README.md",
    "tooling/rebase-agent-skills/README.md",
    "tooling/rebase-agent-skills/skills/rebase-basics/references/mcp-tools.md"
];

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const TEENS = ["ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = Object.fromEntries(
    ["twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"].map((w, i) => [w, 20 + 10 * i])
);

/** "44", "forty-four", "ten" → number; anything else → null. */
export function parseCount(word) {
    const w = word.toLowerCase();
    if (/^\d+$/.test(w)) return Number(w);
    if (UNITS.includes(w)) return UNITS.indexOf(w);
    if (TEENS.includes(w)) return 10 + TEENS.indexOf(w);
    const [tens, unit] = w.split("-");
    if (!(tens in TENS)) return null;
    if (unit === undefined) return TENS[tens];
    const u = UNITS.indexOf(unit);
    return u > 0 ? TENS[tens] + u : null;
}

const NUMBER = String.raw`(\d+|[a-z]+(?:-[a-z]+)?)`;
const TOOLS = new RegExp(String.raw`\b${NUMBER} (?:MCP )?tools\b`, "gi");
const GROUPS = new RegExp(String.raw`\b${NUMBER} tools, in ${NUMBER} groups\b`, "gi");
const SKILLS = new RegExp(String.raw`\b${NUMBER} skills\b`, "gi");

function skillCount(root) {
    const dir = path.join(root, "tooling/rebase-agent-skills/skills");
    return readdirSync(dir, { withFileTypes: true })
        .filter(d => d.isDirectory() && existsSync(path.join(dir, d.name, "SKILL.md")))
        .length;
}

/**
 * @param {string} root monorepo root: the counts are read here.
 * @param {{ files?: string[], docsRoot?: string }} [opts] `docsRoot` is where
 *   `files` are read from — the monorepo root, except in tests.
 */
export function checkSurfaceCounts(root, { files = COUNT_FILES, docsRoot = root } = {}) {
    const { groups, total } = loadMcpTools(root);
    const groupCount = groups.filter(g => g.tools.length).length;
    const skills = skillCount(root);
    const findings = [];
    let scanned = 0;

    for (const file of files) {
        let text;
        try {
            text = readFileSync(path.join(docsRoot, file), "utf8");
        } catch {
            findings.push({
                file,
                line: 0,
                message: "not found — COUNT_FILES names a file that is gone"
            });
            continue;
        }
        scanned++;
        text.split("\n").forEach((line, i) => {
            const at = {
                file,
                line: i + 1
            };
            for (const m of line.matchAll(TOOLS)) {
                const n = parseCount(m[1]);
                if (n === null || n < 10 || n === total) continue;
                findings.push({
                    ...at,
                    message: `"${m[0]}" — the MCP server registers ${total} tools (ALL_TOOLS).`
                });
            }
            for (const m of line.matchAll(GROUPS)) {
                const n = parseCount(m[2]);
                if (n === null || n === groupCount) continue;
                findings.push({
                    ...at,
                    message: `"${m[0]}" — the tools are in ${groupCount} groups.`
                });
            }
            for (const m of line.matchAll(SKILLS)) {
                const n = parseCount(m[1]);
                if (n === null || n < 10 || n === skills) continue;
                findings.push({
                    ...at,
                    message: `"${m[0]}" — tooling/rebase-agent-skills/skills/ ships ${skills} skills.`
                });
            }
        });
    }

    return {
        findings,
        scanned,
        tools: total,
        groups: groupCount,
        skills
    };
}
