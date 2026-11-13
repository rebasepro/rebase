/**
 * Every legacy security-rule shape the migration carries means what it meant on
 * 0.30 — or `legacyRuleMeaningChange` lists it (SEC-FIX-2 F-3).
 *
 * `rebase migrate collections-to-tables` carries a rule as written, and the
 * table compiler then reads it with today's desugaring, which is total (every
 * clause ANDed, `access: "authenticated"` / `"registered"` known). The 0.30
 * compiler took the first of `condition`, `using`, `access: "public"`,
 * `ownerField`, and knew no other `access` value. Where the two disagree on who
 * passes which policy clause, the migration must list the rule under "Review
 * before deploying" (`--check` fails until it is acknowledged). A single missed
 * case — a restrictive `{ access: "authenticated", roles }` widened from "deny
 * the role holders" to "let every signed-in role holder through" — was found by
 * review; this sweeps the whole space instead:
 *
 * - every combination of `access` (none, public, authenticated, registered),
 *   `roles` (none, a role, `"public"`, `"anon"`), `ownerField`, `mode`, `condition`,
 *   `check`, raw `using`, raw `withCheck`, and the operation(s);
 * - each one the lift accepts (`legacyRuleRefusal` refuses the rest) is
 *   compiled by the 0.30 desugaring (below, verbatim from `main` 7081747fad,
 *   `securityRuleToConditions.ts`) and by today's, and both clauses of every
 *   policy it expands to are evaluated for anonymous visitors, guests and
 *   account holders with and without roles, on rows that pass and fail each
 *   clause;
 * - a rule whose policies differ anywhere must be listed; one that does not
 *   must not be (a listing that cries wolf trains people to accept it).
 */
import { describe, expect, it } from "@jest/globals";
import { policy, type PolicyExpression, type SecurityRule } from "@rebasepro/types";

import { legacyRuleMeaningChange, legacyRuleRefusal } from "../../src/schema/resolve-rls";
import { evaluatePolicy, securityRuleToConditions, sqlToPolicy, type PolicyEvalContext, type TriState } from "../../src/util/policy";

// ── The 0.30 desugaring, verbatim (main 7081747fad) ──────────────────────────

function mainBaseUsing(rule: SecurityRule): PolicyExpression | null {
    if (rule.condition) return rule.condition as PolicyExpression;
    if (rule.using != null) return sqlToPolicy(rule.using);
    if (rule.access === "public") return policy.true();
    if (rule.ownerField) return policy.compare(policy.field(rule.ownerField), "eq", policy.authUid());
    return null;
}

function mainBaseWithCheck(rule: SecurityRule): PolicyExpression | null {
    if (rule.check) return rule.check as PolicyExpression;
    if (rule.withCheck != null) return sqlToPolicy(rule.withCheck);
    return mainBaseUsing(rule);
}

function mainWithRoles(base: PolicyExpression | null, rule: SecurityRule): PolicyExpression | null {
    if (!rule.roles || rule.roles.length === 0) return base;
    const rolesExpr = policy.rolesOverlap(rule.roles);
    if (rule.mode === "restrictive") return base ? policy.or(policy.not(rolesExpr), base) : policy.not(rolesExpr);
    return base ? policy.and(base, rolesExpr) : rolesExpr;
}

function mainConditions(rule: SecurityRule): { usingExpr: PolicyExpression | null; withCheckExpr: PolicyExpression | null } {
    return { usingExpr: mainWithRoles(mainBaseUsing(rule), rule), withCheckExpr: mainWithRoles(mainBaseWithCheck(rule), rule) };
}

/**
 * A legacy rule as a 0.30 config held it: any combination of clauses, the
 * ones today's `SecurityRule` union excludes among them (the lift refuses
 * those, and the sweep skips what it refuses).
 */
function legacyRule(base: SecurityRule, extra: Record<string, unknown>): SecurityRule {
    return Object.assign({}, base, extra);
}

// ── The space ────────────────────────────────────────────────────────────────

const CONDITION = policy.compare(policy.field("status"), "eq", policy.literal("open"));
const CHECK = policy.compare(policy.field("kind"), "eq", policy.literal("a"));

const DIMENSIONS = {
    access: [undefined, "public", "authenticated", "registered"] as const,
    roles: [undefined, ["editor"], ["public"], ["anon"]] as const,
    ownerField: [undefined, "owner_id"] as const,
    mode: [undefined, "restrictive"] as const,
    condition: [undefined, CONDITION] as const,
    check: [undefined, CHECK] as const,
    using: [undefined, "status = 'open'"] as const,
    withCheck: [undefined, "kind = 'a'"] as const,
    operations: [["select"], ["insert"], ["update"], ["delete"], ["all"], ["insert", "select"]] as const
};

