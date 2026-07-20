/**
 * Canonical SQL bootstrap for the `auth` schema and its RLS helper functions.
 *
 * Generated RLS policies reference `auth.uid()` / `auth.roles()` /
 * `auth.jwt()`, so any SQL stream that can contain policies must be
 * self-contained: it has to (re)create these helpers first. This matters for
 * the migration directory in particular — Atlas replays migrations against a
 * clean dev database where no out-of-band bootstrap has ever run, so a
 * migration carrying policies without this preamble fails with
 * "function auth.uid() does not exist".
 *
 * Idempotent (`IF NOT EXISTS` / `OR REPLACE`) so it can be prepended to every
 * policies block and re-applied freely. The runtime boot path
 * (`auth/ensure-tables.ts`) creates the same functions under an advisory lock
 * for HMR-safety; keep the definitions in sync.
 *
 * Deliberately does NOT create the `rebase` schema: that is runtime plumbing
 * (Atlas revision table, auth tables) created directly against the target
 * database. Creating it here would leak it into Atlas's replayed migration
 * state — absent from the desired `schema.sql`, Atlas would then plan
 * `DROP SCHEMA "rebase" CASCADE` on the next diff. The `auth` schema is safe
 * because the generated schema.sql declares it.
 */
export const AUTH_BOOTSTRAP_SQL = `-- Auth schema + RLS helper functions (required by the policies below)
CREATE SCHEMA IF NOT EXISTS auth;

-- Falls back to the pre-rename \`app.user_id\` so a database that has taken the
-- new schema but is still served by an older backend keeps resolving the
-- principal. Drop the COALESCE once no such deployment remains.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS text AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.uid', true), ''),
        NULLIF(current_setting('app.user_id', true), '')
    );
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.jwt', true), ''),
        '{}'
    )::jsonb;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION auth.roles() RETURNS text AS $$
    SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
$$ LANGUAGE sql STABLE;
`;
