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
 * row through it — revoking there would break sign-in. `revokeInternalTableSql`
 * now skips any table with RLS enabled, so that exception is enforced rather
 * than merely remembered — and so is the same hazard for every other name here,
 * any of which a project may legitimately use for a collection of its own.
 * Without that collection it is not guarded at all, so the request roles are
 * kept off it by {@link withheldTablesIn} instead.
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
 * database that predates its revoke.
 *
 * These names are unqualified, and the boot-time sweep applies them to every
 * schema a project uses — so an entry here is a claim on that name in `public`
 * as much as in `rebase`. `jobs` is Rebase's queue at `rebase.jobs` AND a
 * perfectly ordinary collection name, and revoking `public.jobs` from a project
 * that owns it leaves every read failing 42501 with correct policies applied
 * and nothing in the RLS logs to explain it. The `relrowsecurity` guard in
 * `revokeInternalTableSql` is what makes a common noun safe here — it is not a
 * licence to claim more of them.
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
    "cron_job_state",
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

/**
 * The auth user table, by schema and name: `rebase.users`.
 *
 * Kept off {@link REBASE_INTERNAL_TABLES}, which also says what Studio and a
 * branch diff treat as Rebase's plumbing, and the users are the project's
 * data. But its privileges follow the same rule. With the users collection
 * registered it has RLS and admin-only policies, and the revoke skips it.
 * Without it, it had RLS off, the schema-wide grant gave the request role
 * every row, and SQL run as a caller (`getSql`) read every account's address
 * and password hash, an anonymous caller's included.
 */
export const AUTH_USERS_TABLE = { schema: "rebase", table: "users" } as const;

/**
 * The tables in `schema` the request roles are kept off whenever RLS is off on
 * them: {@link REBASE_INTERNAL_TABLES}, and in `rebase` the auth user table.
 */
export function withheldTablesIn(schema: string): readonly string[] {
    return schema === AUTH_USERS_TABLE.schema ? [...REBASE_INTERNAL_TABLES, AUTH_USERS_TABLE.table] : REBASE_INTERNAL_TABLES;
}

/**
 * PL/pgSQL that fills a `request_roles text[]` variable with the roles this
 * database's requests run as: what a provisioning boot recorded in
 * `rebase.schema_meta` (`request_roles`), or `rebase_user` where nothing was
 * recorded — every database from before the role became a setting.
 *
 * Read from the database, not passed in, so every store that revokes or grants
 * on its own objects agrees with the server about the role without being handed
 * it, whatever order the boot runs them in. Dynamic, because the table may not
 * exist yet and a static reference to it would fail the whole block.
 */
export const LOAD_REQUEST_ROLES_PLPGSQL = `
            IF to_regclass('"rebase"."schema_meta"') IS NOT NULL THEN
                EXECUTE $request_roles$SELECT string_to_array(value, ',') FROM "rebase"."schema_meta" WHERE key = 'request_roles'$request_roles$
                    INTO request_roles;
            END IF;
            request_roles := COALESCE(request_roles, ARRAY['${REBASE_USER_ROLE}']);`.trim();

/**
 * SQL: the oids of every role that could be a request role from this
 * connection — roles it may become that cannot log in, Postgres's own `pg_*`
 * roles aside. For a plain catalogue read that decides whether a store has a
 * revoke to run, where the recorded list in `rebase.schema_meta` may not exist
 * yet and so cannot be named.
 *
 * Always a superset of the real request roles, since the connection must be
 * able to switch to them. A role in it that is not one only makes the store run
 * {@link revokeInternalTableSql}, whose own test is exact and finds nothing to do.
 */
