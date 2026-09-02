import { LEGACY_RLS_SCHEMA, REBASE_SCHEMA } from "@rebasepro/types";

/**
 * Canonical SQL bootstrap for the RLS helper functions.
 *
 * Generated RLS policies reference `rebase.uid()` / `rebase.roles()` /
 * `rebase.jwt()`, so any SQL stream that can contain policies must be
 * self-contained: it has to (re)create these helpers first. This matters for
 * the migration directory in particular — Atlas replays migrations against a
 * clean dev database where no out-of-band bootstrap has ever run, so a
 * migration carrying policies without this preamble fails with
 * "function rebase.uid() does not exist".
 *
 * Idempotent (`IF NOT EXISTS` / `OR REPLACE`) so it can be prepended to every
 * policies block and re-applied freely. The runtime boot path
 * (`auth/ensure-tables.ts`) creates the same functions under an advisory lock
 * for HMR-safety; keep the definitions in sync.
 *
 * ## Creating the `rebase` schema here is now safe, and required
 *
 * It deliberately did not, once. These functions lived in a schema called
 * `auth`, and the note here read: creating `rebase` would leak it into Atlas's
 * replayed migration state, and — absent from the desired `schema.sql` — Atlas
 * would then plan `DROP SCHEMA "rebase" CASCADE`, taking the auth tables with
 * it. That reasoning still holds; what changed is the second half of it. The
 * DDL generator now emits `CREATE SCHEMA IF NOT EXISTS "rebase"`
 * unconditionally, so the schema is always in the desired state and the diff is
 * empty. (It used to appear only when some collection happened to declare
 * `schema: "rebase"` — true for the scaffold's users collection, and not a
 * property anything guaranteed.) `db push` additionally excludes the whole
 * schema from the declarative apply.
 *
 * See `@rebasepro/types`' `rls-functions` for why the functions moved out of
 * `auth` at all: the short version is that the name was Supabase's, and
 * `CREATE OR REPLACE FUNCTION auth.uid() RETURNS text` cannot be applied over
 * Supabase's `RETURNS uuid` — Postgres refuses, and the refusal used to be
 * swallowed.
 */
/**
 * The bootstrap as individual statements.
 *
 * Kept as an array because the two consumers need different shapes and only one
 * of them can take a multi-command string: the migration preamble is written to
 * a file and replayed by Atlas, but the boot path runs through drizzle, whose
 * node-postgres handle speaks the extended query protocol and rejects more than
 * one command per call. Splitting a joined string back apart on `$$;` would be
 * a parser for a problem that does not need one.
 */
export const RLS_BOOTSTRAP_STATEMENTS: readonly string[] = [
    `CREATE SCHEMA IF NOT EXISTS ${REBASE_SCHEMA}`,

    // Falls back to the pre-rename `app.user_id` so a database that has taken
    // the new schema but is still served by an older backend keeps resolving
    // the principal. Drop the COALESCE once no such deployment remains.
    `CREATE OR REPLACE FUNCTION ${REBASE_SCHEMA}.uid() RETURNS text AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.uid', true), ''),
        NULLIF(current_setting('app.user_id', true), '')
    );
$$ LANGUAGE sql STABLE`,

    `CREATE OR REPLACE FUNCTION ${REBASE_SCHEMA}.jwt() RETURNS jsonb AS $$
    SELECT COALESCE(
        NULLIF(current_setting('app.jwt', true), ''),
        '{}'
    )::jsonb;
$$ LANGUAGE sql STABLE`,

    `CREATE OR REPLACE FUNCTION ${REBASE_SCHEMA}.roles() RETURNS text AS $$
    SELECT COALESCE(NULLIF(current_setting('app.user_roles', true), ''), '');
$$ LANGUAGE sql STABLE`,

    // Is the caller a GUEST — signed in through anonymous sign-in rather than
    // with an account?
    //
    // Anonymous sign-in mints a real user row and a real uid, so inside a policy
    // a guest was indistinguishable from a registered account: same `uid()`
    // shape, same default role. Every rule meaning "a signed-in person" was
    // therefore also a rule about anybody who had called
    // `POST /auth/anonymous`, which needs no email, no password and no consent
    // to anything. On a deployment with anonymous sign-in enabled, that is the
    // whole internet holding a session.
    //
    // The fact exists on the user row (`is_anonymous`) and simply never reached
    // the database's own identity. Now it does, and a policy can say
    // `NOT rebase.is_anonymous()`.
    //
    // Defaults to FALSE when the GUC is unset, which is the safe direction:
    // an older backend against a newer database leaves it unset, and reading
    // that as "not a guest" preserves exactly the behaviour that deployment
    // already had rather than locking its users out.
    `CREATE OR REPLACE FUNCTION ${REBASE_SCHEMA}.is_anonymous() RETURNS boolean AS $$
    SELECT COALESCE(NULLIF(current_setting('app.is_anonymous', true), ''), 'false')::boolean;
$$ LANGUAGE sql STABLE`
];

