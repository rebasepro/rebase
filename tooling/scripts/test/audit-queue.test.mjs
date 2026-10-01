import { test } from "node:test";
import assert from "node:assert/strict";

import { coverage, globToRegExp, score } from "../audit-queue.mjs";

test("globs keep * inside a segment and let ** cross them", () => {
    assert.ok(globToRegExp("packages/server/src/*.ts").test("packages/server/src/env.ts"));
    assert.ok(!globToRegExp("packages/server/src/*.ts").test("packages/server/src/auth/jwt.ts"));
    assert.ok(globToRegExp("packages/server/src/auth/**").test("packages/server/src/auth/api-keys/store.ts"));
    assert.ok(globToRegExp("**/jest.config.*").test("jest.config.cjs"), "**/ may match no directory");
    assert.ok(globToRegExp("**/jest.config.*").test("packages/cli/jest.config.cjs"));
    assert.ok(globToRegExp("packages/cli/src/cli*.ts").test("packages/cli/src/cli-flags.ts"));
    assert.ok(!globToRegExp("packages/a.ts").test("packages/aXts"), "a dot is literal");
});

const registry = {
    systems: [
        { id: "auth", title: "Auth", focus: "who", paths: ["packages/server/src/auth/**"] },
        { id: "boot", title: "Boot", focus: "start", paths: ["packages/server/src/*.ts"] }
    ],
    unowned: [{ path: "packages/legacy/**", why: "frozen" }]
};

test("every source file claimed: no problems", () => {
    const files = [
        "packages/server/src/auth/jwt.ts",
        "packages/server/src/env.ts",
        "packages/legacy/src/index.ts",
        "packages/server/test/env.test.ts",
        "README.md"
    ];
    assert.deepEqual(coverage(registry, files), { problems: [], unclaimed: [], dead: [] });
});

test("a new directory nobody assigned is reported, its tests are not", () => {
    const files = [
        "packages/server/src/auth/jwt.ts",
        "packages/server/src/env.ts",
        "packages/legacy/src/index.ts",
        "packages/server/src/billing/meter.ts",
        "packages/server/src/billing/meter.test.ts",
        "packages/server/src/billing/__tests__/x.ts"
    ];
    assert.deepEqual(coverage(registry, files).unclaimed, ["packages/server/src/billing/meter.ts"]);
});

test("a path that matches nothing is reported as dead", () => {
    const files = ["packages/server/src/env.ts", "packages/legacy/src/index.ts"];
    assert.deepEqual(coverage(registry, files).dead, ["auth: packages/server/src/auth/**"]);
});

test("duplicate ids, missing focus and reasonless unowned entries are problems", () => {
    const bad = {
        systems: [
            { id: "a", title: "A", focus: "x", paths: ["x/**"] },
            { id: "a", title: "A again", paths: ["y/**"] }
        ],
        unowned: [{ path: "z/**" }]
    };
    const { problems } = coverage(bad, ["x/1", "y/1", "z/1"]);
    assert.equal(problems.length, 3, problems.join("\n"));
});

test("feats outrank fixes outrank churn, and time alone makes a system due", () => {
    assert.ok(score({ lines: 0, feats: 1, fixes: 0, days: 0 }) > score({ lines: 0, feats: 0, fixes: 1, days: 0 }));
    assert.ok(score({ lines: 0, feats: 0, fixes: 1, days: 0 }) > score({ lines: 100, feats: 0, fixes: 0, days: 0 }));
    assert.ok(score({ lines: 0, feats: 0, fixes: 0, days: 70 }) > 0);
});
