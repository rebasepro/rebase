/**
 * Tests for the harness itself.
 *
 * A gate nobody tests is a gate that quietly stops gating. The specific way that
 * happened here is worth encoding: `git rev-parse --path-format=absolute` is silently
 * ignored by git < 2.31, which resolved the primary root to "." and made `isWorktree`
 * false everywhere — so the worktree checks passed by never running. Nothing failed.
 *
 * Run: node --test tooling/scripts/harness/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { context } from "../lib/ctx.mjs";
import { blocking, FAIL, WARN, PASS, finding } from "../lib/report.mjs";
import * as controlPlane from "../checks/control-plane.mjs";
import * as lockfileWorktree from "../checks/lockfile-worktree.mjs";
import * as migrationOrder from "../checks/migration-order.mjs";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { grade } from "../eval/grade.mjs";
import { isTestPath } from "../eval/tasks.mjs";

test("context resolves an absolute primary root", () => {
    const ctx = context();
    assert.ok(path.isAbsolute(ctx.primaryRoot), `primaryRoot must be absolute, got "${ctx.primaryRoot}"`);
    assert.ok(path.isAbsolute(ctx.root), `root must be absolute, got "${ctx.root}"`);
    assert.notEqual(ctx.primaryRoot, ".", "a relative primary root disables every worktree check");
});

test("control-plane flags a Cloud Run deploy but not the demo", () => {
    const generic = controlPlane.run(null, { command: "gcloud run deploy rebase-saas --region europe-west3" });
    assert.equal(generic.filter((f) => f.level === WARN).length, 1);

    const demo = controlPlane.run(null, { command: "gcloud run deploy rebase-demo --region europe-west3" });
    assert.ok(demo.every((f) => f.level === PASS), "the demo genuinely lives on Cloud Run");
});

test("control-plane blocks destructive kubectl", () => {
    const found = controlPlane.run(null, { command: "kubectl delete ns tenant-42" });
    assert.ok(blocking(found), "kubectl delete must be blocking, not advisory");
});

test("control-plane ignores non-deploy commands", () => {
    assert.equal(controlPlane.isDeployShaped("ls -la"), false);
    assert.equal(controlPlane.isDeployShaped("git status"), false);
    assert.equal(controlPlane.isDeployShaped("kubectl apply -f svc.yaml"), true);
});

test("lockfile check only fires inside a worktree", () => {
    const inWorktree = { isWorktree: true, changed: ["pnpm-lock.yaml"], root: "/wt", primaryRoot: "/primary" };
    assert.ok(blocking(lockfileWorktree.run(inWorktree)));

    const inPrimary = { isWorktree: false, changed: ["pnpm-lock.yaml"], root: "/primary", primaryRoot: "/primary" };
    assert.ok(!blocking(lockfileWorktree.run(inPrimary)));

    const cleanWorktree = { isWorktree: true, changed: ["packages/server/src/a.ts"], root: "/wt", primaryRoot: "/primary" };
    assert.ok(!blocking(lockfileWorktree.run(cleanWorktree)));
});

test("blocking() distinguishes fail from warn", () => {
    assert.equal(blocking([finding("x", WARN, "w")]), false);
    assert.equal(blocking([finding("x", WARN, "w"), finding("y", FAIL, "f")]), true);
});

test("test-path classification covers this repo's layouts", () => {
    assert.ok(isTestPath("packages/server/test/dev-port.test.ts"));
    assert.ok(isTestPath("tests/e2e/tests/cli-init-e2e.ts"));
    assert.ok(isTestPath("packages/app/src/__tests__/thing.tsx"));
    assert.equal(isTestPath("packages/server/src/utils/dev-port.ts"), false);
});

test("grade scores a clean fix highly and a tampered test at zero", () => {
    const task = { protected: ["packages/server/test/dev-port.test.ts"] };
    const split = { tests: ["packages/server/test/dev-port.test.ts"], source: ["packages/server/src/utils/dev-port.ts"] };
    const trace = [{ event: "pre_tool_use", tool: "Bash", command: "npx jest dev-port" }];

    const clean = grade({ task, split, passed: true, diff: split.source, trace, verifyOutput: "" });
    assert.equal(clean.passed, true);
    assert.equal(clean.score, 100);

    const tampered = grade({ task, split, passed: true, diff: [...split.source, ...split.tests], trace, verifyOutput: "" });
    assert.equal(tampered.passed, false, "editing the grader must invalidate the pass, not just deduct");
    assert.equal(tampered.score, 0);
});

test("grade deducts for the repo's documented anti-patterns", () => {
    const task = {};
    const split = { tests: [], source: ["packages/server/src/a.ts"] };

    const withNpm = grade({
        task,
        split,
        passed: true,
        diff: split.source,
        trace: [
            { event: "pre_tool_use", tool: "Bash", command: "npm install left-pad" },
            { event: "pre_tool_use", tool: "Bash", command: "git add -A" },
            { event: "pre_tool_use", tool: "Bash", command: "npx jest" },
        ],
        verifyOutput: "",
    });

    assert.ok(withNpm.score < 100);
    assert.ok(withNpm.notes.some((n) => /pnpm-only/.test(n)));
    assert.ok(withNpm.notes.some((n) => /git add -A/.test(n)));
});

// ── migration-order across a repository boundary ────────────────────────────
//
// The merge-safety half of this check had never run for the journal it was
// written for. `saas/` is gitignored in the monorepo and is its own repository,
// so `git show <base>:saas/backend/drizzle/meta/_journal.json` at the monorepo
// root fails with "exists on disk, but not in HEAD"; `sh` swallows that to "",
// the comparison was skipped, and the summary still read "including against
// main". These pin both halves of the fix: that it now reads the journal from
// the repository that tracks it, and that a comparison it genuinely cannot make
// reports itself instead of passing.

/** A monorepo-shaped fixture: outer repo, gitignored inner repo at saas/. */
function nestedJournalFixture(entries, { mainEntries, innerBranch = "main" } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "migration-order-"));
    const git = (args, cwd) =>
        execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const journalDir = path.join(root, "saas", "backend", "drizzle", "meta");
    const journalPath = path.join(journalDir, "_journal.json");
    const write = (list) =>
        fs.writeFileSync(journalPath, JSON.stringify({ version: "7", dialect: "postgresql", entries: list }));

    fs.mkdirSync(journalDir, { recursive: true });

    // Outer repo, with saas/ ignored exactly as the monorepo ignores it.
    // `git init -b` needs git 2.28; `symbolic-ref` before the first commit does
    // the same thing on every version, which matters because this has to pass on
    // whatever git a contributor happens to have.
    git(["init", "-q"], root);
    git(["symbolic-ref", "HEAD", "refs/heads/main"], root);
    fs.writeFileSync(path.join(root, ".gitignore"), "/saas\n");
    git(["add", ".gitignore"], root);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "outer"], root);

    // Inner repo, which is what actually tracks the journal.
    const inner = path.join(root, "saas");
    git(["init", "-q"], inner);
    git(["symbolic-ref", "HEAD", `refs/heads/${innerBranch}`], inner);
    write(mainEntries ?? entries);
    git(["add", "-A"], inner);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base"], inner);

    // A branch whose journal differs from the base's — the merge-base is what
    // the check reads, so this is "what main had when I branched".
    if (mainEntries) {
        git(["checkout", "-q", "-b", "feature"], inner);
        write(entries);
        git(["add", "-A"], inner);
        git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "feature"], inner);
    }

    return root;
}