/** The same statements as one script, for migration files and raw clients. */
export const RLS_BOOTSTRAP_SQL =
    "-- Rebase schema + RLS helper functions (required by the policies below)\n" +
    RLS_BOOTSTRAP_STATEMENTS.map(s => `${s};`).join("\n\n") + "\n";

/**
 * Removes the pre-1.0 `auth` schema, but only when Rebase is what put it there.
 *
 * ## Why this is safe against a Supabase database
 *
 * Two independent guards, and both have to pass:
 *
 *  1. **Each function is identified before it is dropped.** Ours returns `text`
 *     and reads the `app.uid` GUC; Supabase's returns `uuid` and reads
 *     `request.jwt.claims`. Nothing is dropped on a signature we did not write,
 *     so a Supabase database — where our `CREATE OR REPLACE` could never have
 *     succeeded in the first place, Postgres refusing to change a return type —
 *     matches nothing and this is a no-op.
 *  2. **`DROP SCHEMA … RESTRICT`**, never CASCADE. If anything else at all still
 *     lives in `auth` (Supabase's `users` table, its other helpers), the drop
 *     fails and the schema stays. CASCADE here would be unrecoverable.
 *
 * ## Why it cannot run too early
 *
 * Postgres records a dependency from every RLS policy to the functions its body
 * calls, so `DROP FUNCTION auth.uid()` fails for as long as a single policy
 * still references it. That is the interlock, and it is load-bearing: the drop
 * can only succeed once every policy has been recompiled to \`rebase.uid()\`.
 * Callers therefore run this *after* applying policies, and treat a failure as
 * "not yet — try again next boot" rather than as an error.
 */
export const DROP_LEGACY_AUTH_SCHEMA_SQL = `
DO $rebase_drop_legacy$
DECLARE
    dropped_any boolean := false;
BEGIN
    -- Each function is matched on its own result type and body, so a schema
    -- that merely shares the name keeps everything it has.
    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'uid'
          AND pg_get_function_result(p.oid) = 'text'
          AND p.prosrc LIKE '%app.uid%'
    ) THEN
        DROP FUNCTION auth.uid();
        dropped_any := true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'jwt'
          AND pg_get_function_result(p.oid) = 'jsonb'
          AND p.prosrc LIKE '%app.jwt%'
    ) THEN
        DROP FUNCTION auth.jwt();
        dropped_any := true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'auth' AND p.proname = 'roles'
          AND pg_get_function_result(p.oid) = 'text'
          AND p.prosrc LIKE '%app.user_roles%'
    ) THEN
        DROP FUNCTION auth.roles();
        dropped_any := true;
    END IF;

    -- RESTRICT: only an empty schema goes. Anything else in there — including a
    -- Supabase installation left untouched above — keeps it.
    IF dropped_any THEN
        BEGIN
            EXECUTE 'DROP SCHEMA auth RESTRICT';
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;
END
$rebase_drop_legacy$;
`;

/** Somebody's policy that still calls a pre-1.0 helper. */
export interface LegacyRlsDependent {
    schema: string;
    table: string;
    policy: string;
}

/**
 * Policies whose body still calls `auth.uid()` / `auth.roles()` / `auth.jwt()`.
 *
 * Postgres will not drop a function a policy depends on, so this is exactly the
 * set standing between a database and losing the legacy schema. Rebase's own
 * policies leave the list on the next push or boot, when they are recompiled —
 * anything still here afterwards is hand-written, will never be recompiled by
 * anybody, and is the reason the drop keeps being skipped. Silence there would
 * leave an operator staring at a schema the release notes said would go.
 */
export const LEGACY_RLS_DEPENDENTS_SQL = `
    SELECT n.nspname AS schema, c.relname AS "table", p.polname AS policy
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pg_get_expr(p.polqual, p.polrelid) ~* '\\m${LEGACY_RLS_SCHEMA}\\.(uid|jwt|roles)\\s*\\('
       OR pg_get_expr(p.polwithcheck, p.polrelid) ~* '\\m${LEGACY_RLS_SCHEMA}\\.(uid|jwt|roles)\\s*\\('
    ORDER BY 1, 2, 3
`;

/** Somebody's *function* that still calls a pre-1.0 helper from its own body. */
export interface LegacyRlsFunctionDependent {
    schema: string;
    function: string;
}

