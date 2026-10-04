import { useCallback } from "react";
import type { Entity, EntityReference } from "@rebasepro/types";
import { useCollectionScope } from "@rebasepro/app";
import { getReferenceFrom } from "@rebasepro/common";
import { useCollectionRegistryController } from "./navigation/contexts/CollectionRegistryContext";

/**
 * Where a reference points, as stored and as the admin addresses it.
 *
 * The two differ for a Firestore or MongoDB collection that declares a `path`
 * for its store: `slug: "fs_diagnosis", path: "diagnosis"`. A reference stores
 * `diagnosis`, because that is where its driver finds the record. The admin
 * lists, routes and fetches by `fs_diagnosis`, and `diagnosis` can be the slug
 * of a Postgres collection beside it — which is what declaring the `path` was
 * for. A reference property's own `path` may be written either way.
 *
 * A stored path is read in favour of the data source of the collection in
 * scope: a reference is read from a record, and points into that record's
 * store unless its `driver` says otherwise.
 */
export function useReferencePaths(): {
    /** The path the admin addresses the target of a stored reference, or of a reference property's `path`, by. */
    toCollectionPath: (path: string, driver?: string) => string;
    /** A reference to `entity`, carrying the path its record is stored under. */
    referenceTo: (entity: Entity<Record<string, unknown>>) => EntityReference;
} {
    const collectionRegistry = useCollectionRegistryController();
    const scope = useCollectionScope();
    const scopeDriver = scope?.dataSource ?? scope?.engine;

    const toCollectionPath = useCallback(
        (path: string, driver?: string) => collectionRegistry.resolveCollectionPath(path, driver ?? scopeDriver),
        [collectionRegistry, scopeDriver]);

    const referenceTo = useCallback(
        (entity: Entity<Record<string, unknown>>) => getReferenceFrom(entity, collectionRegistry.resolveDataPath(entity.path)),
        [collectionRegistry]);

    return { toCollectionPath, referenceTo };
}
