/**
 * The SQL helper functions RLS policies call, and the schema they live in.
 *
 * ## One schema, and it is ours
 *
 * Rebase creates exactly one schema in a project's database: `rebase`. These
 * three functions live in it alongside the framework's own tables, and that is
 * the whole contract — a reader can look at a database and know precisely which
 * namespace belongs to the framework and that nothing else was touched.
 *
 * It used to be two. `uid()`, `jwt()` and `roles()` sat in a schema called
 * `auth`, which is Supabase's name, chosen so that a developer who had written
 * Supabase RLS would recognise `auth.uid()`. The familiarity was real but the
 * name was not Rebase's to take, and taking it had a concrete cost: pointing
 * Rebase at a database that already had a Supabase `auth` schema meant
 * `CREATE OR REPLACE FUNCTION auth.uid() RETURNS text` against Supabase's
 * `RETURNS uuid`, which Postgres rejects outright —
 *
 *     ERROR:  cannot change return type of existing function
 *     HINT:   Use DROP FUNCTION auth.uid() first.
 *
 * — and the failure landed inside a catch-all that logged a warning and carried
 * on, leaving a database with auth tables, no helper functions, and policies
 * calling functions that did not exist. Under `rebase db migrate` the same
 * statements aborted the migration instead.
 *
 * `rebase.uid()` collides with nobody. A Supabase database keeps its `auth`
 * schema untouched and gains a `rebase` one, which is what a gradual migration
 * needs.
 *
 * ## Why functions at all, rather than inlining `current_setting`
 *
 * Because the indirection has already been spent once. `uid()` resolves
 * `app.uid` and falls back to the pre-rename `app.user_id`, so that during a
 * rolling deploy — old and new pods serving one database — both eras resolve
 * the principal. That was a single `CREATE OR REPLACE`. Inlined into policy
 * bodies it would have been a rewrite of every policy on every table.
 *
 * ## Why the name is not configurable
 *
 * A policy body is stored SQL: Postgres parses `USING (…)` once and keeps it, so
 * these strings are written into every policy in every database Rebase has
 * provisioned. Everything that reads policies back — the SQL-to-policy parser
 * behind the admin UI, the drift checker, `rls-check` — would have to know the
 * configured value to recognise its own output. One frozen name is the feature.
 */

/** The schema Rebase owns. The only schema Rebase creates. */
export const REBASE_SCHEMA = "rebase";

/**
 * The principal of the current request, as text, or NULL in the server context.
 *
 * Never NULL for a user request — an anonymous one carries
 * {@link ANONYMOUS_USER_ID} — which is what makes `IS NULL` a reliable test for
 * the trusted server plane and `IS NOT NULL` a tautology.
 */
export const RLS_UID_SQL = `${REBASE_SCHEMA}.uid()`;
/**
 * Is the caller one of this database's request roles? What a permissive
 * policy is ANDed with under `rls.policyTarget: "requestRole"`, so another
 * application's role holding a grant on the table gets nothing from it.
 * `current_user` is passed in — inside the function, which reads the recorded
 * roles with its owner's rights, `current_user` would be the owner — and the
 * sub-select makes it one evaluation per statement, not one per row.
 */
export const RLS_IS_REQUEST_ROLE_SQL = `(SELECT ${REBASE_SCHEMA}.is_request_role(current_user::text))`;

/** The request's roles as a comma-separated string, for `string_to_array`. */
export const RLS_ROLES_SQL = `${REBASE_SCHEMA}.roles()`;

/**
 * The Postgres role that policies granting only the server context or admins
 * are written `TO`: the injected `<table>_default_admin_*` baseline, and any
 * permissive rule whose every clause requires one of the two (`roles: ["admin"]`).
 *
 * Postgres ORs the permissive policies that apply to the current role. Written
 * `TO public`, the baseline applied to every signed-in user too, as
 * `(InitPlan) OR owner_id = (InitPlan)` — and an OR with a per-statement
 * constant arm cannot use the owner index, so a user's owner-scoped list or
 * count scanned the whole table (78 ms against 2.8 ms at 1M rows). Written `TO`
 * this role, the policy is not in a user's plan at all.
 *
 * It holds no privilege and cannot log in: being in it only decides which
 * policies apply, and those still test `rebase.uid() IS NULL` or the `admin`
 * role. Admin requests switch to a request role that inherits it
 * ({@link adminRequestRoleFor}); a connection that is itself subject to RLS
 * inherits it for the server context. One fixed name, so the policy text is the
 * same in every deployment and every generated migration. FROZEN.
 */
export const REBASE_ADMIN_ROLE = "rebase_admin";

