/**
 * Tests for `check-runtime-provided-deps.mjs`, the gate that holds the managed
 * runtime image to what its packages ask of it.
 *
 * The case these exist for: an optional peer of @rebasepro/server missing from
 * the image. The gate printed `google-auth-library` and `ts-morph` under
 * "optional, absent by choice" and passed, while Google sign-in and live schema
 * editing were broken on every managed tenant. An absence now has to be
 * declined on a `not-in-image:` line with a reason, or the gate fails.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
    audit,
    declinedInImage,
    imageDockerfile,
    providedPackages
} from "../check-runtime-provided-deps.mjs";

const server = (peerDependencies, optional = Object.keys(peerDependencies), extra = {}) => ({
    owner: "@rebasepro/server",
    pkg: {
        peerDependencies,
        peerDependenciesMeta: Object.fromEntries(optional.map((dep) => [dep, { optional: true }])),
        ...extra
    }
});

const dockerfile = ({ install = [], decline = [] }) => [
    "RUN npm install --omit=dev \\",
    ...install.map((spec) => `        "${spec}" \\`),
    "    && true",
    "# Each `not-in-image:` line is read by the check.",
    ...decline.map((line) => `#   not-in-image: ${line}`)
].join("\n");

test("a not-in-image line counts only with a reason", () => {
    const declined = declinedInImage(dockerfile({
        decline: ["sharp — native", "@google-cloud/storage — no metadata server", "lonely-package"]
    }));
    assert.deepEqual([...declined.keys()], ["sharp", "@google-cloud/storage"]);
    assert.equal(declined.get("sharp"), "native");
});

test("prose that mentions not-in-image is not a declined package", () => {
    const declined = declinedInImage("# Each `not-in-image:` line is read by tooling — so on.\n");
    assert.equal(declined.size, 0);
});

test("an optional peer the image neither installs nor declines fails", () => {
    const result = audit(
        dockerfile({ install: ["nodemailer@^9.0.0"] }),
        [server({ "nodemailer": "^9.0.0",
"google-auth-library": "^10.7.0" })]
    );
    assert.deepEqual(result.undecided.map((u) => u.dep), ["google-auth-library"]);
    assert.equal(result.declined.length, 0);
});

test("an optional peer declined with a reason passes, and carries the reason", () => {
    const result = audit(
        dockerfile({ decline: ["sharp — native, and managed intake rejects native dependencies"] }),
        [server({ "sharp": "^0.35.4" })]
    );
    assert.deepEqual(result.undecided, []);
    assert.deepEqual(result.staleDeclines, []);
    assert.equal(result.declined[0].reason, "native, and managed intake rejects native dependencies");
});

test("a declined package the image installs anyway is stale", () => {
    const result = audit(
        dockerfile({ install: ["sharp@^0.35.4"],
decline: ["sharp — native"] }),
        [server({ "sharp": "^0.35.4" })]
    );
    assert.deepEqual(result.staleDeclines, [{ dep: "sharp",
installed: true }]);
});

test("a declined package nothing asks for any more is stale", () => {
    const result = audit(dockerfile({ decline: ["left-pad — gone"] }), [server({})]);
    assert.deepEqual(result.staleDeclines, [{ dep: "left-pad",
installed: false }]);
});

test("an absent optionalDependency is npm's shrug, not an undecided feature", () => {
    const result = audit(dockerfile({}), [server({}, [], { optionalDependencies: { fsevents: "^2.3.3" } })]);
    assert.deepEqual(result.undecided, []);
    assert.deepEqual(result.missing, []);
});

test("a required peer that is absent is missing, whatever any line says", () => {
    const result = audit(dockerfile({ decline: ["hono — no"] }), [server({ hono: "^4.12.27" }, [])]);
    assert.deepEqual(result.missing.map((m) => m.dep), ["hono"]);
});

test("the image as it stands passes", () => {
    const result = audit(imageDockerfile(), providedPackages());
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.mismatched, []);
    assert.deepEqual(result.undecided, []);
    assert.deepEqual(result.staleDeclines, []);
});

test("the image without google-auth-library and ts-morph fails, naming both", () => {
    // The incident, replayed against the real files: drop the two install lines
    // that were missing when Google sign-in and live schema editing broke.
    const before = imageDockerfile()
        .split("\n")
        .filter((line) => !/"(google-auth-library|ts-morph)@/.test(line))
        .join("\n");
    const result = audit(before, providedPackages());
    assert.deepEqual(result.undecided.map((u) => u.dep).sort(), ["google-auth-library", "ts-morph"]);
});
