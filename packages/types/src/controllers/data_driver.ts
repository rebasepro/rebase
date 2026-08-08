import { RebaseApiError } from "../errors";
import type { CollectionRegistryController } from "./collection_registry";
import type { EntityStatus, EntityValues } from "../types/entities";
import type { CollectionConfig, FilterValues } from "../types/collections";
import type { RebaseCallContext } from "../call_context";
import type { LogicalCondition } from "./data";


/**
 * @internal
 */
export interface FetchOneProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    id: string | number;
    databaseId?: string;
    collection?: CollectionConfig<M>
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

// ── List pagination bounds ────────────────────────────────────────────────
//
// Client-driven list reads (REST `GET /<collection>` and the WebSocket
// `subscribe_collection` message) accept a client-supplied `limit`. Without
// bounds, an ABSENT limit streams the entire table into memory — a trivial
// OOM/DoS — and `limit=100000000` (or `limit=0`, historically an unlimited
// bypass) is honoured verbatim. `resolveClientListLimit` is the single shared
// enforcement point so every untrusted ingress behaves identically. Trusted
// server-side callers build fetch options directly and are intentionally NOT
// bounded here (migrations, admin exports, and CDC refetches may need the full
// set).
//
// A limit the platform will not serve is REFUSED, not quietly shrunk. Clamping
// answers a request for 100 000 rows with 1 000 of them, and a short page is
// indistinguishable from "that is all the data there is" — which is how a CSV
// export shipped 50 rows of a 100 000-row collection under a filename that read
// like the whole thing. `meta.total`/`meta.hasMore` make truncation *detectable*
// on the REST list response, but only for a caller who thinks to compare what it
// asked for against what it got, and the WebSocket `collection_update` frame
// carries neither — so signalling cannot be the answer on every surface and
// rejecting is. An ABSENT limit still defaults: naming no window is not the same
// as asking for one that cannot be served.

/** Rows returned for a plain / text-search list read when the client sends no `limit`. */
export const DEFAULT_LIST_LIMIT = 50;
/** Rows returned for a vector-search list read when the client sends no `limit`. */
export const DEFAULT_VECTOR_LIST_LIMIT = 10;
/** Largest `limit` a client may ask for on any surface. Above it, the read is refused. */
export const MAX_LIST_LIMIT = 1000;

/** Overridable bounds for {@link resolveClientListLimit}. */
export interface ListLimitBounds {
    /** Default page size for plain and text-search reads. */
    defaultLimit?: number;
    /** Default page size for vector-search reads. */
    vectorDefaultLimit?: number;
    /** Largest limit a client may ask for. A larger one is rejected, not clamped. */
    maxLimit?: number;
}

/**
 * Thrown by {@link resolveClientListLimit} for a `limit` the platform will not
 * serve. Carries an HTTP status so an ingress that speaks HTTP can forward it
 * verbatim, and `maxLimit` so one can be built without re-deriving the ceiling.
 *
 * @group Errors
 */
export class ListLimitError extends RebaseApiError {
    /** The ceiling that was exceeded — what the caller should page by instead. */
    readonly maxLimit: number;

    constructor(message: string, maxLimit: number) {
        super(message, { status: 400, code: "INVALID_LIMIT" });
        this.name = "ListLimitError";
        this.maxLimit = maxLimit;
        // Keeps `instanceof` working when this is compiled down for an older
        // target, where extending a builtin otherwise loses the prototype.
        Object.setPrototypeOf(this, ListLimitError.prototype);
    }
}

/**
 * Resolve a client-supplied list `limit` into a safe, always-defined value.
 *
 * - An absent / blank limit falls back to the mode default:
 *   `vectorDefaultLimit` for a vector search, otherwise `defaultLimit`.
 * - A limit that is present must be an integer in `[1, maxLimit]`. Anything
 *   else — `0`, a negative, `1.5`, `abc`, `100000000` — throws
 *   {@link ListLimitError} rather than being coerced into range, because every
 *   coercion answers a question the caller did not ask with a page it cannot
 *   tell apart from the whole collection.
 *
 * The return is never `undefined` — no ingress that routes its client limit
 * through this can produce an unbounded read.
 *
 * @throws {ListLimitError} when a present `limit` is not an integer in range.
 */
