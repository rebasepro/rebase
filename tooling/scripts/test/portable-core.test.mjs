/**
 * Tests for `check-portable-core.mjs`, the ratchet on Node-only code in the
 * request path.
 *
 * Two readings let Node through:
 *
 *   - An import whose FIRST named specifier was `type` counted as type-only as
 *     a whole, so `import { type Stats, readFileSync } from "node:fs"` — a
 *     runtime import of `node:fs` — was skipped, and a relative module
 *     imported that way was never walked into.
 *   - Only a line starting at column 0 was module scope, so a `process.env`
 *     read inside a top-level object literal or call — evaluated the moment
 *     the module loads, exactly what the rule is about — was missed.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { imports, moduleScopeEnvReads } from "../check-portable-core.mjs";

const typeOnlyOf = (source) => imports(source).map(({ specifier, typeOnly }) => [specifier, typeOnly]);

test("an import that mixes type and value specifiers is a value import", () => {
    assert.deepEqual(typeOnlyOf("import { type Stats, readFileSync } from \"node:fs\";\n"), [["node:fs", false]]);
    assert.deepEqual(typeOnlyOf("import def, { type A } from \"./a\";\n"), [["./a", false]]);
    assert.deepEqual(typeOnlyOf("import {\n    type A,\n    helper\n} from \"./b\";\n"), [["./b", false]]);
});

test("an import of types only is still type-only", () => {
    assert.deepEqual(typeOnlyOf(
        "import type { A } from \"./a\";\n" +
        "import { type B, type C } from \"./b\";\n" +
        "export type { D } from \"./d\";\n"
    ), [["./a", true], ["./b", true], ["./d", true]]);
});

test("a process.env read evaluated at module load is found wherever it is indented", () => {
    const source = [
        "const config = {",                          // 1
        "    url: process.env.DATABASE_URL,",        // 2 — module scope, indented
        "};",                                         // 3
        "export const debug = Boolean(",             // 4
        "    process.env.DEBUG",                     // 5 — module scope, indented
        ");",                                         // 6
        "const top = process.env.TOP;",              // 7
        "export function read() {",                  // 8
        "    return process.env.AT_CALL_TIME;",      // 9 — inside a function: not module scope
        "}",                                          // 10
        "const lazy = () => process.env.LAZY;",      // 11 — arrow body: not module scope
        "class Box {",                                // 12
        "    method() { return process.env.M; }",    // 13 — method: not module scope
        "    static flag = process.env.STATIC;",     // 14 — static initialiser: runs at load
        "}"                                           // 15
    ].join("\n");
    assert.deepEqual(moduleScopeEnvReads(source), [2, 5, 7, 14]);
});

test("a mention in a comment or a string is not a read", () => {
    assert.deepEqual(moduleScopeEnvReads(
        "// process.env.X is read by the caller\n" +
        "const doc = \"set process.env.Y first\";\n"
    ), []);
});
