# Agent harness

Two things that share one mechanism:

1. **A deploy gate** — blocks deploy-shaped commands whose preflight fails, before they run.
2. **An eval harness** — scores agents on benchmark tasks derived from this repo's own fix commits.

They share the hook layer: the same `PreToolUse`/`PostToolUse` hooks that enforce the gate
also write the trace the eval graders read. That is why an eval can score *how* an agent
worked, not just whether the test went green.

```
tooling/scripts/harness/
  harness.mjs         entrypoint — preflight | eval | trace
  lib/                repo context, result shape, JSONL trace
  checks/             one file per deploy-safety check
  deploy/preflight.mjs the gate; writes a stamp keyed to the working tree
  hooks/              PreToolUse (gate + trace), PostToolUse (outcomes)
  eval/               task derivation, runner, graders
  test/               tests for the harness itself
```

## Deploy gate

```bash
pnpm harness:preflight
```

Runs every check and writes a stamp keyed to the exact tree (HEAD **plus** a hash of
`git status`, so any uncommitted edit invalidates it). The `PreToolUse` hook reads that
stamp; a `fail` denies the command, a `warn` escalates to the user, and anything not
deploy-shaped is traced silently and allowed.

The hook **fails open**. If a check crashes, the tool call proceeds and the error goes to
the trace — a broken check must not be able to wedge a session.

| Check | What it catches |
|---|---|
| `lockfile-worktree` | `pnpm-lock.yaml` modified in a worktree, where the gitignored `saas/` member is absent so an install prunes it silently, exit 0 |
| `migration-order` | A drizzle migration sorting at or before main's latest. The migrator tracks a high-water mark, so such a migration is never applied and never reported |
| `rls-drift` | `securityRules` edited in `saas/config` with no migration. Cloud RLS lives in hand-written migration SQL; boot never reconciles it, so the edit is cosmetic |
| `config-build` | `saas/config` not compiling. The backend's tsc does not cover it, dev loads TS source, production loads `config/dist` |
| `control-plane` | A deploy aimed at Cloud Run or Terraform, which do not serve `app.rebase.pro` (GKE does), and destructive `kubectl` verbs |

Add a check by dropping a module in `checks/` that exports `id`, `title`, and
`run(ctx, { command })` returning findings, then listing it in `deploy/preflight.mjs`.

## Eval harness

```bash
pnpm harness:eval -- --list
pnpm harness:eval -- --task dev-port-retry --yes
pnpm harness:eval -- --yes --json
```

A task is a commit that fixed a bug **and** added the regression test proving it. The
runner reverts only the source half, leaving a grader written by someone who understood
the bug. Tasks live in `eval/tasks.mjs`; adding one is a commit hash, a prompt, and a
verify command.

Each run is gated on both sides before the agent is invoked:

- verify must **pass** at the fix commit — otherwise a later failure proves nothing about
  the code, only that the environment or command is wrong;
- verify must **fail** after the revert — otherwise the bug was not reintroduced and a
  do-nothing agent would score a pass.

A task failing either gate is reported `INVALID` rather than scored. This is not
theoretical: the first version of this runner symlinked `node_modules` onto itself, pnpm
died with `ELOOP`, and that read as "the bug reproduced" — every task would have passed
its gate for the wrong reason.

Verify commands deliberately avoid `pnpm` (it reads workspace state through the symlinked
`node_modules`) and never use `--passWithNoTests` (a filter matching nothing must fail).

### Scoring

Functional correctness gates the score; the rest is deducted from 100 for habits, read
from the diff and the trace. Editing the regression test scores **0** outright rather than
taking a deduction — it makes the functional signal a lie, so it invalidates the pass.

Deductions: `npm`/`yarn` (repo is pnpm-only), `git add -A` (clobbers concurrent sessions),
`pnpm install` in a worktree, one-off scripts left in the repo root, a deploy the gate
blocked, and — when the fix landed — never having run a test or typecheck at all.

Controls, run against the seed set: a no-op agent scores 40, restoring the real fix scores
85 (deducted for not verifying), deleting the test scores 0.

### Running your own agent

```bash
pnpm harness:eval -- --agent "claude -p --permission-mode bypassPermissions {prompt}" --yes
```

`{prompt}` is substituted with the bug report. The default template bypasses permission
prompts so runs are unattended — each task runs in a throwaway worktree under
`.claude/harness/eval/`. `--yes` is required to proceed, `--keep` leaves the worktree for
inspection.

## Tests

```bash
pnpm test:harness
```

Worth keeping green: the harness broke once in a way nothing could have caught at runtime.
`git rev-parse --path-format=absolute` is silently ignored by git < 2.31 — it echoes the
flag back and returns a relative path — which resolved the primary root to `.` and made
`isWorktree` false everywhere. The worktree checks did not fail; they stopped running.
