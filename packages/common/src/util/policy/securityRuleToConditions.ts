import { PolicyExpression, SecurityRule, policy } from "@rebasepro/types";

/**
 * The normalized `USING` / `WITH CHECK` conditions for a single security rule,
 * expressed in the engine-agnostic {@link PolicyExpression} model.
 *
 * A `null` clause means "this rule contributes no condition for that clause";
 * consumers apply the default (Postgres denies with `false`).
 */
export interface RuleConditions {
    usingExpr: PolicyExpression | null;
    withCheckExpr: PolicyExpression | null;
}

/**
 * Desugars a {@link SecurityRule} — its `access`/`ownerField`/`roles` shortcuts,
 * structured `condition`/`check`, and raw `using`/`withCheck` — into a single
 * normalized {@link PolicyExpression} pair.
 *
 * **This is the linchpin against drift:** both the Postgres DDL generators and
 * the client-side evaluator consume this one function, so there is exactly one
 * definition of what a rule means. In particular, application `roles` are folded
 * into the expression here (AND'd with the base condition, matching how Postgres
 * generates the clause) rather than being handled separately by each consumer.
 */
export function securityRuleToConditions(rule: SecurityRule): RuleConditions {
    return {
        usingExpr: withRoles(baseUsing(rule), rule),
        withCheckExpr: withRoles(baseWithCheck(rule), rule)
    };
}

function baseUsing(rule: SecurityRule): PolicyExpression | null {
    if (rule.condition) return rule.condition;
    if (rule.using != null) return policy.raw(rule.using);
    if (rule.access === "public") return policy.true();
    if (rule.ownerField) return policy.compare(policy.field(rule.ownerField), "eq", policy.authUid());
    return null;
}

function baseWithCheck(rule: SecurityRule): PolicyExpression | null {
    if (rule.check) return rule.check;
    if (rule.withCheck != null) return policy.raw(rule.withCheck);
    // No explicit WITH CHECK → fall back to the USING condition, matching
    // PostgreSQL's own default behavior.
    return baseUsing(rule);
}

/**
 * AND the base condition with an application-role check, or produce a roles-only
 * condition when there is no base. Mirrors the Postgres generator so that a
 * role-scoped restrictive rule denies exactly the same set of users on both
 * sides.
 */
function withRoles(base: PolicyExpression | null, rule: SecurityRule): PolicyExpression | null {
    if (!rule.roles || rule.roles.length === 0) return base;
    const rolesExpr = policy.rolesOverlap(rule.roles);
    return base ? policy.and(base, rolesExpr) : rolesExpr;
}
