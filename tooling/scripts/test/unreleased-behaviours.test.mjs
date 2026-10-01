/**
 * Tests for the unreleased-behaviour half of `check-unreleased-badges.mjs`.
 *
 * `rebase dev` regenerating the SDK types on every save is in `[Unreleased]`,
 * and four pages — the quickstart among them — described it as current with no
 * badge. The token rule could not see it: the entry's only backticked lead-in is
 * the flag it removed, and `generated/sdk` has shipped for releases. Each case
 * builds a small tree with a `[Unreleased]` entry, a behaviour naming it, and a
 * page, and asks the gate.
 *
 * Run: node --test tooling/scripts/test/unreleased-behaviours.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkUnreleasedBadges, pruneNotNew } from "../docs-verify/check-unreleased-badges.mjs";

const BEHAVIOURS = "tooling/scripts/docs-verify/unreleased-behaviours.json";
const PAGE = "website/src/content/docs/docs/getting-started/quickstart.md";
const ENTRY = "**`rebase dev --generate` is removed, because what it did is now the default.**";
const badge = `<span class="since-badge" data-since="0.24">Since 0.24</span>`;

const changelog = (unreleasedEntry) => `# Changelog

## [Unreleased]

### Breaking

${unreleasedEntry ? `- ${ENTRY} \`rebase dev\` regenerates the SDK types.\n` : ""}
## [0.23.0] - 2026-09-27

### Fixed

- **A fix.**
${unreleasedEntry ? "" : `- ${ENTRY}\n`}`;

const behaviours = JSON.stringify({
    "`rebase dev` regenerating the SDK types": {
        entry: ENTRY,
        pattern: "regenerates\\b(?:[^.]|\\.(?! )){0,200}?\\btypes (?:in |\\()`generated/sdk/`"
    }
});

const page = (extra = "") => `---
title: Quickstart
---

## Create the Table

Save the file. \`rebase dev\` regenerates
\`backend/src/schema.generated.ts\` and the SDK types in \`generated/sdk/\` from your
collections.
${extra}
## Next

Nothing unreleased here.
`;

/** A tree of `files` (repo-relative path → text), removed when test `t` ends. */
function tree(t, files) {
    const root = mkdtempSync(path.join(os.tmpdir(), "unreleased-behaviours-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
        writeFileSync(path.join(root, rel), text);
    }
    return { root, read: (rel) => readFileSync(path.join(root, rel), "utf8") };
}

test("a section describing an unreleased behaviour without a badge is a finding", (t) => {
    const d = tree(t, { "CHANGELOG.md": changelog(true), [BEHAVIOURS]: behaviours, [PAGE]: page() });

    const { findings } = checkUnreleasedBadges(d.root);

    assert.equal(findings.length, 1);
    assert.equal(findings[0].file, PAGE);
    assert.match(findings[0].message, /"Create the Table" describes `rebase dev` regenerating the SDK types/);
});

test("the same section with a badge passes, and so does the section after it", (t) => {
    const d = tree(t, {
        "CHANGELOG.md": changelog(true),
        [BEHAVIOURS]: behaviours,
        [PAGE]: page(`\n${badge} for the SDK types: on 0.23, run \`rebase generate-sdk\`.\n`)
    });

    assert.deepEqual(checkUnreleasedBadges(d.root).findings, []);
});

test("once a release ships the entry, the behaviour is dead weight and the release deletes it", (t) => {
    const d = tree(t, { "CHANGELOG.md": changelog(false), [BEHAVIOURS]: behaviours, [PAGE]: page() });

    const before = checkUnreleasedBadges(d.root);
    assert.deepEqual(before.deadBehaviours, ["`rebase dev` regenerating the SDK types"]);
    assert.ok(before.findings.some(f => f.file === BEHAVIOURS && /Delete the entry/.test(f.message)));
    // Shipped: the page describes the released version now, so it needs no badge.
    assert.ok(!before.findings.some(f => f.file === PAGE));

    const { pruned } = pruneNotNew(d.root);

    assert.deepEqual(pruned, ["`rebase dev` regenerating the SDK types"]);
    assert.deepEqual(JSON.parse(d.read(BEHAVIOURS)), {});
    assert.deepEqual(checkUnreleasedBadges(d.root).findings, []);
});
