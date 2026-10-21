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

import { changedFiles, context } from "../lib/ctx.mjs";
import { blocking, FAIL, WARN, PASS, finding } from "../lib/report.mjs";
import * as controlPlane from "../checks/control-plane.mjs";
import * as lockfileWorktree from "../checks/lockfile-worktree.mjs";
import * as migrationOrder from "../checks/migration-order.mjs";
import * as rlsDrift from "../checks/rls-drift.mjs";
import { treeKey } from "../deploy/preflight.mjs";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { grade } from "../eval/grade.mjs";
import { isTestPath, resolveCommit, splitFiles, TASKS } from "../eval/tasks.mjs";

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
    assert.ok(blocking(found), "a destructive kubectl verb must be blocking, not advisory");
});

/**
 * The forms the rule was blind to, which are the forms people actually type.
 *
 * The pattern required `kubectl` and its verb to be adjacent, and the only test
 * above uses the one spelling where they are. Everything with a flag in between
 * — which is every namespaced command, and so every command that can destroy
 * one tenant's data rather than the whole namespace — was not classified as
 * deploy-shaped at all, so the blocking rule never even ran.
 *
 * Found on 2026-09-13 by deleting a CloudNativePG cluster and two 100 GiB
 * volumes with the gate silent, and then being stopped by it on the namespace
 * removal that followed: the same operation, one flag shorter.
 */
test("control-plane blocks a destructive verb behind flags, not just beside kubectl", () => {
    const forms = [
        "kubectl -n rebase-shared delete cluster pg-pool-1",
        "kubectl --context=gke_x -n tenant-42 delete pvc data-0",
        "kubectl -n tenant-42 delete secret rebase-platform-env",
        "kubectl delete ns tenant-42"
    ];
    for (const command of forms) {
        assert.ok(controlPlane.isDeployShaped(command), `must be deploy-shaped: ${command}`);
        assert.ok(blocking(controlPlane.run(null, { command })), `must block: ${command}`);
    }
});

test("control-plane ignores non-deploy commands", () => {
    assert.equal(controlPlane.isDeployShaped("ls -la"), false);
    assert.equal(controlPlane.isDeployShaped("git status"), false);
    assert.equal(controlPlane.isDeployShaped("kubectl apply -f svc.yaml"), true);
    assert.equal(controlPlane.isDeployShaped("kubectl -n prod apply -f svc.yaml"), true);
    // A verb that only appears after a pipe is somebody reading, not writing.
    assert.equal(controlPlane.isDeployShaped("kubectl get pods | grep delete"), false);
    assert.equal(controlPlane.isDeployShaped("kubectl get deploy -o yaml | tee apply.log"), false);
});

/**
 * Prose is not a command.
 *
 * A negated character class matches newlines, so widening the gap made any
 * paragraph containing both words a match — including the commit message
 * describing the fix that introduced it. Bounding the gap by length did not
 * separate them either: a clause fits in 160 characters. What separates them is
 * position — a command starts with `kubectl`, a sentence does not.
 */
test("control-plane does not fire on prose that merely mentions both words", () => {
    const prose = [
        "git commit -m 'the kubectl gate was blind to namespaced commands\\n\\n" +
            "It watched a cluster and two volumes go, and only later did it refuse to " +
            "delete an empty namespace. The pattern required the verb adjacent.'",
        "echo 'we use kubectl for everything; the runbook says to check twice before " +
            "you ever reach for a command that can delete a tenant volume'"
    ];
    for (const command of prose) {
        assert.equal(controlPlane.isDeployShaped(command), false, `prose must not be deploy-shaped: ${command.slice(0, 48)}…`);
    }
});

test("control-plane still catches a command with long flags before the verb", () => {
    // ~100 characters of prefix: a fully qualified context plus a tenant
    // namespace, which is the longest shape that occurs in this repo.
    const command =
        "kubectl --context=gke_rebase-578f2_europe-west1_rebase-saas-gke " +
        "-n rebase-tenant-unfeigned-loyalty-staging-e4a934 delete pvc data-postgres-1";
    assert.ok(controlPlane.isDeployShaped(command), "a real command must still be caught");
    assert.ok(blocking(controlPlane.run(null, { command })), "and must still block");
});

