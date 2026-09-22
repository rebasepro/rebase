/**
 * Tests for `docs-verify/check-docs-links.mjs`.
 *
 * The check drops fenced code before reading links, and the regex that did it
 * began `^(\s*)`. `\s` matches a newline, so the "indent" could swallow the
 * blank line above a fence; the closing fence then had to be preceded by a
 * blank line too, which the real one was not, and the match ran on to the next
 * fence that was — deleting every paragraph in between. 216 links on 96 pages
 * were never resolved.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkDocsLinks } from "../docs-verify/check-docs-links.mjs";

function fixture(pages) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-links-"));
    for (const [file, contents] of Object.entries(pages)) {
        const abs = path.join(root, "website/src/content/docs/docs", file);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, contents);
    }
    return root;
}

const PAGE = "website/src/content/docs/docs/guide.md";
const deadLinks = (root) =>
    checkDocsLinks(root).findings.filter(f => f.file === PAGE && /no page is served|no heading/.test(f.message));

test("a link between two fenced blocks is read, on the line it is on", () => {
    const root = fixture({
        "guide.md":
            "# Guide\n" +
            "\n" +
            "```ts\n" +
            "const x = 1;\n" +
            "```\n" +
            "\n" +
            "See [the missing page](/docs/nowhere).\n" +
            "\n" +
            "```\n" +
            "later\n" +
            "```\n",
        "other.md": "# Other\n"
    });
    const found = deadLinks(root);
    assert.equal(found.length, 1, `the dead link must be reported, got ${JSON.stringify(found)}`);
    assert.match(found[0].message, /\/docs\/nowhere — no page is served/);
    assert.equal(found[0].line, 7);
});

test("a link inside a fenced block is still a sample, not a link", () => {
    const root = fixture({
        "guide.md":
            "# Guide\n\n" +
            "- A list item with a fence:\n\n" +
            "    ```md\n" +
            "    [shown, not followed](/docs/nowhere)\n" +
            "    ```\n\n" +
            "~~~~\n" +
            "```\n" +
            "[also inside](/docs/nowhere-either)\n" +
            "~~~~\n"
    });
    assert.deepEqual(deadLinks(root), []);
});

test("a comment line inside a fence is not a heading an anchor can land on", () => {
    const root = fixture({
        "guide.md": "# Guide\n\n```bash\n# Install it\nnpm i\n```\n",
        "other.md": "# Other\n\n[jump](/docs/guide#install-it)\n"
    });
    const found = checkDocsLinks(root).findings.filter(f => /no heading/.test(f.message));
    assert.equal(found.length, 1, `got ${JSON.stringify(found)}`);
});
