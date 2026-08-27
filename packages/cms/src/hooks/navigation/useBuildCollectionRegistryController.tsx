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

        const pathSegments = cleanedPath.split("/");

        let collectionPath = pathSegments.join("/");
        // If the path has an even number of segments, it points to a entity, so we get the parent collection
        if (pathSegments.length > 0 && pathSegments.length % 2 === 0) {
            collectionPath = pathSegments.slice(0, -1).join("/");
        }

        if (!collectionPath) return undefined;

        let collection: AdminCollection | undefined;

        // An exact slug match first, because a slug is allowed to contain
        // slashes and several drivers need it to: a Firestore collection
        // partitioned by locale is declared as `content/de-DE/podcasts`, and
        // that string is its *name*, not a path to walk.
        //
        // Without this, such a slug went straight to `resolvePathToCollections`,
        // which reads any `a/b/c` as collection/entity/subcollection, looked for
        // a root collection called `content`, found none and threw — and the
        // catch below turned that into `undefined`. `RebaseRoute` renders
        // `null` for an unresolved collection, so the whole view came out blank
        // with nothing in the console above `debug`. Thirty-five collections in
        // one app were unreachable that way.
        // `collectionPath`, not `cleanedPath`: an even segment count means the
        // path ends at a record, and the id has already been trimmed off above.
        // Matching the raw path instead would only ever hit for a collection
        // route, leaving `content/de-DE/podcasts/abc123` back on the walker.
        collection = registry.get(collectionPath) as AdminCollection | undefined;

        if (!collection) {
            try {
                collection = registry.resolvePathToCollections(collectionPath).finalCollection;
            } catch (e) {
                // Warn, not debug. An unresolved collection ends as a route with
                // nothing in it, and at `debug` there was no way to tell that
                // from a collection that legitimately has no rows.
                console.warn(`[rebase] Could not resolve a collection for "${collectionPath}"`, e);
                return undefined;
            }
        }

        if (!collection) {
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

    const getParentCollectionSlugs = useCallback((path: string): string[] => {
        const registry = collectionRegistryRef.current;
        if (!registry) {
            return [];
        }
        const cleanedPath = removeInitialAndTrailingSlashes(path);
        const strings = cleanedPath.split("/");
        const oddPathSegments = strings.filter((_, i) => i % 2 === 0);
        oddPathSegments.pop();

        const result: string[][] = [];

        for (let i = 1; i <= oddPathSegments.length; i++) {
            result.push(oddPathSegments.slice(0, i));
        }

        const getCollectionFromPaths = (pathSegments: string[]): AdminCollection | undefined => {
            if (!pathSegments?.length) return undefined;
            const testPath = pathSegments.reduce((acc, segment, idx) => {
                if (idx === 0) return segment;
                return `${acc}/fake_id/${segment}`;
            }, "");
            try {
                return registry.resolvePathToCollections(testPath).finalCollection;
            } catch (e) {
                return undefined;
            }
        };

        return result.map(r => getCollectionFromPaths(r)?.slug).filter(Boolean) as string[];
    }, []);

    const getParentEntityIds = useCallback((path: string): string[] => {
        const cleanedPath = removeInitialAndTrailingSlashes(path);
        const strings = cleanedPath.split("/");
        const evenPathSegments = strings.filter((_, i) => i % 2 !== 0);
        if (strings.length % 2 === 0) {
            evenPathSegments.pop();
        }
        return evenPathSegments;
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