export function resolveClientListLimit(
    rawLimit: number | string | null | undefined,
    opts: ListLimitBounds & { vectorSearch?: boolean } = {}
): number {
    const maxLimit = opts.maxLimit ?? MAX_LIST_LIMIT;
    if (rawLimit != null && String(rawLimit).trim() !== "") {
        // `Number`, not `parseInt`: `parseInt("50rows")` is 50, which silently
        // reads a typo as a window the caller never wrote.
        const parsed = typeof rawLimit === "number" ? rawLimit : Number(String(rawLimit).trim());
        if (!Number.isInteger(parsed) || parsed < 1) {
            throw new ListLimitError(
                `Invalid \`limit\`: ${String(rawLimit)}. Expected a whole number between 1 and ${maxLimit}.`,
                maxLimit
            );
        }
        if (parsed > maxLimit) {
            throw new ListLimitError(
                `\`limit\` ${parsed} is above the maximum of ${maxLimit}. Ask for at most ${maxLimit} rows ` +
                "per read and page through the rest with `offset` — answering with a smaller page would be " +
                "indistinguishable from there being no more rows.",
                maxLimit
            );
        }
        return parsed;
    }
    return opts.vectorSearch
        ? (opts.vectorDefaultLimit ?? DEFAULT_VECTOR_LIST_LIMIT)
        : (opts.defaultLimit ?? DEFAULT_LIST_LIMIT);
}

/**
 * @internal
 */
export interface FetchCollectionProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    collection?: CollectionConfig<M>;
    filter?: FilterValues<Extract<keyof M, string>>,
    /**
     * An `or(...)`/`and(...)` group, applied alongside `filter`.
     *
     * The REST layer parsed `?or=` into this and then had nowhere to put it, so
     * the group was dropped and the read ran unfiltered — returning every row
     * the caller's policies allowed rather than the ones they asked for.
     */
    logical?: LogicalCondition;
    limit?: number;
    offset?: number;
    startAfter?: unknown;
    orderBy?: string;
    searchString?: string;
    /** Ask each row which declared search field matched — populates `_matches`. */
    searchExplain?: boolean;
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
    values: Partial<EntityValues<M>>;
    id?: string | number; // can be empty for new entities
    previousValues?: Partial<EntityValues<M>>;
    collection?: CollectionConfig<M>;
    status: EntityStatus;
    /**
     * Write the row with INSERT ... ON CONFLICT DO UPDATE on the primary key
     * instead of choosing between insert and update up front.
     *
     * One statement, so it does not lose the race a read-then-write can, and it
     * succeeds whether or not the row is already there — what a re-runnable
     * import needs. Requires every primary key column to be present; without
     * them there is no conflict target and the row is inserted normally.
     */
    upsert?: boolean;
}

/**
 * @internal
 */
export interface SaveManyProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    /**
     * The rows to write. A row carrying its primary key updates (or, with
     * `upsert`, inserts-or-updates) that row; one without inserts.
     */
    rows: Partial<EntityValues<M>>[];
    collection?: CollectionConfig<M>;
    /** Apply every row as INSERT ... ON CONFLICT DO UPDATE. See {@link SaveProps.upsert}. */
    upsert?: boolean;
}

/**
 * @internal
 */
export interface UpdateManyProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    /**
     * The rows to update, each named by its address.
     *
     * Distinct from {@link SaveManyProps.rows}, which carries keys *inside* the
     * values and is insert-shaped — `saveMany` passes `status: "new"` and no
     * `id`, so it cannot express "update exactly this row". This can, and it is
     * why bulk update is a separate driver method rather than a flag on that one.
     */
    updates: { id: string | number; values: Partial<EntityValues<M>> }[];
    collection?: CollectionConfig<M>;
}

/**
 * @internal
 */
