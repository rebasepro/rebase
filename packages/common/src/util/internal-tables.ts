/**
 * The tables Rebase creates for its own bookkeeping, and the SQL that keeps the
 * end-user role away from them.
 *
 * ## Why this exists
 *
 * Authenticated requests run as {@link REBASE_USER_ROLE}, and the boot-time role
 * provisioning grants that role `SELECT, INSERT, UPDATE, DELETE` on every table
 * in the schemas a project uses — including `rebase`, because a project's own
 * collections are allowed to live there (the scaffold puts `users` there). It
 * also sets `ALTER DEFAULT PRIVILEGES`, so a table created *later* by the
 * migrating role inherits the same grant.
 *
 * Every framework-internal table is created later: auth's tables come up during
 * `initializeAuth`, `api_keys` during route mounting, `cron_logs` when the first
 * job registers, `idempotency_keys` on the first request that carries a key. So
 * they all inherited full DML for the end-user role — and none of them enables
 * row-level security, because none of them is a collection with
 * `securityRules`. Measured on a freshly provisioned database, `SET ROLE
 * rebase_user` could read `rebase.refresh_tokens` (session token hashes),
 * `rebase.mfa_factors` (`secret_encrypted`), `rebase.recovery_codes`, and
 * `rebase.api_keys` (including its `admin` flag), and insert into
 * `rebase.app_config`.
 *
 * Nothing routes a user-context query at those tables today, so this was not
 * reachable over the API. That is the wrong thing to depend on: the documented
 * model is that RLS is the authorization boundary, and these tables sat outside
 * it. The boundary is now a privilege boundary instead — the role simply cannot
 * address them.
 *
 * ## Why REVOKE rather than ENABLE ROW LEVEL SECURITY
 *
 * RLS with no policy denies every row, which is the same outcome, but it is the
 * *weaker* statement: it leaves the grant in place, so a later policy — or a
 * `FORCE` flag cleared by some future migration — reopens the table. There is no
 * row of `refresh_tokens` any end user should ever reach, so the honest encoding
 * is "this role has no privilege here at all". It also keeps the owner
 * connection (which auth actually runs on) completely unaffected.
 *
 * ## Keeping it true
 *
 * `packages/rls-check` scans the `rebase` schema — it used to skip it as a
 * "platform" schema — and its `rls-disabled` check fires on exactly the
 * condition this module removes: RLS off *and* a DML grant to a reachable role.
 * So a table added here without a revoke is caught by `pnpm rls:check`, not by
 * someone re-reading this file.
 */

/**
 * The Postgres role authenticated requests run as.
 *
 * Defined here rather than in the Postgres driver because both the driver (which
 * provisions the role) and this module (which revokes on its behalf) need it,
 * and a second spelling of a role name is a silent no-op waiting to happen.
 */
export const REBASE_USER_ROLE = "rebase_user";

/**
 * Framework-internal table names, unqualified.
 *
 * Deliberately NOT including `users`: the auth user table is also a collection,
 * with `securityRules`, RLS enabled and policies applied. Users read their own
 * row through it — revoking there would break sign-in.
 *
 * `atlas_schema_revisions` is Atlas's migration ledger, which lands in `rebase`
 * because `db migrate apply` passes `--revisions-schema rebase`.
 *
 * Every entry here must also be revoked by whatever creates it, and vice versa:
 * the creation-time revoke fires once, on the boot that first makes the table,
 * so it cannot help a database provisioned before that revoke existed. This
 * list is what the boot-time sweep in `ensureAppRole` iterates, and the sweep
 * is the only thing that can repair an already-granted table. A table revoked
 * at creation but missing here is therefore permanently stranded on any
 * database that predates its revoke — which is exactly what happened to
 * `jobs`, added here after a scan of a pre-0.14 database found it.
 */
export const REBASE_INTERNAL_TABLES: readonly string[] = [
    // auth
    "user_identities",
    "refresh_tokens",
    "password_reset_tokens",
    "magic_link_tokens",
    "mfa_factors",
    "mfa_challenges",
    "recovery_codes",
    "app_config",
    "schema_meta",
    // platform services
    "api_keys",
    "cron_logs",
    "cron_claims",
    "jobs",
    "rate_limit_hits",
    "idempotency_keys",
    "entity_history",
    "branches",
    "metric_samples",
    // realtime channels — authorization for these lives in the channel rules the
    // server evaluates before it reads or writes, never in a row policy
    "channel_messages",
    "channel_cursors",
    "channel_presence",
    // migration bookkeeping
    "atlas_schema_revisions"
];

/** Postgres identifiers this module is willing to interpolate. */
const SAFE_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_$]*$/;

/**
 * A single statement that takes every privilege on `schema.table` away from the
 * end-user role.
 *
 * Wrapped in a `DO` block guarded on `pg_roles` for two reasons, both of which
 * happen in practice:
 *
 *  - the role does not exist when the connection is unprivileged (Rebase then
 *    relies on native RLS rather than a role switch), and a bare `REVOKE` on a
 *    missing role is an error, not a no-op;
 *  - the table may not exist yet — `cron_logs` never appears in a project with
 *    no cron jobs — and `to_regclass` returning NULL has to be tolerated too.
 *
 * One command, so it is safe on handles that speak the extended query protocol
 * and reject multi-statement strings.
 */
export function revokeInternalTableSql(schema: string, table: string): string {
    if (!SAFE_IDENTIFIER.test(schema)) {
        throw new Error(`Refusing to build SQL with an unsafe schema name: ${JSON.stringify(schema)}`);
    }
    if (!SAFE_IDENTIFIER.test(table)) {
        throw new Error(`Refusing to build SQL with an unsafe table name: ${JSON.stringify(table)}`);
    }
    const qualified = `"${schema}"."${table}"`;
    return `
        DO $rebase_revoke$
        BEGIN
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${REBASE_USER_ROLE}')
               AND to_regclass('${qualified}') IS NOT NULL THEN
                EXECUTE 'REVOKE ALL ON ${qualified} FROM ${REBASE_USER_ROLE}';
            END IF;
        END
        $rebase_revoke$;
    `.trim();
}

/**
 * Revoke on every internal table in `schema`, one statement at a time.
 *
 * Best-effort per table: a connection that does not own one of them (a
 * pre-provisioned database, a platform-managed ledger) cannot revoke on it, and
 * that must not take down a boot. The caller decides how loud to be — `onError`
 * exists so the driver can warn without this module importing a logger.
 */
export async function revokeInternalTableAccess(
    execute: (sql: string) => Promise<unknown>,
    schema: string,
    options?: { tables?: readonly string[]; onError?: (table: string, error: unknown) => void }
): Promise<void> {
    for (const table of options?.tables ?? REBASE_INTERNAL_TABLES) {
        try {
            await execute(revokeInternalTableSql(schema, table));
        } catch (error) {
            options?.onError?.(table, error);
        }
    }
}
