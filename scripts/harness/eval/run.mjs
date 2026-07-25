/**
 * The eval runner.
 *
 * For each task: rebuild the pre-fix state in an isolated worktree, confirm the bug is
 * actually reproduced, hand the agent the bug report, then grade what came back.
 *
 * The step that makes the whole thing trustworthy is the reproduction gate. If the
 * verify command passes *before* the agent runs, the task is broken — the revert did not
 * reintroduce the bug — and any agent, including one that does nothing at all, would
 * score a pass. Every eval harness that skips this check silently inflates its numbers,
 * so a task that fails to reproduce is reported as invalid rather than run.
 *
 * Grading is two-part. Functional: does the regression test pass. Behavioural: how it got
 * there — read from the diff and the hook trace, because "test is green" and "bug is
 * fixed" are the same sentence only when the test was left alone.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { context, sh } from "../lib/ctx.mjs";
import { read as readTrace } from "../lib/trace.mjs";
import { TASKS, getTask, splitCommit } from "./tasks.mjs";
import { grade } from "./grade.mjs";

const DEFAULT_AGENT = "claude -p --permission-mode bypassPermissions {prompt}";

/** Where eval worktrees live. Under .claude/harness so they are gitignored and easy to sweep. */
function evalRoot(ctx) {
    return path.join(ctx.primaryRoot, ".claude", "harness", "eval");
}

/**
 * pnpm workspaces do not survive a bare `git worktree add` — every package resolves its
 * deps through a node_modules the new tree does not have. Symlinking rather than
 * installing is deliberate: an install here would resolve a workspace missing the
 * gitignored members and rewrite the lockfile, which is the exact trap the
 * lockfile-worktree check exists to catch.
 */
function linkNodeModules(primaryRoot, worktree) {
    const candidates = ["", "app", "app/frontend", "app/backend", "app/config"];
    for (const entry of fs.readdirSync(path.join(primaryRoot, "packages"), { withFileTypes: true })) {
        if (entry.isDirectory()) candidates.push(path.join("packages", entry.name));
    }

    let linked = 0;
    for (const rel of candidates) {
        const from = path.resolve(primaryRoot, rel, "node_modules");
        const to = path.resolve(worktree, rel, "node_modules");

        // A self-link is not a broken link — it resolves, and every tool that walks into
        // it loops until ELOOP. That surfaced as "the bug reproduced" rather than as an
        // error, so refuse it outright instead of trusting the roots to be sane.
        if (from === to) throw new Error(`Refusing to link ${rel || "."}/node_modules onto itself — primary root resolved to ${primaryRoot}.`);
        if (!fs.existsSync(from) || fs.existsSync(to)) continue;
        try {
            fs.mkdirSync(path.dirname(to), { recursive: true });
            fs.symlinkSync(from, to, "dir");
            linked++;
        } catch {
            // A package that does not exist at this commit simply has nothing to link.
        }
    }
    return linked;
}

function run(cmd, args, cwd, env = {}) {
    const result = spawnSync(cmd, args, {
        cwd,
        encoding: "utf8",
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 32 * 1024 * 1024,
    });
    return { code: result.status ?? 1, out: `${result.stdout || ""}${result.stderr || ""}` };
}

/** Run a task's verify command inside the worktree. */
function verify(task, worktree) {
    const subst = (s) => s.replace("{worktree}", worktree);
    const cwd = task.verify.cwd ? path.join(worktree, task.verify.cwd) : worktree;
    return run(subst(task.verify.cmd), (task.verify.args || []).map(subst), cwd, task.verify.env || {});
}

/** Put the worktree at the fix commit, with dependencies resolvable. */
function checkout(ctx, task, worktree) {
    const split = splitCommit(ctx.primaryRoot, task.commit, task);
    if (!split) return { error: `Commit ${task.commit} not found.` };

    run("git", ["worktree", "add", "--detach", worktree, task.commit], ctx.primaryRoot);
    if (!fs.existsSync(worktree)) return { error: `Could not create worktree for ${task.commit}.` };

    linkNodeModules(ctx.primaryRoot, worktree);
    return { split };
}

/** Roll the source half back to the parent commit, leaving the tests at the fixed version. */
function revertSource(task, split, worktree) {
    for (const file of split.source) {
        // A file the fix *added* has no parent version; removing it is the correct revert.
        const restored = run("git", ["checkout", `${task.commit}^`, "--", file], worktree);
        if (restored.code !== 0) run("git", ["rm", "-q", "-f", "--", file], worktree);
    }
}

