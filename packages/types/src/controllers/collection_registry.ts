import type { CollectionConfig } from "../types/collections";
import type { EntityReference } from "../types/entities";

/**
 * Controller that provides access to the registered entity collections.
 * @group Models
 */
export type CollectionRegistryController<
    DB = Record<string, unknown>,
    EC extends CollectionConfig = CollectionConfig
> = {

    /**
     * List of the mapped collections in the CMS.
     * Each entry relates to a collection in the root database.
     * Each of the navigation entries in this field
     * generates an entry in the main menu.
     *
     * `EC`, like {@link getCollection} — this was hardcoded to `CollectionConfig`
     * while `getCollection` honoured the parameter, so the admin panel got its
     * view model from one and the raw contract from the other.
     */
    collections?: EC[];

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
    getParentReferencesFromPath: (path: string) => EntityReference[];

    /**
     * Retrieve all the related parent collection ids for a given path
     * @param path
     */
    getParentCollectionSlugs: (path: string) => string[];
    getParentEntityIds: (path: string) => string[];

    /**
     * Resolve paths from a list of ids
     * @param ids
     */
    convertIdsToPaths: (ids: string[]) => string[];

};
