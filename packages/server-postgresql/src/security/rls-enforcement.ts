import { sql as drizzleSql, SQL } from "drizzle-orm";
import { logger } from "@rebasepro/server-core";

/**
 * Unified RLS enforcement — the "user context vs server context" model.
 *
 * Every operation runs in one of two contexts:
 *
 *  - **User context** — a request authenticated (or anonymous) via
 *    `driver.withAuth(user)`. Runs as the restricted `rebase_user` role: a
 *    non-owner, NOSUPERUSER, NOBYPASSRLS role, so Postgres RLS binds *every*
 *    statement (SELECT, INSERT, UPDATE, DELETE). The collection's
 *    `securityRules` are the whole authorization model; app-layer callbacks
 *    are validation/side-effects, not a security boundary.
 *
 *  - **Server context** — the base (owner) connection: auth flows, migrations,
 *    background jobs, and the explicit `rebase.dataAsAdmin` accessor. As table
 *    owner it bypasses RLS. This is the trusted plane, equivalent to
 *    Supabase's `service_role`.
 *
 * This module provides the three pieces:
 *
 *  1. {@link detectConnectionPosture} — is the connection subject to RLS at
 *     all? (superuser / BYPASSRLS / table owner ⇒ no)
 *  2. {@link ensureAppRole} — idempotently provision `rebase_user` with
 *     SELECT/INSERT/UPDATE/DELETE grants (+ default privileges so future
 *     tables stay covered).
 *  3. {@link applyAuthContext} — per-transaction: set the `app.*` GUCs the
 *     policies read (`auth.uid()` etc.) and `SET LOCAL ROLE rebase_user` so
 *     RLS binds. Transaction-scoped, so it composes with poolers.
 *
 * Provisioning runs from the framework's own bootstrap/migrate (which already
 * self-creates the `auth` schema and functions) — enforcement is default-on,
 * not an operator opt-in.
 */

/** The restricted role every authenticated (user-context) request runs as. */
export const REBASE_USER_ROLE = "rebase_user";

/** Minimal SQL runner so callers can adapt drizzle or pg.Client. */
export type RawSqlRunner = (sqlText: string) => Promise<Record<string, unknown>[]>;

/** Minimal transaction surface needed by {@link applyAuthContext}. */
export interface SqlTx {
    execute(query: SQL): Promise<unknown>;
}

export interface ConnectionPosture {
    /** The connection's `current_user`. */
    role: string;
    superuser: boolean;
    bypassRLS: boolean;
    /** Owns at least one user table — owners bypass non-FORCE RLS. */
    ownsTables: boolean;
    /** True when RLS would NOT constrain this connection. */
    privileged: boolean;
}