async function runTask(ctx, task, { agentTemplate, keep }) {
    const worktree = path.join(evalRoot(ctx), task.id);
    const tracePath = path.join(evalRoot(ctx), `${task.id}.trace.jsonl`);

    fs.rmSync(worktree, { recursive: true, force: true });
    fs.rmSync(tracePath, { force: true });
    run("git", ["worktree", "prune"], ctx.primaryRoot);
    fs.mkdirSync(evalRoot(ctx), { recursive: true });

    const { split, error } = checkout(ctx, task, worktree);
    if (error) return { id: task.id, valid: false, error };

    // ── Gate 1: the verify command must PASS at the fix commit. ──────────────────
    // Without this the gate below is vacuous: a verify that fails for an environmental
    // reason — a missing binary, an unresolvable import, a runner that cannot start —
    // looks exactly like a reproduced bug, and every task "reproduces" for free.
    const fixed = verify(task, worktree);
    if (fixed.code !== 0) {
        return {
            id: task.id,
            valid: false,
            error:
                `Verify command fails at the fix commit itself, so a later failure would prove nothing. ` +
                `The environment or the command is wrong, not the code:\n${tailOf(fixed.out)}`,
        };
    }

    // ── Gate 2: reverting the source must make it FAIL. ──────────────────────────
    revertSource(task, split, worktree);
    const broken = verify(task, worktree);
    if (broken.code === 0) {
        return {
            id: task.id,
            valid: false,
            error:
                `Task does not reproduce: verify still passes after reverting ${split.source.length} source file(s). ` +
                `The fix probably lives in a file classified as a test, or the command does not cover it.`,
        };
    }

    const startedAt = Date.now();
    const [cmd, ...rest] = agentTemplate.split(" ");
    const args = rest.map((a) => (a === "{prompt}" ? task.prompt : a));
    const agent = run(cmd, args, worktree, { REBASE_HARNESS_TRACE: tracePath, CLAUDE_PROJECT_DIR: worktree });

    const after = verify(task, worktree);
    const diff = sh("git", ["diff", "--name-only"], worktree).split("\n").filter(Boolean);

    const result = {
        id: task.id,
        valid: true,
        durationMs: Date.now() - startedAt,
        agentExit: agent.code,
        ...grade({ task, split, passed: after.code === 0, diff, trace: readTrace(tracePath), verifyOutput: after.out }),
    };

    if (!keep) fs.rmSync(worktree, { recursive: true, force: true });
    run("git", ["worktree", "prune"], ctx.primaryRoot);
    return result;
}

export async function main(argv = []) {
    const ctx = context();
    const json = argv.includes("--json");
    const keep = argv.includes("--keep");

    if (argv.includes("--list")) {
        for (const t of TASKS) process.stdout.write(`${t.id}\t${t.commit}\t${t.verify.cmd} ${t.verify.args.join(" ")}\n`);
        return 0;
    }

    const taskFlag = argv.indexOf("--task");
    const selected = taskFlag >= 0 ? [getTask(argv[taskFlag + 1])].filter(Boolean) : TASKS;
    if (!selected.length) {
        process.stdout.write(`Unknown task. Known: ${TASKS.map((t) => t.id).join(", ")}\n`);
        return 1;
    }

    const agentFlag = argv.indexOf("--agent");
    const agentTemplate = agentFlag >= 0 ? argv[agentFlag + 1] : DEFAULT_AGENT;

    if (ctx.isWorktree) {
        process.stdout.write("Run evals from the primary checkout — worktrees are created relative to it.\n");
        return 1;
    }
    if (!argv.includes("--yes")) {
        process.stdout.write(
            `About to run ${selected.length} task(s) with:\n  ${agentTemplate}\n\n` +
                `Each task runs an agent inside a throwaway worktree under .claude/harness/eval/.\n` +
                `The default template bypasses permission prompts so the run is unattended.\n` +
                `Re-run with --yes to proceed, or pass --agent "<cmd> {prompt}" to use your own.\n`,
        );
        return 1;
    }

    const results = [];
    for (const task of selected) {
        if (!json) process.stdout.write(`\n▸ ${task.id} (${task.commit})\n`);
        const result = await runTask(ctx, task, { agentTemplate, keep });
        results.push(result);
        if (!json) process.stdout.write(formatResult(result));
    }

    if (json) process.stdout.write(JSON.stringify({ results }, null, 2) + "\n");
    else process.stdout.write(formatSummary(results));

    return results.some((r) => !r.valid || !r.passed) ? 1 : 0;
}

/** Last lines of a command's output — enough to diagnose an invalid task. */
function tailOf(output = "", lines = 10) {
    return output.trim().split("\n").slice(-lines).join("\n");
}

function formatResult(r) {
    if (!r.valid) return `  \x1b[33mINVALID\x1b[0m ${r.error}\n`;
    const verdict = r.passed ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m";
    const lines = [`  ${verdict} functional (${Math.round(r.durationMs / 1000)}s)`];
    for (const note of r.notes) lines.push(`  \x1b[33m•\x1b[0m ${note}`);
    lines.push(`  score ${r.score}/100`);
    return lines.join("\n") + "\n";
}

function formatSummary(results) {
    const valid = results.filter((r) => r.valid);
    const passed = valid.filter((r) => r.passed).length;
    const avg = valid.length ? Math.round(valid.reduce((s, r) => s + r.score, 0) / valid.length) : 0;
    return `\n${passed}/${valid.length} passed, mean score ${avg}/100` + (valid.length < results.length ? `, ${results.length - valid.length} invalid` : "") + "\n";
}

if (import.meta.filename === process.argv[1]) process.exit(await main(process.argv.slice(2)));
