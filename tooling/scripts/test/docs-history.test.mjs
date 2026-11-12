/**
 * History pages may use the names a later release removed, and only those
 * (docs-verify/history.mjs, removed-names.mjs, removed-in-0-31.json).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

import {
    compareVersions, historicalVersionOf, importIsHistorical, loadRemovedNames, nameIsHistorical
} from "../docs-verify/history.mjs";
import { REMOVED_FILE, removedBetween } from "../docs-verify/removed-names.mjs";
import { namesInDiagnostic } from "../docs-verify/typecheck-snippets.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const ts = createRequire(import.meta.url)("typescript");

function page(rel, text) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-history-"));
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
    return root;
}

test("a changelog fence documents the version of the heading above it; [Unreleased] is not history", () => {
    const root = page("CHANGELOG.md", [
        "# Changelog", "", "## [Unreleased]", "", "```ts", "new()", "```", "",
        "## [0.30.0] - 2026-11-11", "", "```ts", "old()", "```"
    ].join("\n"));
    assert.equal(historicalVersionOf(root, "CHANGELOG.md", 6), null);
    assert.equal(historicalVersionOf(root, "CHANGELOG.md", 12), "0.30.0");
});

test("an upgrade page documents the version it upgrades to; other pages are not history", () => {
    assert.equal(historicalVersionOf(ROOT, "website/src/content/docs/de/docs/upgrading/0-23-to-0-24.mdx", 1), "0.24");
    assert.equal(historicalVersionOf(ROOT, "website/src/content/docs/docs/upgrading/0-30-to-0-31.mdx", 1), "0.31");
    assert.equal(historicalVersionOf(ROOT, "website/src/content/docs/docs/schema/index.md", 1), null);
});

test("a name is legal in history only before the release that removed it, and only if listed", () => {
    const removed = [{ release: "0.31", exports: new Map([["@rebasepro/cms-types", new Set(["defineCollection"])]]), names: new Set(["defineCollection", "collection"]) }];
    const root = page("CHANGELOG.md", "## [0.31.0]\n\n```ts\nx\n```\n\n## [0.24.0]\n\n```ts\ny\n```\n");
    assert.ok(importIsHistorical(root, "CHANGELOG.md", 10, "@rebasepro/cms-types", "defineCollection", removed));
    assert.ok(!importIsHistorical(root, "CHANGELOG.md", 10, "@rebasepro/types", "defineCollection", removed), "from the package that removed it");
    assert.ok(!importIsHistorical(root, "CHANGELOG.md", 4, "@rebasepro/cms-types", "defineCollection", removed), "0.31 itself is held to today");
    assert.ok(nameIsHistorical(root, "CHANGELOG.md", 10, "collection", removed));
    assert.ok(!nameIsHistorical(root, "CHANGELOG.md", 10, "somethingInvented", removed));
});

test("compareVersions is numeric", () => {
    assert.equal(compareVersions("0.9", "0.31"), -1);
    assert.equal(compareVersions("0.31.0", "0.31"), 0);
    assert.equal(compareVersions("1.0", "0.31"), 1);
});

test("removedBetween reads exports and members out of two rendered surfaces", () => {
    const before = "## @rebasepro/types\ninterface A { x, y }\nconst gone\n## @rebasepro/server\nfunction kept\n";
    const after = "## @rebasepro/types\ninterface A { x }\n## @rebasepro/server\nfunction kept\nfunction added\n";
    assert.deepEqual(removedBetween(before, after), {
        exports: { "@rebasepro/types": ["gone"] },
        members: { "@rebasepro/types": { A: ["y"] } }
    });
});

test("the committed list names nothing the banked surface still exports, and every reviewed entry says why", () => {
    // Completeness needs the base tag (`node tooling/scripts/docs-verify/removed-names.mjs`
    // checks it locally); a shallow CI checkout can still check this direction.
    const data = JSON.parse(fs.readFileSync(REMOVED_FILE, "utf8"));
    const surface = fs.readFileSync(path.join(ROOT, "contracts/server.api.txt"), "utf8");
    const sections = new Map();
    let current = null;
    for (const line of surface.split("\n")) {
        const header = /^## (\S+)/.exec(line);
        if (header) { current = header[1]; sections.set(current, new Map()); continue; }
        if (!current || !line.trim() || line.startsWith("#")) continue;
        const m = /^(.*?)\s*(?:\{\s*(.*?)\s*\})?$/.exec(line.trim());
        sections.get(current).set(m[1].split(/\s+/).pop(), new Set((m[2] ?? "").split(",").map(s => s.trim()).filter(Boolean)));
    }
    for (const [pkg, names] of Object.entries(data.generated.exports)) {
        for (const name of names) assert.ok(!sections.get(pkg)?.has(name), `${pkg} still exports ${name}`);
    }
    for (const [pkg, types] of Object.entries(data.generated.members)) {
        for (const [type, members] of Object.entries(types)) {
            for (const member of members) assert.ok(!sections.get(pkg)?.get(type)?.has(member), `${pkg} ${type} still has ${member}`);
        }
    }
    for (const entry of data.reviewed) assert.ok(entry.reason && entry.reason.length > 40, `reviewed ${entry.name} needs a reason`);
    assert.ok(loadRemovedNames().length > 0);
});

test("a diagnostic is about the names it quotes, or the last name of a bare property chain — not a wider span", () => {
    const file = ts.createSourceFile("x.ts", "rebase.data.collection(\"x\"); f({ a: collection });", ts.ScriptTarget.Latest, true);
    const chain = { file, start: 0, length: "rebase.data.collection".length, messageText: "This expression is not callable." };
    assert.deepEqual(namesInDiagnostic(ts, chain), ["collection"]);
    const wide = { file, start: 29, length: 17, messageText: "Argument of type 'X' is not assignable." };
    assert.deepEqual(namesInDiagnostic(ts, wide), ["X"]);
});