/**
 * The role the admin request roles ({@link adminRequestRoleFor}) inherit and
 * nothing else does, so an admin-only grant can apply to admin REQUESTS alone.
 *
 * {@link REBASE_ADMIN_ROLE} cannot do that job: the connection inherits it for
 * the server context, and so would any process on it that does not switch
 * roles. Its policies therefore keep their test (`rebase.uid() IS NULL` or the
 * `admin` role) — and any policy expression that is not a constant is a
 * security barrier, behind which Postgres will not evaluate a non-leakproof
 * operator as an index condition. An admin's `tags && $1`, `name ~ $1` or
 * jsonb filter scanned the whole table where the owner's used the index.
 *
 * Each admin-only grant gets a companion `TO` this role `USING (true)`.
 * Postgres folds the OR of the permissive policies to `true` for a member, the
 * barrier goes, and an admin request plans as the owner's does; restrictive
 * policies still apply. Membership is the boundary: only the admin request
 * roles hold it, granted `WITH INHERIT TRUE, SET FALSE`, and only from
 * PostgreSQL 16, whose per-grant INHERIT keeps the connection (which holds
 * those roles `WITH INHERIT FALSE`) out. A boot that finds the connection with
 * its privileges revokes every membership, and the companions admit nobody.
 * One fixed name, as {@link REBASE_ADMIN_ROLE}. FROZEN.
 */
export const REBASE_ADMIN_REQUEST_ROLE = "rebase_admin_request";

/**
 * The role an admin request runs as, for a signed-in request role: it inherits
 * that role (its grants and every policy written for it) and
 * {@link REBASE_ADMIN_ROLE}. One per request role rather than the shared
 * `rebase_admin` itself, because roles belong to the cluster: a project with a
 * request role of its own (`rls.requestRole`) would otherwise share its admin
 * access with every other project on the cluster. FROZEN derivation.
 */
export function adminRequestRoleFor(requestRole: string): string {
    return `${requestRole}_admin`;
}

/**
 * Whether a request with these roles passes `rolesOverlap(["admin"])` — the
 * test `string_to_array(rebase.roles(), ',') && ARRAY['admin']` makes of the
 * comma-joined `app.user_roles`, so a role name with a comma in it is split
 * exactly as Postgres splits it.
 */
export function holdsAdminRole(roles: readonly string[]): boolean {
    return roles.join(",").split(",").includes("admin");
}

/**
 * Whether the caller is a GUEST — signed in through anonymous sign-in rather
 * than with an account.
 *
 * A different question from {@link ANONYMOUS_USER_ID}, and the two are easy to
 * confuse: that sentinel means "no session at all", while this means "a session
 * with nobody behind it". Anonymous sign-in mints a real user row with a real
 * uid, so before this reached the database the two kinds of caller were one
 * principal inside every policy.
 */
export const RLS_IS_ANONYMOUS_SQL = `${REBASE_SCHEMA}.is_anonymous()`;

/** The request's JWT claims as `jsonb`, or `{}`. */
export const RLS_JWT_SQL = `${REBASE_SCHEMA}.jwt()`;

/**
 * The pre-1.0 spellings, for recognising policies and hand-written SQL that
 * predate the move.
 *
 * Kept because policies outlive the server that wrote them: a database migrated
 * by an older release still holds `auth.uid()` in its policy bodies until the
 * next push or boot recompiles them, and anything that reads policies back has
 * to recognise both eras or report the framework's own output as foreign drift.
 * Also used to give a project whose `securityRules` contain raw `auth.uid()` a
 * message naming the replacement, instead of a parse failure.
 */
export const LEGACY_RLS_SCHEMA = "auth";
export const LEGACY_RLS_UID_SQL = `${LEGACY_RLS_SCHEMA}.uid()`;
export const LEGACY_RLS_ROLES_SQL = `${LEGACY_RLS_SCHEMA}.roles()`;
export const LEGACY_RLS_JWT_SQL = `${LEGACY_RLS_SCHEMA}.jwt()`;

/**
 * Rewrites the pre-1.0 function calls in a fragment of policy SQL.
 *
 * Deliberately anchored on a word boundary and the schema qualifier, so a column
 * called `auth_uid` or a table named `auth` is left alone.
 */
export function rewriteLegacyRlsFunctions(sql: string): string {
    return sql.replace(
        /\bauth\.(uid|jwt|roles)\s*\(\s*\)/gi,
        (_match, fn: string) => `${REBASE_SCHEMA}.${fn.toLowerCase()}()`
    );
}

/** Whether a fragment of SQL still calls the pre-1.0 functions. */
export function usesLegacyRlsFunctions(sql: string): boolean {
    return /\bauth\.(uid|jwt|roles)\s*\(\s*\)/i.test(sql);
}