export const REQUEST_ROLE_CANDIDATES_SQL =
    "ARRAY(SELECT r.oid FROM pg_roles r WHERE NOT r.rolcanlogin AND r.rolname NOT LIKE 'pg\\_%' " +
    "AND r.rolname <> current_user AND pg_has_role(current_user, r.oid, 'MEMBER'))";

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
 * The third guard is the one that decides whether the *right* table is being
 * revoked. The names in {@link REBASE_INTERNAL_TABLES} are unqualified, and the
 * boot-time sweep in `ensureAppRole` applies all of them to every schema a
 * project uses — including the schema its own collections live in. A project is
 * free to call a collection `jobs`, `branches` or `api_keys`, and when it does,
 * the sweep was revoking `rebase_user`'s DML on the project's table on every
 * single boot. That is not a subtle degradation: the collection's whole API
 * answers 500 `permission denied for table …` from then on, which is what
 * happened to a public job board whose vacancies live in `public.jobs`.
 *
 * `relrowsecurity` separates the two cleanly, and it is the same fact this
 * module already relies on. Framework-internal tables carry no RLS — that is the
 * premise stated at the top of this file, and the reason a revoke is needed at
 * all. Every collection table has it enabled, because that is how Rebase
 * enforces `securityRules`. So "RLS is off" is exactly "this is not somebody's
 * collection", and the guard also subsumes the hand-carved `users` exception:
 * the auth user table is a collection, has RLS, and would now be skipped on its
 * own merits rather than by being kept off a list.
 *
 * The fourth guard is about cost, and leaves the end state exactly as it was:
 * the `REVOKE` runs only when it would change something. A `REVOKE` rewrites the
 * table's `pg_class` row whether or not anything was granted, which invalidates
 * every cached plan that touches the table on every connection. Every store
 * that owns an internal table runs this on every boot. So it is skipped when the
 * end-user role holds nothing on the table — no entry in its ACL or in any
 * column's ACL — and the ACL has been written. A table whose ACL has never been
 * written (`relacl` NULL) is still revoked once: the `REVOKE` writes the owner's
 * default ACL out, exactly as before, and from then on it is skipped.
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
    const role = "(SELECT oid FROM pg_roles WHERE rolname = request_role)";
    return `
        DO $rebase_revoke$
        DECLARE
            request_roles text[];
            request_role text;
        BEGIN
            ${LOAD_REQUEST_ROLES_PLPGSQL}
            IF to_regclass('${qualified}') IS NULL
               OR (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('${qualified}')) THEN
                RETURN;
            END IF;
            FOREACH request_role IN ARRAY request_roles LOOP
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = request_role)
                   AND (
                       (SELECT relacl IS NULL FROM pg_class WHERE oid = to_regclass('${qualified}'))
                       OR EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a
                                  WHERE c.oid = to_regclass('${qualified}') AND a.grantee = ${role})
                       OR EXISTS (SELECT 1 FROM pg_attribute att, aclexplode(att.attacl) a
                                  WHERE att.attrelid = to_regclass('${qualified}') AND att.attacl IS NOT NULL
                                    AND a.grantee = ${role})
                   ) THEN
                    EXECUTE format('REVOKE ALL ON ${qualified} FROM %I', request_role);
                END IF;
            END LOOP;
        END
        $rebase_revoke$;
    `.trim();
}

/**
 * One statement granting `EXECUTE` on a function to every request role, for
 * the `SECURITY DEFINER` functions a request calls (the job queue's enqueue,
 * the history writer). Guarded per role, so a database whose request role does
 * not exist (an unprivileged connection) finds it a no-op.
 */
export function grantExecuteToRequestRolesSql(signature: string): string {
    return `
        DO $rebase_grant_execute$
        DECLARE
            request_roles text[];
            request_role text;
        BEGIN
            ${LOAD_REQUEST_ROLES_PLPGSQL}
            FOREACH request_role IN ARRAY request_roles LOOP
                IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = request_role) THEN
                    EXECUTE format('GRANT EXECUTE ON FUNCTION ${signature.replace(/'/g, "''")} TO %I', request_role);
                END IF;
            END LOOP;
        END
        $rebase_grant_execute$
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
    for (const table of options?.tables ?? withheldTablesIn(schema)) {
        try {
            await execute(revokeInternalTableSql(schema, table));
        } catch (error) {
            options?.onError?.(table, error);
        }
    }
}
