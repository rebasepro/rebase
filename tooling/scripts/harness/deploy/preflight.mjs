/**
 * The gate every deploy has to pass.
 *
 * Each check here corresponds to a way a deploy has actually gone wrong: a migration
 * that was skipped instead of applied, an RLS tightening that never left the config
 * file, a config package that only production compiles, a lockfile pruned by a
 * worktree install, a deploy aimed at the control plane that serves nothing.
 *
 * On success it writes a stamp keyed to the exact tree state. The PreToolUse hook
 * reads that stamp, which is what makes this gate rather than advice — and why the
 * stamp is invalidated by any edit, not just by a new commit.
 */
import fs from "node:fs";
import path from "node:path";
import { context, sh } from "../lib/ctx.mjs";
import { print, blocking } from "../lib/report.mjs";

import * as migrationOrder from "../checks/migration-order.mjs";
import * as rlsDrift from "../checks/rls-drift.mjs";
import * as configBuild from "../checks/config-build.mjs";
import * as lockfileWorktree from "../checks/lockfile-worktree.mjs";
import * as controlPlane from "../checks/control-plane.mjs";

export const CHECKS = [lockfileWorktree, migrationOrder, rlsDrift, configBuild, controlPlane];

/**
 * Identity of the working tree, not just of HEAD.
 *
 * Keying the stamp on the commit alone would let an agent pass preflight, edit a
 * migration, and still deploy under the old stamp. Hashing the porcelain status
 * alongside HEAD means any uncommitted edit invalidates it.
 */
export function treeKey(ctx = context()) {
    const head = sh("git", ["rev-parse", "HEAD"], ctx.root) || "nohead";
    const dirty = sh("git", ["status", "--porcelain=v1"], ctx.root);
    let hash = 0;
    for (let i = 0; i < dirty.length; i++) hash = (Math.imul(31, hash) + dirty.charCodeAt(i)) | 0;
    return `${head.slice(0, 12)}-${(hash >>> 0).toString(16)}`;
}

export function stampPath(ctx = context()) {
    return path.join(ctx.primaryRoot, ".claude", "harness", `preflight-${treeKey(ctx)}.json`);
}

/** A passing stamp for this exact tree, if one exists and is recent enough to trust. */
export function readStamp(ctx = context(), maxAgeMs = 60 * 60 * 1000) {
    try {
        const stamp = JSON.parse(fs.readFileSync(stampPath(ctx), "utf8"));
        if (!stamp.ok) return null;
        if (Date.now() - stamp.at > maxAgeMs) return null;
        return stamp;
    } catch {
        return null;
    }
}

export function runChecks({ command = "" } = {}) {
    const ctx = context();
    return CHECKS.flatMap((check) => {
        try {
            return check.run(ctx, { command });
        } catch (error) {
            // A crashing check must fail loudly rather than silently passing the deploy.
            return [{ id: check.id, level: "fail", message: `Check "${check.id}" crashed: ${error.message}` }];
        }
    });
}

export function main(argv = process.argv.slice(2)) {
    const json = argv.includes("--json");
    const cmdIndex = argv.indexOf("--command");
    const command = cmdIndex >= 0 ? argv[cmdIndex + 1] || "" : "";

    const ctx = context();
    const findings = runChecks({ command });
    const failed = blocking(findings);

    print(findings, { json, title: `Deploy preflight — ${ctx.branch}${ctx.isWorktree ? " (worktree)" : ""}` });

    const stamp = { ok: !failed, at: Date.now(), branch: ctx.branch, key: treeKey(ctx), findings };
    try {
        fs.mkdirSync(path.dirname(stampPath(ctx)), { recursive: true });
        fs.writeFileSync(stampPath(ctx), JSON.stringify(stamp, null, 2));
    } catch {
        // Losing the stamp only means the next deploy re-runs preflight. Not fatal.
    }

    if (!json) {
        process.stdout.write(
            failed
                ? "\n\x1b[31mPreflight failed — deploy is blocked until these are resolved.\x1b[0m\n"
                : "\n\x1b[32mPreflight passed.\x1b[0m\n",
        );
    }
    return failed ? 1 : 0;
}

if (import.meta.filename === process.argv[1]) process.exit(main());
