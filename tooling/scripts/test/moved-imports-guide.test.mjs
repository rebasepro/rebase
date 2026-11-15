/**
 * Tests for the "Imports that moved in 0.31" block the upgrade guide carries.
 *
 * The page is MDX. A `<` in its text opens a JSX tag and a `{` opens an
 * expression, so a replacement note that mentions `client.data.<table>.find()`
 * or `col.varchar({ length })` stopped the website build at that page — in all
 * six languages, because the translations carry the same cell. Nothing before
 * the build parsed the page as MDX, so the release's docs deploy was the first
 * thing to see it.
 *
 * Run: `pnpm test:gates`
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { renderMovedImports } from "../docs-verify/moved-imports-guide.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 * The text of a line outside its inline code spans, where MDX reads markup,
 * with backslash-escaped characters (literal in MDX) taken out.
 */
function outsideCode(line) {
    return line.split(/(`[^`]*`)/).filter((_, i) => i % 2 === 0).join("").replace(/\\[<{}|]/g, "");
}

test("a note's angle brackets and braces reach MDX as text, not markup", () => {
    const block = renderMovedImports([
        { symbol: "Gone", from: "@rebasepro/types", to: null, instead: "Read InferRow<typeof table> with col.varchar({ length })." }
    ]);
    const row = block.split("\n").find((line) => line.startsWith("| `Gone`"));
    assert.ok(row, "the removed export has a row");
    assert.doesNotMatch(outsideCode(row), /[<{}]/);
    assert.ok(row.includes("InferRow\\<typeof table>"), row);
    assert.ok(row.includes("col.varchar(\\{ length \\})"), row);
});

test("code spans in a note are left as they are", () => {
    const block = renderMovedImports([
        { symbol: "Gone", from: "@rebasepro/types", to: null, instead: "Use `InferRow<typeof t>` instead." }
    ]);
    assert.match(block, /`InferRow<typeof t>`/);
});

test("the block for the real move table has no markup outside code", () => {
    const { moves } = JSON.parse(readFileSync(path.join(ROOT, "tooling/scripts/headless-guard/moved-symbols.json"), "utf8"));
    for (const line of renderMovedImports(moves).split("\n")) {
        assert.doesNotMatch(outsideCode(line), /[<{}]/, line);
    }
});
