/**
 * Tests for the publishable-set derivation and its gate.
 *
 * The failure these exist for produced no error anywhere: `publish.yml` named
 * its packages as literal paths, one of those directories moved, pnpm matched
 * nothing and **exited 0**, and `@rebasepro/agent-skills` fell out of four
 * releases while every job stayed green. The CLI, which depends on it as
 * `workspace:*`, then published a `"0.16.0"` pin nobody wrote.
 *
 * So the assertions are about *completeness* — does the derivation find a
 * package wherever it lives, and does the gate notice one left behind — driven
 * against synthetic workspaces on disk, because the globbing and the YAML
 * parsing are the parts that broke and a mocked filesystem would not exercise
 * them.
 *
 * Run: node --test tooling/scripts/test/publishable-set.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { workspaceGlobs, workspacePackages, publishablePackages, setVersion } from "../publishable-packages.mjs";
import { checkPublishableSet, RELEASE_FILES, WORKFLOW } from "../check-publishable-set.mjs";

/** A workflow that does everything right, so a test can vary one thing. */
const GOOD_WORKFLOW = `
      - name: Bump versions
        run: node tooling/scripts/publishable-packages.mjs --set-version "$VERSION"
      - name: Pack
        run: for pkg_dir in $(node tooling/scripts/publishable-packages.mjs --dirs); do :; done
      - name: Publish
        run: pnpm -r publish --no-git-checks --access public
`;

/**
 * Build a workspace on disk.
 *
 * @param {Record<string, object>} pkgs  dir → package.json contents
 * @param {string[]} globs               the `packages:` block
 */
