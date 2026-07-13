/**
 * Structured, engine-agnostic policy expressions.
 *
 * A {@link PolicyExpression} is the single source of truth for a row-level
 * security condition. It is compiled to Postgres `USING`/`WITH CHECK` SQL
 * (authoritative enforcement) and independently evaluated in JavaScript (to
 * drive the admin UI, and — in future — to enforce on engines without native
 * RLS such as MongoDB). Because both the SQL and the JS decision derive from
 * the *same* expression, the UI matches database enforcement by construction —
 * no drift between two hand-written implementations.
 *
 * The only escape hatch that cannot be evaluated client-side is the
 * {@link RawPolicyExpression} node (`{ kind: "raw" }`): it preserves full
 * PostgreSQL power but, being arbitrary SQL, is treated as *unknown* by the
 * JavaScript evaluator (never silently allowed) and reflected exactly in the UI
 * via server-computed capability flags.
 *
 * @group Models
 */
export type PolicyExpression =
    | TruePolicyExpression
    | FalsePolicyExpression
    | AndPolicyExpression
    | OrPolicyExpression
    | NotPolicyExpression
    | ComparePolicyExpression
    | RolesOverlapPolicyExpression
    | RolesContainPolicyExpression
    | AuthenticatedPolicyExpression
    | ExistsInPolicyExpression
    | RawPolicyExpression;

/** Always allows. Compiles to `true`. @group Models */
export interface TruePolicyExpression {
    kind: "true";
}

/** Always denies. Compiles to `false`. @group Models */
export interface FalsePolicyExpression {
    kind: "false";
}

/** Logical AND — every operand must pass. @group Models */
export interface AndPolicyExpression {
    kind: "and";
    operands: readonly PolicyExpression[];
}

/** Logical OR — at least one operand must pass. @group Models */
export interface OrPolicyExpression {
    kind: "or";
    operands: readonly PolicyExpression[];
}

/** Logical negation. @group Models */
export interface NotPolicyExpression {
    kind: "not";
    operand: PolicyExpression;
}

/** Comparison operators available to {@link ComparePolicyExpression}. @group Models */
export type PolicyCompareOperator = "eq" | "neq" | "lt" | "lte" | "gt" | "gte";

/**
 * Compares two operands, e.g. `owner_id = auth.uid()`.
 * @group Models
 */
export interface ComparePolicyExpression {
    kind: "compare";
    op: PolicyCompareOperator;
    left: PolicyOperand;
    right: PolicyOperand;
}

/**
 * True when the user holds *at least one* of the given application roles.
 * Compiles to `string_to_array(auth.roles(), ',') && ARRAY[...]`.
 * @group Models
 */
export interface RolesOverlapPolicyExpression {
    kind: "rolesOverlap";
    roles: readonly string[];
}

/**
 * True when the user holds *all* of the given application roles.
 * Compiles to `string_to_array(auth.roles(), ',') @> ARRAY[...]`.
 * @group Models
 */
export interface RolesContainPolicyExpression {
    kind: "rolesContain";
    roles: readonly string[];
}

/**
 * True when there is an authenticated user (`auth.uid() IS NOT NULL`).
 * @group Models
 */
export interface AuthenticatedPolicyExpression {
    kind: "authenticated";
}

/**
 * Membership / relational access: true when at least one row exists in another
 * collection (a join/membership table) matching `where`. This is what lets you
 * scope reads to "rows whose team the caller belongs to" without an N+1
 * per-row lookup — it compiles to a single correlated `EXISTS` subquery.
 *
 * Inside `where`, {@link FieldPolicyOperand} (`policy.field`) references a column
 * of the joined collection, while {@link OuterFieldPolicyOperand}
 * (`policy.outerField`) references a column of the row being checked (the outer
 * table under RLS). Combine with {@link AuthUidPolicyOperand} to correlate to
 * the caller.
 *
 * @example
 * ```ts
 * // documents visible only to members of the document's team:
 * policy.existsIn({
 *   collection: "team_members",
 *   where: policy.and(
 *     policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id")),
 *     policy.compare(policy.field("user_id"), "eq", policy.authUid()),
 *   ),
 * })
 * // → EXISTS (SELECT 1 FROM team_members _ex0
 * //           WHERE _ex0.team_id = documents.team_id AND _ex0.user_id = auth.uid())
 * ```
 *
 * Postgres-authoritative: like {@link RawPolicyExpression}, the JavaScript
 * evaluator treats it as *unknown* (it cannot run a subquery client-side), so
 * enforcement is always the database's.
 * @group Models
 */
