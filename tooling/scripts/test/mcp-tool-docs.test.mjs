/**
 * Tests for the website half of `docs-verify/check-mcp-tool-tables.mjs`.
 *
 * The stage compared only the npm README and the skill reference with
 * `ALL_TOOLS`. The website's reference, which is hand-written, said 42 tools in
 * nine groups while the server registered 44 in ten, then 51 over 50 rows, and
 * `compatibility.md` still said "forty-two tools" and "six data tools". Each
 * test feeds the check a fixture tree in exactly that shape.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    checkMcpReferencePage,
    checkMcpToolCounts,
    numberFromWords,
    remoteMcpToolNames,
    MCP_REFERENCE_PAGE
} from "../docs-verify/check-mcp-tool-tables.mjs";

const INDEX = [
    "export const READ_ONLY_TOOLS = new Set<string>([\"tool_read\", \"tool_diff\"]);",
    "export const LOCAL_ONLY_TOOLS = new Set<string>([]);",
    "export const CLOUD_CONTROL_PLANE_TOOLS = new Set<string>([\"rebase_cloud_provision\"]);",
    "const CLI_TOOLS: (ToolDef & { cmd: string[] })[] = [",
    "    { name: \"tool_read\", description: \"Reads.\" },",
    "    { name: \"tool_diff\", description: \"Diffs.\" },",
    "    { name: \"tool_push\", description: \"Pushes.\" }",
    "];",
    "const CLOUD_TOOLS: ToolDef[] = [",
    "    { name: \"rebase_cloud_provision\", description: \"Provisions.\" }",
    "];",
    ""
].join("\n");

const REMOTE = [
    "const TOOLS: McpToolDefinition[] = [",
    "    {",
    "        name: \"list_collections\",",
    "    },",
    "    {",
    "        name: \"get_document\",",
    "    }",
    "];",
    "export const MCP_TOOLS = TOOLS;",
    ""
].join("\n");

const PAGE_OK = [
    "4 tools, in two groups.",
    "",
    "## Schema & database (3)",
    "",
    "| Tool | Required | Description |",
    "|---|---|---|",
    "| `tool_read` | — | Reads |",
    "| `tool_diff` | — | Diffs |",
    "| `tool_push` ⚠ | — | Pushes |",
    "",
    "## Rebase Cloud (1)",
    "",
    "| Tool | Required | Description |",
    "|---|---|---|",
    "| `rebase_cloud_provision` | — | Provisions |",
    ""
].join("\n");

function fixtureRoot(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-tool-docs-"));
    const all = {
        "packages/mcp/src/index.ts": INDEX,
        "packages/server/src/mcp/mcp-tools.ts": REMOTE,
        ...files
    };
    for (const [file, contents] of Object.entries(all)) {
        fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), contents);
    }
    return root;
}

test("number words read as numbers", () => {
    assert.equal(numberFromWords("forty-two"), 42);
    assert.equal(numberFromWords("ten"), 10);
    assert.equal(numberFromWords("51"), 51);
    assert.equal(numberFromWords("fifty"), 50);
    assert.equal(numberFromWords("the"), null);
});

test("the remote tool names are read from the server's TOOLS literal", () => {
    assert.deepEqual(remoteMcpToolNames(fixtureRoot({})), ["list_collections", "get_document"]);
});

test("a reference page that matches ALL_TOOLS has no findings", () => {
    assert.deepEqual(checkMcpReferencePage(fixtureRoot({ [MCP_REFERENCE_PAGE]: PAGE_OK })), []);
});

test("a registered tool with no row is a finding", () => {
    const page = PAGE_OK.replace("| `tool_diff` | — | Diffs |\n", "").replace("(3)", "(2)");
    const findings = checkMcpReferencePage(fixtureRoot({ [MCP_REFERENCE_PAGE]: page }));
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /tool_diff.*no row/);
});

test("a heading count that is not its row count is a finding", () => {
    const page = PAGE_OK.replace("(3)", "(12)");
    const findings = checkMcpReferencePage(fixtureRoot({ [MCP_REFERENCE_PAGE]: page }));
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /\(12\)" heads 3/);
});

test("a ⚠ on an ungated tool, or a missing one on a gated tool, is a finding", () => {
    const page = PAGE_OK
        .replace("| `rebase_cloud_provision` |", "| `rebase_cloud_provision` ⚠ |")
        .replace("| `tool_push` ⚠ |", "| `tool_push` |");
    const findings = checkMcpReferencePage(fixtureRoot({ [MCP_REFERENCE_PAGE]: page }));
    assert.equal(findings.length, 2);
});

test("a group the server registers with no section is a finding", () => {
    const page = PAGE_OK.slice(0, PAGE_OK.indexOf("## Rebase Cloud"));
    const findings = checkMcpReferencePage(fixtureRoot({ [MCP_REFERENCE_PAGE]: page }));
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /Rebase Cloud/);
});

test("stale tool and group counts in prose are findings; subset counts are not", () => {
    const root = fixtureRoot({
        "page.md": [
            "runs over stdio: forty-two tools, bearer auth.",
            "4 tools, in nine groups.",
            "OAuth 2.1, six data tools, every call under RLS.",
            "- **Eight tools, three scopes.** The same scopes.",
            "Eight tools take an app from this directory to a live backend.",
            "OAuth 2.1, two data tools.",
            "- **Two tools, three scopes.**"
        ].join("\n")
    });
    // INDEX registers 4 tools in 2 groups; REMOTE has 2. "4 tools" and
    // "Eight tools take…" are below 20, a subset, and are not judged.
    const messages = checkMcpToolCounts(root, ["page.md"]).map((f) => `${f.file} ${f.message}`);
    assert.deepEqual(messages, [
        "page.md:1 \"forty-two tools\": the MCP server registers 4 tools.",
        "page.md:2 \"in nine groups\": ALL_TOOLS has 2 groups.",
        "page.md:3 \"six data tools\": the remote /mcp endpoint has 2 tools.",
        "page.md:4 \"Eight tools, three scopes\": the remote /mcp endpoint has 2 tools."
    ]);
});

test("a whole-surface tool count of twenty or more must equal ALL_TOOLS", () => {
    const root = fixtureRoot({ "page.md": "A stdio server with 42 tools over your schema.\n" });
    const findings = checkMcpToolCounts(root, ["page.md"]);
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /registers 4 tools/);
});
