/**
 * `packages/mcp/README.md`'s tool tables against `ALL_TOOLS`.
 *
 * The README is what a reader lands on from npm, and it is the surface with no
 * other check pointed at it: `check-api-names` reads code fences, the snippet
 * typechecker compiles TypeScript, and neither has anything to say about a
 * markdown table. It had drifted about as far as a table can — "CLI Tools (6)"
 * over eleven tools, no section at all for storage, cron or functions, and an
 * argument named `userId` that the schema has always called `uid`.
 *
 * Rendering is in `mcp-tools.mjs` so the generator and the gate cannot disagree
 * with each other, which is the way this class of check usually fails.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
    loadMcpTools,
    renderMcpToolTables,
    spliceMcpToolTables,
    MCP_TOOLS_BEGIN
} from "./mcp-tools.mjs";

/**
 * Every file that carries the generated tool tables. The skill reference is
 * the one an agent reads; hand-written, it listed 20 of 42 tools and described
 * `rebase_schema_plan` with arguments it does not take.
 */
export const MCP_TOOL_TABLE_FILES = [
    "packages/mcp/README.md",
    "tooling/rebase-agent-skills/skills/rebase-basics/references/mcp-tools.md"
];

export function checkMcpToolTables(root) {
    const findings = [...checkMcpReferencePage(root), ...checkMcpToolCounts(root)];
    const rendered = renderMcpToolTables(root);
    let scanned = 0;
    for (const file of MCP_TOOL_TABLE_FILES) {
        let current;
        try {
            current = readFileSync(path.join(root, file), "utf8");
        } catch {
            findings.push({ file, message: "not found" });
            continue;
        }
        scanned++;
        const next = spliceMcpToolTables(current, rendered);
        if (next === null) {
            findings.push({
                file,
                message:
                    `no \`${MCP_TOOLS_BEGIN}\` block — the tool tables are hand-written again. ` +
                    "Restore the markers and run `pnpm generate:mcp-readme`."
            });
        } else if (next !== current) {
            findings.push({
                file,
                message:
                    "the tool tables no longer match `ALL_TOOLS` in packages/mcp/src/index.ts. " +
                    "Run `pnpm generate:mcp-readme`."
            });
        }
    }
    return { findings, scanned };
}

/**
 * The English docs pages that describe the stdio server's tools.
 *
 * The website's reference is hand-written — it carries notes between the
 * tables that a generated block would erase — so it is held to `ALL_TOOLS` by
 * content rather than by diff: the same tools, in the same groups, with the
 * same ⚠, under headings whose counts are their row counts. It listed 42 tools
 * in nine groups while the server registered 44 in ten, and then claimed 51 over
 * 50 rows, and this stage read only the README and the skill reference.
 */
export const MCP_REFERENCE_PAGE = "website/src/content/docs/docs/ai/mcp-tool-reference.md";

/** Pages whose prose states how many tools the stdio server (or the remote `/mcp`) has. */
export const MCP_COUNT_PAGES = [
    MCP_REFERENCE_PAGE,
    "website/src/content/docs/docs/ai/mcp.md",
    "website/src/content/docs/docs/ai/index.md",
    "website/src/content/docs/docs/compatibility.md"
];

const UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

/** `"51"`, `"fifty-one"`, `"ten"` → a number; anything else → null. */
export function numberFromWords(text) {
    const t = String(text).toLowerCase();
    if (/^\d+$/.test(t)) return Number(t);
    const unit = UNITS.indexOf(t);
    if (unit !== -1) return unit;
    const m = /^([a-z]+)(?:-([a-z]+))?$/.exec(t);
    if (!m) return null;
    const tens = TENS.indexOf(m[1]);
    if (tens < 2) return null;
    if (!m[2]) return tens * 10;
    const u = UNITS.indexOf(m[2]);
    return u >= 1 && u <= 9 ? tens * 10 + u : null;
}

/** The remote `/mcp` endpoint's tool names, read out of `packages/server/src/mcp/mcp-tools.ts`. */
export function remoteMcpToolNames(root) {
    let text;
    try {
        text = readFileSync(path.join(root, "packages", "server", "src", "mcp", "mcp-tools.ts"), "utf8");
    } catch {
        return [];
    }
    const start = text.indexOf("const TOOLS: McpToolDefinition[] = [");
    const end = text.indexOf("export const MCP_TOOLS", start);
    if (start === -1 || end === -1) return [];
    return [...text.slice(start, end).matchAll(/^ {8}name: "([a-z_]+)"/gm)].map((m) => m[1]);
}

