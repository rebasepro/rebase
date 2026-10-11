
import { useEffect, useState, useMemo } from "react";
import { Entity, User } from "@rebasepro/types";
import { RebaseContext, AdminCollection } from "@rebasepro/cms-types";
import { useData } from "./useData";
import { useRebaseContext } from "../useRebaseContext";
import { isConnectionLostError } from "../../util/realtime";
import { getRelationIncludeParams } from "../../util/previews";

/**
 * @group Hooks and utilities
 */
export interface FetchProps<M extends Record<string, any>, USER extends User = User> {
    path: string;
    entityId?: string | number;
    databaseId?: string;
    collection: AdminCollection<M, USER>;
    useCache?: boolean;
    /**
     * Load the collection's relation properties into the record, as a list
     * read loads them into each row. The record views ask for it: a form built
     * on a record without them shows a many-to-many field empty, and saving it
     * sets that empty membership. A preview leaves it off, since it would load
     * every related row of the record it previews.
     */
    relations?: boolean;
}

/**
 * @group Hooks and utilities
 */
export interface FetchResult<M extends Record<string, any>> {
    entity?: Entity<M>,
    dataLoading: boolean,
    dataLoadingError?: Error
}

/**
 * The most records {@link useFetch}'s cache holds. Past it, the record written
 * or read least recently goes first.
 *
 * The cache is what lets a record open with its values already on screen while
 * its listener catches up. It used to be fed every row a collection view held,
 * on every update of the view, and never let go of one: a table scrolled to
 * 100,000 rows kept ~260 MB alive after it was closed. A record is opened from
 * a list by clicking it, so the click is what puts it here now (see
 * `populateFetchCache`), and this bounds whatever else does.
 */
const FETCH_CACHE_LIMIT = 2_000;

/**
 * Key: `${path}/${id}`. Holds what the signed-in user read, so it is emptied on
 * sign-out (`clearFetchCache`, from `session_caches.ts`). A `Map` for its
 * insertion order: reading or writing an entry moves it to the end, and the
 * first entry is the one to evict.
 */
const CACHE = new Map<string, Entity<any>>();

function readCache<M extends Record<string, any>>(key: string): Entity<M> | undefined {
    const entity = CACHE.get(key);
    if (entity !== undefined) {
        CACHE.delete(key);
        CACHE.set(key, entity);
    }
    return entity as Entity<M> | undefined;
}

function writeCache(key: string, entity: Entity<any> | undefined): void {
    CACHE.delete(key);
    if (entity === undefined) return;
    CACHE.set(key, entity);
    if (CACHE.size > FETCH_CACHE_LIMIT) {
        const oldest = CACHE.keys().next().value;
        if (oldest !== undefined) CACHE.delete(oldest);
    }
}

/**
 * Put records in the entity fetch cache, so a view that opens one renders it at
 * once while the background fetch/listener brings in fresh data. The cache
 * keeps the 2,000 records written or read most recently.
 * @param path - The collection path (e.g. "products")
 * @param entities - Array of entities to cache
 */
export function populateFetchCache<M extends Record<string, any>>(path: string, entities: Entity<M>[]): void {
    for (const entity of entities) {
        writeCache(`${path}/${entity.id}`, entity);
    }
}

/**
 * Clear the entity fetch cache. Call this on auth state changes (e.g. logout)
 * to prevent stale data from a previous session leaking into the next.
 */
export function clearFetchCache(): void {
    CACHE.clear();
}

/**
 * `delivered`, with every relation property it does not carry taken from the
 * record already on screen.
 *
 * The record's read names the collection's relation properties (see
 * `useFetch`), so a frame normally carries them. One that does not — from a
 * server that ignores a row subscription's `include`, or a data source that
 * cannot load relations — has the key absent, not empty. The list row a click
 * opens the record on does carry it. Replaced wholesale, such a frame took
 * `tags` off the screen; the form follows an untouched field, so the field
 * emptied, and a tag added to it was saved as the whole set — which a
 * many-to-many save takes as the new membership, unlinking every other tag.
 * Absent is "not delivered": the value the record was opened with stands until
 * a frame carries one (an empty array included). Same record only; nothing
 * survives a deletion.
 */
function keepUndeliveredRelations<M extends Record<string, any>>(
    shown: Entity<M> | undefined,
    delivered: Entity<M>,
    collection: AdminCollection<M, any>
): Entity<M> {
    if (!shown || String(shown.id) !== String(delivered.id)) return delivered;
    const properties = collection.properties;
    if (!properties) return delivered;
    let values: M | undefined;
    for (const [name, property] of Object.entries(properties)) {
        if (property?.type !== "relation") continue;
        if (name in (delivered.values ?? {}) || !(name in (shown.values ?? {}))) continue;
        values ??= { ...delivered.values };
        values[name as keyof M] = shown.values[name];
    }
    return values ? { ...delivered, values } : delivered;
}

