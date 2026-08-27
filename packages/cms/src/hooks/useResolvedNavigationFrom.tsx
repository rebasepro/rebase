
import type { EntityCustomView, AdminCollection } from "@rebasepro/cms-types";
import { Entity, User } from "@rebasepro/types";
import { RebaseContext } from "@rebasepro/cms-types";
import { useEffect, useState, useMemo } from "react";
import { getNavigationEntriesFromPath } from "@rebasepro/app";
import { useAdminContext } from "./useAdminContext";

/**
 * @see resolveNavigationFrom
 * @group Hooks and utilities
 */
export type ResolvedNavigationEntry<M extends Record<string, unknown>> =
    | ResolvedNavigationEntity<M>
    | ResolvedNavigationCollection<M>
    | ResolvedNavigationEntityCustom<M>;

/**
 * @see resolveNavigationFrom
 * @group Hooks and utilities
 */
export interface ResolvedNavigationEntity<M extends Record<string, unknown>> {
    type: "entity";
    entity: Entity<M>;
    entityId: string | number;
    path: string;
    parentCollection: AdminCollection<M>;
}

/**
 * @see resolveNavigationFrom
 * @group Hooks and utilities
 */
export interface ResolvedNavigationCollection<M extends Record<string, unknown>> {
    type: "collection";
    path: string;
    collection: AdminCollection<M>;
}

/**
 * @see resolveNavigationFrom
 * @group Hooks and utilities
 */
interface ResolvedNavigationEntityCustom<M extends Record<string, unknown>> {
    type: "custom_view";
    path: string;
    view: EntityCustomView<M>;
}

/**
 * Use this function to retrieve an array of navigation entries (resolved
 * collection, entity or entity custom_view) for the given path. You need to pass the app context
 * that you receive in different callbacks, such as the save hooks.
 *
 * It will take into account the `navigation` provided at the `Rebase` level.
 *
 * @param path
 * @param context
 * @group Hooks and utilities
 */
export function resolveNavigationFrom<M extends Record<string, unknown>, USER extends User>({
    path,
    context
}: {
    path: string,
    context: RebaseContext<USER>
}): Promise<ResolvedNavigationEntry<M>[]> {

    const data = context.data;
    const { navigationStateController, collectionRegistryController } = context;

    if (!navigationStateController || !collectionRegistryController) {
        throw Error("Calling resolveNavigationFrom, but main navigation has not yet been initialised");
    }

    const navigationEntries = getNavigationEntriesFromPath({
        path,
        collections: collectionRegistryController.collections ?? []
    });

    const resultPromises: Promise<ResolvedNavigationEntry<any>>[] = navigationEntries
        .map((entry) => {
            if (entry.type === "collection") {
                return Promise.resolve(entry);
            } else if (entry.type === "entity") {
                const collection = collectionRegistryController.getCollection(entry.slug);
                if (!collection) {
                    throw Error(`No collection defined in the navigation for the entity with path ${entry.slug}`);
                }
                // `context.data` is the flat SDK layer; re-wrap the row into the
                // Entity view-model the navigation entry expects. The address is
                // the one we just fetched by — reading it back off the row would
                // find nothing, since a row is only its columns.
                return data.collection(entry.slug).findById(entry.entityId)
                    .then((row) => {
                        if (!row) return undefined;
                        const entity = { id: entry.entityId, path: entry.slug, values: row };
                        return { ...entry,
entity };
                    });
            } else if (entry.type === "custom_view") {
                return Promise.resolve(entry);
            } else {
                throw Error("Unmapped element in useEntitiesFromPath");
            }
        })
        .filter(v => Boolean(v)) as Promise<ResolvedNavigationEntry<any>>[];

    return Promise.all(resultPromises);
}

/**
 * @group Hooks and utilities
 */
export interface NavigationFromProps {
    path: string;
}

/**
 * @group Hooks and utilities
 */
export interface NavigationFrom<M extends Record<string, unknown>> {
    data?: ResolvedNavigationEntry<M>[]
    dataLoading: boolean,
    dataLoadingError?: Error
}

/**
 * Use this hook to retrieve an array of navigation entries (resolved
 * collection or entity) for the given path. You can use this hook
 * in any React component that lives under `Rebase`
 * @group Hooks and utilities
 */
export function useResolvedNavigationFrom<M extends Record<string, unknown>>(
    {
        path
    }: NavigationFromProps): NavigationFrom<M> {

    const context = useAdminContext();
    const { navigationStateController, collectionRegistryController } = context;

    const [data, setData] = useState<ResolvedNavigationEntry<M>[] | undefined>();
    const [dataLoading, setDataLoading] = useState<boolean>(false);
    const [dataLoadingError, setDataLoadingError] = useState<Error | undefined>();

    useEffect(() => {
        if (navigationStateController && collectionRegistryController) {
            setDataLoading(true);
            setDataLoadingError(undefined);
            resolveNavigationFrom<M, User>({ path,
context })
                .then(setData)
                .catch((e) => setDataLoadingError(e))
                .finally(() => setDataLoading(false));
        }

    }, [path, context]);

    return useMemo(() => {
        if (!navigationStateController) {
            return { dataLoading: true };
        }
        return { data,
dataLoading,
dataLoadingError };
    }, [navigationStateController, data, dataLoading, dataLoadingError]);
}
