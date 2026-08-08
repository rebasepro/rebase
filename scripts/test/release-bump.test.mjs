/**
 * Tests for the release-bump gate.
 *
 * The failure it exists for has no compile error and no red test anywhere: a
 * release removes an export, ships as 0.13.1 because `patch` is the workflow's
 * default, and every consumer on `^0.13.0` installs it. So the assertions are on
 * the exit code for each combination of (what the diff did) × (what the bump
 * claims), driven through the injected readers rather than a repository shaped
 * like a release.
 *
 * Run: node --test scripts/test/release-bump.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
    checkReleaseBump, bumpLevel, unreleasedSection, contractConstants,
    SURFACE, DERIVED_NAMES, MANIFEST, CHANGELOG
} from "../check-release-bump.mjs";

const SURFACE_BEFORE = [
    "## @rebasepro/server",
    "const rebase { auth, dataAsAdmin, email }",
    "function defineFunction"
].join("\n");

const MANIFEST_TEXT = "export const BUNDLE_FORMAT_VERSION = 2;\nexport const RUNTIME_CONTRACT_VERSION = 1;\n";

/** A release whose only change is `<what>`, run through the gate quietly. */
function run({ version, now }) {
    const before = {
        [SURFACE]: SURFACE_BEFORE,
        [DERIVED_NAMES]: "posts_pkey\nposts_author_id_fkey\n",
        [MANIFEST]: MANIFEST_TEXT,
        [CHANGELOG]: "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- something\n"
    };
    const silence = () => {};
    const { log, error } = console;
    console.log = console.error = silence;
    try {
        return checkReleaseBump({
            version,
            from: "v0.13.0",
            readAtTag: file => before[file] ?? null,
            readNow: file => ({ ...before, ...now })[file] ?? null
        });
    } finally {
        console.log = log;
        console.error = error;
    }
}

test("bumpLevel reads the position that moved", () => {
    assert.equal(bumpLevel("0.13.0", "0.13.1"), "patch");
    assert.equal(bumpLevel("0.13.0", "0.14.0"), "minor");
    assert.equal(bumpLevel("0.13.0", "1.0.0"), "major");
});

test("an unchanged release passes as a patch", () => {
    assert.equal(run({ version: "0.13.1", now: {} }), 0);
});

test("an added export is not breaking", () => {
    assert.equal(run({
        version: "0.13.1",
        now: { [SURFACE]: `${SURFACE_BEFORE}\nfunction defineCron` }
    }), 0);
});

test("a removed export cannot ship as a patch", () => {
    assert.equal(run({
        version: "0.13.1",
        now: { [SURFACE]: SURFACE_BEFORE.replace("\nfunction defineFunction", "") }
    }), 1);
});

test("a member lost from the singleton cannot ship as a patch either", () => {
    // The case the surface gate itself could not see until it resolved types:
    // `const rebase` is still exported, and `rebase.email` is gone.
    assert.equal(run({
        version: "0.13.1",
        now: { [SURFACE]: SURFACE_BEFORE.replace(", email", "") }
    }), 1);
});

test("a minor still needs the break declared in the changelog", () => {
    const removed = { [SURFACE]: SURFACE_BEFORE.replace("\nfunction defineFunction", "") };
    assert.equal(run({ version: "0.14.0", now: removed }), 1,
        "a minor with no ### Breaking heading is a break users read about nowhere");

    assert.equal(run({
        version: "0.14.0",
        now: {
            ...removed,
            [CHANGELOG]: "# Changelog\n\n## [Unreleased]\n\n### Breaking\n\n- `defineFunction` is gone.\n"
        }
    }), 0);
});

test("a ### Breaking heading in an older section does not count", () => {
    assert.equal(run({
        version: "0.14.0",
        now: {
            [SURFACE]: SURFACE_BEFORE.replace("\nfunction defineFunction", ""),
            [CHANGELOG]: "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [0.13.0]\n\n### Breaking\n\n- old news\n"
        }
    }), 1);
});

test("a derived identifier changing at all is breaking", () => {
    assert.equal(run({
        version: "0.13.1",
        now: { [DERIVED_NAMES]: "posts_pkey\nposts_authorId_fkey\n" }
    }), 1);
});

test("either contract constant moving is breaking", () => {
    assert.equal(run({
        version: "0.13.1",
        now: { [MANIFEST]: MANIFEST_TEXT.replace("BUNDLE_FORMAT_VERSION = 2", "BUNDLE_FORMAT_VERSION = 3") }
    }), 1);
});

test("a missing artifact at the previous tag is reported, not passed over", () => {
    const messages = [];
    const { log, error } = console;
    console.log = console.error = (...args) => messages.push(args.join(" "));
    let code;
    try {
        code = checkReleaseBump({
            version: "0.13.1",
            from: "v0.13.0",
            readAtTag: () => null,
            readNow: () => "whatever"
        });
    } finally {
        console.log = log;
        console.error = error;
    }
    assert.equal(code, 0);
    for (const file of [SURFACE, DERIVED_NAMES, MANIFEST]) {
        assert.match(messages.join("\n"), new RegExp(`${file.replace(/[.\/]/g, "\\$&")}.*unguarded`));
    }
});

test("the check refuses to run without a version or a tag", () => {
    const { error } = console;
    console.error = () => {};
    try {
        assert.equal(checkReleaseBump({ version: "not-a-version", from: "v0.13.0" }), 2);
        assert.equal(checkReleaseBump({ version: "0.13.1", from: null }), 2);
    } finally {
        console.error = error;
    }
});

test("the changelog and manifest parsers read the real files' shapes", () => {
    assert.equal(unreleasedSection("# C\n\n## [Unreleased]\n\n### Added\n\n- x\n\n## [0.13.0] - 2026-01-01\n\n- y\n").includes("0.13.0"), false);
    assert.equal(unreleasedSection("# C\n\n## [0.13.0]\n\n- y\n"), null);
    assert.deepEqual(contractConstants(MANIFEST_TEXT), { BUNDLE_FORMAT_VERSION: "2", RUNTIME_CONTRACT_VERSION: "1" });
    assert.equal(contractConstants(null), null);
});
