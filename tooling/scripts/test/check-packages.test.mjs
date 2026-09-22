/**
 * Tests for section 2 of `check-packages.sh` — "Missing @rebasepro/* deps".
 *
 * The section grepped for `from "@rebasepro/[a-zA-Z0-9_-]+"` with a basic
 * regex, where `+` is a literal character. It matched nothing, ever, so the
 * section reported "All @rebasepro/* imports have matching package.json
 * entries" over any tree at all.
 *
 * The script builds and packs packages in its later sections, so the test
 * runs section 2 alone: the helpers at the top of the script, then the
 * section's own lines, sliced out of the real file rather than copied here.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "check-packages.sh");

function runSection2(packagesDir) {
    const source = fs.readFileSync(SCRIPT, "utf8");
    const helpersEnd = source.indexOf("PACKAGES_DIR=");
    const start = source.indexOf("section \"2. ");
    const end = source.indexOf("section \"3. ");
    assert.ok(helpersEnd > 0 && start > 0 && end > start, "check-packages.sh no longer has the shape this test slices");
    const script =
        source.slice(0, helpersEnd) +
        `PACKAGES_DIR=${JSON.stringify(packagesDir)}\n` +
        source.slice(start, end) +
        "exit \"$(error_count)\"\n";
    return spawnSync("bash", ["-c", script], { encoding: "utf8" });
}

function fixture(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "check-packages-"));
    for (const [file, contents] of Object.entries(files)) {
        fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), contents);
    }
    return root;
}

test("an import of an undeclared @rebasepro package is reported", () => {
    const run = runSection2(fixture({
        "widget/package.json": JSON.stringify({ name: "@rebasepro/widget", dependencies: { "@rebasepro/types": "workspace:*" } }),
        "widget/src/index.ts":
            "import { EntityCollection } from \"@rebasepro/types\";\n" +
            "import { createRebaseClient } from \"@rebasepro/client\";\n"
    }));
    assert.equal(run.status, 1, run.stdout + run.stderr);
    assert.match(run.stdout, /widget imports @rebasepro\/client but it's NOT in package.json/);
    assert.doesNotMatch(run.stdout, /@rebasepro\/types but/);
});

test("declared imports and self-imports pass", () => {
    const run = runSection2(fixture({
        "widget/package.json": JSON.stringify({ name: "@rebasepro/widget", dependencies: { "@rebasepro/types": "workspace:*" } }),
        "widget/src/index.ts":
            "import { EntityCollection } from \"@rebasepro/types\";\n" +
            "export { thing } from \"@rebasepro/widget\";\n"
    }));
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /All @rebasepro\/\* imports have matching package.json entries/);
});
