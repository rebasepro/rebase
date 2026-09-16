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
     * List of the mapped collections in the admin.
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
     * The path a collection's rows are stored under, for the path the admin
     * addresses it by. A Firestore or MongoDB collection may declare a `path`
     * other than its slug — `slug: "fs_diagnosis", path: "diagnosis"` — and
     * `fs_diagnosis/abc/locales` is then stored at `diagnosis/abc/locales`.
     * This is what a reference to one of its records stores. Unchanged for a
     * collection stored under its slug.
     */
    resolveDataPath: (path: string) => string;

    /**
     * The path the admin addresses a collection by, for a path its rows are
     * stored under: the inverse of {@link resolveDataPath}, for a reference
     * read back. `diagnosis` may be both where a Firestore collection is stored
     * and the slug of a Postgres one; `preferredDriver` — the reference's
     * `driver`, or the data source of the record it was read from — decides.
     */
    resolveCollectionPath: (path: string, preferredDriver?: string) => string;

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
