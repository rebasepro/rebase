/**
 * Tests for the harness itself.
 *
 * A gate nobody tests is a gate that quietly stops gating. The specific way that
 * happened here is worth encoding: `git rev-parse --path-format=absolute` is silently
 * ignored by git < 2.31, which resolved the primary root to "." and made `isWorktree`
 * false everywhere — so the worktree checks passed by never running. Nothing failed.
 *
 * Run: node --test scripts/harness/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { context } from "../lib/ctx.mjs";
import { blocking, FAIL, WARN, PASS, finding } from "../lib/report.mjs";
import * as controlPlane from "../checks/control-plane.mjs";
import * as lockfileWorktree from "../checks/lockfile-worktree.mjs";
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
    assert.ok(isTestPath("e2e/tests/cli-init-e2e.ts"));
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
