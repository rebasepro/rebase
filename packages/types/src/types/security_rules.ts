/**
 * Row-level security rules for a collection.
 *
 * 325 lines of RLS policy contract that used to sit in the middle of
 * `collections.ts`, between the admin panel's table view-models and the auth
 * collection config. It has no relationship to the shape of a collection — it is
 * the most-read part of the BaaS surface, and it now reads on its own.
 *
 * A rule is compiled to Postgres `CREATE POLICY` DDL and, for the structured
 * flavour, independently evaluated in JavaScript, so the admin UI's idea of what
 * a user may do derives from the same expression the database enforces.
 *
 * Note that rule *names* are not what you write: an unnamed rule compiles to
 * `<table>_<op>_<sha1[0:7]>`, plus an injected `default_admin` baseline. Derive
 * them with `getPolicyNamesForRule`/`getEffectiveSecurityRules` rather than
 * matching on `rule.name`.
 */
import type { PolicyExpression } from "./policy";

/**
 * SQL operation that a policy applies to.
 * @group Models
 */
export type SecurityOperation = "select" | "insert" | "update" | "delete" | "all";

/**
 * Flexible Row Level Security rule for a collection.
 *
 * Built on PostgreSQL Row Level Security. Rules can range from
 * simple convenience shortcuts to fully custom SQL expressions, giving you the
 * full power of PostgreSQL Row Level Security.
 *
 * The authenticated user's identity is available in raw SQL via:
 * - `rebase.uid()`   — the user's ID
 * - `rebase.roles()` — comma-separated app role IDs
 * - `rebase.jwt()`   — full JWT claims as JSONB
 *
 * These are set automatically per-transaction by the backend.
 *
 * **How rules combine:** PostgreSQL evaluates all matching policies for an
 * operation. Permissive rules are OR'd together (any one passing is enough).
 * Restrictive rules are AND'd (all must pass). This is standard PostgreSQL RLS behavior.
 *
 * **Mutual exclusivity:** `ownerField`, `access`, structured `condition`, and
 * raw SQL (`using`/`withCheck`) cannot be combined. The type system enforces
 * this — attempting to set conflicting fields will produce a compile-time
 * error.
 *
 * **Which form to reach for:** prefer the structured {@link StructuredSecurityRule}
 * (`condition`/`check`) or the shortcuts (`ownerField`, `access`, `roles`). These
 * are engine-agnostic and evaluated identically by the database and the admin UI,
 * so the UI never shows an action the database will reject. Raw SQL
 * ({@link RawSQLSecurityRule}) keeps full PostgreSQL power but is Postgres-only
 * and server-authoritative (the UI cannot evaluate arbitrary SQL locally).
 *
 * @group Models
 */
export type SecurityRule =
    | OwnerSecurityRule
    | PublicSecurityRule
    | StructuredSecurityRule
    | RawSQLSecurityRule
    | RolesOnlySecurityRule;

/**
 * Shared fields for all SecurityRule variants.
 * @group Models
 */
export interface SecurityRuleBase {
    /**
     * Optional human-readable name for the policy.
     * If not provided, one will be auto-generated from the table name and operation.
     * Must be unique per table.
     *
     * When using `operations` (array), each generated policy will have the
     * operation name appended, e.g. `"owner_access_select"`, `"owner_access_update"`.
     */
    name?: string;

    /**
     * Which SQL operation this policy applies to.
     * Use this when the policy targets a single operation or all operations.
     *
     * For multiple specific operations, use `operations` (array) instead.
     * If neither is specified, defaults to `"all"`.
     *
     * @default "all"
     */
    operation?: SecurityOperation;

    /**
     * Array of SQL operations this policy applies to.
     * The compiler will generate one PostgreSQL policy per operation, sharing
     * the same configuration.
     *
     * This reduces boilerplate when the same rule applies to multiple (but not all)
     * operations.
     *
     * Takes precedence over `operation` (singular) if both are specified.
     *
     * @example
     * // Same rule for select and update
     * { operations: ["select", "update"], ownerField: "user_id" }
     *
     * @example
     * // Equivalent to operation: "all"
     * { operations: ["all"], ownerField: "user_id" }
     */
    operations?: readonly SecurityOperation[];

