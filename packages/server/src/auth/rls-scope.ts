/**
 * Shared RLS (Row-Level Security) scoping helper.
 *
 * DataDrivers may implement a `withAuth()` method that returns a scoped
 * clone of the driver with RLS policies applied for the given user.
 * This is database-specific (e.g. Postgres SET LOCAL ROLE) and is not
 * part of the core DataDriver interface.
 *
 * This module provides the shared duck-typing logic used by the
 * adapter-aware middleware.
 *
 * @module
 */

import type { DataDriver } from "@rebasepro/types";

/**
 * The identity the trusted server plane runs as: `rebase.dataAsAdmin`, and any
 * caller presenting the service key.
 *
 * Naming it makes the privilege legible, because it is narrower than it reads.
 * This is **not** an RLS bypass — a driver scoped with it is an
 * `AuthenticatedPostgresBackendDriver`, so every statement runs in a
 * transaction that has done `SET LOCAL ROLE rebase_user` with
 * `app.uid = 'service'`, and policies are evaluated. Two consequences worth
 * knowing before you write a policy:
 *
 * - It passes the default policies through their `rolesOverlap(['admin'])`
 *   arm — the same arm an application user holding the `admin` role passes.
 * - `policy.serverContext()` compiles to `rebase.uid() IS NULL` and is therefore
 *   **false** for it. A collection with `disableDefaultPolicies: true` whose
 *   only rule is `serverContext()` denies these writes (42501) and returns
 *   zero rows for these reads.
 *
 * The true bypass is `rebase.sql()`, which runs on the owner connection and
 * never goes near `withAuth`.
 */
export const SERVICE_IDENTITY: { uid: string; roles: string[] } = { uid: "service", roles: ["admin"] };

/**
 * A DataDriver that supports RLS scoping via `withAuth()`.
 *
 * This is not part of the public DataDriver interface because not all
 * database implementations support RLS. Drivers that do (e.g. Postgres)
 * extend DataDriver with this method.
 */
interface RLSScopedDriver extends DataDriver {
    withAuth(user: { uid: string; roles?: string[]; isAnonymous?: boolean }): Promise<DataDriver>;
}

/**
 * Returns true if the driver supports RLS scoping via `withAuth()`.
 */
function isRLSScopedDriver(driver: DataDriver): driver is RLSScopedDriver {
    return "withAuth" in driver && typeof (driver as Record<string, unknown>).withAuth === "function";
}

/**
 * Scope a DataDriver via `withAuth()` for RLS.
 *
 * SECURITY: If `withAuth()` is available but fails, the error is re-thrown
 * so the request is **denied** rather than proceeding with unscoped access
 * (fail-closed behavior).
 *
 * If the driver does not support RLS, the original driver is returned.
 *
 * @param driver - The DataDriver to scope.
 * @param user   - The authenticated user identity for RLS.
 * @returns The RLS-scoped DataDriver (or the original if RLS is unsupported).
 */
export async function scopeDataDriver(
    driver: DataDriver,
    /**
     * `isAnonymous` rides along so a policy can tell a GUEST — an anonymous
     * sign-in — from an account. It is a real user row with a real uid, so
     * without this the database sees the same principal either way. See
     * `rebase.is_anonymous()`.
     */
    user: { uid: string; roles?: string[]; isAnonymous?: boolean }
): Promise<DataDriver> {
    if (isRLSScopedDriver(driver)) {
        // Fail closed — do NOT catch and swallow errors here.
        // If RLS scoping fails the request must be rejected.
        return await driver.withAuth(user);
    }
    return driver;
}
