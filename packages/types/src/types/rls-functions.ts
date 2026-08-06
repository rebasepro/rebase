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

/** The request's roles as a comma-separated string, for `string_to_array`. */
export const RLS_ROLES_SQL = `${REBASE_SCHEMA}.roles()`;

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