/**
 * The positions a command can legitimately start in. Requiring `kubectl` to
 * begin a command is only safe if "begin" covers the ways a shell gets there —
 * otherwise the rule is one `&&` away from silent.
 */
test("control-plane catches a destructive verb wherever a command can start", () => {
    const starts = [
        "kubectl -n prod delete pvc data-0",
        "cd /repo && kubectl -n prod delete pvc data-0",
        "echo hi; kubectl -n prod delete pvc data-0",
        "set -e\nkubectl -n prod delete pvc data-0",
        "bash -c \"kubectl -n prod delete pvc data-0\"",
        "sudo kubectl -n prod delete pvc data-0",
        "kubectl -n prod \\\n  delete pvc data-0"
    ];
    for (const command of starts) {
        assert.ok(blocking(controlPlane.run(null, { command })), `must block: ${JSON.stringify(command)}`);
    }
});

/**
 * A command does not have to start with the bare word `kubectl`. An environment
 * assignment, an absolute path or a wrapper (`env`, `timeout`, `xargs`, …) in
 * front of it is still the same command, and each of these used to be
 * classified "not deploy-shaped" and let through.
 */
test("control-plane blocks a destructive verb behind an assignment, a path or a wrapper", () => {
    const prefixed = [
        "KUBECONFIG=~/.kube/prod kubectl delete ns tenant-42",
        "KUBECONFIG=\"/Users/me/.kube/prod config\" kubectl -n prod delete pvc data-0",
        "/opt/homebrew/bin/kubectl delete ns tenant-42",
        "~/bin/kubectl -n prod delete pvc data-0",
        "timeout 60 kubectl delete ns tenant-42",
        "timeout -s KILL 5m kubectl -n prod delete pvc data-0",
        "env A=1 kubectl delete ns tenant-42",
        "env -u KUBECONFIG kubectl -n prod delete pvc data-0",
        "kubectl get ns -o name | xargs kubectl delete",
        "kubectl get ns -o name | xargs -I{} kubectl delete {}",
        "command kubectl delete ns tenant-42",
        "nice -n 10 kubectl delete ns tenant-42",
        "time kubectl delete ns tenant-42",
        "sudo -u ops kubectl delete ns tenant-42",
        "cd /repo && KUBECONFIG=prod timeout 60 /usr/local/bin/kubectl -n prod delete pvc data-0",
        "bash -c 'KUBECONFIG=prod kubectl delete ns tenant-42'"
    ];
    for (const command of prefixed) {
        assert.ok(controlPlane.isDeployShaped(command), `must be deploy-shaped: ${JSON.stringify(command)}`);
        assert.ok(blocking(controlPlane.run(null, { command })), `must block: ${JSON.stringify(command)}`);
    }

    // The other verbs sit behind the same prefix rule.
    for (const command of [
        "KUBECONFIG=prod kubectl apply -f svc.yaml",
        "/usr/local/bin/kubectl -n prod set image deploy/api api=img:2",
        "timeout 60 kubectl -n prod rollout restart deploy/api"
    ]) {
        assert.ok(controlPlane.isDeployShaped(command), `must be deploy-shaped: ${JSON.stringify(command)}`);
    }

    // A prefix does not turn a read into a write, or prose into a command.
    for (const command of [
        "KUBECONFIG=prod kubectl get pods | grep delete",
        "timeout 60 kubectl -n prod get pvc",
        "echo 'the env we use for kubectl can delete things'"
    ]) {
        assert.equal(controlPlane.isDeployShaped(command), false, `must not be deploy-shaped: ${JSON.stringify(command)}`);
    }
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

// ── rls-drift and the nested saas repository ────────────────────────────────
//
// rls-drift read the monorepo's `git diff`, in which `saas/` — gitignored, its
// own repository — does not exist: every run said "No cloud collection config
// changed", whatever had. config-build asked the same question and got the same
// answer, and the preflight stamp ignored saas/ edits too. These pin that the
// harness now sees into the nested repository, and that rls-drift decides on the
// policies the collections compile to rather than on which lines moved.

/** One collection whose only rule goes through a constant, so the two can change apart. */
const NOTES = `const OWNER = "owner = auth.uid()";

// The owner reads their own notes.
export const collections = [
    {
        slug: "notes",
        table: "notes",
        name: "Notes",
        properties: { owner: { type: "string" } },
        securityRules: [{ name: "notes_owner", mode: "permissive", operation: "select", using: OWNER }]
    }
];
`;

/** An outer repo ignoring saas/, and a saas/ repo whose `feature` branch carries `edits`. */
function nestedSaasFixture(edits, { uncommitted = {} } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rls-drift-"));
    const git = (args, cwd) =>
        execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const commit = (cwd, message) =>
        git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", message], cwd);
    const write = (base, files) => {
        for (const [rel, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(base, rel)), { recursive: true });
            fs.writeFileSync(path.join(base, rel), content);
        }
    };

    git(["init", "-q"], root);
    git(["symbolic-ref", "HEAD", "refs/heads/main"], root);
    fs.writeFileSync(path.join(root, ".gitignore"), "/saas\n");
    git(["add", ".gitignore"], root);
    commit(root, "outer");

    const saas = path.join(root, "saas");
    fs.mkdirSync(saas);
    git(["init", "-q"], saas);
    git(["symbolic-ref", "HEAD", "refs/heads/main"], saas);
    write(saas, {
        "package.json": "{}",
        "config/package.json": JSON.stringify({ type: "module" }),
        "config/collections/index.ts": NOTES,
        "backend/drizzle/0000_init.sql": "SELECT 1;\n",
    });
    git(["add", "-A"], saas);
    commit(saas, "base");

    git(["checkout", "-q", "-b", "feature"], saas);
    if (Object.keys(edits).length) {
        write(saas, edits);
        git(["add", "-A"], saas);
        commit(saas, "feature");
    }
    write(saas, uncommitted);
    return root;
}

const saasContext = (root) => ({ root, hasSaas: true, changed: changedFiles(root) });

test("the harness sees changes inside the nested saas repository", () => {
    const root = nestedSaasFixture(
        { "backend/README.md": "committed on the branch\n" },
        {
            uncommitted: {
                // An unstaged edit to a tracked file is the first entry `git status`
                // prints, with a leading space — the entry trimming used to mangle.
                "config/collections/index.ts": NOTES.replace("auth.uid()", "rebase.uid()"),
                "backend/drizzle/0001_notes.sql": "SELECT 2;\n",
            },
        },
    );

    const changed = changedFiles(root);
    assert.ok(changed.includes("saas/backend/README.md"), `committed on the branch: ${changed}`);
    assert.ok(changed.includes("saas/config/collections/index.ts"), `unstaged: ${changed}`);
    assert.ok(changed.includes("saas/backend/drizzle/0001_notes.sql"), `untracked: ${changed}`);
    assert.ok(!changed.includes("saas/package.json"), "unchanged files stay out");
});

test("an unstaged edit that sorts first in git status keeps its whole path", () => {
    // The monorepo half of the same bug: an edited pnpm-lock.yaml listed first
    // was reported as "npm-lock.yaml", and the lockfile check never saw it.
    const root = nestedSaasFixture({});
    fs.writeFileSync(path.join(root, ".gitignore"), "/saas\n# edited\n");
    assert.deepEqual(changedFiles(root).filter((f) => !f.startsWith("saas/")), [".gitignore"]);
});

test("the preflight stamp is invalidated by an edit inside saas/", () => {
    const root = nestedSaasFixture({});
    const before = treeKey({ root });
    fs.writeFileSync(path.join(root, "saas", "backend", "drizzle", "0001_late.sql"), "SELECT 3;\n");
    assert.notEqual(treeKey({ root }), before, "a migration added after preflight must not deploy under its stamp");
});

test("rls-drift fails a compiled policy change with no migration, even one made through a constant", () => {
    // The changed line names no policy, no USING and no securityRules — the
    // line-matching heuristic this replaced would not have looked at it.
    const root = nestedSaasFixture({
        "config/collections/index.ts": NOTES.replace(`"owner = auth.uid()"`, `"true"`),
    });

    const [result] = rlsDrift.run(saasContext(root));

    assert.equal(result.level, FAIL, JSON.stringify(result));
    assert.match(result.message, /public\.notes/);
});

test("rls-drift passes the same change when a migration ships with it", () => {
    const root = nestedSaasFixture({
        "config/collections/index.ts": NOTES.replace(`"owner = auth.uid()"`, `"true"`),
        "backend/drizzle/0001_notes_public.sql": "SELECT 2;\n",
    });

    const [result] = rlsDrift.run(saasContext(root));

    assert.equal(result.level, PASS, JSON.stringify(result));
    assert.match(result.message, /0001_notes_public\.sql/);
});

test("rls-drift passes an edit that changes no compiled policy", () => {
    // A respelling the compiler undoes, and a comment that says "policy".
    const root = nestedSaasFixture({
        "config/collections/index.ts": NOTES
            .replace("auth.uid()", "rebase.uid()")
            .replace("The owner reads their own notes.", "Only the owner reads a note — same policy, new words."),
    });

    const [result] = rlsDrift.run(saasContext(root));

    assert.equal(result.level, PASS, JSON.stringify(result));
    assert.match(result.message, /compile to exactly the policies/);
});

test("rls-drift fails closed when the policies cannot be compiled", () => {
    const root = nestedSaasFixture({ "config/collections/index.ts": `${NOTES}\nexport const = ;\n` });

    const [result] = rlsDrift.run(saasContext(root));

    assert.equal(result.level, FAIL, JSON.stringify(result));
    assert.match(result.message, /could not be compiled/);
});

test("a task's `source` names exactly what is reverted, and everything else is kept", () => {
    const files = ["packages/cms/recipes/README.md", "packages/cms/recipes/site-settings.tsx", "packages/cms/test/recipes/site-settings.test.tsx"];
    const split = splitFiles(files, { source: ["packages/cms/recipes/site-settings.tsx"] });
    assert.deepEqual(split.source, ["packages/cms/recipes/site-settings.tsx"]);
    assert.deepEqual(split.tests, ["packages/cms/recipes/README.md", "packages/cms/test/recipes/site-settings.test.tsx"]);
    // Without one, the README would be reverted with the recipe.
    assert.deepEqual(splitFiles(files).source, ["packages/cms/recipes/README.md", "packages/cms/recipes/site-settings.tsx"]);
});

test("every customization task reverts one recipe and verifies it with that recipe's test", () => {
    const customization = TASKS.filter((t) => t.id.startsWith("customize-"));
    assert.ok(customization.length >= 6);
    for (const task of customization) {
        assert.equal(task.source.length, 1, task.id);
        const recipe = path.basename(task.source[0], ".tsx");
        assert.ok(task.verify.args.some((a) => a.includes(`recipes/${recipe}.test`)), task.id);
    }
});

test("a task pinned by subject resolves to a commit in this history", (t) => {
    const root = context().primaryRoot;
    // CI checks out one commit (`fetch-depth: 1`): there is no history to find
    // a subject in, and an empty answer there says nothing about the pins.
    if (execFileSync("git", ["-C", root, "rev-parse", "--is-shallow-repository"], { encoding: "utf8" }).trim() === "true") {
        t.skip("a shallow clone has no history to resolve a subject in");
        return;
    }
    for (const task of TASKS.filter((t) => t.subject)) {
        const commit = resolveCommit(root, task);
        assert.match(commit, /^[0-9a-f]{7,}$/, task.id);
    }
    assert.equal(resolveCommit(root, { subject: "no commit has this subject line" }), "");
});
