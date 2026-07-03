import type { SnapshotCollection } from "../types/collections";
import type { SnapshotReference } from "../types/snapshots";

/**
 * Controller that provides access to the registered snapshot collections.
 * @group Models
 */
export type CollectionRegistryController<
    DB = Record<string, unknown>,
    EC extends SnapshotCollection = SnapshotCollection
> = {

    /**
     * List of the mapped collections in the CMS.
     * Each entry relates to a collection in the root database.
     * Each of the navigation entries in this field
     * generates an entry in the main menu.
     */
    collections?: SnapshotCollection[];

    /**
     * Is the registry ready to be used
     */
    initialised: boolean;

    /**
     * Get the collection configuration for a given path.
     * The collection is resolved from the given path or alias.
     */
    getCollection: <K extends keyof DB>(slugOrPath: Extract<K, string>, includeUserOverride?: boolean) => EC | undefined;

    /**
     * Get the raw, un-normalized collection configuration.
     * This bypasses the `CollectionRegistry` normalization (such as injecting `relation` instances).
     * This is strictly for the Visual Editor to manipulate AST code without persisting runtime state.
     */
    getRawCollection: (slugOrPath: string) => EC | undefined;

    /**
     * Retrieve all the related parent references for a given path
     * @param path
     */
    getParentReferencesFromPath: (path: string) => SnapshotReference[];

    /**
     * Retrieve all the related parent collection ids for a given path
     * @param path
     */
    getParentCollectionSlugs: (path: string) => string[];
    getParentSnapshotIds: (path: string) => string[];

    /**
     * Resolve paths from a list of ids
     * @param ids
     */
    convertIdsToPaths: (ids: string[]) => string[];

};