/** `## Title (N)` sections of a page, each with the tools its table rows name. */
function referenceSections(text) {
    const sections = [];
    let current = null;
    text.split("\n").forEach((line, i) => {
        const heading = /^## (.+?) \((\d+)\)\s*$/.exec(line);
        if (heading) {
            current = { title: heading[1], declared: Number(heading[2]), line: i + 1, rows: [] };
            sections.push(current);
            return;
        }
        if (/^## /.test(line)) {
            current = null;
            return;
        }
        const row = /^\| `([a-z_]+)`( ⚠)? \|/.exec(line);
        if (row && current) current.rows.push({ name: row[1], gated: Boolean(row[2]), line: i + 1 });
    });
    return sections;
}

/** The website's tool reference against `ALL_TOOLS`: groups, rows, counts and ⚠. */
export function checkMcpReferencePage(root, file = MCP_REFERENCE_PAGE) {
    const findings = [];
    let text;
    try {
        text = readFileSync(path.join(root, file), "utf8");
    } catch {
        return [{ file, message: "not found" }];
    }
    const { groups } = loadMcpTools(root);
    if (groups.length === 0) return [{ file, message: "no tools parsed out of packages/mcp/src/index.ts" }];
    const sections = referenceSections(text);
    const byTitle = new Map(sections.map((s) => [s.title, s]));

    for (const section of sections) {
        if (section.declared !== section.rows.length) {
            findings.push({
                file: `${file}:${section.line}`,
                message: `"${section.title} (${section.declared})" heads ${section.rows.length} tool row(s).`
            });
        }
        if (!groups.some((g) => g.title === section.title)) {
            findings.push({ file: `${file}:${section.line}`, message: `"${section.title}" is no group of ALL_TOOLS.` });
        }
    }
    for (const group of groups) {
        const section = byTitle.get(group.title);
        if (!section) {
            findings.push({ file, message: `no "## ${group.title} (${group.tools.length})" section — the server registers that group.` });
            continue;
        }
        const documented = new Map(section.rows.map((r) => [r.name, r]));
        for (const tool of group.tools) {
            const row = documented.get(tool.name);
            if (!row) {
                findings.push({ file: `${file}:${section.line}`, message: `\`${tool.name}\` is registered in "${group.title}" but has no row.` });
            } else if (row.gated !== tool.gated) {
                findings.push({
                    file: `${file}:${row.line}`,
                    message: tool.gated
                        ? `\`${tool.name}\` is refused against a non-local target; its row lacks ⚠.`
                        : `\`${tool.name}\` is not gated; its row carries ⚠.`
                });
            }
        }
        for (const row of section.rows) {
            if (!group.tools.some((t) => t.name === row.name)) {
                findings.push({ file: `${file}:${row.line}`, message: `\`${row.name}\` is not a "${group.title}" tool of ALL_TOOLS.` });
            }
        }
    }
    return findings;
}

/**
 * Every "N tools" / "in N groups" sentence on the MCP pages, against the
 * server's own counts.
 *
 * A count of twenty or more is the stdio server's whole surface; smaller ones
 * ("Eight tools take an app … live") describe a subset and are left alone.
 * "N data tools" and "**N tools, M scopes.**" are the remote `/mcp` endpoint.
 */
export function checkMcpToolCounts(root, files = MCP_COUNT_PAGES) {
    const findings = [];
    const { groups, total } = loadMcpTools(root);
    const remote = remoteMcpToolNames(root).length;
    for (const file of files) {
        let text;
        try {
            text = readFileSync(path.join(root, file), "utf8");
        } catch {
            findings.push({ file, message: "not found" });
            continue;
        }
        text.split("\n").forEach((line, i) => {
            const at = `${file}:${i + 1}`;
            for (const m of line.matchAll(/\b([0-9]+|[a-z]+(?:-[a-z]+)?) (data )?tools\b(, ([a-z]+) scopes)?/gi)) {
                const n = numberFromWords(m[1]);
                if (n === null) continue;
                const isRemote = Boolean(m[2]) || Boolean(m[3]);
                if (isRemote) {
                    if (remote > 0 && n !== remote) {
                        findings.push({ file: at, message: `"${m[0]}": the remote /mcp endpoint has ${remote} tools.` });
                    }
                } else if (n >= 20 && total > 0 && n !== total) {
                    findings.push({ file: at, message: `"${m[0]}": the MCP server registers ${total} tools.` });
                }
            }
            for (const m of line.matchAll(/\bin ([0-9]+|[a-z]+) groups\b/gi)) {
                const n = numberFromWords(m[1]);
                if (n !== null && groups.length > 0 && n !== groups.length) {
                    findings.push({ file: at, message: `"${m[0]}": ALL_TOOLS has ${groups.length} groups.` });
                }
            }
        });
    }
    return findings;
}
