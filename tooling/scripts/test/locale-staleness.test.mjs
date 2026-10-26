/**
 * Tests for `check-locale-staleness.mjs`: a translation is not left behind
 * when its English changes.
 *
 * Run: node --test tooling/scripts/test/locale-staleness.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
    compareWithRecord,
    formatRecord,
    hashBundles,
    readLocaleSource,
    TARGETS,
    valueHash
} from "../check-locale-staleness.mjs";

/** Bundles where every language holds `values[lang]` for one key, `save`. */
function bundles(values) {
    const out = {};
    for (const lang of ["en", ...TARGETS]) {
        out[lang] = new Map(values[lang] === undefined ? [] : [["save", values[lang]]]);
    }
    return out;
}

const BEFORE = { en: "Save", de: "Speichern", es: "Guardar", fr: "Enregistrer", hi: "सहेजें", it: "Salva", pt: "Guardar" };
const RECORD = hashBundles(bundles(BEFORE));

test("the locale file is read into keys and values, both quote styles", () => {
    const read = readLocaleSource("export const en = {\n    save: \"Save\",\n    quote: 'It\\'s \"here\"',\n};\n");
    assert.deepEqual([...read], [["save", "Save"], ["quote", "It's \"here\""]]);
});

test("nothing changed: nothing stale, the record unchanged", () => {
    const { stale, next } = compareWithRecord(RECORD, hashBundles(bundles(BEFORE)));
    assert.deepEqual(stale, []);
    assert.deepEqual(next, RECORD);
});

test("English changed and two translations did not: those two are stale, and the record keeps the old English", () => {
    const now = hashBundles(bundles({ ...BEFORE, en: "Save draft", de: "Entwurf speichern", es: "Guardar borrador", fr: "Enregistrer le brouillon", hi: "ड्राफ़्ट सहेजें" }));
    const { stale, next } = compareWithRecord(RECORD, now);
    assert.deepEqual(stale, [{ key: "save", langs: ["it", "pt"] }]);
    // Still stale on the next run, until fixed or accepted.
    assert.deepEqual(next.save, RECORD.save);
    assert.deepEqual(compareWithRecord(next, now).stale, [{ key: "save", langs: ["it", "pt"] }]);
});

test("English and every translation changed: nothing stale, the record moves on", () => {
    const after = { en: "Save draft", de: "Entwurf speichern", es: "Guardar borrador", fr: "Enregistrer le brouillon", hi: "ड्राफ़्ट सहेजें", it: "Salva bozza", pt: "Guardar rascunho" };
    const now = hashBundles(bundles(after));
    const { stale, next } = compareWithRecord(RECORD, now);
    assert.deepEqual(stale, []);
    assert.deepEqual(next.save, now.save);
});

test("--accept records a translation that is still right after an English typo fix", () => {
    const now = hashBundles(bundles({ ...BEFORE, en: "Save." }));
    assert.equal(compareWithRecord(RECORD, now).stale.length, 1);
    const { stale, next } = compareWithRecord(RECORD, now, new Set(["save"]));
    assert.deepEqual(stale, []);
    assert.deepEqual(next.save, now.save);
});

test("a translation changed on its own is recorded, and a missing one is parity's finding", () => {
    const fixed = compareWithRecord(RECORD, hashBundles(bundles({ ...BEFORE, de: "Sichern" })));
    assert.deepEqual(fixed.stale, []);
    assert.equal(fixed.next.save[1], valueHash("Sichern"));

    const missing = compareWithRecord(RECORD, hashBundles(bundles({ ...BEFORE, en: "Save draft", de: undefined, es: "Guardar borrador", fr: "x", hi: "y", it: "z", pt: "w" })));
    assert.deepEqual(missing.stale, []);
});

test("a new key is recorded, a removed one dropped", () => {
    const now = { ...hashBundles(bundles(BEFORE)), cancel: ["a", "b", "c", "d", "e", "f", "g"] };
    const { stale, next } = compareWithRecord(RECORD, now);
    assert.deepEqual(stale, []);
    assert.deepEqual(Object.keys(next).sort(), ["cancel", "save"]);
    assert.deepEqual(Object.keys(compareWithRecord(now, hashBundles(bundles(BEFORE))).next), ["save"]);
});

test("the record is one key per line, sorted", () => {
    const text = formatRecord({ b: ["1"], a: ["2"] });
    assert.equal(text, "{\n  \"languages\": [\"en\",\"de\",\"es\",\"fr\",\"hi\",\"it\",\"pt\"],\n  \"keys\": {\n    \"a\": [\"2\"],\n    \"b\": [\"1\"]\n  }\n}\n");
    assert.deepEqual(JSON.parse(text).keys, { a: ["2"], b: ["1"] });
});
