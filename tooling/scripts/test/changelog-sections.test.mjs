/**
 * Tests for `docs-verify/check-changelog-sections.mjs`.
 *
 * With no `## [Unreleased]` heading at all the check returned no findings: the
 * one section it exists to keep in shape was gone, and it called that clean.
 * `prepare-changelog.mjs` always leaves a fresh `## [Unreleased]` at the top,
 * so a missing one is a heading someone misspelt — and the release cut then
 * refuses, at release time, with nothing having said so before.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkChangelogSections } from "../docs-verify/check-changelog-sections.mjs";

function changelog(text) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "changelog-sections-"));
    fs.writeFileSync(path.join(root, "CHANGELOG.md"), text);
    return root;
}

test("a changelog with no ## [Unreleased] is a finding, not a clean pass", () => {
    const { findings } = checkChangelogSections(changelog(
        "# Changelog\n\n## Unreleased\n\n### Fixed\n\n- a fix\n\n## [0.22.0] - 2026-09-20\n"
    ));
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /no `## \[Unreleased\]` section/);
});

test("a well-formed [Unreleased] section passes", () => {
    const { findings } = checkChangelogSections(changelog(
        "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- a thing\n\n### Fixed\n\n- a fix\n\n## [0.22.0] - 2026-09-20\n"
    ));
    assert.deepEqual(findings, []);
});

test("an empty [Unreleased], as a release leaves it, passes", () => {
    const { findings } = checkChangelogSections(changelog("# Changelog\n\n## [Unreleased]\n\n## [0.22.0] - 2026-09-20\n"));
    assert.deepEqual(findings, []);
});
