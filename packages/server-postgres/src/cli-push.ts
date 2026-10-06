import { isSyncedPlan } from "./schema/destructive-sql";

/**
 * The steps `rebase db push` takes once the dry-run has been read and gated.
 *
 * Callbacks rather than calls, so the order is testable without a database or
 * an Atlas binary: `cli.ts` itself cannot be loaded by the jest suite.
 */
export interface PushApplySteps {
    /** Drop the generated columns that read a column the plan retypes. */
    dropRebuildable: () => Promise<void>;
    /** `atlas schema apply --auto-approve`: Atlas plans again, then applies. */
    atlasApply: () => Promise<void>;
    /** Say what the skipped apply would have printed. */
    reportSynced: () => void;
    /** Put those generated columns back after a failed apply. */
    rebuildAfterFailure: () => Promise<void>;
    /**
     * Everything Atlas cannot see: RLS locks, auth tables, vector, search,
     * triggers, policies, the user role. Runs whether or not Atlas had work.
     */
    afterApply: () => Promise<void>;
}

/**
 * Apply a planned push.
 *
 * A dry-run that answered "Schema is synced" skips the second Atlas run: that
 * run would plan the same diff again (≈0.9 s at 111 tables, 5.5 s at 411 —
 * Atlas's cost grows faster than the table count) and then apply nothing. The
 * steps after it still run, because Atlas cannot see what they own. A plan with
 * anything in it keeps the old flow, including Atlas re-planning at apply time.
 *
 * @returns `"synced"` when Atlas was not run again, `"applied"` otherwise.
 */
export async function applyPushPlan(
    plan: { dryRun: string; rebuildable: number },
    steps: PushApplySteps
): Promise<"applied" | "synced"> {
    const synced = isSyncedPlan(plan.dryRun) && plan.rebuildable === 0;
    if (synced) {
        steps.reportSynced();
    } else {
        if (plan.rebuildable > 0) await steps.dropRebuildable();
        try {
            await steps.atlasApply();
        } catch (err) {
            // Atlas rolled its transaction back, so the columns those
            // expressions read are as they were and the definitions in
            // search.sql still fit. Put them back before surfacing the failure:
            // a push that fails must not also leave search broken.
            if (plan.rebuildable > 0) await steps.rebuildAfterFailure();
            throw err;
        }
    }
    await steps.afterApply();
    return synced ? "synced" : "applied";
}
