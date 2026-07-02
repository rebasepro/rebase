import type { CollectionRegistryController } from "./collection_registry";
import type { Entity, EntityStatus, EntityValues } from "../types/entities";
import type { EntityCollection, FilterValues } from "../types/collections";
import type { RebaseContext } from "../rebase_context";


/**
 * @internal
 */
export interface FetchEntityProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    entityId: string | number;
    databaseId?: string;
    collection?: EntityCollection<M>
}

/**
 * @internal
 */
export type ListenEntityProps<M extends Record<string, unknown> = Record<string, unknown>> =
    FetchEntityProps<M>
    & {
        onUpdate: (entity: Entity<M> | null) => void,
        onError?: (error: Error) => void,
    }

/**
 * Configuration for vector similarity search queries.
 * Vector search applies an ORDER BY distance expression and optionally
 * filters results by a distance threshold.
 */
export interface VectorSearchParams {
    /** Property name containing the vector column */
    property: string;
    /** Query vector to compare against */
    vector: number[];
    /** Distance function (default: "cosine") */
    distance?: "cosine" | "l2" | "inner_product";
    /** Only return results within this distance threshold */
    threshold?: number;
}

/**
 * @internal
 */
export interface FetchCollectionProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    collection?: EntityCollection<M>;
    filter?: FilterValues<Extract<keyof M, string>>,
    limit?: number;
    offset?: number;
    startAfter?: unknown;
    orderBy?: string;
    searchString?: string;
    order?: "desc" | "asc";
    /** Vector similarity search configuration */
    vectorSearch?: VectorSearchParams;
}

/**
 * @internal
 */
export type ListenCollectionProps<M extends Record<string, unknown> = Record<string, unknown>> =
    FetchCollectionProps<M> &
    {
        onUpdate: (entities: Entity<M>[]) => void;
        onError?: (error: Error) => void;
    };

/**
 * @internal
 */
export interface SaveEntityProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    values: Partial<EntityValues<M>>;
    entityId?: string | number; // can be empty for new entities
    previousValues?: Partial<EntityValues<M>>;
    collection?: EntityCollection<M>;
    status: EntityStatus;
}

/**
 * @internal
 */
export interface DeleteEntityProps<M extends Record<string, unknown> = Record<string, unknown>> {
    entity: Entity<M>;
    collection?: EntityCollection<M>;
}

export type FilterCombinationValidProps = {
    path: string;
    databaseId?: string;
    collection: EntityCollection;
    filterValues: FilterValues<string>;
    sortBy?: [string, "asc" | "desc"];
};

/**
 * The integration SPI for plugging a data backend into Rebase.
 *
 * Implement this interface to connect a custom backend (or use a built-in
 * driver such as the Firestore one) and register it on
 * `<Rebase dataSources>`. Rebase wraps drivers via `buildRebaseData` and
 * routes collections to them by their `dataSource` key.
 *
 * For *consuming* data in application code, use `RebaseData` /
 * `context.data` instead — this interface is only for providing it.
 *
 * @group Datasource
 */
export interface DataDriver {

    /**
     * Key that identifies this driver
     */
    key?: string;

    /**
     * If the driver has been initialised
     */
    initialised?: boolean;

    /**
     * Fetch data from a collection
     * @param props
     * @return Promise of entities
     */
    fetchCollection<M extends Record<string, unknown> = Record<string, unknown>>(props: FetchCollectionProps<M>): Promise<Entity<M>[]>;

    /**
     * Listen to a collection in a given path. If you don't implement this method
     * `fetchCollection` will be used instead, with no real time updates.
     * @param props
     * @return Function to cancel subscription
     */
    listenCollection?<M extends Record<string, unknown> = Record<string, unknown>>(props: ListenCollectionProps<M>): () => void;

    /**
     * Retrieve an entity given a path and a collection
     * @param props
     */
    fetchEntity<M extends Record<string, unknown> = Record<string, unknown>>(props: FetchEntityProps<M>): Promise<Entity<M> | undefined>;

