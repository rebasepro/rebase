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
    | LiteralPolicyOperand
    | AuthUidPolicyOperand
    | AuthRolesPolicyOperand;

/** A column value on the row being evaluated. @group Models */
export interface FieldPolicyOperand {
    kind: "field";
    /** The property/column name (resolved to its DB column when compiled). */
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
    raw: (sql: string): RawPolicyExpression => ({ kind: "raw", sql }),
    field: (name: string): FieldPolicyOperand => ({ kind: "field", name }),
    literal: (value: string | number | boolean | null): LiteralPolicyOperand => ({ kind: "literal", value }),
    authUid: (): AuthUidPolicyOperand => ({ kind: "authUid" }),
    authRoles: (): AuthRolesPolicyOperand => ({ kind: "authRoles" })
};
