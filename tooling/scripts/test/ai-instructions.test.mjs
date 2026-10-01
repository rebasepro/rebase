/**
 * Tests for the MCP block `docs-verify/check-ai-instructions.mjs` holds the
 * scaffold's `.mcp.json` to.
 *
 * The scaffold starts the project's own `@rebasepro/mcp` — a devDependency
 * pinned with the CLI — by its binary, `pnpm exec rebase-mcp` (or
 * `npx --no rebase-mcp` in an npm project). The check only knew the package
 * name, so it reported the correct block as "does not run @rebasepro/mcp". It
 * must still refuse a runner that can fetch `rebase-mcp` from npm, where the
 * name belongs to somebody else.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkAiInstructions, mcpLaunchKind } from "../docs-verify/check-ai-instructions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const BINS = ["rebase-mcp"];

test("pnpm exec runs the project's own binary", () => {
    assert.equal(mcpLaunchKind({ command: "pnpm", args: ["exec", "rebase-mcp"] }, BINS), "bin");
    assert.equal(
        mcpLaunchKind({ command: "pnpm", args: ["--dir", "/abs/project", "exec", "rebase-mcp"] }, BINS),
        "bin"
    );
});

test("npx --no and npx --no-install run the project's own binary", () => {
    assert.equal(mcpLaunchKind({ command: "npx", args: ["--no", "rebase-mcp"] }, BINS), "bin");
    assert.equal(mcpLaunchKind({ command: "npx", args: ["--no-install", "rebase-mcp"] }, BINS), "bin");
});

test("a runner that can fetch the binary's name from npm is refused", () => {
    assert.equal(mcpLaunchKind({ command: "npx", args: ["rebase-mcp"] }, BINS), null);
    assert.equal(mcpLaunchKind({ command: "npx", args: ["-y", "rebase-mcp"] }, BINS), null);
    assert.equal(mcpLaunchKind({ command: "npm", args: ["i", "rebase-mcp"] }, BINS), null);
    assert.equal(mcpLaunchKind({ command: "pnpm", args: ["dlx", "rebase-mcp"] }, BINS), null);
});

test("the package name is still accepted, and anything else is not", () => {
    assert.equal(mcpLaunchKind({ command: "npx", args: ["-y", "@rebasepro/mcp"] }, BINS), "package");
    assert.equal(mcpLaunchKind({ command: "pnpm", args: ["exec", "some-other-bin"] }, BINS), null);
    assert.equal(mcpLaunchKind(undefined, BINS), null);
});

test("the scaffold's MCP block passes, and declares the package it starts", () => {
    const findings = checkAiInstructions(ROOT).findings
        .filter(f => f.file.endsWith("/.mcp.json") || f.file.endsWith("/package.json"));
    assert.deepEqual(findings, []);
});
