/**
 * Tests for `check:tsconfig-entries`.
 *
 * The bug it exists for: `e2e/` moved under `tests/`, the commit updated the
 * tsconfig's `exclude` and not its `include`, and tsc — which accepts an include
 * matching nothing without a word — stopped reading the e2e drivers for five
 * weeks. So the cases are the shapes a moved directory leaves behind.
 *
 * Run: node --test tooling/scripts/test/tsconfig-entries.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { deadEntries } from "../check-tsconfig-entries.mjs";

/** A directory holding `files`, and a tsconfig.json with `config` in it. */
function project(files, config) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-entries-"));
    for (const [rel, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), body);
    }
    // JSONC, as real tsconfigs are: comments and a trailing comma must parse.
    fs.writeFileSync(path.join(dir, "tsconfig.json"), `// a comment\n${JSON.stringify(config, null, 2)}\n`);
    return path.join(dir, "tsconfig.json");
}

test("an include naming a directory that moved is dead", () => {
    const config = project({ "tests/e2e/spec.ts": "" }, { include: ["e2e"], exclude: ["tests/e2e/fixtures"] });
    assert.deepEqual(deadEntries(config).map((d) => `${d.field}:${d.entry}`), ["include:e2e"]);
});

test("the directory where it went is not", () => {
    const config = project({ "tests/e2e/spec.ts": "" }, { include: ["tests/e2e", "src/**/*"] , compilerOptions: {} });
    // src/ does not exist either: a glob is checked up to its first wildcard.
    assert.deepEqual(deadEntries(config).map((d) => d.entry), ["src/**/*"]);
});

test("a paths target is found the way tsc finds a module", () => {
    const config = project(
        { "config/index.ts": "", "vendor/lib/package.json": "{}" },
        {
            compilerOptions: {
                paths: {
                    config: ["./config/index"], // index.ts
                    lib: ["./vendor/lib"], // a package directory
                    "lib/*": ["./vendor/lib/*"], // a wildcard, checked to its prefix
                    hono: ["./node_modules/hono"] // never created by an isolated install
                }
            }
        }
    );
    assert.deepEqual(deadEntries(config).map((d) => d.field), ['paths["hono"]']);
});

test("paths resolve against baseUrl when there is one", () => {
    const config = project({ "src/shared/index.ts": "" }, {
        compilerOptions: { baseUrl: "./src", paths: { "@shared": ["shared"] } }
    });
    assert.deepEqual(deadEntries(config), []);
});

test("build output and a missing extends are told apart", () => {
    const config = project({}, {
        extends: "./tsconfig.base.json",
        compilerOptions: { paths: { "@pkg": ["./dist/index.d.ts"] } }
    });
    // dist is absent before a build by design; a missing base config is not.
    assert.deepEqual(deadEntries(config).map((d) => d.field), ["extends"]);
});
