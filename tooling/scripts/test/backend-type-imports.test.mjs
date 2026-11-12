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

// ─── The security review's ten forms (S-2), in a project that has the files they rely on ───

/**
 * A virtual project: `read` answers for the files, `exists` for files and the
 * directories above them. Each form is one file under frontend/src.
 */
function project(files) {
    const all = {
        "/p/rebase.json": "{}",
        "/p/backend/package.json": JSON.stringify({ name: "rebase-app-backend" }),
        "/p/backend/schema/posts.ts": "export const posts = {};",
        "/p/shared/reexports-backend.ts": "export { posts } from \"../backend/schema/posts\";",
        "/p/shared/clean.ts": "export const label = \"posts\";",
        "/p/frontend/package.json": JSON.stringify({ name: "frontend", imports: { "#backend/*": "../backend/*", "#app/*": "./src/*" } }),
        "/p/frontend/tsconfig.json": "{\n  // JSONC, as tsc reads it\n  \"compilerOptions\": { \"baseUrl\": \".\", \"paths\": { \"@backend/*\": [\"../backend/*\"], \"@/*\": [\"src/*\"] } },\n}",
        ...files
    };
    const exists = file => file in all || Object.keys(all).some(key => key.startsWith(file + "/"));
    return { read: file => all[file], exists, files: Object.keys(files) };
}

/** Each form → whether the pre-check catches it, or why only the build guard does. */
const REVIEW_FORMS = {
    "relative": { text: "import { posts } from \"../../backend/schema/posts\";", caught: true },
    "import.meta.glob": { text: "const m = import.meta.glob(\"../../backend/schema/*.ts\", { eager: true });", caught: true },
    "package.json imports": { text: "import { posts } from \"#backend/schema/posts\";", caught: true },
    "tsconfig paths": { text: "import { posts } from \"@backend/schema/posts\";", caught: true },
    "the backend's package name": { text: "import { posts } from \"rebase-app-backend/schema/posts\";", caught: true },
    "aliased require": { text: "const r = require; const m = r('../../backend/schema/posts');", caught: true },
    "createRequire": { text: "import { createRequire } from \"module\"; createRequire(import.meta.url)(\"../../backend/x\");", caught: true },
    "import() of a const": { text: "const p = '../../backend/schema/posts'; import(p);", caught: true },
    "absolute path": { text: "import { posts } from \"/p/backend/schema/posts\";", caught: true },
    "re-export through shared/": { text: "import { posts } from \"../../shared/reexports-backend\";", caught: true }
};

test("the review's ten forms: every one is caught when the project's own files say where it lands", () => {
    const files = Object.fromEntries(Object.entries(REVIEW_FORMS).map(([name, { text }], i) => [`/p/frontend/src/form${i}.ts`, text]));
    const { read, exists, files: list } = project(files);
    const hit = new Set(findValueImportsOfBackend({ files: list, backendDir: "/p/backend", read, exists }).map(f => f.file));
    const missed = Object.keys(REVIEW_FORMS).filter((name, i) => REVIEW_FORMS[name].caught !== hit.has(`/p/frontend/src/form${i}.ts`));
    assert.deepEqual(missed, []);
});

test("a re-export through another directory is reported at the frontend line, with the module it went through", () => {
    const { read, exists, files } = project({ "/p/frontend/src/a.ts": "import { label } from \"../../shared/clean\";\nimport { posts } from \"../../shared/reexports-backend\";" });
    assert.deepEqual(findValueImportsOfBackend({ files, backendDir: "/p/backend", read, exists }),
        [{ file: "/p/frontend/src/a.ts", line: 2, specifier: "../../shared/reexports-backend", form: "import", via: ["/p/shared/reexports-backend.ts"] }]);
});

test("aliases and globs that stay out of the backend are left alone", () => {
    const { read, exists, files } = project({
        "/p/frontend/src/a.ts": [
            "import { x } from \"@/cms/posts\";",
            "import { y } from \"#app/cms/posts\";",
            "const views = import.meta.glob(\"./views/*.tsx\");",
            "const root = import.meta.glob(\"/src/**/*.tsx\");",
            "import text from \"./notes.txt?raw\";"
        ].join("\n")
    });
    assert.deepEqual(findValueImportsOfBackend({ files, backendDir: "/p/backend", read, exists }), []);
});

test("a glob that searches a directory holding the backend is reported", () => {
    const { read, exists, files } = project({ "/p/frontend/src/a.ts": "const all = import.meta.glob([\"../../**/*.ts\", \"!**/node_modules/**\"]);" });
    assert.equal(findValueImportsOfBackend({ files, backendDir: "/p/backend", read, exists }).length, 1);
});

test(".vue and .svelte script blocks are read, with the file's own line numbers", () => {
    const { read, exists, files } = project({
        "/p/frontend/src/Posts.vue": "<template><div/></template>\n<script setup lang=\"ts\">\nimport type { posts } from \"../../backend/schema/posts\";\nimport { tags } from \"../../backend/schema/tags\";\n</script>\n",
        "/p/frontend/src/Posts.svelte": "<script>\n  import { posts } from \"../../backend/schema/posts\";\n</script>\n<h1>x</h1>\n"
    });
    const found = findValueImportsOfBackend({ files, backendDir: "/p/backend", read, exists }).map(f => `${path.basename(f.file)}:${f.line}`);
    assert.deepEqual(found, ["Posts.vue:4", "Posts.svelte:2"]);
});

test(".cjs, .mts and .cts sources are read", () => {
    const { read, exists, files } = project({
        "/p/frontend/src/a.cjs": "const { posts } = require(\"../../backend/schema/posts\");",
        "/p/frontend/src/b.mts": "export { posts } from \"../../backend/schema/posts\";",
        "/p/frontend/src/c.cts": "import posts = require(\"../../backend/schema/posts\");"
    });
    assert.equal(findValueImportsOfBackend({ files, backendDir: "/p/backend", read, exists }).length, 3);
});
