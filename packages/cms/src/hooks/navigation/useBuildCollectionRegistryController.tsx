import type { DataSourceDefinition } from "@rebasepro/types";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { CollectionRegistry, getSubcollections } from "@rebasepro/common";
import { getParentReferencesFromPath as commonGetParentReferencesFromPath, removeInitialAndTrailingSlashes } from "@rebasepro/app";
import { EntityReference, CollectionRegistryController } from "@rebasepro/types";
import { UserConfigurationPersistence, resolveAdminCollection, AdminCollection } from "@rebasepro/cms-types";
import { mergeDeep } from "@rebasepro/utils";

export function useBuildCollectionRegistryController(props: {
    userConfigPersistence?: UserConfigurationPersistence,
    dataSources?: Record<string, DataSourceDefinition>
}): CollectionRegistryController & {
    collectionRegistryRef: React.MutableRefObject<CollectionRegistry>;
} {
    const { userConfigPersistence, dataSources } = props;
    const collectionRegistryRef = useRef<CollectionRegistry>(new CollectionRegistry(undefined, dataSources));
    // Keep the registry's data sources in sync (used to resolve engine during
    // normalization). Applied synchronously before the async registration
    // effect in useResolvedCollections runs.
    if (dataSources) collectionRegistryRef.current.setDataSources(dataSources);
    const [initialised, setInitialised] = useState(false);

    const getCollection = useCallback((
        slugOrPath: string,
        includeUserOverride = false
    ): AdminCollection | undefined => {

        const registry = collectionRegistryRef.current;

        const cleanedPath = removeInitialAndTrailingSlashes(slugOrPath);
        if (!cleanedPath) return undefined;

        let collection: AdminCollection | undefined;

        // A slug is allowed to contain slashes, and several drivers need it
        // to: a Firestore collection partitioned by locale is declared as
        // `content/de-DE/podcasts`, and that string is its *name*, not a path
        // to walk. Reading any `a/b/c` as collection/entity/subcollection looked
        // for a root collection called `content`, found none and threw, and the
        // view came out blank. Thirty-five collections in one app were
        // unreachable that way.
        //
        // Matching the whole path as a slug first fixed the collection itself
        // and nothing under it: `medico/v2.0.0/joints/j1/movements` is not a
        // slug either, so it went back to a walker starting from `medico`, and
        // the joint's tabs rendered empty. The registry now takes the longest
        // leading run of segments that names a collection as the root, and
        // pairs up what follows — which also decides whether the path ends at a
        // record. The segment count cannot: `content/podcasts` is two segments
        // and a collection, `content/de-DE/podcasts/abc123` four and a record.
        try {
            collection = registry.resolvePathToCollections(cleanedPath, { allowRecordPath: true }).finalCollection as AdminCollection;
        } catch (e) {
            // Warn, not debug. An unresolved collection ends as a route with
            // nothing in it, and at `debug` there was no way to tell that
            // from a collection that legitimately has no rows.
            console.warn(`[rebase] Could not resolve a collection for "${cleanedPath}"`, e);
            return undefined;
        }

        const userOverride = includeUserOverride ? userConfigPersistence?.getCollectionConfig(slugOrPath) : undefined;
        const overriddenCollection = collection ? mergeDeep(collection, userOverride ?? {}) : undefined;

        if (!overriddenCollection) return undefined;

        let result: Partial<AdminCollection> | undefined = overriddenCollection;
        const subcollections = "subcollections" in overriddenCollection ? overriddenCollection.subcollections : undefined;
        const callbacks = overriddenCollection.callbacks;
        result = {
            ...result,
            callbacks: result?.callbacks ?? callbacks
        };
        // Preserve subcollections if they exist
        if (subcollections && "subcollections" in result) {
            (result as Record<string, unknown>).subcollections = (result as Record<string, unknown>).subcollections ?? subcollections;
        }

        // Flatten the admin block: everything downstream of here is the panel's
        // view model, not the authoring shape. Applied after the user-override
        // merge so an override of a presentation field still wins.
        return resolveAdminCollection({ ...overriddenCollection,
...result } as AdminCollection);

    }, [userConfigPersistence]);

    const getRawCollection = useCallback((slugOrPath: string): AdminCollection | undefined => {
        const registry = collectionRegistryRef.current;
        if (registry === undefined) return undefined;

        const cleanedPath = removeInitialAndTrailingSlashes(slugOrPath);
        if (!cleanedPath) return undefined;

        const pathSegments = cleanedPath.split("/");

        return registry.getRaw(pathSegments.join("/")) as AdminCollection | undefined;
    }, []);

    const getParentReferencesFromPath = useCallback((path: string): EntityReference[] => {
        const registry = collectionRegistryRef.current;
        if (!registry) {
            return [];
        }
        const cleanedPath = removeInitialAndTrailingSlashes(path);
        const pathSegments = cleanedPath.split("/");

        return commonGetParentReferencesFromPath({
            path: pathSegments.join("/"),
            collections: registry.getCollections()
        });
    }, []);

    // Both read the registry's walk rather than taking alternate segments of
    // the path as collections and ids. Alternate segments only line up while no
    // slug contains a slash: they read `medico/v2.0.0/joints/j1/movements` as
    // having `v2.0.0` for a parent id and no parent collection at all.
    const getParentCollectionSlugs = useCallback((path: string): string[] => {
        const resolved = walkPath(collectionRegistryRef.current, path);
        if (!resolved) return [];
        // Every collection on the way down except the one the path addresses.
        return resolved.collections.slice(0, -1).map(collection => collection.slug);
    }, []);

    const getParentEntityIds = useCallback((path: string): string[] => {
        const resolved = walkPath(collectionRegistryRef.current, path);
        if (!resolved) return [];
        const { collections, entityIds } = resolved;
        // A path ending at a record has one id per collection, and the last is
        // the record itself rather than a parent of it.
        const parentIds = entityIds.length === collections.length ? entityIds.slice(0, -1) : entityIds;
        return parentIds.map(String);
    }, []);

    const convertIdsToPaths = useCallback((ids: string[]): string[] => {
        const registry = collectionRegistryRef.current;
        if (!registry) return [];
        let currentCollections: AdminCollection[] = registry.getCollections();
        const paths: string[] = [];
        for (let i = 0; i < ids.length; i++) {
            const id = ids[i];
            const collection: AdminCollection | undefined = currentCollections.find(c => c.slug === id);
            if (!collection)
                throw Error(`Collection with id ${id} not found`);
            paths.push(collection.slug);
            currentCollections = getSubcollections(collection) ?? [];
        }
        return paths;
    }, []);

    const collections = collectionRegistryRef.current.getCollections().map(resolveAdminCollection);

    // Determine initialised automatically based on whether collections exist,
    // though the NavigationStateController also plays a role in overall init
    useEffect(() => {
        if (!initialised && collections.length > 0) {
            setInitialised(true);
        }
    }, [initialised, collections.length]);

    return useMemo(() => ({
        collections,
        initialised,
        getCollection,
        getRawCollection,
        getParentReferencesFromPath,
        getParentCollectionSlugs,
        getParentEntityIds,
        convertIdsToPaths,
        collectionRegistryRef
    }), [
        collections,
        initialised,
        getCollection,
        getRawCollection,
        getParentReferencesFromPath,
        getParentCollectionSlugs,
        getParentEntityIds,
        convertIdsToPaths
    ]);
}

/**
 * The collections and record ids a path runs through, whether it ends at a
 * collection or at one of its records; `undefined` when the registry cannot
 * walk it.
 *
 * A route to a record can also end in the tab it opens — `…/{id}/history`,
 * `…/{id}/edit` — which is not a subcollection, and whose parents are the
 * record's. So a path that does not walk is tried once more without its last
 * segment.
 */
function walkPath(registry: CollectionRegistry, path: string): ReturnType<CollectionRegistry["resolvePathToCollections"]> | undefined {
    const segments = removeInitialAndTrailingSlashes(path).split("/").filter(Boolean);
    for (const candidate of [segments, segments.slice(0, -1)]) {
        if (candidate.length === 0) continue;
        try {
            return registry.resolvePathToCollections(candidate.join("/"), { allowRecordPath: true });
        } catch {
            // Try the next candidate.
        }
    }
    return undefined;
}