    /**
     * Whether this policy is `"permissive"` (default) or `"restrictive"`.
     *
     * - **permissive**: Multiple permissive policies for the same operation are
     *   OR'd together — if *any* passes, access is granted.
     * - **restrictive**: Restrictive policies are AND'd with all permissive
     *   policies — they act as additional gates that *must* also pass.
     *
     * This is the standard PostgreSQL RLS model.
     *
     * @default "permissive"
     */
    mode?: "permissive" | "restrictive";

    /**
     * **Shortcut.** Restrict this rule to users that have one of these
     * application-level roles.
     *
     * **Important:** These are NOT native PostgreSQL database roles — names
     * like `public`, `anon` or `authenticated` belong to {@link pgRoles} and
     * produce a condition no user can satisfy if used here. These are
     * application roles managed by Rebase, stored as an inline `roles TEXT[]`
     * column on the users table, and injected into each transaction as
     * `app.user_roles` — which `rebase.roles()` reads.
     *
     * There is no roles registry: a role exists once it is assigned to a user.
     *
     * Generates a safe array-overlap condition — the user passes if they hold
     * *any* of the listed roles:
     *   `string_to_array(rebase.roles(), ',') && ARRAY['<role1>', '<role2>']`
     *
     * (Note: this is a true set intersection, NOT a regex/substring match, so
     * a role named `admin` never matches `nonadmin` or `superadmin`.)
     *
     * Can be combined with `ownerField`, `access`, `condition`, or raw
     * `using`/`withCheck`. When combined, the role check is AND'd with the
     * other condition.
     *
     * @example
     * // Only admins can delete
     * { operation: "delete", roles: ["admin"] }
     *
     * @example
     * // Admins have unfiltered read access to all rows
     * { operation: "select", roles: ["admin"], using: "true" }
     */
    roles?: readonly string[];

    // ── Advanced: native PostgreSQL role targeting ───────────────────────

    /**
     * **Advanced.** Native PostgreSQL database roles the policy applies to.
     *
     * By default, all generated policies target the `public` role (i.e.
     * every database connection). This is correct for most setups where
     * a single database role is used for all connections.
     *
     * **Important:** These are NOT the same as the application-level
     * {@link roles} (admin, editor, viewer, etc.) — those are enforced in the
     * USING/WITH CHECK clauses via `rebase.roles()`. This field controls the
     * PostgreSQL `TO` clause in `CREATE POLICY ... TO role_name`.
     *
     * Use this if you have dedicated PostgreSQL roles (e.g. `app_read`,
     * `app_write`) and want policies to target specific ones.
     *
     * @default ["public"]
     *
     * @example
     * // Only apply this policy when connected as `app_role`
     * { operation: "select", access: "public", pgRoles: ["app_role"] }
     */
    pgRoles?: readonly string[];
}

/**
 * Security rule that grants access based on row ownership.
 * Generates a USING/WITH CHECK clause like: `<column> = rebase.uid()`
 *
 * Cannot be combined with `using`, `withCheck`, or `access`.
 *
 * @example
 * { operation: "all", ownerField: "user_id" }
 *
 * @group Models
 */
export interface OwnerSecurityRule extends SecurityRuleBase {
    /** The property (column) that stores the owner's user ID. */
    ownerField: string;
    access?: never;
    using?: never;
    withCheck?: never;
    condition?: never;
    check?: never;
}

/**
 * Security rule that grants unrestricted row access (no row filtering).
 * Generates `USING (true)`.
 *
 * This means "no row-level filter", NOT "anonymous/unauthenticated access".
 * Authentication is still enforced at the API layer — this only controls which
 * *rows* authenticated users can see.
 *
 * Cannot be combined with `using`, `withCheck`, or `ownerField`.
 *
 * @example
 * // Public read (any authenticated user sees all rows)
 * { operation: "select", access: "public" }
 *
 * @group Models
 */
