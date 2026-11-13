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

test("code a package writes is not code it imports: emitted strings and __fixtures__ are not read", () => {
    const run = runSection2(fixture({
        "cli/package.json": JSON.stringify({ name: "@rebasepro/cli", dependencies: { "@rebasepro/types": "workspace:*" } }),
        "cli/src/codemod.ts":
            "import { EntityCollection } from \"@rebasepro/types\";\n" +
            "const header = `import { customizeTable } from \"@rebasepro/cms\";`;\n" +
            "edits.push({ text: `import { defineFirestoreCollection } from \"@rebasepro/firebase\";\\n` });\n",
        "cli/src/__fixtures__/blog/App.tsx.txt": "import { Rebase } from \"@rebasepro/app\";\n",
        "cli/src/__fixtures__/blog/App.tsx": "import { Rebase } from \"@rebasepro/app\";\n"
    }));
    assert.equal(run.status, 0, run.stdout + run.stderr);
    assert.match(run.stdout, /All @rebasepro\/\* imports have matching package.json entries/);
});

test("a multi-line import and an export-from are statements, and are read", () => {
    const run = runSection2(fixture({
        "widget/package.json": JSON.stringify({ name: "@rebasepro/widget", dependencies: {} }),
        "widget/src/index.ts":
            "import {\n    a,\n    b\n} from \"@rebasepro/common\";\n" +
            "export type { C } from \"@rebasepro/cms-types\";\n"
    }));
    assert.equal(run.status, 2, run.stdout + run.stderr);
    assert.match(run.stdout, /widget imports @rebasepro\/common but it's NOT in package.json/);
    assert.match(run.stdout, /widget imports @rebasepro\/cms-types but it's NOT in package.json/);
});

test("section 5 reads identifiers, not words: a CJS global in a string is not a reference", async () => {
    const { cjsGlobalReferences } = await import("../esm-cjs-globals.mjs");
    assert.deepEqual(cjsGlobalReferences("a.js",
        "const w = vm.runInThisContext(`(function (exports, require, module, __filename, __dirname) {x})`);\n" +
        "const s = \"__dirname\"; const o = { __filename: 1 }; o.__dirname; // __dirname\n" +
        "const r = /__dirname/;\n"
    ), []);
    assert.deepEqual(cjsGlobalReferences("b.js", "const p = path.join(__dirname, \"x\"); const f = { __filename };\n"), ["__dirname", "__filename"]);
});
