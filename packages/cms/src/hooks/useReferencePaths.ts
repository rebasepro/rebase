import { useCallback } from "react";
import type { Entity } from "@rebasepro/types";
import type { EntityReference } from "@rebasepro/cms-types";
import { useCollectionScope } from "@rebasepro/app";
import { resolveDataSource } from "@rebasepro/common";
import { getReferenceFrom } from "@rebasepro/cms-types";
import { useCollectionRegistryController } from "./navigation/contexts/CollectionRegistryContext";

/**
 * Where a reference points, as stored and as the admin addresses it.
 *
 * The two differ for a Firestore collection that declares a `path`
 * for its store: `slug: "fs_diagnosis", path: "diagnosis"`. A reference stores
 * `diagnosis`, because that is where its driver finds the record. The admin
 * lists, routes and fetches by `fs_diagnosis`, and `diagnosis` can be the slug
 * of a Postgres collection beside it — which is what declaring the `path` was
 * for.
 *
 * A **stored** path is read in favour of the reference's `driver` (the data
 * source it points into), else of the data source of the collection in
 * scope: a reference is read from a record, and points into that record's
 * store unless it says otherwise.
 *
 * A reference **property's** `path` names its target the way the admin
 * addresses collections: by slug, whatever data source the target is on — so
 * a Firestore field targeting `customers` means the Postgres `customers`
 * collection even when a Firestore collection is stored at `customers`. A
 * store path is read as one only where no collection has it as its slug.
 */
export function useReferencePaths(): {
    /** The path the admin addresses the target of a stored reference by. */
    toCollectionPath: (path: string, driver?: string) => string;
    /** The path the admin addresses the target of a reference property's `path` by. */
    targetPath: (path: string) => string;
    /**
     * A reference to `entity`, carrying the path its record is stored under
     * and — when it lives in another data source than the collection in
     * scope — that source's key as its `driver`, which routes its preview
     * there and makes it stored as an id.
     */
    referenceTo: (entity: Entity<Record<string, unknown>>) => EntityReference;
} {
    const collectionRegistry = useCollectionRegistryController();
    const scope = useCollectionScope();
    const scopeDriver = scope?.dataSource ?? scope?.engine;
    const scopeKey = resolveDataSource(scope).key;

    const toCollectionPath = useCallback(
        (path: string, driver?: string) => collectionRegistry.resolveCollectionPath(path, driver ?? scopeDriver),
        [collectionRegistry, scopeDriver]);

    const targetPath = useCallback(
        (path: string) => collectionRegistry.resolveCollectionPath(path),
        [collectionRegistry]);

    const referenceTo = useCallback(
        (entity: Entity<Record<string, unknown>>) => {
            const targetKey = resolveDataSource(collectionRegistry.getCollection(entity.path)).key;
            const driver = entity.driver ?? (targetKey !== scopeKey ? targetKey : undefined);
            return getReferenceFrom({ ...entity, driver }, collectionRegistry.resolveDataPath(entity.path));
        },
        [collectionRegistry, scopeKey]);

    return { toCollectionPath, targetPath, referenceTo };
}
