/**
 * The frontmatter stage of verify:docs: a page whose YAML the site build
 * cannot parse is a finding, with the file and line, and the site's own pages
 * all parse.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkFrontmatter, frontmatterOf } from "../docs-verify/check-frontmatter.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function fixture(pages) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frontmatter-"));
    for (const [name, text] of Object.entries(pages)) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), text);
    }
    return dir;
}

test("an unquoted \": \" in a value is the finding that broke the 2026-11-06 deploy", () => {
    const dir = fixture({
        "es/docs/broken.md": "---\ntitle: Portabilidad\ndescription: Lo que importa decide si podría ejecutarse fuera de Node: qué es portable\n---\n\nBody\n",
        "es/docs/quoted.md": "---\ntitle: Portabilidad\ndescription: \"Lo que importa decide si podría ejecutarse fuera de Node: qué es portable\"\n---\n\nBody\n",
        "docs/no-frontmatter.mdx": "Just a body.\n",
    });
    const { findings, scanned } = checkFrontmatter(ROOT, { contentDir: dir });
    assert.equal(scanned, 3);
    assert.equal(findings.length, 1);
    assert.match(findings[0].file, /es\/docs\/broken\.md$/);
    assert.equal(findings[0].line, 3);
    assert.match(findings[0].message, /site build stops here/);
});

test("frontmatterOf reads the block between the fences, or nothing", () => {
    assert.equal(frontmatterOf("---\ntitle: A\n---\nbody"), "title: A");
    assert.equal(frontmatterOf("no fences here"), null);
});

test("every page of the site parses", () => {
    assert.deepEqual(checkFrontmatter(ROOT).findings, []);
});
