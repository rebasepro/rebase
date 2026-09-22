/**
 * Tests for `docs-verify/extract.mjs`, which decides which fences the docs
 * gates compile and name-check. A fence it skips is a fence every one of those
 * gates passes without reading.
 *
 * A ```diff fence opts in by naming its language in the meta. Only the bare
 * form (`diff ts`) was recognised, and the upgrade guides write the form
 * Starlight's own syntax uses for a highlighted diff — `diff lang="ts"` — so
 * their migration diffs, the code a reader copies while their build is broken,
 * were never compiled.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractSnippets } from "../docs-verify/extract.mjs";

function snippetsOf(markdown) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "extract-snippets-"));
    fs.writeFileSync(path.join(root, "page.md"), markdown);
    return extractSnippets(root, ["page.md"]).snippets.map(({ line, lang, code }) => ({ line, lang, code }));
}

const DIFF_BODY = "- import { old } from \"@rebasepro/client\";\n+ import { fresh } from \"@rebasepro/client\";\n";

test("a diff fence naming its language as lang=\"ts\" is compiled as TypeScript", () => {
    assert.deepEqual(snippetsOf("```diff lang=\"ts\"\n" + DIFF_BODY + "```\n"), [
        // The removed line stays as a blank, so diagnostics keep their line numbers.
        { line: 2, lang: "ts", code: "\nimport { fresh } from \"@rebasepro/client\";" }
    ]);
});

test("every spelling of the language names the same fence", () => {
    for (const meta of ["ts", "lang=\"ts\"", "lang='tsx'", "lang=ts", "title=\"x.ts\" lang=\"typescript\""]) {
        const found = snippetsOf("```diff " + meta + "\n" + DIFF_BODY + "```\n");
        assert.equal(found.length, 1, `\`diff ${meta}\` must be extracted`);
    }
});

test("an untagged diff, or one tagged with another language, stays skipped", () => {
    for (const meta of ["", "lang=\"yaml\"", "title=\"notes.ts\"", "lang=\"tsv\""]) {
        assert.deepEqual(snippetsOf("```diff " + meta + "\n" + DIFF_BODY + "```\n"), [], `\`diff ${meta}\``);
    }
});
