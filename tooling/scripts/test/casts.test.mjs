/**
 * check:casts — what it counts, and how a count compares with the baseline.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { compare, countCasts, isCountedSource } from "../check-casts.mjs";

test("package source counts; tests, declarations and code outside src do not", () => {
    assert.equal(isCountedSource("packages/server/src/init.ts"), true);
    assert.equal(isCountedSource("packages/cms/src/form/EntityForm.tsx"), true);
    assert.equal(isCountedSource("packages/server/src/auth/x.test.ts"), false);
    assert.equal(isCountedSource("packages/cms/src/__tests__/x.ts"), false);
    assert.equal(isCountedSource("packages/cms/src/test/helpers.ts"), false);
    assert.equal(isCountedSource("packages/types/src/global.d.ts"), false);
    assert.equal(isCountedSource("packages/server/test/x.ts"), false);
    assert.equal(isCountedSource("app/frontend/src/main.ts"), false);
});

test("each kind is counted per package, and `as unknown as` is not also an `as unknown`", () => {
    const counts = countCasts([
        { file: "packages/a/src/x.ts", text: "const x = y as any;\nconst z = w as never; const q = (r as never);" },
        { file: "packages/a/src/y.ts", text: "const v = u as unknown as T;\nconst s = t as anything;" },
        { file: "packages/b/src/z.ts", text: "const ok: string = 'as any';" }
    ]);
    assert.deepEqual(counts, {
        a: { "as any": 1, "as never": 2, "as unknown as": 1 },
        // Text, not syntax: a cast in a string or comment counts — the cheap way to be wrong.
        b: { "as any": 1 }
    });
});

test("a grown count is reported as grown, a shrunk one as shrunk, an unchanged one not at all", () => {
    const { grown, shrunk } = compare(
        { a: { "as never": 3, "as any": 1 }, c: { "as any": 1 } },
        { a: { "as never": 2, "as any": 1 }, b: { "as unknown as": 4 } }
    );
    assert.deepEqual(grown, [
        { pkg: "a", kind: "as never", was: 2, now: 3 },
        { pkg: "c", kind: "as any", was: 0, now: 1 }
    ]);
    assert.deepEqual(shrunk, [{ pkg: "b", kind: "as unknown as", was: 4, now: 0 }]);
});
