import { ANONYMOUS_USER_ID, isAnonymousUid, Entity, PolicyCompareOperator, PolicyExpression, PolicyOperand } from "@rebasepro/types";

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
    /**
     * The current user's id, or null/undefined when no user is signed in.
     *
     * Null here means *anonymous visitor*, not "server context" — a client is
     * never the server context. `authUid` operands therefore resolve to
     * {@link ANONYMOUS_USER_ID} rather than `null`, matching the `rebase.uid()`
     * the database would see for the same request.
     */
    uid?: string | null;
    /** The current user's application roles. */
    roles?: string[];
    /**
     * Whether this session is a GUEST — anonymous sign-in rather than an
     * account. Optional, and absent means "not a guest", so a caller that does
     * not know keeps the behaviour it had.
     */
    isAnonymous?: boolean;
    /** The row being evaluated, or null when no specific row is available. */
    entity: Entity | null;
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
            return expr.roles.some(r => r === "public" || userRoles.includes(r));
        }
        case "rolesContain": {
            const userRoles = ctx.roles ?? [];
            return expr.roles.every(r => r === "public" || userRoles.includes(r));
        }
        case "authenticated":
            // Every anonymous spelling, matching what this node compiles to in
            // Postgres — the two evaluators disagreeing about who is signed in
            // is the client optimistically rendering a row the database will
            // refuse, or hiding one it would have allowed.
            return ctx.uid != null && !isAnonymousUid(ctx.uid);
        case "registered":
            // The same two halves the Postgres compilation has. A client that
            // disagreed with the database here would optimistically render a
            // row the database refuses, or hide one it would have allowed.
            return ctx.uid != null && !isAnonymousUid(ctx.uid) && ctx.isAnonymous !== true;
        case "serverContext":
            // A client is never the server context. Postgres decides this by
            // `rebase.uid() IS NULL`, which a client request can never produce:
            // the driver substitutes ANONYMOUS_USER_ID for a missing id.
            return false;
        case "existsIn":
            // A membership subquery cannot be run client-side — server-authoritative.
            return "unknown";
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
            // The sentinel, not null: `rebase.uid()` is never NULL for a request
            // that came from a client, so comparing against null here would
            // disagree with the database on exactly the rules that test for it
            // (e.g. `rebase.uid() <> 'anonymous'`).
            return { known: true, value: ctx.uid ?? ANONYMOUS_USER_ID };
        case "authRoles":
            return { known: true, value: ctx.roles ?? [] };
        case "field":
            // Can't resolve a row column without the row.
            if (!ctx.entity) return { known: false };
            return { known: true, value: ctx.entity.values[operand.name] };
        case "outerField":
            // Only meaningful inside an `existsIn` subquery (server-authoritative).
            return { known: false };
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

    const a = l.value;
    const b = r.value;

    if (a === null || b === null) {
        // SQL answers NULL for *every* comparison against NULL, and a policy
        // that answers NULL does not grant the row. So the only question here
        // is which JavaScript answer reproduces that outcome.
        //
        // This used to answer `false` for `eq` and `true` for `neq`, which is
        // JavaScript's two-valued reading of a three-valued question.
        //
        // `neq` was a grant the database does not give:
        // `owner_id != rebase.uid()` on a row whose `owner_id` is NULL read as
        // *permitted* in the admin panel and was refused by Postgres — on every
        // row where the column is null, which for a nullable column is usually
        // most of them.
        //
        // `false` for `eq` looked safe, because false denies and NULL denies.
        // It is not, because it does not survive negation: `not(a = NULL)`
        // became `true` while `NOT NULL` stays NULL, so the same grant reappears
        // one operator up. A local answer that is only right in a positive
        // position is not right — it just moves.
        //
        // "unknown" is what SQL actually says, it composes correctly through
        // Kleene negation, and enforcement callers already resolve it
        // fail-closed. Both were found by the exhaustive Postgres differential
        // in `policy-agreement-exhaustive.test.ts`, the second only after the
        // first was fixed.
        return "unknown";
    }

    if (op === "eq") return a === b;
    if (op === "neq") return a !== b;

    if (typeof a === "string" && typeof b === "string") {
        if (op === "lt") return a < b;
        if (op === "lte") return a <= b;
        if (op === "gt") return a > b;
        if (op === "gte") return a >= b;
    }

    if (typeof a === "number" && typeof b === "number") {
        if (op === "lt") return a < b;
        if (op === "lte") return a <= b;
        if (op === "gt") return a > b;
        if (op === "gte") return a >= b;
    }

    if (typeof a === "bigint" && typeof b === "bigint") {
        if (op === "lt") return a < b;
        if (op === "lte") return a <= b;
        if (op === "gt") return a > b;
        if (op === "gte") return a >= b;
    }

    return "unknown";
}
