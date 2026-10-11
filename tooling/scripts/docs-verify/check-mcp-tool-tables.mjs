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
    const findings = [];
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