test("migration-order reads main's journal across a nested repository boundary", () => {
    // Base has A and B; the branch carries A and a NEW migration C whose `when`
    // sorts before B — the two-branches-raced shape. Locally monotonic (1000 →
    // 2000), so only the merge-safety rule can catch it, which is the rule that
    // was never running.
    const root = nestedJournalFixture(
        [
            { idx: 0, tag: "0000_a", when: 1000 },
            { idx: 1, tag: "0001_c", when: 2000 },
        ],
        {
            mainEntries: [
                { idx: 0, tag: "0000_a", when: 1000 },
                { idx: 1, tag: "0001_b", when: 3000 },
            ],
        },
    );

    const found = migrationOrder.run({ root });
    const merge = found.filter((f) => /sorts at or before main's latest/.test(f.message ?? ""));

    assert.equal(merge.length, 1, `expected one merge-safety finding, got ${JSON.stringify(found)}`);
    assert.equal(merge[0].level, FAIL);
    assert.match(merge[0].message, /0001_c/);
});

test("migration-order warns rather than passing when main's journal is unreachable", () => {
    // No `main` branch at all, so the comparison genuinely cannot be made. The
    // old code returned null here and fell through to the pass line, which is
    // how a gate reports success for work it never did.
    const root = nestedJournalFixture([{ idx: 0, tag: "0000_a", when: 1000 }], { innerBranch: "trunk" });

    const found = migrationOrder.run({ root });

    assert.ok(
        found.some((f) => f.level === WARN && /merge safety was NOT checked/.test(f.message ?? "")),
        `expected a warning, got ${JSON.stringify(found)}`,
    );
    assert.ok(!found.some((f) => f.level === PASS), "must not also report a pass");
});
