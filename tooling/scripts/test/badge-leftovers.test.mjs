import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { checkBadgeLeftovers } from "../docs-verify/check-badge-leftovers.mjs";

function tree(t, files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "badge-leftovers-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [rel, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), body);
    }
    return root;
}

test("a parenthesis a removed badge left half-empty is found, in any locale", (t) => {
    const root = tree(t, {
        "website/src/content/docs/docs/backend/errors.md": "at every door (; on 0.24 the data API answers it).\n",
        "website/src/content/docs/de/docs/backend/errors.md": "an jeder Tür (, unter 0.24 nicht).\n",
        "docs/compatibility.md": "the managed database (on 0.24, they refuse; ).\n"
    });
    const { findings } = checkBadgeLeftovers(root);
    assert.deepEqual(findings.map(f => f.file).sort(), [
        "docs/compatibility.md",
        "website/src/content/docs/de/docs/backend/errors.md",
        "website/src/content/docs/docs/backend/errors.md"
    ]);
});

test("code, lists of code and ordinary prose are not findings", (t) => {
    const root = tree(t, {
        "website/src/content/docs/docs/a.md": [
            "Three commands (`db push`, `generate`, `migrate`) plan against it.",
            "A call like `fn(a, )` in code is code.",
            "```sql",
            "SELECT f(; );",
            "```",
            "Plain words (on 0.24, it refuses) stay as they are."
        ].join("\n")
    });
    assert.deepEqual(checkBadgeLeftovers(root).findings, []);
});
