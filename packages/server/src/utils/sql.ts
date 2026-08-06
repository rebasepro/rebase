import { sql, SQL } from "drizzle-orm";
import { RLS_JWT_SQL, RLS_ROLES_SQL, RLS_UID_SQL } from "@rebasepro/types";

/**
 * Returns a SQL chunk calling `rebase.uid()` — the current user's ID.
 * This is a PostgreSQL RLS helper function created in the `rebase` schema
 * that reads `app.uid` set per-transaction by `withAuth()`.
 *
 * The function moved from `auth.uid()` to `rebase.uid()` in 1.0 — `auth` is
 * Supabase's schema, and taking it meant Rebase could not be pointed at a
 * database that already had one. Use this helper rather than writing the call
 * by hand and the move costs you nothing.
 *
 * @example
 * sql`${table.uid} = ${authUid()}`
 */
export const authUid = (): SQL => {
    return sql.raw(RLS_UID_SQL);
};

/**
 * Returns a SQL chunk calling `rebase.roles()` — the current user's roles
 * as a comma-separated string.
 * Reads `app.user_roles` set per-transaction by `withAuth()`.
 *
 * @example
 * sql`${authRoles()} ~ 'admin'`
 */
export const authRoles = (): SQL => {
    return sql.raw(RLS_ROLES_SQL);
};

/**
 * Returns a SQL chunk calling `rebase.jwt()` — the full JWT claims as JSONB.
 * Reads `app.jwt` set per-transaction by `withAuth()`.
 *
 * @example
 * sql`${authJwt()}->>'sub'`
 */
export const authJwt = (): SQL => {
    return sql.raw(RLS_JWT_SQL);
};
