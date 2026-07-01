import { Entity, PolicyCompareOperator, PolicyExpression, PolicyOperand } from "@rebasepro/types";

/**
 * Result of evaluating a policy client-side. `"unknown"` means the expression
 * could not be decided without more information — either a raw-SQL escape-hatch
 * node (which the client deliberately never guesses) or a row-column reference
 * with no entity in hand (e.g. list-level gating). Callers decide how to resolve
 * `"unknown"`: fail-closed for an enforcement decision, optimistic for pure
 * visibility gating.
 */
export type TriState = boolean | "unknown";

/**
 * Context for {@link evaluatePolicy}: the acting user (or none) and the row
 * being evaluated (or none, for collection-level gating).
 */
export interface PolicyEvalContext {
    /** The current user's id, or null/undefined when unauthenticated. */
    uid?: string | null;
    /** The current user's application roles. */
    roles?: string[];
    /** The row being evaluated, or null when no specific row is available. */
    entity: Entity<any> | null;
}

/**
 * Evaluates a {@link PolicyExpression} against a user + row, using three-valued
 * (Kleene) logic so that `"unknown"` sub-results propagate soundly.
 *
 * This is the JavaScript twin of {@link policyToPostgres}: both derive from the
 * same expression, so the admin UI matches database enforcement by construction
 * for every non-raw rule.
 */
export function evaluatePolicy(expr: PolicyExpression, ctx: PolicyEvalContext): TriState {
    switch (expr.kind) {
        case "true":
            return true;
        case "false":
            return false;
        case "and":
            return kleeneAnd(expr.operands.map(o => evaluatePolicy(o, ctx)));
        case "or":
            return kleeneOr(expr.operands.map(o => evaluatePolicy(o, ctx)));
        case "not":
            return kleeneNot(evaluatePolicy(expr.operand, ctx));
        case "compare":
            return evaluateCompare(expr.op, expr.left, expr.right, ctx);
        case "rolesOverlap": {
            const userRoles = ctx.roles ?? [];
            return expr.roles.some(r => userRoles.includes(r));
        }
        case "rolesContain": {
            const userRoles = ctx.roles ?? [];
            return expr.roles.every(r => userRoles.includes(r));
        }
        case "authenticated":
            return ctx.uid != null;
        case "raw":
            // Arbitrary SQL cannot be evaluated client-side — never guess.
            return "unknown";
    }
}

// ── Three-valued logic ───────────────────────────────────────────────

function kleeneAnd(values: TriState[]): TriState {
    if (values.some(v => v === false)) return false;
    if (values.some(v => v === "unknown")) return "unknown";
    return true;
}

function kleeneOr(values: TriState[]): TriState {
    if (values.some(v => v === true)) return true;
    if (values.some(v => v === "unknown")) return "unknown";
    return false;
}

function kleeneNot(value: TriState): TriState {
    if (value === "unknown") return "unknown";
    return !value;
}

// ── Comparison ───────────────────────────────────────────────────────

type ResolvedOperand = { known: false } | { known: true; value: unknown };

function resolveOperand(operand: PolicyOperand, ctx: PolicyEvalContext): ResolvedOperand {
    switch (operand.kind) {
        case "literal":
            return { known: true, value: operand.value };
        case "authUid":
            return { known: true, value: ctx.uid ?? null };
        case "authRoles":
            return { known: true, value: ctx.roles ?? [] };
        case "field":
            // Can't resolve a row column without the row.
            if (!ctx.entity) return { known: false };
            return { known: true, value: ctx.entity.values[operand.name] };
    }
}

function evaluateCompare(
    op: PolicyCompareOperator,
    left: PolicyOperand,
    right: PolicyOperand,
    ctx: PolicyEvalContext
): TriState {
    const l = resolveOperand(left, ctx);
    const r = resolveOperand(right, ctx);
    if (!l.known || !r.known) return "unknown";

    const a = l.value as any;
    const b = r.value as any;
    switch (op) {
        case "eq":
            return a === b;
        case "neq":
            return a !== b;
        case "lt":
            return a < b;
        case "lte":
            return a <= b;
        case "gt":
            return a > b;
        case "gte":
            return a >= b;
    }
}
