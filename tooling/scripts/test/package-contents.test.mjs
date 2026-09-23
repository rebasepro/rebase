/**
 * Tests for `check-package-contents.mjs`.
 *
 * Its test-file rule matched `x.test.ts` and `x.test.js` but not what a build
 * emits beside them — `x.test.d.ts` and the `.map` files — so a package whose
 * build compiles its co-located tests published their declarations with the
 * gate green. `@rebasepro/common` shipped `dist/util/*.test.d.ts`.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isTestPath, unbuilt } from "../check-package-contents.mjs";

test("a test's emitted declaration and source maps are test files", () => {
    for (const file of [
        "dist/util/strings.test.d.ts",
        "dist/util/strings.test.d.ts.map",
        "dist/util/strings.test.js.map",
        "dist/util/strings.test.mjs",
        "dist/components/Card.spec.jsx",
        "src/__tests__/a.ts",
        "dist/tests/helpers.js"
    ]) {
        assert.ok(isTestPath(file), file);
    }
});

test("a module merely named after testing is not a test file", () => {
    for (const file of ["dist/testing.js", "dist/test-utils.d.ts", "dist/util/latest.d.ts", "dist/contest.js.map", "README.md"]) {
        assert.ok(!isTestPath(file), file);
    }
});

test("a package that publishes dist but has none built is refused, not passed", () => {
    // Run before the build — where ci:static ran it — the tarball holds only a
    // manifest and a licence, and "no test files in it" is vacuously true.
    assert.equal(unbuilt({ files: ["dist"] }, ["package.json", "LICENSE", "README.md"]), true);
    assert.equal(unbuilt({ files: ["dist"] }, ["package.json", "LICENSE", "dist/index.js"]), false);
    assert.equal(unbuilt({ files: ["skills", "README.md"] }, ["package.json", "LICENSE", "skills/a/SKILL.md"]), false);
});
