/**
 * Tests for `check-undeclared-deps.mjs` (`check:deps`).
 *
 * Its value-import reader treated `import def, { type X } from "pkg"` as
 * type-only, because every NAMED binding was — and dropped the default import
 * beside them, which is a runtime require. It also never saw
 * `import x = require("pkg")`. Either shape could import an undeclared package
 * with the gate green.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { valueImports } from "../check-undeclared-deps.mjs";

const read = (source) => [...valueImports("probe.ts", source)].sort();

test("a default import beside type-only named ones is a value import", () => {
    assert.deepEqual(read("import chalk, { type ChalkInstance } from \"chalk\";\n"), ["chalk"]);
});

test("an import-equals require is a value import", () => {
    assert.deepEqual(read("import pg = require(\"pg\");\n"), ["pg"]);
});

test("type-only imports are still not", () => {
    assert.deepEqual(read(
        "import type { A } from \"a\";\n" +
        "import { type B, type C } from \"b\";\n" +
        "import type D = require(\"d\");\n" +
        "export type { E } from \"e\";\n"
    ), []);
});

test("the shapes that already counted still do", () => {
    assert.deepEqual(read(
        "import x from \"x\";\n" +
        "import { y } from \"y\";\n" +
        "import \"side-effect\";\n" +
        "export { z } from \"z\";\n" +
        "const w = await import(\"w\");\n"
    ), ["side-effect", "w", "x", "y", "z"]);
});
