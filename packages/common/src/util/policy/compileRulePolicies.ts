import type { CollectionConfig, SecurityOperation, SecurityRule } from "@rebasepro/types";
import { getPolicyNamesForRule } from "@rebasepro/utils";
import { getTableName } from "../relations";
import { securityRuleToConditions } from "./securityRuleToConditions";
import { policyToPostgres, type PolicyCompileOptions } from "./policyToPostgres";

/**
 * One Postgres policy a security rule compiles to: its name and the clauses
 * `CREATE POLICY` is given for it.
 */
export interface CompiledRulePolicy {
    name: string;
    operation: SecurityOperation;
    /** `permissive` | `restrictive`, lower-case as the rule spells it. */
    mode: "permissive" | "restrictive";
    /** The `TO` list. Sorted, `["public"]` when the rule names none. */
    roles: string[];
    /** The `USING` clause, or `null` when the operation takes none. */
    using: string | null;
    /** The `WITH CHECK` clause, or `null` when the operation takes none. */
    withCheck: string | null;
}

/**
 * The policies one security rule compiles to — one per operation.
 *
 * The schema planner writes these into the database, and the Studio's RLS
 * editor compares the database against them; both call this, so "what the code
 * declares" has one meaning.
 *
 * The desugaring (`access` / `ownerField` / `roles` / structured condition /
 * raw SQL → `PolicyExpression`) is {@link securityRuleToConditions}, and the SQL
 * is {@link policyToPostgres}. What lives here is only the shape: which
 * operations a rule expands to, which clauses each operation takes, and the
 * deny-all fallback for a clause that compiled to nothing.
 */
export function compileRulePolicies(
    collection: CollectionConfig,
    rule: SecurityRule,
    options?: PolicyCompileOptions
): CompiledRulePolicy[] {
    const ops = rule.operations && rule.operations.length > 0 ? rule.operations : [rule.operation ?? "all"];
    const policyNames = getPolicyNamesForRule(rule, getTableName(collection));
    const { usingExpr, withCheckExpr } = securityRuleToConditions(rule);

    return ops.map((operation, index) => {
        const needsUsing = operation !== "insert";
        const needsWithCheck = operation !== "select" && operation !== "delete";
        let using = needsUsing && usingExpr ? policyToPostgres(usingExpr, collection, options) : null;
        let withCheck = needsWithCheck && withCheckExpr ? policyToPostgres(withCheckExpr, collection, options) : null;
        // A clause that compiled to nothing denies rather than opens.
        if (!using && needsUsing) using = "false";
        if (!withCheck && needsWithCheck) withCheck = "false";
        return {
            name: policyNames[index],
            operation,
            mode: rule.mode ?? "permissive",
            roles: rule.pgRoles ? [...rule.pgRoles].sort() : ["public"],
            using,
            withCheck
        };
    });
}
