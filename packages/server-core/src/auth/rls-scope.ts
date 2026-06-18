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
 * A DataDriver that supports RLS scoping via `withAuth()`.
 *
 * This is not part of the public DataDriver interface because not all
 * database implementations support RLS. Drivers that do (e.g. Postgres)
 * extend DataDriver with this method.
 */
interface RLSScopedDriver extends DataDriver {
    withAuth(user: { uid: string; roles?: string[] }): Promise<DataDriver>;
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
    user: { uid: string; roles?: string[] }
): Promise<DataDriver> {
    if (isRLSScopedDriver(driver)) {
        // Fail closed — do NOT catch and swallow errors here.
        // If RLS scoping fails the request must be rejected.
        return await driver.withAuth(user);
    }
    return driver;
}
