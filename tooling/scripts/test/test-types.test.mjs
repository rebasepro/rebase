/**
 * check:test-types — how tsc's output becomes a count per package, how a count
 * compares with the baseline, and what the program reads.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { compare, countErrors, programConfig } from "../check-test-types.mjs";

const ROOT = path.join(path.sep, "repo");

test("errors are counted per package, and nothing else in the output is", () => {
    const output = [
        "packages/server/test/a.test.ts(3,7): error TS2353: Object literal may only specify known properties, and 'relationName' does not exist in type 'RelationProperty'.",
        "packages/server/test/b.test.ts(9,1): error TS2322: Type 'string' is not assignable to type 'number'.",
        "  The expected type comes from property 'x' which is declared here on type 'Y'",
        "packages/cli/test/e2e/cli.test.ts(1,1): error TS2307: Cannot find module 'x'.",
        "app/config/x.ts(1,1): error TS2307: Cannot find module 'y'.",
        "Found 4 errors."
    ].join("\n");
    assert.deepEqual(countErrors(output, ROOT), { "(other)": 1, cli: 1, server: 2 });
});

test("an absolute path in the output is counted against its package too", () => {
    const output = `${path.join(ROOT, "packages", "client", "test", "x.test.ts")}(1,1): error TS2322: nope`;
    assert.deepEqual(countErrors(output, ROOT), { client: 1 });
});

test("a grown count is grown, a shrunk one shrunk, a package that reached zero is shrunk", () => {
    const { grown, shrunk } = compare({ server: 276, cli: 23 }, { server: 275, cli: 23, client: 4 });
    assert.deepEqual(grown, [{ pkg: "server", was: 275, now: 276 }]);
    assert.deepEqual(shrunk, [{ pkg: "client", was: 4, now: 0 }]);
});

test("the program reads every package's tests and leaves the bivariance probes out", () => {
    const config = programConfig(ROOT);
    assert.equal(config.extends, path.join(ROOT, "tsconfig.tests.json"));
    for (const glob of ["packages/*/test", "packages/*/src/**/*.test.ts", "packages/*/src/**/*.test.tsx"]) {
        assert.ok(config.include.includes(path.join(ROOT, glob)), glob);
    }
    assert.ok(config.exclude.includes(path.join(ROOT, "packages/types/__tests__")));
});
