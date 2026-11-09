#!/usr/bin/env node
/**
 * Point git at the repository's hooks (`tooling/git-hooks`), so the
 * pre-push guard runs in this checkout and in every worktree of it — each
 * runs its own copy, from its own tree. Run by the root `prepare` script on
 * `pnpm install`.
 *
 * Never fails an install: outside a git checkout, in CI, or when git cannot
 * be configured, it says so and does nothing. A `core.hooksPath` someone set
 * to another place is left alone.
 */
import { spawnSync } from "node:child_process";

const HOOKS = "tooling/git-hooks";

function git(args) {
    const result = spawnSync("git", args, { encoding: "utf8" });
    return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

if (process.env.CI) process.exit(0);
if (!git(["rev-parse", "--is-inside-work-tree"]).ok) process.exit(0);

const current = git(["config", "--get", "core.hooksPath"]).out;
if (current && current !== HOOKS) {
    console.log(`git hooks: core.hooksPath is already "${current}"; leaving it. The pre-push guard is in ${HOOKS}.`);
    process.exit(0);
}
if (current !== HOOKS && !git(["config", "core.hooksPath", HOOKS]).ok) {
    console.log(`git hooks: could not set core.hooksPath to ${HOOKS}; the pre-push guard is not installed.`);
}
