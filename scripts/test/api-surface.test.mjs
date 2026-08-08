/**
 * Tests for the API-surface gate.
 *
 * A gate nobody tests is a gate that quietly stops gating, and this one had
 * stopped: `memberNames` read `decl.type?.members`, which is null for a type
 * *reference*, so `export declare const rebase: RebaseServerClient` was recorded
 * as the bare line `const rebase`. A bare entry has no members to lose, so the
 * diff's `goneMembers` was empty by construction — dropping `rebase.email`
 * printed "✓ API surface unchanged" while every tenant hook calling it was one
 * fleet rollout away from throwing at runtime.
 *
 * So the fixture is a barrel whose surface changes in exactly the ways the gate
 * exists to catch, and the assertions are on the gate's *exit code*, since that
 * is the only thing CI reads.
 *
 * Run: node --test scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { extractSurface, renderAll } from "../api-surface.mjs";
import { checkApiSurface } from "../check-api-surface.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIXTURES = "scripts/test/fixtures/api-surface";

const before = { pkg: "@fixture/barrel", dts: `${FIXTURES}/before.d.ts` };
const after = { pkg: "@fixture/barrel", dts: `${FIXTURES}/after.d.ts` };
/** Only `rebase.email` is gone — no exported declaration differs by a byte. */
const afterSingletonOnly = { pkg: "@fixture/barrel", dts: `${FIXTURES}/after-singleton-only.d.ts` };

/** The baseline as it would have been committed at the previous release. */
function baselineOf(target) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "api-surface-"));
    const file = path.join(dir, "fixture.api.txt");
    fs.writeFileSync(file, renderAll([target]));
    return file;
}

function lineFor(surface, key) {
    return surface.split("\n").find(line => line.startsWith(`${key} `) || line === key);
}

test("the singleton renders with its members, not as a bare name", () => {
    const surface = extractSurface(before);
    assert.equal(
        lineFor(surface, "const rebase"),
        "const rebase { auth, dataAsAdmin, email }",
        "the singleton's type is a reference to an unexported interface — resolving it is the whole point"
    );
});

test("members inherited through an unexported base are surface too", () => {
    const surface = extractSurface(before);
    assert.equal(
        lineFor(surface, "interface FixtureRepository"),
        "interface FixtureRepository { createUser, deleteUser }"
    );
});

test("ambient members belong to the platform, not to the package", () => {
    const line = lineFor(extractSurface(before), "class FixtureError");
    assert.equal(line, "class FixtureError { hint, notFound }",
        "own instance members and statics, and nothing off Error");
    for (const ambient of ["stack", "message", "captureStackTrace"]) {
        assert.ok(!line.includes(ambient), `${ambient} is not this package's to remove`);
    }
});

test("an unchanged surface passes", () => {
    assert.equal(checkApiSurface({ baseline: baselineOf(before), targets: [before] }), 0);
});

test("a removed member fails the gate as a contract break", () => {
    const baseline = baselineOf(before);
    const messages = [];
    const error = console.error;
    const log = console.log;
    console.error = console.log = (...args) => messages.push(args.join(" "));
    let code;
    try {
        code = checkApiSurface({ baseline, targets: [after] });
    } finally {
        console.error = error;
        console.log = log;
    }
    const output = messages.join("\n");

    assert.equal(code, 1);
    assert.match(output, /lost public members/);
    assert.match(output, /const rebase — lost email/);
    assert.match(output, /interface FixtureRepository — lost deleteUser/,
        "inherited through a base that is not itself exported");
    assert.match(output, /class FixtureError — lost notFound/, "a static is surface too");
    assert.match(output, /fail to boot/, "the classification has to say what a removal costs");
});

test("the gate exits non-zero when only the singleton lost a member", () => {
    // The exit code is the only thing CI reads, and this is the case that used to
    // exit 0: `rebase.email` is gone and no exported declaration changed, so a
    // renderer reading syntax sees an identical surface.
    const baseline = baselineOf(before);
    const driver =
        `const { checkApiSurface } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, "scripts/check-api-surface.mjs")).href)});\n` +
        `process.exit(checkApiSurface({ baseline: ${JSON.stringify(baseline)}, targets: ${JSON.stringify([afterSingletonOnly])} }));`;
    const run = spawnSync(process.execPath, ["--input-type=module", "-e", driver], { cwd: ROOT, encoding: "utf8" });
    assert.equal(run.status, 1, `expected a failing exit code, got ${run.status}\n${run.stdout}${run.stderr}`);
});

test("a gained member fails too, so the baseline cannot drift a member at a time", () => {
    // `CollectionSubscriptionConfig` gained `searchExplain` with this gate green,
    // because only whole new *exports* counted as an addition.
    const messages = [];
    const log = console.log;
    console.log = (...args) => messages.push(args.join(" "));
    let code;
    try {
        code = checkApiSurface({ baseline: baselineOf(after), targets: [before] });
    } finally {
        console.log = log;
    }
    assert.equal(code, 1);
    assert.match(messages.join("\n"), /const rebase — gained email/);
    assert.match(messages.join("\n"), /Additions only — no contract break/);
});

test("mustHaveMembers refuses a render that went blind again", () => {
    assert.throws(
        () => extractSurface({ ...before, mustHaveMembers: ["fixtureHelper"] }),
        /rendered with no members/,
        "the floor is what stops this gate from silently returning to bare names"
    );
});
