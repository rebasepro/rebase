import type { SnapshotCollection } from "../types/collections";

/**
 * @group Models
 */
export type PartialSnapshotCollection<M extends Record<string, unknown> = Record<string, unknown>> = Partial<SnapshotCollection<M>>;

/**
 * This interface is in charge of defining the controller that persists
 * modifications to a collection or collection, and retrieves them back from
 * a data source, such as local storage or Firestore.
 */
export interface UserConfigurationPersistence {
    onCollectionModified: <M extends Record<string, unknown> = Record<string, unknown>>(path: string, partialCollection: PartialSnapshotCollection<M>) => void;
    getCollectionConfig: <M extends Record<string, unknown> = Record<string, unknown>>(path: string) => PartialSnapshotCollection<M>;
    recentlyVisitedPaths: string[];
    setRecentlyVisitedPaths: (paths: string[]) => void;
    favouritePaths: string[];
    setFavouritePaths: (paths: string[]) => void;
    collapsedGroups: string[];
    setCollapsedGroups: (paths: string[]) => void;
}
