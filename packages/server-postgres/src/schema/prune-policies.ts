/**
 * `rebase db push --prune-policies`: drop the policies on the project's own
 * tables that no table declares.
 *
 * The push replaces the policies a table declares and drops the ones an
 * earlier push generated from a rule edited since. Any other policy on the
 * table — one written by hand, or one a database had before `schema
 * introspect` — it leaves in force, and Postgres ORs every PERMISSIVE policy
 * together: moving a table to `rls: "admin-only"` left its old
 * `USING (true)` policy granting every row, and the push could only list it.
 *
 * Exactly those, and only those: a policy the dry run lists as left in force,
 * on a table `backend/schema` declares (or a junction one of its relations
 * declares), outside the `rebase` schema, whose policies are the framework's.
 * A table the project does not declare is never touched — the database may be
 * shared with something else. Dropping one changes who can read and write
 * rows — a RESTRICTIVE one dropped widens access — so the push lists each and
 * gates them as it gates a dropped column.
 */
import type { CompiledTable } from "@rebasepro/types";

import type { PolicyRef } from "../security/policy-drift";
import { planTablePolicies } from "./generate-postgres-ddl-logic";

/** The schema whose tables and policies are the framework's. */
export const FRAMEWORK_SCHEMA = "rebase";

/** Of the policies the push leaves in force, the ones `--prune-policies` drops. */
export function prunablePolicies(kept: readonly PolicyRef[], compiledTables: readonly CompiledTable[]): PolicyRef[] {
    const declared = new Set(planTablePolicies(compiledTables).map(plan => `${plan.schema}.${plan.table}`));
    return kept.filter(policy => policy.schema !== FRAMEWORK_SCHEMA && declared.has(`${policy.schema}.${policy.table}`));
}

const ident = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

/**
 * The statements that drop them, `IF EXISTS` so a policy removed by hand
 * between the plan and the apply is not an error. Run inside the transaction
 * that applies the declared policies, so a table gets its new policies and
 * loses the old ones at once, or neither.
 */
export function prunePoliciesSql(policies: readonly PolicyRef[]): string {
    return policies
        .map(policy => `DROP POLICY IF EXISTS ${ident(policy.name)} ON ${ident(policy.schema)}.${ident(policy.table)};`)
        .join("\n");
}

/** One policy, the way the push names it. */
export function describePrunedPolicy(policy: PolicyRef): string {
    const mode = policy.mode === "RESTRICTIVE" ? "RESTRICTIVE " : "";
    return `${policy.schema}.${policy.table} → "${policy.name}" (${mode}${policy.command} TO ${policy.roles.join(", ")})`;
}

/** What the push says before it asks: the policies it would drop, and what that does. */
export function prunedPolicyLines(policies: readonly PolicyRef[]): string[] {
    if (policies.length === 0) return [];
    const widening = policies.filter(policy => policy.mode === "RESTRICTIVE").length;
    return [
        `  --prune-policies drops ${policies.length} ${policies.length === 1 ? "policy" : "policies"} no table declares, ` +
            "which changes who can read and write those tables' rows:",
        ...policies.map(policy => `       drop policy     ${describePrunedPolicy(policy)}`),
        ...(widening > 0
            ? [`  ${widening} of them ${widening === 1 ? "is" : "are"} RESTRICTIVE: dropping a restrictive policy widens access.`]
            : [])
    ];
}
