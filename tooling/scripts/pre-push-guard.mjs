#!/usr/bin/env node
/**
 * The pre-push guard: before a push updates `main` on any remote, run the
 * gates CI would refuse it on that need no Docker and no build, and show the
 * commits going out.
 *
 * Why: CI was the first place these ran, ~20 minutes after the push, and on
 * 2026-11-09 main went red three times on gates that take seconds here —
 * `check:types-headless`, `check:generated`, `check:test-types`,
 * `check:casts`, `check:audit-coverage`, stale translations in
 * `verify:docs:strict` — while a release waited. One of those pushes also
 * carried another session's unpushed commits from the shared checkout,
 * which nobody saw until they were on origin; the commit list is printed so
 * that is seen before it happens.
 *
 * It checks the files in this checkout, so it refuses when they are not what
 * is being pushed: HEAD is another commit, or a tracked file is modified.
 * CI still runs everything; this is the fast subset, about three minutes. `REBASE_SKIP_PREPUSH=1 git push …` skips it, for emergencies.
 *
 * Installed by `pnpm install` (`tooling/scripts/install-git-hooks.mjs` sets
 * `core.hooksPath` to `tooling/git-hooks`), so every worktree runs its own
 * copy of the hook.
 *
 * Run: called by `tooling/git-hooks/pre-push` with git's arguments and stdin.
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ZERO = /^0+$/;

/** Gates that answer in seconds: run first, one after another, so a push fails fast. */
export const QUICK_GATES = [
    ["pnpm", ["-s", "run", "check:types-headless"]],
    ["pnpm", ["-s", "run", "check:casts"]],
    ["pnpm", ["-s", "run", "check:audit-coverage"]],
    ["pnpm", ["-s", "run", "check:generated"]]
];

/**
 * Gates that take a minute or so each: run one after another, all of them, so
 * one push shows every failure. Together they were slower — three TypeScript
 * programs fighting for memory on a machine other sessions also load.
 */
export const SLOW_GATES = [
    ["pnpm", ["-s", "typecheck"]],
    ["node", ["tooling/scripts/check-test-types.mjs"]],
    ["pnpm", ["-s", "verify:docs:strict"]]
];

/**
 * The updates git is about to push, from the hook's stdin: one line each,
 * `<local ref> <local sha> <remote ref> <remote sha>`.
 */
export function parseUpdates(stdin) {
    return stdin.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
        const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/);
        return { localRef, localSha, remoteRef, remoteSha };
    });
}

/** The updates that move `main` forward (a deletion moves nothing to check). */
export function mainUpdates(updates) {
    return updates.filter(update => update.remoteRef === "refs/heads/main" && !ZERO.test(update.localSha ?? ""));
}

function git(args, cwd) {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    return result.status === 0 ? result.stdout.trim() : "";
}

/** The commits an update sends: the ones the remote's main does not have yet. */
export function outgoingCommits(update, cwd) {
    const range = ZERO.test(update.remoteSha) ? ["-n", "30", update.localSha] : [`${update.remoteSha}..${update.localSha}`];
    const log = git(["log", "--format=%h %an %ad %s", "--date=format:%m-%d %H:%M", ...range], cwd);
    return log ? log.split("\n") : [];
}

/** Why the files here are not what is pushed, or nothing when they are. */
export function treeProblem(update, cwd) {
    const head = git(["rev-parse", "HEAD"], cwd);
    if (head !== update.localSha) {
        return `HEAD is ${head.slice(0, 10)}, but you are pushing ${update.localSha.slice(0, 10)}. The guard checks the files `
            + "in this checkout: check out the commit you push, or push from a checkout that has it.";
    }
    const dirty = git(["status", "--porcelain", "--untracked-files=no"], cwd);
    if (dirty) {
        return "These tracked files are modified, so the checks would not test what you push:\n"
            + dirty.split("\n").map(line => `    ${line}`).join("\n")
            + "\n  Commit them, or set them aside, then push again.";
    }
    return undefined;
}

/** Run one gate; resolves with its exit code and its output. */
function runGate([command, args], cwd) {
    return new Promise(resolve => {
        const child = spawn(command, args, { cwd, env: { ...process.env, FORCE_COLOR: "0" } });
        let output = "";
        child.stdout.on("data", chunk => { output += chunk; });
        child.stderr.on("data", chunk => { output += chunk; });
        child.on("close", code => resolve({ name: [command, ...args].join(" "), code: code ?? 1, output }));
        child.on("error", error => resolve({ name: [command, ...args].join(" "), code: 1, output: String(error) }));
    });
}

function report(result) {
    const tail = result.output.trim().split("\n").slice(-25).join("\n");
    process.stderr.write(`\n✗ ${result.name} failed:\n${tail}\n`);
}

/**
 * Decide a push. Returns the exit code the hook exits with: 0 lets it
 * through, anything else refuses it.
 */
export async function guard({ stdin, cwd, env = process.env, quick = QUICK_GATES, slow = SLOW_GATES, out = process.stderr }) {
    const updates = mainUpdates(parseUpdates(stdin));
    if (updates.length === 0) return 0;
    if (env.REBASE_SKIP_PREPUSH === "1") {
        out.write("pre-push: REBASE_SKIP_PREPUSH=1 — the checks are skipped. CI still runs them.\n");
        return 0;
    }

    for (const update of updates) {
        const commits = outgoingCommits(update, cwd);
        out.write(`pre-push: ${commits.length} commit(s) going to main:\n${commits.map(line => `  ${line}`).join("\n")}\n`);
        if (commits.length > 10) {
            out.write("pre-push: that is more than you may have meant. Are all of these yours to publish?\n");
        }
        const problem = treeProblem(update, cwd);
        if (problem) {
            out.write(`\npre-push: refused. ${problem}\n  Emergency: REBASE_SKIP_PREPUSH=1 git push …\n`);
            return 1;
        }
    }

    const started = Date.now();
    out.write("pre-push: running the fast CI gates (about three minutes)…\n");
    for (const gate of quick) {
        const result = await runGate(gate, cwd);
        if (result.code !== 0) {
            report(result);
            out.write(`\npre-push: refused — CI would fail on this. Fix it and push again.\n  Emergency: REBASE_SKIP_PREPUSH=1 git push …\n`);
            return 1;
        }
    }
    const failed = [];
    for (const gate of slow) {
        const result = await runGate(gate, cwd);
        if (result.code !== 0) failed.push(result);
    }
    failed.forEach(report);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (failed.length > 0) {
        out.write(`\npre-push: refused after ${seconds}s — CI would fail on this. Fix it and push again.\n  Emergency: REBASE_SKIP_PREPUSH=1 git push …\n`);
        return 1;
    }
    out.write(`pre-push: the fast gates pass (${seconds}s).\n`);
    return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    let stdin = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", chunk => { stdin += chunk; });
    process.stdin.on("end", async () => {
        process.exit(await guard({ stdin, cwd: process.cwd() }));
    });
}
