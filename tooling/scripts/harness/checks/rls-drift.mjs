/**
 * In the cloud app, editing `securityRules` changes nothing by itself.
 *
 * The OSS framework compiles securityRules into policies at boot. The cloud app does
 * not: its RLS lives in hand-written SQL inside drizzle migrations, and boot never
 * reconciles the two. So a securityRules edit there is documentation — the policy in
 * the database is whatever the last migration created.
 *
 * The dangerous direction is the permissive one. An agent tightens a rule in config,
 * sees it in the diff, and reports the hole closed while the database still serves the
 * old policy. This check refuses to let a securityRules change reach a deploy without
 * a migration that actually rewrites the policy.
 */
import { context, changedUnder, sh } from "../lib/ctx.mjs";
import { finding, pass, FAIL } from "../lib/report.mjs";

export const id = "rls-drift";
export const title = "Cloud RLS config/migration drift";

const CONFIG_PREFIX = "saas/config/collections/";
const MIGRATION_PREFIX = "saas/backend/drizzle/";

export function run(ctx = context()) {
    if (!ctx.hasSaas) return [pass(id, "No cloud workspace present — RLS drift check not applicable.")];

    const touched = changedUnder(CONFIG_PREFIX);
    if (!touched.length) return [pass(id, "No cloud collection config changed.")];

    // Only a securityRules edit matters; a label or column change is inert here.
    const withRules = touched.filter((file) => diffTouchesSecurityRules(ctx.root, file));
    if (!withRules.length) return [pass(id, "Cloud collections changed, but no securityRules were touched.")];

    const migrations = changedUnder(MIGRATION_PREFIX).filter((f) => f.endsWith(".sql"));
    if (migrations.length) {
        return [pass(id, `securityRules changed in ${withRules.length} collection(s), with migration(s): ${migrations.join(", ")}.`)];
    }

    return [
        finding(
            id,
            FAIL,
            `securityRules changed in ${withRules.join(", ")} with no accompanying migration SQL. ` +
                `The deployed policy will not change — the edit is cosmetic.`,
            `Add a migration under ${MIGRATION_PREFIX} that DROPs and re-CREATEs the affected policies, then verify against a prod replica.`,
        ),
    ];
}

/** True when the branch's own diff for this file adds or removes a securityRules line. */
function diffTouchesSecurityRules(root, file) {
    const base = sh("git", ["merge-base", "HEAD", "main"], root);
    const args = base ? ["diff", `${base}...HEAD`, "--", file] : ["diff", "--", file];
    const committed = sh("git", args, root);
    const working = sh("git", ["diff", "HEAD", "--", file], root);

    return [committed, working]
        .join("\n")
        .split("\n")
        .some((line) => /^[+-]/.test(line) && !/^[+-]{3}/.test(line) && /securityRules|policy|USING|WITH CHECK/i.test(line));
}