function workspace(pkgs, globs = ["packages/*", "tooling/thing"]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-pubset-"));
    fs.writeFileSync(
        path.join(root, "pnpm-workspace.yaml"),
        `trustLockfile: true\npackages:\n${globs.map(g => `  - ${g}\n`).join("")}allowBuilds:\n  atlas: true\n`
    );
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "root", private: true }));
    for (const [dir, manifest] of Object.entries(pkgs)) {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
        fs.writeFileSync(path.join(root, dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    for (const rel of RELEASE_FILES) {
        fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
        fs.writeFileSync(path.join(root, rel), GOOD_WORKFLOW);
    }
    return root;
}

/** A well-formed publishable manifest. */
const ok = (name, version = "1.0.0", extra = {}) =>
    ({ name, version, files: ["dist"], ...extra });

test("workspaceGlobs reads the packages block and stops at the next key", () => {
    const root = workspace({}, ["packages/*", "tooling/thing", "app"]);
    assert.deepEqual(workspaceGlobs(root), ["packages/*", "tooling/thing", "app"]);
});

test("workspaceGlobs refuses a shape it might misread rather than guessing", () => {
    const root = workspace({});
    fs.writeFileSync(
        path.join(root, "pnpm-workspace.yaml"),
        "packages:\n  - packages/*\n  nested:\n    - oops\n"
    );
    assert.throws(() => workspaceGlobs(root), /not a plain list item/);
});

test("the derivation finds a package wherever the workspace puts it", () => {
    // The regression in one assertion: the package under `tooling/` must be
    // found by exactly the same call that finds the ones under `packages/`.
    const root = workspace({
        "packages/cli": ok("@rebasepro/cli"),
        "tooling/thing": ok("@rebasepro/agent-skills")
    });
    assert.deepEqual(publishablePackages(root).map(p => p.name),
        ["@rebasepro/agent-skills", "@rebasepro/cli"]);
});

test("private packages are workspace members but never publishable", () => {
    const root = workspace({
        "packages/cli": ok("@rebasepro/cli"),
        "packages/app": { name: "@rebasepro/app", version: "1.0.0", private: true }
    });
    assert.equal(workspacePackages(root).length, 2);
    assert.deepEqual(publishablePackages(root).map(p => p.name), ["@rebasepro/cli"]);
});

test("setVersion moves every publishable package and leaves private ones alone", () => {
    const root = workspace({
        "packages/cli": ok("@rebasepro/cli", "0.17.2"),
        "tooling/thing": ok("@rebasepro/agent-skills", "0.16.0"),
        "packages/app": { name: "@rebasepro/app", version: "0.0.1", private: true }
    });
    const changed = setVersion("0.18.0", root);

    assert.deepEqual(changed.map(c => c.name).sort(), ["@rebasepro/agent-skills", "@rebasepro/cli"]);
    assert.deepEqual([...new Set(publishablePackages(root).map(p => p.version))], ["0.18.0"]);
    const app = JSON.parse(fs.readFileSync(path.join(root, "packages/app/package.json"), "utf8"));
    assert.equal(app.version, "0.0.1", "a private package is not part of the release");
});

test("setVersion refuses something that is not a version", () => {
    const root = workspace({ "packages/cli": ok("@rebasepro/cli") });
    assert.throws(() => setVersion("latest", root), /Not a version/);
});

/* ── The gate ─────────────────────────────────────────────────────── */

const messages = (root, workflow) =>
    checkPublishableSet({ root, sources: workflow ? { [WORKFLOW]: workflow } : undefined })
        .map(f => f.message);

test("a workspace in lockstep, derived by the workflow, is clean", () => {
    const root = workspace({
        "packages/cli": ok("@rebasepro/cli", "0.17.2"),
        "tooling/thing": ok("@rebasepro/agent-skills", "0.17.2")
    });
    assert.deepEqual(checkPublishableSet({ root }), []);
});

test("a package left behind by the bump is a finding", () => {
    // Exactly the incident: 21 packages moved, one did not.
    const root = workspace({
        "packages/cli": ok("@rebasepro/cli", "0.17.2"),
        "tooling/thing": ok("@rebasepro/agent-skills", "0.16.0")
    });
    const found = checkPublishableSet({ root });
    assert.equal(found.length, 1);
    assert.match(found[0].message, /not in lockstep/);
    // It has to name the straggler and the version everything else is at,
    // or the person reading CI cannot tell which package to bump.
    assert.match(found[0].detail, /@rebasepro\/agent-skills is at 0\.16\.0, not 0\.17\.2/);
});

test("the straggler is the one left behind, not the one in the minority", () => {
    // A 1-1 split has no majority. The first draft picked by count and named the
    // up-to-date package as the straggler — a message that sends whoever reads
    // CI to edit the one file that was correct.
    const root = workspace({
        "packages/cli": ok("@rebasepro/cli", "0.17.2"),
        "tooling/thing": ok("@rebasepro/agent-skills", "0.16.0")
    });
    const [finding] = checkPublishableSet({ root });
    assert.match(finding.detail, /@rebasepro\/agent-skills is at 0\.16\.0, not 0\.17\.2/);
    assert.doesNotMatch(finding.detail, /@rebasepro\/cli is at/);
});

test("a path filter in the workflow is a finding even when versions agree", () => {
    // The cause, caught one layer before the symptom — this is what would have
    // failed on the commit that moved the directory.
    const root = workspace({ "packages/cli": ok("@rebasepro/cli") });
    const found = messages(root, `
        run: pnpm --filter './packages/*' --filter './rebase-agent-skills' -r publish
        run: node tooling/scripts/publishable-packages.mjs --set-version "$V"
    `);
    assert.equal(found.length, 1);
    assert.match(found[0], /selects packages by path/);
});

test("a hand-written loop is a finding whatever the variable is called", () => {
    // publish.yml looped on `pkg_dir`; the workspace-protocol validator looped
    // on `pkg_json`. Matching only the first name would let the second through,
    // which is how one hand-written list survived the fix for the other.
    const root = workspace({ "packages/cli": ok("@rebasepro/cli") });
    for (const variable of ["pkg_dir", "pkg_json", "p"]) {
        const found = messages(root, `
        run: |
          for ${variable} in packages/*/package.json tooling/rebase-agent-skills/package.json; do :; done
          node tooling/scripts/publishable-packages.mjs --dirs
    `);
        assert.deepEqual(found, [`${WORKFLOW} iterates a hand-written list of packages.`],
            `loop variable ${variable}`);
    }
});

test("a loop over the derivation is not a finding", () => {
    const root = workspace({ "packages/cli": ok("@rebasepro/cli") });
    assert.deepEqual(messages(root, `
        run: for pkg_dir in $(node tooling/scripts/publishable-packages.mjs --dirs); do :; done
    `), []);
});

test("a loop over something that is not packages is left alone", () => {
    // The check must not fire on every `for` in a release script.
    const root = workspace({ "packages/cli": ok("@rebasepro/cli") });
    assert.deepEqual(messages(root, `
        run: |
          for tag in latest canary; do :; done
          node tooling/scripts/publishable-packages.mjs --dirs
    `), []);
});

test("a workflow that never derives the set at all is a finding", () => {
    const root = workspace({ "packages/cli": ok("@rebasepro/cli") });
    const found = messages(root, "        run: pnpm -r publish\n");
    assert.deepEqual(found, [`${WORKFLOW} never consults publishable-packages.mjs.`]);
});

test("release.sh is held to the same rule as the workflow", () => {
    // It carried the identical two filters, under a comment asking them to
    // "MUST match" the workflow's — so checking only the workflow would have
    // left half the release still enumerating itself by hand.
    const root = workspace({ "packages/cli": ok("@rebasepro/cli") });
    const found = checkPublishableSet({
        root,
        sources: { "tooling/scripts/release.sh": "pnpm --filter './packages/*' -r publish\n" }
    });
    assert.equal(found.length, 2, "one for the path filter, one for never deriving");
    assert.ok(found.every(f => f.message.startsWith("tooling/scripts/release.sh")),
        `both findings name release.sh, got: ${found.map(f => f.message).join(" | ")}`);
});

test("a publishable @rebasepro package outside the workspace is a finding", () => {
    // The next version of this bug: a package added where no glob reaches it.
    const root = workspace({ "packages/cli": ok("@rebasepro/cli") });
    fs.mkdirSync(path.join(root, "tools/newthing"), { recursive: true });
    fs.writeFileSync(path.join(root, "tools/newthing/package.json"),
        JSON.stringify(ok("@rebasepro/newthing")));

    const found = checkPublishableSet({ root });
    assert.equal(found.length, 1);
    assert.match(found[0].message, /not workspace members/);
    assert.match(found[0].detail, /@rebasepro\/newthing/);
});

test("node_modules, dist and scaffold templates are not strays", () => {
    const root = workspace({ "packages/cli": ok("@rebasepro/cli") });
    for (const dir of ["node_modules/@rebasepro/x", "packages/cli/dist", "packages/cli/templates/template"]) {
        fs.mkdirSync(path.join(root, dir), { recursive: true });
        fs.writeFileSync(path.join(root, dir, "package.json"), JSON.stringify(ok("@rebasepro/whatever")));
    }
    assert.deepEqual(checkPublishableSet({ root }), []);
});

test("a new package with no `files` is a finding", () => {
    const root = workspace({
        "packages/cli": ok("@rebasepro/cli"),
        "tooling/thing": { name: "@rebasepro/agent-skills", version: "1.0.0" }
    });
    const found = messages(root);
    assert.deepEqual(found, ["@rebasepro/agent-skills declares no `files`"]);
});

test("a stale repository.directory is a finding", () => {
    // The same move left this pointing at a directory that no longer existed.
    const root = workspace({
        "tooling/thing": ok("@rebasepro/agent-skills", "1.0.0", {
            repository: { type: "git", url: "…", directory: "rebase-agent-skills" }
        })
    });
    const found = messages(root);
    assert.deepEqual(found, ['@rebasepro/agent-skills declares repository.directory "rebase-agent-skills"']);
});

test("a correct repository.directory passes", () => {
    const root = workspace({
        "tooling/thing": ok("@rebasepro/agent-skills", "1.0.0", {
            repository: { type: "git", url: "…", directory: "tooling/thing" }
        })
    });
    assert.deepEqual(checkPublishableSet({ root }), []);
});

test("an empty derivation throws rather than reporting clean", () => {
    // A derivation that finds nothing must never read as "nothing is wrong" —
    // that is the failure mode this whole file exists to remove.
    const root = workspace({});
    assert.throws(() => checkPublishableSet({ root }), /empty publishable set/);
});
