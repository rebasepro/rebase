import type { PolicyExpression, SecurityOperation, SecurityRule, TableDescriptor } from "@rebasepro/types";
import { hasAdminRole } from "@rebasepro/types";

import { evaluatePolicy, type TriState } from "../util/policy/evaluatePolicy";
import { securityRuleToConditions } from "../util/policy/securityRuleToConditions";

/**
 * A table's row-level security, decided ahead of any row, from its
 * {@link TableDescriptor}: may this caller perform this operation on *some*
 * row of the table?
 *
 * The descriptor counterpart of common's `checkOperation` (which reads a
 * collection's `securityRules`), with the descriptor's posture made explicit:
 * `"admin-only"` admits administrators alone, a view is read-only (and a
 * materialized one read by `view.roles`), `rules: []` with
 * `defaultPolicies: false` admits nobody, and the injected admin baseline
 * admits administrators wherever `defaultPolicies` is on.
 *
 * Each rule is evaluated with the shared policy model — the one compiled to
 * Postgres — with no row in hand, so a clause that depends on the row (an
 * owner column) comes out unknown, and so does raw SQL. `onUnknown` decides
 * what unknown means: `"allow"` (the default) for "the caller may write some
 * row", `"deny"` to fail closed.
 *
 * @module
 */

/**
 * Who is asking, as a rule reads them.
 *
 * @group Table
 */
export interface RlsCaller {
    uid?: string | null;
    roles?: readonly string[];
    isAnonymous?: boolean;
}

/**
 * Options of {@link checkTableOperation}.
 *
 * @group Table
 */
export interface CheckTableOperationOptions {
    /** What a clause that cannot be decided without a row (or is raw SQL) counts as. Default `"allow"`. */
    onUnknown?: "allow" | "deny";
    /**
     * Rewrite each rule before it is judged — for a caller that must read a
     * clause differently (e.g. raw SQL as `false`).
     */
    mapRule?: (rule: SecurityRule) => SecurityRule;
}

/** The operations a rule covers, as the Postgres generator resolves them. */
function ruleCovers(rule: SecurityRule, operation: SecurityOperation): boolean {
    const operations = rule.operations && rule.operations.length > 0 ? rule.operations : [rule.operation ?? "all"];
    return operations.includes(operation) || operations.includes("all");
}

/** Kleene AND of clause results. */
function both(values: TriState[]): TriState {
    if (values.some(value => value === false)) return false;
    if (values.some(value => value === "unknown")) return "unknown";
    return true;
}

/** One rule for one operation: USING for reads, updates and deletes; WITH CHECK for inserts and updates. */
function ruleDecides(rule: SecurityRule, caller: RlsCaller, operation: SecurityOperation): TriState {
    const { usingExpr, withCheckExpr } = securityRuleToConditions(rule);
    const ctx = {
        uid: caller.uid,
        roles: [...(caller.roles ?? [])],
        isAnonymous: caller.isAnonymous === true,
        row: null
    };
    const clause = (expr: PolicyExpression | null): TriState => expr === null ? false : evaluatePolicy(expr, ctx);
    const results: TriState[] = [];
    if (operation !== "insert") results.push(clause(usingExpr));
    if (operation === "insert" || operation === "update") results.push(clause(withCheckExpr));
    return both(results);
}

/**
 * Whether `caller` may perform `operation` on some row of `table`, by its
 * row-level security as the descriptor states it.
 *
 * @group Table
 */
export function checkTableOperation(
    table: TableDescriptor,
    caller: RlsCaller,
    operation: SecurityOperation,
    options: CheckTableOperationOptions = {}
): boolean {
    const roles = caller.roles ?? [];
    const rls = table.rls;
    if (rls.posture === "view") {
        if (operation !== "select") return false;
        if (!table.view?.materialized) return true;
        const allowed = table.view.roles ?? ["admin"];
        return roles.some(role => allowed.includes(role));
    }
    const baseline = rls.posture === "admin-only" || rls.defaultPolicies;
    if (baseline && hasAdminRole(roles)) return true;
    if (rls.posture === "admin-only") return false;

    const unknownIs = (options.onUnknown ?? "allow") === "allow";
    let granted = false;
    let permissive = false;
    for (const declared of rls.rules) {
        if (!ruleCovers(declared, operation)) continue;
        const rule = options.mapRule ? options.mapRule(declared) : declared;
        const decided = ruleDecides(rule, caller, operation);
        const passed = decided === "unknown" ? unknownIs : decided;
        if (rule.mode === "restrictive") {
            if (!passed) return false;
        } else {
            permissive = true;
            if (passed) granted = true;
        }
    }
    return permissive && granted;
}
