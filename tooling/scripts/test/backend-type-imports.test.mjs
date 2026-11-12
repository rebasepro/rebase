/**
 * `findValueImportsOfBackend`: across the frontend → backend line, types only.
 * `check:templates` runs it over every preset; these pin what counts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { findValueImportsOfBackend } from "../backend-type-imports.mjs";

const ROOT = "/project";
const BACKEND = path.join(ROOT, "backend");
const FILE = path.join(ROOT, "frontend/src/cms/posts.tsx");

function scan(text, file = FILE) {
    return findValueImportsOfBackend({ files: [file], backendDir: BACKEND, read: () => text })
        .map(({ line, specifier, form }) => `${line} ${form} ${specifier}`);
}

test("a type import of a table is allowed", () => {
    assert.deepEqual(scan(`import type { posts } from "../../../backend/schema/posts";\n`), []);
    assert.deepEqual(scan(`export type { posts } from "../../../backend/schema/posts";\n`), []);
});

test("every form that loads a backend module at runtime is reported, with its line", () => {
    const text = [
        "import { customizeTable } from \"@rebasepro/cms\";",
        "import { posts } from \"../../../backend/schema/posts\";",
        "import \"../../../backend/storage\";",
        "export { tags } from \"../../../backend/schema/tags\";",
        "const lazy = () => import(\"../../../backend/schema/users\");",
        "const req = require(\"../../../backend/resources\");"
    ].join("\n");
    assert.deepEqual(scan(text), [
        "2 import ../../../backend/schema/posts",
        "3 side-effect import ../../../backend/storage",
        "4 export … from ../../../backend/schema/tags",
        "5 import() ../../../backend/schema/users",
        "6 require() ../../../backend/resources"
    ]);
});

test("inline `type` specifiers still load the module, so they are reported", () => {
    assert.deepEqual(scan(`import { type posts } from "../../../backend/schema/posts";\n`), ["1 import ../../../backend/schema/posts"]);
});

test("imports that do not reach the backend, and mentions that are not imports, are left alone", () => {
    const text = [
        "import { postsCms } from \"./posts\";",
        "import { App } from \"../App\";",
        "import { x } from \"backend/schema\";", // a bare specifier is a package, not this directory
        "// import { posts } from \"../../../backend/schema/posts\";",
        "const s = \"import { posts } from '../../../backend/schema/posts'\";"
    ].join("\n");
    assert.deepEqual(scan(text), []);
});

test("a sibling directory whose name starts like the backend's is not the backend", () => {
    assert.deepEqual(scan(`import { x } from "../../../backend-tools/x";\n`), []);
});
