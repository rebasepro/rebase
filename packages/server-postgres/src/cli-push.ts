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

/** The one call {@link applyPoliciesFile} needs from a connection. */
export interface PolicyConnection {
    query(text: string): Promise<unknown>;
}

/** What {@link applyPoliciesFile} stamps, and how to read the definitions back. */
export interface PolicyStamping {
    /**
     * `policyStampSql` of every table whose policies `policies.sql` creates
     * exactly as the boot would — see {@link stampableTables}.
     */
    statements: string[];
    /**
     * The `search_path` a boot reads policies under, when the connection's own
     * differs. A stamp hashes `pg_get_expr`, which spells a function on the
     * path unqualified: read under `"$user", public` with a `rebase` role, the
     * boot's `rebase.uid()` prints as `uid()` and no stamp would ever match.
     */
    searchPath?: string;
}

/**
 * The tables whose stamp `db push` may write: those every one of whose planned
 * statements `policies.sql` carries, verbatim.
 *
 * A stamp says "this stored definition is what the plan's statement made". It
 * is only true of a policy the statement *did* make — and since both are
 * rendered by the same function from the same collections, a table whose
 * statements are all in the file is one whose policies the file just created.
 * Anything else (a hand-edited file, a file generated elsewhere) is not
 * stamped, and the next boot re-applies that table, as before.
 */
export function stampableTables<T extends { policyStatements: string[] }>(plans: readonly T[], policiesSql: string): T[] {
    return plans.filter(plan => plan.policyStatements.length > 0
        && plan.policyStatements.every(statement => policiesSql.includes(statement)));
}

/**
 * Run `policies.sql`, then stamp the policies it created the way a boot does,
 * in the same transaction.
 *
 * Before stamps the push's policies carried none, so the first boot after
 * every push re-applied them all — a DROP and a CREATE per policy, an ACCESS
 * EXCLUSIVE lock per table. Stamped here, that boot finds them current.
 *
 * The file runs in one transaction, as it did as one implicit one: a policy
 * that fails leaves the previous ones in place. The stamps run after it, under
 * a savepoint: a stamp that cannot be written costs the next boot a re-apply,
 * which is what it did before, so it is reported and the policies are kept.
 * Nothing is left set on the connection: `SET LOCAL` ends with the transaction.
 */
export async function applyPoliciesFile(
    client: PolicyConnection,
    policiesSql: string,
    stamping: PolicyStamping
): Promise<{ stamped: number; stampError?: string }> {
    await client.query("BEGIN");
    let stamped = 0;
    let stampError: string | undefined;
    try {
        await client.query(policiesSql);
        if (stamping.statements.length > 0) {
            await client.query("SAVEPOINT rebase_policy_stamps");
            try {
                if (stamping.searchPath) {
                    await client.query(`SET LOCAL search_path TO ${stamping.searchPath}`);
                }
                await client.query(stamping.statements.join("\n"));
                await client.query("RELEASE SAVEPOINT rebase_policy_stamps");
                stamped = stamping.statements.length;
            } catch (err) {
                await client.query("ROLLBACK TO SAVEPOINT rebase_policy_stamps");
                stampError = err instanceof Error ? err.message : String(err);
            }
        }
        await client.query("COMMIT");
    } catch (err) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw err;
    }
    return { stamped, stampError };
}
