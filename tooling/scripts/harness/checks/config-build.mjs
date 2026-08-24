/**
 * The cloud app's config is a separate compile from its backend.
 *
 * `saas/backend`'s tsc does not cover `saas/config`. Dev loads the config from TS
 * source, so a type error there is invisible locally; production loads `config/dist`,
 * which is only produced by running the config package's own build. The result is a
 * deploy that builds green and boots into a stale or missing config bundle.
 *
 * So: if the branch touched the config package, compile it here rather than trusting
 * that some other gate did.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { context, changedUnder } from "../lib/ctx.mjs";
import { finding, pass, FAIL } from "../lib/report.mjs";

export const id = "config-build";
export const title = "Cloud config package compiles";

export function run(ctx = context()) {
    if (!ctx.hasSaas) return [pass(id, "No cloud workspace present — config build not applicable.")];

    if (!changedUnder("saas/config/").length) return [pass(id, "Cloud config package unchanged.")];

    const configDir = path.join(ctx.root, "saas", "config");
    const tsc = path.join(ctx.root, "node_modules", ".bin", "tsc");
    if (!fs.existsSync(tsc)) {
        return [finding(id, FAIL, "Cannot compile saas/config: node_modules/.bin/tsc is missing.", "pnpm install in the primary checkout, then symlink node_modules into this worktree.")];
    }

    try {
        execFileSync(tsc, ["--noEmit", "-p", "tsconfig.json"], { cwd: configDir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
        const output = `${error.stdout || ""}${error.stderr || ""}`.trim().split("\n").slice(0, 8).join("\n  ");
        return [
            finding(
                id,
                FAIL,
                `saas/config does not compile — production loads config/dist, so this ships broken:\n  ${output}`,
                "cd saas/config && pnpm build",
            ),
        ];
    }

    return [pass(id, "saas/config compiles cleanly.")];
}
