/**
 * Tests for `docs-verify/check-stale-version-notes.mjs`: which notes about an
 * older release it flags, and which statements about old versions it leaves.
 *
 * Run: node --test tooling/scripts/test/stale-version-notes.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { latestRelease, staleNotes } from "../docs-verify/check-stale-version-notes.mjs";

const LATEST = [0, 29];
const flagged = text => staleNotes(text.split("\n"), LATEST).map(note => note.version);

test("flags a note about how an older release behaves, in each shape a badge left", () => {
    assert.deepEqual(flagged("On 0.24 `CollectionPanel` takes only a registered `path`."), ["0.24"]);
    assert.deepEqual(flagged("It is the panel's own.\nOn 0.24\n`CollectionPanel` takes only a path."), ["0.24"]);
    assert.deepEqual(flagged("at every door (on 0.24 the data API answers `UNAUTHORIZED`)."), ["0.24"]);
    assert.deepEqual(flagged("exits 1; on 0.24 it says \"Nothing was changed.\""), ["0.24"]);
    assert.deepEqual(flagged("| lists the scopes, on 0.28.1 none |"), ["0.28"]);
    assert.deepEqual(flagged("`timezone` is new — on 0.17.3 a schedule is read in UTC."), ["0.17"]);
    assert.deepEqual(flagged("the release before (on\n0.24) describes the stable release."), ["0.24"]);
});

test("leaves a note about the latest release, and what an old version made", () => {
    assert.deepEqual(flagged("On 0.29 the form saves on Enter."), []);
    assert.deepEqual(flagged("In a project scaffolded on 0.24, copy that loop."), []);
    assert.deepEqual(flagged("Entries recorded before 0.25 keep the whole previous row."), []);
    assert.deepEqual(flagged("Queues shipped in 0.18, topics in 0.17."), []);
});

test("reads prose only: not code spans, not fenced code", () => {
    assert.deepEqual(flagged("Pin it: `on 0.24 run x`."), []);
    assert.deepEqual(flagged("```sh\n# On 0.24 this was different\n```"), []);
});

test("takes the latest release from the changelog's first released heading", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "notes-"));
    fs.writeFileSync(path.join(dir, "CHANGELOG.md"), "# Changelog\n\n## [Unreleased]\n\n## [0.29.1] - 2026-11-09\n\n## [0.29.0]\n");
    assert.deepEqual(latestRelease(dir), [0, 29]);
});
