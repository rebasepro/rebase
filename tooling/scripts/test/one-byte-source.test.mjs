/**
 * The build step that writes characters above U+00FF in literals as `\u`
 * escapes (tooling/scripts/one-byte-source.ts), so V8 can hold a runtime's module
 * source one byte per character.
 *
 * The step checks its own output against the original's literal values at
 * build time; these tests pin the cases where an escape is easy to get wrong
 * (an escape that was already there, a surrogate pair, a line continuation)
 * and the ones it must not touch, and run both versions of a program to show
 * they compute the same values.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const { escapeWideLiterals, shiftGeneratedColumns } = await import(pathToFileURL(path.join(ROOT, "tooling/scripts/one-byte-source.ts")).href);
// The parser a build hands the step: rolldown's, through Vite. Vite is not
// installed at the root, so it is loaded from a package that builds with it.
const { parseAst } = await import(pathToFileURL(path.join(ROOT, "packages/server/node_modules/vite/dist/node/index.js")).href);

const WIDE = /[\u0100-\uffff]/;

/** What `source` evaluates to (it ends in an expression), as plain data from this realm. */
function run(source) {
    return JSON.parse(JSON.stringify(vm.runInNewContext(source, { tag: (strings) => strings.raw.join("|") })));
}

test("escapes string literals and untagged templates, and the program computes the same values", () => {
    const source = [
        "const a = \"⚠️ [cron] no store — runs are local\";",
        "const b = '…';",
        "const c = `📡 ${a.length} → ${b}`;",
        "const d = { \"clé—key\": 1 }[\"clé—key\"];",
        "[a, b, c, d]"
    ].join("\n");
    const { code } = escapeWideLiterals(source, parseAst);
    assert.doesNotMatch(code, WIDE);
    assert.match(code, /\\u2014/);
    assert.match(code, /\\ud83d\\udce1/, "a surrogate pair becomes two escapes");
    assert.deepEqual(run(code), run(source));
});

test("an escape that was already in the source stays an escape", () => {
    const source = "const s = \"\\— and \\\\—\"; s";
    const { code } = escapeWideLiterals(source, parseAst);
    assert.doesNotMatch(code, WIDE);
    assert.equal(run(code), run(source));
    assert.equal(run(code), "— and \\—");
});

test("a line continuation before U+2028 stays nothing", () => {
    const source = "const s = \"a\\ b\"; s";
    const { code } = escapeWideLiterals(source, parseAst);
    assert.doesNotMatch(code, WIDE);
    assert.equal(run(code), "ab");
});

test("tagged templates and regular expressions are left as they are", () => {
    const source = "const r = /—+/; const t = tag`⏰ ${1} —`; [r.source, t]";
    const { code } = escapeWideLiterals(source, parseAst);
    assert.equal(code, source);
    assert.deepEqual(run(code), ["—+", "⏰ | —"]);
});

test("a chunk with nothing above U+00FF comes back unchanged", () => {
    const source = "const s = \"café\"; s";
    const { code, edits } = escapeWideLiterals(source, parseAst);
    assert.equal(code, source);
    assert.deepEqual(edits, []);
});

test("the source map moves each column after an escape by what the escape added", () => {
    // One line: "x = '—'; y" with segments at columns 0, 4 (the literal) and 9 (y).
    const source = "x = '—'; y";
    const { code, edits } = escapeWideLiterals(source, parseAst);
    assert.equal(code, "x = '\\u2014'; y");
    // Columns 0 / +4 / +5, each pointing at source 0, line 0, the same column.
    const mappings = "AAAA,IAAI,KAAK";
    const shifted = shiftGeneratedColumns(mappings, source, edits);
    // The escape added five characters, so y moves from 9 to 14: deltas 0 / +4 / +10.
    assert.equal(shifted, "AAAA,IAAI,UAAK");
});
