import { sql as drizzleSql, SQL } from "drizzle-orm";
import { logger } from "@rebasepro/server-core";

/**
 * Read-path RLS isolation.
 *
 * Rebase's security model is split: **reads** are gated by Postgres RLS
 * (`select` security rules compile to policies), while **writes** are gated by
 * application-layer callbacks (`beforeSave`/`beforeDelete`) and therefore rely
 * on the connection role bypassing RLS on ordinary tables (as table owner) —
 * with the exception of auth collections, whose tables are `FORCE ROW LEVEL
 * SECURITY` so the auto-injected admin write gate binds even the owner.
 *
 * That model only works if reads do NOT run with the same RLS-bypassing
 * privilege. This module provides the three pieces that make reads safe on any
 * connection:
 *
 *  1. {@link detectConnectionPosture} — is this connection subject to RLS at
 *     all? (superuser / BYPASSRLS / table owner ⇒ no)
 *  2. {@link ensureReaderRole} — idempotently provision `rebase_reader`, a
 *     NOLOGIN, NOSUPERUSER, NOBYPASSRLS, non-owner role with SELECT-only
 *     grants (+ default privileges so future tables stay covered).
 *  3. {@link applyAuthReadContext} — per-transaction: set the `app.*` GUCs the
 *     policies read (`auth.uid()` etc.) and `SET LOCAL ROLE rebase_reader` so
 *     RLS actually binds. Transaction-scoped, so it composes with poolers.
 *
 * Provisioning runs from the framework's own bootstrap/migrate (which already
 * self-creates the `auth` schema and functions) — read isolation is
 * default-on, not an operator opt-in.
 */

/** The restricted role every authenticated read runs as. Framework-managed. */
export const REBASE_READER_ROLE = "rebase_reader";

/** Minimal SQL runner so callers can adapt drizzle or pg.Client. */
export type RawSqlRunner = (sqlText: string) => Promise<Record<string, unknown>[]>;

/** Minimal transaction surface needed by {@link applyAuthReadContext}. */
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
    /** True when RLS would NOT constrain this connection's reads. */
    privileged: boolean;
}

export interface AuthReadContext {
    userId: string;
    /** Raw roles as carried on the user (strings or `{ id }` objects). */
    roles: unknown[];
}

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;

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
 * reader role itself (no CREATEROLE and role not pre-created by the platform).
 */
export function readerRoleSetupInstructions(connectionRole: string, schemas: string[]): string {
    const grants = schemas.map((s) =>
        `GRANT USAGE ON SCHEMA ${quoteIdent(s)} TO ${REBASE_READER_ROLE};\n` +
        `GRANT SELECT ON ALL TABLES IN SCHEMA ${quoteIdent(s)} TO ${REBASE_READER_ROLE};`
    ).join("\n");
    return (
        `Rebase enforces row-level security on reads by running them as the ` +
        `restricted role "${REBASE_READER_ROLE}", but the connection role ` +
        `"${connectionRole}" bypasses RLS and cannot create that role itself.\n` +
        `Run the following as a database administrator, then restart:\n\n` +
        `CREATE ROLE ${REBASE_READER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT;\n` +
        `GRANT ${REBASE_READER_ROLE} TO ${quoteIdent(connectionRole)};\n` +
        grants
    );
}

/**
 * Idempotently provision the reader role, membership for the current
 * connection role, and SELECT grants (+ default privileges for future tables)
 * on every existing schema in `schemas`.
 *
 * Split into privilege tiers so it works both when the connection is a
 * superuser (creates everything) and when the platform pre-created the role
 * and membership (e.g. CNPG `postInitApplicationSQL`) and the connection is
 * merely the table owner — owners can always run the grant tier themselves.
 *
 * Throws with precise setup instructions when the role is missing and the
 * connection cannot create it.
 */
export async function ensureReaderRole(run: RawSqlRunner, schemas: string[]): Promise<void> {
    const uniqueSchemas = Array.from(new Set(schemas.filter(Boolean)));

    // Tier 1 — role existence.
    const roleRows = await run(`SELECT 1 FROM pg_roles WHERE rolname = '${REBASE_READER_ROLE}'`);
    if (roleRows.length === 0) {
        try {
            await run(`CREATE ROLE ${REBASE_READER_ROLE} NOLOGIN NOSUPERUSER NOBYPASSRLS NOINHERIT`);
        } catch (err) {
            throw new Error(
                `Failed to create the "${REBASE_READER_ROLE}" role: ${err instanceof Error ? err.message : String(err)}\n\n` +
                readerRoleSetupInstructions("current connection role", uniqueSchemas)
            );
        }
    }

    // Tier 2 — membership, so a non-superuser connection may SET ROLE to it.
    const memberRows = await run(`
        SELECT (pg_has_role(current_user, '${REBASE_READER_ROLE}', 'MEMBER')
                OR (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)) AS can_set,
               current_user AS role
    `);
    if (memberRows[0]?.can_set !== true) {
        try {
            await run(`GRANT ${REBASE_READER_ROLE} TO CURRENT_USER`);
        } catch (err) {
            throw new Error(
                `The connection role is not a member of "${REBASE_READER_ROLE}" and cannot grant itself membership: ` +
                `${err instanceof Error ? err.message : String(err)}\n\n` +
                readerRoleSetupInstructions(String(memberRows[0]?.role ?? "current connection role"), uniqueSchemas)
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
        await run(`GRANT USAGE ON SCHEMA ${s} TO ${REBASE_READER_ROLE}`);
        await run(`GRANT SELECT ON ALL TABLES IN SCHEMA ${s} TO ${REBASE_READER_ROLE}`);
        // Covers tables created later by the CURRENT role (the role that runs
        // migrations), so a migrate can never strand the reader without grants.
        await run(`ALTER DEFAULT PRIVILEGES IN SCHEMA ${s} GRANT SELECT ON TABLES TO ${REBASE_READER_ROLE}`);
    }

    logger.info(`🔐 [read-isolation] Reader role "${REBASE_READER_ROLE}" provisioned (schemas: ${uniqueSchemas.join(", ")})`);
}

/**
 * Apply the authenticated context to a transaction: the `app.*` GUCs that RLS
 * policies read via `auth.uid()` / `auth.roles()` / `auth.jwt()`, and — when
 * `readerRole` is set — `SET LOCAL ROLE` so RLS actually binds this
 * transaction's reads.
 *
 * GUCs are set with `is_local = true` and the role switch is `LOCAL`: both
 * reset at commit/rollback, so pooled connections are never polluted.
 *
 * Fails closed by construction: if the role switch errors, the transaction
 * aborts instead of proceeding privileged.
 */
export async function applyAuthReadContext(tx: SqlTx, auth: AuthReadContext, readerRole?: string): Promise<void> {
    const normalizedRoles = auth.roles.map((r: unknown) =>
        typeof r === "string" ? r : (r as Record<string, unknown>)?.id ?? String(r)
    );
    await tx.execute(drizzleSql`
        SELECT
            set_config('app.user_id', ${auth.userId}, true),
            set_config('app.user_roles', ${normalizedRoles.join(",")}, true),
            set_config('app.jwt', ${JSON.stringify({ sub: auth.userId, roles: auth.roles })}, true)
    `);
    if (readerRole) {
        await tx.execute(drizzleSql.raw(`SET LOCAL ROLE ${quoteIdent(readerRole)}`));
    }
}
