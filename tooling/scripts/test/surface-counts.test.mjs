/**
 * Tests for `docs-verify/check-surface-counts.mjs`: the counts of MCP tools and
 * agent skills that prose states, against what the server registers and the
 * bundle ships. "42 tools, in nine groups" and "21 skills" sat on the pages
 * that introduce both surfaces for a release after both had grown.
 *
 * Run: node --test tooling/scripts/test/surface-counts.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkSurfaceCounts, parseCount } from "../docs-verify/check-surface-counts.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { tools, groups, skills } = checkSurfaceCounts(ROOT, { files: [] });

function findingsOf(text) {
    const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "surface-counts-"));
    fs.writeFileSync(path.join(docsRoot, "page.md"), text);
    return checkSurfaceCounts(ROOT, {
        files: ["page.md"],
        docsRoot
    }).findings.map(f => f.message);
}

test("number words parse the way the docs spell them", () => {
    assert.equal(parseCount("44"), 44);
    assert.equal(parseCount("forty-four"), 44);
    assert.equal(parseCount("ten"), 10);
    assert.equal(parseCount("twenty"), 20);
    assert.equal(parseCount("forty-zero"), null);
    assert.equal(parseCount("several"), null);
});

test("the true counts pass, in digits and in words", () => {
    assert.deepEqual(findingsOf(`The server has ${tools} tools, in ${groups} groups, and the bundle ${skills} skills.\n`), []);
});

test("a stale tool count is reported", () => {
    const found = findingsOf(`A stdio server with ${tools - 2} tools.\n`);
    assert.equal(found.length, 1);
    assert.match(found[0], new RegExp(`registers ${tools} tools`));
});

test("a stale group count is reported", () => {
    const found = findingsOf(`${tools} tools, in ${groups - 1} groups.\n`);
    assert.equal(found.length, 1);
    assert.match(found[0], new RegExp(`in ${groups} groups`));
});

test("a stale skill count is reported, spelled out or not", () => {
    assert.equal(findingsOf(`Installs the ${skills - 2} skills.\n`).length, 1);
    assert.equal(findingsOf("Installs the twenty-one skills.\n").length, skills === 21 ? 0 : 1);
});

test("small numbers in passing are not claims about the whole surface", () => {
    assert.deepEqual(findingsOf("Two tools write to the database; three skills cover auth.\n"), []);
});