export interface AuthContext {
    userId: string;
    /** Raw roles as carried on the user (strings or `{ id }` objects). */
    roles: unknown[];
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

/** DML the user role holds on managed tables (RLS still filters per row). */
const USER_TABLE_PRIVILEGES = "SELECT, INSERT, UPDATE, DELETE";

export async function detectConnectionPosture(run: RawSqlRunner): Promise<ConnectionPosture> {
    const rows = await run(`
        SELECT current_user            AS role,
               r.rolsuper              AS superuser,
               r.rolbypassrls          AS bypassrls,
               EXISTS (
                   SELECT 1 FROM pg_tables t
                   WHERE t.tableowner = current_user
                     AND t.schemaname NOT IN ('pg_catalog', 'information_schema')
               )                       AS owns_tables
        FROM pg_roles r
        WHERE r.rolname = current_user
    `);
    const row = rows[0] ?? {};
    const superuser = row.superuser === true;
    const bypassRLS = row.bypassrls === true;
    const ownsTables = row.owns_tables === true;
    return {
        role: String(row.role ?? "unknown"),
        superuser,
        bypassRLS,
        ownsTables,
        privileged: superuser || bypassRLS || ownsTables
    };
}

/**
 * Human-actionable instructions for when the connection cannot provision the
 * user role itself (no CREATEROLE and role not pre-created by the platform).
 */
export function appRoleSetupInstructions(connectionRole: string, schemas: string[]): string {
    const grants = schemas.map((s) =>
        `GRANT USAGE ON SCHEMA ${quoteIdent(s)} TO ${REBASE_USER_ROLE};\n` +
        `GRANT ${USER_TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA ${quoteIdent(s)} TO ${REBASE_USER_ROLE};\n` +
        `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${quoteIdent(s)} TO ${REBASE_USER_ROLE};`
    ).join("\n");
    return (
        `Rebase enforces row-level security by running authenticated requests as ` +
        `the restricted role "${REBASE_USER_ROLE}", but the connection role ` +
        `"${connectionRole}" bypasses RLS and cannot create that role itself.\n` +
        `Run the following as a database administrator, then restart:\n\n` +
        `CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;\n` +
        `GRANT ${REBASE_USER_ROLE} TO ${quoteIdent(connectionRole)};\n` +
        grants
    );
}

/**
 * Idempotently provision the `rebase_user` role, membership for the current
 * connection role, and DML grants (+ default privileges for future tables)
 * on every existing schema in `schemas`.
 *
 * Split into privilege tiers so it works both when the connection is a
 * superuser (creates everything) and when the platform pre-created the role
 * and membership (e.g. CNPG `postInitApplicationSQL`) and the connection is
 * merely the table owner — owners can always run the grant tier themselves.
 *
 * RLS still filters every row: these grants only make the tables *reachable*
 * by the role; the policies decide which rows/commands actually pass.
 *
 * Throws with precise setup instructions when the role is missing and the
 * connection cannot create it.
 */
export async function ensureAppRole(run: RawSqlRunner, schemas: string[]): Promise<void> {
    const uniqueSchemas = Array.from(new Set(schemas.filter(Boolean)));

    // Tier 1 — role existence.
    const roleRows = await run(`SELECT 1 FROM pg_roles WHERE rolname = '${REBASE_USER_ROLE}'`);
    if (roleRows.length === 0) {
        try {
            await run(`CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
        } catch (err) {
            throw new Error(
                `Failed to create the "${REBASE_USER_ROLE}" role: ${err instanceof Error ? err.message : String(err)}\n\n` +
                appRoleSetupInstructions("current connection role", uniqueSchemas)
            );
        }
    }

    // Tier 2 — membership, so a non-superuser connection may SET ROLE to it.
    const memberRows = await run(`
        SELECT (pg_has_role(current_user, '${REBASE_USER_ROLE}', 'MEMBER')
                OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS can_set,
               current_user AS role
    `);
    if (memberRows[0]?.can_set !== true) {
        try {
            await run(`GRANT ${REBASE_USER_ROLE} TO CURRENT_USER`);
        } catch (err) {
            throw new Error(
                `The connection role is not a member of "${REBASE_USER_ROLE}" and cannot grant itself membership: ` +
                `${err instanceof Error ? err.message : String(err)}\n\n` +
                appRoleSetupInstructions(String(memberRows[0]?.role ?? "current connection role"), uniqueSchemas)
            );
        }
    }

    // Tier 3 — grants. Table owners (the expected non-superuser posture) can
    // always grant on their own objects, so this tier needs no extra privilege.
    const nspRows = await run("SELECT nspname FROM pg_namespace");
    const existing = new Set(nspRows.map((r) => String(r.nspname)));
    for (const schema of uniqueSchemas) {
        if (!existing.has(schema)) continue;
        const s = quoteIdent(schema);
        await run(`GRANT USAGE ON SCHEMA ${s} TO ${REBASE_USER_ROLE}`);
        await run(`GRANT ${USER_TABLE_PRIVILEGES} ON ALL TABLES IN SCHEMA ${s} TO ${REBASE_USER_ROLE}`);
        await run(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${REBASE_USER_ROLE}`);
        // Cover objects created later by the CURRENT role (the role that runs
        // migrations), so a migrate can never strand the user role.
        await run(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT ${USER_TABLE_PRIVILEGES} ON TABLES TO ${REBASE_USER_ROLE}`);
        await run(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${REBASE_USER_ROLE}`);
    }

    logger.info(`🔐 [rls] User role "${REBASE_USER_ROLE}" provisioned (schemas: ${uniqueSchemas.join(", ")})`);
}

/**
 * Apply the authenticated context to a transaction: the `app.*` GUCs that RLS
 * policies read via `auth.uid()` / `auth.roles()` / `auth.jwt()`, and — when
 * `userRole` is set — `SET LOCAL ROLE` so RLS binds every statement in this
 * transaction (reads *and* writes).
 *
 * GUCs are set with `is_local = true` and the role switch is `LOCAL`: both
 * reset at commit/rollback, so pooled connections are never polluted.
 *
 * Fails closed by construction: if the role switch errors, the transaction
 * aborts instead of proceeding privileged.
 *
 * SECURITY: this function is only ever called on the **user** path (the server
 * context uses the base/owner driver and never calls it). The default policies
 * treat `auth.uid() IS NULL` as the trusted server context, and `auth.uid()`
 * is `NULLIF(current_setting('app.user_id'), '')` — so an EMPTY user id would
 * be read as NULL and silently escalate a user request to server privileges.
 * Coerce empty/blank ids to a sentinel here, at the single chokepoint, rather
 * than trusting every caller (e.g. realtime subscription auth) to do it.
 */
export async function applyAuthContext(tx: SqlTx, auth: AuthContext, userRole?: string): Promise<void> {
    const userId = typeof auth.userId === "string" && auth.userId.trim() !== "" ? auth.userId : "anonymous";
    const normalizedRoles = auth.roles.map((r: unknown) =>
        typeof r === "string" ? r : (r as Record<string, unknown>)?.id ?? String(r)
    );
    await tx.execute(drizzleSql`
        SELECT
            set_config('app.user_id', ${userId}, true),
            set_config('app.user_roles', ${normalizedRoles.join(",")}, true),
            set_config('app.jwt', ${JSON.stringify({ sub: userId, roles: auth.roles })}, true)
    `);
    if (userRole) {
        await tx.execute(drizzleSql.raw(`SET LOCAL ROLE ${quoteIdent(userRole)}`));
    }
}
