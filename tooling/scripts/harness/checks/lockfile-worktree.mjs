/**
 * Never let a worktree install prune workspace importers from the lockfile.
 *
 * `saas/` is gitignored but is a real pnpm workspace member. A worktree created by
 * `git worktree add` does not contain it, so `pnpm install` there resolves a workspace
 * that is genuinely missing its importers and rewrites the lockfile to match —
 * dropping ~700 lines and exiting 0. Nothing fails. The damage is only visible when
 * the pruned lockfile reaches CI, which installs `--frozen-lockfile` against a
 * workspace that *does* have those members.
 *
 * What is judged is the damage, not the edit. A branch may change the lockfile on
 * purpose (a dependency bump, a member retired), and a worktree may have `saas/`
 * checked out, in which case an install there resolves the whole workspace. So the
 * check compares the lockfile's importers with the ones it had at the merge-base:
 * an importer that disappeared is legitimate only when its member is gone from the
 * tree too. One whose `package.json` is still here, or one under a nested
 * repository this worktree does not have checked out, was pruned.
 */
import fs from "node:fs";
import path from "node:path";
import { baseRevision, context, sh } from "../lib/ctx.mjs";
import { finding, pass, FAIL } from "../lib/report.mjs";

export const id = "lockfile-worktree";
export const title = "Lockfile not pruned by a worktree install";

const LOCKFILE = "pnpm-lock.yaml";

/** Nested repositories that are workspace members; see `pnpm-workspace.yaml`. */
const NESTED_MEMBER_PREFIXES = ["saas"];

/**
 * The importer keys of a pnpm lockfile, in order: the two-space-indented keys
 * under the top-level `importers:` map.
 */
export function lockfileImporters(text) {
    const importers = [];
    let inImporters = false;
    for (const line of text.split("\n")) {
        if (/^\S/.test(line)) {
            inImporters = line.startsWith("importers:");
            continue;
        }
        if (!inImporters) continue;
        const match = /^ {2}([^\s:'"][^:]*|'[^']*'|"[^"]*"):/.exec(line);
        if (match) importers.push(match[1].replace(/^['"]|['"]$/g, ""));
    }
    return importers;
}

/**
 * Importers present in `before` and absent from `after` that were not retired:
 * their member still has a `package.json` under `root`, or they live under a
 * nested repository that is not checked out there (so nothing could have retired
 * them from this tree).
 */
export function prunedImporters(before, after, root) {
    const kept = new Set(after);
    return before.filter((importer) => {
        if (kept.has(importer)) return false;
        const nested = NESTED_MEMBER_PREFIXES.find((prefix) => importer === prefix || importer.startsWith(`${prefix}/`));
        if (nested && !fs.existsSync(path.join(root, nested, "package.json"))) return true;
        return fs.existsSync(path.join(root, importer, "package.json"));
    });
}

/**
 * `ctx.readLockfile(rev)` may be supplied by a caller (tests); by default the
 * base revision's lockfile is read from git and the current one from disk.
 */
function readLockfiles(ctx) {
    if (ctx.readLockfile) return { base: ctx.readLockfile("base"), current: ctx.readLockfile("current") };
    const base = baseRevision(ctx.root);
    let current = "";
    try {
        current = fs.readFileSync(path.join(ctx.root, LOCKFILE), "utf8");
    } catch {
        current = "";
    }
    return { base: base ? sh("git", ["show", `${base}:${LOCKFILE}`], ctx.root, { trim: false }) : "", current };
}

export function run(ctx = context()) {
    if (!ctx.isWorktree) return [pass(id, "Primary checkout — lockfile changes are allowed here.")];

    if (!ctx.changed.includes(LOCKFILE)) {
        return [pass(id, "Worktree, and the lockfile is untouched.")];
    }

    const fix = `Restore ${LOCKFILE} from the base, then run the install in the primary checkout (${ctx.primaryRoot}) and copy the result back.`;
    const { base, current } = readLockfiles(ctx);
    if (!base || !current) {
        // Without both sides there is nothing to compare, so the old rule applies:
        // a lockfile changed in a worktree is presumed pruned.
        return [
            finding(
                id,
                FAIL,
                `${LOCKFILE} is modified inside a worktree (${ctx.root}) and its importers cannot be compared with the merge-base — ` +
                    `an install here may have pruned workspace members, silently, exit 0.`,
                fix,
            ),
        ];
    }

    const pruned = prunedImporters(lockfileImporters(base), lockfileImporters(current), ctx.root);
    if (pruned.length === 0) {
        return [pass(id, "Worktree lockfile changed, and every workspace importer it had at the merge-base is still there or was retired with its member.")];
    }

    const absentNested = NESTED_MEMBER_PREFIXES.filter((prefix) => !fs.existsSync(path.join(ctx.root, prefix, "package.json")));
    const why = absentNested.length
        ? ` The gitignored ${absentNested.map((p) => `${p}/`).join(", ")} workspace member is absent from this worktree, so an install here prunes it.`
        : " Their members are still in this tree, so an install dropped them without the members being retired.";
    return [
        finding(
            id,
            FAIL,
            `${LOCKFILE} in a worktree (${ctx.root}) lost importer(s) ${pruned.join(", ")}.${why}`,
            fix,
        ),
    ];
}
