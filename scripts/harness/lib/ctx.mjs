/**
 * Repo facts every harness check needs, resolved once.
 *
 * Checks must never assume they are running in the primary checkout. Agents work
 * in `.claude/worktrees/*`, and several of the traps this harness exists to catch
 * are *only* traps there — regenerating the lockfile from a worktree silently
 * prunes workspace importers, because the gitignored `saas/` member is absent.
 * So `isWorktree` is load-bearing, not informational.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Run a command for its stdout; empty string if it fails (harness must not throw on git edge cases). */
export function sh(cmd, args, cwd = process.cwd()) {
    try {
        return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
        return "";
    }
}

/**
 * The primary checkout, even when called from a worktree.
 *
 * `git rev-parse --show-toplevel` gives the *worktree* root; the common dir points at
 * the primary's `.git`, so its parent is the primary checkout. We need both: the
 * worktree root to inspect the agent's changes, the primary to know where the lockfile
 * may legitimately be regenerated.
 *
 * `--git-common-dir` may return a path relative to the worktree (git prints a bare
 * `.git` in the primary checkout), so it is resolved explicitly. The tempting
 * `--path-format=absolute` is NOT used: it landed in git 2.31, and older git does not
 * reject it — it echoes the unknown flag back as an output line and still prints a
 * relative path. That parsed as a primary root of ".", which silently made every
 * checkout look like the primary one and disabled the worktree checks entirely.
 * Taking the last line defends against that class of echo even if it recurs.
 */
function resolveRoots() {
    const worktreeRoot = sh("git", ["rev-parse", "--show-toplevel"]) || process.cwd();

    const raw = sh("git", ["rev-parse", "--git-common-dir"]).split("\n").pop().trim();
    if (!raw) return { worktreeRoot, primaryRoot: worktreeRoot };

    // Resolved against the CWD, NOT the worktree root: git prints this path
    // relative to wherever it was invoked, so it is `.git` from the toplevel but
    // `../.git` from `website/`. Resolving `../.git` against the worktree root
    // yielded the repo's *parent* as primaryRoot, so every harness run started
    // from a subdirectory looked like a worktree — which is exactly how
    // `pnpm run deploy` (it cd's into website/) hit the lockfile-worktree guard
    // in the primary checkout, where lockfile changes are legitimate.
    const commonDir = path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
    return { worktreeRoot, primaryRoot: path.dirname(commonDir) };
}

/**
 * Files changed against the merge-base with main, plus anything uncommitted.
 *
 * Diffing against `main` directly would report every commit main has that the
 * branch lacks once main moves ahead, so a check keyed on "did this change touch
 * migrations" would fire on unrelated work. Merge-base is the branch's own delta.
 */
function changedFiles(root) {
    const base = sh("git", ["merge-base", "HEAD", "main"], root);
    const committed = base ? sh("git", ["diff", "--name-only", `${base}...HEAD`], root) : "";
    const working = sh("git", ["status", "--porcelain=v1"], root);

    const files = new Set();
    for (const line of committed.split("\n")) {
        if (line.trim()) files.add(line.trim());
    }
    // porcelain lines are "XY <path>", and renames are "XY <old> -> <new>".
    for (const line of working.split("\n")) {
        if (!line.trim()) continue;
        const p = line.slice(3).trim();
        files.add(p.includes(" -> ") ? p.split(" -> ")[1] : p);
    }
    return [...files];
}

let cached = null;

export function context() {
    if (cached) return cached;

    const { worktreeRoot, primaryRoot } = resolveRoots();
    const isWorktree = path.resolve(worktreeRoot) !== path.resolve(primaryRoot);

    cached = {
        root: worktreeRoot,
        primaryRoot,
        isWorktree,
        branch: sh("git", ["rev-parse", "--abbrev-ref", "HEAD"], worktreeRoot),
        changed: changedFiles(worktreeRoot),
        /** True when the gitignored cloud workspace member is present — several checks are cloud-only. */
        hasSaas: fs.existsSync(path.join(worktreeRoot, "saas", "package.json")),
    };
    return cached;
}

/** Changed files under any of the given path prefixes. */
export function changedUnder(...prefixes) {
    return context().changed.filter((f) => prefixes.some((p) => f.startsWith(p)));
}

/** Read JSON, returning null rather than throwing when absent or malformed. */
export function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
        return null;
    }
}
