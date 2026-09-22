/**
 * Tests for `check-config-paths.mjs`.
 *
 * It found configs by the name `vite.config.<ext>`, so a second config beside
 * the first — `packages/server/vite.config.functions.ts`, which builds the
 * portable functions entry point — was never loaded and its aliases never
 * checked.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isViteConfig } from "../check-config-paths.mjs";

test("a named second config is a config", () => {
    for (const name of ["vite.config.ts", "vite.config.mjs", "vite.config.functions.ts", "vite.config.lib-node.mts"]) {
        assert.ok(isViteConfig(name), name);
    }
});

test("files that merely mention vite are not", () => {
    for (const name of ["vite.config.ts.map", "vite-env.d.ts", "vite.config.d.ts", "myvite.config.ts", "vite.config.test.json"]) {
        assert.ok(!isViteConfig(name), name);
    }
});
