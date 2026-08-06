import { EntityReference, EntityRelation, GeoPoint, Vector } from "@rebasepro/types";
import { isObject, isPlainObject } from "@rebasepro/utils";

// Define a unique prefix for entity keys in sessionStorage to avoid key collisions
const LOCAL_STORAGE_PREFIX = "entity_cache::";

/**
 * The in-session handoff channel: an edit in flight, parked here by the layout
 * that is being replaced and picked up by the one taking over — the split's
 * "hide list", full screen's "show list", the side panel's "open full screen".
 * A record loaded from it opens *dirty*, because that is what it is for.
 *
 * Deliberately **not** hydrated from `sessionStorage`, and it is the one thing
 * here that isn't. The persisted half of this file is the local-changes backup:
 * a draft that outlives a reload, offered back through the banner or applied on
 * open, according to the collection's `localChangesBackup`. Loading those
 * drafts into this map on startup made every one of them look like a handoff —
 * the first visit to the record after a reload silently opened dirty carrying a
 * draft the user had walked away from, and the banner that exists to ask about
 * it never appeared.
 */
const entityCache: Map<string, object> = new Map();

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

    // Handle EntityReference
    if (value instanceof EntityReference) {
        return {
            __type: "EntityReference",
            id: value.id,
            path: value.path,
            driver: value.driver,
            databaseId: value.databaseId
        };
    }

    if (value instanceof EntityRelation) {
        return {
            __type: "EntityRelation",
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
            case "EntityReference":
                return new EntityReference({
                    id: record.id as string,
                    path: record.path as string,
                    driver: record.driver as string | undefined,
                    databaseId: record.databaseId as string | undefined
                });
            case "relation":
            case "EntityRelation":
                return new EntityRelation(record.id as string, record.path as string, record.data as Record<string, unknown> | undefined);
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

/**
 * Saves data to the local-changes backup in `sessionStorage`.
 *
 * The backup only — a draft that survives a reload is not an edit in flight.
 * {@link saveEntityToMemoryCache} is the other channel; see {@link entityCache}
 * for what separates them.
 * @param path - The unique path/key for the data.
 * @param data - The data to cache and persist.
 */
export function saveEntityToCache(path: string, data: object): void {
    // Persist the data individually in sessionStorage
    if (isSessionStorageAvailable) {
        try {
            const key = LOCAL_STORAGE_PREFIX + path;

            const entityString = JSON.stringify(data, customReplacer);
            sessionStorage.setItem(key, entityString);
        } catch (error) {
            console.error(
                `Failed to save entity for path "${path}" to sessionStorage:`,
                error
            );
        }
    }
}

/**
 * Consumes a handoff. The channel is one-shot: whoever picks an edit up owns it
 * from then on, and an edit left behind here is one that reopens a record dirty
 * long after the user stopped looking at it.
 */
export function removeEntityFromMemoryCache(path: string): void {
    entityCache.delete(path);
}

/**
 * Parks an edit in flight for the layout about to take over. See
 * {@link entityCache}: this is the handoff, not the backup.
 */
export function saveEntityToMemoryCache(path: string, data: object): void {
    entityCache.set(path, data);
}

export function getEntityFromMemoryCache(path: string): object | undefined {
    return entityCache.get(path);
}


/**
 * Retrieves a entity from the local-changes backup in `sessionStorage`.
 *
 * The backup only — the handoff channel is read through
 * {@link getEntityFromMemoryCache}, and the two mean different things to the
 * form that receives them.
 * @param path - The unique path/key for the entity.
 * @returns The cached entity or `undefined` if not found.
 */
export function getEntityFromCache(path: string): object | undefined {

    // If not in the cache, attempt to load it from sessionStorage
    if (isSessionStorageAvailable) {
        try {
            const key = LOCAL_STORAGE_PREFIX + path;
            const entityString = sessionStorage.getItem(key);
            if (entityString) {
                const entity: object = JSON.parse(entityString, customReviver);
                return entity;
            }
        } catch (error) {
            console.error(
                `Failed to load entity for path "${path}" from sessionStorage:`,
                error
            );
        }
    }

    // Entity not found
    return undefined;
}

/**
 * Removes a entity from both the in-memory cache and `sessionStorage`.
 * @param path - The unique path/key for the entity to remove.
 */
export function removeEntityFromCache(path: string): void {

    console.debug("Removing entity from cache", path);

    // Remove from the in-memory cache
    entityCache.delete(path);

    // Remove from sessionStorage
    if (isSessionStorageAvailable) {
        try {
            const key = LOCAL_STORAGE_PREFIX + path;
            sessionStorage.removeItem(key);
        } catch (error) {
            console.error(
                `Failed to remove entity for path "${path}" from sessionStorage:`,
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
