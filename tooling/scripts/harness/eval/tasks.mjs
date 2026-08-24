/**
 * Benchmark tasks, derived from the repo's own fix commits.
 *
 * Hand-written eval tasks go stale and are expensive to keep honest. This repo already
 * contains a stream of high-quality ones: every commit that fixes a real bug *and* adds
 * the regression test proving it. Reverting only the source half of such a commit
 * reproduces the exact state the original author faced, with a grader — the test — that
 * was written by someone who understood the bug.
 *
 * So a task spec is deliberately thin: a commit, a prompt, and how to run the test. The
 * split between "source to revert" and "tests to keep" is inferred, and only needs an
 * override when a commit puts test helpers somewhere unusual.
 */
import { sh } from "../lib/ctx.mjs";

/** Paths that hold the grader rather than the implementation. */
const TEST_PATTERNS = [/(^|\/)tests?\//, /\.test\.[cm]?[jt]sx?$/, /\.spec\.[cm]?[jt]sx?$/, /(^|\/)e2e\//, /__tests__\//];

export function isTestPath(file) {
    return TEST_PATTERNS.some((re) => re.test(file));
}

/**
 * The seed set.
 *
 * `verify` is scoped to the narrowest command that actually proves the fix — a full
 * `pnpm test` would take the harness from minutes to tens of minutes per task and would
 * blur a real failure into unrelated noise.
 *
 * It also never goes through pnpm. An eval worktree gets its node_modules by symlink, and
 * pnpm reads a workspace-state file through that link and dies with ELOOP — which the
 * runner would otherwise have read as "the bug reproduced", passing the gate for the
 * wrong reason. Invoking the test runner directly keeps a verify failure meaningful.
 * `--passWithNoTests` is likewise omitted on purpose: a filter that matches nothing must
 * fail the task, not exit 0.
 *
 * `cwd` is relative to the worktree root; `{worktree}` in cmd/args is substituted with it.
 */
export const TASKS = [
    {
        id: "dev-port-retry",
        commit: "3c896876d",
        prompt:
            "Users report that `rebase dev` prints a backend URL on a port that something else is already serving. " +
            "It happens only when the first port it tries is already taken. The announced port is wrong — requests to it " +
            "reach a different process. Find the root cause in the dev server's port selection and fix it.",
        verify: {
            cwd: "packages/server",
            cmd: "{worktree}/packages/server/node_modules/.bin/jest",
            args: ["dev-port", "--forceExit"],
            env: { NODE_OPTIONS: "--experimental-vm-modules" },
        },
        /** What a correct fix must not do: make the test agree with the bug. */
        protected: ["packages/server/test/dev-port.test.ts"],
    },
    {
        id: "template-image-import",
        commit: "ff9ccd6df",
        prompt:
            "A user scaffolded a project with `rebase init`, added a custom Field component that imports a PNG, and the " +
            "config build now fails. Reproduce the failure in the template's config typecheck and fix it so a custom " +
            "component importing an image asset compiles.",
        verify: { cmd: "node", args: ["tooling/scripts/check-templates.mjs"] },
        protected: ["tooling/scripts/check-templates.mjs"],
    },
];

/** Files a commit changed, split into the half to revert and the half to keep. */
export function splitCommit(root, commit, spec = {}) {
    const files = sh("git", ["show", "--name-only", "--format=", commit], root)
        .split("\n")
        .map((f) => f.trim())
        .filter(Boolean);

    if (!files.length) return null;

    const tests = files.filter((f) => isTestPath(f) || (spec.protected || []).includes(f));
    const source = files.filter((f) => !tests.includes(f));
    return { files, tests, source };
}

export function getTask(id) {
    return TASKS.find((t) => t.id === id) || null;
}
