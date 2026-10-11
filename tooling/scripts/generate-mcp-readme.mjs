#!/usr/bin/env node
/**
 * Write the MCP server's tool tables into `packages/mcp/README.md` and the
 * agent skill's MCP reference (`MCP_TOOL_TABLE_FILES`).
 *
 * The tables are the part of that README that goes stale by itself: adding a
 * tool to `ALL_TOOLS` is a two-line change, and updating eight markdown tables
 * plus their counts is not, so it did not happen. `check-mcp-tool-tables.mjs`
 * runs the same renderer inside `verify:docs` and fails when the file and the
 * source disagree, which makes this script the only way to fix it.
 *
 *   pnpm generate:mcp-readme
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderMcpToolTables, spliceMcpToolTables, MCP_TOOLS_BEGIN } from "./docs-verify/mcp-tools.mjs";
import { MCP_TOOL_TABLE_FILES } from "./docs-verify/check-mcp-tool-tables.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const rendered = renderMcpToolTables(ROOT);
let failed = false;

for (const file of MCP_TOOL_TABLE_FILES) {
    const target = path.join(ROOT, file);
    const current = readFileSync(target, "utf8");
    const next = spliceMcpToolTables(current, rendered);
    if (next === null) {
        console.error(`✗ ${file} has no \`${MCP_TOOLS_BEGIN}\` block to write into.`);
        failed = true;
    } else if (next === current) {
        console.log(`✓ ${file} tool tables already match ALL_TOOLS.`);
    } else {
        writeFileSync(target, next);
        console.log(`✓ Wrote ${file} tool tables from ALL_TOOLS.`);
    }
}
if (failed) process.exit(1);
