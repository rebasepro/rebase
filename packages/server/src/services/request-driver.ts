/**
 * Which database a data request runs against.
 *
 * A table declared on `database("analytics")` is served by the analytics
 * driver; one that names no database, or `(default)`, by the default driver.
 * One that names a database this process never opened — undeclared, or
 * declared and unbound — fails the request with a 503 NOT_CONFIGURED naming
 * the key, rather than being served by the default driver: there its writes
 * land where nothing routed to that database will look for them, and its
 * reads come back empty instead of failing.
 */
import type { Context } from "hono";
import type { DataDriver } from "@rebasepro/types";
import { ApiError } from "../api/errors";
import type { HonoEnv } from "../api/types";
import { DEFAULT_DRIVER_ID, UnknownDatabaseError, type DriverRegistry } from "./driver-registry";

/**
 * The code a request for a table on an unregistered database is answered
 * with: the documented `NOT_CONFIGURED` (a dependency this route needs is not
 * configured on this server). The message names the database, and `details`
 * carries its key.
 */
export const DATABASE_NOT_CONFIGURED = "NOT_CONFIGURED";

/**
 * The 503 for a table whose database has no driver in this process.
 *
 * A 503 rather than a 500: nothing in the request is wrong and nothing failed
 * at runtime — the server is not configured to serve this table, which an
 * operator fixes by declaring or binding the database and restarting.
 */
export function databaseNotConfigured(error: UnknownDatabaseError): ApiError {
    return new ApiError(
        503,
        DATABASE_NOT_CONFIGURED,
        `This table is stored in the database "${error.databaseKey}", which this server has not opened. ` +
        `Declare it in backend/resources.ts with database("${error.databaseKey}") and bind its connection string, then restart.`,
        { database: error.databaseKey }
    );
}

/**
 * The driver for a database key: the default driver for an omitted, empty or
 * `(default)` key, the registered one otherwise.
 *
 * @throws ApiError 503 NOT_CONFIGURED, naming the key, when it names no registered driver.
 */
export function driverForDatabaseKey(
    registry: DriverRegistry,
    defaultDriver: DataDriver,
    key: string | undefined | null
): DataDriver {
    const trimmed = key?.trim();
    // The authoritative default for the default key: whichever adapter the
    // backend made the default, which the registry need not hold under
    // `(default)` itself.
    if (!trimmed || trimmed === DEFAULT_DRIVER_ID) return defaultDriver;
    try {
        return registry.getOrDefault(trimmed);
    } catch (err) {
        if (err instanceof UnknownDatabaseError) throw databaseNotConfigured(err);
        throw err;
    }
}

/**
 * The per-request driver resolver the auth middleware scopes under RLS: the
 * request's collection path, after the data group's mount, mapped to its
 * table's database key by `keyForCollectionPath`.
 */
export function createRequestDriverResolver(options: {
    registry: DriverRegistry;
    defaultDriver: DataDriver;
    /** The database key of a collection path (`products`, `authors/1/posts`). */
    keyForCollectionPath: (collectionPath: string) => string | undefined;
}): (c: Context<HonoEnv>) => DataDriver {
    const { registry, defaultDriver, keyForCollectionPath } = options;
    return (c) => {
        // The collection path is what follows the group's mount — wherever the
        // application mounted it, which the group recorded on the request.
        const mountPath = c.get("mountPath") ?? "";
        const collectionPath = c.req.path.startsWith(mountPath) ? c.req.path.slice(mountPath.length) : c.req.path;
        return driverForDatabaseKey(registry, defaultDriver, keyForCollectionPath(collectionPath));
    };
}
