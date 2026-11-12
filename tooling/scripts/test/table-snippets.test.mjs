/**
 * `check:doc-examples` runs a page's table fences through the real builders,
 * `compileTables` and `lowerTables`. These cases pin what a page is allowed to
 * leave out (a table it never shows, a project `defaultRls`) and what it is
 * not (a schema the compiler refuses, a customization `customizeTable`
 * throws on).
 *
 * The module imports TypeScript sources, so it runs in a child under tsx, the
 * way `pnpm check:doc-examples` runs it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const MODULE = path.join(ROOT, "tooling/scripts/docs-verify/table-snippets.mjs");

/** Run the page through `tableSnippets` and return `[line, problems | error]` per fence. */
function check(markdown) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "table-snippets-"));
    fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
    fs.writeFileSync(path.join(dir, "docs/page.md"), markdown);
    const runner = path.join(dir, "run.mjs");
    fs.writeFileSync(runner, `
        const { tableSnippets } = await import(${JSON.stringify(MODULE)});
        const { results } = await tableSnippets(${JSON.stringify(dir)}, { globs: ["docs/*.md"] });
        console.log(JSON.stringify(results.map(r => [r.snippet.line, r.error ? "error: " + r.error.message : r.problems])));
    `);
    const out = spawnSync(process.execPath, ["--import", "tsx", runner], {
        cwd: ROOT,
        env: { ...process.env, TSX_TSCONFIG_PATH: path.join(ROOT, "tsconfig.typecheck.json") },
        encoding: "utf8"
    });
    assert.equal(out.status, 0, out.stderr);
    return JSON.parse(out.stdout.trim().split("\n").at(-1));
}

const fence = (code) => "```ts\n" + code + "\n```\n";

test("a valid table, with a relation to a table the page shows in another fence, has no problem", () => {
    const results = check([
        fence(`import { defineTable, col } from "@rebasepro/server/schema";
export const users = defineTable("users", { columns: { id: col.uuid().primaryKey() }, rls: "admin-only" });`),
        fence(`import { defineTable, col, rel } from "@rebasepro/server/schema";
import { users } from "./users";
export const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey(), authorId: col.uuid() },
    relations: { author: rel.belongsTo(() => users) },
    rls: "inherit"
});`)
    ].join("\n"));
    assert.deepEqual(results.map(([, problems]) => problems), [[], []]);
});

test("a relation to a table the page never shows is the reader's business, not a finding", () => {
    const [[, problems]] = check(fence(`import { defineTable, col, rel } from "@rebasepro/server/schema";
import { authors } from "./authors";
export const books = defineTable("books", {
    columns: { id: col.uuid().primaryKey(), authorId: col.uuid() },
    relations: { author: rel.belongsTo(() => authors) },
    rls: "admin-only"
});`));
    assert.deepEqual(problems, []);
});

test("a table the compiler refuses is reported at its fence, by table", () => {
    const [[, problems]] = check(fence(`import { defineTable, col } from "@rebasepro/server/schema";
export const notes = defineTable("notes", { columns: { body: col.text() }, rls: "admin-only" });`));
    assert.ok(problems.length > 0);
    assert.ok(problems.every(p => p.startsWith("notes: ")), problems.join("\n"));
    assert.ok(problems.some(p => /primary key/i.test(p)), problems.join("\n"));
});

test("an excerpt of columns is wrapped into a table and compiled", () => {
    const [[, problems]] = check(fence(`title: col.text().notNull(),
body: col.text()`));
    assert.deepEqual(problems, []);
});

test("customizeTable runs for real: an old admin name is an error at the fence", () => {
    const [[, result]] = check(fence(`import { customizeTable } from "@rebasepro/cms";
export const postsCms = customizeTable("posts", { propertiesOrder: ["title"] });`));
    assert.match(result, /^error: .*fieldOrder/s);
});
