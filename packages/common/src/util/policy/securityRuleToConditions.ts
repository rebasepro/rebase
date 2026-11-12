import { PolicyExpression, SecurityRule, SecurityRuleAccess, policy } from "@rebasepro/types";
import { sqlToPolicy } from "./sqlToPolicy";
import { policyConditionToExpression, type PolicyConditionSite } from "./policyCondition";

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
 * structured `condition`/`check` (an expression or the `PolicyShorthand`
 * object form, see {@link policyConditionToExpression}), and raw
 * `using`/`withCheck` — into a single normalized {@link PolicyExpression}
 * pair. `access` combined with a condition gates it: `"public"` leaves the
 * condition as it is, `"authenticated"` ANDs `policy.authenticated()` on.
 *
 * **This is the linchpin against drift:** both the Postgres DDL generators and
 * the client-side evaluator consume this one function, so there is exactly one
 * definition of what a rule means. In particular, application `roles` are folded
 * into the expression here (AND'd with the base condition, matching how Postgres
 * generates the clause) rather than being handled separately by each consumer.
 */
export function securityRuleToConditions(rule: SecurityRule, site: Pick<PolicyConditionSite, "table"> = {}): RuleConditions {
    return {
        usingExpr: withRoles(baseUsing(rule, site), rule),
        withCheckExpr: withRoles(baseWithCheck(rule, site), rule)
    };
}

/**
 * A condition under an `access` gate. `"public"` adds nothing — `true AND c`
 * is `c` — so a public rule's clause is its condition, as written.
 */
function gated(access: SecurityRuleAccess | undefined, condition: PolicyExpression): PolicyExpression {
    return access === "authenticated" ? policy.and(policy.authenticated(), condition) : condition;
}

function baseUsing(rule: SecurityRule, site: Pick<PolicyConditionSite, "table">): PolicyExpression | null {
    // A legacy rule never carries `access` beside a condition, so for it this
    // is the condition itself — the same object, compiled as it always was.
    if (rule.condition != null) return gated(rule.access, policyConditionToExpression(rule.condition, { ...site, clause: "condition" }));
    if (rule.using != null) return sqlToPolicy(rule.using);
    // `access` alone (or with only a `check`): the caller test itself.
    if (rule.access === "public") return policy.true();
    if (rule.access === "authenticated") return policy.authenticated();
    if (rule.ownerField) return policy.compare(policy.field(rule.ownerField), "eq", policy.authUid());
    return null;
}

function baseWithCheck(rule: SecurityRule, site: Pick<PolicyConditionSite, "table">): PolicyExpression | null {
    if (rule.check != null) return gated(rule.access, policyConditionToExpression(rule.check, { ...site, clause: "check" }));
    if (rule.withCheck != null) return sqlToPolicy(rule.withCheck);
    // No explicit WITH CHECK → fall back to the USING condition, matching
    // PostgreSQL's own default behavior.
    return baseUsing(rule, site);
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
    if (rule.mode === "restrictive") {
        // Restrictive rule: applies ONLY if user has the roles.
        // If user DOES NOT have the roles, they are NOT restricted (passes).
        // If user HAS the roles, they must pass the base condition.
        // Logical equivalent: NOT(roles) OR base
        return base ? policy.or(policy.not(rolesExpr), base) : policy.not(rolesExpr);
    }
    return base ? policy.and(base, rolesExpr) : rolesExpr;
}
