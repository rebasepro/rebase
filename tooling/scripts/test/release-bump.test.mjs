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
 * Run: node --test tooling/scripts/test/release-bump.test.mjs
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

/**
 * A release whose only change is `<what>`, run through the gate quietly.
 *
 * `before` overrides the previous tag's artifacts, for the cases where the
 * baseline itself is what the test is about rather than the change to it.
 */
function run({ version, now, before: baseline, pins = 0 }) {
    const before = {
        [SURFACE]: SURFACE_BEFORE,
        [DERIVED_NAMES]: "posts_pkey\nposts_author_id_fkey\n",
        [MANIFEST]: MANIFEST_TEXT,
        [CHANGELOG]: "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- something\n",
        ...baseline
    };
    const silence = () => {};
    const { log, error } = console;
    console.log = console.error = silence;
    try {
        return checkReleaseBump({
            version,
            from: "v0.13.0",
            readAtTag: file => before[file] ?? null,
            readNow: file => ({ ...before, ...now })[file] ?? null,
            // The template-pin axis has its own suite and its own repository
            // shape; here it is held at "consistent" so these cases stay about
            // the bump level.
            templatePins: () => pins
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

test("a derived identifier re-derived under a new spelling is breaking", () => {
    // The case the axis exists for, and it reaches the check as a REMOVAL: the
    // old name is gone from the file, and every database in the field still
    // carries it.
    assert.equal(run({
        version: "0.13.1",
        now: { [DERIVED_NAMES]: "posts_pkey\nposts_authorId_fkey\n" }
    }), 1);
});

test("a derived identifier disappearing is breaking", () => {
    assert.equal(run({
        version: "0.13.1",
        now: { [DERIVED_NAMES]: "posts_pkey\n" }
    }), 1);
});

test("a NEW derived identifier is not breaking", () => {
    // A name no release has emitted cannot be carried by any database, so it
    // disagrees with nothing. This axis used to compare the file byte-for-byte
    // and fail here, which forced a purely additive release to be cut as a minor
    // AND to carry a `### Breaking` section describing a break that did not
    // exist — 0.17.2 hit exactly that, on one added line for `extension vector`.
    assert.equal(run({
        version: "0.13.1",
        now: { [DERIVED_NAMES]: "posts_pkey\nposts_author_id_fkey\nposts_slug_key\n" }
    }), 0);
});

test("a derived identifier that changes producers is breaking", () => {
    // Same name, emitted by a different path: a database provisioned by boot no
    // longer matches one provisioned by push.
    assert.equal(run({
        version: "0.13.1",
        before: { [DERIVED_NAMES]: "posts_pkey [boot,push]\n" },
        now: { [DERIVED_NAMES]: "posts_pkey [push]\n" }
    }), 1);
});

test("either contract constant moving is breaking", () => {
    assert.equal(run({
        version: "0.13.1",
        now: { [MANIFEST]: MANIFEST_TEXT.replace("BUNDLE_FORMAT_VERSION = 2", "BUNDLE_FORMAT_VERSION = 3") }
    }), 1);
});

test("a missing artifact at the previous tag stops the release", () => {
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
    // Reported AND fatal. It used to be reported and pass, which reads in a log
    // as "· unguarded" followed by "✓ Nothing breaking" — a blind axis and a
    // clean one, indistinguishable. For 0.17.0 `server.api.txt` had moved
    // `api-surface/` → `contracts/`, so that axis compared nothing while the
    // release removed two members of `RebaseBackendConfig`.
    assert.equal(code, 1);
    for (const file of [SURFACE, DERIVED_NAMES, MANIFEST]) {
        assert.match(messages.join("\n"), new RegExp(`${file.replace(/[.\/]/g, "\\$&")}.*unguarded`));
    }
});

test("--allow-unguarded is how someone says they checked it another way", () => {
    const { log, error } = console;
    console.log = console.error = () => {};
    try {
        assert.equal(checkReleaseBump({
            version: "0.13.1",
            from: "v0.13.0",
            allowUnguarded: true,
            readAtTag: () => null,
            readNow: () => "whatever"
        }), 0);
    } finally {
        console.log = log;
        console.error = error;
    }
});

test("a template naming something the release does not publish stops it", () => {
    // Not a `break`: a break can ship deliberately as a minor with a note, and
    // there is no deliberate version of publishing a scaffold that cannot boot.
    // So neither the level nor the changelog can talk it round.
    assert.equal(run({ version: "0.13.1", now: {}, pins: 1 }), 1);
    assert.equal(run({
        version: "0.14.0",
        now: {},
        before: { [CHANGELOG]: "# Changelog\n\n## [Unreleased]\n\n### Breaking\n\n- a break\n" },
        pins: 1
    }), 1);
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
