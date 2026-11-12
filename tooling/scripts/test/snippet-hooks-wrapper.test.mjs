/**
 * The docs snippet type-checker compiles a fenced hooks fragment
 * (`afterSave: async ({ id, values }) => …`) inside a `TableHooks` literal, so
 * what it destructures is checked against the real props. Two ways that goes
 * quietly wrong: the wrapper names a type that is no longer the one
 * `defineTable({ hooks })` takes, or a hook is added to `TableHooks` that the
 * fragment detector does not recognise, so its fences compile bare and untyped.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CALLBACK_FRAGMENT, CALLBACKS_OPEN } from "../docs-verify/typecheck-snippets.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const HOOKS_SRC = fs.readFileSync(path.join(ROOT, "packages/types/src/schema/hooks.ts"), "utf8");
const TABLE_SRC = fs.readFileSync(path.join(ROOT, "packages/types/src/schema/table.ts"), "utf8");

/** The member names of `export interface TableHooks<…> { … }`. */
function tableHookNames() {
    const start = HOOKS_SRC.indexOf("export interface TableHooks<");
    assert.ok(start >= 0, "packages/types/src/schema/hooks.ts no longer declares TableHooks");
    const body = HOOKS_SRC.slice(HOOKS_SRC.indexOf("{", HOOKS_SRC.indexOf(">", start)) + 1);
    const end = body.indexOf("\n}");
    return [...body.slice(0, end).matchAll(/^\s{4}(\w+)\?\(/gm)].map((m) => m[1]);
}

test("the wrapper types a hooks fragment as TableHooks, the type defineTable's `hooks` takes", () => {
    assert.match(CALLBACKS_OPEN, /import\("@rebasepro\/types"\)\.TableHooks</);
    assert.doesNotMatch(CALLBACKS_OPEN, /CollectionCallbacks/);
    assert.match(TABLE_SRC, /hooks\?: TableHooks</, "defineTable's `hooks` is no longer TableHooks — retarget the wrapper");
});

test("every TableHooks member is recognised as a hooks fragment, and nothing else is", () => {
    const names = tableHookNames();
    assert.ok(names.length >= 7, `read ${names.length} TableHooks members: ${names}`);
    for (const name of names) {
        assert.ok(CALLBACK_FRAGMENT.test(`${name}: async (props) => {}`), `${name} fences would compile untyped`);
    }
    const detected = CALLBACK_FRAGMENT.source.match(/\(\?:([a-zA-Z|]+)\)\\s\*:/)[1].split("|");
    assert.deepEqual([...detected].sort(), [...names].sort());
});

test("a leading comment does not hide a hooks fragment; an ordinary object member is not one", () => {
    assert.ok(CALLBACK_FRAGMENT.test("// inside defineTable(…, { hooks: { … } })\nafterSave: async ({ id }) => {}"));
    assert.ok(!CALLBACK_FRAGMENT.test("columns: { id: col.text() }"));
});