export interface DeleteProps<M extends Record<string, unknown> = Record<string, unknown>> {
    row: { id: string | number; path: string; values?: Partial<EntityValues<M>> };
    collection?: CollectionConfig<M>;
}

/**
 * @internal
 */
export interface DeleteManyProps<M extends Record<string, unknown> = Record<string, unknown>> {
    path: string;
    ids: (string | number)[];
    collection?: CollectionConfig<M>;
}

export type FilterCombinationValidProps = {
    path: string;
    databaseId?: string;
    collection: CollectionConfig;
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
     * Save many rows as one unit of work.
     *
     * Every row runs the same pipeline as {@link save} — callbacks, relations
     * and row-level security all still apply — but they share a single
     * transaction, so the batch either lands whole or not at all. That, and the
     * single round trip, is what makes importing tens of thousands of rows
     * viable without dropping to raw SQL.
     *
     * Optional: drivers that cannot do this leave it undefined and callers fall
     * back to `save` per row.
     */
    saveMany?<M extends Record<string, unknown> = Record<string, unknown>>(props: SaveManyProps<M>): Promise<Record<string, unknown>[]>;

    /**
     * Update many rows in one transaction, each addressed by id.
     *
     * Optional for the same reason `saveMany` is: a driver that cannot make the
     * batch atomic should not pretend to. The REST layer reports
     * `BULK_UNSUPPORTED` rather than silently falling back to a loop of single
     * writes, which would be neither atomic nor one round trip — the two things
     * a caller reaches for a batch to get.
     */
    updateMany?<M extends Record<string, unknown> = Record<string, unknown>>(props: UpdateManyProps<M>): Promise<Record<string, unknown>[]>;

    /**
     * Delete a entity
     * @param props
     * @return was the whole deletion flow successful
     */
    delete<M extends Record<string, unknown> = Record<string, unknown>>(props: DeleteProps<M>): Promise<void>;

    /**
     * Delete all entities from a collection.
     * @param path Collection path
     */
    deleteAll?(path: string): Promise<void>;

    /**
     * Delete many rows in one transaction, addressed by id.
     *
     * Ids rather than a filter, deliberately — see
     * {@link SDKCollectionClient.deleteMany}. Optional, as `saveMany` is.
     */
    deleteMany?<M extends Record<string, unknown> = Record<string, unknown>>(props: DeleteManyProps<M>): Promise<void>;

    /**
     * Check if the given property is unique in the given collection
     * @param path Collection path
     * @param name of the property
     * @param value
     * @param id
     * @param collection
     * @return `true` if there are no other fields besides the given entity
     */
    checkUniqueField(
        path: string,
        name: string,
        value: unknown,
        id?: string | number,
        collection?: CollectionConfig
    ): Promise<boolean>;

    /**
     * Count the number of entities in a collection
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
        context: RebaseCallContext,
        path: string,
        databaseId?: string,
        collection: CollectionConfig,
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
 * The methods return flattened rows — exactly the table's columns, under their
 * own names and with the types the database returned — and included relations
 * inlined as plain nested rows. This is the shape served to app developers
 * through the REST API / SDK client.
 *
 * No synthesized `id`: identity is a primary key, which may be named anything
 * and span several columns, so an address is derived by whoever needs one (see
 * `buildCompositeId`) rather than written into the row on top of the data.
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
            /** An `or(...)`/`and(...)` group, applied alongside `filter`. */
            logical?: LogicalCondition;
            orderBy?: string;
            order?: "desc" | "asc";
            limit?: number;
            offset?: number;
            startAfter?: Record<string, unknown>;
            searchString?: string;
            /** Ask each row which declared search fields matched — populates `_matches`. */
            searchExplain?: boolean;
            databaseId?: string;
            vectorSearch?: VectorSearchParams;
        },
        include?: string[]
    ): Promise<Record<string, unknown>[]>;

    /**
     * Fetch a single flattened entity with optional relation includes.
     */
    fetchOneForRest(
        collectionPath: string,
        id: string | number,
        include?: string[],
        databaseId?: string
    ): Promise<Record<string, unknown> | null>;
}
