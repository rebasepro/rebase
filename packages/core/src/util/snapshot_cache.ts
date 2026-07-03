import { SnapshotReference, SnapshotRelation, GeoPoint, Vector } from "@rebasepro/types";
import { isObject, isPlainObject } from "@rebasepro/utils";

// Define a unique prefix for snapshot keys in sessionStorage to avoid key collisions
const LOCAL_STORAGE_PREFIX = "snapshot_cache::";

// In-memory cache to store snapshots for quick access
const snapshotCache: Map<string, object> = new Map();

// Check `sessionStorage` availability once during initialization
const isSessionStorageAvailable = typeof sessionStorage !== "undefined";

// Define custom replacer for JSON.stringify
function customReplacer(this: Record<string, unknown>, key: string): unknown {

    const value = this[key];

    // Handle Date objects
    if (value instanceof Date) {
        return {
            __type: "Date",
            value: value.toISOString()
        };
    }

    // Handle SnapshotReference
    if (value instanceof SnapshotReference) {
        return {
            __type: "SnapshotReference",
            id: value.id,
            path: value.path,
            driver: value.driver,
            databaseId: value.databaseId
        };
    }

    if (value instanceof SnapshotRelation) {
        return {
            __type: "SnapshotRelation",
            id: value.id,
            path: value.path,
            data: value.data
        };
    }

    // Handle GeoPoint
    if (value instanceof GeoPoint) {
        return {
            __type: "GeoPoint",
            latitude: value.latitude,
            longitude: value.longitude
        };
    }

    // Handle Vector
    if (value instanceof Vector) {
        return {
            __type: "Vector",
            value: value.value
        };
    }

    return value;
}

// Define custom reviver for JSON.parse
function customReviver(_key: string, value: unknown): unknown {
    if (value && typeof value === "object" && "__type" in value) {
        const record = value as Record<string, unknown>;
        switch (record.__type) {
            case "date":
            case "Date":
                return new Date(record.value as string);
            case "reference":
            case "SnapshotReference":
                return new SnapshotReference({
                    id: record.id as string,
                    path: record.path as string,
                    driver: record.driver as string | undefined,
                    databaseId: record.databaseId as string | undefined
                });
            case "relation":
            case "SnapshotRelation":
                return new SnapshotRelation(record.id as string, record.path as string, record.data as Record<string, unknown> | undefined);
            case "GeoPoint":
                return new GeoPoint(record.latitude as number, record.longitude as number);
            case "Vector":
                return new Vector(record.value as number[]);
            default:
                return value;
        }
    }
    return value;
}

// Initialize the in-memory cache by loading snapshots from `sessionStorage`
if (isSessionStorageAvailable) {
    try {
        // Iterate over all keys in sessionStorage to find those with the specified prefix
        for (let i = 0; i < sessionStorage.length; i++) {
            const fullKey = sessionStorage.key(i);
            if (fullKey && fullKey.startsWith(LOCAL_STORAGE_PREFIX)) {
                const path = fullKey.substring(LOCAL_STORAGE_PREFIX.length);
                const snapshotString = sessionStorage.getItem(fullKey);
                if (snapshotString) {
                    try {
                        const snapshot: object = JSON.parse(snapshotString, customReviver);
                        snapshotCache.set(path, snapshot);
                    } catch (parseError) {
                        console.error(
                            `Failed to parse snapshot for path "${path}" from sessionStorage:`,
                            parseError
                        );
                    }
                }
            }
        }
    } catch (error) {
        console.error("Error accessing sessionStorage during initialization:", error);
    }
}

/**
 * Saves data to the in-memory cache and persists it individually in `sessionStorage`.
 * @param path - The unique path/key for the data.
 * @param data - The data to cache and persist.
 */
export function saveSnapshotToCache(path: string, data: object): void {
    // Persist the data individually in sessionStorage
    if (isSessionStorageAvailable) {
        try {
            const key = LOCAL_STORAGE_PREFIX + path;

            const snapshotString = JSON.stringify(data, customReplacer);
            sessionStorage.setItem(key, snapshotString);
        } catch (error) {
            console.error(
                `Failed to save snapshot for path "${path}" to sessionStorage:`,
                error
            );
        }
    }
}

export function removeSnapshotFromMemoryCache(path: string): void {
    snapshotCache.delete(path);
}

export function saveSnapshotToMemoryCache(path: string, data: object): void {
    snapshotCache.set(path, data);
}

export function getSnapshotFromMemoryCache(path: string): object | undefined {
    return snapshotCache.get(path);
}


/**
 * Retrieves a snapshot from the in-memory cache or `sessionStorage`.
 * If the snapshot is not in the cache but exists in `sessionStorage`, it loads it into the cache.
 * @param path - The unique path/key for the snapshot.
 * @returns The cached snapshot or `undefined` if not found.
 */
export function getSnapshotFromCache(path: string): object | undefined {

    // If not in the cache, attempt to load it from sessionStorage
    if (isSessionStorageAvailable) {
        try {
            const key = LOCAL_STORAGE_PREFIX + path;
            const snapshotString = sessionStorage.getItem(key);
            if (snapshotString) {
                const snapshot: object = JSON.parse(snapshotString, customReviver);
                return snapshot;
            }
        } catch (error) {
            console.error(
                `Failed to load snapshot for path "${path}" from sessionStorage:`,
                error
            );
        }
    }

    // Snapshot not found
    return undefined;
}

/**
 * Removes a snapshot from both the in-memory cache and `sessionStorage`.
 * @param path - The unique path/key for the snapshot to remove.
 */
export function removeSnapshotFromCache(path: string): void {

    console.debug("Removing snapshot from cache", path);

    // Remove from the in-memory cache
    snapshotCache.delete(path);

    // Remove from sessionStorage
    if (isSessionStorageAvailable) {
        try {
            const key = LOCAL_STORAGE_PREFIX + path;
            sessionStorage.removeItem(key);
        } catch (error) {
            console.error(
                `Failed to remove snapshot for path "${path}" from sessionStorage:`,
                error
            );
        }
    }
}


export function flattenKeys(obj: Record<string, unknown> | unknown[], prefix = "", result: string[] = []): string[] {

    if (isObject(obj) || Array.isArray(obj)) {
        const plainObject = isPlainObject(obj);
        if (!plainObject && prefix) {
            result.push(prefix);
        } else {
            const record = obj as Record<string, unknown>;
            for (const key in record) {
                if (Object.prototype.hasOwnProperty.call(record, key)) {
                    const newKey = prefix
                        ? Array.isArray(obj)
                            ? `${prefix}[${key}]`
                            : `${prefix}.${key}`
                        : key;
                    const val = record[key];
                    if (isObject(val) || Array.isArray(val)) {
                        flattenKeys(val as Record<string, unknown> | unknown[], newKey, result);
                    } else {
                        result.push(newKey);
                    }
                }
            }
        }
    }
    return result;
}
