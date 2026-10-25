/**
 * Tests for `docs-verify/check-declared-types.mjs`.
 *
 * A fence that declares `interface CronJobDefinition { name: string; … }` always
 * compiles, so the snippet stage could never say that `name` is optional in the
 * real type or that a member was invented. This holds those fences to the
 * declaration the package exports.
 *
 * The docs are read from a fixture; the types resolve against this repository.
 *
 * Run: node --test tooling/scripts/test/declared-types.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { checkDeclaredTypes } from "../docs-verify/check-declared-types.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function findingsOf(markdown) {
    const docsRoot = fs.mkdtempSync(path.join(os.tmpdir(), "declared-types-"));
    fs.writeFileSync(path.join(docsRoot, "page.md"), markdown);
    const { findings } = checkDeclaredTypes(ROOT, {
        globs: ["page.md"],
        docsRoot
    });
    return findings.map(({ type, member, line, message }) => ({
        type,
        member,
        line,
        message
    }));
}

const fence = (body, meta = "") => "# Page\n\n```ts" + (meta ? " " + meta : "") + "\n" + body + "\n```\n";

test("a member the real type does not have is reported, on its line", () => {
    const found = findingsOf(fence("interface AuthenticatedUser {\n    uid: string;\n    seedDefaultRoles: boolean;\n}"));
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.equal(found[0].member, "seedDefaultRoles");
    assert.equal(found[0].line, 6);
    assert.match(found[0].message, /not a member of `AuthenticatedUser`/);
});

test("a member documented required that the type declares optional is reported", () => {
    const found = findingsOf(fence("interface CronJobDefinition {\n    name: string;\n    schedule: string;\n}"));
    assert.deepEqual(found.map(f => f.member), ["name"]);
    assert.match(found[0].message, /optional in @rebasepro\/types; the doc declares it required/);
});

test("a member documented optional that the type requires is reported", () => {
    const found = findingsOf(fence("interface CronJobDefinition {\n    schedule?: string;\n}"));
    assert.deepEqual(found.map(f => f.member), ["schedule"]);
    assert.match(found[0].message, /required in @rebasepro\/types; the doc declares it optional/);
});

test("leaving members out is an abridgement, not a finding", () => {
    assert.deepEqual(findingsOf(fence("interface CronJobDefinition {\n    name?: string;\n}")), []);
});

test("a `type X = { … }` literal is read like an interface", () => {
    const found = findingsOf(fence("type CronJobDefinition = {\n    name?: string;\n    invented: number;\n};"));
    assert.deepEqual(found.map(f => f.member), ["invented"]);
});

test("a no-verify fence is still held to the type it spells out", () => {
    const found = findingsOf(fence("interface CronJobDefinition {\n    name: string;\n}", "no-verify"));
    assert.deepEqual(found.map(f => f.member), ["name"]);
});

test("a type of the reader's own, sharing no name with an export, is left alone", () => {
    assert.deepEqual(findingsOf(fence("interface MyBlogPostWithTags {\n    anything: string;\n}")), []);
});

test("the own-type marker exempts a reader's type that shares a name with ours", () => {
    const md = "# Page\n\n<!-- docs-verify: own-type -->\n```ts\ninterface CronJobDefinition {\n    name: string;\n}\n```\n";
    assert.deepEqual(findingsOf(md), []);
});