    /**
     * Get realtime updates on one entity.
     * @param props
     * @return Function to cancel subscription
     */
    listenEntity?<M extends Record<string, unknown> = Record<string, unknown>>(props: ListenEntityProps<M>): () => void;

    /**
     * Save entity to the specified path
     * @param props
     */
    saveEntity<M extends Record<string, unknown> = Record<string, unknown>>(props: SaveEntityProps<M>): Promise<Entity<M>>;

    /**
     * Delete an entity
     * @param props
     * @return was the whole deletion flow successful
     */
    deleteEntity<M extends Record<string, unknown> = Record<string, unknown>>(props: DeleteEntityProps<M>): Promise<void>;

    /**
     * Delete all entities from a collection.
     * @param path Collection path
     */
    deleteAll?(path: string): Promise<void>;

    /**
     * Check if the given property is unique in the given collection
     * @param path Collection path
     * @param name of the property
     * @param value
     * @param entityId
     * @param collection
     * @return `true` if there are no other fields besides the given entity
     */
    checkUniqueField(
        path: string,
        name: string,
        value: unknown,
        entityId?: string | number,
        collection?: EntityCollection
    ): Promise<boolean>;

    /**
     * Count the number of entities in a collection
     */
    countEntities?<M extends Record<string, unknown> = Record<string, unknown>>(props: FetchCollectionProps<M>): Promise<number>;

    /**
     * Check if the given filter combination is valid
     * @param props
     */
    isFilterCombinationValid?(props: Omit<FilterCombinationValidProps, "collection"> & {
        databaseId?: string
    }): boolean;

    /**
     * Get the object to generate the current time in the driver
     */
    currentTime?: () => unknown;

    delegateToCMSModel?: (data: unknown) => unknown;

    cmsToDelegateModel?: (data: unknown) => unknown;

    initTextSearch?: (props: {
        context: RebaseContext,
        path: string,
        databaseId?: string,
        collection: EntityCollection,
        parentCollectionSlugs?: string[];
        parentEntityIds?: string[];
    }) => Promise<boolean>;

    /**
     * Flag to indicate if the driver has requested the initialization of the text search index
     */
    needsInitTextSearch?: boolean;

    // ── REST fetch capabilities ─────────────────────────────────────────

    /**
     * Optional REST-optimised fetch service. When present, the REST API
     * generator uses these methods instead of the generic `fetchEntity` /
     * `fetchCollection` pipeline, enabling include-aware eager-loading.
     */
    restFetchService?: RestFetchService;

    // ── Admin capabilities ─────────────────────────────────────────────
    //
    // Admin operations are now modelled as capability-specific interfaces
    // (SQLAdmin, DocumentAdmin, SchemaAdmin) in `@rebasepro/types/backend`.
    //
    // Drivers that support admin features should expose them here.
    // Consumers should use the `isSQLAdmin()`, `isSchemaAdmin()` etc.
    // type guards to safely narrow the type before calling methods.

    /**
     * Return the admin capabilities of this driver.
     * @see SQLAdmin
     * @see DocumentAdmin
     * @see SchemaAdmin
     */
    admin?: import("../types/backend").DatabaseAdmin;

}

/**
 * REST-optimised fetch service exposed by drivers that support
 * eager-loading of relations via `include`.
 *
 * The methods return flattened rows (`{ id, ...columns }`) rather
 * than the `Entity<M>` wrapper used by the generic DataDriver API.
 *
 * @group DataDriver
 */
export interface RestFetchService {
    /**
     * Fetch a collection of flattened entities with optional relation includes.
     */
    fetchCollectionForRest(
        collectionPath: string,
        options?: {
            filter?: FilterValues<string>;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            databaseId?: string;
            vectorSearch?: VectorSearchParams;
        },
        include?: string[]
    ): Promise<Record<string, unknown>[]>;

    /**
     * Fetch a single flattened entity with optional relation includes.
     */
    fetchEntityForRest(
        collectionPath: string,
        entityId: string | number,
        include?: string[],
        databaseId?: string
    ): Promise<Record<string, unknown> | null>;
}
