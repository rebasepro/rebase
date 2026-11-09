/**
 * Tests for `pre-push-guard.mjs`, in a throwaway repository with a bare
 * remote. The gates are stand-ins (`node -e "process.exit(n)"`): what is
 * tested is when the guard runs them, what it refuses, and that git calls
 * it as a pre-push hook — the gates themselves are CI's.
 *
 * Run: node --test tooling/scripts/test/pre-push-guard.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { guard, mainUpdates, parseUpdates } from "../pre-push-guard.mjs";

const GUARD = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "pre-push-guard.mjs");
const PASS = ["node", ["-e", "process.exit(0)"]];
const FAIL = ["node", ["-e", "console.log('gate output'); process.exit(1)"]];
const ZERO = "0".repeat(40);

function sh(cwd, ...args) {
    return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).trim();
}

/** A repository with one commit on main, pushed to a bare remote, and a second commit not pushed. */
function repo() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prepush-"));
    const remote = path.join(dir, "remote.git");
    const work = path.join(dir, "work");
    sh(dir, "init", "-q", "--bare", "-b", "main", remote);
    sh(dir, "init", "-q", "-b", "main", work);
    fs.writeFileSync(path.join(work, "a.txt"), "one\n");
    sh(work, "add", "a.txt");
    sh(work, "commit", "-q", "-m", "first");
    sh(work, "remote", "add", "origin", remote);
    sh(work, "push", "-q", "origin", "main");
    const base = sh(work, "rev-parse", "HEAD");
    fs.writeFileSync(path.join(work, "a.txt"), "two\n");
    sh(work, "commit", "-q", "-am", "second");
    return { dir, work, remote, base, head: sh(work, "rev-parse", "HEAD") };
}

/** What the guard writes, and how it decides. */
async function decide(r, stdin, options = {}) {
    let written = "";
    const code = await guard({ stdin, cwd: r.work, env: {}, quick: [PASS], slow: [PASS], out: { write: text => { written += text; } }, ...options });
    return { code, written };
}

test("reads git's update lines and keeps only the ones that move main", () => {
    const updates = parseUpdates(`refs/heads/x abc refs/heads/main def\nrefs/heads/y abc refs/heads/feature def\n(delete) ${ZERO} refs/heads/main def\n`);
    assert.equal(updates.length, 3);
    assert.deepEqual(mainUpdates(updates).map(update => update.localRef), ["refs/heads/x"]);
});

test("lets a clean push of HEAD to main through, after listing its commits", async () => {
    const r = repo();
    const { code, written } = await decide(r, `refs/heads/main ${r.head} refs/heads/main ${r.base}\n`);
    assert.equal(code, 0);
    assert.match(written, /1 commit\(s\) going to main:\n {2}[0-9a-f]+ t .* second/);
    assert.match(written, /the fast gates pass/);
});

test("refuses on a failing quick gate before running the slow ones", async () => {
    const r = repo();
    const marker = path.join(r.dir, "slow-ran");
    const slow = [["node", ["-e", `require("fs").writeFileSync(${JSON.stringify(marker)}, "")`]]];
    const { code, written } = await decide(r, `refs/heads/main ${r.head} refs/heads/main ${r.base}\n`, { quick: [FAIL], slow });
    assert.equal(code, 1);
    assert.equal(fs.existsSync(marker), false);
    assert.match(written, /refused — CI would fail on this/);
});

test("refuses on a failing slow gate", async () => {
    const r = repo();
    const { code, written } = await decide(r, `refs/heads/main ${r.head} refs/heads/main ${r.base}\n`, { slow: [PASS, FAIL] });
    assert.equal(code, 1);
    assert.match(written, /refused after \d+s/);
});

test("refuses when HEAD is not the commit being pushed, or a tracked file is modified", async () => {
    const r = repo();
    const other = await decide(r, `refs/heads/main ${r.base} refs/heads/main ${ZERO}\n`);
    assert.equal(other.code, 1);
    assert.match(other.written, /HEAD is [0-9a-f]{10}, but you are pushing/);

    fs.writeFileSync(path.join(r.work, "a.txt"), "dirty\n");
    const dirty = await decide(r, `refs/heads/main ${r.head} refs/heads/main ${r.base}\n`);
    assert.equal(dirty.code, 1);
    assert.match(dirty.written, /tracked files are modified[\s\S]*a\.txt/);
});

test("runs nothing for a push that does not move main, or with the emergency skip", async () => {
    const r = repo();
    const branch = await decide(r, `refs/heads/main ${r.head} refs/heads/feature ${ZERO}\n`, { quick: [FAIL], slow: [FAIL] });
    assert.equal(branch.code, 0);
    assert.equal(branch.written, "");
    const skipped = await decide(r, `refs/heads/main ${r.head} refs/heads/main ${r.base}\n`, { quick: [FAIL], env: { REBASE_SKIP_PREPUSH: "1" } });
    assert.equal(skipped.code, 0);
    assert.match(skipped.written, /skipped/);
});

test("is what git runs as the pre-push hook: a failing gate refuses the push, a passing one lets it through", () => {
    const r = repo();
    const hooks = path.join(r.dir, "hooks");
    fs.mkdirSync(hooks);
    const runner = path.join(r.dir, "run-guard.mjs");
    // The guard with stand-in gates, chosen by an environment variable.
    fs.writeFileSync(runner, `import { guard } from ${JSON.stringify(GUARD)};
let stdin = ""; process.stdin.on("data", c => { stdin += c; });
process.stdin.on("end", async () => {
    const gate = ["node", ["-e", "process.exit(" + (process.env.GATE_EXIT ?? "0") + ")"]];
    process.exit(await guard({ stdin, cwd: process.cwd(), env: {}, quick: [gate], slow: [] }));
});\n`);
    fs.writeFileSync(path.join(hooks, "pre-push"), `#!/bin/sh\nexec node ${JSON.stringify(runner)} "$@"\n`, { mode: 0o755 });
    sh(r.work, "config", "core.hooksPath", hooks);

    const refused = spawnSync("git", ["push", "-q", "origin", "main"], { cwd: r.work, encoding: "utf8", env: { ...process.env, GATE_EXIT: "1" } });
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /refused — CI would fail on this/);
    assert.equal(sh(r.remote, "rev-parse", "main"), r.base);

    const passed = spawnSync("git", ["push", "-q", "origin", "main"], { cwd: r.work, encoding: "utf8", env: { ...process.env, GATE_EXIT: "0" } });
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(sh(r.remote, "rev-parse", "main"), r.head);
});