/**
 * The relations a record's read loads: the ones a list read of the same
 * collection loads into each row. Typed as `keepUndeliveredRelations` takes its
 * collection, since `useFetch`'s own `USER` reaches the export callbacks.
 */
function relationsToRead<M extends Record<string, any>>(collection: AdminCollection<M, any>): { include: string[] } | undefined {
    const include = getRelationIncludeParams(collection);
    return include ? { include } : undefined;
}

/**
 * This hook is used to fetch a entity.
 * It gives real time updates if the driver supports it.
 * @param path
 * @param collection
 * @param entityId
 * @param useCache
 * @group Hooks and utilities
 */

export function useFetch<M extends Record<string, any>, USER extends User = User>(
    {
        path,
        entityId,
        collection,
        databaseId,
        useCache = false,
        relations = false
    }: FetchProps<M, USER>): FetchResult<M> {

    const dataClient = useData();

    const context: RebaseContext<USER> = useRebaseContext();

    // Seed initial state from the cache to avoid skeleton flashes.
    // Even when useCache is false, we show cached data instantly while
    // the background fetch/listener brings in fresh data.
    const cacheKey = entityId ? `${path}/${entityId}` : undefined;
    // Read once per mount, not per render: a read also marks the entry used.
    const [cachedEntity] = useState<Entity<M> | undefined>(() => cacheKey ? readCache<M>(cacheKey) : undefined);

    const [entity, setEntity] = useState<Entity<M> | undefined>(cachedEntity);
    const [dataLoading, setDataLoading] = useState<boolean>(!cachedEntity);
    const [dataLoadingError, setDataLoadingError] = useState<Error | undefined>();

    useEffect(() => {

        const key = `${path}/${entityId}`;
        const cached = readCache<M>(key);

        // Only show loading state if we have no cached entity to display
        if (!cached) {
            setDataLoading(true);
        }

        // Whether a record is on screen — the cached one counts.
        let showingEntity = Boolean(cached);
        // The record on screen, so a frame can be read against it.
        let shown: Entity<M> | undefined = cached;

        const onEntityUpdate = async (delivered?: Entity<M> | null) => {
            const updatedEntity = delivered ? keepUndeliveredRelations(shown, delivered, collection) : delivered;
            shown = updatedEntity ?? undefined;
            showingEntity = Boolean(updatedEntity);
            writeCache(key, updatedEntity ?? undefined);
            setEntity(updatedEntity ?? undefined);
            setDataLoading(false);
            setDataLoadingError(undefined);
        };

        const onError = (error: Error) => {
            // The connection is down, not the record. Dropping the entity here
            // unmounted an open edit form, and everything typed into it, over
            // an outage the client recovers from on its own: the listener is
            // kept, and its next update is the fresh record.
            if (showingEntity && isConnectionLostError(error)) return;
            console.error("ERROR fetching entity", error);
            setDataLoading(false);
            setEntity(undefined);
            setDataLoadingError(error);
        };

        if (entityId && useCache && cached) {
            setEntity(cached);
            setDataLoading(false);
            setDataLoadingError(undefined);
            // eslint-disable-next-line @typescript-eslint/no-empty-function
            return () => {
            };
        } else if (entityId && path && collection) {
            const accessor = dataClient.collection(path);
            // The relations the form edits, read with the record exactly as a
            // list read includes them. Without them a to-many relation was
            // absent from the record, and one opened by URL — nothing cached
            // to fall back on — showed its many-to-many field empty; a save
            // from it set that empty membership, unlinking every related row.
            const readOptions = relations ? relationsToRead(collection) : undefined;

            if (accessor.listenById) {
                return accessor.listenById(entityId, (entity) => onEntityUpdate(entity as Entity<M> | undefined), onError, readOptions);
            } else {
                // The one-shot fallback, taken whenever the client has no
                // socket. `listenById` above cancels on cleanup; a promise
                // cannot, so the cleanup disowns its result instead. `entityId`
                // is an effect dependency, and where this hook's caller is not
                // remounted per record — the side panel replaces its contents
                // in place — a slow response for the record just left would
                // otherwise land on top of the one now showing.
                let cancelled = false;
                accessor.findById(entityId, readOptions)
                    .then((entity) => {
                        if (cancelled) return;
                        onEntityUpdate(entity as Entity<M> | undefined);
                    })
                    .catch((e) => {
                        if (cancelled) return;
                        onError(e);
                    });
                return () => {
                    cancelled = true;
                };
            }
        }
        // if no entityId is provided we do nothing
        else {
            onEntityUpdate(undefined);
            return () => {
            };
        }
    }, [entityId, path, dataClient, collection, useCache, databaseId, relations]);

    return useMemo(() => ({
        entity,
        dataLoading,
        dataLoadingError
    }), [entity, dataLoading, dataLoadingError]);

}
