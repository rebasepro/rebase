/**
 * Tests for `check-untranslated.mjs`.
 *
 * The check only recognised an English value written as `"value"` or
 * `>value<` on one line. Prettier puts JSX text that does not fit on its own
 * line, between the tags, so `New collection` in the collection editor's
 * welcome view — a key translated seven ways — rendered English in every
 * locale with the ratchet green. 37 such sites were live.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { translatedStrings, untranslatedKeyOn } from "../check-untranslated.mjs";

const STRINGS = translatedStrings(
    "export const en = {\n" +
    "    new_collection: \"New collection\",\n" +
    "    file_not_found: \"File not found\",\n" +
    "};\n"
);

test("the locale file is read into keys and values", () => {
    assert.deepEqual(STRINGS, [
        { key: "new_collection", value: "New collection" },
        { key: "file_not_found", value: "File not found" }
    ]);
});

test("JSX text on a line of its own is an untranslated literal", () => {
    // What Prettier writes for `<Typography variant="h6">New collection</Typography>`
    // once the opening tag carries enough props to wrap.
    assert.equal(untranslatedKeyOn("                    New collection", STRINGS), "new_collection");
    assert.equal(untranslatedKeyOn("\tFile not found  ", STRINGS), "file_not_found");
});

test("the one-line shapes are still found", () => {
    assert.equal(untranslatedKeyOn("<Typography>New collection</Typography>", STRINGS), "new_collection");
    assert.equal(untranslatedKeyOn("title: \"File not found\",", STRINGS), "file_not_found");
});

test("a translated line, a comment, a log line or a longer sentence is not a finding", () => {
    for (const line of [
        "{t(\"new_collection\")}",
        "            {t(\"new_collection\") ?? \"New collection\"}",
        "// New collection",
        " * New collection",
        "console.warn(\"File not found\")",
        "                    New collection name"
    ]) {
        assert.equal(untranslatedKeyOn(line, STRINGS), null, line);
    }
});
