/**
 * The scan for code outside `config/` that the migration leaves pointing at
 * nothing: imports of `config/` and collection-model server APIs. A comment
 * is neither.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { findConfigImporters, findLegacyApiUses } from "./project-files";

const scratch: string[] = [];
afterAll(() => {
    for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function project(files: Record<string, string>): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "codemod-scan-"));
    scratch.push(root);
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
    }
    return root;
}

describe("the scan of the project's own code", () => {
    it("finds live imports of config/ and skips commented-out ones", () => {
        const root = project({
            "config/collections/posts.ts": "export default { slug: \"posts\" };\n",
            "scripts/example.ts": [
                "// import type { Database } from \"../config/database.types\"; // Optional",
                "/* import posts from \"../config/collections/posts\"; */",
                "const url = \"https://example.com/a\"; // not a comment opener inside a string: \"//\"",
                "import posts from \"../config/collections/posts\";",
                "const later = () => import(\"../config/collections/posts\");",
                ""
            ].join("\n")
        });
        const found = findConfigImporters(root, path.join(root, "config"), new Set());
        expect(found.map(importer => `${importer.line} ${importer.specifier}`)).toEqual([
            "4 ../config/collections/posts",
            "5 ../config/collections/posts"
        ]);
    });

    it("finds collection-model server APIs in code, not in comments", () => {
        const root = project({
            "config/collections/posts.ts": "export default { slug: \"posts\" };\n",
            "backend/src/index.ts": [
                "// boots with `collectionsDir: \"../config/collections\"` in older versions",
                "/** backend.setCollectionCallbacks(\"posts\", hooks) was the old way */",
                "backend.setCollectionCallbacks(\"posts\", hooks);",
                ""
            ].join("\n")
        });
        const found = findLegacyApiUses(root, path.join(root, "config"), new Set());
        expect(found.map(use => `${use.line} ${use.api}`)).toEqual(["3 setCollectionCallbacks"]);
    });
});
