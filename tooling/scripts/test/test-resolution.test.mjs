/**
 * check:test-resolution — the pieces that decide whether a test runner config
 * reads a workspace dependency from its source or from its dist.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { jestMapping, runnersOf, unmapped, vitestMapping } from "../check-test-resolution.mjs";

const PKG = path.join(path.sep, "repo", "packages", "cli");
const TYPES_SRC = path.join(path.sep, "repo", "packages", "types", "src");
const DEPS = [["@rebasepro/types", TYPES_SRC]];

test("a jest mapper onto the dependency's src passes", () => {
    const mapping = jestMapping({ "^@rebasepro/([a-z0-9-]+)$": "<rootDir>/../$1/src/index.ts" }, PKG);
    assert.deepEqual(unmapped(DEPS, mapping), []);
});

test("a jest config with no mapper leaves the dependency on dist", () => {
    assert.deepEqual(unmapped(DEPS, jestMapping(undefined, PKG)), ["@rebasepro/types"]);
});

test("a mapper onto the dependency's dist is caught, not just a missing one", () => {
    const mapping = jestMapping({ "^@rebasepro/types$": "<rootDir>/../types/dist/index.js" }, PKG);
    assert.deepEqual(unmapped(DEPS, mapping), ["@rebasepro/types"]);
});

test("a mapper onto a mock in the testing package's own tree is a choice, and passes", () => {
    const mapping = jestMapping({ "^@rebasepro/types$": "<rootDir>/test/__mocks__/types.js" }, PKG);
    assert.deepEqual(unmapped(DEPS, mapping), []);
});

test("a vitest regex alias onto src passes; no alias does not", () => {
    const good = vitestMapping([{ find: /^@rebasepro\/types$/, replacement: path.join(TYPES_SRC, "index.ts") }], PKG);
    assert.deepEqual(unmapped(DEPS, good), []);
    assert.deepEqual(unmapped(DEPS, vitestMapping(undefined, PKG)), ["@rebasepro/types"]);
});

test("every test script's runner is found, with its explicit or default config", () => {
    const runners = runnersOf({
        scripts: {
            test: "vitest run",
            "test:e2e": "vitest run -c vitest.e2e.config.ts",
            "test:watch": "vitest",
            build: "vitest run -c ignored.ts"
        }
    }, PKG);
    assert.deepEqual(runners.map((r) => r.config && path.basename(r.config)).sort(), [null, "vitest.e2e.config.ts"].sort());
});
