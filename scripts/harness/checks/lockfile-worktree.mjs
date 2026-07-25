/**
 * Never regenerate the lockfile from a worktree.
 *
 * `saas/` is gitignored but is a real pnpm workspace member. A worktree created by
 * `git worktree add` does not contain it, so `pnpm install` there resolves a workspace
 * that is genuinely missing four importers and rewrites the lockfile to match —
 * dropping ~700 lines and exiting 0. Nothing fails. The damage is only visible when
 * the pruned lockfile reaches CI, which installs `--frozen-lockfile` against a
 * workspace that *does* have those members.
 *
 * The lockfile may only be regenerated in the primary checkout.
 */
import { context } from "../lib/ctx.mjs";
import { finding, pass, FAIL } from "../lib/report.mjs";

export const id = "lockfile-worktree";
export const title = "Lockfile not regenerated in a worktree";

export function run(ctx = context()) {
    if (!ctx.isWorktree) return [pass(id, "Primary checkout — lockfile changes are allowed here.")];

    if (!ctx.changed.includes("pnpm-lock.yaml")) {
        return [pass(id, "Worktree, and the lockfile is untouched.")];
    }

    return [
        finding(
            id,
            FAIL,
            `pnpm-lock.yaml is modified inside a worktree (${ctx.root}). The gitignored saas/ workspace member is absent here, ` +
                `so any install pruned it from the lockfile — silently, exit 0.`,
            `git checkout pnpm-lock.yaml, then run the install in the primary checkout (${ctx.primaryRoot}) and copy the result back.`,
        ),
    ];
}
