import { test } from "node:test";
import assert from "node:assert/strict";
import { fitReleaseNotes, headingAnchor, changelogUrlFor, RELEASE_BODY_LIMIT } from "../fit-release-notes.mjs";

const url = "https://github.com/rebasepro/rebase/blob/v0.25.0/CHANGELOG.md#0250---2026-10-14";
const section = (title, n, size) =>
    `### ${title}\n\n` + Array.from({ length: n }, (_, i) => `- **${title} ${i}.** ${"x".repeat(size)}`).join("\n\n");

test("notes under the limit are left exactly as they are", () => {
    const notes = section("Breaking", 2, 50) + "\n\n" + section("Fixed", 3, 50) + "\n";
    assert.equal(fitReleaseNotes(notes, { version: "0.25.0", changelogUrl: url }), notes);
});

test("notes over the limit keep whole sections, the urgent first, and name what is left out", () => {
    const notes = [section("Breaking", 4, 100), section("Added", 10, 1000), section("Fixed", 80, 1000), section("Security", 2, 100)].join("\n\n");
    const fitted = fitReleaseNotes(notes, { version: "0.25.0", changelogUrl: url, limit: 20_000 });
    assert.ok(fitted.length <= 20_000, `${fitted.length} characters`);
    assert.ok(fitted.indexOf("### Breaking") < fitted.indexOf("### Security"), "Breaking leads, Security follows");
    assert.ok(fitted.includes("### Added"));
    assert.ok(!fitted.includes("### Fixed\n"), "a section that does not fit is not cut in half");
    assert.match(fitted, /- Fixed: 80 entries/);
    assert.ok(fitted.includes(url));
});

test("the real limit is under GitHub's 125,000", () => {
    assert.ok(RELEASE_BODY_LIMIT < 125_000);
});

test("the anchor is the one GitHub gives a version heading", () => {
    assert.equal(headingAnchor("## [0.25.0] - 2026-10-14"), "0250---2026-10-14");
    assert.equal(changelogUrlFor("0.25.0", "# Changelog\n\n## [Unreleased]\n\n## [0.25.0] - 2026-10-14\n"), url);
    assert.equal(changelogUrlFor("0.9.9", "## [0.25.0] - 2026-10-14\n"), "https://github.com/rebasepro/rebase/blob/v0.9.9/CHANGELOG.md");
});
