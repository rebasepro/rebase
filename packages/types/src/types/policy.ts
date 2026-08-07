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
    | ServerContextPolicyExpression
    | ExistsInPolicyExpression
    | RawPolicyExpression;

/**
 * The id a request without a logged-in user reports as `rebase.uid()`.
 *
 * A user-context request always sets `app.uid`: blank would read back as
 * `NULL`, and `NULL` is how the trusted server context is recognised, so an
 * anonymous visitor would be promoted to server privileges. The driver
 * therefore substitutes this sentinel at the single chokepoint where the GUC
 * is set.
 *
 * The consequence for policy authors is that **`rebase.uid() IS NOT NULL` is a
 * tautology on the user path** — it is true for anonymous visitors too. Use
 * {@link policy.authenticated} to mean "signed in", and
 * {@link policy.serverContext} to mean "the trusted server context". Do not
 * hand-write the comparison: see {@link ANONYMOUS_USER_IDS} for why one
 * literal is not enough.
 *
 * @group Models
 */
export const ANONYMOUS_USER_ID = "anonymous";

/**
 * Every uid that has ever meant "nobody is signed in" — newest first.
 *
 * There are two because there were two. The types, the policy compiler, the
 * JavaScript evaluator and the linter were all built on
 * {@link ANONYMOUS_USER_ID}, while the request path scoped unauthenticated
 * callers as `'anon'` — so `policy.authenticated()`, which compiled to
 * `rebase.uid() <> 'anonymous'`, was *true* for an anonymous visitor. The
 * sanctioned way to write "signed in" granted to everyone, and the linter
 * flagged the spelling that actually worked as a foreign convention.
 *
 * The request path now reports {@link ANONYMOUS_USER_ID}. `'anon'` stays here
 * because policies outlive the server that generated them: a database still
 * holding policies from before the fix, or a project whose server has not been
 * upgraded yet, must not become a grant in either direction. Compile against
 * this list, not against a single literal.
 *
 * No real user id is ever one of these, so a match is always "not signed in".
 *
 * @group Models
 */
export const ANONYMOUS_USER_IDS: readonly string[] = [ANONYMOUS_USER_ID, "anon"];

/**
 * Whether a uid stands for "no one is signed in", in any spelling rebase has
 * used. `null`/`undefined` is the trusted server context, not an anonymous
 * caller, and is therefore **not** anonymous — see {@link ANONYMOUS_USER_ID}.
 *
 * @group Models
 */
export function isAnonymousUid(uid: string | null | undefined): boolean {
    return typeof uid === "string" && ANONYMOUS_USER_IDS.includes(uid);
}

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
 * Compares two operands, e.g. `owner_id = rebase.uid()`.
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
 * Compiles to `string_to_array(rebase.roles(), ',') && ARRAY[...]`.
 * @group Models
 */
export interface RolesOverlapPolicyExpression {
    kind: "rolesOverlap";
    roles: readonly string[];
}

/**
 * True when the user holds *all* of the given application roles.
 * Compiles to `string_to_array(rebase.roles(), ',') @> ARRAY[...]`.
 * @group Models
 */
export interface RolesContainPolicyExpression {
    kind: "rolesContain";
    roles: readonly string[];
}

/**
 * True when a signed-in user is making the request. Compiles to
 * `rebase.uid() IS NOT NULL AND rebase.uid() <> 'anonymous'`.
 *
 * Both halves are load-bearing. `IS NOT NULL` excludes the server context;
 * the {@link ANONYMOUS_USER_ID} comparison excludes anonymous visitors, who
 * *do* carry a non-null `rebase.uid()`. Checking only `IS NOT NULL` grants to
 * everyone — see {@link ANONYMOUS_USER_ID}.
 *
 * `policy.not(policy.authenticated())` therefore means "anonymous visitor or
 * the server context". To single out the server context, use
 * {@link ServerContextPolicyExpression}.
 * @group Models
 */
export interface AuthenticatedPolicyExpression {
    kind: "authenticated";
}

/**
 * True only in the trusted **server context** — the built-in flows that run
 * without a user (signup, migrations, `dataAsAdmin`) set no user GUC, so
 * `rebase.uid()` is `NULL` for them and only for them. Compiles to
 * `rebase.uid() IS NULL`.
 *
 * This is what lets the owner connection satisfy a policy even under FORCE RLS.
 * It is deliberately a primitive rather than `not(authenticated())`: the two
 * meant the same thing while `authenticated` ignored {@link ANONYMOUS_USER_ID},
 * and conflating them is what turns a server-only grant into an anonymous one.
 *
 * The JavaScript evaluator always returns `false` for this node — a client is
 * never the server context.
 * @group Models
 */
export interface ServerContextPolicyExpression {
    kind: "serverContext";
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
 * //           WHERE _ex0.team_id = documents.team_id AND _ex0.user_id = rebase.uid())
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

/** The current user's id — compiles to `rebase.uid()`. @group Models */
export interface AuthUidPolicyOperand {
    kind: "authUid";
}

/**
 * The current user's roles as an array — compiles to
 * `string_to_array(rebase.roles(), ',')`.
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
    and: (...operands: readonly PolicyExpression[]): AndPolicyExpression => ({ kind: "and",
operands: operands as PolicyExpression[] }),
    or: (...operands: readonly PolicyExpression[]): OrPolicyExpression => ({ kind: "or",
operands: operands as PolicyExpression[] }),
    not: (operand: PolicyExpression): NotPolicyExpression => ({ kind: "not",
operand }),
    compare: (left: PolicyOperand, op: PolicyCompareOperator, right: PolicyOperand): ComparePolicyExpression =>
        ({ kind: "compare",
op,
left,
right }),
    rolesOverlap: (roles: readonly string[]): RolesOverlapPolicyExpression => ({ kind: "rolesOverlap",
roles: roles as string[] }),
    rolesContain: (roles: readonly string[]): RolesContainPolicyExpression => ({ kind: "rolesContain",
roles: roles as string[] }),
    authenticated: (): AuthenticatedPolicyExpression => ({ kind: "authenticated" }),
    serverContext: (): ServerContextPolicyExpression => ({ kind: "serverContext" }),
    existsIn: (args: { collection: string; where: PolicyExpression }): ExistsInPolicyExpression =>
        ({ kind: "existsIn",
collection: args.collection,
where: args.where }),
    raw: (sql: string): RawPolicyExpression => ({ kind: "raw",
sql }),
    field: (name: string): FieldPolicyOperand => ({ kind: "field",
name }),
    outerField: (name: string): OuterFieldPolicyOperand => ({ kind: "outerField",
name }),
    literal: (value: string | number | boolean | null): LiteralPolicyOperand => ({ kind: "literal",
value }),
    authUid: (): AuthUidPolicyOperand => ({ kind: "authUid" }),
    authRoles: (): AuthRolesPolicyOperand => ({ kind: "authRoles" })
};
