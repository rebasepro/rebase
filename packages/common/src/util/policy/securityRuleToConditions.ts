import { PolicyExpression, SecurityRule, isRedactedSecurityRule, policy } from "@rebasepro/types";
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
 * condition as it is, `"authenticated"` ANDs `policy.authenticated()` on,
 * `"registered"` ANDs `policy.registered()` on.
 *
 * Total: every clause a rule carries is ANDed in, never dropped because
 * another is present. The compiler refuses the combinations the
 * `SecurityRule` union excludes (`access` beside `ownerField` or raw SQL,
 * `ownerField` beside a condition…, see `ruleShapeProblems`); should one
 * reach here anyway, it compiles to the conjunction — as narrow as every
 * clause in it — rather than to whichever clause was checked first.
 *
 * **This is the linchpin against drift:** both the Postgres DDL generators and
 * the client-side evaluator consume this one function, so there is exactly one
 * definition of what a rule means. In particular, application `roles` are folded
 * into the expression here (AND'd with the base condition, matching how Postgres
 * generates the clause) rather than being handled separately by each consumer.
 *
 * A {@link RedactedSecurityRule} (the marker the server sends for a rule whose
 * SQL it withheld) desugars to a raw node for both clauses — still gated by
 * its `access` and `roles` — so the evaluator answers it "unknown", exactly as
 * it answers a raw rule. No policy is ever compiled from one:
 * `compileTableRulePolicies` refuses it before it gets here.
 */
export function securityRuleToConditions(rule: SecurityRule, site: Pick<PolicyConditionSite, "table"> = {}): RuleConditions {
    return {
        usingExpr: withRoles(baseUsing(rule, site), rule),
        withCheckExpr: withRoles(baseWithCheck(rule, site), rule)
    };
}

/**
 * The caller test an `access` value stands for, or `undefined` for none:
 * `"public"` tests nothing (`true AND c` is `c`), `"authenticated"` is
 * `policy.authenticated()`, `"registered"` is `policy.registered()`. A value
 * the type does not know — a JavaScript caller, a cast, a typo — admits
 * nobody: the compiler refuses such a rule before it gets here, and this
 * keeps the desugaring total and closed for any caller that did not.
 */
function accessTest(access: unknown): PolicyExpression | undefined {
    if (access === undefined || access === null || access === "public") return undefined;
    if (access === "authenticated") return policy.authenticated();
    if (access === "registered") return policy.registered();
    return policy.false();
}

/**
 * Every term of a clause, ANDed under the rule's `access` test: one term
 * alone is returned as it is (so a rule of one clause compiles exactly as it
 * always has), `access` gates it as `and(test, term)`, and several terms —
 * a combination the compiler refuses, reaching here only from a caller that
 * skipped it — are all kept. A clause is never dropped for another: the
 * result is at least as narrow as every clause the rule carries.
 */
function conjoin(access: unknown, terms: readonly PolicyExpression[]): PolicyExpression | null {
    const test = accessTest(access);
    if (terms.length === 0) {
        if (test) return test;
        return access === "public" ? policy.true() : null;
    }
    const body = terms.length === 1 ? terms[0] : policy.and(...terms);
    if (!test) return body;
    return terms.length === 1 ? policy.and(test, body) : policy.and(test, ...terms);
}

/** What a withheld clause desugars to: SQL nobody here can evaluate. */
const REDACTED_CLAUSE_SQL = "/* withheld by the server */";

function ownerTerm(rule: SecurityRule): PolicyExpression[] {
    return rule.ownerField ? [policy.compare(policy.field(rule.ownerField), "eq", policy.authUid())] : [];
}

/**
 * The `USING` clause: the `access` test ANDed with every row clause the rule
 * carries — `ownerField`, `condition`, raw `using`. Total: no clause is
 * dropped because another one is present, whatever the order of the checks.
 */
function baseUsing(rule: SecurityRule, site: Pick<PolicyConditionSite, "table">): PolicyExpression | null {
    if (isRedactedSecurityRule(rule)) return conjoin(rule.access, [policy.raw(REDACTED_CLAUSE_SQL)]);
    const terms: PolicyExpression[] = [...ownerTerm(rule)];
    if (rule.condition != null) terms.push(policyConditionToExpression(rule.condition, { ...site, clause: "condition" }));
    if (rule.using != null) terms.push(sqlToPolicy(rule.using));
    return conjoin(rule.access, terms);
}

/**
 * The `WITH CHECK` clause. `check` stands in for `condition` and `withCheck`
 * for `using` (each defaults to its counterpart, as Postgres does); with
 * neither, the clause is the `USING` clause. Like {@link baseUsing}, every
 * clause present is ANDed under the `access` test.
 */
function baseWithCheck(rule: SecurityRule, site: Pick<PolicyConditionSite, "table">): PolicyExpression | null {
    if (isRedactedSecurityRule(rule)) return conjoin(rule.access, [policy.raw(REDACTED_CLAUSE_SQL)]);
    if (rule.check == null && rule.withCheck == null) return baseUsing(rule, site);
    const terms: PolicyExpression[] = [...ownerTerm(rule)];
    if (rule.check != null) terms.push(policyConditionToExpression(rule.check, { ...site, clause: "check" }));
    else if (rule.condition != null) terms.push(policyConditionToExpression(rule.condition, { ...site, clause: "condition" }));
    if (rule.withCheck != null) terms.push(sqlToPolicy(rule.withCheck));
    else if (rule.using != null) terms.push(sqlToPolicy(rule.using));
    return conjoin(rule.access, terms);
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
