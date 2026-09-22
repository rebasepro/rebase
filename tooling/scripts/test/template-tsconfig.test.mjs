/**
 * Tests for `template-tsconfig.mjs`, the tsconfig reading behind
 * `check-templates.mjs`.
 *
 * The moduleResolution rule stripped comments with a regex that took the `/**`
 * inside a `//` comment (`../config/**`) as a block-comment opener. The shipped
 * `backend/tsconfig.json` has exactly that comment, so it never parsed, the
 * rule's `catch { continue }` skipped it, and a regression to `"node"` in the
 * one file the rule exists for would have passed.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkResolutionMatchesShipped } from "../template-tsconfig.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function tsconfig(contents) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "template-tsconfig-"));
    const file = path.join(dir, "tsconfig.json");
    fs.writeFileSync(file, contents);
    return file;
}

const check = (file) => checkResolutionMatchesShipped({ expected: "bundler", tsconfigs: [file], repoRoot: ROOT });

test("a regressed moduleResolution behind a comment that mentions a glob is reported", () => {
    const file = tsconfig(
        "{\n" +
        "  \"compilerOptions\": {\n" +
        "    \"moduleResolution\": \"node\",\n" +
        "    // The program includes `../config/**`, so the root is the project.\n" +
        "    \"rootDir\": \"..\"\n" +
        "  },\n" +
        "  \"include\": [\"src/**/*\", \"../config/**/*\"]\n" +
        "}\n"
    );
    const problems = check(file);
    assert.equal(problems.length, 1, `expected the regression to be reported, got ${JSON.stringify(problems)}`);
    assert.match(problems[0], /sets moduleResolution: "node"/);
});

test("a tsconfig that does not parse is a problem, not a skip", () => {
    const problems = check(tsconfig("{ \"compilerOptions\": { \"moduleResolution\": \"bundler\" \n"));
    assert.equal(problems.length, 1);
    assert.match(problems[0], /could not be parsed/);
});

test("the shipped backend tsconfig parses and resolves the way the gate compiles", () => {
    const file = path.join(ROOT, "packages/cli/templates/template/backend/tsconfig.json");
    assert.deepEqual(check(file), []);
    // And it really is read: the same file with the setting changed fails.
    const regressed = tsconfig(fs.readFileSync(file, "utf8").replace("\"moduleResolution\": \"bundler\"", "\"moduleResolution\": \"node\""));
    assert.equal(check(regressed).length, 1);
});
