/**
 * Applying a bundle's RLS policies to a database at boot, idempotently.
 *
 * ## Why this exists
 *
 * {@link ensureCollectionTables} creates the collection *tables* a managed
 * runtime boots against, but a table with row-level security disabled and no
 * policies is not servable: authenticated requests run as the restricted
 * `rebase_user` role, so a read with no `SELECT` policy returns nothing (a
 * public collection answered 401) and a write with no `INSERT`/`UPDATE` policy
 * is denied. The policies live in the collections' `securityRules`; nothing at
 * boot applied them. `rebase db push` does — but it drives Atlas against a
 * local `DATABASE_URL`, and a managed tenant's database is reachable only from
 * inside the cluster, by the runtime that is already connected to it. So the
 * runtime is the only thing that *can* apply them, and this is where it does.
 *
 * ## Why this is safe to run on every boot
 *
 * Every statement is idempotent: `ENABLE ROW LEVEL SECURITY` is a no-op once
 * enabled, and each policy is a `DROP POLICY IF EXISTS` immediately followed by
 * a `CREATE POLICY`, so re-applying asserts exactly the declared state. It adds
 * and replaces; it never drops data. (It does not *reconcile* — a policy a
 * previous push left behind under an old name is not removed here; that stays a
 * `db push` / `db migrate` concern, alongside destructive schema changes.)
 *
 * Unlike table creation, a failure here is not fatal: RLS stays enabled, so a
 * table whose policies could not be applied fails **closed** (denies) rather
 * than leaking rows. One collection's policy failing (e.g. a rule that
 * references a table a real migration has not created yet) must not crash-loop
 * the whole deployment and take the other collections' working routes down with
 * it. Failures are reported loudly and per-table so the operator can see
 * exactly which collection is not yet servable and why.
 */
import { type CollectionConfig } from "@rebasepro/types";
import { planCollectionPolicies } from "./generate-postgres-ddl-logic";
import { readExistingSchema, type Queryable } from "./ensure-collection-tables";

export interface PolicyEnsureResult {
    /** `CREATE POLICY` statements that ran successfully. */
    policiesApplied: number;
    /** Tables that had RLS enabled. */
    tablesSecured: number;
    /** Declared tables absent from the database — left to a real migration. */
    skipped: { table: string; reason: string }[];
    /** Tables whose RLS could not be fully applied (fail closed). */
    failures: { table: string; error: string }[];
}

const isCreatePolicy = (statement: string): boolean => /^\s*CREATE POLICY/i.test(statement);

/**
 * Bring the declared collections' RLS policies up to date. Returns what it did.
 *
 * Only tables that already exist are touched: the boot-time table creator runs
 * first, so anything still missing is a table this additive path is not allowed
 * to create (a junction, or a relation left to a migration). Enabling RLS on a
 * non-existent table would error, so those are recorded as skipped, not failed.
 */
export async function ensureCollectionPolicies(
    client: Queryable,
    collections: CollectionConfig[],
    log?: (message: string) => void
): Promise<PolicyEnsureResult> {
    const result: PolicyEnsureResult = { policiesApplied: 0, tablesSecured: 0, skipped: [], failures: [] };

    const plans = planCollectionPolicies(collections);
    if (plans.length === 0) return result;

    const schemas = Array.from(new Set(plans.map(p => p.schema)));
    const existing = await readExistingSchema(client, schemas);

    for (const plan of plans) {
        if (!existing.tables.has(plan.qualified)) {
            result.skipped.push({
                table: plan.qualified,
                reason: "table is not present in the database; create it with `rebase db push` / `rebase db migrate`"
            });
            continue;
        }

        try {
            // Enable first: if a later policy statement fails, the table is left
            // locked (deny-all for the user role) rather than open.
            await client.query(plan.enableRls);
            result.tablesSecured++;

            let created = 0;
            for (const statement of plan.policyStatements) {
                await client.query(statement);
                if (isCreatePolicy(statement)) {
                    result.policiesApplied++;
                    created++;
                }
            }
            log?.(`${plan.qualified}: RLS enabled, ${created} policy(ies) applied`);
        } catch (err) {
            result.failures.push({
                table: plan.qualified,
                error: err instanceof Error ? err.message : String(err)
            });
        }
    }

    return result;
}
