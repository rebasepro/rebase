#!/usr/bin/env node
/**
 * Write the MCP server's tool tables into `packages/mcp/README.md`.
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

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const README = path.join(ROOT, "packages", "mcp", "README.md");

const current = readFileSync(README, "utf8");
const next = spliceMcpToolTables(current, renderMcpToolTables(ROOT));

if (next === null) {
    console.error(`✗ ${path.relative(ROOT, README)} has no \`${MCP_TOOLS_BEGIN}\` block to write into.`);
    process.exit(1);
}

if (next === current) {
    console.log("✓ packages/mcp/README.md tool tables already match ALL_TOOLS.");
    process.exit(0);
}

writeFileSync(README, next);
console.log("✓ Wrote packages/mcp/README.md tool tables from ALL_TOOLS.");