export interface PublicSecurityRule extends SecurityRuleBase {
    /** Grant unrestricted row access for this operation. */
    access: "public";
    ownerField?: never;
    using?: never;
    withCheck?: never;
    condition?: never;
    check?: never;
}

/**
 * Security rule expressed as a structured, engine-agnostic
 * {@link PolicyExpression}. This is the **recommended** way to write a
 * non-trivial condition: it compiles to PostgreSQL `USING`/`WITH CHECK` SQL
 * *and* is evaluated identically by the admin UI, so the UI can never show an
 * action the database will reject.
 *
 * Cannot be combined with `ownerField`, `access`, or raw `using`/`withCheck`.
 *
 * @example
 * // Owner, or any user holding the `moderator` role
 * {
 *   operation: "update",
 *   condition: policy.or(
 *       policy.compare(policy.field("user_id"), "eq", policy.authUid()),
 *       policy.rolesOverlap(["moderator"])
 *   )
 * }
 *
 * @group Models
 */
export interface StructuredSecurityRule extends SecurityRuleBase {
    /**
     * Structured condition for the `USING` clause — which *existing* rows are
     * visible / can be modified / deleted (SELECT, UPDATE, DELETE).
     */
    condition: PolicyExpression;

    /**
     * Structured condition for the `WITH CHECK` clause — which *new/updated*
     * row values are allowed (INSERT, UPDATE). Defaults to `condition` when
     * omitted, mirroring PostgreSQL's own behavior.
     */
    check?: PolicyExpression;

    ownerField?: never;
    access?: never;
    using?: never;
    withCheck?: never;
}

/**
 * Security rule using raw SQL expressions for full PostgreSQL RLS power.
 *
 * **Postgres-only and server-authoritative.** Arbitrary SQL cannot be
 * evaluated by the admin UI, so a rule using this form is treated as *unknown*
 * client-side (never silently allowed) and its effect on visible actions is
 * reflected from the server. For conditions that should also drive the UI
 * precisely, prefer the structured {@link StructuredSecurityRule}.
 *
 * Cannot be combined with `ownerField`, `access`, or structured `condition`.
 *
 * You can reference columns via `{column_name}` which will be resolved to
 * `table.column_name` in the generated Drizzle code.
 *
 * @example
 * // Rows published in the last 30 days are visible
 * { operation: "select", using: "{published_at} > now() - interval '30 days'" }
 *
 * @example
 * // Only the owner, or users with 'moderator' role
 * {
 *   operation: "select",
 *   using: "{user_id} = rebase.uid() OR rebase.roles() ~ 'moderator'"
 * }
 *
 * @group Models
 */
export interface RawSQLSecurityRule extends SecurityRuleBase {
    /**
     * Raw SQL expression for the `USING` clause.
     * This controls which *existing* rows are visible / can be modified / deleted.
     * Applied to SELECT, UPDATE, and DELETE.
     */
    using: string;

    /**
     * Raw SQL expression for the `WITH CHECK` clause.
     * This controls which *new/updated* row values are allowed.
     * Applied to INSERT and UPDATE.
     *
     * If not provided on INSERT/UPDATE policies, falls back to `using`
     * (which matches PostgreSQL's own default behavior).
     */
    withCheck?: string;

    ownerField?: never;
    access?: never;
    condition?: never;
    check?: never;
}

/**
 * Security rule that only filters by application roles, without any
 * row-level condition (USING/WITH CHECK).
 *
 * Useful for simple "only admins can access this table" rules where
 * no per-row filtering is needed.
 *
 * @example
 * // Only admins can delete
 * { operation: "delete", roles: ["admin"] }
 *
 * @group Models
 */
export interface RolesOnlySecurityRule extends SecurityRuleBase {
    ownerField?: never;
    access?: never;
    using?: never;
    withCheck?: never;
    condition?: never;
    check?: never;
}