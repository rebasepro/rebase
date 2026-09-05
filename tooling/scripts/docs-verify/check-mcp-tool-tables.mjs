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

const README = "packages/mcp/README.md";

export function checkMcpToolTables(root) {
    const findings = [];
    let current;
    try {
        current = readFileSync(path.join(root, README), "utf8");
    } catch {
        return { findings: [{ file: README, message: "not found" }], scanned: 0 };
    }

    const next = spliceMcpToolTables(current, renderMcpToolTables(root));
    if (next === null) {
        findings.push({
            file: README,
            message:
                `no \`${MCP_TOOLS_BEGIN}\` block — the tool tables are hand-written again. ` +
                "Restore the markers and run `pnpm generate:mcp-readme`."
        });
    } else if (next !== current) {
        findings.push({
            file: README,
            message:
                "the tool tables no longer match `ALL_TOOLS` in packages/mcp/src/index.ts. " +
                "Run `pnpm generate:mcp-readme`."
        });
    }
    return { findings, scanned: 1 };
}