export interface ExistsInPolicyExpression {
    kind: "existsIn";
    /** Slug of the collection to search (the join / membership table). */
    collection: string;
    /** Condition evaluated against the joined collection's rows. */
    where: PolicyExpression;
}

/**
 * A raw PostgreSQL boolean expression — the full-power escape hatch.
 *
 * Columns can be referenced as `{column_name}`. This is Postgres-only and
 * **server-authoritative**: the JavaScript evaluator cannot evaluate arbitrary
 * SQL, so it treats this node as *unknown* rather than guessing.
 * @group Models
 */
export interface RawPolicyExpression {
    kind: "raw";
    sql: string;
}

/**
 * An operand referenced by a {@link ComparePolicyExpression}.
 * @group Models
 */
export type PolicyOperand =
    | FieldPolicyOperand
    | OuterFieldPolicyOperand
    | LiteralPolicyOperand
    | AuthUidPolicyOperand
    | AuthRolesPolicyOperand;

/** A column value on the row being evaluated. @group Models */
export interface FieldPolicyOperand {
    kind: "field";
    /** The property/column name (resolved to its DB column when compiled). */
    name: string;
}

/**
 * A column value on the *outer* row when used inside {@link ExistsInPolicyExpression}
 * — i.e. the row the RLS policy is being evaluated for, referenced from within the
 * subquery. Outside an `existsIn` it is equivalent to {@link FieldPolicyOperand}.
 * @group Models
 */
export interface OuterFieldPolicyOperand {
    kind: "outerField";
    /** The property/column name on the outer collection. */
    name: string;
}

/** A constant value. @group Models */
export interface LiteralPolicyOperand {
    kind: "literal";
    value: string | number | boolean | null;
}

/** The current user's id — compiles to `auth.uid()`. @group Models */
export interface AuthUidPolicyOperand {
    kind: "authUid";
}

/**
 * The current user's roles as an array — compiles to
 * `string_to_array(auth.roles(), ',')`.
 * @group Models
 */
export interface AuthRolesPolicyOperand {
    kind: "authRoles";
}

// ── Constructor helpers ──────────────────────────────────────────────
// Small, dependency-free builders so callers (and the desugaring in
// `@rebasepro/common`) can assemble expressions without object-literal noise.

/** @group Models */
export const policy = {
    true: (): TruePolicyExpression => ({ kind: "true" }),
    false: (): FalsePolicyExpression => ({ kind: "false" }),
    and: (...operands: readonly PolicyExpression[]): AndPolicyExpression => ({ kind: "and", operands: operands as PolicyExpression[] }),
    or: (...operands: readonly PolicyExpression[]): OrPolicyExpression => ({ kind: "or", operands: operands as PolicyExpression[] }),
    not: (operand: PolicyExpression): NotPolicyExpression => ({ kind: "not", operand }),
    compare: (left: PolicyOperand, op: PolicyCompareOperator, right: PolicyOperand): ComparePolicyExpression =>
        ({ kind: "compare", op, left, right }),
    rolesOverlap: (roles: readonly string[]): RolesOverlapPolicyExpression => ({ kind: "rolesOverlap", roles: roles as string[] }),
    rolesContain: (roles: readonly string[]): RolesContainPolicyExpression => ({ kind: "rolesContain", roles: roles as string[] }),
    authenticated: (): AuthenticatedPolicyExpression => ({ kind: "authenticated" }),
    existsIn: (args: { collection: string; where: PolicyExpression }): ExistsInPolicyExpression =>
        ({ kind: "existsIn", collection: args.collection, where: args.where }),
    raw: (sql: string): RawPolicyExpression => ({ kind: "raw", sql }),
    field: (name: string): FieldPolicyOperand => ({ kind: "field", name }),
    outerField: (name: string): OuterFieldPolicyOperand => ({ kind: "outerField", name }),
    literal: (value: string | number | boolean | null): LiteralPolicyOperand => ({ kind: "literal", value }),
    authUid: (): AuthUidPolicyOperand => ({ kind: "authUid" }),
    authRoles: (): AuthRolesPolicyOperand => ({ kind: "authRoles" })
};
