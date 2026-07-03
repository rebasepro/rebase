import type { CollectionRegistryController } from "./collection_registry";
import type { SnapshotStatus, SnapshotValues } from "../types/snapshots";
import type { SnapshotCollection, FilterValues } from "../types/collections";
import type { RebaseContext } from "../rebase_context";


/**
 * @internal
 */
export interface FetchOneProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    id: string | number;
    databaseId?: string;
    collection?: SnapshotCollection<M>
}

/**
 * @internal
 */
export type ListenOneProps<M extends Record<string, unknown> = Record<string, unknown>> =
    FetchOneProps<M>
    & {
        onUpdate: (row: Record<string, unknown> | null) => void,
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
    collection?: SnapshotCollection<M>;
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
        onUpdate: (rows: Record<string, unknown>[]) => void;
        onError?: (error: Error) => void;
    };

/**
 * @internal
 */
export interface SaveProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    values: Partial<SnapshotValues<M>>;
    id?: string | number; // can be empty for new snapshots
    previousValues?: Partial<SnapshotValues<M>>;
    collection?: SnapshotCollection<M>;
    status: SnapshotStatus;
}

/**
 * @internal
 */
export interface DeleteProps<M extends Record<string, unknown> = Record<string, unknown>> {
    row: { id: string | number; path: string; values?: Partial<SnapshotValues<M>> };
    collection?: SnapshotCollection<M>;
}

export type FilterCombinationValidProps = {
    path: string;
    databaseId?: string;
    collection: SnapshotCollection;
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
     * @return Promise of flat rows
     */
    fetchCollection<M extends Record<string, unknown> = Record<string, unknown>>(props: FetchCollectionProps<M>): Promise<Record<string, unknown>[]>;

    /**
     * Listen to a collection in a given path. If you don't implement this method
     * `fetchCollection` will be used instead, with no real time updates.
     * @param props
     * @return Function to cancel subscription
     */
    listenCollection?<M extends Record<string, unknown> = Record<string, unknown>>(props: ListenCollectionProps<M>): () => void;

    /**
     * Retrieve a single row given a path and a collection
     * @param props
     */
    fetchOne<M extends Record<string, unknown> = Record<string, unknown>>(props: FetchOneProps<M>): Promise<Record<string, unknown> | undefined>;

    /**
     * Get realtime updates on one row.
     * @param props
     * @return Function to cancel subscription
     */
    listenOne?<M extends Record<string, unknown> = Record<string, unknown>>(props: ListenOneProps<M>): () => void;

    /**
     * Save a row to the specified path
     * @param props
     */
    save<M extends Record<string, unknown> = Record<string, unknown>>(props: SaveProps<M>): Promise<Record<string, unknown>>;

    /**
     * Delete a snapshot
     * @param props
     * @return was the whole deletion flow successful
     */
    delete<M extends Record<string, unknown> = Record<string, unknown>>(props: DeleteProps<M>): Promise<void>;

    /**
     * Delete all snapshots from a collection.
     * @param path Collection path
     */
    deleteAll?(path: string): Promise<void>;

    /**
     * Check if the given property is unique in the given collection
     * @param path Collection path
     * @param name of the property
     * @param value
     * @param id
     * @param collection
     * @return `true` if there are no other fields besides the given snapshot
     */
    checkUniqueField(
        path: string,
        name: string,
        value: unknown,
        id?: string | number,
        collection?: SnapshotCollection
    ): Promise<boolean>;

    /**
     * Count the number of snapshots in a collection
     */
    count?<M extends Record<string, unknown> = Record<string, unknown>>(props: FetchCollectionProps<M>): Promise<number>;

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
        collection: SnapshotCollection,
        parentCollectionSlugs?: string[];
        parentSnapshotIds?: string[];
    }) => Promise<boolean>;

    /**
     * Flag to indicate if the driver has requested the initialization of the text search index
     */
    needsInitTextSearch?: boolean;

    // ── REST fetch capabilities ─────────────────────────────────────────

    /**
     * Optional REST-optimised fetch service. When present, the REST API
     * generator uses these methods instead of the generic `fetchOne` /
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
 * The methods return flattened rows (`{ id, ...columns }`) with
 * included relations inlined as plain nested rows — the shape served
 * to app developers through the REST API / SDK client.
 *
 * @group DataDriver
 */
export interface RestFetchService {
    /**
     * Fetch a collection of flattened snapshots with optional relation includes.
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
     * Fetch a single flattened snapshot with optional relation includes.
     */
    fetchOneForRest(
        collectionPath: string,
        id: string | number,
        include?: string[],
        databaseId?: string
    ): Promise<Record<string, unknown> | null>;
}