function* rules(): Generator<SecurityRule> {
    for (const access of DIMENSIONS.access)
        for (const roles of DIMENSIONS.roles)
            for (const ownerField of DIMENSIONS.ownerField)
                for (const mode of DIMENSIONS.mode)
                    for (const condition of DIMENSIONS.condition)
                        for (const check of DIMENSIONS.check)
                            for (const using of DIMENSIONS.using)
                                for (const withCheck of DIMENSIONS.withCheck)
                                    for (const operations of DIMENSIONS.operations) {
                                        const base: SecurityRule = operations.length === 1
                                            ? { operation: operations[0] }
                                            : { operations: [...operations] };
                                        const extra: Record<string, unknown> = {
                                            ...(access !== undefined && { access }),
                                            ...(roles !== undefined && { roles: [...roles] }),
                                            ...(ownerField !== undefined && { ownerField }),
                                            ...(mode !== undefined && { mode }),
                                            ...(condition !== undefined && { condition }),
                                            ...(check !== undefined && { check }),
                                            ...(using !== undefined && { using }),
                                            ...(withCheck !== undefined && { withCheck })
                                        };
                                        yield legacyRule(base, extra);
                                    }
}

/** Who asks: an anonymous visitor, guests and account holders, with and without roles. */
const CALLERS: Omit<PolicyEvalContext, "row">[] = [
    { uid: null, roles: [] },
    // What an anonymous request carries in the database.
    { uid: null, roles: ["anon"] },
    { uid: "guest-1", isAnonymous: true, roles: [] },
    { uid: "guest-1", isAnonymous: true, roles: ["editor"] },
    { uid: "user-1", roles: [] },
    { uid: "user-1", roles: ["editor"] },
    { uid: "user-1", roles: ["suspended"] }
];

/** Rows that pass and fail each clause: owned or not, open or closed, kind a or b. */
const ROWS = ["user-1", "guest-1", "someone-else"].flatMap(owner =>
    ["open", "closed"].flatMap(status => ["a", "b"].map(kind => ({ owner_id: owner, status, kind }))));

const CONTEXTS: PolicyEvalContext[] = CALLERS.flatMap(caller =>
    ROWS.map(values => ({ ...caller, row: values })));

function operationsOf(rule: SecurityRule): string[] {
    return rule.operations && rule.operations.length > 0 ? [...rule.operations] : [rule.operation ?? "all"];
}

/** A compiled clause as Postgres sees it: no clause where one is needed denies. */
function clauseAnswers(expr: PolicyExpression | null): TriState[] {
    return CONTEXTS.map(ctx => (expr ? evaluatePolicy(expr, ctx) : false));
}

/** Where the 0.30 policy and today's disagree, or `undefined`. */
function difference(rule: SecurityRule): string | undefined {
    const before = mainConditions(rule);
    const after = securityRuleToConditions(rule);
    for (const operation of operationsOf(rule)) {
        const clauses: ["usingExpr" | "withCheckExpr", boolean][] = [
            ["usingExpr", operation !== "insert"],
            ["withCheckExpr", operation !== "select" && operation !== "delete"]
        ];
        for (const [clause, needed] of clauses) {
            if (!needed) continue;
            const a = clauseAnswers(before[clause]);
            const b = clauseAnswers(after[clause]);
            const at = a.findIndex((value, index) => value !== b[index]);
            if (at >= 0) {
                const ctx = CONTEXTS[at];
                return `${operation} ${clause}: 0.30 ${String(a[at])}, now ${String(b[at])} for ${JSON.stringify(ctx)}`;
            }
        }
    }
    return undefined;
}

describe("legacy rules carried by the migration: every change of meaning is listed", () => {
    const carried = [...rules()].filter(rule => legacyRuleRefusal(rule, "rule") === undefined);

    it("sweeps a space large enough to mean something", () => {
        expect(carried.length).toBeGreaterThan(500);
    });

    it("lists every carried rule whose policies grant something different, and no other", () => {
        const unlisted: string[] = [];
        const crying: string[] = [];
        for (const rule of carried) {
            const differs = difference(rule);
            const listed = legacyRuleMeaningChange(rule);
            if (differs && !listed) unlisted.push(`${JSON.stringify(rule)} — ${differs}`);
            if (!differs && listed) crying.push(`${JSON.stringify(rule)} — listed as: ${listed}`);
        }
        expect(unlisted.slice(0, 40)).toEqual([]);
        expect(crying.slice(0, 40)).toEqual([]);
    });

    it("lists the reviewer's case: a restrictive role gate with a bare `access` widens", () => {
        for (const access of ["authenticated", "registered"] as const) {
            const rule = legacyRule({ operations: ["select"] }, { name: "block", mode: "restrictive", access, roles: ["suspended"] });
            expect(difference(rule)).toBeDefined();
            const listed = legacyRuleMeaningChange(rule);
            expect(listed).toContain("restrictive");
            expect(listed).toContain("suspended");
        }
    });
});