/**
 * Functions whose body calls `auth.uid()` / `auth.roles()` / `auth.jwt()`.
 *
 * This is the half `DROP FUNCTION ... RESTRICT` cannot see, and the reason it
 * needs its own query. Postgres records a dependency for a *policy* that calls a
 * function, which is why the drop is safe against the policies above — but a
 * `LANGUAGE sql` function whose body is a **string literal** is not parsed when
 * it is created, so nothing is recorded and `RESTRICT` has nothing to refuse on.
 * The drop succeeds and the caller is left pointing at a function that no longer
 * exists, which fails at *query* time rather than at boot.
 *
 * A downstream project building on these helpers is not hypothetical: the Rebase
 * control plane defines `auth.is_org_member(uuid)` and `auth.is_org_admin(uuid)`
 * in this very schema, each calling `auth.uid()` in a string body, and eleven of
 * its row-level-security policies go through them. Every one of those would have
 * started failing the first time a recompile left no policy referencing
 * `auth.uid()` directly — the drop's own precondition.
 *
 * Matching on the body text is the only option available, and it is deliberately
 * broad: a false positive costs a schema that stays one release longer and says
 * why, while a false negative costs somebody their policies.
 */
export const LEGACY_RLS_FUNCTION_DEPENDENTS_SQL = `
    SELECT n.nspname AS schema, p.proname AS function
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname NOT IN ('pg_catalog', 'information_schema')
      AND NOT (n.nspname = '${LEGACY_RLS_SCHEMA}' AND p.proname IN ('uid', 'jwt', 'roles'))
      AND p.prosrc ~* '\\m${LEGACY_RLS_SCHEMA}\\.(uid|jwt|roles)\\s*\\('
    ORDER BY 1, 2
`;

/**
 * Retire the pre-1.0 `auth` schema, reporting what is holding it back.
 *
 * The shared implementation behind the CLI's post-push step and the runtime's
 * post-policy step. Both used to just fire {@link DROP_LEGACY_AUTH_SCHEMA_SQL}
 * and swallow whatever came back, which is right for the ordinary case — a
 * table not recompiled *yet* — and wrong for the one that never resolves: a
 * hand-written policy nothing will ever rewrite. Then the schema stays forever
 * and nothing ever says why.
 */
export async function dropLegacyAuthSchema(
    run: (sql: string) => Promise<Record<string, unknown>[]>,
    report: { info: (m: string) => void; warn: (m: string) => void }
): Promise<void> {
    let blockers: LegacyRlsDependent[];
    try {
        blockers = (await run(LEGACY_RLS_DEPENDENTS_SQL)) as unknown as LegacyRlsDependent[];
    } catch {
        return; // No catalogue access; nothing here is worth failing a boot for.
    }

    if (blockers.length > 0) {
        report.warn(
            `The pre-1.0 \`${LEGACY_RLS_SCHEMA}\` schema cannot be removed yet: ${blockers.length} ` +
            `${blockers.length === 1 ? "policy still calls" : "policies still call"} ` +
            `\`${LEGACY_RLS_SCHEMA}.uid()\` and friends, and Postgres will not drop a function a policy ` +
            `depends on. Rebase's own policies are ` +
            `rewritten automatically — anything listed here is hand-written SQL that has to be updated to ` +
            `\`${REBASE_SCHEMA}.uid()\` by hand, after which the schema goes on its own:\n` +
            blockers.map(b => `  • ${b.schema}.${b.table} → "${b.policy}"`).join("\n")
        );
        return;
    }

    // The half Postgres will not refuse on. See LEGACY_RLS_FUNCTION_DEPENDENTS_SQL:
    // a string-literal SQL body records no dependency, so `DROP FUNCTION` drops
    // out from under a caller that is still using it and nothing complains until
    // a query runs.
    let borrowers: LegacyRlsFunctionDependent[];
    try {
        borrowers = (await run(LEGACY_RLS_FUNCTION_DEPENDENTS_SQL)) as unknown as LegacyRlsFunctionDependent[];
    } catch {
        return;
    }

    if (borrowers.length > 0) {
        report.warn(
            `The pre-1.0 \`${LEGACY_RLS_SCHEMA}\` schema cannot be removed yet: ${borrowers.length} ` +
            `${borrowers.length === 1 ? "function calls" : "functions call"} ` +
            `\`${LEGACY_RLS_SCHEMA}.uid()\` and friends from its own body. Postgres records no dependency ` +
            `for that — a SQL body written as a string literal is never parsed — so dropping the helpers ` +
            `would leave these pointing at nothing, and they would fail when a query reached them rather ` +
            `than now. Repoint them at \`${REBASE_SCHEMA}.uid()\`, after which the schema goes on its own:\n` +
            borrowers.map(b => `  • ${b.schema}.${b.function}()`).join("\n")
        );
        return;
    }

    try {
        await run(DROP_LEGACY_AUTH_SCHEMA_SQL);
    } catch (err) {
        // Something else depends on it, or the connection does not own it.
        // Not fatal: the schema is inert either way now that no policy calls it.
        report.info(
            `Left the \`${LEGACY_RLS_SCHEMA}\` schema in place: ` +
            (err instanceof Error ? err.message : String(err))
        );
    }
}
