/**
 * Tests for the release's pin writer and the translation stamps it carries.
 *
 * The failure: the 0.21.0 bump rewrote `rebasepro/server:0.20.0` to `0.21.0` in
 * ten English pages and in all five translations of each, and left every
 * translation's `sourceHash` naming the English page as it was before the
 * rewrite. Fifty `verify:docs --strict` findings, not one translation that said
 * anything the English did not — and nobody saw them until an unrelated push,
 * because the bump commit is `[skip ci]`.
 *
 * So each case builds a one-page docs tree, runs the writer, and asks the
 * freshness gate — the thing that failed — what it now thinks.
 *
 * Run: node --test tooling/scripts/test/version-pins.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { writeVersionPins } from "../docs-verify/check-version-pins.mjs";
import {
    checkTranslationFreshness, sourceHash, readSourceHash, CONTENT, LOCALES
} from "../docs-verify/check-translation-freshness.mjs";

const PAGE = "docs/deployment/self-hosting.md";
const at = (locale) => `${CONTENT}/${locale}/${PAGE}`;

const fence = (version) => `\`\`\`dockerfile\nFROM rebasepro/server:${version}\nCOPY dist-bundle /bundle\n\`\`\``;
const english = (body) => `---\ntitle: Self-hosting\n---\n\nBake both into one image:\n\n${body}\n`;
const translation = (hash, body) =>
    `---\n${hash ? `sourceHash: ${hash}\n` : ""}title: Selbst hosten\n---\n\nBacken Sie beides in ein Image:\n\n${body}\n`;

const EN = english(fence("0.20.0"));

/**
 * A docs tree holding {@link PAGE} in English, pinned to `pin`, and in every
 * locale; removed when test `t` ends. A locale not named in `locales` gets a
 * faithful translation stamped fresh against the English page.
 */
function tree(t, { pin = "0.20.0", locales = {} } = {}) {
    const en = english(fence(pin));
    const root = mkdtempSync(path.join(os.tmpdir(), "version-pins-"));
    t.after(() => rmSync(root, { recursive: true,
force: true }));
    const put = (rel, text) => {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), text);
    };
    put(`${CONTENT}/${PAGE}`, en);
    for (const locale of LOCALES) {
        put(at(locale), locales[locale] ?? translation(sourceHash(en), fence(pin)));
    }
    return {
        root,
        read: (rel) => readFileSync(path.join(root, rel), "utf8"),
        stale: () => checkTranslationFreshness(root).findings.map(f => f.file).sort()
    };
}

test("a translation whose pins moved with the English page's stays fresh", (t) => {
    // The 0.21.0 cut, one page of it.
    const d = tree(t);
    assert.deepEqual(d.stale(), [], "fresh before the write");

    const { restamped, leftStale } = writeVersionPins(d.root, "0.21.0");

    assert.deepEqual(restamped.sort(), LOCALES.map(at).sort());
    assert.deepEqual(leftStale, []);
    assert.deepEqual(d.stale(), []);
    for (const locale of LOCALES) {
        assert.match(d.read(at(locale)), /rebasepro\/server:0\.21\.0/);
    }
});

test("a translation that was already stale is not vouched for", (t) => {
    // `de` was made from an older English page. The write moves its pin like
    // every other locale's, but carrying its stamp forward would certify a
    // translation of a page that no longer exists.
    const older = english(`Build \`backend/Dockerfile\`, then:\n\n${fence("0.20.0")}`);
    const d = tree(t, { locales: { de: translation(sourceHash(older), fence("0.20.0")) } });
    assert.deepEqual(d.stale(), [at("de")], "stale before the write");

    const { restamped, leftStale } = writeVersionPins(d.root, "0.21.0");

    assert.equal(restamped.includes(at("de")), false);
    assert.deepEqual(leftStale, []);
    assert.equal(readSourceHash(d.read(at("de"))), sourceHash(older));
    assert.deepEqual(d.stale(), [at("de")]);
});

test("an unstamped translation stays unstamped", (t) => {
    // Nobody knows which English page it came from; a stamp would be invented.
    const d = tree(t, { locales: { de: translation(null, fence("0.20.0")) } });

    writeVersionPins(d.root, "0.21.0");

    assert.equal(readSourceHash(d.read(at("de"))), null);
    assert.deepEqual(checkTranslationFreshness(d.root).unstamped, [`de/${PAGE}`]);
});

test("a translation whose pins did not move the way English's did stays a finding", (t) => {
    // `de` dropped the code block, so it has no pin to move. `fr` carries the
    // pin twice where English has it once. Both were fresh against the old
    // English page and neither is now a faithful copy of the new one.
    const d = tree(t, {
        locales: {
            de: translation(sourceHash(EN), "Siehe oben."),
            fr: translation(sourceHash(EN), `${fence("0.20.0")}\n\n${fence("0.20.0")}`)
        }
    });

    const { restamped, leftStale } = writeVersionPins(d.root, "0.21.0");

    assert.deepEqual(leftStale.sort(), [at("de"), at("fr")]);
    assert.deepEqual(restamped.sort(), ["es", "it", "pt"].map(at).sort());
    assert.deepEqual(d.stale(), [at("de"), at("fr")]);
});

test("a write that leaves the English page alone leaves every stamp alone", (t) => {
    // English already names the release; `de` lagged a pin behind it. Moving
    // `de`'s pin brings it closer to its source, and its stamp still names the
    // English page exactly.
    const d = tree(t, {
        pin: "0.21.0",
        locales: { de: translation(sourceHash(english(fence("0.21.0"))), fence("0.20.0")) }
    });
    const stamps = LOCALES.map(locale => readSourceHash(d.read(at(locale))));

    const { restamped, leftStale, total } = writeVersionPins(d.root, "0.21.0");

    assert.equal(total, 1);
    assert.deepEqual([restamped, leftStale], [[], []]);
    assert.deepEqual(LOCALES.map(locale => readSourceHash(d.read(at(locale)))), stamps);
    assert.match(d.read(at("de")), /rebasepro\/server:0\.21\.0/);
    assert.deepEqual(d.stale(), []);
});
