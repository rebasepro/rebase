/**
 * Driver Registry
 *
 * Manages multiple driver delegates for Rebase backend.
 * Allows different databases for different collections.
 *
 * Usage:
 * - Single DB: Pass a single DataDriver → maps to "(default)"
 * - Multiple DBs: Pass a map of { dbId: DataDriver }
 * - Collections use `databaseId` property to specify which driver to use
 * - Collections without `databaseId` fallback to "(default)"
 */

import { DataDriver } from "@rebasepro/types";
import { logger } from "../utils/logger";

/**
 * The default driver identifier used when:
 * - A single driver is provided (not a map)
 * - A collection doesn't specify a databaseId
 */
export const DEFAULT_DRIVER_ID = "(default)";

/**
 * A database key that names no registered driver.
 *
 * Thrown rather than answered with the default driver. A table declared on
 * `database("analytics")` that reaches the default database is read from and
 * written to the wrong place — rows land where nothing routed to analytics
 * will ever look for them, and reads come back empty instead of failing —
 * which is the one outcome worse than an error. Storage refuses an unknown
 * source the same way (`UnknownStorageSourceError`).
 */
export class UnknownDatabaseError extends Error {
    constructor(public readonly databaseKey: string, public readonly knownKeys: string[]) {
        super(
            `[DriverRegistry] Database "${databaseKey}" is not registered. ` +
            `Registered databases: ${knownKeys.length > 0 ? knownKeys.map(k => `"${k}"`).join(", ") : "(none)"}. ` +
            `Declare it in backend/resources.ts — database("${databaseKey}") — and bind its connection string ` +
            "(DATABASE_URL__<KEY>), or fix the table's `database`."
        );
        this.name = "UnknownDatabaseError";
    }
}

/**
 * The registry key an id means: omitted, empty or `(default)` is the default
 * database; anything else is itself.
 */
function canonicalDriverId(id: string | undefined | null): string {
    const trimmed = id?.trim();
    return trimmed ? trimmed : DEFAULT_DRIVER_ID;
}

/**
 * Registry for managing multiple driver delegates
 */
export interface DriverRegistry {
    /**
     * Register a driver delegate with an ID
     * @param id - Unique identifier for this driver (e.g., "analytics", "users")
     * @param delegate - The DataDriver instance
     */
    register(id: string, delegate: DataDriver): void;

    /**
     * Get the default driver delegate (id = "(default)")
     * @throws Error if no default driver is registered
     */
    getDefault(): DataDriver;

    /**
     * Get a driver delegate by ID
     * @param id - Driver identifier, or undefined/null for default
     * @returns The DataDriver, or undefined if not found
     */
    get(id: string | undefined | null): DataDriver | undefined;

    /**
     * Get a driver delegate by ID: the default for an omitted, empty or
     * `(default)` id, the named one otherwise.
     * @param id - Driver identifier, or undefined/null/"" for default
     * @returns The DataDriver
     * @throws UnknownDatabaseError if `id` names a database that is not registered —
     *   never the default in its place
     * @throws Error if the default is asked for and none is registered
     */
    getOrDefault(id: string | undefined | null): DataDriver;

    /**
     * Check if a driver with the given ID exists
     */
    has(id: string): boolean;

    /**
     * List all registered driver IDs
     */
    list(): string[];

    /**
     * Get the number of registered drivers
     */
    size(): number;
}

/**
 * Default implementation of DriverRegistry
 */
export class DefaultDriverRegistry implements DriverRegistry {
    private delegates = new Map<string, DataDriver>();

    /**
     * Create a DriverRegistry from either a single delegate or a map
     * @param input - Single DataDriver (maps to "(default)") or Record<string, DataDriver>
     */
    static create(
        input: DataDriver | Record<string, DataDriver>
    ): DefaultDriverRegistry {
        const registry = new DefaultDriverRegistry();

        if (isDataDriverDelegate(input)) {
            // Single delegate → register as "(default)"
            registry.register(DEFAULT_DRIVER_ID, input);
        } else {
            // Map of delegates → register each
            for (const [id, delegate] of Object.entries(input)) {
                registry.register(id, delegate);
            }
            // Ensure there's a default if not explicitly provided
            if (!registry.has(DEFAULT_DRIVER_ID) && registry.size() > 0) {
                // If no explicit "(default)", use the first one as default.
                // With one driver there is no choice to report: a backend
                // composed from one `database` adapter keys it by its type,
                // and said a warning on every boot about the only driver it
                // has. With several, which one is the default is a decision
                // worth seeing.
                const firstId = Object.keys(input)[0];
                const line = `[DriverRegistry] No "${DEFAULT_DRIVER_ID}" driver provided. Using "${firstId}" as the default.`;
                if (registry.size() > 1) logger.warn(line);
                else logger.debug(line);
                registry.register(DEFAULT_DRIVER_ID, input[firstId]);
            }
        }

        return registry;
    }

    register(id: string, delegate: DataDriver): void {
        if (this.delegates.has(id)) {
            logger.warn(`[DriverRegistry] Overwriting driver with id "${id}"`);
        }
        this.delegates.set(id, delegate);
    }

    getDefault(): DataDriver {
        const delegate = this.delegates.get(DEFAULT_DRIVER_ID);
        if (!delegate) {
            throw new Error(
                "[DriverRegistry] No default driver registered. " +
                `Register one with id "${DEFAULT_DRIVER_ID}" or pass a single DataDriver.`
            );
        }
        return delegate;
    }

    get(id: string | undefined | null): DataDriver | undefined {
        // Canonicalized on the same rule as `getOrDefault`, so the two cannot
        // disagree about which ids mean the default database.
        return this.delegates.get(canonicalDriverId(id));
    }

    getOrDefault(id: string | undefined | null): DataDriver {
        const key = canonicalDriverId(id);
        if (key === DEFAULT_DRIVER_ID) {
            return this.getDefault();
        }

        const delegate = this.delegates.get(key);
        if (delegate) {
            return delegate;
        }

        throw new UnknownDatabaseError(key, this.list());
    }

    has(id: string): boolean {
        return this.delegates.has(id);
    }

    list(): string[] {
        return Array.from(this.delegates.keys());
    }

    size(): number {
        return this.delegates.size;
    }
}

/**
 * Type guard to check if an object is a DataDriver
 */
function isDataDriverDelegate(obj: unknown): obj is DataDriver {
    if (typeof obj !== "object" || obj === null) {
        return false;
    }
    const delegate = obj as DataDriver;
    // Check for required DataDriver properties
    return (
        typeof delegate.key === "string" &&
        typeof delegate.fetchCollection === "function" &&
        typeof delegate.fetchOne === "function" &&
        typeof delegate.save === "function" &&
        typeof delegate.delete === "function"
    );
}
