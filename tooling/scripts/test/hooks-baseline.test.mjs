/**
 * check:hooks — the exhaustive-deps ratchet — must keep reporting when files
 * come and go: a file deleted since the baseline is "removed", not a crash, and
 * a file that vanishes while eslint walks the tree is skipped and named.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { bankable, compareToBaseline, lintTolerantly } from "../check-hooks-baseline.mjs";

const RULE_MSG = "React Hook useEffect has a missing dependency: 'x'.";

test("a baseline site whose file was deleted is reported as removed, and banking drops it", () => {
    const baseline = { [`packages/a/src/Gone.tsx::${RULE_MSG}`]: 2, [`packages/a/src/Kept.tsx::${RULE_MSG}`]: 1 };
    const found = new Map([[`packages/a/src/Kept.tsx::${RULE_MSG}`, { count: 1, lines: [10] }]]);
    const { added, removed } = compareToBaseline(found, baseline, (file) => file !== "packages/a/src/Gone.tsx");

    assert.deepEqual(added, []);
    assert.equal(removed.length, 1);
    assert.equal(removed[0].key.split("::")[0], "packages/a/src/Gone.tsx");
    assert.equal(removed[0].deleted, true);
    assert.equal(removed[0].now, 0);
    assert.deepEqual(Object.keys(bankable(found)), [`packages/a/src/Kept.tsx::${RULE_MSG}`]);
});

test("a fix in place is removed but not marked deleted; a new finding is added", () => {
    const baseline = { [`a.tsx::${RULE_MSG}`]: 2 };
    const found = new Map([
        [`a.tsx::${RULE_MSG}`, { count: 1, lines: [3] }],
        [`b.tsx::${RULE_MSG}`, { count: 1, lines: [7] }],
    ]);
    const { added, removed } = compareToBaseline(found, baseline, () => true);
    assert.deepEqual(added.map((a) => a.key), [`b.tsx::${RULE_MSG}`]);
    assert.deepEqual(removed.map((r) => [r.key, r.deleted]), [[`a.tsx::${RULE_MSG}`, false]]);
});

test("a file that vanishes mid-lint is skipped and the lint re-run without it", async () => {
    const seenIgnores = [];
    const makeEslint = (ignores) => ({
        async lintFiles() {
            seenIgnores.push([...ignores]);
            if (!ignores.includes("packages/cli/.tmp-x/a.ts")) {
                throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT", path: "/repo/packages/cli/.tmp-x/a.ts" });
            }
            return [{ filePath: "/repo/ok.tsx", messages: [] }];
        },
    });
    const { results, vanished } = await lintTolerantly(makeEslint, ["."], { root: "/repo" });
    assert.deepEqual(vanished, ["packages/cli/.tmp-x/a.ts"]);
    assert.equal(results.length, 1);
    assert.deepEqual(seenIgnores, [[], ["packages/cli/.tmp-x/a.ts"]]);
});

test("any other lint error still fails loudly", async () => {
    const makeEslint = () => ({ async lintFiles() { throw new Error("config is broken"); } });
    await assert.rejects(lintTolerantly(makeEslint, ["."]), /config is broken/);
});
