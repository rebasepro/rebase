/**
 * `check:frontend-backend-imports` finds every frontend/backend pair, and the
 * rule it runs (`findValueImportsOfBackend`, tested on its own beside it) sees
 * a value import across the pair's line on disk.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { frontendBackendPairs } from "../check-frontend-backend-imports.mjs";
import { findValueImportsOfBackend, sourceFilesUnder } from "../backend-type-imports.mjs";

function tree(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fe-be-"));
    for (const [rel, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), text);
    }
    return root;
}

test("a pair is a frontend/ beside a backend/, at any depth; a frontend alone is none", () => {
    const root = tree({
        "app/frontend/src/App.tsx": "",
        "app/backend/schema/index.ts": "",
        "presets/shop/frontend/src/cms/products.tsx": "",
        "presets/shop/backend/schema/products.ts": "",
        "lonely/frontend/src/main.tsx": "",
        "app/frontend/node_modules/pkg/frontend/x.ts": ""
    });
    const pairs = frontendBackendPairs(root).map(p => path.relative(root, p.frontend)).sort();
    assert.deepEqual(pairs, ["app/frontend", "presets/shop/frontend"]);
});

test("a value import of the sibling backend is found; a type import and another tree's backend are not", () => {
    const root = tree({
        "app/frontend/src/cms/posts.tsx": [
            "import type { posts } from \"../../../backend/schema/posts\";",
            "import { tags } from \"../../../backend/schema/tags\";"
        ].join("\n"),
        "app/backend/schema/posts.ts": "",
        "app/backend/schema/tags.ts": ""
    });
    const [pair] = frontendBackendPairs(root);
    const findings = findValueImportsOfBackend({ files: sourceFilesUnder(pair.frontend), backendDir: pair.backend });
    assert.deepEqual(findings.map(f => `${f.line} ${f.specifier}`), ["2 ../../../backend/schema/tags"]);
});
